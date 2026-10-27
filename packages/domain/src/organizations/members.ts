import type { Role } from "@kroov/auth";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import {
  contextIsOwner,
  countActiveOwners,
  loadMemberContext,
  requirePermission,
  systemRoleId,
} from "../authorization";
import { type Actor, ForbiddenError, NotFoundError, PreconditionFailedError } from "../kernel";
import { type RoleGrant, type SetMemberRolesInput, setMemberRolesSchema } from "./schemas";

export interface MemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  joinedAt: Date;
  grants: Array<{ role: Role; roleName: string; eventId: string | null }>;
}

/** Active members with their grants (organization.read). */
export async function listMembers(db: DbExecutor, actor: Actor, organizationId: string): Promise<MemberView[]> {
  await requirePermission(db, actor, "organization.read", { organizationId });
  const rows = await db.execute<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    email_verified: boolean;
    joined_at: Date;
    grants: Array<{ role: Role; roleName: string; eventId: string | null }> | null;
  }>(sql`
    select m.id, m.user_id, u.name, u.email, u.email_verified, m.joined_at,
      (select json_agg(json_build_object('role', r.key, 'roleName', r.name, 'eventId', a.event_id) order by r.key)
         from member_role_assignments a join roles r on r.id = a.role_id
        where a.member_id = m.id) as grants
    from organization_members m
    join users u on u.id = m.user_id
    where m.organization_id = ${organizationId} and m.status = 'active'
    order by m.joined_at, u.name
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    emailVerified: r.email_verified,
    joinedAt: new Date(r.joined_at),
    grants: r.grants ?? [],
  }));
}

async function lockOrganization(tx: DbExecutor, organizationId: string): Promise<void> {
  // Serialises owner-count checks across concurrent role changes / removals.
  const rows = await tx.execute(sql`select id from organizations where id = ${organizationId} for update`);
  if (rows.rows.length === 0) throw new NotFoundError("Organisation", organizationId);
}

async function getActiveMember(tx: DbExecutor, organizationId: string, memberId: string) {
  const rows = await tx
    .select()
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.id, memberId),
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.status, "active"),
      ),
    )
    .limit(1);
  const member = rows[0];
  if (!member) throw new NotFoundError("Membre", memberId);
  return member;
}

/**
 * Replace the member's grants. Rules:
 * - members.manage required;
 * - granting or removing `owner` requires the actor to be an owner;
 * - the organization must keep at least one organization-wide owner (last-owner protection);
 * - the grant set is replaced atomically.
 */
export async function setMemberRoles(
  db: Database,
  actor: Actor,
  organizationId: string,
  memberId: string,
  rawInput: SetMemberRolesInput,
): Promise<MemberView> {
  const ctx = await requirePermission(db, actor, "members.manage", { organizationId });
  const { grants, reason } = setMemberRolesSchema.parse(rawInput);

  await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const member = await getActiveMember(tx, organizationId, memberId);

    const current = await tx
      .select({ roleKey: schema.roles.key, eventId: schema.memberRoleAssignments.eventId })
      .from(schema.memberRoleAssignments)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberRoleAssignments.roleId))
      .where(eq(schema.memberRoleAssignments.memberId, member.id));

    const hadOwner = current.some((g) => g.roleKey === "owner" && g.eventId === null);
    const willHaveOwner = grants.some((g) => g.role === "owner" && !g.eventId);
    const touchesOwner = hadOwner !== willHaveOwner;
    if (touchesOwner && ctx && !contextIsOwner(ctx)) {
      throw new ForbiddenError("owner.manage");
    }
    if (hadOwner && !willHaveOwner) {
      const owners = await countActiveOwners(tx, organizationId);
      if (owners <= 1) {
        throw new PreconditionFailedError(
          "Impossible de retirer le dernier propriétaire. Nommez d'abord un autre propriétaire.",
          { code: "last_owner" },
        );
      }
    }

    await tx.delete(schema.memberRoleAssignments).where(eq(schema.memberRoleAssignments.memberId, member.id));
    const dedup = new Map<string, RoleGrant>();
    for (const g of grants) dedup.set(`${g.role}:${g.eventId ?? ""}`, g);
    for (const g of dedup.values()) {
      await tx.insert(schema.memberRoleAssignments).values({
        organizationId,
        memberId: member.id,
        roleId: await systemRoleId(tx, g.role),
        eventId: g.eventId ?? null,
        grantedBy: actor.kind === "user" ? actor.userId : null,
      });
    }

    await recordAudit(tx, actor, {
      organizationId,
      action: "member.roles_changed",
      targetType: "organization_member",
      targetId: member.id,
      reason: reason ?? null,
      metadata: {
        before: current.map((g) => ({ role: g.roleKey, eventId: g.eventId })),
        after: [...dedup.values()].map((g) => ({ role: g.role, eventId: g.eventId ?? null })),
      },
    });
  });

  const members = await listMembers(db, actor, organizationId);
  const view = members.find((m) => m.id === memberId);
  if (!view) throw new NotFoundError("Membre", memberId);
  return view;
}

/**
 * Remove a member (soft: status = removed, grants deleted). Rules:
 * - members.manage required; removing an owner requires an owner;
 * - never removes the last owner;
 * - the member's sessions stay valid but every organization check fails from now on.
 */
export async function removeMember(
  db: Database,
  actor: Actor,
  organizationId: string,
  memberId: string,
  reason?: string,
): Promise<void> {
  const ctx = await requirePermission(db, actor, "members.manage", { organizationId });

  await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const member = await getActiveMember(tx, organizationId, memberId);

    const target = await loadMemberContext(tx, member.userId, organizationId);
    const targetIsOwner = target ? contextIsOwner(target) : false;
    if (targetIsOwner && ctx && !contextIsOwner(ctx)) throw new ForbiddenError("owner.manage");
    if (targetIsOwner) {
      const owners = await countActiveOwners(tx, organizationId);
      if (owners <= 1) {
        throw new PreconditionFailedError(
          "Impossible de retirer le dernier propriétaire. Nommez d'abord un autre propriétaire.",
          { code: "last_owner" },
        );
      }
    }

    await tx.delete(schema.memberRoleAssignments).where(eq(schema.memberRoleAssignments.memberId, member.id));
    await tx
      .update(schema.organizationMembers)
      .set({
        status: "removed",
        removedAt: new Date(),
        removedBy: actor.kind === "user" ? actor.userId : null,
      })
      .where(eq(schema.organizationMembers.id, member.id));

    await recordAudit(tx, actor, {
      organizationId,
      action: "member.removed",
      targetType: "organization_member",
      targetId: member.id,
      reason: reason ?? null,
      metadata: { userId: member.userId },
    });
  });
}
