import { type DatabaseHandle, schema } from "@kroov/database";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import {
  type Actor,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  parseLocalDateTime,
} from "@kroov/domain/kernel";
import { acceptInvitation, createInvitation, createOrganization } from "@kroov/domain/organizations";
import {
  allocateDiscount,
  applyPromoCode,
  archiveTicketType,
  checkinSummary,
  computeTotals,
  createPool,
  createPromoCode,
  createPublicOrder,
  createRefund,
  createTicketType,
  expireOverdueOrders,
  getOrder,
  getOrderForBuyer,
  getPublicTicketing,
  getTicketByViewToken,
  ledgerBalances,
  listOrders,
  listTicketTypes,
  markOrderPaid,
  orderStateMachine,
  paymentStateMachine,
  processProviderEvent,
  scanTicket,
  startCheckout,
  startPaymentOnboarding,
  type TicketingContext,
  ticketingStats,
  ticketStateMachine,
  updateBuyerDetails,
  updateTicketingSettings,
  updateTicketType,
} from "@kroov/domain/ticketing";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "@kroov/payments";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A
let yanis: TestUser; // scanner of A
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let eventA: { id: string; slug: string };
let eventB: { id: string; slug: string };
let standard: string; // paid type, quota 5
let early: string; // paid type, quota 3, in a shared pool of 6 with standard
let free: string; // free type
let email: ConsoleEmailAdapter;
let provider: FakePaymentProvider;
let ctx: TicketingContext;
const anon: Actor = { kind: "anonymous" };
const system: Actor = { kind: "system", job: "test" };
const TZ = "Europe/Paris";

async function webhook(
  type: "payment.succeeded" | "payment.failed" | "payment.cancelled",
  sessionId: string,
  opts: { eventId?: string; occurredAt?: Date } = {},
) {
  const body = buildFakeWebhookBody({
    type,
    objectId: sessionId,
    eventId: opts.eventId,
    chargeRef: type === "payment.succeeded" ? `ch_${sessionId}` : undefined,
    occurredAt: opts.occurredAt,
  });
  const event = await provider.verifyWebhook(body, signFakeWebhook("test-secret-xxxxxxxxxxxx", body));
  return processProviderEvent(handle.db, ctx, event);
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
    holdMinutes: 10,
  };
  camille = await createTestUser(handle.db, DEMO.owner);
  yanis = await createTestUser(handle.db, DEMO.scanner);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const mk = async (actor: Actor, org: string, title: string, slug: string, locationId?: string) => {
    const e = await createEvent(handle.db, actor, org, {
      title,
      slug,
      description: "Une nuit entière de musique, trois scènes et un espace calme pour souffler.",
      startsAt: parseLocalDateTime("2027-06-12", "18:00", TZ)!,
      endsAt: parseLocalDateTime("2027-06-13", "02:00", TZ)!,
      capacity: 8,
      ...(locationId ? { locationId } : {}),
    });
    return e;
  };
  const a = await mk(camille.actor, orgA, "Les Nuits en Commun", "les-nuits-en-commun", loc.id);
  const published = await publishEvent(handle.db, camille.actor, orgA, a.id, a.version);
  eventA = { id: published.id, slug: published.slug };
  const locB = await createLocation(handle.db, bob.actor, orgB, { name: "Salle B", city: "Paris" });
  const b = await mk(bob.actor, orgB, "Soirée B", "soiree-b", locB.id);
  const pb = await publishEvent(handle.db, bob.actor, orgB, b.id, b.version);
  eventB = { id: pb.id, slug: pb.slug };
  // Yanis: scanner of A (organization-wide).
  await createInvitation(handle.db, camille.actor, { email, appName: "Kroov", appUrl: "http://test.local" }, orgA, {
    email: yanis.email,
    role: "scanner",
  });
  const invitationMail = email.sent.findLast((m) => m.to === yanis.email);
  const token = invitationMail?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("invitation token not found in outbox");
  await acceptInvitation(handle.db, yanis.actor, token);
  // Payment account of A (fake provider: active at once).
  await startPaymentOnboarding(handle.db, ctx, camille.actor, orgA, {
    returnUrl: "http://test.local/r",
    refreshUrl: "http://test.local/f",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("A. state machines and pricing", () => {
  it("declare the documented graphs", () => {
    expect(orderStateMachine.canTransition("reserved", "paid")).toBe(true);
    expect(orderStateMachine.canTransition("paid", "reserved")).toBe(false);
    expect(orderStateMachine.canTransition("expired", "paid")).toBe(true); // late payment reconciliation
    expect(paymentStateMachine.canTransition("failed", "succeeded")).toBe(true);
    expect(paymentStateMachine.canTransition("succeeded", "failed")).toBe(false);
    expect(ticketStateMachine.canTransition("valid", "used")).toBe(true);
    expect(ticketStateMachine.canTransition("used", "valid")).toBe(false);
  });

  it("computes fees on paid tickets only, discounts on the subtotal only, integers everywhere", () => {
    const totals = computeTotals(
      [
        { ticketTypeId: "a", label: "Standard", quantity: 2, unitPriceMinor: 3000, unitFeeMinor: 120 },
        { ticketTypeId: "b", label: "Gratuit", quantity: 1, unitPriceMinor: 0, unitFeeMinor: 0 },
      ],
      { kind: "percent", value: 1000 },
    );
    expect(totals).toEqual({ subtotalMinor: 6000, discountMinor: 600, feesMinor: 240, totalMinor: 5640 });
    expect(
      computeTotals([{ ticketTypeId: "a", label: "x", quantity: 1, unitPriceMinor: 1000, unitFeeMinor: 40 }], {
        kind: "amount",
        value: 5000,
      }).totalMinor,
    ).toBe(40);
    expect(allocateDiscount([3000, 3000, 1000], 100)).toEqual([43, 43, 14]);
  });
});

describe("B. ticket types, pools, settings", () => {
  it("creates types (paid, free), a shared pool and refuses opening sales without a type", async () => {
    await expect(
      updateTicketingSettings(handle.db, camille.actor, orgA, eventA.id, { ticketingStatus: "open" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    const pool = await createPool(handle.db, camille.actor, orgA, eventA.id, { name: "Salle", capacity: 6 });
    const s = await createTicketType(handle.db, camille.actor, orgA, eventA.id, {
      name: "Tarif standard",
      priceMinor: 3000,
      quota: 5,
      poolId: pool.id,
      maxPerOrder: 4,
    });
    const e = await createTicketType(handle.db, camille.actor, orgA, eventA.id, {
      name: "Première vague",
      priceMinor: 2400,
      quota: 3,
      poolId: pool.id,
    });
    const f = await createTicketType(handle.db, camille.actor, orgA, eventA.id, {
      name: "Bénévole",
      priceMinor: 0,
      quota: 2,
      hidden: true,
    });
    standard = s.id;
    early = e.id;
    free = f.id;
    expect(s.available).toBe(5);
    expect(e.available).toBe(3);
    expect(f.available).toBe(2);
    const settings = await updateTicketingSettings(handle.db, camille.actor, orgA, eventA.id, {
      ticketingStatus: "open",
      maxTicketsPerOrder: 6,
    });
    expect(settings.ticketingStatus).toBe("open");
    const pub = await getPublicTicketing(handle.db, orgA, eventA.id, ctx.fees);
    expect(pub.open).toBe(true);
    expect(pub.types.map((t) => t.name)).toEqual(["Tarif standard", "Première vague"]); // hidden type absent
    expect(pub.types[0]?.unitFeeMinor).toBe(120); // 4 % of 30 €
  });

  it("B cannot manage A's ticket types; a scanner cannot either", async () => {
    await expect(
      createTicketType(handle.db, bob.actor, orgA, eventA.id, { name: "Pirate", priceMinor: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createTicketType(handle.db, yanis.actor, orgA, eventA.id, { name: "Pirate", priceMinor: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTicketTypes(handle.db, bob.actor, orgA, eventA.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("C. reservations and inventory", () => {
  it("reserves seats, creates pending tickets, enforces per-order limits and sale rules", async () => {
    await expect(
      createPublicOrder(handle.db, ctx, anon, {
        organizationSlug: DEMO.organization.slug,
        eventSlug: eventA.slug,
        items: [{ ticketTypeId: standard, quantity: 5 }],
      }),
    ).rejects.toMatchObject({ details: { code: "quantity_out_of_range" } });
    const order = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 2 }],
    });
    expect(order.status).toBe("reserved");
    expect(order.number).toBe("KR-1000");
    expect(order.tickets.map((t) => t.number)).toEqual(["KR-1000-01", "KR-1000-02"]);
    expect(order.tickets.every((t) => t.status === "pending")).toBe(true);
    expect(order.totalMinor).toBe(6240);
    expect(order.accessToken.length).toBeGreaterThan(20);
    const types = await listTicketTypes(handle.db, camille.actor, orgA, eventA.id);
    expect(types.find((t) => t.id === standard)?.held).toBe(2);
    expect(types.find((t) => t.id === standard)?.available).toBe(3);
    // The pool (6) is shared: early now has min(3, 6-2) = 3 left; after 2 more standard → pool 2 left.
    expect(types.find((t) => t.id === early)?.available).toBe(3);
    // Buyer access: wrong token → 404.
    await expect(getOrderForBuyer(handle.db, ctx, order.id, { accessToken: "wrong" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getOrderForBuyer(handle.db, ctx, order.id, { accessToken: order.accessToken })).number).toBe(
      "KR-1000",
    );
  });

  it("never oversells under concurrency: 10 parallel buyers for 3 remaining seats", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createPublicOrder(handle.db, ctx, anon, {
          organizationSlug: DEMO.organization.slug,
          eventSlug: eventA.slug,
          items: [{ ticketTypeId: standard, quantity: 1 }],
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(3);
    expect(ko).toHaveLength(7);
    for (const r of ko) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PreconditionFailedError);
      expect(((r as PromiseRejectedResult).reason as PreconditionFailedError).details?.code).toBe(
        "insufficient_inventory",
      );
    }
    const types = await listTicketTypes(handle.db, camille.actor, orgA, eventA.id);
    expect(types.find((t) => t.id === standard)?.available).toBe(0);
    // Shared pool (6) with 5 seats held: early has 1 left although its own quota (3) is untouched.
    expect(types.find((t) => t.id === early)?.available).toBe(1);
    // Release the three one-seat orders by expiring them (simulate deadline passed).
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(schema.orders.status, "reserved"), eq(schema.orders.number, "KR-1001")));
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(schema.orders.status, "reserved"), eq(schema.orders.number, "KR-1002")));
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(schema.orders.status, "reserved"), eq(schema.orders.number, "KR-1003")));
    expect(await expireOverdueOrders(handle.db, system)).toBe(3);
    const after = await listTicketTypes(handle.db, camille.actor, orgA, eventA.id);
    expect(after.find((t) => t.id === standard)?.available).toBe(3);
    const expiredRow = (
      await handle.db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.status, "expired"))
        .limit(1)
    )[0]!;
    const expired = await getOrder(handle.db, camille.actor, orgA, expiredRow.id);
    expect(expired.tickets.every((t) => t.status === "revoked")).toBe(true);
    // Abandoned reservations without buyer details stay out of the organizer's list (noise).
    expect((await listOrders(handle.db, camille.actor, orgA, { status: "expired" })).length).toBe(0);
    await expect(expireOverdueOrders(handle.db, camille.actor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses reservations when sales are closed or the type is not on sale", async () => {
    await updateTicketingSettings(handle.db, camille.actor, orgA, eventA.id, { ticketingStatus: "closed" });
    await expect(
      createPublicOrder(handle.db, ctx, anon, {
        organizationSlug: DEMO.organization.slug,
        eventSlug: eventA.slug,
        items: [{ ticketTypeId: standard, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ details: { code: "ticketing_closed" } });
    await updateTicketingSettings(handle.db, camille.actor, orgA, eventA.id, { ticketingStatus: "open" });
    await updateTicketType(handle.db, camille.actor, orgA, eventA.id, early, {
      salesStartAt: new Date(Date.now() + 86_400_000),
    });
    await expect(
      createPublicOrder(handle.db, ctx, anon, {
        organizationSlug: DEMO.organization.slug,
        eventSlug: eventA.slug,
        items: [{ ticketTypeId: early, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ details: { code: "not_on_sale" } });
    await updateTicketType(handle.db, camille.actor, orgA, eventA.id, early, { salesStartAt: null });
  });
});

describe("D. checkout, webhooks, issuance", () => {
  let paidOrder: { id: string; accessToken: string; sessionId: string };

  it("requires buyer details, then creates a provider session (no ticket issued yet)", async () => {
    const fresh = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 2 }],
    });
    await expect(
      startCheckout(handle.db, ctx, anon, fresh.id, fresh.accessToken, {
        successUrl: "http://test.local/ok",
        cancelUrl: "http://test.local/ko",
      }),
    ).rejects.toMatchObject({
      details: { code: "buyer_details_required" },
    });
    await updateBuyerDetails(handle.db, ctx, fresh.id, fresh.accessToken, {
      email: "lou.martin@example.fr",
      firstName: "Lou",
      lastName: "Martin",
    });
    await expect(
      startCheckout(handle.db, ctx, anon, fresh.id, fresh.accessToken, {
        successUrl: "http://test.local/ok",
        cancelUrl: "http://test.local/ko",
      }),
    ).rejects.toMatchObject({
      details: { code: "attendees_required" },
    });
    await updateBuyerDetails(handle.db, ctx, fresh.id, fresh.accessToken, {
      email: "lou.martin@example.fr",
      firstName: "Lou",
      lastName: "Martin",
      attendees: [{ ticketTypeId: standard, names: ["Lou Martin", "Sam Moreau"] }],
    });
    const result = await startCheckout(handle.db, ctx, anon, fresh.id, fresh.accessToken, {
      successUrl: "http://test.local/ok",
      cancelUrl: "http://test.local/ko",
    });
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") throw new Error("expected redirect");
    expect(result.url).toContain("/paiement/cs_fake_");
    const view = await getOrderForBuyer(handle.db, ctx, fresh.id, { accessToken: fresh.accessToken });
    expect(view.status).toBe("awaiting_payment");
    expect(view.tickets.every((t) => t.status === "pending")).toBe(true);
    expect(view.payment?.status).toBe("pending");
    paidOrder = { id: fresh.id, accessToken: fresh.accessToken, sessionId: result.url.split("/paiement/")[1]! };
  });

  it("issues tickets ONLY on a verified webhook, once; duplicates are no-ops; ledger balances", async () => {
    // A `failed` first (card refused), then `succeeded` (second card): the order recovers.
    expect(await webhook("payment.failed", paidOrder.sessionId)).toBe("applied");
    expect((await getOrderForBuyer(handle.db, ctx, paidOrder.id, { accessToken: paidOrder.accessToken })).status).toBe(
      "failed",
    );
    expect(email.sent.at(-1)?.subject).toContain("Paiement non abouti");
    const sentBefore = email.sent.length;
    expect(await webhook("payment.succeeded", paidOrder.sessionId, { eventId: "evt_1" })).toBe("applied");
    const view = await getOrderForBuyer(handle.db, ctx, paidOrder.id, { accessToken: paidOrder.accessToken });
    expect(view.status).toBe("paid");
    expect(view.tickets.map((t) => t.status)).toEqual(["valid", "valid"]);
    expect(view.tickets.map((t) => t.attendeeName)).toEqual(["Lou Martin", "Sam Moreau"]);
    expect(view.payment?.status).toBe("succeeded");
    expect(email.sent.length).toBe(sentBefore + 1);
    expect(email.sent.at(-1)?.text).toContain("/billets/");
    // Duplicate delivery (same event id) and a late `failed` are both ignored.
    expect(await webhook("payment.succeeded", paidOrder.sessionId, { eventId: "evt_1" })).toBe("duplicate");
    expect(await webhook("payment.failed", paidOrder.sessionId, { eventId: "evt_2" })).toBe("ignored_out_of_order");
    expect((await getOrderForBuyer(handle.db, ctx, paidOrder.id, { accessToken: paidOrder.accessToken })).status).toBe(
      "paid",
    );
    const balances = await ledgerBalances(handle.db, orgA);
    expect(balances.receivable_provider).toBe(6240);
    expect(balances.revenue_tickets).toBe(-6000);
    expect(balances.platform_fees).toBe(-240);
    // Unknown session → ignored, not an error; invalid signature → rejected before processing.
    expect(await webhook("payment.succeeded", "cs_fake_unknown")).toBe("ignored_unknown");
    const body = buildFakeWebhookBody({ type: "payment.succeeded", objectId: paidOrder.sessionId });
    await expect(provider.verifyWebhook(body, "v1=deadbeef")).rejects.toThrow(/Signature/);
    const stats = await ticketingStats(handle.db, camille.actor, orgA, eventA.id);
    expect(stats.paidTickets).toBe(2);
    expect(stats.grossRevenueMinor).toBe(6000);
  });

  it("pays a free order immediately and applies promo codes with their caps", async () => {
    await createPromoCode(handle.db, camille.actor, orgA, eventA.id, {
      code: "nuit-10",
      kind: "percent",
      value: 1000,
      maxRedemptions: 1,
    });
    const o = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 1 }],
    });
    const withPromo = await applyPromoCode(handle.db, ctx, o.id, o.accessToken, "NUIT-10");
    expect(withPromo.discountMinor).toBe(300);
    expect(withPromo.totalMinor).toBe(2820);
    await expect(applyPromoCode(handle.db, ctx, o.id, o.accessToken, "INCONNU")).rejects.toMatchObject({
      details: { code: "promo_invalid" },
    });
    // Free (hidden) type: paid at once, tickets valid, confirmation sent, no payment row.
    const f = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: free, quantity: 1 }],
    });
    await updateBuyerDetails(handle.db, ctx, f.id, f.accessToken, {
      email: "benevole@example.fr",
      firstName: "Nora",
      lastName: "Diallo",
      attendees: [{ ticketTypeId: free, names: ["Nora Diallo"] }],
    });
    const r = await startCheckout(handle.db, ctx, anon, f.id, f.accessToken, { successUrl: "x", cancelUrl: "y" });
    expect(r.kind).toBe("paid");
    const fv = await getOrderForBuyer(handle.db, ctx, f.id, { accessToken: f.accessToken });
    expect(fv.status).toBe("paid");
    expect(fv.tickets[0]?.status).toBe("valid");
    expect(fv.payment).toBeNull();
    expect(email.sent.at(-1)?.subject).toContain("Vos billets");
  });

  it("reconciles a late payment: re-reserves when seats remain, refunds automatically otherwise", async () => {
    // Clear every live reservation so the arithmetic below is deterministic.
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.status, "reserved"));
    await expireOverdueOrders(handle.db, system);
    // Order 1: expires before the webhook, seats still available → paid late, fresh tickets issued.
    const late = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: early, quantity: 1 }],
    });
    await updateBuyerDetails(handle.db, ctx, late.id, late.accessToken, {
      email: "late@example.fr",
      firstName: "Léa",
      lastName: "Tardive",
      attendees: [{ ticketTypeId: early, names: ["Léa Tardive"] }],
    });
    const r = await startCheckout(handle.db, ctx, anon, late.id, late.accessToken, { successUrl: "x", cancelUrl: "y" });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.id, late.id));
    expect(await expireOverdueOrders(handle.db, system)).toBe(1);
    expect((await getOrderForBuyer(handle.db, ctx, late.id, { accessToken: late.accessToken })).status).toBe("expired");
    expect(await webhook("payment.succeeded", r.url.split("/paiement/")[1]!)).toBe("applied");
    const v = await getOrderForBuyer(handle.db, ctx, late.id, { accessToken: late.accessToken });
    expect(v.status).toBe("paid");
    expect(v.tickets.filter((t) => t.status === "valid")).toHaveLength(1);
    expect(v.tickets.filter((t) => t.status === "revoked")).toHaveLength(1);
    // Order 2: late, but meanwhile the pool got full → automatic refund, order stays expired.
    // State: standard sold 2 (paid order), early sold 1 → pool 3/6, early 2 left, standard 3 left.
    const filler = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: early, quantity: 2 }],
    });
    void filler; // pool 5/6
    const late2 = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 1 }],
    }); // pool 6/6
    await updateBuyerDetails(handle.db, ctx, late2.id, late2.accessToken, {
      email: "late2@example.fr",
      firstName: "Max",
      lastName: "Tardif",
      attendees: [{ ticketTypeId: standard, names: ["Max Tardif"] }],
    });
    const r2 = await startCheckout(handle.db, ctx, anon, late2.id, late2.accessToken, {
      successUrl: "x",
      cancelUrl: "y",
    });
    if (r2.kind !== "redirect") throw new Error("expected redirect");
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.id, late2.id));
    expect(await expireOverdueOrders(handle.db, system)).toBe(1); // pool back to 5/6
    const taker = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 1 }],
    }); // pool 6/6 again
    expect(
      (await listTicketTypes(handle.db, camille.actor, orgA, eventA.id)).find((t) => t.id === standard)?.available,
    ).toBe(0);
    expect(await webhook("payment.succeeded", r2.url.split("/paiement/")[1]!)).toBe("refunded_late_payment");
    const v2 = await getOrderForBuyer(handle.db, ctx, late2.id, { accessToken: late2.accessToken });
    expect(v2.status).toBe("expired");
    expect(v2.refunds[0]?.status).toBe("succeeded");
    expect(email.sent.at(-1)?.subject).toContain("Paiement remboursé");
    // Release the helper reservations.
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.id, taker.id));
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.id, filler.id));
    expect(await expireOverdueOrders(handle.db, system)).toBe(2);
  });

  it("refunds a duplicate payment on an already paid order", async () => {
    // Second session for the same (now paid) order: the provider still settles it.
    const sessions = [...provider.sessions.values()].filter((s) => s.orderId === paidOrder.id);
    expect(sessions).toHaveLength(1);
    // Simulate a second payment row referencing a new session (buyer opened checkout twice).
    const s2 = `cs_fake_dup${Date.now()}`;
    const order = (await handle.db.select().from(schema.orders).where(eq(schema.orders.id, paidOrder.id)))[0]!;
    await handle.db.insert(schema.payments).values({
      organizationId: orgA,
      orderId: paidOrder.id,
      provider: "fake",
      providerRef: s2,
      status: "pending",
      amountMinor: order.totalMinor,
      applicationFeeMinor: order.feesMinor,
      currency: "EUR",
    });
    expect(await webhook("payment.succeeded", s2)).toBe("refunded_duplicate_payment");
    const refunds = await handle.db.select().from(schema.refunds).where(eq(schema.refunds.orderId, paidOrder.id));
    expect(refunds.some((r) => r.reason.includes("double") && r.status === "succeeded")).toBe(true);
    expect((await getOrder(handle.db, camille.actor, orgA, paidOrder.id)).status).toBe("paid");
  });

  it("scans: accepted once, then already_used; other event or unknown → invalid; permission enforced", async () => {
    const view = await getOrderForBuyer(handle.db, ctx, paidOrder.id, { accessToken: paidOrder.accessToken });
    const t1 = view.tickets[0]!;
    const page = await getTicketByViewToken(handle.db, ctx, view.ticketLinks[t1.id]!);
    expect(page.qrCredential).toBeTruthy();
    expect(page.number).toBe(t1.number);
    await expect(getTicketByViewToken(handle.db, ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(scanTicket(handle.db, ctx, bob.actor, orgA, eventA.id, page.qrCredential!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const first = await scanTicket(handle.db, ctx, yanis.actor, orgA, eventA.id, page.qrCredential!, "iphone-yanis");
    expect(first.result).toBe("accepted");
    expect(first.counters.admitted).toBe(1);
    const second = await scanTicket(handle.db, ctx, yanis.actor, orgA, eventA.id, page.qrCredential!);
    expect(second.result).toBe("already_used");
    expect(second.firstScan?.byName).toBe(DEMO.scanner.name);
    // Concurrent double scan of the remaining valid ticket: exactly one accepted.
    const t2 = view.tickets[1]!;
    const page2 = await getTicketByViewToken(handle.db, ctx, view.ticketLinks[t2.id]!);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => scanTicket(handle.db, ctx, yanis.actor, orgA, eventA.id, page2.qrCredential!)),
    );
    expect(results.filter((r) => r.result === "accepted")).toHaveLength(1);
    // A's credential scanned at B's event: invalid, nothing disclosed.
    expect((await scanTicket(handle.db, ctx, bob.actor, orgB, eventB.id, page.qrCredential!)).result).toBe("invalid");
    expect((await scanTicket(handle.db, ctx, yanis.actor, orgA, eventA.id, "garbage-credential")).result).toBe(
      "invalid",
    );
    const summary = await checkinSummary(handle.db, yanis.actor, orgA, eventA.id);
    expect(summary.admitted).toBe(2);
    expect(summary.recent[0]?.result).toBe("invalid");
  });

  it("refunds one used ticket then the rest; never more than collected; refunded tickets are rejected at the door", async () => {
    const view = await getOrder(handle.db, camille.actor, orgA, paidOrder.id);
    const t1 = view.tickets[0]!;
    // A scanner has no orders.read: the order is not even disclosed (404), let alone refundable.
    await expect(
      createRefund(handle.db, ctx, yanis.actor, orgA, paidOrder.id, { ticketIds: [t1.id], reason: "Demande" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRefund(handle.db, ctx, bob.actor, orgA, paidOrder.id, { ticketIds: [t1.id], reason: "Demande" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const partial = await createRefund(handle.db, ctx, camille.actor, orgA, paidOrder.id, {
      ticketIds: [t1.id],
      reason: "Demande de l'acheteur",
    });
    expect(partial.status).toBe("partially_refunded");
    expect(partial.tickets.find((t) => t.id === t1.id)?.status).toBe("refunded");
    expect(partial.refunds.at(-1)?.amountMinor).toBe(3120);
    expect(email.sent.at(-1)?.subject).toContain("Remboursement");
    await expect(
      createRefund(handle.db, ctx, camille.actor, orgA, paidOrder.id, { ticketIds: [t1.id], reason: "Encore" }),
    ).rejects.toMatchObject({ details: { code: "already_refunded" } });
    const page = await getTicketByViewToken(
      handle.db,
      ctx,
      (await getOrderForBuyer(handle.db, ctx, paidOrder.id, { accessToken: paidOrder.accessToken })).ticketLinks[
        t1.id
      ]!,
    );
    expect(page.qrCredential).toBeNull();
    const full = await createRefund(handle.db, ctx, camille.actor, orgA, paidOrder.id, {
      full: true,
      reason: "Annulation complète",
    });
    expect(full.status).toBe("refunded");
    expect(full.payment?.refundedMinor).toBe(6240);
    await expect(
      createRefund(handle.db, ctx, camille.actor, orgA, paidOrder.id, { full: true, reason: "Trop" }),
    ).rejects.toMatchObject({ details: { code: "order_not_refundable" } });
    const balances = await ledgerBalances(handle.db, orgA);
    // Only the duplicate-payment refund (no ledger) and the two refunds on the paid order: receivable back to the free/late orders' amounts.
    expect(balances.revenue_tickets).toBeLessThanOrEqual(0);
    expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0);
    // Seats are released: standard availability grew back.
    const types = await listTicketTypes(handle.db, camille.actor, orgA, eventA.id);
    expect(types.find((t) => t.id === standard)?.sold).toBe(0);
  });

  it("tenant isolation on orders: B cannot read or list A's orders; scoped reads are 404", async () => {
    await expect(getOrder(handle.db, bob.actor, orgA, paidOrder.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listOrders(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOrder(handle.db, bob.actor, orgB, paidOrder.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listOrders(handle.db, bob.actor, orgB)).toEqual([]);
  });

  it("archiving a type with live holds is refused; archived types are no longer sold", async () => {
    const o = await createPublicOrder(handle.db, ctx, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 1 }],
    });
    await expect(archiveTicketType(handle.db, camille.actor, orgA, eventA.id, standard)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await handle.db
      .update(schema.orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orders.id, o.id));
    await expireOverdueOrders(handle.db, system);
    await archiveTicketType(handle.db, camille.actor, orgA, eventA.id, standard);
    await expect(
      createPublicOrder(handle.db, ctx, anon, {
        organizationSlug: DEMO.organization.slug,
        eventSlug: eventA.slug,
        items: [{ ticketTypeId: standard, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the paid transition cannot be forged outside the service: markOrderPaid is idempotent on paid orders", async () => {
    const order = (await handle.db.select().from(schema.orders).where(eq(schema.orders.id, paidOrder.id)))[0]!;
    const res = await handle.db.transaction((tx) => markOrderPaid(tx, ctx, system, order, { paymentId: null }));
    expect(res.alreadyPaid).toBe(true);
  });
});
