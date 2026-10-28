import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { anonymiseContacts } from "../crm/contacts";
import { anonymiseUserIdentity, replacementEmailFor } from "../identity";
import { type Actor, NotFoundError, PreconditionFailedError, UnauthenticatedError, ValidationError } from "../kernel";
import { anonymiseMemberships } from "../memberships/memberships";
import { anonymiseNotifications } from "../notifications/notifications";
import { anonymiseOrders } from "../ticketing/orders";
import { anonymiseVolunteerApplications } from "../volunteers/applications";

/**
 * privacy module (phase 10): the person's own data — export (portability) and account deletion
 * (anonymisation). Only the signed-in person can act on their own account. Cross-module by
 * nature: every owner module exposes its own `anonymise*` command, this module only orchestrates.
 */

function requireUser(actor: Actor): string {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  return actor.userId;
}

async function loadUser(db: DbExecutor, userId: string) {
  const u = (await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  if (!u || u.deletedAt) throw new NotFoundError("user", userId);
  return u;
}

export interface PersonalDataExport {
  exportedAt: string;
  profile: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    locale: string;
    timezone: string;
    phone: string | null;
    createdAt: string;
  };
  organizations: Array<{ id: string; name: string; slug: string; status: string; joinedAt: string; roles: string[] }>;
  memberships: Array<{
    id: string;
    organization: string;
    plan: string;
    number: string;
    status: string;
    validFrom: string | null;
    validUntil: string | null;
  }>;
  orders: Array<{
    id: string;
    number: string;
    organization: string;
    event: string;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt: string;
    tickets: Array<{ number: string; attendeeName: string | null; status: string }>;
  }>;
  volunteerApplications: Array<{
    id: string;
    number: string;
    organization: string;
    event: string;
    status: string;
    createdAt: string;
  }>;
  notifications: Array<{ kind: string; title: string; body: string | null; createdAt: string; readAt: string | null }>;
  notificationPreferences: Array<{ organization: string; kind: string; inApp: boolean }>;
  auditTrail: Array<{
    action: string;
    targetType: string;
    targetId: string | null;
    organization: string | null;
    createdAt: string;
  }>;
  retentionNote: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function exportPersonalData(db: Database, actor: Actor): Promise<PersonalDataExport> {
  const userId = requireUser(actor);
  const u = await loadUser(db, userId);
  const profile = (
    await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId)).limit(1)
  )[0];
  const email = u.email.toLowerCase();

  const orgs = await db.execute<{
    id: string;
    name: string;
    slug: string;
    status: string;
    joined_at: Date;
    roles: string[];
  }>(sql`
    select o.id, o.name, o.slug, m.status, m.joined_at,
      coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}') as roles
    from organization_members m
    join organizations o on o.id = m.organization_id
    left join member_role_assignments a on a.member_id = m.id
    left join roles r on r.id = a.role_id
    where m.user_id = ${userId}
    group by o.id, o.name, o.slug, m.status, m.joined_at
    order by m.joined_at
  `);
  const memberships = await db.execute<{
    id: string;
    organization: string;
    plan: string;
    number: string;
    status: string;
    valid_from: Date | null;
    valid_until: Date | null;
  }>(sql`
    select ms.id, o.name as organization, p.name as plan, ms.number, ms.status, ms.valid_from, ms.valid_until
    from memberships ms join organizations o on o.id = ms.organization_id join membership_plans p on p.id = ms.plan_id
    where ms.user_id = ${userId} or ms.member_email = ${email}
    order by ms.created_at
  `);
  const orders = await db.execute<{
    id: string;
    number: string;
    organization: string;
    event: string;
    status: string;
    total_minor: number;
    currency: string;
    created_at: Date;
    tickets: Array<{ number: string; attendeeName: string | null; status: string }>;
  }>(sql`
    select o.id, o.number, org.name as organization, e.title as event, o.status, o.total_minor, o.currency, o.created_at,
      coalesce(json_agg(json_build_object('number', t.number, 'attendeeName', t.attendee_name, 'status', t.status) order by t.number) filter (where t.id is not null), '[]') as tickets
    from orders o join organizations org on org.id = o.organization_id join events e on e.id = o.event_id
    left join tickets t on t.order_id = o.id
    where o.user_id = ${userId} or o.buyer_email = ${email}
    group by o.id, org.name, e.title
    order by o.created_at
  `);
  const applications = await db.execute<{
    id: string;
    number: string;
    organization: string;
    event: string;
    status: string;
    created_at: Date;
  }>(sql`
    select a.id, a.number, org.name as organization, e.title as event, a.status, a.created_at
    from volunteer_applications a join organizations org on org.id = a.organization_id join events e on e.id = a.event_id
    where a.user_id = ${userId} or a.email = ${email}
    order by a.created_at
  `);
  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(500);
  const prefs = await db.execute<{ organization: string; kind: string; in_app: boolean }>(sql`
    select o.name as organization, p.kind, p.in_app from notification_preferences p join organizations o on o.id = p.organization_id
    where p.user_id = ${userId} order by o.name, p.kind
  `);
  const audit = await db.execute<{
    action: string;
    target_type: string;
    target_id: string | null;
    organization: string | null;
    created_at: Date;
  }>(sql`
    select l.action, l.target_type, l.target_id, o.name as organization, l.created_at
    from audit_logs l left join organizations o on o.id = l.organization_id
    where l.actor_kind = 'user' and l.actor_id = ${userId}
    order by l.created_at desc limit 1000
  `);
  await recordAudit(db, actor, {
    organizationId: null,
    action: "privacy.exported",
    targetType: "user",
    targetId: userId,
    metadata: {
      orders: orders.rows.length,
      memberships: memberships.rows.length,
      applications: applications.rows.length,
    },
  });
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      locale: profile?.locale ?? "fr-FR",
      timezone: profile?.timezone ?? "Europe/Paris",
      phone: profile?.phone ?? null,
      createdAt: u.createdAt.toISOString(),
    },
    organizations: orgs.rows.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      joinedAt: new Date(o.joined_at).toISOString(),
      roles: o.roles,
    })),
    memberships: memberships.rows.map((m) => ({
      id: m.id,
      organization: m.organization,
      plan: m.plan,
      number: m.number,
      status: m.status,
      validFrom: iso(m.valid_from ? new Date(m.valid_from) : null),
      validUntil: iso(m.valid_until ? new Date(m.valid_until) : null),
    })),
    orders: orders.rows.map((o) => ({
      id: o.id,
      number: o.number,
      organization: o.organization,
      event: o.event,
      status: o.status,
      totalMinor: Number(o.total_minor),
      currency: o.currency.trim(),
      createdAt: new Date(o.created_at).toISOString(),
      tickets: o.tickets,
    })),
    volunteerApplications: applications.rows.map((a) => ({
      id: a.id,
      number: a.number,
      organization: a.organization,
      event: a.event,
      status: a.status,
      createdAt: new Date(a.created_at).toISOString(),
    })),
    notifications: notifications.map((n) => ({
      kind: n.kind,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      readAt: iso(n.readAt),
    })),
    notificationPreferences: prefs.rows.map((p) => ({ organization: p.organization, kind: p.kind, inApp: p.in_app })),
    auditTrail: audit.rows.map((l) => ({
      action: l.action,
      targetType: l.target_type,
      targetId: l.target_id,
      organization: l.organization,
      createdAt: new Date(l.created_at).toISOString(),
    })),
    retentionNote:
      "Les commandes, billets et écritures comptables sont conservés après suppression du compte (obligation légale), détachés de votre identité : adresse technique, sans nom ni compte. Les noms de participants figurant sur des billets déjà émis sont conservés (titre d'admission nominatif).",
  };
}

export const deleteAccountSchema = z.object({ confirmEmail: z.string().trim().toLowerCase().email() });

export interface DeleteAccountResult {
  deleted: true;
  anonymised: {
    memberships: number;
    orders: number;
    volunteerApplications: number;
    contacts: number;
    organizationsLeft: number;
  };
}

/**
 * Deletes the signed-in person's account by anonymisation. Refused (412 `last_owner`) while the
 * person is the only owner of an organization: they must transfer ownership or delete it first.
 * Everything happens in one transaction and is audited (opaque user id only).
 */
export async function deleteAccount(db: Database, actor: Actor, rawInput: unknown): Promise<DeleteAccountResult> {
  const userId = requireUser(actor);
  const parsed = deleteAccountSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  return db.transaction(async (tx) => {
    const u = await loadUser(tx, userId);
    const email = u.email.toLowerCase();
    if (parsed.data.confirmEmail !== email) {
      throw new ValidationError({ confirmEmail: ["Saisissez l'adresse e-mail exacte de votre compte."] });
    }
    // Last-owner rule: organizations where this user is the only active owner.
    const lastOwner = await tx.execute<{ id: string; name: string; slug: string }>(sql`
      select o.id, o.name, o.slug
      from organizations o
      join organization_members m on m.organization_id = o.id and m.user_id = ${userId} and m.status = 'active'
      join member_role_assignments a on a.member_id = m.id and a.event_id is null
      join roles r on r.id = a.role_id and r.key = 'owner'
      where (
        select count(distinct m2.id) from organization_members m2
        join member_role_assignments a2 on a2.member_id = m2.id and a2.event_id is null
        join roles r2 on r2.id = a2.role_id and r2.key = 'owner'
        where m2.organization_id = o.id and m2.status = 'active'
      ) = 1
      for update of o
    `);
    if (lastOwner.rows.length > 0) {
      throw new PreconditionFailedError(
        "Vous êtes la dernière personne propriétaire d'une organisation : transférez la propriété ou supprimez l'organisation avant de supprimer votre compte.",
        { code: "last_owner", organizations: lastOwner.rows },
      );
    }
    const organizationsLeft = (
      await tx
        .select({ id: schema.organizationMembers.id })
        .from(schema.organizationMembers)
        .where(and(eq(schema.organizationMembers.userId, userId), eq(schema.organizationMembers.status, "active")))
    ).length;
    const target = { userId, email, replacementEmail: replacementEmailFor(userId) };
    const memberships = await anonymiseMemberships(tx, target);
    const orders = await anonymiseOrders(tx, target);
    const volunteerApplications = await anonymiseVolunteerApplications(tx, target);
    const contacts = await anonymiseContacts(tx, target);
    await anonymiseNotifications(tx, userId);
    await tx.update(schema.tasks).set({ createdBy: null }).where(eq(schema.tasks.createdBy, userId));
    await tx.update(schema.tasks).set({ completedBy: null }).where(eq(schema.tasks.completedBy, userId));
    await anonymiseUserIdentity(tx, target);
    await recordAudit(tx, actor, {
      organizationId: null,
      action: "privacy.account_deleted",
      targetType: "user",
      targetId: userId,
      metadata: { memberships, orders, volunteerApplications, contacts, organizationsLeft },
    });
    return { deleted: true, anonymised: { memberships, orders, volunteerApplications, contacts, organizationsLeft } };
  });
}

/** Organizations where the person is currently the only active owner (blocks deletion; shown in the UI). */
export async function lastOwnerOrganizations(
  db: DbExecutor,
  actor: Actor,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const userId = requireUser(actor);
  const r = await db.execute<{ id: string; name: string; slug: string }>(sql`
    select o.id, o.name, o.slug
    from organizations o
    join organization_members m on m.organization_id = o.id and m.user_id = ${userId} and m.status = 'active'
    join member_role_assignments a on a.member_id = m.id and a.event_id is null
    join roles r on r.id = a.role_id and r.key = 'owner'
    where (
      select count(distinct m2.id) from organization_members m2
      join member_role_assignments a2 on a2.member_id = m2.id and a2.event_id is null
      join roles r2 on r2.id = a2.role_id and r2.key = 'owner'
      where m2.organization_id = o.id and m2.status = 'active'
    ) = 1
    order by o.name
  `);
  return r.rows;
}
