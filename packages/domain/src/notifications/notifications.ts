import type { Permission } from "@kroov/auth/catalogue";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, UnauthenticatedError, ValidationError } from "../kernel";

/**
 * Internal (in-app) notifications. Produced by the outbox consumer (worker) for the members
 * holding the relevant permission; each member reads and marks only their own rows.
 */

export const NOTIFICATION_KINDS = [
  "volunteer_application.submitted",
  "schedule.unavailability_reported",
  "campaign.finished",
  "order.refunded",
  "membership.activated",
  "event.published",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, { label: string; description: string }> = {
  "volunteer_application.submitted": {
    label: "Candidature bénévole reçue",
    description: "Une personne a candidaté sur un événement que vous pouvez examiner.",
  },
  "schedule.unavailability_reported": {
    label: "Indisponibilité signalée",
    description: "Un·e bénévole affecté·e ne peut plus assurer son créneau.",
  },
  "campaign.finished": {
    label: "Campagne terminée",
    description: "L'envoi d'une campagne est terminé (ou a échoué).",
  },
  "order.refunded": { label: "Commande remboursée", description: "Un remboursement a été effectué." },
  "membership.activated": {
    label: "Adhésion activée (formule avec revue)",
    description: "Une adhésion d'une formule soumise à validation est devenue active.",
  },
  "event.published": { label: "Événement publié", description: "Un événement de l'organisation vient d'être publié." },
};

export interface NotificationView {
  id: string;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPreferenceView {
  kind: NotificationKind;
  label: string;
  description: string;
  inApp: boolean;
}

function requireUser(actor: Actor): string {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  return actor.userId;
}

async function requireMember(db: DbExecutor, actor: Actor, organizationId: string): Promise<string> {
  const userId = requireUser(actor);
  // Any active member of the organization holds organization.read (or is a scanner): membership is what matters.
  const m = (
    await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, userId),
          eq(schema.organizationMembers.status, "active"),
        ),
      )
      .limit(1)
  )[0];
  if (!m) {
    // Reuse the standard deny-by-default error path.
    await requirePermission(db, actor, "organization.read", { organizationId });
  }
  return userId;
}

/* ------------------------------------------------------------------------- */
/* recipients                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Active members holding `permission` at the organization scope or, when `eventId` is given,
 * at that event's scope. Returns distinct user ids.
 */
export async function recipientsByPermission(
  db: DbExecutor,
  organizationId: string,
  permission: Permission,
  eventId?: string | null,
): Promise<string[]> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select distinct m.user_id
    from organization_members m
    join member_role_assignments a on a.member_id = m.id and a.organization_id = m.organization_id
    join roles r on r.id = a.role_id
    join role_permissions rp on rp.role_id = r.id
    join permissions p on p.id = rp.permission_id
    where m.organization_id = ${organizationId}
      and m.status = 'active'
      and p.key = ${permission}
      and (a.event_id is null ${eventId ? sql`or a.event_id = ${eventId}` : sql``})
  `);
  return rows.rows.map((r) => r.user_id);
}

/**
 * Insert one notification per recipient (idempotent on dedupeKey), honouring the in-app
 * preference. Returns the number of rows actually inserted.
 */
export async function notify(
  db: DbExecutor,
  input: {
    organizationId: string;
    userIds: readonly string[];
    kind: NotificationKind;
    title: string;
    body?: string | null;
    href?: string | null;
    dedupeKey: string;
    excludeUserId?: string | null;
  },
): Promise<number> {
  const candidates = [...new Set(input.userIds)].filter((u) => u !== input.excludeUserId);
  if (candidates.length === 0) return 0;
  const optedOut = await db
    .select({ userId: schema.notificationPreferences.userId })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.organizationId, input.organizationId),
        eq(schema.notificationPreferences.kind, input.kind),
        eq(schema.notificationPreferences.inApp, false),
        inArray(schema.notificationPreferences.userId, candidates),
      ),
    );
  const skip = new Set(optedOut.map((r) => r.userId));
  const targets = candidates.filter((u) => !skip.has(u));
  if (targets.length === 0) return 0;
  const inserted = await db
    .insert(schema.notifications)
    .values(
      targets.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        href: input.href ?? null,
        dedupeKey: input.dedupeKey,
      })),
    )
    .onConflictDoNothing({
      target: [schema.notifications.organizationId, schema.notifications.userId, schema.notifications.dedupeKey],
    })
    .returning({ id: schema.notifications.id });
  return inserted.length;
}

/* ------------------------------------------------------------------------- */
/* member-facing                                                              */
/* ------------------------------------------------------------------------- */

export const listNotificationsSchema = z.object({
  unread: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listNotifications(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: z.input<typeof listNotificationsSchema> = {},
): Promise<{ items: NotificationView[]; unreadCount: number }> {
  const userId = await requireMember(db, actor, organizationId);
  const parsed = listNotificationsSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  const f = parsed.data;
  const conds = [eq(schema.notifications.organizationId, organizationId), eq(schema.notifications.userId, userId)];
  if (f.unread) conds.push(isNull(schema.notifications.readAt));
  const [rows, unread] = await Promise.all([
    db
      .select()
      .from(schema.notifications)
      .where(and(...conds))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(f.limit),
    unreadCount(db, actor, organizationId),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      readAt: r.readAt,
      createdAt: r.createdAt,
    })),
    unreadCount: unread,
  };
}

export async function unreadCount(db: Database, actor: Actor, organizationId: string): Promise<number> {
  if (actor.kind !== "user") return 0;
  const row = (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.organizationId, organizationId),
          eq(schema.notifications.userId, actor.userId),
          isNull(schema.notifications.readAt),
        ),
      )
  )[0];
  return row?.n ?? 0;
}

export const markReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
]);

/** Marks the caller's own notifications as read. Rows of other members are never touched. */
export async function markRead(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: unknown,
): Promise<{ updated: number }> {
  const userId = await requireMember(db, actor, organizationId);
  const parsed = markReadSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const conds = [
    eq(schema.notifications.organizationId, organizationId),
    eq(schema.notifications.userId, userId),
    isNull(schema.notifications.readAt),
  ];
  if ("ids" in v) conds.push(inArray(schema.notifications.id, v.ids));
  const rows = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(...conds))
    .returning({ id: schema.notifications.id });
  return { updated: rows.length };
}

export async function getPreferences(
  db: Database,
  actor: Actor,
  organizationId: string,
): Promise<NotificationPreferenceView[]> {
  const userId = await requireMember(db, actor, organizationId);
  const rows = await db
    .select({ kind: schema.notificationPreferences.kind, inApp: schema.notificationPreferences.inApp })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.organizationId, organizationId),
        eq(schema.notificationPreferences.userId, userId),
      ),
    );
  const map = new Map(rows.map((r) => [r.kind, r.inApp]));
  return NOTIFICATION_KINDS.map((kind) => ({
    kind,
    label: NOTIFICATION_KIND_LABELS[kind].label,
    description: NOTIFICATION_KIND_LABELS[kind].description,
    inApp: map.get(kind) ?? true,
  }));
}

export const setPreferencesSchema = z.object({
  preferences: z.array(z.object({ kind: z.enum(NOTIFICATION_KINDS), inApp: z.boolean() })).min(1),
});

export async function setPreferences(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: unknown,
): Promise<NotificationPreferenceView[]> {
  const userId = await requireMember(db, actor, organizationId);
  const parsed = setPreferencesSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
  await db.transaction(async (tx) => {
    for (const p of parsed.data.preferences) {
      await tx
        .insert(schema.notificationPreferences)
        .values({ organizationId, userId, kind: p.kind, inApp: p.inApp })
        .onConflictDoUpdate({
          target: [
            schema.notificationPreferences.organizationId,
            schema.notificationPreferences.userId,
            schema.notificationPreferences.kind,
          ],
          set: { inApp: p.inApp, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "notification_preferences.updated",
      targetType: "user",
      targetId: userId,
      metadata: { preferences: parsed.data.preferences },
    });
  });
  return getPreferences(db, actor, organizationId);
}

/** Account deletion (phase 10): a deleted member keeps no notification nor preference. */
export async function anonymiseNotifications(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  await db.delete(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
}
