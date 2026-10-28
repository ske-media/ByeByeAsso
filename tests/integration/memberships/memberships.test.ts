import { type DatabaseHandle, schema } from "@kroov/database";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import { type Actor, ForbiddenError, NotFoundError, parseLocalDateTime } from "@kroov/domain/kernel";
import {
  applyForMembership,
  approveMembership,
  archiveMembershipPlan,
  cancelMembership,
  computeValidity,
  createMembershipPlan,
  expireMemberships,
  extendMembership,
  getMembership,
  getMembershipForMember,
  hasActiveMembership,
  listMembershipPlans,
  listMemberships,
  listPublicMembershipPlans,
  membershipStateMachine,
  membershipStats,
  reactivateMembership,
  rejectMembership,
  renewMembership,
  resendMembershipLink,
  sendRenewalReminders,
  startMembershipCheckout,
  suspendMembership,
  updateMembershipPlan,
} from "@kroov/domain/memberships";
import { createOrganization } from "@kroov/domain/organizations";
import {
  createPublicOrder,
  createTicketType,
  processProviderEvent,
  startCheckout,
  startPaymentOnboarding,
  type TicketingContext,
  updateBuyerDetails,
  updateTicketingSettings,
} from "@kroov/domain/ticketing";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "@kroov/payments";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let email: ConsoleEmailAdapter;
let provider: FakePaymentProvider;
let ctx: TicketingContext;
let freePlan: string;
let paidPlan: string; // requires review, fixed season
let rollingPlan: string; // 12 months rolling, no review
const anon: Actor = { kind: "anonymous" };
const system: Actor = { kind: "system", job: "test" };
const TZ = "Europe/Paris";
const season = {
  validFrom: parseLocalDateTime("2027-01-01", "00:00", TZ)!,
  validUntil: parseLocalDateTime("2027-12-31", "23:59", TZ)!,
};

async function payWebhook(
  sessionId: string,
  type: "payment.succeeded" | "payment.failed" = "payment.succeeded",
  eventId?: string,
) {
  const body = buildFakeWebhookBody({ type, objectId: sessionId, eventId, chargeRef: `ch_${sessionId}` });
  return processProviderEvent(
    handle.db,
    ctx,
    await provider.verifyWebhook(body, signFakeWebhook("test-secret-xxxxxxxxxxxx", body)),
  );
}

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new ConsoleEmailAdapter();
  provider = new FakePaymentProvider({ appUrl: "http://test.local", webhookSecret: "test-secret-xxxxxxxxxxxx" });
  ctx = {
    provider,
    email,
    appName: "Kroov",
    appUrl: "http://test.local",
    credentialSecret: "integration-credential-secret",
    fees: { bps: 400, fixedMinor: 0 },
  };
  camille = await createTestUser(handle.db, DEMO.owner);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  await startPaymentOnboarding(handle.db, ctx, camille.actor, orgA, {
    returnUrl: "http://test.local/r",
    refreshUrl: "http://test.local/f",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("A. plans and state machine", () => {
  it("declares the graph and computes validity (fixed, rolling, chained renewal)", () => {
    expect(membershipStateMachine.canTransition("pending", "active")).toBe(true);
    expect(membershipStateMachine.canTransition("awaiting_payment", "active")).toBe(true);
    expect(membershipStateMachine.canTransition("expired", "active")).toBe(false);
    expect(membershipStateMachine.canTransition("active", "pending")).toBe(false);
    const fixed = computeValidity(
      { periodKind: "fixed", ...season, durationMonths: null },
      new Date("2027-06-01T00:00:00Z"),
      null,
    );
    expect(fixed.validUntil.toISOString()).toBe(season.validUntil.toISOString());
    const rolling = computeValidity(
      { periodKind: "rolling", validFrom: null, validUntil: null, durationMonths: 12 },
      new Date("2027-03-15T10:00:00Z"),
      null,
    );
    expect(rolling.validUntil.toISOString()).toBe("2028-03-15T10:00:00.000Z");
    const chained = computeValidity(
      { periodKind: "rolling", validFrom: null, validUntil: null, durationMonths: 6 },
      new Date("2027-03-15T10:00:00Z"),
      new Date("2027-04-01T00:00:00Z"),
    );
    expect(chained.validFrom.toISOString()).toBe("2027-04-01T00:00:00.000Z");
    expect(chained.validUntil.toISOString()).toBe("2027-10-01T00:00:00.000Z");
  });

  it("creates free, paid (review, season) and rolling plans; B cannot touch A's plans", async () => {
    const f = await createMembershipPlan(handle.db, camille.actor, orgA, {
      name: "Sympathisant",
      priceMinor: 0,
      periodKind: "fixed",
      ...season,
      benefits: ["Recevoir les nouvelles"],
    });
    const p = await createMembershipPlan(handle.db, camille.actor, orgA, {
      name: "Adhésion annuelle 2027",
      priceMinor: 2000,
      periodKind: "fixed",
      ...season,
      requiresReview: true,
      maxMembers: 3,
      benefits: ["Soutenir les projets", "Participer aux assemblées"],
    });
    const r = await createMembershipPlan(handle.db, camille.actor, orgA, {
      name: "Adhésion 12 mois",
      priceMinor: 1500,
      periodKind: "rolling",
      durationMonths: 12,
    });
    freePlan = f.id;
    paidPlan = p.id;
    rollingPlan = r.id;
    expect(f.slug).toBe("sympathisant");
    expect(p.benefits).toHaveLength(2);
    await expect(
      createMembershipPlan(handle.db, camille.actor, orgA, { name: "Sans dates", priceMinor: 0, periodKind: "fixed" }),
    ).rejects.toThrow();
    await expect(
      createMembershipPlan(handle.db, bob.actor, orgA, {
        name: "Pirate",
        priceMinor: 0,
        periodKind: "rolling",
        durationMonths: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMembershipPlans(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listPublicMembershipPlans(handle.db, orgA)).map((x) => x.name)).toEqual([
      "Sympathisant",
      "Adhésion annuelle 2027",
      "Adhésion 12 mois",
    ]);
    await updateMembershipPlan(handle.db, camille.actor, orgA, r.id, {
      name: "Adhésion 12 mois",
      priceMinor: 1500,
      periodKind: "rolling",
      durationMonths: 12,
      public: false,
    });
    expect((await listPublicMembershipPlans(handle.db, orgA)).map((x) => x.name)).toEqual([
      "Sympathisant",
      "Adhésion annuelle 2027",
    ]);
  });
});

describe("B. applications, activation, payment", () => {
  let lou: Awaited<ReturnType<typeof applyForMembership>>;
  let sessionId: string;

  it("free plan without review: active at once, one active membership per e-mail", async () => {
    const m = await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: freePlan,
      email: "Nora.Diallo@example.fr",
      firstName: "Nora",
      lastName: "Diallo",
    });
    expect(m.status).toBe("active");
    expect(m.number).toBe("M-0001");
    expect(m.validUntil?.toISOString()).toBe(season.validUntil.toISOString());
    expect(m.accessToken.length).toBeGreaterThan(20);
    expect(email.sent.at(-1)?.subject).toContain("carte adhérent");
    expect(await hasActiveMembership(handle.db, orgA, "nora.diallo@example.fr", new Date("2027-06-01T00:00:00Z"))).toBe(
      true,
    );
    expect(await hasActiveMembership(handle.db, orgA, "nora.diallo@example.fr", new Date("2028-06-01T00:00:00Z"))).toBe(
      false,
    );
    await expect(
      applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
        planId: paidPlan,
        email: "nora.diallo@example.fr",
        firstName: "Nora",
        lastName: "Diallo",
      }),
    ).rejects.toMatchObject({ details: { code: "membership_exists" } });
    // Member access: token or nothing.
    await expect(getMembershipForMember(handle.db, ctx, m.id, { accessToken: "wrong" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getMembershipForMember(handle.db, ctx, m.id, { accessToken: m.accessToken })).status).toBe("active");
    // Entitlement recorded.
    const ent = await handle.db
      .select()
      .from(schema.membershipEntitlements)
      .where(eq(schema.membershipEntitlements.membershipId, m.id));
    expect(ent[0]?.kind).toBe("member_ticket_eligibility");
  });

  it("paid plan with review: pending → approved (awaiting payment) → paid by webhook only → active", async () => {
    lou = await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: paidPlan,
      email: "lou.martin@example.fr",
      firstName: "Lou",
      lastName: "Martin",
      marketingOptIn: true,
    });
    expect(lou.status).toBe("pending");
    expect(email.sent.at(-1)?.subject).toContain("Demande d'adhésion reçue");
    await expect(
      applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
        planId: paidPlan,
        email: "lou.martin@example.fr",
        firstName: "Lou",
        lastName: "Martin",
      }),
    ).rejects.toMatchObject({ details: { code: "application_in_progress" } });
    await expect(
      startMembershipCheckout(handle.db, ctx, anon, lou.id, lou.accessToken, { successUrl: "x", cancelUrl: "y" }),
    ).rejects.toMatchObject({ details: { code: "not_awaiting_payment" } });
    await expect(approveMembership(handle.db, ctx, bob.actor, orgA, lou.id)).rejects.toBeInstanceOf(ForbiddenError);
    const approved = await approveMembership(handle.db, ctx, camille.actor, orgA, lou.id);
    expect(approved.status).toBe("awaiting_payment");
    expect(approved.application?.status).toBe("approved");
    expect(email.sent.at(-1)?.subject).toContain("paiement attendu");
    const r = await startMembershipCheckout(handle.db, ctx, anon, lou.id, lou.accessToken, {
      successUrl: "x",
      cancelUrl: "y",
    });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    sessionId = r.url.split("/paiement/")[1]!;
    // Still not active: the redirect proves nothing.
    expect((await getMembershipForMember(handle.db, ctx, lou.id, { accessToken: lou.accessToken })).status).toBe(
      "awaiting_payment",
    );
    expect(await payWebhook(sessionId, "payment.failed")).toBe("applied");
    expect((await getMembershipForMember(handle.db, ctx, lou.id, { accessToken: lou.accessToken })).status).toBe(
      "awaiting_payment",
    );
    expect(await payWebhook(sessionId, "payment.succeeded", "evt_m1")).toBe("applied");
    const active = await getMembershipForMember(handle.db, ctx, lou.id, { accessToken: lou.accessToken });
    expect(active.status).toBe("active");
    expect(active.payment?.status).toBe("succeeded");
    expect(active.payment?.amountMinor).toBe(2080); // 20 € + 4 % fee
    expect(active.validityChanges.map((c) => c.kind)).toEqual(["activated"]);
    expect(email.sent.at(-1)?.subject).toContain("carte adhérent");
    expect(await payWebhook(sessionId, "payment.succeeded", "evt_m1")).toBe("duplicate");
    expect(await payWebhook(sessionId, "payment.failed", "evt_m2")).toBe("ignored_out_of_order");
    expect((await getMembershipForMember(handle.db, ctx, lou.id, { accessToken: lou.accessToken })).status).toBe(
      "active",
    );
  });

  it("rejects with a reason, enforces the plan quota, lists and counts", async () => {
    const sam = await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: paidPlan,
      email: "sam@example.fr",
      firstName: "Sam",
      lastName: "Moreau",
    });
    const rejected = await rejectMembership(handle.db, ctx, camille.actor, orgA, sam.id, "Dossier incomplet");
    expect(rejected.status).toBe("rejected");
    expect(rejected.application?.rejectionReason).toBe("Dossier incomplet");
    expect(email.sent.at(-1)?.subject).toContain("Demande d'adhésion");
    // Quota 3 on the paid plan: Lou (active) + two pending = full.
    await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: paidPlan,
      email: "a@example.fr",
      firstName: "A",
      lastName: "A",
    });
    await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: paidPlan,
      email: "b@example.fr",
      firstName: "B",
      lastName: "B",
    });
    await expect(
      applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
        planId: paidPlan,
        email: "c@example.fr",
        firstName: "C",
        lastName: "C",
      }),
    ).rejects.toMatchObject({ details: { code: "plan_full" } });
    const list = await listMemberships(handle.db, camille.actor, orgA, { status: "pending" });
    expect(list.map((m) => m.memberEmail).sort()).toEqual(["a@example.fr", "b@example.fr"]);
    const stats = await membershipStats(handle.db, camille.actor, orgA);
    expect(stats.active).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.duesMinor).toBe(2000);
    await expect(listMemberships(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMembership(handle.db, ctx, bob.actor, orgB, lou.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("suspend / reactivate / extend (audited) / cancel; resend rotates the link", async () => {
    const suspended = await suspendMembership(handle.db, ctx, camille.actor, orgA, lou.id, "Comportement à clarifier");
    expect(suspended.status).toBe("suspended");
    expect(await hasActiveMembership(handle.db, orgA, "lou.martin@example.fr", new Date("2027-06-01T00:00:00Z"))).toBe(
      false,
    );
    expect((await reactivateMembership(handle.db, ctx, camille.actor, orgA, lou.id)).status).toBe("active");
    await expect(
      extendMembership(handle.db, ctx, camille.actor, orgA, lou.id, {
        validUntil: season.validUntil,
        reason: "Pas plus tard",
      }),
    ).rejects.toMatchObject({ details: { code: "not_later" } });
    await expect(
      extendMembership(handle.db, ctx, camille.actor, orgA, lou.id, {
        validUntil: new Date("2028-03-31T23:59:00Z"),
        reason: "x",
      }),
    ).rejects.toThrow();
    const extended = await extendMembership(handle.db, ctx, camille.actor, orgA, lou.id, {
      validUntil: new Date("2028-03-31T23:59:00Z"),
      reason: "Geste pour un bénévole",
    });
    expect(extended.validUntil?.toISOString()).toBe("2028-03-31T23:59:00.000Z");
    expect(extended.validityChanges.map((c) => c.kind)).toEqual(["activated", "suspended", "reactivated", "extended"]);
    const before = email.sent.length;
    await resendMembershipLink(handle.db, ctx, camille.actor, orgA, lou.id);
    expect(email.sent.length).toBe(before + 1);
    await expect(
      getMembershipForMember(handle.db, ctx, lou.id, { accessToken: lou.accessToken }),
    ).rejects.toBeInstanceOf(NotFoundError); // old link dead
    const fresh = await getMembership(handle.db, ctx, camille.actor, orgA, lou.id);
    expect(fresh.status).toBe("active");
    const nora = (await listMemberships(handle.db, camille.actor, orgA, { q: "nora" }))[0]!;
    const cancelled = await cancelMembership(handle.db, ctx, camille.actor, orgA, nora.id, "Demande de l'adhérente");
    expect(cancelled.status).toBe("cancelled");
    expect(await hasActiveMembership(handle.db, orgA, "nora.diallo@example.fr", new Date("2027-06-01T00:00:00Z"))).toBe(
      false,
    );
  });

  it("members-only ticket types: refused without an active membership, accepted with, re-checked at checkout", async () => {
    const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
    const ev = await createEvent(handle.db, camille.actor, orgA, {
      title: "Soirée adhérents",
      slug: "soiree-adherents",
      description: "Une soirée réservée aux membres, et à eux seuls, pour fêter la saison.",
      startsAt: parseLocalDateTime("2027-06-12", "18:00", TZ)!,
      endsAt: parseLocalDateTime("2027-06-13", "02:00", TZ)!,
      capacity: 50,
      locationId: loc.id,
    });
    const pub = await publishEvent(handle.db, camille.actor, orgA, ev.id, ev.version);
    const tt = await createTicketType(handle.db, camille.actor, orgA, pub.id, {
      name: "Tarif adhérent",
      priceMinor: 500,
      quota: 10,
      membersOnly: true,
    });
    await updateTicketingSettings(handle.db, camille.actor, orgA, pub.id, { ticketingStatus: "open" });
    const now = new Date("2027-05-01T12:00:00Z");
    await expect(
      createPublicOrder(
        handle.db,
        ctx,
        anon,
        {
          organizationSlug: DEMO.organization.slug,
          eventSlug: pub.slug,
          items: [{ ticketTypeId: tt.id, quantity: 1 }],
        },
        now,
      ),
    ).rejects.toMatchObject({ details: { code: "membership_email_required" } });
    await expect(
      createPublicOrder(
        handle.db,
        ctx,
        anon,
        {
          organizationSlug: DEMO.organization.slug,
          eventSlug: pub.slug,
          items: [{ ticketTypeId: tt.id, quantity: 1 }],
          email: "nobody@example.fr",
        },
        now,
      ),
    ).rejects.toMatchObject({ details: { code: "membership_required" } });
    const order = await createPublicOrder(
      handle.db,
      ctx,
      anon,
      {
        organizationSlug: DEMO.organization.slug,
        eventSlug: pub.slug,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
        email: "lou.martin@example.fr",
      },
      now,
    );
    expect(order.status).toBe("reserved");
    // Swapping to a non-member e-mail at step 2 is refused; keeping the member e-mail works.
    await expect(
      updateBuyerDetails(
        handle.db,
        ctx,
        order.id,
        order.accessToken,
        {
          email: "other@example.fr",
          firstName: "O",
          lastName: "T",
          attendees: [{ ticketTypeId: tt.id, names: ["O T"] }],
        },
        now,
      ),
    ).rejects.toMatchObject({ details: { code: "membership_required" } });
    await updateBuyerDetails(
      handle.db,
      ctx,
      order.id,
      order.accessToken,
      {
        email: "lou.martin@example.fr",
        firstName: "Lou",
        lastName: "Martin",
        attendees: [{ ticketTypeId: tt.id, names: ["Lou Martin"] }],
      },
      now,
    );
    const r = await startCheckout(
      handle.db,
      ctx,
      anon,
      order.id,
      order.accessToken,
      { successUrl: "x", cancelUrl: "y" },
      now,
    );
    expect(r.kind).toBe("redirect");
  });
});

describe("C. renewal, expiry, reminders", () => {
  it("expires memberships past validity, reminds once before expiry, renews into a new linked membership", async () => {
    // Rolling plan (private now): make it public so it can be renewed into.
    await updateMembershipPlan(handle.db, camille.actor, orgA, rollingPlan, {
      name: "Adhésion 12 mois",
      priceMinor: 0,
      periodKind: "rolling",
      durationMonths: 12,
      public: true,
    });
    const m = await applyForMembership(
      handle.db,
      ctx,
      anon,
      DEMO.organization.slug,
      { planId: rollingPlan, email: "hugo@example.fr", firstName: "Hugo", lastName: "Petit" },
      {},
      new Date("2026-01-10T10:00:00Z"),
    );
    expect(m.status).toBe("active");
    expect(m.validUntil?.toISOString()).toBe("2027-01-10T10:00:00.000Z");
    // Reminder: 20 days before expiry → sent once.
    expect(await sendRenewalReminders(handle.db, ctx, system, new Date("2026-12-21T00:00:00Z"))).toBe(1);
    expect(email.sent.at(-1)?.subject).toContain("expire bientôt");
    expect(await sendRenewalReminders(handle.db, ctx, system, new Date("2026-12-22T00:00:00Z"))).toBe(0);
    // Renewal offered in the window; the new membership chains after the previous validity.
    const card = await getMembershipForMember(
      handle.db,
      ctx,
      m.id,
      { accessToken: m.accessToken },
      new Date("2026-12-22T00:00:00Z"),
    );
    expect(card.renewalPlans.map((p) => p.id)).toContain(rollingPlan);
    const renewed = await renewMembership(
      handle.db,
      ctx,
      anon,
      m.id,
      m.accessToken,
      rollingPlan,
      new Date("2026-12-22T00:00:00Z"),
    );
    expect(renewed.status).toBe("active");
    expect(renewed.renewedFrom).toBe(m.id);
    expect(renewed.validFrom?.toISOString()).toBe("2027-01-10T10:00:00.000Z");
    expect(renewed.validUntil?.toISOString()).toBe("2028-01-10T10:00:00.000Z");
    const previous = await getMembership(handle.db, ctx, camille.actor, orgA, m.id);
    expect(previous.status).toBe("expired"); // replaced by the renewal (one active per person)
    expect(previous.validityChanges.at(-1)?.kind).toBe("renewed");
    await expect(renewMembership(handle.db, ctx, anon, m.id, m.accessToken, rollingPlan)).rejects.toMatchObject({
      details: { code: "already_renewed" },
    });
    // Expiry job: nothing yet at 2027-06, the renewal expires at 2028-02.
    expect(await expireMemberships(handle.db, ctx, system, new Date("2027-06-01T00:00:00Z"))).toBe(0);
    expect(await expireMemberships(handle.db, ctx, system, new Date("2028-02-01T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect((await getMembership(handle.db, ctx, camille.actor, orgA, renewed.id)).status).toBe("expired");
    expect(email.sent.some((e) => e.subject.includes("Adhésion expirée"))).toBe(true);
    await expect(expireMemberships(handle.db, ctx, camille.actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reactivateMembership(handle.db, ctx, camille.actor, orgA, renewed.id)).rejects.toThrow();
    await archiveMembershipPlan(handle.db, camille.actor, orgA, rollingPlan);
    expect((await listPublicMembershipPlans(handle.db, orgA)).map((p) => p.id)).not.toContain(rollingPlan);
  });
});
