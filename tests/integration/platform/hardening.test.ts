import { type DatabaseHandle, schema } from "@kroov/database";
import { getContact, listContacts } from "@kroov/domain/crm";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import {
  type Actor,
  NotFoundError,
  PreconditionFailedError,
  parseLocalDateTime,
  ValidationError,
} from "@kroov/domain/kernel";
import { applyForMembership, createMembershipPlan, getMembershipForMember } from "@kroov/domain/memberships";
import { listNotifications, notify } from "@kroov/domain/notifications";
import {
  acceptInvitation,
  createInvitation,
  createOrganization,
  listMembers,
  setMemberRoles,
} from "@kroov/domain/organizations";
import {
  applyRetention,
  consumeRateLimit,
  platformSnapshot,
  purgeRateLimits,
  renderPrometheus,
} from "@kroov/domain/platform";
import { deleteAccount, exportPersonalData, lastOwnerOrganizations } from "@kroov/domain/privacy";
import {
  createPublicOrder,
  createTicketType,
  getOrderForBuyer,
  type TicketingContext,
  updateBuyerDetails,
  updateTicketingSettings,
} from "@kroov/domain/ticketing";
import {
  activateEventPosition,
  applyAsVolunteer,
  createPosition,
  createTeam,
  getApplicationForCandidate,
  updateVolunteering,
  type VolunteerContext,
} from "@kroov/domain/volunteers";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { FakePaymentProvider } from "@kroov/payments";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

/**
 * Phase 10 — hardening: PostgreSQL rate limiting, privacy export / account deletion by
 * anonymisation (last-owner rule, cross-module), data retention, operational snapshot.
 */
let handle: DatabaseHandle;
let camille: TestUser; // owner A
let nora: TestUser; // second owner of A after promotion, deletes her account
let orgA: string;
let email: ConsoleEmailAdapter;
let ctx: TicketingContext;
let vctx: VolunteerContext;
let eventId: string;
let eventSlug: string;
let orderId: string;
let orderToken: string;
let membershipId: string;
let membershipToken: string;
let applicationId: string;
let applicationToken: string;
const anon: Actor = { kind: "anonymous" };
const TZ = "Europe/Paris";
const t = (date: string, time: string) => parseLocalDateTime(date, time, TZ)!;

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new ConsoleEmailAdapter(() => undefined);
  const provider = new FakePaymentProvider({ appUrl: "http://test.local", webhookSecret: "test-secret-xxxxxxxxxxxx" });
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
  nora = await createTestUser(handle.db, { name: "Nora Diallo", email: "nora@example.fr" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  await createInvitation(handle.db, camille.actor, vctx, orgA, { email: nora.email, role: "volunteer_manager" });
  const token = email.lastTo(nora.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, nora.actor, token!);
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const ev = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière de musique, trois scènes et un espace calme pour souffler.",
    startsAt: t("2027-06-12", "18:00"),
    endsAt: t("2027-06-13", "02:00"),
    capacity: 100,
    locationId: loc.id,
  });
  const pub = await publishEvent(handle.db, camille.actor, orgA, ev.id, ev.version);
  eventId = pub.id;
  eventSlug = pub.slug;
  // Nora's footprint as a person: an order (guest, her address), a membership, a volunteer application.
  const type = await createTicketType(handle.db, camille.actor, orgA, eventId, {
    name: "Standard",
    priceMinor: 0,
    quota: 10,
  });
  await updateTicketingSettings(handle.db, camille.actor, orgA, eventId, { ticketingStatus: "open" });
  const order = await createPublicOrder(handle.db, ctx, anon, {
    organizationSlug: DEMO.organization.slug,
    eventSlug,
    items: [{ ticketTypeId: type.id, quantity: 1 }],
  });
  orderId = order.id;
  orderToken = order.accessToken;
  await updateBuyerDetails(handle.db, ctx, order.id, order.accessToken, {
    email: nora.email,
    firstName: "Nora",
    lastName: "Diallo",
    attendees: [{ ticketTypeId: type.id, names: ["Nora Diallo"] }],
  });
  const plan = await createMembershipPlan(handle.db, camille.actor, orgA, {
    name: "Sympathisant",
    priceMinor: 0,
    periodKind: "fixed",
    validFrom: t("2027-01-01", "00:00"),
    validUntil: t("2027-12-31", "23:59"),
  });
  const m = await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
    planId: plan.id,
    email: nora.email,
    firstName: "Nora",
    lastName: "Diallo",
    marketingOptIn: true,
  });
  membershipId = m.id;
  membershipToken = m.accessToken;
  const team = (await createTeam(handle.db, camille.actor, orgA, { name: "Bar" })).id;
  const position = (await createPosition(handle.db, camille.actor, orgA, { teamId: team, name: "Bar principal" })).id;
  await activateEventPosition(handle.db, camille.actor, orgA, eventId, { positionId: position });
  await updateVolunteering(handle.db, camille.actor, orgA, eventId, { recruitmentStatus: "open", minRestMinutes: 0 });
  const a = await applyAsVolunteer(handle.db, vctx, anon, DEMO.organization.slug, eventSlug, {
    email: nora.email,
    firstName: "Nora",
    lastName: "Diallo",
    positionPreferences: [position],
    availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "00:00") }],
    motivation: "Parce que j'adore ça.",
  });
  applicationId = a.id;
  applicationToken = a.accessToken;
  await notify(handle.db, {
    organizationId: orgA,
    userIds: [nora.id],
    kind: "event.published",
    title: "Test",
    dedupeKey: "t:1",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("A. rate limiting in PostgreSQL", () => {
  it("counts per (scope, subject, window) and refuses past the limit; windows are independent", async () => {
    const rule = { scope: "test.scope", limit: 3, windowSeconds: 60 };
    const now = new Date("2026-10-28T20:00:10Z");
    for (let i = 1; i <= 3; i += 1) {
      const d = await consumeRateLimit(handle.db, rule, "1.2.3.4", now);
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(3 - i);
    }
    const refused = await consumeRateLimit(handle.db, rule, "1.2.3.4", now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(50);
    // Another subject and another scope are not affected; the next window starts fresh.
    expect((await consumeRateLimit(handle.db, rule, "5.6.7.8", now)).allowed).toBe(true);
    expect((await consumeRateLimit(handle.db, { ...rule, scope: "other" }, "1.2.3.4", now)).allowed).toBe(true);
    expect((await consumeRateLimit(handle.db, rule, "1.2.3.4", new Date("2026-10-28T20:01:00Z"))).allowed).toBe(true);
  });

  it("concurrent increments never lose a count (single upsert per request)", async () => {
    const rule = { scope: "test.concurrent", limit: 1000, windowSeconds: 60 };
    const now = new Date("2026-10-28T20:00:10Z");
    await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit(handle.db, rule, "x", now)));
    const row = (
      await handle.db
        .select({ count: schema.requestRateLimits.count })
        .from(schema.requestRateLimits)
        .where(eq(schema.requestRateLimits.scope, "test.concurrent"))
    )[0];
    expect(row?.count).toBe(25);
    expect(await purgeRateLimits(handle.db, new Date("2026-10-28T21:00:00Z"))).toBeGreaterThanOrEqual(4);
  });
});

describe("B. privacy — export and account deletion", () => {
  it("exports only the person's own data, with the retention note; audited", async () => {
    const data = await exportPersonalData(handle.db, nora.actor);
    expect(data.profile.email).toBe(nora.email);
    expect(data.organizations.map((o) => o.slug)).toEqual([DEMO.organization.slug]);
    expect(data.organizations[0]?.roles).toEqual(["volunteer_manager"]);
    expect(data.orders.map((o) => o.id)).toEqual([orderId]);
    expect(data.orders[0]?.tickets[0]?.attendeeName).toBe("Nora Diallo");
    expect(data.memberships.map((m) => m.id)).toEqual([membershipId]);
    expect(data.volunteerApplications.map((a) => a.id)).toEqual([applicationId]);
    expect(data.notifications).toHaveLength(1);
    expect(data.retentionNote).toContain("conservés");
    // Camille sees none of Nora's records.
    const camilles = await exportPersonalData(handle.db, camille.actor);
    expect(camilles.orders).toHaveLength(0);
    expect(camilles.memberships).toHaveLength(0);
    expect(camilles.auditTrail.length).toBeGreaterThan(0);
    await expect(exportPersonalData(handle.db, anon)).rejects.toThrow();
    const audits = await handle.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "privacy.exported"));
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses deletion for the last owner, with the organizations named", async () => {
    expect((await lastOwnerOrganizations(handle.db, camille.actor)).map((o) => o.slug)).toEqual([
      DEMO.organization.slug,
    ]);
    await expect(deleteAccount(handle.db, camille.actor, { confirmEmail: camille.email })).rejects.toMatchObject({
      details: { code: "last_owner" },
    });
    await expect(deleteAccount(handle.db, camille.actor, { confirmEmail: camille.email })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(deleteAccount(handle.db, nora.actor, { confirmEmail: "wrong@example.fr" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Promote Nora to owner: now neither is the last owner.
    const members = await listMembers(handle.db, camille.actor, orgA);
    const noraMember = members.find((m) => m.email === nora.email)!;
    await setMemberRoles(handle.db, camille.actor, orgA, noraMember.id, { grants: [{ role: "owner" }] });
    expect(await lastOwnerOrganizations(handle.db, camille.actor)).toEqual([]);
  });

  it("anonymises across modules in one transaction; business records stay, identity and links are gone", async () => {
    // Links work before deletion.
    expect((await getOrderForBuyer(handle.db, ctx, orderId, { accessToken: orderToken })).buyer.email).toBe(nora.email);
    const result = await deleteAccount(handle.db, nora.actor, { confirmEmail: nora.email.toUpperCase() });
    expect(result.anonymised).toMatchObject({
      memberships: 1,
      orders: 1,
      volunteerApplications: 1,
      organizationsLeft: 1,
    });
    expect(result.anonymised.contacts).toBeGreaterThanOrEqual(1);
    const u = (await handle.db.select().from(schema.users).where(eq(schema.users.id, nora.id)))[0]!;
    expect(u.name).toBe("Compte supprimé");
    expect(u.email).toBe(`deleted-${nora.id}@anonymised.kroov.invalid`);
    expect(u.deletedAt).toBeInstanceOf(Date);
    expect(await handle.db.select().from(schema.sessions).where(eq(schema.sessions.userId, nora.id))).toHaveLength(0);
    expect(await handle.db.select().from(schema.accounts).where(eq(schema.accounts.userId, nora.id))).toHaveLength(0);
    // Membership of the organization closed: no longer listed, no role applies.
    expect((await listMembers(handle.db, camille.actor, orgA)).some((m) => m.email === nora.email)).toBe(false);
    expect(await lastOwnerOrganizations(handle.db, camille.actor)).toHaveLength(1);
    // Order kept, buyer detached, link revoked (secret version bumped); attendee name kept on the ticket.
    const order = (await handle.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0]!;
    expect(order.buyerEmail).toBe(u.email);
    expect(order.buyerFirstName).toBeNull();
    expect(order.userId).toBeNull();
    await expect(getOrderForBuyer(handle.db, ctx, orderId, { accessToken: orderToken })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const ticket = (await handle.db.select().from(schema.tickets).where(eq(schema.tickets.orderId, orderId)))[0]!;
    expect(ticket.attendeeName).toBe("Nora Diallo");
    // Membership and application anonymised, links revoked.
    const ms = (await handle.db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)))[0]!;
    expect(ms).toMatchObject({ memberEmail: u.email, memberLastName: "supprimé", userId: null });
    await expect(
      getMembershipForMember(handle.db, ctx, membershipId, { accessToken: membershipToken }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const app = (
      await handle.db
        .select()
        .from(schema.volunteerApplications)
        .where(eq(schema.volunteerApplications.id, applicationId))
    )[0]!;
    expect(app).toMatchObject({ email: u.email, firstName: "Compte", motivation: null, phone: null });
    await expect(
      getApplicationForCandidate(handle.db, vctx, applicationId, { accessToken: applicationToken }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // CRM contact archived and stripped; identities removed.
    const contacts = await listContacts(handle.db, camille.actor, orgA, { q: "nora", status: "all" });
    expect(contacts.contacts).toHaveLength(0);
    const archived = (
      await handle.db.select().from(schema.contacts).where(eq(schema.contacts.primaryEmail, u.email))
    )[0];
    expect(archived?.status).toBe("archived");
    expect(archived?.firstName).toBeNull();
    expect(
      await handle.db
        .select()
        .from(schema.contactIdentities)
        .where(eq(schema.contactIdentities.contactId, archived!.id)),
    ).toHaveLength(0);
    await expect(getContact(handle.db, camille.actor, orgA, archived!.id)).resolves.toMatchObject({
      status: "archived",
    });
    // Notifications gone; audit keeps the opaque id.
    expect(
      await handle.db.select().from(schema.notifications).where(eq(schema.notifications.userId, nora.id)),
    ).toHaveLength(0);
    const audit = (
      await handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "privacy.account_deleted"))
    )[0]!;
    expect(audit.actorId).toBe(nora.id);
    expect(JSON.stringify(audit.metadata)).not.toContain("nora@example.fr");
    // A deleted account cannot export or delete again.
    await expect(exportPersonalData(handle.db, nora.actor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listNotifications(handle.db, nora.actor, orgA)).rejects.toThrow();
  });
});

describe("C. retention and operational snapshot", () => {
  it("purges only technical records past their cutoff", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    await handle.db.insert(schema.outboxEvents).values([
      {
        aggregateType: "d",
        aggregateId: "1",
        eventType: "d.old",
        payload: {},
        status: "dispatched",
        dispatchedAt: old,
      },
      { aggregateType: "d", aggregateId: "2", eventType: "d.failed", payload: {}, status: "failed" },
      {
        aggregateType: "d",
        aggregateId: "3",
        eventType: "d.fresh",
        payload: {},
        status: "dispatched",
        dispatchedAt: new Date(),
      },
    ]);
    await handle.db.insert(schema.jobExecutions).values([
      { queue: "maintenance.heartbeat", jobId: "old-1", status: "succeeded", startedAt: old },
      { queue: "maintenance.heartbeat", jobId: "new-1", status: "succeeded", startedAt: new Date() },
    ]);
    await handle.db.execute(
      sql`insert into request_rate_limits (scope, subject, window_start, count) values ('r', 's', ${old}, 1)`,
    );
    const report = await applyRetention(handle.db);
    expect(report.outboxEvents).toBe(1);
    expect(report.jobExecutions).toBe(1);
    expect(report.rateLimits).toBeGreaterThanOrEqual(1);
    const remaining = await handle.db.select({ type: schema.outboxEvents.eventType }).from(schema.outboxEvents);
    expect(remaining.map((r) => r.type)).toEqual(expect.arrayContaining(["d.failed", "d.fresh"]));
    expect(remaining.map((r) => r.type)).not.toContain("d.old");
  });

  it("snapshot reports the database, the worker heartbeat, the outbox backlog; Prometheus renders it", async () => {
    const s = await platformSnapshot(handle.db);
    expect(s.database.ok).toBe(true);
    expect(s.worker.alive).toBe(true); // heartbeat row inserted above
    expect(s.outbox.failed).toBeGreaterThanOrEqual(1);
    const text = renderPrometheus(s);
    expect(text).toContain("kroov_worker_alive 1");
    expect(text).toMatch(/kroov_outbox_events\{status="failed"\} [1-9]/);
  });
});
