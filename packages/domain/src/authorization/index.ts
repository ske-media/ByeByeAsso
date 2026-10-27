import type { Permission, Role } from "@kroov/auth/catalogue";
import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Actor, ForbiddenError, UnauthenticatedError } from "../kernel";

/**
 * Server-side authorization kernel. DENY BY DEFAULT.
 *
 * A permission is granted to a user in an organization when at least one ACTIVE membership
 * carries a role assignment whose role includes the permission and whose scope matches:
 * - organization-wide assignment (event_id NULL) matches every scope;
 * - event-scoped assignment matches only when `scope.eventId` equals it.
 *
 * Nothing here trusts client input: organization and event ids are looked up against the
 * acting user's own memberships. Hiding a button never protects an operation — call
 * `requirePermission` inside the service, not only in the page.
 */

export interface AuthScope {
  organizationId: string;
  eventId?: string | undefined;
}

export interface MemberContext {
  memberId: string;
  userId: string;
  organizationId: string;
  /** Role keys granted organization-wide. */
  organizationRoles: Role[];
  /** Permissions granted organization-wide (any event). */
  organizationPermissions: Set<Permission>;
  /** Event-scoped grants: eventId → permissions. */
  eventPermissions: Map<string, Set<Permission>>;
}

type GrantRow = {
  member_id: string;
  role_key: string;
  event_id: string | null;
  permission_key: string;
};

/** Load the full grant set of a user in one organization (null if not an active member). */
export async function loadMemberContext(
  db: DbExecutor,
  userId: string,
  organizationId: string,
): Promise<MemberContext | null> {
  const result = await db.execute<GrantRow>(sql`
    select m.id as member_id, r.key as role_key, a.event_id, p.key as permission_key
    from organization_members m
    join member_role_assignments a on a.member_id = m.id and a.organization_id = m.organization_id
    join roles r on r.id = a.role_id
    join role_permissions rp on rp.role_id = r.id
    join permissions p on p.id = rp.permission_id
    where m.user_id = ${userId} and m.organization_id = ${organizationId} and m.status = 'active'
  `);

  if (result.rows.length === 0) {
    // Member without any role still exists: check membership separately so callers can
    // distinguish "not a member" from "member with no rights".
    const member = await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.userId, userId),
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.status, "active"),
        ),
      )
      .limit(1);
    const first = member[0];
    if (!first) return null;
    return {
      memberId: first.id,
      userId,
      organizationId,
      organizationRoles: [],
      organizationPermissions: new Set(),
      eventPermissions: new Map(),
    };
  }

  const ctx: MemberContext = {
    memberId: result.rows[0]!.member_id,
    userId,
    organizationId,
    organizationRoles: [],
    organizationPermissions: new Set(),
    eventPermissions: new Map(),
  };
  const orgRoles = new Set<Role>();
  for (const row of result.rows) {
    const permission = row.permission_key as Permission;
    if (row.event_id === null) {
      ctx.organizationPermissions.add(permission);
      orgRoles.add(row.role_key as Role);
    } else {
      const set = ctx.eventPermissions.get(row.event_id) ?? new Set<Permission>();
      set.add(permission);
      ctx.eventPermissions.set(row.event_id, set);
    }
  }
  ctx.organizationRoles = [...orgRoles];
  return ctx;
}

export function contextHasPermission(ctx: MemberContext, permission: Permission, scope: AuthScope): boolean {
  if (ctx.organizationId !== scope.organizationId) return false;
  if (ctx.organizationPermissions.has(permission)) return true;
  if (scope.eventId) {
    return ctx.eventPermissions.get(scope.eventId)?.has(permission) ?? false;
  }
  return false;
}

export function contextIsOwner(ctx: MemberContext): boolean {
  return ctx.organizationRoles.includes("owner");
}

/**
 * Authorize or throw. UnauthenticatedError for anonymous actors, ForbiddenError otherwise.
 * System and webhook actors are trusted callers of internal jobs: they bypass RBAC but the
 * caller must still pass a correct organization scope.
 */
export async function requirePermission(
  db: DbExecutor,
  actor: Actor,
  permission: Permission,
  scope: AuthScope,
): Promise<MemberContext | null> {
  if (actor.kind === "anonymous") throw new UnauthenticatedError();
  if (actor.kind === "system" || actor.kind === "webhook") return null;

  const ctx = await loadMemberContext(db, actor.userId, scope.organizationId);
  if (!ctx || !contextHasPermission(ctx, permission, scope)) {
    throw new ForbiddenError(permission);
  }
  return ctx;
}

/** Count active owners of an organization — used for last-owner protection. */
export async function countActiveOwners(db: DbExecutor, organizationId: string): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(distinct m.id)::text as count
    from organization_members m
    join member_role_assignments a on a.member_id = m.id and a.organization_id = m.organization_id
    join roles r on r.id = a.role_id and r.key = 'owner' and r.organization_id is null
    where m.organization_id = ${organizationId} and m.status = 'active' and a.event_id is null
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/** Resolve the system role id for a role key (system roles only). */
export async function systemRoleId(db: DbExecutor, key: Role): Promise<string> {
  const rows = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.key, key), isNull(schema.roles.organizationId), eq(schema.roles.isSystem, true)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Rôle système introuvable : ${key}`);
  return row.id;
}
