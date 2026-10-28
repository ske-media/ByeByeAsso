import type { Permission } from "@kroov/auth/catalogue";
import type { Database, DbExecutor } from "@kroov/database";
import { sql } from "drizzle-orm";
import { ensureSystemTask } from "../tasks/tasks";
import { type NotificationKind, notify, recipientsByPermission } from "./notifications";

/**
 * Domain-event consumer (phase 9): the worker drains the `domain.events` queue and calls
 * `handleDomainEvent` for every relayed outbox row. Handlers are idempotent (dedupe keys,
 * system task source keys) so pg-boss retries never produce duplicates.
 */
export interface DomainEventMessage {
  outboxId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string | null;
  payload: Record<string, unknown> | null;
}

export interface DomainEventOutcome {
  handled: boolean;
  notified: number;
  tasksCreated: number;
}

type Handler = (db: DbExecutor, msg: DomainEventMessage & { organizationId: string }) => Promise<DomainEventOutcome>;

const fmtDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

async function orgSlug(db: DbExecutor, organizationId: string): Promise<string | null> {
  const r = await db.execute<{ slug: string }>(sql`select slug from organizations where id = ${organizationId}`);
  return r.rows[0]?.slug ?? null;
}

async function eventInfo(db: DbExecutor, eventId: string): Promise<{ title: string; slug: string } | null> {
  const r = await db.execute<{ title: string; slug: string }>(
    sql`select title, slug from events where id = ${eventId}`,
  );
  return r.rows[0] ?? null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

const outcome = (notified: number, tasksCreated = 0): DomainEventOutcome => ({ handled: true, notified, tasksCreated });

/** Routing table (documentation + unit-tested): event type → permission whose holders are notified. */
export const EVENT_ROUTING = {
  "volunteer_application.submitted": { permission: "volunteers.review", eventScoped: true },
  "schedule.unavailability_reported": { permission: "volunteers.schedule", eventScoped: true, systemTask: true },
  "campaign.finished": { permission: "campaigns.manage", eventScoped: false },
  "order.refunded": { permission: "orders.refund", eventScoped: true },
  "membership.activated": { permission: "memberships.manage", eventScoped: false, onlyWhen: "plan.requires_review" },
  "event.published": { permission: "events.read", eventScoped: true, excludesActor: true },
} as const satisfies Record<
  NotificationKind,
  { permission: Permission; eventScoped: boolean; systemTask?: boolean; onlyWhen?: string; excludesActor?: boolean }
>;

const handlers: Record<string, Handler> = {
  "volunteer_application.submitted": async (db, msg) => {
    const app = (
      await db.execute<{ first_name: string; last_name: string; event_id: string; number: string }>(
        sql`select first_name, last_name, event_id, number from volunteer_applications where id = ${msg.aggregateId}`,
      )
    ).rows[0];
    if (!app) return { handled: true, notified: 0, tasksCreated: 0 };
    const [slug, ev, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      eventInfo(db, app.event_id),
      recipientsByPermission(db, msg.organizationId, "volunteers.review", app.event_id),
    ]);
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "volunteer_application.submitted",
      title: `Nouvelle candidature : ${app.first_name} ${app.last_name}`,
      body: ev ? `Candidature ${app.number} reçue pour « ${ev.title} ».` : `Candidature ${app.number} reçue.`,
      href: slug && ev ? `/o/${slug}/evenements/${ev.slug}/benevoles` : null,
      dedupeKey: `volunteer_application.submitted:${msg.aggregateId}`,
    });
    return outcome(n);
  },

  "schedule.unavailability_reported": async (db, msg) => {
    const row = (
      await db.execute<{
        event_id: string;
        shift_label: string | null;
        starts_at: Date;
        position: string;
        first_name: string;
        last_name: string;
      }>(sql`
        select a.event_id, s.label as shift_label, s.starts_at, p.name as position, va.first_name, va.last_name
        from volunteer_assignments a
        join volunteer_shifts s on s.id = a.shift_id
        join event_volunteer_positions ep on ep.id = s.event_position_id
        join volunteer_positions p on p.id = ep.position_id
        join volunteer_applications va on va.id = a.application_id
        where a.id = ${msg.aggregateId}
      `)
    ).rows[0];
    if (!row) return { handled: true, notified: 0, tasksCreated: 0 };
    const [slug, ev, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      eventInfo(db, row.event_id),
      recipientsByPermission(db, msg.organizationId, "volunteers.schedule", row.event_id),
    ]);
    const when = fmtDate.format(new Date(row.starts_at));
    const shift = `${row.position}${row.shift_label ? ` · ${row.shift_label}` : ""} (${when})`;
    const href = slug && ev ? `/o/${slug}/evenements/${ev.slug}/planning` : null;
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "schedule.unavailability_reported",
      title: `Indisponibilité : ${row.first_name} ${row.last_name}`,
      body: `${row.first_name} ne peut plus assurer ${shift}. Un remplacement est à prévoir.`,
      href,
      dedupeKey: `schedule.unavailability_reported:${msg.aggregateId}`,
    });
    const task = await ensureSystemTask(db, msg.organizationId, {
      sourceKey: `unavailability:${msg.aggregateId}`,
      title: `Remplacer ${row.first_name} ${row.last_name} sur ${row.position}`,
      description: `Indisponibilité signalée pour le créneau ${shift}${ev ? ` — ${ev.title}` : ""}. Réaffectez le créneau depuis le planning.`,
      priority: "high",
      dueAt: new Date(row.starts_at),
      eventId: row.event_id,
    });
    return outcome(n, task.created ? 1 : 0);
  },

  "campaign.finished": async (db, msg) => {
    const c = (
      await db.execute<{ name: string; status: string; sent_count: number; failed_count: number }>(
        sql`select name, status, sent_count, failed_count from campaigns where id = ${msg.aggregateId}`,
      )
    ).rows[0];
    if (!c) return { handled: true, notified: 0, tasksCreated: 0 };
    const [slug, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      recipientsByPermission(db, msg.organizationId, "campaigns.manage"),
    ]);
    const status =
      c.status === "sent" ? "envoyée" : c.status === "partially_failed" ? "partiellement envoyée" : "en échec";
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "campaign.finished",
      title: `Campagne ${status} : ${c.name}`,
      body: `${c.sent_count} envoyé(s), ${c.failed_count} échec(s).`,
      href: slug ? `/o/${slug}/marketing/${msg.aggregateId}` : null,
      dedupeKey: `campaign.finished:${msg.aggregateId}`,
    });
    return outcome(n);
  },

  "order.refunded": async (db, msg) => {
    const o = (
      await db.execute<{ number: string; event_id: string; currency: string }>(
        sql`select number, event_id, currency from orders where id = ${msg.aggregateId}`,
      )
    ).rows[0];
    if (!o) return { handled: true, notified: 0, tasksCreated: 0 };
    const [slug, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      recipientsByPermission(db, msg.organizationId, "orders.refund", o.event_id),
    ]);
    const amount = typeof msg.payload?.amountMinor === "number" ? msg.payload.amountMinor : null;
    const refundId = str(msg.payload?.refundId) ?? msg.aggregateId;
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "order.refunded",
      title: `Remboursement effectué : commande ${o.number}`,
      body:
        amount !== null
          ? `${(amount / 100).toLocaleString("fr-FR", { style: "currency", currency: o.currency })} remboursé(s).`
          : "Remboursement effectué.",
      href: slug ? `/o/${slug}/billetterie/commandes/${msg.aggregateId}` : null,
      dedupeKey: `order.refunded:${refundId}`,
    });
    return outcome(n);
  },

  "membership.activated": async (db, msg) => {
    const m = (
      await db.execute<{
        number: string;
        member_first_name: string;
        member_last_name: string;
        requires_review: boolean;
        plan_name: string;
      }>(sql`
        select m.number, m.member_first_name, m.member_last_name, p.requires_review, p.name as plan_name
        from memberships m join membership_plans p on p.id = m.plan_id
        where m.id = ${msg.aggregateId}
      `)
    ).rows[0];
    // Only plans that required a review are worth a notification (the others are self-service).
    if (!m?.requires_review) return { handled: true, notified: 0, tasksCreated: 0 };
    const [slug, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      recipientsByPermission(db, msg.organizationId, "memberships.manage"),
    ]);
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "membership.activated",
      title: `Adhésion activée : ${m.member_first_name} ${m.member_last_name}`,
      body: `Formule « ${m.plan_name} » (${m.number}).`,
      href: slug ? `/o/${slug}/adhesions/${msg.aggregateId}` : null,
      dedupeKey: `membership.activated:${msg.aggregateId}`,
    });
    return outcome(n);
  },

  "event.published": async (db, msg) => {
    const ev = await eventInfo(db, msg.aggregateId);
    if (!ev) return { handled: true, notified: 0, tasksCreated: 0 };
    const publishedBy = (
      await db.execute<{ actor_id: string | null }>(sql`
        select actor_id from audit_logs
        where organization_id = ${msg.organizationId} and target_type = 'event' and target_id = ${msg.aggregateId}
          and action = 'event.published'
        order by created_at desc limit 1
      `)
    ).rows[0]?.actor_id;
    const [slug, users] = await Promise.all([
      orgSlug(db, msg.organizationId),
      recipientsByPermission(db, msg.organizationId, "events.read", msg.aggregateId),
    ]);
    const n = await notify(db, {
      organizationId: msg.organizationId,
      userIds: users,
      kind: "event.published",
      title: `Événement publié : ${ev.title}`,
      body: "La page publique et la billetterie sont désormais visibles.",
      href: slug ? `/o/${slug}/evenements/${ev.slug}` : null,
      dedupeKey: `event.published:${msg.aggregateId}`,
      excludeUserId: publishedBy ?? null,
    });
    return outcome(n);
  },
};

export const HANDLED_EVENT_TYPES = Object.keys(handlers) as NotificationKind[];

export async function handleDomainEvent(db: Database, msg: DomainEventMessage): Promise<DomainEventOutcome> {
  const handler = handlers[msg.eventType];
  if (!handler || !msg.organizationId) return { handled: false, notified: 0, tasksCreated: 0 };
  const organizationId = msg.organizationId;
  return db.transaction((tx) => handler(tx, { ...msg, organizationId }));
}
