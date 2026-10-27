import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "@kroov/auth";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { type EmailPort, renderTransactionalEmail } from "@kroov/notifications";
import { and, desc, eq, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { contextIsOwner, requirePermission, systemRoleId } from "../authorization";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  UnauthenticatedError,
} from "../kernel";
import { type CreateInvitationInput, createInvitationSchema } from "./schemas";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 256-bit random token, URL-safe. Only its SHA-256 is stored. */
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  roleName: string;
  eventId: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
  createdAt: Date;
  lastSentAt: Date;
  invitedByName: string;
}

export interface InvitationContext {
  email: EmailPort;
  appName: string;
  appUrl: string;
}

async function sendInvitationEmail(
  ctx: InvitationContext,
  params: {
    to: string;
    token: string;
    organizationName: string;
    roleName: string;
    inviterName: string;
    expiresAt: Date;
  },
): Promise<void> {
  const url = `${ctx.appUrl}/invitation/${params.token}`;
  const { text, html } = renderTransactionalEmail({
    appName: ctx.appName,
    title: `${params.inviterName} vous invite à rejoindre ${params.organizationName}`,
    paragraphs: [
      `Vous êtes invité·e à rejoindre l'organisation « ${params.organizationName} » sur ${ctx.appName} avec le rôle « ${params.roleName} ».`,
      `Cette invitation expire le ${params.expiresAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" })}. Elle ne peut être acceptée qu'avec un compte dont l'adresse e-mail vérifiée est ${params.to}.`,
    ],
    action: { label: "Accepter l'invitation", url },
  });
  await ctx.email.send({
    to: params.to,
    subject: `${ctx.appName} · Invitation à rejoindre ${params.organizationName}`,
    text,
    html,
  });
}

function toView(row: {
  id: string;
  email: string;
  roleKey: string;
  roleName: string;
  eventId: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
  createdAt: Date;
  lastSentAt: Date;
  invitedByName: string;
}): InvitationView {
  const effectiveStatus = row.status === "pending" && row.expiresAt.getTime() < Date.now() ? "expired" : row.status;
  return {
    id: row.id,
    email: row.email,
    role: row.roleKey as Role,
    roleName: row.roleName,
    eventId: row.eventId,
    status: effectiveStatus,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt,
    invitedByName: row.invitedByName,
  };
}

const invitationSelect = {
  id: schema.organizationInvitations.id,
  email: schema.organizationInvitations.email,
  roleKey: schema.roles.key,
  roleName: schema.roles.name,
  eventId: schema.organizationInvitations.eventId,
  status: schema.organizationInvitations.status,
  expiresAt: schema.organizationInvitations.expiresAt,
  createdAt: schema.organizationInvitations.createdAt,
  lastSentAt: schema.organizationInvitations.lastSentAt,
  invitedByName: schema.users.name,
};

export async function listInvitations(db: DbExecutor, actor: Actor, organizationId: string): Promise<InvitationView[]> {
  await requirePermission(db, actor, "members.invite", { organizationId });
  const rows = await db
    .select(invitationSelect)
    .from(schema.organizationInvitations)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationInvitations.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationInvitations.invitedBy))
    .where(eq(schema.organizationInvitations.organizationId, organizationId))
    .orderBy(desc(schema.organizationInvitations.createdAt))
    .limit(200);
  return rows.map(toView);
}

/**
 * Invite an e-mail address with one role. Rules:
 * - members.invite required; inviting as `owner` requires an owner;
 * - an address that is already an active member cannot be invited;
 * - one pending invitation per (organization, email); a previous expired/revoked one is left as history.
 */
export async function createInvitation(
  db: Database,
  actor: Actor,
  ctx: InvitationContext,
  organizationId: string,
  rawInput: CreateInvitationInput,
): Promise<InvitationView> {
  const member = await requirePermission(db, actor, "members.invite", { organizationId });
  const input = createInvitationSchema.parse(rawInput);
  if (actor.kind !== "user") throw new UnauthenticatedError();
  if (input.role === "owner" && member && !contextIsOwner(member)) throw new ForbiddenError("owner.manage");

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitationId = await db.transaction(async (tx) => {
    // Checks the e-mail against active members of this organization only.
    const alreadyMember = await tx.execute<{ id: string }>(sql`
      select m.id from organization_members m join users u on u.id = m.user_id
      where m.organization_id = ${organizationId} and m.status = 'active' and u.email = ${input.email}
      limit 1`);
    if (alreadyMember.rows.length > 0) {
      throw new ConflictError("Cette personne fait déjà partie de l'organisation.", { field: "email" });
    }

    const pending = await tx
      .select({ id: schema.organizationInvitations.id, expiresAt: schema.organizationInvitations.expiresAt })
      .from(schema.organizationInvitations)
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, organizationId),
          eq(schema.organizationInvitations.email, input.email),
          eq(schema.organizationInvitations.status, "pending"),
        ),
      )
      .limit(1);
    const existing = pending[0];
    if (existing) {
      if (existing.expiresAt.getTime() >= Date.now()) {
        throw new ConflictError("Une invitation est déjà en attente pour cette adresse. Vous pouvez la renvoyer.", {
          field: "email",
          invitationId: existing.id,
        });
      }
      // Expired pending row: mark it so the partial unique index frees the slot.
      await tx
        .update(schema.organizationInvitations)
        .set({ status: "expired" })
        .where(eq(schema.organizationInvitations.id, existing.id));
    }

    const [row] = await tx
      .insert(schema.organizationInvitations)
      .values({
        organizationId,
        email: input.email,
        roleId: await systemRoleId(tx, input.role),
        eventId: input.eventId ?? null,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt,
      })
      .returning({ id: schema.organizationInvitations.id });
    if (!row) throw new Error("Insertion de l'invitation échouée");

    await recordAudit(tx, actor, {
      organizationId,
      action: "invitation.created",
      targetType: "organization_invitation",
      targetId: row.id,
      metadata: { email: input.email, role: input.role, eventId: input.eventId ?? null },
    });
    return row.id;
  });

  const view = await getInvitationView(db, invitationId);
  const org = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  await sendInvitationEmail(ctx, {
    to: view.email,
    token,
    organizationName: org[0]?.name ?? "",
    roleName: view.roleName,
    inviterName: view.invitedByName,
    expiresAt,
  });
  return view;
}

async function getInvitationView(db: DbExecutor, invitationId: string): Promise<InvitationView> {
  const rows = await db
    .select(invitationSelect)
    .from(schema.organizationInvitations)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationInvitations.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationInvitations.invitedBy))
    .where(eq(schema.organizationInvitations.id, invitationId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Invitation", invitationId);
  return toView(row);
}

export async function revokeInvitation(
  db: Database,
  actor: Actor,
  organizationId: string,
  invitationId: string,
  reason?: string,
): Promise<void> {
  await requirePermission(db, actor, "members.invite", { organizationId });
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.organizationInvitations)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: actor.kind === "user" ? actor.userId : null })
      .where(
        and(
          eq(schema.organizationInvitations.id, invitationId),
          eq(schema.organizationInvitations.organizationId, organizationId),
          eq(schema.organizationInvitations.status, "pending"),
        ),
      )
      .returning({ id: schema.organizationInvitations.id });
    if (updated.length === 0) throw new NotFoundError("Invitation", invitationId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "invitation.revoked",
      targetType: "organization_invitation",
      targetId: invitationId,
      reason: reason ?? null,
    });
  });
}

/** Issue a fresh token and expiry for a pending or expired invitation, then re-send it. */
export async function resendInvitation(
  db: Database,
  actor: Actor,
  ctx: InvitationContext,
  organizationId: string,
  invitationId: string,
): Promise<InvitationView> {
  await requirePermission(db, actor, "members.invite", { organizationId });
  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.organizationInvitations.id, status: schema.organizationInvitations.status })
      .from(schema.organizationInvitations)
      .where(
        and(
          eq(schema.organizationInvitations.id, invitationId),
          eq(schema.organizationInvitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError("Invitation", invitationId);
    if (row.status === "accepted" || row.status === "revoked") {
      throw new PreconditionFailedError("Cette invitation ne peut plus être renvoyée.", { status: row.status });
    }
    await tx
      .update(schema.organizationInvitations)
      .set({ tokenHash, expiresAt, status: "pending", lastSentAt: new Date() })
      .where(eq(schema.organizationInvitations.id, invitationId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "invitation.resent",
      targetType: "organization_invitation",
      targetId: invitationId,
    });
  });

  const view = await getInvitationView(db, invitationId);
  const org = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  await sendInvitationEmail(ctx, {
    to: view.email,
    token,
    organizationName: org[0]?.name ?? "",
    roleName: view.roleName,
    inviterName: view.invitedByName,
    expiresAt,
  });
  return view;
}

export interface PublicInvitation {
  organizationName: string;
  roleName: string;
  invitedByName: string;
  /** Masked e-mail so the page can say which account is expected without leaking it fully. */
  emailHint: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, local.length - 2))}@${domain}`;
}

/**
 * Public lookup by raw token (page /invitation/{token}). Returns minimal, non-sensitive data.
 * Unknown token → 404 (no distinction between "never existed" and "wrong").
 */
export async function getInvitationByToken(
  db: DbExecutor,
  token: string,
): Promise<PublicInvitation & { email: string }> {
  if (token.length < 20 || token.length > 128) throw new NotFoundError("Invitation");
  const tokenHash = hashInvitationToken(token);
  const rows = await db
    .select({
      email: schema.organizationInvitations.email,
      status: schema.organizationInvitations.status,
      expiresAt: schema.organizationInvitations.expiresAt,
      tokenHash: schema.organizationInvitations.tokenHash,
      organizationName: schema.organizations.name,
      roleName: schema.roles.name,
      invitedByName: schema.users.name,
    })
    .from(schema.organizationInvitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationInvitations.organizationId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationInvitations.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationInvitations.invitedBy))
    .where(eq(schema.organizationInvitations.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  // Constant-time comparison on top of the indexed lookup (defence in depth).
  if (!row || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(tokenHash)))
    throw new NotFoundError("Invitation");
  const status = row.status === "pending" && row.expiresAt.getTime() < Date.now() ? "expired" : row.status;
  return {
    organizationName: row.organizationName,
    roleName: row.roleName,
    invitedByName: row.invitedByName,
    emailHint: maskEmail(row.email),
    email: row.email,
    status,
    expiresAt: row.expiresAt,
  };
}

/**
 * Accept an invitation with the signed-in account. Rules:
 * - pending and not expired; expired → precondition failed with a clear message;
 * - the account's e-mail must be VERIFIED and equal to the invited address;
 * - creates (or re-activates) the membership and assigns the invited role; single use.
 */
export async function acceptInvitation(
  db: Database,
  actor: Actor,
  token: string,
): Promise<{ organizationId: string; organizationSlug: string }> {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  const tokenHash = hashInvitationToken(token);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        invitation: schema.organizationInvitations,
        organizationSlug: schema.organizations.slug,
      })
      .from(schema.organizationInvitations)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationInvitations.organizationId))
      .where(eq(schema.organizationInvitations.tokenHash, tokenHash))
      .for("update")
      .limit(1);
    const found = rows[0];
    if (!found) throw new NotFoundError("Invitation");
    const inv = found.invitation;

    if (inv.status !== "pending") {
      throw new PreconditionFailedError("Cette invitation n'est plus valide.", { status: inv.status });
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      await tx
        .update(schema.organizationInvitations)
        .set({ status: "expired" })
        .where(eq(schema.organizationInvitations.id, inv.id));
      throw new PreconditionFailedError(
        "Cette invitation a expiré. Demandez à une personne administratrice de la renvoyer.",
        { status: "expired" },
      );
    }

    const users = await tx
      .select({ email: schema.users.email, emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, actor.userId))
      .limit(1);
    const user = users[0];
    if (!user) throw new UnauthenticatedError();
    if (!user.emailVerified) {
      throw new PreconditionFailedError("Confirmez d'abord votre adresse e-mail pour accepter une invitation.", {
        code: "email_not_verified",
      });
    }
    if (user.email.toLowerCase() !== inv.email) {
      throw new ForbiddenError("invitation.email_mismatch");
    }

    // Membership: reactivate a removed row or create a new one.
    const existing = await tx
      .select({ id: schema.organizationMembers.id, status: schema.organizationMembers.status })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, inv.organizationId),
          eq(schema.organizationMembers.userId, actor.userId),
          eq(schema.organizationMembers.status, "active"),
        ),
      )
      .limit(1);
    let memberId = existing[0]?.id;
    if (!memberId) {
      const [created] = await tx
        .insert(schema.organizationMembers)
        .values({ organizationId: inv.organizationId, userId: actor.userId })
        .returning({ id: schema.organizationMembers.id });
      memberId = created?.id;
    }
    if (!memberId) throw new Error("Création du membre échouée");

    await tx
      .insert(schema.memberRoleAssignments)
      .values({
        organizationId: inv.organizationId,
        memberId,
        roleId: inv.roleId,
        eventId: inv.eventId,
        grantedBy: inv.invitedBy,
      })
      .onConflictDoNothing();

    await tx
      .update(schema.organizationInvitations)
      .set({ status: "accepted", acceptedAt: new Date(), acceptedBy: actor.userId })
      .where(eq(schema.organizationInvitations.id, inv.id));

    await recordAudit(tx, actor, {
      organizationId: inv.organizationId,
      action: "invitation.accepted",
      targetType: "organization_invitation",
      targetId: inv.id,
      metadata: { memberId },
    });

    return { organizationId: inv.organizationId, organizationSlug: found.organizationSlug };
  });
}
