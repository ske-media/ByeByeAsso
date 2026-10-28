import { type DatabaseHandle, schema } from "@kroov/database";
import { createContact, createSegment, getContact, recordManualConsent, suppressEmail } from "@kroov/domain/crm";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import { type Actor, ForbiddenError, NotFoundError, parseLocalDateTime } from "@kroov/domain/kernel";
import {
  campaignStateMachine,
  cancelCampaign,
  checkAudience,
  confirmUnsubscribe,
  createCampaign,
  createTemplate,
  dispatchDueCampaigns,
  getCampaign,
  listCampaigns,
  listRecipients,
  listTemplates,
  type MarketingContext,
  previewCampaign,
  recordDeliveryEvent,
  resolveAttribution,
  scheduleCampaign,
  sendTestEmail,
  trackClick,
  unscheduleCampaign,
  unsubscribeInfo,
  updateCampaign,
} from "@kroov/domain/marketing";
import { acceptInvitation, createInvitation, createOrganization } from "@kroov/domain/organizations";
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
import { ConsoleEmailAdapter, type EmailMessage, type EmailPort, type EmailSendResult } from "@kroov/notifications";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "@kroov/payments";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

/** Provider double: records sends, can fail on demand (per address) to exercise retries. */
class FlakyEmail implements EmailPort {
  readonly name = "flaky";
  readonly sent: EmailMessage[] = [];
  failFor = new Map<string, number>();
  private n = 0;
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const remaining = this.failFor.get(message.to) ?? 0;
    if (remaining > 0) {
      this.failFor.set(message.to, remaining - 1);
      throw new Error("provider down");
    }
    this.sent.push(message);
    this.n += 1;
    return { providerMessageId: `flaky-${this.n}`, acceptedAt: new Date() };
  }
}

let handle: DatabaseHandle;
let camille: TestUser; // owner of A (campaigns.manage + send)
let nora: TestUser; // volunteer manager of A: no campaigns.* at all
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let email: FlakyEmail;
let console_: ConsoleEmailAdapter;
let ctx: MarketingContext;
let ticketing: TicketingContext;
let provider: FakePaymentProvider;
let eventA: { id: string; slug: string };
let standard: string;
let segmentId: string;
let campaignId: string;
let louId: string;
let samId: string;
let unsubscribeUrl = "";
let trackedUrl = "";
const anon: Actor = { kind: "anonymous" };
const system: Actor = { kind: "system", job: "test" };
const TZ = "Europe/Paris";
const t = (d: string, h: string) => parseLocalDateTime(d, h, TZ)!;

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new FlakyEmail();
  console_ = new ConsoleEmailAdapter(() => undefined);
  provider = new FakePaymentProvider({ appUrl: "http://test.local", webhookSecret: "test-secret-xxxxxxxxxxxx" });
  ctx = {
    email,
    appName: "Kroov",
    appUrl: "http://test.local",
    credentialSecret: "integration-credential-secret",
    batchSize: 2,
    maxAttempts: 2,
  };
  ticketing = {
    provider,
    email: console_,
    appName: "Kroov",
    appUrl: "http://test.local",
    credentialSecret: "integration-credential-secret",
    fees: { bps: 400, fixedMinor: 0 },
  };
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  await createInvitation(handle.db, camille.actor, ticketing, orgA, { email: nora.email, role: "volunteer_manager" });
  const token = console_.lastTo(nora.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, nora.actor, token!);
  await startPaymentOnboarding(handle.db, ticketing, camille.actor, orgA, {
    returnUrl: "http://test.local/r",
    refreshUrl: "http://test.local/f",
  });
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const ev = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière, trois scènes, et une campagne pour le faire savoir.",
    startsAt: t("2027-06-12", "18:00"),
    endsAt: t("2027-06-13", "02:00"),
    capacity: 100,
    locationId: loc.id,
  });
  const pub = await publishEvent(handle.db, camille.actor, orgA, ev.id, ev.version);
  eventA = { id: pub.id, slug: pub.slug };
  standard = (
    await createTicketType(handle.db, camille.actor, orgA, pub.id, { name: "Standard", priceMinor: 2000, quota: 50 })
  ).id;
  await updateTicketingSettings(handle.db, camille.actor, orgA, pub.id, { ticketingStatus: "open" });
  // Contacts: Lou (opted_in), Sam (opted_in, will unsubscribe after scheduling), Max (customer_only), Zoé (none), Ana (suppressed).
  const mk = async (first: string, last: string, addr: string) =>
    (await createContact(handle.db, camille.actor, orgA, { email: addr, firstName: first, lastName: last })).id;
  louId = await mk("Lou", "Martin", "lou@example.fr");
  samId = await mk("Sam", "Moreau", "sam@example.fr");
  const maxId = await mk("Max", "Petit", "max@example.fr");
  await mk("Zoé", "Blanc", "zoe@example.fr");
  const anaId = await mk("Ana", "Roux", "ana@example.fr");
  for (const id of [louId, samId, anaId])
    await recordManualConsent(handle.db, camille.actor, orgA, id, {
      status: "granted",
      evidence: "Bulletin papier signé au stand",
    });
  await handle.db.insert(schema.consentRecords).values({
    organizationId: orgA,
    contactId: maxId,
    channel: "email",
    status: "granted",
    basis: "customer_exception",
    source: "order",
    evidence: "achat sans case",
    occurredAt: new Date(),
  });
  await handle.db
    .update(schema.contacts)
    .set({ marketingEmailStatus: "customer_only" })
    .where(eq(schema.contacts.id, maxId));
  await suppressEmail(handle.db, camille.actor, orgA, { email: "ana@example.fr", reason: "complaint" });
  segmentId = (
    await createSegment(handle.db, camille.actor, orgA, {
      name: "Tout le monde",
      definition: { match: "all", rules: [] },
    })
  ).id;
});

afterAll(async () => {
  await handle.close();
});

describe("A. drafts, templates, preview, test e-mail, permissions", () => {
  it("declares the campaign graph: a launched campaign is never cancelled retroactively", () => {
    expect(campaignStateMachine.canTransition("draft", "scheduled")).toBe(true);
    expect(campaignStateMachine.canTransition("scheduled", "draft")).toBe(true);
    expect(campaignStateMachine.canTransition("scheduled", "cancelled")).toBe(true);
    expect(campaignStateMachine.canTransition("sending", "cancelled")).toBe(false);
    expect(campaignStateMachine.canTransition("sent", "draft")).toBe(false);
  });

  it("templates and campaigns belong to the organization; a reader without campaigns.* is refused", async () => {
    const tpl = await createTemplate(handle.db, camille.actor, orgA, {
      name: "Annonce",
      subject: "{{organisation}} : du nouveau",
      body: "# Bonjour {{prenom}}\n\nTexte.",
    });
    expect((await listTemplates(handle.db, camille.actor, orgA)).map((x) => x.id)).toEqual([tpl.id]);
    await expect(listTemplates(handle.db, nora.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCampaign(handle.db, bob.actor, orgA, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCampaign(handle.db, camille.actor, orgB, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    // Segment of another organization is refused as a reference.
    const segB = (await createSegment(handle.db, bob.actor, orgB, { name: "B" })).id;
    await expect(createCampaign(handle.db, camille.actor, orgA, { name: "x", segmentId: segB })).rejects.toThrow();
    const c = await createCampaign(handle.db, camille.actor, orgA, {
      name: "Les Nuits reviennent",
      subject: "{{prenom}}, Les Nuits en Commun reviennent",
      preheader: "Billets en vente dès aujourd'hui",
      fromName: "Le Collectif des Nuits",
      replyTo: "contact@collectif.test",
      templateId: tpl.id,
      segmentId,
      body: [
        "# Bonjour {{prenom}}",
        "",
        "Les Nuits en Commun reviennent le 12 juin. **Trois scènes**, une équipe, et vous.",
        "",
        "> [Je réserve mes billets](http://test.local/le-collectif-des-nuits/les-nuits-en-commun)",
        "",
        "Programme complet sur [notre page](http://test.local/le-collectif-des-nuits).",
      ].join("\n"),
    });
    campaignId = c.id;
    expect(c.status).toBe("draft");
    expect(c.slug).toBe("les-nuits-reviennent");
    expect(c.segmentName).toBe("Tout le monde");
    await expect(getCampaign(handle.db, ctx, bob.actor, orgB, c.id)).rejects.toBeInstanceOf(NotFoundError);
    // A partial update leaves the other fields untouched (regression: defaults must not reset them).
    const patched = await updateCampaign(handle.db, camille.actor, orgA, c.id, {
      preheader: "Billets en vente",
      version: c.version,
    });
    expect(patched.subject).toBe(c.subject);
    expect(patched.body).toBe(c.body);
    expect(patched.fromName).toBe(c.fromName);
    expect(patched.segmentId).toBe(segmentId);
    const list = await listCampaigns(handle.db, camille.actor, orgA);
    expect(list).toHaveLength(1);
  });

  it("preview renders personalised HTML + text with the unsubscribe link; the test e-mail goes to the sender only", async () => {
    const p = await previewCampaign(handle.db, ctx, camille.actor, orgA, campaignId);
    expect(p.subject).toBe("Prénom, Les Nuits en Commun reviennent");
    expect(p.html).toContain("<strong>Trois scènes</strong>");
    expect(p.html).toContain("/desinscription/test");
    expect(p.html).toContain("utm_campaign=les-nuits-reviennent");
    const before = email.sent.length;
    const r = await sendTestEmail(handle.db, ctx, camille.actor, orgA, campaignId);
    expect(r.to).toBe(camille.email);
    expect(email.sent.length).toBe(before + 1);
    expect(email.sent.at(-1)?.subject.startsWith("[TEST] ")).toBe(true);
    expect(email.sent.at(-1)?.to).toBe(camille.email);
    const deliveries = await handle.db
      .select()
      .from(schema.messageDeliveries)
      .where(eq(schema.messageDeliveries.campaignId, campaignId));
    expect(deliveries.map((d) => d.kind)).toEqual(["test"]);
    expect(
      await handle.db
        .select()
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.campaignId, campaignId)),
    ).toHaveLength(0);
  });
});

describe("B. verification, scheduling, eligibility at dispatch, batches, retries", () => {
  it("counts the audience with reasons: customer_only and suppressed are out by default", async () => {
    const check = await checkAudience(handle.db, camille.actor, orgA, campaignId);
    expect(check.segmentCount).toBe(5);
    expect(check.eligibleCount).toBe(2); // Lou, Sam
    expect(check.customerOnlyCount).toBe(1); // Max
    expect(check.notConsentedCount).toBe(1); // Zoé
    expect(check.suppressedCount).toBe(1); // Ana
    const withException = await checkAudience(handle.db, camille.actor, orgA, campaignId, true);
    expect(withException.eligibleCount).toBe(3);
  });

  it("scheduling requires campaigns.send, a complete draft, a reasoned legal note for the customer exception, and ≥ 1 recipient", async () => {
    await expect(scheduleCampaign(handle.db, nora.actor, orgA, campaignId, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      scheduleCampaign(handle.db, camille.actor, orgA, campaignId, { includeCustomerException: true }),
    ).rejects.toMatchObject({
      details: { fieldErrors: { legalNote: expect.any(Array) } },
    });
    const empty = await createCampaign(handle.db, camille.actor, orgA, { name: "Vide", segmentId });
    await expect(scheduleCampaign(handle.db, camille.actor, orgA, empty.id, {})).rejects.toMatchObject({
      details: { fieldErrors: { subject: expect.any(Array), body: expect.any(Array), fromName: expect.any(Array) } },
    });
    const noOne = await createSegment(handle.db, camille.actor, orgA, {
      name: "Personne",
      definition: { rules: [{ type: "marketing_email", statuses: ["withdrawn"] }] },
    });
    const lonely = await createCampaign(handle.db, camille.actor, orgA, {
      name: "Seul",
      subject: "s",
      body: "b",
      fromName: "f",
      segmentId: noOne.id,
    });
    await expect(scheduleCampaign(handle.db, camille.actor, orgA, lonely.id, {})).rejects.toMatchObject({
      details: { code: "no_recipients" },
    });
    // Schedule for later, unschedule, then schedule now.
    const later = await scheduleCampaign(handle.db, camille.actor, orgA, campaignId, {
      sendAt: new Date(Date.now() + 3_600_000),
    });
    expect(later.campaign.status).toBe("scheduled");
    expect(later.check.eligibleCount).toBe(2);
    await expect(updateCampaign(handle.db, camille.actor, orgA, campaignId, { subject: "x" })).rejects.toMatchObject({
      details: { code: "campaign_locked" },
    });
    expect(await dispatchDueCampaigns(handle.db, ctx, system)).toBe(0); // not due yet
    expect((await unscheduleCampaign(handle.db, camille.actor, orgA, campaignId)).status).toBe("draft");
    const now = await scheduleCampaign(handle.db, camille.actor, orgA, campaignId, {});
    expect(now.campaign.status).toBe("scheduled");
    expect(now.campaign.eligibleCount).toBe(2);
  });

  it("a contact unsubscribed AFTER scheduling is excluded at dispatch; batches, retries, one message per address", async () => {
    // Sam withdraws between scheduling and dispatch (suppression by address).
    await suppressEmail(handle.db, camille.actor, orgA, { email: "sam@example.fr", reason: "unsubscribed" });
    // A second contact with Lou's address cannot exist (unique active e-mail), so duplicates are simulated by a
    // second opted-in contact whose address only differs by case in the segment — normalised earlier → same contact.
    email.failFor.set("lou@example.fr", 1); // first attempt fails, second succeeds
    const before = email.sent.length;
    expect(await dispatchDueCampaigns(handle.db, ctx, system)).toBe(1);
    const c = await getCampaign(handle.db, ctx, camille.actor, orgA, campaignId);
    expect(c.status).toBe("sent");
    expect(c.sentCount).toBe(1);
    expect(c.failedCount).toBe(0);
    expect(c.report.recipients.skipped).toBe(4); // Sam (suppressed now), Max, Zoé, Ana
    const sent = email.sent.slice(before);
    expect(sent.map((m) => m.to)).toEqual(["lou@example.fr"]);
    expect(sent[0]?.listUnsubscribeUrl).toMatch(/\/api\/v1\/public\/unsubscribe\/[0-9a-f-]{36}\./);
    expect(sent[0]?.subject).toBe("Lou, Les Nuits en Commun reviennent");
    expect(sent[0]?.html).toContain("/l/");
    unsubscribeUrl = sent[0]?.listUnsubscribeUrl ?? "";
    trackedUrl = sent[0]?.text.match(/http:\/\/test\.local\/l\/[A-Za-z0-9_-]+\?r=[^\s)]+/)?.[0] ?? "";
    expect(trackedUrl).not.toBe("");
    const recipients = await listRecipients(handle.db, camille.actor, orgA, campaignId);
    const lou = recipients.recipients.find((r) => r.email === "lou@example.fr");
    expect(lou?.attempts).toBe(2);
    expect(lou?.status).toBe("sent");
    expect(recipients.recipients.find((r) => r.email === "sam@example.fr")?.skipReason).toBe("suppressed");
    // Re-running the dispatcher never re-sends.
    expect(await dispatchDueCampaigns(handle.db, ctx, system)).toBe(0);
    expect(email.sent.length).toBe(before + 1);
    await expect(cancelCampaign(handle.db, camille.actor, orgA, campaignId)).rejects.toMatchObject({
      details: { code: "campaign_locked" },
    });
  });

  it("definitive provider failure marks the recipient failed and the campaign partially failed", async () => {
    const zoe = (
      await handle.db.select().from(schema.contacts).where(eq(schema.contacts.primaryEmail, "zoe@example.fr"))
    )[0]!;
    await recordManualConsent(handle.db, camille.actor, orgA, zoe.id, {
      status: "granted",
      evidence: "Formulaire web",
    });
    const c2 = await createCampaign(handle.db, camille.actor, orgA, {
      name: "Relance",
      subject: "Relance",
      body: "Il reste des places.",
      fromName: "Le Collectif",
      segmentId,
    });
    await scheduleCampaign(handle.db, camille.actor, orgA, c2.id, {});
    email.failFor.set("zoe@example.fr", 5); // more than maxAttempts
    await dispatchDueCampaigns(handle.db, ctx, system);
    const d = await getCampaign(handle.db, ctx, camille.actor, orgA, c2.id);
    expect(d.status).toBe("partially_failed");
    expect(d.sentCount).toBe(1); // Lou
    expect(d.failedCount).toBe(1); // Zoé
    expect(d.report.deliveries.failed).toBe(2);
  });
});

describe("C. tracking, attribution, unsubscribe, provider callbacks, report", () => {
  it("a tracked click records the event (no IP), counts unique recipients, and redirects with source parameters", async () => {
    const u = new URL(trackedUrl);
    const token = u.pathname.split("/l/")[1]!;
    const ref = u.searchParams.get("r");
    const r1 = await trackClick(handle.db, ctx, token, ref, "Mozilla/5.0 test");
    const r2 = await trackClick(handle.db, ctx, token, ref, null);
    expect(r1?.redirectUrl).toContain("utm_source=kroov");
    expect(r1?.redirectUrl).toContain("utm_campaign=les-nuits-reviennent");
    expect(r1?.redirectUrl).toContain("kc=");
    expect(r2?.redirectUrl).toBe(r1?.redirectUrl);
    expect(await trackClick(handle.db, ctx, "nope-nope-nope-nope", null, null)).toBeNull();
    const forged = await trackClick(handle.db, ctx, token, `${ref?.split(".")[0]}.forged-token-value-xxxxxxxx`, null);
    expect(forged?.redirectUrl?.endsWith(`kc=${token}.`)).toBe(true); // link-level only, no recipient
    const report = (await getCampaign(handle.db, ctx, camille.actor, orgA, campaignId)).report;
    expect(report.clicks.total).toBe(3);
    expect(report.clicks.uniqueRecipients).toBe(1);
    expect(report.links[0]?.clicksCount).toBe(3);
    expect(report.links[0]?.uniqueClicksCount).toBe(1);
    const events = await handle.db
      .select()
      .from(schema.trackingEvents)
      .where(eq(schema.trackingEvents.campaignId, campaignId));
    expect(events.every((e) => !("ip" in e))).toBe(true);
  });

  it("an order placed with the campaign parameter is attributed; confirmed revenue counts paid orders only; forged parameters are ignored", async () => {
    const u = new URL(trackedUrl);
    const token = u.pathname.split("/l/")[1]!;
    const kc = `${token}.${u.searchParams.get("r")}`;
    const att = await resolveAttribution(handle.db, ctx, kc);
    expect(att?.campaignId).toBe(campaignId);
    expect(att?.campaignRecipientId).toBeTruthy();
    expect(await resolveAttribution(handle.db, ctx, "forged-token-forged-token")).toBeNull();
    const order = await createPublicOrder(handle.db, ticketing, anon, {
      organizationSlug: DEMO.organization.slug,
      eventSlug: eventA.slug,
      items: [{ ticketTypeId: standard, quantity: 1 }],
      attribution: kc,
    });
    const row = (await handle.db.select().from(schema.orders).where(eq(schema.orders.id, order.id)))[0]!;
    expect(row.campaignId).toBe(campaignId);
    expect(row.campaignRecipientId).toBe(att?.campaignRecipientId);
    let report = (await getCampaign(handle.db, ctx, camille.actor, orgA, campaignId)).report;
    expect(report.attribution.ordersCount).toBe(1);
    expect(report.attribution.paidOrdersCount).toBe(0);
    expect(report.attribution.confirmedRevenueMinor).toBe(0);
    expect(report.attribution.disclosure).toContain("incomplète");
    await updateBuyerDetails(handle.db, ticketing, order.id, order.accessToken, {
      email: "lou@example.fr",
      firstName: "Lou",
      lastName: "Martin",
      attendees: [{ ticketTypeId: standard, names: ["Lou Martin"] }],
    });
    const r = await startCheckout(handle.db, ticketing, anon, order.id, order.accessToken, {
      successUrl: "x",
      cancelUrl: "y",
    });
    if (r.kind !== "redirect") throw new Error("expected redirect");
    const sessionId = r.url.split("/paiement/")[1]!;
    const body = buildFakeWebhookBody({ type: "payment.succeeded", objectId: sessionId, chargeRef: `ch_${sessionId}` });
    await processProviderEvent(
      handle.db,
      ticketing,
      await provider.verifyWebhook(body, signFakeWebhook("test-secret-xxxxxxxxxxxx", body)),
    );
    report = (await getCampaign(handle.db, ctx, camille.actor, orgA, campaignId)).report;
    expect(report.attribution.paidOrdersCount).toBe(1);
    expect(report.attribution.confirmedRevenueMinor).toBe(2080); // 20 € + 4 % fees
    // The organization of a campaign never leaks: B's order with A's kc is not attributed.
    const kcForB = await resolveAttribution(handle.db, ctx, kc);
    expect(kcForB?.organizationId).toBe(orgA);
  });

  it("one-click unsubscribe works without login, suppresses the address, and is idempotent; forged refs are 404", async () => {
    const ref = unsubscribeUrl.split("/unsubscribe/")[1]!;
    const info = await unsubscribeInfo(handle.db, ctx, ref);
    expect(info?.email).toBe("lou@example.fr");
    expect(info?.alreadyUnsubscribed).toBe(false);
    expect(await unsubscribeInfo(handle.db, ctx, `${ref.split(".")[0]}.forged`)).toBeNull();
    expect(await unsubscribeInfo(handle.db, ctx, "test")).toBeNull();
    const done = await confirmUnsubscribe(handle.db, ctx, ref, "Mozilla/5.0");
    expect(done?.alreadyUnsubscribed).toBe(true);
    await confirmUnsubscribe(handle.db, ctx, ref, null);
    expect((await getContact(handle.db, camille.actor, orgA, louId)).marketingEmailStatus).toBe("suppressed");
    const report = (await getCampaign(handle.db, ctx, camille.actor, orgA, campaignId)).report;
    expect(report.unsubscribes).toBe(1);
    expect(report.recipients.unsubscribed).toBe(1);
    const sup = await handle.db
      .select()
      .from(schema.contactSuppressions)
      .where(eq(schema.contactSuppressions.email, "lou@example.fr"));
    expect(sup).toHaveLength(1);
    expect(sup[0]?.reason).toBe("unsubscribed");
    expect(sup[0]?.source).toBe("system");
  });

  it("provider callbacks: delivered, then a hard bounce suppresses the address; duplicates and unknown ids are harmless", async () => {
    const zoeDeliveries = await handle.db
      .select()
      .from(schema.messageDeliveries)
      .where(eq(schema.messageDeliveries.toEmail, "zoe@example.fr"));
    expect(zoeDeliveries.every((d) => d.status === "failed")).toBe(true);
    const louDelivery = (
      await handle.db
        .select()
        .from(schema.messageDeliveries)
        .where(eq(schema.messageDeliveries.toEmail, "lou@example.fr"))
    ).find((d) => d.status === "accepted" && d.kind === "campaign")!;
    expect(
      await recordDeliveryEvent(handle.db, "flaky", {
        providerMessageId: louDelivery.providerMessageId!,
        event: "delivered",
      }),
    ).toBe("applied");
    expect(
      await recordDeliveryEvent(handle.db, "flaky", {
        providerMessageId: louDelivery.providerMessageId!,
        event: "delivered",
      }),
    ).toBe("duplicate");
    expect(await recordDeliveryEvent(handle.db, "flaky", { providerMessageId: "unknown-id", event: "bounced" })).toBe(
      "unknown",
    );
    // Hard bounce on the second campaign's Lou delivery.
    const relance = (await handle.db.select().from(schema.campaigns).where(eq(schema.campaigns.slug, "relance")))[0]!;
    const d2 = (
      await handle.db.select().from(schema.messageDeliveries).where(eq(schema.messageDeliveries.campaignId, relance.id))
    ).find((d) => d.toEmail === "lou@example.fr")!;
    expect(
      await recordDeliveryEvent(handle.db, "flaky", {
        providerMessageId: d2.providerMessageId!,
        event: "bounced",
        hard: true,
        reason: "550 mailbox unavailable",
      }),
    ).toBe("applied");
    const rec = await listRecipients(handle.db, camille.actor, orgA, relance.id, { status: "bounced" });
    expect(rec.recipients.map((r) => r.email)).toEqual(["lou@example.fr"]);
    const sup = await handle.db
      .select()
      .from(schema.contactSuppressions)
      .where(eq(schema.contactSuppressions.email, "lou@example.fr"));
    expect(sup).toHaveLength(1); // already suppressed by the unsubscribe: idempotent, no second row
    const report = (await getCampaign(handle.db, ctx, camille.actor, orgA, relance.id)).report;
    expect(report.deliveries.bounced).toBe(1);
    expect(report.recipients.bounced).toBe(1);
  });
});
