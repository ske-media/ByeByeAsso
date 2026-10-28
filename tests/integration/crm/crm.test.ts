import { type DatabaseHandle, schema } from "@kroov/database";
import {
  addNote,
  createContact,
  createSegment,
  createTag,
  exportContactsCsv,
  findDuplicates,
  getContact,
  getSegment,
  liftSuppression,
  listContacts,
  listSuppressions,
  listTags,
  mergeContacts,
  previewSegment,
  rebuildContacts,
  recordManualConsent,
  setContactArchived,
  setContactTags,
  setStaticMembers,
  suppressEmail,
  updateContact,
  updateSegment,
} from "@kroov/domain/crm";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import { type Actor, ForbiddenError, NotFoundError, parseLocalDateTime } from "@kroov/domain/kernel";
import { applyForMembership, createMembershipPlan } from "@kroov/domain/memberships";
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
import {
  activateEventPosition,
  applyAsVolunteer,
  createPosition,
  createShift,
  createTeam,
  decideApplication,
  updateVolunteering,
} from "@kroov/domain/volunteers";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { buildFakeWebhookBody, FakePaymentProvider, signFakeWebhook } from "@kroov/payments";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A (contacts.manage + export)
let nora: TestUser; // volunteer manager of A: contacts.read only
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let email: ConsoleEmailAdapter;
let provider: FakePaymentProvider;
let ctx: TicketingContext;
let eventA: { id: string; slug: string };
let eventB: { id: string; slug: string };
let standard: string;
let freePlan: string;
let welcomePosition: string;
const anon: Actor = { kind: "anonymous" };
const system: Actor = { kind: "system", job: "test" };
const TZ = "Europe/Paris";
const t = (d: string, h: string) => parseLocalDateTime(d, h, TZ)!;

async function webhook(sessionId: string) {
  const body = buildFakeWebhookBody({ type: "payment.succeeded", objectId: sessionId, chargeRef: `ch_${sessionId}` });
  const event = await provider.verifyWebhook(body, signFakeWebhook("test-secret-xxxxxxxxxxxx", body));
  return processProviderEvent(handle.db, ctx, event);
}

async function buy(eventSlug: string, buyer: { email: string; firstName: string; lastName: string; optIn: boolean }) {
  const order = await createPublicOrder(handle.db, ctx, anon, {
    organizationSlug: DEMO.organization.slug,
    eventSlug,
    items: [{ ticketTypeId: standard, quantity: 1 }],
  });
  await updateBuyerDetails(handle.db, ctx, order.id, order.accessToken, {
    email: buyer.email,
    firstName: buyer.firstName,
    lastName: buyer.lastName,
    attendees: [{ ticketTypeId: standard, names: [`${buyer.firstName} ${buyer.lastName}`] }],
    marketingOptIn: buyer.optIn,
  });
  const r = await startCheckout(handle.db, ctx, anon, order.id, order.accessToken, {
    successUrl: "http://test.local/ok",
    cancelUrl: "http://test.local/ko",
  });
  if (r.kind !== "redirect") throw new Error("expected redirect");
  expect(await webhook(r.url.split("/paiement/")[1]!)).toBe("applied");
  return order.id;
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
  };
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  await createInvitation(handle.db, camille.actor, ctx, orgA, { email: nora.email, role: "volunteer_manager" });
  const token = email.lastTo(nora.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, nora.actor, token!);
  await startPaymentOnboarding(handle.db, ctx, camille.actor, orgA, {
    returnUrl: "http://test.local/r",
    refreshUrl: "http://test.local/f",
  });
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const ev = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière, trois scènes, et une équipe de bénévoles pour la faire tenir debout.",
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
  freePlan = (
    await createMembershipPlan(handle.db, camille.actor, orgA, {
      name: "Sympathisant",
      priceMinor: 0,
      periodKind: "fixed",
      validFrom: t("2027-01-01", "00:00"),
      validUntil: t("2027-12-31", "23:59"),
    })
  ).id;
  const team = await createTeam(handle.db, camille.actor, orgA, { name: "Accueil" });
  welcomePosition = (await createPosition(handle.db, camille.actor, orgA, { teamId: team.id, name: "Accueil" })).id;
  const ep = await activateEventPosition(handle.db, camille.actor, orgA, pub.id, { positionId: welcomePosition });
  await createShift(handle.db, camille.actor, orgA, pub.id, ep.id, {
    startsAt: t("2027-06-12", "17:00"),
    endsAt: t("2027-06-12", "20:00"),
    requiredCount: 1,
    maxCount: 1,
  });
  await updateVolunteering(handle.db, camille.actor, orgA, pub.id, { recruitmentStatus: "open" });
  // Organization B: its own event, to prove isolation.
  const locB = await createLocation(handle.db, bob.actor, orgB, { name: "Salle B", city: "Paris" });
  const evB = await createEvent(handle.db, bob.actor, orgB, {
    title: "Soirée B",
    slug: "soiree-b",
    description: "Une soirée de l'autre association, avec ses propres contacts et sa propre base.",
    startsAt: t("2027-06-12", "18:00"),
    endsAt: t("2027-06-13", "02:00"),
    capacity: 10,
    locationId: locB.id,
  });
  const pb = await publishEvent(handle.db, bob.actor, orgB, evB.id, evB.version);
  eventB = { id: pb.id, slug: pb.slug };
});

afterAll(async () => {
  await handle.close();
});

let louId: string;
let samId: string;
let mayaId: string;

describe("A. automatic feeding from sources, consent statuses", () => {
  it("a paid order with the box ticked creates an opted_in contact; without the box, customer_only", async () => {
    await buy(eventA.slug, { email: "Lou.Martin@example.fr", firstName: "Lou", lastName: "Martin", optIn: true });
    await buy(eventA.slug, { email: "sam.moreau@example.fr", firstName: "Sam", lastName: "Moreau", optIn: false });
    const { contacts, stats } = await listContacts(handle.db, camille.actor, orgA);
    expect(contacts.map((c) => c.email).sort()).toEqual(["lou.martin@example.fr", "sam.moreau@example.fr"]);
    const lou = contacts.find((c) => c.email === "lou.martin@example.fr")!;
    const sam = contacts.find((c) => c.email === "sam.moreau@example.fr")!;
    louId = lou.id;
    samId = sam.id;
    expect(lou.marketingEmailStatus).toBe("opted_in");
    expect(sam.marketingEmailStatus).toBe("customer_only");
    expect(lou.ordersCount).toBe(1);
    expect(lou.ticketsCount).toBe(1);
    expect(lou.source).toBe("order");
    expect(stats.total).toBe(2);
    expect(stats.optedIn).toBe(1);
    expect(stats.customerOnly).toBe(1);
    const detail = await getContact(handle.db, camille.actor, orgA, sam.id);
    expect(detail.consents).toHaveLength(1);
    expect(detail.consents[0]?.basis).toBe("customer_exception");
    expect(detail.consents[0]?.evidence).toContain("exception client");
    expect(detail.orders[0]?.eventTitle).toBe("Les Nuits en Commun");
    expect(detail.timeline[0]?.kind).toBe("order");
  });

  it("a free membership and a volunteer application feed the same contact; a volunteer application never creates a customer relationship", async () => {
    await applyForMembership(handle.db, ctx, anon, DEMO.organization.slug, {
      planId: freePlan,
      email: "lou.martin@example.fr",
      firstName: "Lou",
      lastName: "Martin",
    });
    const app = await applyAsVolunteer(
      handle.db,
      ctx,
      anon,
      DEMO.organization.slug,
      eventA.slug,
      {
        email: "maya.test@example.fr",
        firstName: "Maya",
        lastName: "Test",
        phone: "06 12 34 56 78",
        positionPreferences: [welcomePosition],
        availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "02:00") }],
      },
      new Date("2027-05-01T10:00:00Z"),
    );
    const lou = await getContact(handle.db, camille.actor, orgA, louId);
    expect(lou.membershipsCount).toBe(1);
    expect(lou.memberships[0]?.planName).toBe("Sympathisant");
    expect(lou.marketingEmailStatus).toBe("opted_in");
    const { contacts } = await listContacts(handle.db, camille.actor, orgA, { q: "maya" });
    expect(contacts).toHaveLength(1);
    mayaId = contacts[0]!.id;
    const maya = await getContact(handle.db, camille.actor, orgA, mayaId);
    expect(maya.source).toBe("volunteer_application");
    expect(maya.applicationsCount).toBe(1);
    expect(maya.marketingEmailStatus).toBe("none");
    expect(maya.consents).toHaveLength(0);
    expect(maya.identities.map((i) => `${i.kind}:${i.value}`)).toContain("phone:+33612345678");
    await decideApplication(handle.db, ctx, camille.actor, orgA, app.id, "approve");
    expect((await getContact(handle.db, camille.actor, orgA, mayaId)).applications[0]?.status).toBe("approved");
  });

  it("the same e-mail in another organization is a DIFFERENT contact; cross-organization reads are 404/403", async () => {
    const before = (await listContacts(handle.db, bob.actor, orgB)).contacts;
    expect(before).toHaveLength(0);
    await handle.db.transaction(async (tx) => {
      // Direct touchpoint for B (its own order would need a payment account; the command is what matters).
      const { recordTouchpoint } = await import("@kroov/domain/crm");
      await recordTouchpoint(tx, {
        organizationId: orgB,
        source: "order",
        sourceId: eventB.id,
        sourceLabel: "commande KR-B",
        email: "lou.martin@example.fr",
        firstName: "Lou",
        lastName: "Martin",
        occurredAt: new Date(),
        marketingOptIn: false,
        customerRelationship: true,
      });
    });
    const inB = (await listContacts(handle.db, bob.actor, orgB)).contacts;
    expect(inB).toHaveLength(1);
    expect(inB[0]?.id).not.toBe(louId);
    expect(inB[0]?.marketingEmailStatus).toBe("customer_only"); // B knows nothing of A's opt-in
    await expect(getContact(handle.db, bob.actor, orgA, louId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getContact(handle.db, camille.actor, orgB, inB[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getContact(handle.db, camille.actor, orgA, inB[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rebuild is idempotent: same contacts, same consents, same counters", async () => {
    const before = await listContacts(handle.db, camille.actor, orgA);
    const result = await rebuildContacts(handle.db, camille.actor, orgA);
    expect(result.touched).toBeGreaterThanOrEqual(4);
    const after = await listContacts(handle.db, camille.actor, orgA);
    expect(after.total).toBe(before.total);
    expect(after.contacts.map((c) => [c.email, c.marketingEmailStatus, c.ordersCount, c.membershipsCount])).toEqual(
      before.contacts.map((c) => [c.email, c.marketingEmailStatus, c.ordersCount, c.membershipsCount]),
    );
    const consents = await handle.db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.contactId, louId));
    expect(consents).toHaveLength(1);
  });
});

describe("B. manual management: tags, notes, consent, suppression, archive, permissions", () => {
  let tagVip: string;

  it("a reader (contacts.read) lists and opens contacts but cannot write; export needs contacts.export", async () => {
    expect((await listContacts(handle.db, nora.actor, orgA)).total).toBe(3);
    await expect(createTag(handle.db, nora.actor, orgA, { name: "VIP" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addNote(handle.db, nora.actor, orgA, louId, { body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportContactsCsv(handle.db, nora.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listContacts(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("tags and notes; notes carry the author; tag counts follow", async () => {
    tagVip = (await createTag(handle.db, camille.actor, orgA, { name: "VIP", color: "orange" })).id;
    await expect(createTag(handle.db, camille.actor, orgA, { name: "vip" })).rejects.toThrow(/déjà/);
    await setContactTags(handle.db, camille.actor, orgA, louId, { tagIds: [tagVip] });
    await addNote(handle.db, camille.actor, orgA, louId, {
      body: "A demandé une facture pour son association.",
      pinned: true,
    });
    const lou = await getContact(handle.db, camille.actor, orgA, louId);
    expect(lou.tags.map((t) => t.name)).toEqual(["VIP"]);
    expect(lou.notes[0]?.author).toBe(DEMO.owner.name);
    expect((await listTags(handle.db, nora.actor, orgA)).map((t) => t.count)).toEqual([1]);
    expect((await listContacts(handle.db, camille.actor, orgA, { tagId: tagVip })).contacts.map((c) => c.id)).toEqual([
      louId,
    ]);
  });

  it("manual consent needs evidence; withdrawal is final until a new explicit grant; suppression wins and lifting is reasoned", async () => {
    await expect(
      recordManualConsent(handle.db, camille.actor, orgA, samId, { status: "granted", evidence: "ok" }),
    ).rejects.toThrow();
    const granted = await recordManualConsent(handle.db, camille.actor, orgA, samId, {
      status: "granted",
      evidence: "Formulaire papier signé au stand le 12 juin 2026",
    });
    expect(granted.marketingEmailStatus).toBe("opted_in");
    const withdrawn = await recordManualConsent(handle.db, camille.actor, orgA, samId, {
      status: "withdrawn",
      evidence: "Demande par e-mail du 1er juillet 2026",
    });
    expect(withdrawn.marketingEmailStatus).toBe("withdrawn");
    // A later purchase (customer exception) must NOT re-grant.
    await buy(eventA.slug, { email: "sam.moreau@example.fr", firstName: "Sam", lastName: "Moreau", optIn: false });
    expect((await getContact(handle.db, camille.actor, orgA, samId)).marketingEmailStatus).toBe("withdrawn");
    expect((await getContact(handle.db, camille.actor, orgA, samId)).ordersCount).toBe(2);
    // Suppression by e-mail applies to Lou even though she is opted in.
    const s = await suppressEmail(handle.db, camille.actor, orgA, {
      email: "LOU.martin@example.fr",
      reason: "complaint",
    });
    expect(s.created).toBe(true);
    expect((await suppressEmail(handle.db, camille.actor, orgA, { email: "lou.martin@example.fr" })).created).toBe(
      false,
    );
    expect((await getContact(handle.db, camille.actor, orgA, louId)).marketingEmailStatus).toBe("suppressed");
    expect((await listSuppressions(handle.db, nora.actor, orgA)).map((x) => x.email)).toEqual([
      "lou.martin@example.fr",
    ]);
    await expect(liftSuppression(handle.db, camille.actor, orgA, s.id, { reason: "x" })).rejects.toThrow();
    await liftSuppression(handle.db, camille.actor, orgA, s.id, {
      reason: "Erreur de saisie confirmée par la personne",
    });
    expect((await getContact(handle.db, camille.actor, orgA, louId)).marketingEmailStatus).toBe("opted_in");
    expect(await listSuppressions(handle.db, nora.actor, orgA)).toHaveLength(0);
    expect(await listSuppressions(handle.db, nora.actor, orgA, "all")).toHaveLength(1);
  });

  it("archive hides from lists and segments; a new purchase restores the contact", async () => {
    await setContactArchived(handle.db, camille.actor, orgA, samId, true);
    expect((await listContacts(handle.db, camille.actor, orgA)).contacts.map((c) => c.id)).not.toContain(samId);
    expect(
      (await listContacts(handle.db, camille.actor, orgA, { status: "archived" })).contacts.map((c) => c.id),
    ).toEqual([samId]);
    await buy(eventA.slug, { email: "sam.moreau@example.fr", firstName: "Sam", lastName: "Moreau", optIn: false });
    expect((await getContact(handle.db, camille.actor, orgA, samId)).status).toBe("active");
  });

  it("manual creation refuses a live duplicate; update with a stale version is a conflict", async () => {
    await expect(createContact(handle.db, camille.actor, orgA, { email: "lou.martin@example.fr" })).rejects.toThrow(
      /existe/,
    );
    const c = await createContact(handle.db, camille.actor, orgA, {
      email: "Louise.Martin@example.fr",
      firstName: "Louise",
      lastName: "Martin",
      phone: "+33 6 12 34 56 78",
    });
    expect(c.source).toBe("staff");
    const detail = await getContact(handle.db, camille.actor, orgA, c.id);
    await updateContact(handle.db, camille.actor, orgA, c.id, { city: "Lyon", version: detail.version });
    await expect(
      updateContact(handle.db, camille.actor, orgA, c.id, { city: "Paris", version: detail.version }),
    ).rejects.toThrow(/modifiée/);
    await expect(
      updateContact(handle.db, camille.actor, orgA, c.id, { email: "lou.martin@example.fr" }),
    ).rejects.toThrow(/fusionnez/);
  });
});

describe("C. duplicates, merge, segments, export", () => {
  let louiseId: string;

  it("detects duplicates by phone and by name, never merges automatically", async () => {
    const groups = await findDuplicates(handle.db, nora.actor, orgA);
    const byPhone = groups.find((g) => g.kind === "phone");
    expect(byPhone?.contacts.map((c) => c.email).sort()).toEqual(["louise.martin@example.fr", "maya.test@example.fr"]);
    louiseId = byPhone!.contacts.find((c) => c.email === "louise.martin@example.fr")!.id;
    expect((await listContacts(handle.db, camille.actor, orgA)).total).toBe(4);
  });

  it("merges Louise into Lou: identities, tags, notes, consents and history follow; the merged card is read-only", async () => {
    await addNote(handle.db, camille.actor, orgA, louiseId, { body: "Note sur la fiche doublon." });
    await expect(
      mergeContacts(handle.db, nora.actor, orgA, louId, { mergedContactId: louiseId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const r = await mergeContacts(handle.db, camille.actor, orgA, louId, {
      mergedContactId: louiseId,
      reason: "Même personne (téléphone identique)",
    });
    expect(r.survivor.id).toBe(louId);
    const lou = await getContact(handle.db, camille.actor, orgA, louId);
    expect(lou.identities.map((i) => i.value)).toContain("louise.martin@example.fr");
    expect(lou.notes).toHaveLength(2);
    expect(lou.merges[0]?.mergedEmail).toBe("louise.martin@example.fr");
    expect(lou.marketingEmailStatus).toBe("opted_in");
    const louise = await getContact(handle.db, camille.actor, orgA, louiseId);
    expect(louise.status).toBe("merged");
    expect(louise.mergedIntoContactId).toBe(louId);
    await expect(addNote(handle.db, camille.actor, orgA, louiseId, { body: "x" })).resolves.toBeTruthy(); // notes allowed on history
    await expect(updateContact(handle.db, camille.actor, orgA, louiseId, { city: "x" })).rejects.toThrow(/fusionnée/);
    expect((await listContacts(handle.db, camille.actor, orgA)).total).toBe(3);
    // A new touchpoint on the merged address lands on the survivor.
    await buy(eventA.slug, {
      email: "louise.martin@example.fr",
      firstName: "Louise",
      lastName: "Martin",
      optIn: false,
    });
    expect((await getContact(handle.db, camille.actor, orgA, louId)).ordersCount).toBe(2);
  });

  it("dynamic segments: consented buyers of the event; a purchase without consent is absent; static segments keep their members", async () => {
    const preview = await previewSegment(handle.db, nora.actor, orgA, {
      match: "all",
      rules: [
        { type: "marketing_email", statuses: ["opted_in"] },
        { type: "event", relation: "ordered", eventIds: [eventA.id] },
      ],
    });
    expect(preview.count).toBe(1);
    expect(preview.sample[0]?.email).toBe("lou.martin@example.fr");
    const all = await previewSegment(handle.db, nora.actor, orgA, {
      rules: [{ type: "event", relation: "ordered", eventIds: [eventA.id] }],
    });
    expect(all.count).toBe(2); // Lou + Sam (customer_only / withdrawn)
    expect(all.consented).toBe(1);
    const volunteers = await previewSegment(handle.db, nora.actor, orgA, {
      rules: [{ type: "event", relation: "volunteered", eventIds: [eventA.id] }],
    });
    expect(volunteers.sample.map((s) => s.email)).toEqual(["maya.test@example.fr"]);
    const members = await previewSegment(handle.db, nora.actor, orgA, {
      rules: [{ type: "membership", state: "active" }],
    });
    expect(members.count).toBe(1);
    // References of another organization are refused.
    await expect(
      previewSegment(handle.db, nora.actor, orgA, { rules: [{ type: "event", eventIds: [eventB.id] }] }),
    ).rejects.toThrow();
    const seg = await createSegment(handle.db, camille.actor, orgA, {
      name: "Acheteurs consentis — Nuits en Commun",
      definition: {
        match: "all",
        rules: [
          { type: "marketing_email", statuses: ["opted_in"] },
          { type: "event", relation: "ordered", eventIds: [eventA.id] },
        ],
      },
    });
    expect(seg.memberCount).toBe(1);
    await expect(createSegment(handle.db, nora.actor, orgA, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const detail = await getSegment(handle.db, nora.actor, orgA, seg.id);
    expect(detail.evaluation.count).toBe(1);
    await updateSegment(handle.db, camille.actor, orgA, seg.id, {
      definition: { match: "any", rules: [{ type: "marketing_email", statuses: ["opted_in", "customer_only"] }] },
      version: seg.version,
    });
    expect((await getSegment(handle.db, camille.actor, orgA, seg.id)).evaluation.count).toBe(1); // Sam is withdrawn now
    const stat = await createSegment(handle.db, camille.actor, orgA, { name: "Invités du gala", kind: "static" });
    const s2 = await setStaticMembers(handle.db, camille.actor, orgA, stat.id, { add: [louId, mayaId] });
    expect(s2.memberCount).toBe(2);
    expect((await listContacts(handle.db, camille.actor, orgA, { segmentId: stat.id })).total).toBe(2);
    await expect(setStaticMembers(handle.db, camille.actor, orgA, seg.id, { add: [louId] })).rejects.toThrow(
      /calculés/,
    );
    await expect(getSegment(handle.db, bob.actor, orgA, seg.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("CSV export is authorized, audited, BOM + semicolons, without internal notes", async () => {
    const out = await exportContactsCsv(handle.db, camille.actor, orgA, { marketing: "opted_in" });
    expect(out.count).toBe(1);
    expect(out.csv.startsWith("﻿email;prenom;nom;")).toBe(true);
    expect(out.csv).toContain("lou.martin@example.fr;Lou;Martin");
    expect(out.csv).toContain("VIP");
    expect(out.csv).not.toContain("facture");
    const audit = await handle.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "contacts.exported"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ count: 1 });
    expect(await rebuildContacts(handle.db, system, orgA)).toMatchObject({ skipped: 0 });
  });
});
