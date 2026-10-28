import { type DatabaseHandle, schema } from "@kroov/database";
import {
  eventDashboard,
  exportEventReportCsv,
  exportFinanceJournalCsv,
  financeOverview,
  organizationDashboard,
} from "@kroov/domain/analytics";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  parseLocalDateTime,
  ValidationError,
} from "@kroov/domain/kernel";
import { applyForMembership, approveMembership, createMembershipPlan } from "@kroov/domain/memberships";
import {
  getPreferences,
  handleDomainEvent,
  listNotifications,
  markRead,
  recipientsByPermission,
  setPreferences,
  unreadCount,
} from "@kroov/domain/notifications";
import { acceptInvitation, createInvitation, createOrganization } from "@kroov/domain/organizations";
import {
  createVersion,
  generateVersion,
  listMissions,
  publishVersion,
  reportUnavailable,
} from "@kroov/domain/scheduling";
import {
  completeTask,
  createTask,
  deleteTask,
  ensureSystemTask,
  exportTasksCsv,
  listAssignableMembers,
  listTasks,
  reopenTask,
  updateTask,
} from "@kroov/domain/tasks";
import {
  createPublicOrder,
  createRefund,
  createTicketType,
  getOrderForBuyer,
  getTicketByViewToken,
  processProviderEvent,
  scanTicket,
  startCheckout,
  startPaymentOnboarding,
  type TicketingContext,
  updateBuyerDetails,
  updateTicketingSettings,
} from "@kroov/domain/ticketing";
import {
  activateEventPosition,
  applyAsVolunteer,
  createPosition,
  createShift,
  createTeam,
  decideApplication,
  updateVolunteering,
  type VolunteerContext,
} from "@kroov/domain/volunteers";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "@kroov/payments";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_REQUEUES, relayOutboxBatch, requeueFailedOutbox } from "../../../apps/worker/src/jobs/outbox-relay";
import type { Queue } from "../../../apps/worker/src/queue";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

/**
 * Phase 9 — operations: dashboards computed from the authoritative records (exact figures and
 * sources), finances = ledger, tasks (CRUD, version token, tenant checks, system tasks), the
 * domain-event consumer (notifications per permission, idempotence, preferences, system task)
 * and the outbox relay fix (single `domain.events` queue, bounded requeue).
 */
let handle: DatabaseHandle;
let camille: TestUser; // owner A
let nora: TestUser; // volunteer manager A (tasks.manage, volunteers.*, no analytics.read)
let yanis: TestUser; // scanner A (events.read + checkins.scan only)
let bob: TestUser; // owner B
let orgA: string;
let orgB: string;
let eventA: { id: string; slug: string };
let eventB: { id: string; slug: string };
let email: ConsoleEmailAdapter;
let provider: FakePaymentProvider;
let ctx: TicketingContext;
let vctx: VolunteerContext;
let orderId: string;
let refundId: string;
let membershipId: string;
let volunteer: { id: string; accessToken: string };
let assignmentId: string;
const anon: Actor = { kind: "anonymous" };
const TZ = "Europe/Paris";
const t = (date: string, time: string) => parseLocalDateTime(date, time, TZ)!;
const silentLogger = { warn: () => undefined, info: () => undefined } as unknown as Parameters<
  typeof relayOutboxBatch
>[2];

async function webhook(type: "payment.succeeded" | "payment.failed", sessionId: string) {
  const body = buildFakeWebhookBody({
    type,
    objectId: sessionId,
    chargeRef: type === "payment.succeeded" ? `ch_${sessionId}` : undefined,
  });
  const event = await provider.verifyWebhook(body, signFakeWebhook("test-secret-xxxxxxxxxxxx", body));
  return processProviderEvent(handle.db, ctx, event);
}

async function invite(user: TestUser, role: "volunteer_manager" | "scanner") {
  await createInvitation(handle.db, camille.actor, vctx, orgA, { email: user.email, role });
  const token = email.lastTo(user.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, user.actor, token!);
}

async function outboxMessage(eventType: string, aggregateId?: string) {
  const row = (
    await handle.db
      .select()
      .from(schema.outboxEvents)
      .where(
        aggregateId
          ? and(eq(schema.outboxEvents.eventType, eventType), eq(schema.outboxEvents.aggregateId, aggregateId))
          : eq(schema.outboxEvents.eventType, eventType),
      )
      .orderBy(desc(schema.outboxEvents.createdAt))
      .limit(1)
  )[0];
  if (!row) throw new Error(`no outbox row for ${eventType}`);
  return {
    outboxId: row.id,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    organizationId: row.organizationId,
    payload: row.payload as Record<string, unknown>,
  };
}

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new ConsoleEmailAdapter(() => undefined);
  provider = new FakePaymentProvider({ appUrl: "http://test.local", webhookSecret: "test-secret-xxxxxxxxxxxx" });
  ctx = {
    provider,
    email,
    appName: "Kroov",
    appUrl: "http://test.local",
    credentialSecret: "integration-credential-secret",
    fees: { bps: 400, fixedMinor: 0 },
    holdMinutes: 10,
  };
  vctx = { email, appName: "Kroov", appUrl: "http://test.local", credentialSecret: "integration-credential-secret" };
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  yanis = await createTestUser(handle.db, DEMO.scanner);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  await invite(nora, "volunteer_manager");
  await invite(yanis, "scanner");
  await startPaymentOnboarding(handle.db, ctx, camille.actor, orgA, {
    returnUrl: "http://test.local/r",
    refreshUrl: "http://test.local/f",
  });

  // Events: A (published, capacity 8) and B (other tenant).
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const a = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière de musique, trois scènes et un espace calme pour souffler.",
    startsAt: t("2027-06-12", "18:00"),
    endsAt: t("2027-06-13", "02:00"),
    capacity: 8,
    locationId: loc.id,
  });
  const pa = await publishEvent(handle.db, camille.actor, orgA, a.id, a.version);
  eventA = { id: pa.id, slug: pa.slug };
  const locB = await createLocation(handle.db, bob.actor, orgB, { name: "Salle B", city: "Paris" });
  const b = await createEvent(handle.db, bob.actor, orgB, {
    title: "Soirée B",
    slug: "soiree-b",
    description: "Une soirée pour une autre association, dans une autre ville, avec d'autres gens.",
    startsAt: t("2027-07-01", "20:00"),
    endsAt: t("2027-07-02", "01:00"),
    capacity: 50,
    locationId: locB.id,
  });
  const pb = await publishEvent(handle.db, bob.actor, orgB, b.id, b.version);
  eventB = { id: pb.id, slug: pb.slug };

  // Ticketing: one type at 30 € (+4 % fees), one order of 2 paid, one scanned, one refunded.
  const standard = await createTicketType(handle.db, camille.actor, orgA, eventA.id, {
    name: "Tarif standard",
    priceMinor: 3000,
    quota: 5,
  });
  await updateTicketingSettings(handle.db, camille.actor, orgA, eventA.id, { ticketingStatus: "open" });
  const order = await createPublicOrder(handle.db, ctx, anon, {
    organizationSlug: DEMO.organization.slug,
    eventSlug: eventA.slug,
    items: [{ ticketTypeId: standard.id, quantity: 2 }],
  });
  orderId = order.id;
  await updateBuyerDetails(handle.db, ctx, order.id, order.accessToken, {
    email: "lou.martin@example.fr",
    firstName: "Lou",
    lastName: "Martin",
    attendees: [{ ticketTypeId: standard.id, names: ["Lou Martin", "Sam Moreau"] }],
  });
  const checkout = await startCheckout(handle.db, ctx, anon, order.id, order.accessToken, {
    successUrl: "http://test.local/ok",
    cancelUrl: "http://test.local/ko",
  });
  if (checkout.kind !== "redirect") throw new Error("expected redirect");
  await webhook("payment.succeeded", checkout.url.split("/paiement/")[1]!);
  const view = await getOrderForBuyer(handle.db, ctx, order.id, { accessToken: order.accessToken });
  const t1 = view.tickets[0]!;
  const t2 = view.tickets[1]!;
  const page = await getTicketByViewToken(handle.db, ctx, view.ticketLinks[t1.id]!);
  await scanTicket(handle.db, ctx, yanis.actor, orgA, eventA.id, page.qrCredential!, "iphone-yanis");
  const refunded = await createRefund(handle.db, ctx, camille.actor, orgA, order.id, {
    ticketIds: [t2.id],
    reason: "Demande de l'acheteur",
  });
  refundId = refunded.refunds.at(-1)!.id;

  // Membership: a plan that requires a review, applied for and approved.
  const plan = await createMembershipPlan(handle.db, camille.actor, orgA, {
    name: "Membre actif",
    priceMinor: 0,
    periodKind: "fixed",
    validFrom: t("2027-01-01", "00:00"),
    validUntil: t("2027-12-31", "23:59"),
    requiresReview: true,
  });
  const m = await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
    planId: plan.id,
    email: "nina@example.fr",
    firstName: "Nina",
    lastName: "Rey",
  });
  membershipId = (await approveMembership(handle.db, ctx, camille.actor, orgA, m.id)).id;

  // Volunteers: one position, one shift needing 2, one approved volunteer, published schedule (1/2 covered).
  const team = (await createTeam(handle.db, nora.actor, orgA, { name: "Bar" })).id;
  const position = (await createPosition(handle.db, nora.actor, orgA, { teamId: team, name: "Bar principal" })).id;
  const ep = await activateEventPosition(handle.db, nora.actor, orgA, eventA.id, { positionId: position });
  await createShift(handle.db, nora.actor, orgA, eventA.id, ep.id, {
    label: "Ouverture",
    startsAt: t("2027-06-12", "17:00"),
    endsAt: t("2027-06-12", "23:00"),
    requiredCount: 2,
  });
  await updateVolunteering(handle.db, nora.actor, orgA, eventA.id, { recruitmentStatus: "open", minRestMinutes: 0 });
  const v = await applyAsVolunteer(handle.db, vctx, anon, DEMO.organization.slug, eventA.slug, {
    email: "sam@example.test",
    firstName: "Sam",
    lastName: "Moreau",
    positionPreferences: [position],
    availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "00:00") }],
  });
  await decideApplication(handle.db, vctx, nora.actor, orgA, v.id, "approve");
  volunteer = { id: v.id, accessToken: v.accessToken };
  const version = await createVersion(handle.db, nora.actor, orgA, eventA.id, {});
  const generated = await generateVersion(handle.db, nora.actor, orgA, version.id);
  await publishVersion(handle.db, vctx, camille.actor, orgA, version.id, {
    expectedVersion: generated.version.version,
    acknowledgeUnfilled: true,
  });
  const missions = await listMissions(handle.db, volunteer.id, { accessToken: volunteer.accessToken });
  assignmentId = missions[0]!.assignmentId;
});

afterAll(async () => {
  await handle.close();
});

describe("A. dashboards computed from the authoritative records", () => {
  it("organization dashboard: exact figures with their ledger sources", async () => {
    const d = await organizationDashboard(handle.db, camille.actor, orgA);
    expect(d.events).toMatchObject({ published: 1, drafts: 0, cancelled: 0 });
    // 2 tickets: one used (scanned), one refunded → 1 sold, 1 used; the order is partially refunded.
    expect(d.ticketing).toMatchObject({ ticketsSold: 1, ticketsUsed: 1, paidOrders: 1, refundedOrders: 1 });
    // Ledger: sale C revenue 6000 / C fees 240 / D receivable 6240; refund of one ticket 3000 + 120.
    expect(d.ticketing.gross.amountMinor).toBe(3000);
    expect(d.ticketing.platformFees.amountMinor).toBe(120);
    expect(d.ticketing.refunds.amountMinor).toBe(3120);
    expect(d.ticketing.receivableFromProvider.amountMinor).toBe(3120);
    expect(d.ticketing.netEstimate).toMatchObject({ amountMinor: 3000, estimate: true });
    expect(d.ticketing.gross.source).toContain("Grand livre");
    expect(d.memberships).toMatchObject({ active: 1, pending: 0 });
    expect(d.volunteers).toMatchObject({
      applications: 1,
      approved: 1,
      approvalRate: 1,
      publishedShiftsRequired: 2,
      publishedShiftsCovered: 1,
      coverageRate: 0.5,
      unfilledShifts: 1,
    });
    expect(d.checkins).toEqual({ accepted: 1, refused: 0 });
    expect(d.campaigns.sent).toBe(0);
    expect(d.contacts.total).toBeGreaterThanOrEqual(1); // buyer + member touchpoints (CRM)
  });

  it("period filter bounds the money and order figures (never the stock figures)", async () => {
    const future = await organizationDashboard(handle.db, camille.actor, orgA, { from: new Date("2030-01-01") });
    expect(future.ticketing.paidOrders).toBe(0);
    expect(future.ticketing.ticketsSold).toBe(0);
    expect(future.ticketing.gross.amountMinor).toBe(0);
    expect(future.ticketing.refunds.amountMinor).toBe(0);
    expect(future.events.published).toBe(1);
  });

  it("event dashboard: occupancy, by type, check-ins, published coverage with unfilled shifts", async () => {
    const d = await eventDashboard(handle.db, camille.actor, orgA, eventA.id);
    expect(d.capacity).toBe(8);
    expect(d.ticketing.ticketsSold).toBe(1);
    expect(d.ticketing.occupancyRate).toBeCloseTo(1 / 8);
    expect(d.ticketing.gross.amountMinor).toBe(3000);
    expect(d.ticketing.byType).toEqual([{ name: "Tarif standard", sold: 1, quota: 5, grossMinor: 3000 }]);
    expect(d.checkins).toMatchObject({ accepted: 1, alreadyUsed: 0, refused: 0, acceptanceRate: 1 });
    expect(d.volunteers.publishedVersion).toBe("V1");
    expect(d.volunteers).toMatchObject({ shiftsRequired: 2, shiftsCovered: 1, coverageRate: 0.5 });
    expect(d.volunteers.unfilledShifts).toHaveLength(1);
    expect(d.volunteers.unfilledShifts[0]).toMatchObject({
      label: "Ouverture",
      positionName: "Bar principal",
      missing: 1,
    });
    expect(d.campaigns.attributedOrders).toBe(0);
  });

  it("is bounded to the organization and to analytics.read (or event-scoped events.read)", async () => {
    await expect(organizationDashboard(handle.db, nora.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(organizationDashboard(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(eventDashboard(handle.db, bob.actor, orgA, eventA.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(eventDashboard(handle.db, camille.actor, orgA, eventB.id)).rejects.toBeInstanceOf(NotFoundError);
    // A scanner holds events.read organization-wide: the event dashboard is readable, the org one is not.
    expect((await eventDashboard(handle.db, yanis.actor, orgA, eventA.id)).ticketing.ticketsSold).toBe(1);
    await expect(organizationDashboard(handle.db, yanis.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(financeOverview(handle.db, nora.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("finances: balances equal the ledger, journal is double-entry, payouts are explicitly unknown", async () => {
    const f = await financeOverview(handle.db, camille.actor, orgA);
    expect(f.balances.gross.amountMinor).toBe(3000);
    expect(f.balances.platformFees.amountMinor).toBe(120);
    expect(f.balances.refunds.amountMinor).toBe(3120);
    expect(f.balances.receivableFromProvider.amountMinor).toBe(3120);
    expect(f.byEvent).toEqual([
      {
        eventId: eventA.id,
        title: "Les Nuits en Commun",
        grossMinor: 3000,
        feesMinor: 120,
        refundsMinor: 3120,
        paidOrders: 1,
      },
    ]);
    expect(f.journal.map((j) => j.kind)).toEqual(["order_refunded", "order_paid"]);
    for (const j of f.journal) {
      expect(j.entries).toHaveLength(3);
      expect(j.entries.reduce((a, e) => a + e.amountMinor, 0)).toBe(0);
    }
    expect(f.payouts.available).toBe(false);
    expect(f.payouts.note).toContain("prestataire");
    expect(f.documents).toEqual([]);
  });

  it("exports: finance journal (one line per entry) and event report, both audited", async () => {
    const journal = await exportFinanceJournalCsv(handle.db, camille.actor, orgA);
    expect(journal.count).toBe(6);
    expect(
      journal.csv.startsWith("\uFEFFdate;type;reference;description;commande;evenement;compte;devise;sens;montant"),
    ).toBe(true);
    expect(journal.csv).toContain(";revenue_tickets;EUR;C;60.00");
    expect(journal.csv).toContain(";receivable_provider;EUR;D;62.40");
    expect(journal.csv).toContain(";receivable_provider;EUR;C;31.20");
    const report = await exportEventReportCsv(handle.db, camille.actor, orgA, eventA.id);
    expect(report.csv).toContain("billetterie;billets_vendus;1;");
    expect(report.csv).toContain("billetterie;brut;30.00;");
    expect(report.csv).toContain("benevoles;taux_couverture;50 %;");
    expect(report.csv).toContain("benevoles_non_pourvus;Bar principal · Ouverture;1 manquant(s);");
    await expect(exportEventReportCsv(handle.db, bob.actor, orgA, eventA.id)).rejects.toBeInstanceOf(ForbiddenError);
    const audits = await handle.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, orgA));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["finances.exported", "event_report.exported"]));
  });
});

describe("B. tasks", () => {
  let taskId: string;
  let version: number;
  let camilleMember: string;

  it("creates a task (tasks.manage), assignee must be an active member of the organization", async () => {
    const members = await listAssignableMembers(handle.db, camille.actor, orgA);
    expect(members.map((m) => m.name).sort()).toEqual(
      [DEMO.owner.name, DEMO.volunteerManager.name, DEMO.scanner.name].sort(),
    );
    camilleMember = members.find((m) => m.name === DEMO.owner.name)!.memberId;
    const bobMember = (await listAssignableMembers(handle.db, bob.actor, orgB))[0]!.memberId;
    await expect(
      createTask(handle.db, nora.actor, orgA, { title: "x", assigneeMemberId: bobMember }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTask(handle.db, nora.actor, orgA, { title: "x", eventId: eventB.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createTask(handle.db, nora.actor, orgA, { title: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTask(handle.db, yanis.actor, orgA, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTask(handle.db, bob.actor, orgA, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const task = await createTask(handle.db, nora.actor, orgA, {
      title: "Commander les gobelets",
      description: "500 gobelets réutilisables.",
      priority: "high",
      dueAt: new Date("2020-01-01T10:00:00Z"),
      assigneeMemberId: camilleMember,
      eventId: eventA.id,
    });
    taskId = task.id;
    version = task.version;
    expect(task).toMatchObject({ status: "todo", priority: "high", overdue: true, source: "manual", version: 1 });
    expect(task.assignee?.name).toBe(DEMO.owner.name);
    expect(task.event?.slug).toBe(eventA.slug);
  });

  it("lists with filters (open, mine, overdue, event) and reading needs organization.read", async () => {
    const open = await listTasks(handle.db, camille.actor, orgA, { status: "open" });
    expect(open.items.map((t) => t.id)).toContain(taskId);
    expect(open.counts).toEqual({ open: 1, overdue: 1, mine: 1 });
    const mine = await listTasks(handle.db, nora.actor, orgA, { mine: true });
    expect(mine.items).toHaveLength(0);
    expect(mine.counts.mine).toBe(0);
    const overdue = await listTasks(handle.db, camille.actor, orgA, { overdue: true });
    expect(overdue.items).toHaveLength(1);
    const byEvent = await listTasks(handle.db, camille.actor, orgA, { eventId: eventB.id });
    expect(byEvent.items).toHaveLength(0);
    await expect(listTasks(handle.db, yanis.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTasks(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listTasks(handle.db, bob.actor, orgB)).items).toHaveLength(0);
  });

  it("updates with the version token, completes and reopens, keeps done ⇔ completedAt", async () => {
    await expect(
      updateTask(handle.db, nora.actor, orgA, taskId, { title: "Stale", version: version + 5 }),
    ).rejects.toBeInstanceOf(ConflictError);
    const started = await updateTask(handle.db, nora.actor, orgA, taskId, { status: "doing", version });
    expect(started.status).toBe("doing");
    expect(started.version).toBe(version + 1);
    const done = await completeTask(handle.db, camille.actor, orgA, taskId, started.version);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.overdue).toBe(false);
    expect((await listTasks(handle.db, camille.actor, orgA, { status: "open" })).counts.open).toBe(0);
    const reopened = await reopenTask(handle.db, camille.actor, orgA, taskId);
    expect(reopened.status).toBe("todo");
    expect(reopened.completedAt).toBeNull();
    // A PATCH that does not mention a field never resets it.
    const patched = await updateTask(handle.db, nora.actor, orgA, taskId, { priority: "low" });
    expect(patched.title).toBe("Commander les gobelets");
    expect(patched.assignee?.memberId).toBe(camilleMember);
    expect(patched.dueAt).toEqual(new Date("2020-01-01T10:00:00Z"));
    await expect(updateTask(handle.db, bob.actor, orgA, taskId, { title: "Hack" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateTask(handle.db, bob.actor, orgB, taskId, { title: "Hack" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("system tasks are idempotent on their source key", async () => {
    const a = await ensureSystemTask(handle.db, orgA, { sourceKey: "demo:1", title: "Tâche système" });
    const b = await ensureSystemTask(handle.db, orgA, { sourceKey: "demo:1", title: "Tâche système (bis)" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task.id).toBe(a.task.id);
    expect(b.task.title).toBe("Tâche système");
    // Same key in another organization is a different task.
    expect((await ensureSystemTask(handle.db, orgB, { sourceKey: "demo:1", title: "B" })).created).toBe(true);
    await deleteTask(handle.db, camille.actor, orgA, a.task.id);
  });

  it("exports CSV (audited) and deletes", async () => {
    const csv = await exportTasksCsv(handle.db, camille.actor, orgA);
    expect(
      csv.startsWith("\uFEFFtitre;statut;priorite;echeance;responsable;evenement;source;terminee_le;creee_le"),
    ).toBe(true);
    expect(csv).toContain(
      "Commander les gobelets;À faire;Basse;2020-01-01T10:00:00.000Z;Camille Durand;Les Nuits en Commun;manual",
    );
    await expect(deleteTask(handle.db, yanis.actor, orgA, taskId)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTask(handle.db, nora.actor, orgA, taskId);
    expect((await listTasks(handle.db, camille.actor, orgA, { status: "all" })).total).toBe(0);
  });
});

describe("C. notifications and the domain-event consumer", () => {
  it("resolves recipients by permission at organization or event scope", async () => {
    expect((await recipientsByPermission(handle.db, orgA, "volunteers.schedule", eventA.id)).sort()).toEqual(
      [camille.id, nora.id].sort(),
    );
    expect(await recipientsByPermission(handle.db, orgA, "memberships.manage")).toEqual([camille.id]);
    expect((await recipientsByPermission(handle.db, orgA, "events.read", eventA.id)).sort()).toEqual(
      [camille.id, nora.id, yanis.id].sort(),
    );
    expect(await recipientsByPermission(handle.db, orgB, "volunteers.schedule")).toEqual([bob.id]);
  });

  it("unavailability reported → one notification per authorised member + a system task; idempotent", async () => {
    await reportUnavailable(
      handle.db,
      vctx,
      volunteer.id,
      { accessToken: volunteer.accessToken },
      assignmentId,
      "Empêchement",
    );
    const msg = await outboxMessage("schedule.unavailability_reported");
    expect(msg.organizationId).toBe(orgA);
    const first = await handleDomainEvent(handle.db, msg);
    expect(first).toEqual({ handled: true, notified: 2, tasksCreated: 1 });
    const again = await handleDomainEvent(handle.db, msg);
    expect(again).toEqual({ handled: true, notified: 0, tasksCreated: 0 });
    const tasks = await listTasks(handle.db, camille.actor, orgA, { status: "open" });
    expect(tasks.items).toHaveLength(1);
    expect(tasks.items[0]).toMatchObject({
      source: "system",
      priority: "high",
      title: "Remplacer Sam Moreau sur Bar principal",
    });
    expect(tasks.items[0]?.event?.id).toBe(eventA.id);
    const mine = await listNotifications(handle.db, nora.actor, orgA);
    expect(mine.items).toHaveLength(1);
    expect(mine.unreadCount).toBe(1);
    expect(mine.items[0]).toMatchObject({ kind: "schedule.unavailability_reported", readAt: null });
    expect(mine.items[0]?.title).toContain("Sam Moreau");
    expect(mine.items[0]?.href).toContain(`/evenements/${eventA.slug}/planning`);
    // The scanner holds neither volunteers.schedule nor a notification; B sees nothing of A.
    expect((await listNotifications(handle.db, yanis.actor, orgA)).items).toHaveLength(0);
    await expect(listNotifications(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("marking as read is bounded to the caller's own rows", async () => {
    const noras = (await listNotifications(handle.db, nora.actor, orgA)).items[0]!.id;
    expect(await markRead(handle.db, yanis.actor, orgA, { ids: [noras] })).toEqual({ updated: 0 });
    expect(await markRead(handle.db, camille.actor, orgA, { ids: [noras] })).toEqual({ updated: 0 });
    expect(await unreadCount(handle.db, nora.actor, orgA)).toBe(1);
    expect(await markRead(handle.db, nora.actor, orgA, { ids: [noras] })).toEqual({ updated: 1 });
    expect(await unreadCount(handle.db, nora.actor, orgA)).toBe(0);
    expect(await unreadCount(handle.db, camille.actor, orgA)).toBe(1);
    expect(await markRead(handle.db, camille.actor, orgA, { all: true })).toEqual({ updated: 1 });
    await expect(markRead(handle.db, nora.actor, orgA, { ids: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("preferences: a disabled kind is skipped for that member only; event.published excludes the actor", async () => {
    const before = await getPreferences(handle.db, nora.actor, orgA);
    expect(before.every((p) => p.inApp)).toBe(true);
    const after = await setPreferences(handle.db, nora.actor, orgA, {
      preferences: [{ kind: "event.published", inApp: false }],
    });
    expect(after.find((p) => p.kind === "event.published")?.inApp).toBe(false);
    const msg = await outboxMessage("event.published", eventA.id);
    // Recipients: events.read at the event = camille (actor, excluded), nora (opted out), yanis.
    expect(await handleDomainEvent(handle.db, msg)).toEqual({ handled: true, notified: 1, tasksCreated: 0 });
    expect((await listNotifications(handle.db, yanis.actor, orgA)).items[0]).toMatchObject({ kind: "event.published" });
    expect((await listNotifications(handle.db, nora.actor, orgA)).items.map((n) => n.kind)).not.toContain(
      "event.published",
    );
    expect((await listNotifications(handle.db, camille.actor, orgA)).items.map((n) => n.kind)).not.toContain(
      "event.published",
    );
    await expect(
      setPreferences(handle.db, nora.actor, orgA, { preferences: [{ kind: "nope.nope", inApp: false }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("routes the other event types to the right permission holders", async () => {
    // volunteer_application.submitted → volunteers.review at the event (camille, nora).
    const applied = await handleDomainEvent(
      handle.db,
      await outboxMessage("volunteer_application.submitted", volunteer.id),
    );
    expect(applied).toEqual({ handled: true, notified: 2, tasksCreated: 0 });
    // order.refunded → orders.refund at the event (camille only).
    const refunded = await handleDomainEvent(handle.db, await outboxMessage("order.refunded", orderId));
    expect(refunded).toEqual({ handled: true, notified: 1, tasksCreated: 0 });
    const camilles = await listNotifications(handle.db, camille.actor, orgA);
    const refundNote = camilles.items.find((n) => n.kind === "order.refunded");
    expect(refundNote?.body).toContain("31,20");
    expect(refundNote?.href).toContain(`/billetterie/commandes/${orderId}`);
    // membership.activated on a plan requiring a review → memberships.manage (camille).
    const activated = await handleDomainEvent(handle.db, await outboxMessage("membership.activated", membershipId));
    expect(activated).toEqual({ handled: true, notified: 1, tasksCreated: 0 });
    // Unknown types and foreign aggregates are acknowledged without side effects.
    expect(
      await handleDomainEvent(handle.db, {
        outboxId: "x",
        eventType: "campaign.finished",
        aggregateType: "campaign",
        aggregateId: "00000000-0000-0000-0000-000000000000",
        organizationId: orgA,
        payload: {},
      }),
    ).toEqual({ handled: true, notified: 0, tasksCreated: 0 });
    expect(refundId).toBeTruthy();
  });
});

describe("D. outbox relay → domain.events, bounded requeue", () => {
  it("relays pending rows to the single domain.events queue with the event type in the payload", async () => {
    const sent: Array<{ queue: string; data: Record<string, unknown> }> = [];
    const queue = {
      send: async (name: string, data: Record<string, unknown>) => {
        sent.push({ queue: name, data });
        return "job";
      },
    } as unknown as Queue;
    const relayed = await relayOutboxBatch(handle.db, queue, silentLogger);
    expect(relayed).toBeGreaterThan(0);
    expect(sent.every((s) => s.queue === "domain.events")).toBe(true);
    expect(sent.map((s) => s.data.eventType)).toContain("schedule.unavailability_reported");
    const pending = await handle.db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.status, "pending"));
    expect(pending).toHaveLength(0);
  });

  it("a failing queue backs the row off; failed rows are requeued at most MAX_REQUEUES times", async () => {
    const [row] = await handle.db
      .insert(schema.outboxEvents)
      .values({ aggregateType: "demo", aggregateId: "z", eventType: "demo.z", payload: {}, organizationId: orgA })
      .returning();
    const failing = {
      send: async () => {
        throw new Error("queue down");
      },
    } as unknown as Queue;
    expect(await relayOutboxBatch(handle.db, failing, silentLogger)).toBe(0);
    let r = (await handle.db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, row!.id)))[0]!;
    expect(r).toMatchObject({ status: "pending", attempts: 1, lastError: "queue down" });
    expect(r.availableAt.getTime()).toBeGreaterThan(Date.now());
    await handle.db
      .update(schema.outboxEvents)
      .set({ status: "failed", attempts: 10 })
      .where(eq(schema.outboxEvents.id, row!.id));
    expect(await requeueFailedOutbox(handle.db)).toBe(1);
    r = (await handle.db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, row!.id)))[0]!;
    expect(r).toMatchObject({ status: "pending", attempts: 0, requeueCount: 1 });
    await handle.db
      .update(schema.outboxEvents)
      .set({ status: "failed", requeueCount: MAX_REQUEUES })
      .where(eq(schema.outboxEvents.id, row!.id));
    expect(await requeueFailedOutbox(handle.db)).toBe(0);
    r = (await handle.db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, row!.id)))[0]!;
    expect(r.status).toBe("failed");
  });
});
