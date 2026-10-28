import type { Database, DbExecutor } from "@kroov/database";
import { sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { contextHasPermission, loadMemberContext, requirePermission } from "../authorization";
import { csvEscape } from "../crm/identities";
import { type Actor, ForbiddenError, NotFoundError, UnauthenticatedError } from "../kernel";

/**
 * Dashboards computed from the authoritative records only (no counters, no fixtures):
 * ledger entries for money, orders/tickets/refunds/checkins, memberships, volunteer tables,
 * published schedule (active_volunteer_commitments), campaigns. Every money metric says where it
 * comes from and whether it is an estimate.
 */

export interface MoneyMetric {
  amountMinor: number;
  currency: string;
  /** Where the number comes from — shown next to the figure. */
  source: string;
  estimate?: boolean;
}

export interface OrganizationDashboard {
  period: { from: Date | null; to: Date | null };
  currency: string;
  events: { published: number; completed: number; drafts: number; cancelled: number };
  ticketing: {
    ticketsSold: number;
    ticketsUsed: number;
    paidOrders: number;
    refundedOrders: number;
    gross: MoneyMetric;
    refunds: MoneyMetric;
    platformFees: MoneyMetric;
    netEstimate: MoneyMetric;
    receivableFromProvider: MoneyMetric;
  };
  memberships: { active: number; pending: number; expiringIn30Days: number };
  volunteers: {
    applications: number;
    approved: number;
    rejected: number;
    approvalRate: number | null;
    publishedShiftsRequired: number;
    publishedShiftsCovered: number;
    coverageRate: number | null;
    unfilledShifts: number;
    attendancePresent: number;
    attendanceAbsent: number;
  };
  campaigns: {
    sent: number;
    delivered: number;
    bounced: number;
    unsubscribed: number;
    attributedPaidOrders: number;
    attributedRevenue: MoneyMetric;
  };
  contacts: { total: number; optedIn: number };
  checkins: { accepted: number; refused: number };
}

export interface EventDashboard {
  eventId: string;
  title: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  currency: string;
  ticketing: {
    ticketsSold: number;
    ticketsUsed: number;
    paidOrders: number;
    occupancyRate: number | null;
    gross: MoneyMetric;
    refunds: MoneyMetric;
    platformFees: MoneyMetric;
    netEstimate: MoneyMetric;
    byType: Array<{ name: string; sold: number; quota: number | null; grossMinor: number }>;
  };
  checkins: { accepted: number; alreadyUsed: number; refused: number; acceptanceRate: number | null };
  volunteers: {
    applications: number;
    approved: number;
    publishedVersion: string | null;
    shiftsRequired: number;
    shiftsCovered: number;
    coverageRate: number | null;
    unfilledShifts: Array<{ shiftId: string; label: string; positionName: string; missing: number; startsAt: Date }>;
    confirmedMissions: number;
    declinedMissions: number;
    attendance: { present: number; late: number; absent: number; excused: number };
  };
  campaigns: { attributedOrders: number; attributedPaidOrders: number; attributedRevenue: MoneyMetric };
}

const n = (v: unknown) => Number(v ?? 0);

async function ledgerFor(
  db: DbExecutor,
  organizationId: string,
  eventId: string | null,
  from: Date | null,
  to: Date | null,
) {
  // Signs: credit < 0 for revenue/fees; refunds post debits back. Net of refunds by construction.
  const r = await db.execute<{ kind: string; currency: string; balance: string }>(sql`
    select a.kind, a.currency, coalesce(sum(e.amount_minor), 0)::text as balance
    from ledger_entries e
    join ledger_accounts a on a.id = e.account_id
    join ledger_transactions t on t.id = e.transaction_id
    ${eventId ? sql`join orders o on o.id = t.order_id and o.event_id = ${eventId}` : sql``}
    where e.organization_id = ${organizationId}
      ${from ? sql`and t.occurred_at >= ${from}` : sql``}
      ${to ? sql`and t.occurred_at < ${to}` : sql``}
    group by a.kind, a.currency
  `);
  const bal: Record<string, number> = {};
  let currency = "EUR";
  for (const row of r.rows) {
    bal[row.kind] = n(row.balance);
    currency = row.currency;
  }
  return { bal, currency };
}

/** Pure: ledger balances (credit < 0) → displayed money metrics with their source. */
export function moneyBlock(bal: Record<string, number>, currency: string, refundsMinor: number) {
  // `|| 0` normalises -0 (an empty ledger must read exactly 0).
  const gross = -(bal.revenue_tickets ?? 0) || 0;
  const fees = -(bal.platform_fees ?? 0) || 0;
  return {
    gross: { amountMinor: gross, currency, source: "Grand livre · compte revenue_tickets (net des remboursements)" },
    refunds: { amountMinor: refundsMinor, currency, source: "Remboursements effectifs (statut succeeded)" },
    platformFees: {
      amountMinor: fees,
      currency,
      source: "Grand livre · compte platform_fees (net des remboursements)",
    },
    netEstimate: {
      amountMinor: gross,
      currency,
      source:
        "Estimation : brut net des remboursements, frais acheteur exclus ; hors frais du prestataire de paiement et versements",
      estimate: true,
    },
    receivableFromProvider: {
      amountMinor: bal.receivable_provider ?? 0,
      currency,
      source: "Grand livre · compte receivable_provider (encaissé par le prestataire, non encore versé)",
    },
  };
}

export async function organizationDashboard(
  db: Database,
  actor: Actor,
  organizationId: string,
  period: { from?: Date | null; to?: Date | null } = {},
): Promise<OrganizationDashboard> {
  await requirePermission(db, actor, "analytics.read", { organizationId });
  const from = period.from ?? null;
  const to = period.to ?? null;
  const inPeriod = (col: string) =>
    sql`${from ? sql`and ${sql.raw(col)} >= ${from}` : sql``} ${to ? sql`and ${sql.raw(col)} < ${to}` : sql``}`;
  const { bal, currency } = await ledgerFor(db, organizationId, null, from, to);
  const ev = (
    await db.execute<{ published: string; completed: string; drafts: string; cancelled: string }>(sql`
      select count(*) filter (where status = 'published')::text as published,
             count(*) filter (where status = 'completed')::text as completed,
             count(*) filter (where status = 'draft')::text as drafts,
             count(*) filter (where status = 'cancelled')::text as cancelled
      from events where organization_id = ${organizationId}
    `)
  ).rows[0];
  const tk = (
    await db.execute<{ sold: string; used: string; paid: string; refunded: string }>(sql`
      select count(*) filter (where t.status in ('valid','used'))::text as sold,
             count(*) filter (where t.status = 'used')::text as used,
             (select count(*) from orders o where o.organization_id = ${organizationId} and o.status in ('paid','partially_refunded') ${inPeriod("o.paid_at")})::text as paid,
             (select count(*) from orders o where o.organization_id = ${organizationId} and o.status in ('refunded','partially_refunded'))::text as refunded
      from tickets t join orders o on o.id = t.order_id
      where t.organization_id = ${organizationId} ${inPeriod("o.paid_at")}
    `)
  ).rows[0];
  const rf = (
    await db.execute<{ amount: string }>(sql`
      select coalesce(sum(amount_minor), 0)::text as amount from refunds
      where organization_id = ${organizationId} and status = 'succeeded' ${inPeriod("succeeded_at")}
    `)
  ).rows[0];
  const mb = (
    await db.execute<{ active: string; pending: string; expiring: string }>(sql`
      select count(*) filter (where status = 'active')::text as active,
             count(*) filter (where status in ('pending','awaiting_payment'))::text as pending,
             count(*) filter (where status = 'active' and valid_until < now() + interval '30 days')::text as expiring
      from memberships where organization_id = ${organizationId}
    `)
  ).rows[0];
  const vo = (
    await db.execute<{ applications: string; approved: string; rejected: string }>(sql`
      select count(*)::text as applications,
             count(*) filter (where status in ('approved','assigned','confirmed'))::text as approved,
             count(*) filter (where status = 'rejected')::text as rejected
      from volunteer_applications where organization_id = ${organizationId}
    `)
  ).rows[0];
  const cov = (
    await db.execute<{ required: string; covered: string; unfilled: string }>(sql`
      with published as (
        select s.id, s.required_count, (select count(*) from active_volunteer_commitments c where c.shift_id = s.id)::int as covered
        from volunteer_shifts s
        join schedule_versions v on v.event_id = s.event_id and v.status = 'published'
        where s.organization_id = ${organizationId} and s.status = 'active'
      )
      select coalesce(sum(required_count), 0)::text as required,
             coalesce(sum(least(covered, required_count)), 0)::text as covered,
             count(*) filter (where covered < required_count)::text as unfilled
      from published
    `)
  ).rows[0];
  const att = (
    await db.execute<{ present: string; absent: string }>(sql`
      select count(*) filter (where status in ('present','late'))::text as present,
             count(*) filter (where status = 'absent')::text as absent
      from volunteer_attendance where organization_id = ${organizationId}
    `)
  ).rows[0];
  const cp = (
    await db.execute<{
      sent: string;
      delivered: string;
      bounced: string;
      unsubscribed: string;
      paid: string;
      revenue: string;
    }>(sql`
      select (select count(*) from campaign_recipients r where r.organization_id = ${organizationId} and r.status in ('sent','bounced','unsubscribed'))::text as sent,
             (select count(*) from message_deliveries d where d.organization_id = ${organizationId} and d.kind = 'campaign' and d.status = 'delivered')::text as delivered,
             (select count(*) from message_deliveries d where d.organization_id = ${organizationId} and d.kind = 'campaign' and d.status in ('bounced','complained'))::text as bounced,
             (select count(*) from tracking_events e where e.organization_id = ${organizationId} and e.kind = 'unsubscribe')::text as unsubscribed,
             (select count(*) from orders o where o.organization_id = ${organizationId} and o.campaign_id is not null and o.status in ('paid','partially_refunded'))::text as paid,
             (select coalesce(sum(total_minor), 0) from orders o where o.organization_id = ${organizationId} and o.campaign_id is not null and o.status in ('paid','partially_refunded'))::text as revenue
    `)
  ).rows[0];
  const ct = (
    await db.execute<{ total: string; opted: string }>(sql`
      select count(*)::text as total, count(*) filter (where marketing_email_status = 'opted_in')::text as opted
      from contacts where organization_id = ${organizationId} and status = 'active'
    `)
  ).rows[0];
  const ck = (
    await db.execute<{ accepted: string; refused: string }>(sql`
      select count(*) filter (where result = 'accepted')::text as accepted,
             count(*) filter (where result <> 'accepted')::text as refused
      from checkins where organization_id = ${organizationId}
    `)
  ).rows[0];
  const applications = n(vo?.applications);
  const approved = n(vo?.approved);
  const required = n(cov?.required);
  const covered = n(cov?.covered);
  return {
    period: { from, to },
    currency,
    events: {
      published: n(ev?.published),
      completed: n(ev?.completed),
      drafts: n(ev?.drafts),
      cancelled: n(ev?.cancelled),
    },
    ticketing: {
      ticketsSold: n(tk?.sold),
      ticketsUsed: n(tk?.used),
      paidOrders: n(tk?.paid),
      refundedOrders: n(tk?.refunded),
      ...moneyBlock(bal, currency, n(rf?.amount)),
    },
    memberships: { active: n(mb?.active), pending: n(mb?.pending), expiringIn30Days: n(mb?.expiring) },
    volunteers: {
      applications,
      approved,
      rejected: n(vo?.rejected),
      approvalRate: applications > 0 ? approved / applications : null,
      publishedShiftsRequired: required,
      publishedShiftsCovered: covered,
      coverageRate: required > 0 ? covered / required : null,
      unfilledShifts: n(cov?.unfilled),
      attendancePresent: n(att?.present),
      attendanceAbsent: n(att?.absent),
    },
    campaigns: {
      sent: n(cp?.sent),
      delivered: n(cp?.delivered),
      bounced: n(cp?.bounced),
      unsubscribed: n(cp?.unsubscribed),
      attributedPaidOrders: n(cp?.paid),
      attributedRevenue: {
        amountMinor: n(cp?.revenue),
        currency,
        source: "Commandes payées rattachées à une campagne (attribution par lien, incomplète par construction)",
      },
    },
    contacts: { total: n(ct?.total), optedIn: n(ct?.opted) },
    checkins: { accepted: n(ck?.accepted), refused: n(ck?.refused) },
  };
}

export async function eventDashboard(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<EventDashboard> {
  // analytics.read organization-wide, or event-scoped reader (events.read on that event).
  if (actor.kind === "anonymous") throw new UnauthenticatedError();
  if (actor.kind === "user") {
    const ctx = await loadMemberContext(db, actor.userId, organizationId);
    if (!ctx) throw new ForbiddenError("analytics.read");
    const ok =
      contextHasPermission(ctx, "analytics.read", { organizationId }) ||
      contextHasPermission(ctx, "events.read", { organizationId, eventId });
    if (!ok) throw new ForbiddenError("analytics.read");
  }
  const ev = (
    await db.execute<{ id: string; title: string; status: string; starts_at: Date; ends_at: Date; capacity: number }>(
      sql`select id, title, status, starts_at, ends_at, capacity from events where id = ${eventId} and organization_id = ${organizationId}`,
    )
  ).rows[0];
  if (!ev) throw new NotFoundError("event", eventId);
  const { bal, currency } = await ledgerFor(db, organizationId, eventId, null, null);
  const tk = (
    await db.execute<{ sold: string; used: string; paid: string }>(sql`
      select count(*) filter (where status in ('valid','used'))::text as sold,
             count(*) filter (where status = 'used')::text as used,
             (select count(*) from orders o where o.event_id = ${eventId} and o.status in ('paid','partially_refunded'))::text as paid
      from tickets where event_id = ${eventId}
    `)
  ).rows[0];
  const rf = (
    await db.execute<{ amount: string }>(sql`
      select coalesce(sum(r.amount_minor), 0)::text as amount from refunds r join orders o on o.id = r.order_id
      where o.event_id = ${eventId} and r.status = 'succeeded'
    `)
  ).rows[0];
  const byType = (
    await db.execute<{ name: string; quota: number | null; sold: string; gross: string }>(sql`
      select tt.name, tt.quota,
             count(t.id) filter (where t.status in ('valid','used'))::text as sold,
             coalesce(sum(t.price_minor) filter (where t.status in ('valid','used')), 0)::text as gross
      from ticket_types tt left join tickets t on t.ticket_type_id = tt.id
      where tt.event_id = ${eventId}
      group by tt.id, tt.name, tt.quota, tt.position order by tt.position, tt.name
    `)
  ).rows;
  const ck = (
    await db.execute<{ accepted: string; already: string; refused: string }>(sql`
      select count(*) filter (where result = 'accepted')::text as accepted,
             count(*) filter (where result = 'already_used')::text as already,
             count(*) filter (where result not in ('accepted','already_used'))::text as refused
      from checkins where event_id = ${eventId}
    `)
  ).rows[0];
  const vo = (
    await db.execute<{ applications: string; approved: string }>(sql`
      select count(*)::text as applications,
             count(*) filter (where status in ('approved','assigned','confirmed'))::text as approved
      from volunteer_applications where event_id = ${eventId}
    `)
  ).rows[0];
  const version = (
    await db.execute<{ number: number }>(
      sql`select number from schedule_versions where event_id = ${eventId} and status = 'published' limit 1`,
    )
  ).rows[0];
  const shifts = (
    await db.execute<{
      id: string;
      label: string | null;
      position_name: string;
      required: number;
      starts_at: Date;
      covered: string;
    }>(sql`
      select s.id, s.label, p.name as position_name, s.required_count as required, s.starts_at,
             (select count(*) from active_volunteer_commitments c where c.shift_id = s.id)::text as covered
      from volunteer_shifts s
      join event_volunteer_positions ep on ep.id = s.event_position_id
      join volunteer_positions p on p.id = ep.position_id
      where s.event_id = ${eventId} and s.status = 'active'
      order by s.starts_at
    `)
  ).rows;
  const missions = (
    await db.execute<{ confirmed: string; declined: string }>(sql`
      select count(*) filter (where confirmation_status = 'confirmed')::text as confirmed,
             count(*) filter (where confirmation_status = 'declined')::text as declined
      from active_volunteer_commitments where event_id = ${eventId}
    `)
  ).rows[0];
  const att = (
    await db.execute<{ present: string; late: string; absent: string; excused: string }>(sql`
      select count(*) filter (where status = 'present')::text as present,
             count(*) filter (where status = 'late')::text as late,
             count(*) filter (where status = 'absent')::text as absent,
             count(*) filter (where status = 'excused')::text as excused
      from volunteer_attendance where event_id = ${eventId}
    `)
  ).rows[0];
  const cp = (
    await db.execute<{ total: string; paid: string; revenue: string }>(sql`
      select count(*) filter (where campaign_id is not null)::text as total,
             count(*) filter (where campaign_id is not null and status in ('paid','partially_refunded'))::text as paid,
             coalesce(sum(total_minor) filter (where campaign_id is not null and status in ('paid','partially_refunded')), 0)::text as revenue
      from orders where event_id = ${eventId}
    `)
  ).rows[0];
  const sold = n(tk?.sold);
  const required = version ? shifts.reduce((a, s) => a + s.required, 0) : 0;
  const covered = version ? shifts.reduce((a, s) => a + Math.min(n(s.covered), s.required), 0) : 0;
  const accepted = n(ck?.accepted);
  const scans = accepted + n(ck?.already) + n(ck?.refused);
  return {
    eventId: ev.id,
    title: ev.title,
    status: ev.status,
    startsAt: new Date(ev.starts_at),
    endsAt: new Date(ev.ends_at),
    capacity: ev.capacity,
    currency,
    ticketing: {
      ticketsSold: sold,
      ticketsUsed: n(tk?.used),
      paidOrders: n(tk?.paid),
      occupancyRate: ev.capacity > 0 ? sold / ev.capacity : null,
      ...moneyBlock(bal, currency, n(rf?.amount)),
      byType: byType.map((t) => ({ name: t.name, sold: n(t.sold), quota: t.quota, grossMinor: n(t.gross) })),
    },
    checkins: {
      accepted,
      alreadyUsed: n(ck?.already),
      refused: n(ck?.refused),
      acceptanceRate: scans > 0 ? accepted / scans : null,
    },
    volunteers: {
      applications: n(vo?.applications),
      approved: n(vo?.approved),
      publishedVersion: version ? `V${version.number}` : null,
      shiftsRequired: required,
      shiftsCovered: covered,
      coverageRate: required > 0 ? covered / required : null,
      unfilledShifts: version
        ? shifts
            .filter((s) => n(s.covered) < s.required)
            .map((s) => ({
              shiftId: s.id,
              label: s.label ?? "",
              positionName: s.position_name,
              missing: s.required - n(s.covered),
              startsAt: new Date(s.starts_at),
            }))
        : [],
      confirmedMissions: n(missions?.confirmed),
      declinedMissions: n(missions?.declined),
      attendance: { present: n(att?.present), late: n(att?.late), absent: n(att?.absent), excused: n(att?.excused) },
    },
    campaigns: {
      attributedOrders: n(cp?.total),
      attributedPaidOrders: n(cp?.paid),
      attributedRevenue: {
        amountMinor: n(cp?.revenue),
        currency,
        source: "Commandes payées rattachées à une campagne (attribution par lien, incomplète par construction)",
      },
    },
  };
}

/* ------------------------------------------------------------------------- */
/* finances (écran 22)                                                        */
/* ------------------------------------------------------------------------- */

export interface FinanceOverview {
  currency: string;
  balances: {
    gross: MoneyMetric;
    platformFees: MoneyMetric;
    refunds: MoneyMetric;
    netEstimate: MoneyMetric;
    receivableFromProvider: MoneyMetric;
  };
  byEvent: Array<{
    eventId: string;
    title: string;
    grossMinor: number;
    feesMinor: number;
    refundsMinor: number;
    paidOrders: number;
  }>;
  journal: Array<{
    id: string;
    occurredAt: Date;
    kind: string;
    reference: string | null;
    description: string | null;
    entries: Array<{ account: string; amountMinor: number }>;
  }>;
  documents: Array<{ id: string; kind: string; reference: string; issuedAt: Date }>;
  payouts: { available: false; note: string };
}

export async function financeOverview(
  db: Database,
  actor: Actor,
  organizationId: string,
  journalLimit = 50,
): Promise<FinanceOverview> {
  await requirePermission(db, actor, "analytics.read", { organizationId });
  const { bal, currency } = await ledgerFor(db, organizationId, null, null, null);
  const rf = (
    await db.execute<{ amount: string }>(
      sql`select coalesce(sum(amount_minor), 0)::text as amount from refunds where organization_id = ${organizationId} and status = 'succeeded'`,
    )
  ).rows[0];
  const byEvent = (
    await db.execute<{
      event_id: string;
      title: string;
      gross: string;
      fees: string;
      refunds: string;
      paid: string;
    }>(sql`
      select ev.id as event_id, ev.title,
        coalesce(-sum(e.amount_minor) filter (where a.kind = 'revenue_tickets'), 0)::text as gross,
        coalesce(-sum(e.amount_minor) filter (where a.kind = 'platform_fees'), 0)::text as fees,
        (select coalesce(sum(r.amount_minor), 0) from refunds r join orders o2 on o2.id = r.order_id where o2.event_id = ev.id and r.status = 'succeeded')::text as refunds,
        (select count(*) from orders o3 where o3.event_id = ev.id and o3.status in ('paid','partially_refunded'))::text as paid
      from events ev
      left join orders o on o.event_id = ev.id
      left join ledger_transactions t on t.order_id = o.id
      left join ledger_entries e on e.transaction_id = t.id
      left join ledger_accounts a on a.id = e.account_id
      where ev.organization_id = ${organizationId}
      group by ev.id, ev.title, ev.starts_at
      having count(o.id) > 0
      order by ev.starts_at desc
    `)
  ).rows;
  const journal = (
    await db.execute<{
      id: string;
      occurred_at: Date;
      kind: string;
      reference: string | null;
      description: string | null;
      entries: Array<{ account: string; amountMinor: number }>;
    }>(sql`
      select t.id, t.occurred_at, t.kind, t.reference, t.description,
        coalesce(json_agg(json_build_object('account', a.kind, 'amountMinor', e.amount_minor) order by e.amount_minor desc) filter (where e.id is not null), '[]') as entries
      from ledger_transactions t
      left join ledger_entries e on e.transaction_id = t.id
      left join ledger_accounts a on a.id = e.account_id
      where t.organization_id = ${organizationId}
      group by t.id order by t.occurred_at desc limit ${journalLimit}
    `)
  ).rows;
  const documents = (
    await db.execute<{ id: string; kind: string; reference: string; issued_at: Date }>(sql`
      select id, kind, reference, issued_at from financial_documents where organization_id = ${organizationId} order by issued_at desc limit 50
    `)
  ).rows;
  const money = moneyBlock(bal, currency, n(rf?.amount));
  return {
    currency,
    balances: money,
    byEvent: byEvent.map((r) => ({
      eventId: r.event_id,
      title: r.title,
      grossMinor: n(r.gross),
      feesMinor: n(r.fees),
      refundsMinor: n(r.refunds),
      paidOrders: n(r.paid),
    })),
    journal: journal.map((j) => ({
      id: j.id,
      occurredAt: new Date(j.occurred_at),
      kind: j.kind,
      reference: j.reference,
      description: j.description,
      entries: j.entries,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      reference: d.reference,
      issuedAt: new Date(d.issued_at),
    })),
    payouts: {
      available: false,
      note: "Les versements sont effectués par le prestataire de paiement (Stripe Connect) selon son calendrier ; Kroov n'en reçoit pas encore le détail. Le solde « encaissé par le prestataire » ci-dessus est ce qui a été payé par les acheteurs, net des remboursements.",
    },
  };
}

/* ------------------------------------------------------------------------- */
/* exports (CSV, UTF-8 BOM, `;`)                                              */
/* ------------------------------------------------------------------------- */

const csvDoc = (header: string[], lines: string[][]) =>
  `﻿${[header.join(";"), ...lines.map((l) => l.map(csvEscape).join(";"))].join("\r\n")}\r\n`;

const money = (minor: number) => (minor / 100).toFixed(2);

/** Financial journal: one line per ledger entry (transaction, account, D/C, amount). Audited. */
export async function exportFinanceJournalCsv(
  db: Database,
  actor: Actor,
  organizationId: string,
): Promise<{ csv: string; filename: string; count: number }> {
  await requirePermission(db, actor, "analytics.read", { organizationId });
  const rows = (
    await db.execute<{
      occurred_at: Date;
      kind: string;
      reference: string | null;
      description: string | null;
      order_number: string | null;
      event_title: string | null;
      account: string;
      currency: string;
      amount_minor: number;
    }>(sql`
      select t.occurred_at, t.kind, t.reference, t.description, o.number as order_number, ev.title as event_title,
        a.kind as account, a.currency, e.amount_minor
      from ledger_transactions t
      join ledger_entries e on e.transaction_id = t.id
      join ledger_accounts a on a.id = e.account_id
      left join orders o on o.id = t.order_id
      left join events ev on ev.id = o.event_id
      where t.organization_id = ${organizationId}
      order by t.occurred_at, t.id, e.amount_minor desc
    `)
  ).rows;
  await recordAudit(db, actor, {
    organizationId,
    action: "finances.exported",
    targetType: "organization",
    targetId: organizationId,
    metadata: { count: rows.length },
  });
  const csv = csvDoc(
    ["date", "type", "reference", "description", "commande", "evenement", "compte", "devise", "sens", "montant"],
    rows.map((r) => [
      new Date(r.occurred_at).toISOString(),
      r.kind,
      r.reference ?? "",
      r.description ?? "",
      r.order_number ?? "",
      r.event_title ?? "",
      r.account,
      r.currency,
      // Debit / credit columns keep every amount positive (a leading "-" would be escaped as text).
      Number(r.amount_minor) >= 0 ? "D" : "C",
      money(Math.abs(Number(r.amount_minor))),
    ]),
  );
  return { csv, filename: `journal-financier-${new Date().toISOString().slice(0, 10)}.csv`, count: rows.length };
}

/** Event report: the event dashboard flattened as `section;indicateur;valeur;source` lines. Audited. */
export async function exportEventReportCsv(
  db: Database,
  actor: Actor,
  organizationId: string,
  eventId: string,
): Promise<{ csv: string; filename: string; count: number }> {
  const d = await eventDashboard(db, actor, organizationId, eventId);
  const m = (v: MoneyMetric) => [money(v.amountMinor), `${v.source}${v.estimate ? " (estimation)" : ""}`];
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const lines: string[][] = [
    ["evenement", "titre", d.title, "events"],
    ["evenement", "statut", d.status, "events"],
    ["evenement", "debut", d.startsAt.toISOString(), "events"],
    ["evenement", "capacite", String(d.capacity), "events.capacity"],
    ["billetterie", "billets_vendus", String(d.ticketing.ticketsSold), "tickets (valid|used)"],
    ["billetterie", "billets_utilises", String(d.ticketing.ticketsUsed), "tickets (used)"],
    ["billetterie", "commandes_payees", String(d.ticketing.paidOrders), "orders (paid|partially_refunded)"],
    ["billetterie", "taux_remplissage", pct(d.ticketing.occupancyRate), "tickets / capacity"],
    ["billetterie", "brut", ...m(d.ticketing.gross)],
    ["billetterie", "remboursements", ...m(d.ticketing.refunds)],
    ["billetterie", "frais_plateforme", ...m(d.ticketing.platformFees)],
    ["billetterie", "net_estime", ...m(d.ticketing.netEstimate)],
    ...d.ticketing.byType.map((t) => [
      "billetterie_par_type",
      t.name,
      `${t.sold}${t.quota !== null ? ` / ${t.quota}` : ""}`,
      `brut ${money(t.grossMinor)}`,
    ]),
    ["controle_acces", "acceptes", String(d.checkins.accepted), "checkins"],
    ["controle_acces", "deja_utilises", String(d.checkins.alreadyUsed), "checkins"],
    ["controle_acces", "refuses", String(d.checkins.refused), "checkins"],
    ["benevoles", "candidatures", String(d.volunteers.applications), "volunteer_applications"],
    ["benevoles", "acceptees", String(d.volunteers.approved), "volunteer_applications (approved)"],
    ["benevoles", "version_publiee", d.volunteers.publishedVersion ?? "—", "schedule_versions"],
    ["benevoles", "creneaux_requis", String(d.volunteers.shiftsRequired), "volunteer_shifts.required_count"],
    ["benevoles", "creneaux_couverts", String(d.volunteers.shiftsCovered), "volunteer_assignments (version publiée)"],
    ["benevoles", "taux_couverture", pct(d.volunteers.coverageRate), "couverts / requis"],
    ...d.volunteers.unfilledShifts.map((s) => [
      "benevoles_non_pourvus",
      `${s.positionName}${s.label ? ` · ${s.label}` : ""}`,
      `${s.missing} manquant(s)`,
      s.startsAt.toISOString(),
    ]),
    ["benevoles", "missions_confirmees", String(d.volunteers.confirmedMissions), "volunteer_assignments"],
    ["benevoles", "missions_declinees", String(d.volunteers.declinedMissions), "volunteer_assignments"],
    ["benevoles", "presents", String(d.volunteers.attendance.present), "volunteer_attendance"],
    ["benevoles", "retards", String(d.volunteers.attendance.late), "volunteer_attendance"],
    ["benevoles", "absents", String(d.volunteers.attendance.absent), "volunteer_attendance"],
    ["benevoles", "excuses", String(d.volunteers.attendance.excused), "volunteer_attendance"],
    ["campagnes", "commandes_attribuees", String(d.campaigns.attributedOrders), "orders.campaign_id"],
    ["campagnes", "commandes_payees_attribuees", String(d.campaigns.attributedPaidOrders), "orders.campaign_id"],
    ["campagnes", "revenu_attribue", ...m(d.campaigns.attributedRevenue)],
  ];
  await recordAudit(db, actor, {
    organizationId,
    action: "event_report.exported",
    targetType: "event",
    targetId: eventId,
    metadata: { lines: lines.length },
  });
  return {
    csv: csvDoc(["section", "indicateur", "valeur", "source"], lines),
    filename: `rapport-${eventId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`,
    count: lines.length,
  };
}
