import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient, lastEmailLink, signedInClient } from "./helpers/api-client";

/**
 * Negative security tests by DIRECT API CALLS with forged identifiers.
 * Requires a running server with EMAIL_PROVIDER=file (see tests/security/README).
 */
// Runs only against a live server (E2E_BASE_URL); skipped otherwise so the static suite stays fast.
const baseUrl = process.env.E2E_BASE_URL;
const describeLive = baseUrl ? describe : describe.skip;
const outbox = resolve(process.env.EMAIL_FILE_PATH ?? ".tmp/outbox.jsonl");
const run = randomUUID().slice(0, 8);
const password = "phrase-de-passe-solide-2027";

let alice: ApiClient; // organisation A
let bob: ApiClient; // organisation B
let carol: ApiClient; // no organisation
let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let aliceMemberId: string;

beforeAll(async () => {
  if (!baseUrl) return;
  alice = await signedInClient(baseUrl!, outbox, { name: "Alice A", email: `alice-${run}@sec.kroov.local`, password });
  bob = await signedInClient(baseUrl!, outbox, { name: "Bob B", email: `bob-${run}@sec.kroov.local`, password });
  carol = await signedInClient(baseUrl!, outbox, { name: "Carol C", email: `carol-${run}@sec.kroov.local`, password });
  const a = await alice.post("/api/v1/organizations", { name: `Org A ${run}`, slug: `org-a-${run}` });
  const b = await bob.post("/api/v1/organizations", { name: `Org B ${run}`, slug: `org-b-${run}` });
  orgA = (a.json as { data: { id: string; slug: string } }).data;
  orgB = (b.json as { data: { id: string; slug: string } }).data;
  const members = await alice.get(`/api/v1/organizations/${orgA.id}/members`);
  aliceMemberId = (members.json as { data: Array<{ id: string }> }).data[0]!.id;
}, 60_000);

describeLive("S1. tenant isolation — user of A against every resource of B (forged ids)", () => {
  it("reading B's organization is 404 (existence not disclosed)", async () => {
    expect((await alice.get(`/api/v1/organizations/${orgB.id}`)).status).toBe(404);
  });

  it("every mutation on B is refused", async () => {
    expect((await alice.patch(`/api/v1/organizations/${orgB.id}`, { name: "Piraté" })).status).toBe(403);
    expect((await alice.get(`/api/v1/organizations/${orgB.id}/members`)).status).toBe(403);
    expect((await alice.get(`/api/v1/organizations/${orgB.id}/invitations`)).status).toBe(403);
    expect((await alice.get(`/api/v1/organizations/${orgB.id}/audit`)).status).toBe(403);
    expect(
      (await alice.post(`/api/v1/organizations/${orgB.id}/invitations`, { email: "x@y.test", role: "owner" })).status,
    ).toBe(403);
    expect(
      (
        await alice.put(`/api/v1/organizations/${orgB.id}/members/${aliceMemberId}/roles`, {
          grants: [{ role: "owner" }],
        })
      ).status,
    ).toBe(403);
    expect((await alice.delete(`/api/v1/organizations/${orgB.id}/members/${aliceMemberId}`)).status).toBe(403);
    expect((await alice.delete(`/api/v1/organizations/${orgB.id}/invitations/${randomUUID()}`)).status).toBe(403);
    expect((await alice.post(`/api/v1/organizations/${orgB.id}/invitations/${randomUUID()}/resend`)).status).toBe(403);
  });

  it("a member id of A cannot be used under organization B (composite scope)", async () => {
    const bobMembers = await bob.get(`/api/v1/organizations/${orgB.id}/members`);
    const bobMemberId = (bobMembers.json as { data: Array<{ id: string }> }).data[0]!.id;
    // Alice (owner of A) tries to change Bob's roles by addressing her own organization with Bob's member id.
    const res = await alice.put(`/api/v1/organizations/${orgA.id}/members/${bobMemberId}/roles`, { grants: [] });
    expect(res.status).toBe(404);
    // Bob is still owner of B.
    const after = await bob.get(`/api/v1/organizations/${orgB.id}/members`);
    expect(
      (after.json as { data: Array<{ grants: Array<{ role: string }> }> }).data[0]!.grants.map((g) => g.role),
    ).toContain("owner");
  });

  it("a user without organization sees nothing and can touch nothing", async () => {
    expect(((await carol.get("/api/v1/organizations")).json as { data: unknown[] }).data).toEqual([]);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}`)).status).toBe(404);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/members`)).status).toBe(403);
  });

  it("non-uuid identifiers are rejected with 422, not 500", async () => {
    expect((await alice.get("/api/v1/organizations/not-a-uuid")).status).toBe(422);
  });
});

describeLive("S2. authentication boundaries", () => {
  it("anonymous requests are 401 on protected routes", async () => {
    const anon = new ApiClient(baseUrl!);
    expect((await anon.get("/api/v1/profiles/me")).status).toBe(401);
    expect((await anon.get("/api/v1/organizations")).status).toBe(401);
    expect((await anon.post("/api/v1/organizations", { name: "X", slug: "x-anon" })).status).toBe(401);
  });

  it("state-changing requests from a foreign origin are refused (CSRF)", async () => {
    const res = await alice.post(
      "/api/v1/organizations",
      { name: "CSRF", slug: `csrf-${run}` },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
    const list = await alice.get("/api/v1/organizations");
    expect((list.json as { data: Array<{ slug: string }> }).data.map((o) => o.slug)).not.toContain(`csrf-${run}`);
  });

  it("password reset and verification resend do not disclose whether an account exists", async () => {
    const anon = new ApiClient(baseUrl!);
    const known = await anon.post("/api/auth/request-password-reset", {
      email: `alice-${run}@sec.kroov.local`,
      redirectTo: "/reinitialiser-mot-de-passe",
    });
    const unknown = await anon.post("/api/auth/request-password-reset", {
      email: `nobody-${run}@sec.kroov.local`,
      redirectTo: "/reinitialiser-mot-de-passe",
    });
    expect(known.status).toBe(unknown.status);
    expect(JSON.stringify(known.json)).toBe(JSON.stringify(unknown.json));
  });

  it("sign-in without a verified e-mail is refused", async () => {
    const fresh = new ApiClient(baseUrl!);
    const email = `unverified-${run}@sec.kroov.local`;
    await fresh.post("/api/auth/sign-up/email", { name: "Unverified", email, password });
    const res = await fresh.post("/api/auth/sign-in/email", { email, password });
    expect(res.status).toBe(403);
    expect((await fresh.get("/api/v1/profiles/me")).status).toBe(401);
  });
});

describeLive("S3. invitations and owner protection by API", () => {
  it("a forged invitation token is 404; a real token is single-use and bound to the e-mail", async () => {
    const anon = new ApiClient(baseUrl!);
    expect((await anon.get(`/api/v1/invitations/${"A".repeat(43)}`)).status).toBe(404);
    expect((await anon.post(`/api/v1/invitations/${"A".repeat(43)}/accept`)).status).toBe(401);

    const bobEmail = `bob-${run}@sec.kroov.local`;
    const inv = await alice.post(`/api/v1/organizations/${orgA.id}/invitations`, { email: bobEmail, role: "scanner" });
    expect(inv.status).toBe(201);
    const link = lastEmailLink(outbox, bobEmail, /https?:\/\/\S+\/invitation\/[A-Za-z0-9_-]+/);
    const token = link.split("/invitation/")[1]!;

    // Carol (wrong e-mail) cannot accept.
    expect((await carol.post(`/api/v1/invitations/${token}/accept`)).status).toBe(403);
    // Bob accepts once.
    expect((await bob.post(`/api/v1/invitations/${token}/accept`)).status).toBe(200);
    expect((await bob.post(`/api/v1/invitations/${token}/accept`)).status).toBe(412);
    // Bob now reads A with scanner rights only: organization.read is NOT granted to scanners.
    expect((await bob.get(`/api/v1/organizations/${orgA.id}/members`)).status).toBe(403);
  });

  it("the last owner cannot be removed nor demoted; a non-owner cannot grant owner", async () => {
    expect((await alice.delete(`/api/v1/organizations/${orgA.id}/members/${aliceMemberId}`)).status).toBe(412);
    expect(
      (
        await alice.put(`/api/v1/organizations/${orgA.id}/members/${aliceMemberId}/roles`, {
          grants: [{ role: "organization_admin" }],
        })
      ).status,
    ).toBe(412);
    // Promote Bob (scanner in A) to admin, then Bob tries to make himself owner.
    const members = await alice.get(`/api/v1/organizations/${orgA.id}/members`);
    const bobMemberId = (members.json as { data: Array<{ id: string; email: string }> }).data.find((m) =>
      m.email.startsWith("bob-"),
    )!.id;
    expect(
      (
        await alice.put(`/api/v1/organizations/${orgA.id}/members/${bobMemberId}/roles`, {
          grants: [{ role: "organization_admin" }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await bob.put(`/api/v1/organizations/${orgA.id}/members/${bobMemberId}/roles`, { grants: [{ role: "owner" }] }))
        .status,
    ).toBe(403);
    expect(
      (await bob.post(`/api/v1/organizations/${orgA.id}/invitations`, { email: "new@sec.kroov.local", role: "owner" }))
        .status,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 2 — events, locations, public pages
// ---------------------------------------------------------------------------------------------
type EventJson = { id: string; slug: string; status: string; version: number };
let eventB: EventJson; // draft in B (S4), published later for S5 cross-event scans
let dave: ApiClient; // event-scoped manager of A on eventA2 only (S4), reused in S5
const inDays = (days: number, hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

describeLive("S4. events — tenant isolation, scoped grants and public exposure", () => {
  let eventA: EventJson; // draft in A (complete enough to publish)
  let eventA2: EventJson; // second draft in A (used for scoped grant)
  let locationA: { id: string };

  beforeAll(async () => {
    const loc = await alice.post(`/api/v1/organizations/${orgA.id}/locations`, {
      name: "Hangar des Nuits",
      city: "Paris",
      addressLine1: "12 quai des Docks",
      postalCode: "75019",
    });
    expect(loc.status).toBe(201);
    locationA = (loc.json as { data: { id: string } }).data;
    const payload = {
      title: `Nuit Sécurité ${run}`,
      description: "Une soirée pensée pour vérifier que personne ne voit ce qu'il ne doit pas voir.",
      startsAt: inDays(10, 20),
      endsAt: inDays(11, 2),
      capacity: 300,
      locationId: locationA.id,
    };
    const a = await alice.post(`/api/v1/organizations/${orgA.id}/events`, payload);
    expect(a.status).toBe(201);
    eventA = (a.json as { data: EventJson }).data;
    const a2 = await alice.post(`/api/v1/organizations/${orgA.id}/events`, { ...payload, title: `Autre nuit ${run}` });
    eventA2 = (a2.json as { data: EventJson }).data;
    const b = await bob.post(`/api/v1/organizations/${orgB.id}/events`, {
      title: `Secret de B ${run}`,
      startsAt: inDays(5, 19),
      endsAt: inDays(5, 23),
    });
    expect(b.status).toBe(201);
    eventB = (b.json as { data: EventJson }).data;

    // Dave: invited by Alice as event_manager scoped to eventA2 only.
    const daveEmail = `dave-${run}@sec.kroov.local`;
    dave = await signedInClient(baseUrl!, outbox, { name: "Dave D", email: daveEmail, password });
    const inv = await alice.post(`/api/v1/organizations/${orgA.id}/invitations`, {
      email: daveEmail,
      role: "event_manager",
      eventId: eventA2.id,
    });
    expect(inv.status).toBe(201);
    const link = lastEmailLink(outbox, daveEmail, /https?:\/\/\S+\/invitation\/[A-Za-z0-9_-]+/);
    expect((await dave.post(`/api/v1/invitations/${link.split("/invitation/")[1]!}/accept`)).status).toBe(200);
  }, 60_000);

  it("A cannot read, list, update, publish, cancel or delete B's events (forged ids)", async () => {
    expect((await alice.get(`/api/v1/organizations/${orgB.id}/events`)).status).toBe(403);
    expect((await alice.get(`/api/v1/organizations/${orgB.id}/events/${eventB.id}`)).status).toBe(404);
    expect(
      (await alice.patch(`/api/v1/organizations/${orgB.id}/events/${eventB.id}`, { version: 1, title: "Pwn" })).status,
    ).toBe(403);
    expect(
      (await alice.post(`/api/v1/organizations/${orgB.id}/events/${eventB.id}/publish`, { version: 1 })).status,
    ).toBe(403);
    expect(
      (
        await alice.post(`/api/v1/organizations/${orgB.id}/events/${eventB.id}/cancel`, {
          version: 1,
          reason: "Parce que",
        })
      ).status,
    ).toBe(403);
    expect((await alice.delete(`/api/v1/organizations/${orgB.id}/events/${eventB.id}`)).status).toBe(403);
    expect((await alice.post(`/api/v1/organizations/${orgB.id}/locations`, { name: "X", city: "Y" })).status).toBe(403);
    // B's event id addressed under A (composite tenant scope): not found, nothing changed.
    expect((await alice.get(`/api/v1/organizations/${orgA.id}/events/${eventB.id}`)).status).toBe(404);
    expect(
      (await alice.patch(`/api/v1/organizations/${orgA.id}/events/${eventB.id}`, { version: 1, title: "Pwn" })).status,
    ).toBe(404);
    const still = await bob.get(`/api/v1/organizations/${orgB.id}/events/${eventB.id}`);
    expect((still.json as { data: EventJson }).data.status).toBe("draft");
  });

  it("a location of B cannot be attached to an event of A", async () => {
    const locB = await bob.post(`/api/v1/organizations/${orgB.id}/locations`, { name: "Salle B", city: "Lyon" });
    const res = await alice.patch(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`, {
      version: eventA.version,
      locationId: (locB.json as { data: { id: string } }).data.id,
    });
    expect([404, 409, 422]).toContain(res.status);
    const after = await alice.get(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`);
    expect((after.json as { data: { location: { id: string } | null } }).data.location?.id).toBe(locationA.id);
  });

  it("an event-scoped manager sees and acts on their event only", async () => {
    const list = await dave.get(`/api/v1/organizations/${orgA.id}/events?status=all`);
    expect(list.status).toBe(200);
    expect((list.json as { data: EventJson[] }).data.map((e) => e.id)).toEqual([eventA2.id]);
    expect((await dave.get(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`)).status).toBe(404);
    expect(
      (await dave.patch(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`, { version: 1, title: "Nope" })).status,
    ).toBe(403);
    expect(
      (await dave.post(`/api/v1/organizations/${orgA.id}/events/${eventA.id}/publish`, { version: 1 })).status,
    ).toBe(403);
    // No events.create at organization level, no team reads.
    expect(
      (
        await dave.post(`/api/v1/organizations/${orgA.id}/events`, {
          title: "Nouveau",
          startsAt: inDays(3, 19),
          endsAt: inDays(3, 23),
        })
      ).status,
    ).toBe(403);
    expect((await dave.get(`/api/v1/organizations/${orgA.id}/members`)).status).toBe(403);
    // But can update their own event.
    const ok = await dave.patch(`/api/v1/organizations/${orgA.id}/events/${eventA2.id}`, {
      version: eventA2.version,
      tagline: "Édité par Dave",
    });
    expect(ok.status).toBe(200);
  });

  it("publication needs the checklist (412), the right permission and the current version (409)", async () => {
    const incomplete = await alice.post(`/api/v1/organizations/${orgA.id}/events`, {
      title: `Incomplet ${run}`,
      startsAt: inDays(4, 19),
      endsAt: inDays(4, 23),
    });
    const inc = (incomplete.json as { data: EventJson }).data;
    const blocked = await alice.post(`/api/v1/organizations/${orgA.id}/events/${inc.id}/publish`, {
      version: inc.version,
    });
    expect(blocked.status).toBe(412);
    expect(JSON.stringify(blocked.json)).toContain("publication_blocked");
    // Stale version on the complete event.
    expect(
      (await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventA.id}/publish`, { version: 999 })).status,
    ).toBe(409);
    // Bob is organization_admin of A (S3) — admins may publish; a scanner may not. Use Dave's scope as the negative above.
    const current = await alice.get(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`);
    const v = (current.json as { data: EventJson }).data.version;
    const pub = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventA.id}/publish`, { version: v });
    expect(pub.status).toBe(200);
    expect((pub.json as { data: EventJson }).data.status).toBe("published");
    // A published event can no longer be deleted.
    expect((await alice.delete(`/api/v1/organizations/${orgA.id}/events/${eventA.id}`)).status).toBe(412);
  });

  it("public API and pages expose published events only; drafts are 404 and never listed", async () => {
    const anon = new ApiClient(baseUrl!);
    const org = await anon.get(`/api/v1/public/organizations/${orgA.slug}`);
    expect(org.status).toBe(200);
    const slugs = (org.json as { data: { events: Array<{ slug: string }> } }).data.events.map((e) => e.slug);
    expect(slugs).toContain(eventA.slug);
    expect(slugs).not.toContain(eventA2.slug);
    expect((await anon.get(`/api/v1/public/organizations/${orgA.slug}/events/${eventA.slug}`)).status).toBe(200);
    expect((await anon.get(`/api/v1/public/organizations/${orgA.slug}/events/${eventA2.slug}`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/organizations/${orgB.slug}/events/${eventB.slug}`)).status).toBe(404);
    // Cross-organization slug confusion: A's event slug under B's organization is 404.
    expect((await anon.get(`/api/v1/public/organizations/${orgB.slug}/events/${eventA.slug}`)).status).toBe(404);
    // HTML pages follow the same rule.
    expect((await anon.get(`/${orgA.slug}/${eventA.slug}`)).status).toBe(200);
    expect((await anon.get(`/${orgA.slug}/${eventA2.slug}`)).status).toBe(404);
    const publicJson = JSON.stringify(
      (await anon.get(`/api/v1/public/organizations/${orgA.slug}/events/${eventA.slug}`)).json,
    );
    expect(publicJson).not.toMatch(/organizationId|"version"|createdBy|publishedBy/);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 3 — ticketing: orders, payments, webhooks, scanner
// ---------------------------------------------------------------------------------------------
describeLive("S5. ticketing — isolation, forged confirmations, replay, scanner", () => {
  let eventT: EventJson; // published event of A with open sales
  let typeId: string;
  let order: { id: string; accessToken: string };
  let sessionId: string;

  beforeAll(async () => {
    // Payment account (fake provider) + published event + ticket type + sales open.
    expect((await alice.post(`/api/v1/organizations/${orgA.id}/payment-account/onboarding-link`)).status).toBe(200);
    const loc = await alice.post(`/api/v1/organizations/${orgA.id}/locations`, { name: "Salle T", city: "Paris" });
    const ev = await alice.post(`/api/v1/organizations/${orgA.id}/events`, {
      title: `Nuit Billetterie ${run}`,
      description: "Une soirée pour tester que personne ne fabrique de billet sans payer.",
      startsAt: inDays(20, 20),
      endsAt: inDays(21, 2),
      capacity: 10,
      locationId: (loc.json as { data: { id: string } }).data.id,
    });
    eventT = (ev.json as { data: EventJson }).data;
    const pub = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/publish`, {
      version: eventT.version,
    });
    expect(pub.status).toBe(200);
    const tt = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/ticket-types`, {
      name: "Standard",
      priceMinor: 3000,
      quota: 5,
    });
    expect(tt.status).toBe(201);
    typeId = (tt.json as { data: { id: string } }).data.id;
    expect(
      (await alice.patch(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/ticketing`, { ticketingStatus: "open" }))
        .status,
    ).toBe(200);
  }, 60_000);

  it("an outsider (Carol, no organization) cannot configure, read or refund anything of A's ticketing (403/404)", async () => {
    expect(
      (
        await carol.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/ticket-types`, {
          name: "Pirate",
          priceMinor: 1,
        })
      ).status,
    ).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/ticket-types`)).status).toBe(403);
    expect(
      (
        await carol.patch(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/ticketing`, {
          ticketingStatus: "closed",
        })
      ).status,
    ).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/orders`)).status).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/payment-account`)).status).toBe(403);
    // A's type id under B's organization: not found (composite scope), nothing created.
    expect(
      (
        await bob.patch(`/api/v1/organizations/${orgB.id}/events/${eventB.id}/ticket-types/${typeId}`, {
          priceMinor: 1,
        })
      ).status,
    ).toBe(404);
  });

  it("a guest reserves; the access token is required for every buyer call (uniform 404)", async () => {
    const anon = new ApiClient(baseUrl!);
    const res = await anon.post("/api/v1/public/orders", {
      organizationSlug: orgA.slug,
      eventSlug: eventT.slug,
      items: [{ ticketTypeId: typeId, quantity: 2 }],
    });
    expect(res.status).toBe(201);
    order = (res.json as { data: { id: string; accessToken: string } }).data;
    expect((await anon.get(`/api/v1/public/orders/${order.id}`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/orders/${order.id}?k=wrong-token`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/orders/${order.id}?k=${order.accessToken}`)).status).toBe(200);
    // Another organization's slug with A's event slug: 404, no reservation.
    expect(
      (
        await anon.post("/api/v1/public/orders", {
          organizationSlug: orgB.slug,
          eventSlug: eventT.slug,
          items: [{ ticketTypeId: typeId, quantity: 1 }],
        })
      ).status,
    ).toBe(404);
    // Oversized quantity → 412 with a code, never a 500.
    const big = await anon.post("/api/v1/public/orders", {
      organizationSlug: orgA.slug,
      eventSlug: eventT.slug,
      items: [{ ticketTypeId: typeId, quantity: 10 }],
    });
    expect(big.status).toBe(412);
  });

  it("no ticket without a confirmed payment: redirect alone changes nothing, forged/replayed webhooks are rejected", async () => {
    const anon = new ApiClient(baseUrl!);
    const q = `?k=${order.accessToken}`;
    expect(
      (
        await anon.request("PATCH", `/api/v1/public/orders/${order.id}${q}`, {
          email: `buyer-${run}@sec.kroov.local`,
          firstName: "Buyer",
          lastName: "Test",
          attendees: [{ ticketTypeId: typeId, names: ["Buyer Test", "Plus One"] }],
        })
      ).status,
    ).toBe(200);
    const checkout = await anon.post(`/api/v1/public/orders/${order.id}/checkout${q}`);
    expect(checkout.status).toBe(200);
    const data = (checkout.json as { data: { kind: string; url: string } }).data;
    expect(data.kind).toBe("redirect");
    sessionId = data.url.split("/paiement/")[1]!;
    // Visiting the success URL (what a redirect would do) does not pay the order.
    const after = await anon.get(`/api/v1/public/orders/${order.id}${q}`);
    expect((after.json as { data: { status: string; tickets: Array<{ status: string }> } }).data.status).toBe(
      "awaiting_payment",
    );
    expect(
      (after.json as { data: { tickets: Array<{ status: string }> } }).data.tickets.every(
        (t) => t.status === "pending",
      ),
    ).toBe(true);
    // Forged webhook without signature / with a bad signature: 400, order untouched.
    const body = JSON.stringify({
      id: `evt_forged_${run}`,
      type: "payment.succeeded",
      object_id: sessionId,
      charge_ref: "ch_x",
      occurred_at: new Date().toISOString(),
    });
    const forged = await fetch(`${baseUrl}/api/v1/payments/webhooks/fake`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kroov-signature": "v1=00" },
      body,
    });
    expect(forged.status).toBe(400);
    const unsigned = await fetch(`${baseUrl}/api/v1/payments/webhooks/fake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(unsigned.status).toBe(400);
    expect((await anon.get(`/api/v1/public/orders/${order.id}${q}`)).json).toMatchObject({
      data: { status: "awaiting_payment" },
    });
    // Unknown provider route: 404.
    expect((await fetch(`${baseUrl}/api/v1/payments/webhooks/stripe`, { method: "POST", body })).status).toBe(404);
    // The buyer cannot set the status through PATCH (field ignored by the schema).
    const patched = await anon.request("PATCH", `/api/v1/public/orders/${order.id}${q}`, {
      email: `buyer-${run}@sec.kroov.local`,
      firstName: "Buyer",
      lastName: "Test",
      status: "paid",
    });
    expect(patched.status).toBe(200);
    expect((patched.json as { data: { status: string } }).data.status).toBe("awaiting_payment");
  });

  it("the legitimate (signed) webhook pays once; a replay is a no-op; the refund is capped", async () => {
    const anon = new ApiClient(baseUrl!);
    const q = `?k=${order.accessToken}`;
    // Settle through the simulated provider page endpoint (delivers the signed webhook).
    const settled = await anon.post(`/api/v1/payments/fake/${sessionId}`, { decision: "succeeded" });
    expect(settled.status).toBe(200);
    expect((settled.json as { data: { outcome: string } }).data.outcome).toBe("applied");
    const paid = await anon.get(`/api/v1/public/orders/${order.id}${q}`);
    const view = (
      paid.json as {
        data: {
          status: string;
          tickets: Array<{ id: string; status: string }>;
          ticketLinks: Record<string, string>;
          totalMinor: number;
        };
      }
    ).data;
    expect(view.status).toBe("paid");
    expect(view.tickets.map((t) => t.status)).toEqual(["valid", "valid"]);
    // Replaying the settle delivers the same webhook again → duplicate, still 2 tickets.
    const replay = await anon.post(`/api/v1/payments/fake/${sessionId}`, { decision: "succeeded" });
    expect(["duplicate", "applied"]).toContain((replay.json as { data: { outcome: string } }).data.outcome);
    const again = (await anon.get(`/api/v1/public/orders/${order.id}${q}`)).json as { data: { tickets: unknown[] } };
    expect(again.data.tickets).toHaveLength(2);
    // Organizer: B cannot read or refund; Dave (scoped to another event) cannot either; Alice can, capped.
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/orders/${order.id}`)).status).toBe(404);
    expect(
      (
        await carol.post(`/api/v1/organizations/${orgA.id}/orders/${order.id}/refunds`, {
          full: true,
          reason: "Pirate",
        })
      ).status,
    ).toBe(404);
    expect((await dave.get(`/api/v1/organizations/${orgA.id}/orders/${order.id}`)).status).toBe(404);
    const t1 = view.tickets[0]!.id;
    const partial = await alice.post(`/api/v1/organizations/${orgA.id}/orders/${order.id}/refunds`, {
      ticketIds: [t1],
      reason: "Demande de l'acheteur",
    });
    expect(partial.status).toBe(200);
    expect((partial.json as { data: { status: string } }).data.status).toBe("partially_refunded");
    const twice = await alice.post(`/api/v1/organizations/${orgA.id}/orders/${order.id}/refunds`, {
      ticketIds: [t1],
      reason: "Encore",
    });
    expect(twice.status).toBe(412);
    // Public order responses never leak internal identifiers of the payment provider objects.
    expect(JSON.stringify(paid.json)).not.toMatch(/qrCredential|secretVersion|accessTokenHash/);
  });

  it("scanner: only checkins.scan on THAT event; another event's ticket is invalid; refunded tickets are refused", async () => {
    const anon = new ApiClient(baseUrl!);
    const q = `?k=${order.accessToken}`;
    const view = (await anon.get(`/api/v1/public/orders/${order.id}${q}`)).json as {
      data: { tickets: Array<{ id: string; status: string }>; ticketLinks: Record<string, string> };
    };
    const valid = view.data.tickets.find((t) => t.status === "valid")!;
    const refunded = view.data.tickets.find((t) => t.status === "refunded")!;
    const page = (await anon.get(`/api/v1/public/tickets/${view.data.ticketLinks[valid.id]}`)).json as {
      data: { qrCredential: string };
    };
    const refundedPage = (await anon.get(`/api/v1/public/tickets/${view.data.ticketLinks[refunded.id]}`)).json as {
      data: { qrCredential: string | null };
    };
    expect(refundedPage.data.qrCredential).toBeNull();
    expect((await anon.get("/api/v1/public/tickets/forged-token")).status).toBe(404);
    // Bob (other organization) and Dave (scoped to another event of A) cannot scan here.
    expect(
      (
        await carol.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/checkins`, {
          credential: page.data.qrCredential,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await dave.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/checkins`, {
          credential: page.data.qrCredential,
        })
      ).status,
    ).toBe(403);
    // Bob (owner of B) scanning A's credential at B's event: invalid, not disclosed.
    const cross = await bob.post(`/api/v1/organizations/${orgB.id}/events/${eventB.id}/checkins`, {
      credential: page.data.qrCredential,
    });
    expect(cross.status).toBe(200);
    expect((cross.json as { data: { result: string; ticket: unknown } }).data).toMatchObject({
      result: "invalid",
      ticket: null,
    });
    // Alice (owner) admits once, then already_used.
    const first = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/checkins`, {
      credential: page.data.qrCredential,
    });
    expect((first.json as { data: { result: string } }).data.result).toBe("accepted");
    const second = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/checkins`, {
      credential: page.data.qrCredential,
    });
    expect((second.json as { data: { result: string } }).data.result).toBe("already_used");
    // Anonymous: 401.
    expect(
      (await anon.post(`/api/v1/organizations/${orgA.id}/events/${eventT.id}/checkins`, { credential: "x" })).status,
    ).toBe(401);
  });
});

describeLive("S6. memberships — isolation, forged activation, members-only tickets", () => {
  let planA: { id: string }; // paid plan with review, in A
  let membership: { id: string; accessToken: string };
  let memberTypeId: string;
  const memberEmail = `member-${run}@sec.kroov.local`;
  let eventM: EventJson;

  beforeAll(async () => {
    const plan = await alice.post(`/api/v1/organizations/${orgA.id}/membership-plans`, {
      name: `Adhésion ${run}`,
      priceMinor: 2000,
      periodKind: "rolling",
      durationMonths: 12,
      requiresReview: true,
      benefits: ["Tarif adhérent"],
    });
    expect(plan.status).toBe(201);
    planA = (plan.json as { data: { id: string } }).data;
    const loc = await alice.post(`/api/v1/organizations/${orgA.id}/locations`, { name: "Salle M", city: "Paris" });
    const ev = await alice.post(`/api/v1/organizations/${orgA.id}/events`, {
      title: `Soirée adhérents ${run}`,
      description: "Un tarif réservé aux adhérents, vérifié côté serveur et pas seulement dans l'interface.",
      startsAt: inDays(30, 20),
      endsAt: inDays(31, 1),
      capacity: 50,
      locationId: (loc.json as { data: { id: string } }).data.id,
    });
    eventM = (ev.json as { data: EventJson }).data;
    expect(
      (await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventM.id}/publish`, { version: eventM.version }))
        .status,
    ).toBe(200);
    const tt = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventM.id}/ticket-types`, {
      name: "Adhérent",
      priceMinor: 500,
      quota: 10,
      membersOnly: true,
    });
    expect(tt.status).toBe(201);
    memberTypeId = (tt.json as { data: { id: string } }).data.id;
    expect(
      (await alice.patch(`/api/v1/organizations/${orgA.id}/events/${eventM.id}/ticketing`, { ticketingStatus: "open" }))
        .status,
    ).toBe(200);
  }, 60_000);

  it("an outsider cannot read, create or decide on A's plans and memberships (403/404)", async () => {
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/membership-plans`)).status).toBe(403);
    expect(
      (
        await carol.post(`/api/v1/organizations/${orgA.id}/membership-plans`, {
          name: "Pirate",
          priceMinor: 0,
          periodKind: "rolling",
          durationMonths: 12,
        })
      ).status,
    ).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/memberships`)).status).toBe(403);
    // A's plan id under B's organization: not found, nothing changed (composite scope).
    expect(
      (
        await bob.patch(`/api/v1/organizations/${orgB.id}/membership-plans/${planA.id}`, {
          name: "Vol",
          priceMinor: 0,
          periodKind: "rolling",
          durationMonths: 12,
        })
      ).status,
    ).toBe(404);
    // Dave (event-scoped manager of A) has no memberships.manage.
    expect((await dave.get(`/api/v1/organizations/${orgA.id}/memberships`)).status).toBe(403);
    // Public: B's slug with A's plan id → 404, no application created.
    const anon = new ApiClient(baseUrl!);
    expect(
      (
        await anon.post(`/api/v1/public/organizations/${orgB.slug}/membership-applications`, {
          planId: planA.id,
          email: memberEmail,
          firstName: "Mia",
          lastName: "Membre",
        })
      ).status,
    ).toBe(404);
  });

  it("members-only tickets are refused without an active membership (412), even with a plausible e-mail", async () => {
    const anon = new ApiClient(baseUrl!);
    const noEmail = await anon.post("/api/v1/public/orders", {
      organizationSlug: orgA.slug,
      eventSlug: eventM.slug,
      items: [{ ticketTypeId: memberTypeId, quantity: 1 }],
    });
    expect(noEmail.status).toBe(412);
    expect((noEmail.json as { error: { details?: { code?: string } } }).error.details?.code).toBe(
      "membership_email_required",
    );
    const notMember = await anon.post("/api/v1/public/orders", {
      organizationSlug: orgA.slug,
      eventSlug: eventM.slug,
      items: [{ ticketTypeId: memberTypeId, quantity: 1 }],
      email: memberEmail,
    });
    expect(notMember.status).toBe(412);
    expect((notMember.json as { error: { details?: { code?: string } } }).error.details?.code).toBe(
      "membership_required",
    );
  });

  it("application: token required (uniform 404); status cannot be forged; duplicate application → 409", async () => {
    const anon = new ApiClient(baseUrl!);
    const res = await anon.post(`/api/v1/public/organizations/${orgA.slug}/membership-applications`, {
      planId: planA.id,
      email: memberEmail,
      firstName: "Mia",
      lastName: "Membre",
      status: "active",
    });
    expect(res.status).toBe(201);
    membership = (res.json as { data: { id: string; accessToken: string; status: string } }).data;
    expect((res.json as { data: { status: string } }).data.status).toBe("pending");
    expect((await anon.get(`/api/v1/public/memberships/${membership.id}`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/memberships/${membership.id}?k=forged`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/memberships/${membership.id}?k=${membership.accessToken}`)).status).toBe(
      200,
    );
    // Checkout before approval: 412, never a payment session.
    expect(
      (await anon.post(`/api/v1/public/memberships/${membership.id}/checkout?k=${membership.accessToken}`)).status,
    ).toBe(412);
    // Second application for the same e-mail → 409 application_in_progress.
    const dup = await anon.post(`/api/v1/public/organizations/${orgA.slug}/membership-applications`, {
      planId: planA.id,
      email: memberEmail.toUpperCase(),
      firstName: "Mia",
      lastName: "Membre",
    });
    expect(dup.status).toBe(409);
    // Only A's managers decide: Carol/Bob/Dave get 403 or 404.
    expect((await carol.post(`/api/v1/organizations/${orgA.id}/memberships/${membership.id}/approve`)).status).toBe(
      403,
    );
    expect((await bob.post(`/api/v1/organizations/${orgB.id}/memberships/${membership.id}/approve`)).status).toBe(404);
    expect((await dave.post(`/api/v1/organizations/${orgA.id}/memberships/${membership.id}/approve`)).status).toBe(403);
    // Still pending, so still not a member.
    expect(
      (
        await anon.post("/api/v1/public/orders", {
          organizationSlug: orgA.slug,
          eventSlug: eventM.slug,
          items: [{ ticketTypeId: memberTypeId, quantity: 1 }],
          email: memberEmail,
        })
      ).status,
    ).toBe(412);
  });

  it("approval does not activate a paid membership; forged webhooks are rejected; the signed webhook activates once", async () => {
    const anon = new ApiClient(baseUrl!);
    const q = `?k=${membership.accessToken}`;
    const approved = await alice.post(`/api/v1/organizations/${orgA.id}/memberships/${membership.id}/approve`);
    expect(approved.status).toBe(200);
    expect((approved.json as { data: { status: string } }).data.status).toBe("awaiting_payment");
    const checkout = await anon.post(`/api/v1/public/memberships/${membership.id}/checkout${q}`);
    expect(checkout.status).toBe(200);
    const data = (checkout.json as { data: { kind: string; url: string } }).data;
    expect(data.kind).toBe("redirect");
    const sessionId = data.url.split("/paiement/")[1]!;
    const body = JSON.stringify({
      id: `evt_forged_m_${run}`,
      type: "payment.succeeded",
      object_id: sessionId,
      charge_ref: "ch_x",
      occurred_at: new Date().toISOString(),
    });
    const forged = await fetch(`${baseUrl}/api/v1/payments/webhooks/fake`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kroov-signature": "v1=00" },
      body,
    });
    expect(forged.status).toBe(400);
    expect((await anon.get(`/api/v1/public/memberships/${membership.id}${q}`)).json).toMatchObject({
      data: { status: "awaiting_payment" },
    });
    const settled = await anon.post(`/api/v1/payments/fake/${sessionId}`, { decision: "succeeded" });
    expect((settled.json as { data: { outcome: string } }).data.outcome).toBe("applied");
    const active = (await anon.get(`/api/v1/public/memberships/${membership.id}${q}`)).json as {
      data: { status: string; validUntil: string | null };
    };
    expect(active.data.status).toBe("active");
    expect(active.data.validUntil).not.toBeNull();
    // Replay: duplicate, still one active membership (a second would violate the partial unique index).
    const replay = await anon.post(`/api/v1/payments/fake/${sessionId}`, { decision: "succeeded" });
    expect(["duplicate", "applied"]).toContain((replay.json as { data: { outcome: string } }).data.outcome);
    const list = (await alice.get(`/api/v1/organizations/${orgA.id}/memberships?status=active&q=${memberEmail}`))
      .json as { data: { memberships: Array<{ id: string }> } };
    expect(list.data.memberships.filter((m) => m.id === membership.id)).toHaveLength(1);
    // A new application while active → 409 membership_exists.
    const again = await anon.post(`/api/v1/public/organizations/${orgA.slug}/membership-applications`, {
      planId: planA.id,
      email: memberEmail,
      firstName: "Mia",
      lastName: "Membre",
    });
    expect(again.status).toBe(409);
    expect((again.json as { error: { details?: { code?: string } } }).error.details?.code).toBe("membership_exists");
    // Public membership responses never leak hashes or secrets.
    expect(JSON.stringify(active)).not.toMatch(/accessTokenHash|secretVersion/);
  });

  it("an active member can buy the members-only ticket, but only with the member e-mail on the order", async () => {
    const anon = new ApiClient(baseUrl!);
    const res = await anon.post("/api/v1/public/orders", {
      organizationSlug: orgA.slug,
      eventSlug: eventM.slug,
      items: [{ ticketTypeId: memberTypeId, quantity: 1 }],
      email: memberEmail,
    });
    expect(res.status).toBe(201);
    const o = (res.json as { data: { id: string; accessToken: string } }).data;
    // Switching the buyer e-mail to a non-member address at step 2 is refused (412).
    const swap = await anon.request("PATCH", `/api/v1/public/orders/${o.id}?k=${o.accessToken}`, {
      email: `intrus-${run}@sec.kroov.local`,
      firstName: "In",
      lastName: "Trus",
    });
    expect(swap.status).toBe(412);
    expect(
      (
        await anon.request("PATCH", `/api/v1/public/orders/${o.id}?k=${o.accessToken}`, {
          email: memberEmail,
          firstName: "Mia",
          lastName: "Membre",
          attendees: [{ ticketTypeId: memberTypeId, names: ["Mia Membre"] }],
        })
      ).status,
    ).toBe(200);
    // Suspension immediately removes the privilege: checkout is refused with the membership code.
    expect(
      (
        await alice.post(`/api/v1/organizations/${orgA.id}/memberships/${membership.id}/suspend`, {
          reason: "Vérification en cours",
        })
      ).status,
    ).toBe(200);
    const refused = await anon.post(`/api/v1/public/orders/${o.id}/checkout?k=${o.accessToken}`);
    expect(refused.status).toBe(412);
    expect((refused.json as { error: { details?: { code?: string } } }).error.details?.code).toBe(
      "membership_required",
    );
    expect((await alice.post(`/api/v1/organizations/${orgA.id}/memberships/${membership.id}/reactivate`)).status).toBe(
      200,
    );
    expect((await anon.post(`/api/v1/public/orders/${o.id}/checkout?k=${o.accessToken}`)).status).toBe(200);
  });
});

describeLive("S7. volunteers — isolation, candidate token, no exposure of other volunteers", () => {
  let eventV: EventJson;
  let positionId: string;
  let sstId: string;
  let application: { id: string; accessToken: string };
  const candidateEmail = `maya-${run}@sec.kroov.local`;
  const buddyEmail = `sam-${run}@sec.kroov.local`;
  const inHours = (days: number, hour: number) => inDays(days, hour);

  beforeAll(async () => {
    const skill = await alice.post(`/api/v1/organizations/${orgA.id}/skills`, {
      name: "Service au bar",
    });
    expect(skill.status).toBe(201);
    const sst = await alice.post(`/api/v1/organizations/${orgA.id}/skills`, {
      name: "SST",
      requiresVerification: true,
    });
    sstId = (sst.json as { data: { id: string } }).data.id;
    const team = await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-teams`, { name: "Bar" });
    const teamId = (team.json as { data: { id: string } }).data.id;
    const position = await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-positions`, {
      teamId,
      name: "Bar principal",
      skills: [{ skillId: sstId, mandatory: true }],
    });
    expect(position.status).toBe(201);
    positionId = (position.json as { data: { id: string } }).data.id;
    const loc = await alice.post(`/api/v1/organizations/${orgA.id}/locations`, { name: "Salle V", city: "Paris" });
    const ev = await alice.post(`/api/v1/organizations/${orgA.id}/events`, {
      title: `Nuit des bénévoles ${run}`,
      description: "Une soirée où l'on vérifie que personne ne voit la candidature d'un autre bénévole.",
      startsAt: inHours(40, 18),
      endsAt: inHours(41, 2),
      capacity: 100,
      locationId: (loc.json as { data: { id: string } }).data.id,
    });
    eventV = (ev.json as { data: EventJson }).data;
    expect(
      (await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventV.id}/publish`, { version: eventV.version }))
        .status,
    ).toBe(200);
    const ep = await alice.post(`/api/v1/organizations/${orgA.id}/events/${eventV.id}/volunteer-positions`, {
      positionId,
    });
    expect(ep.status).toBe(201);
    const epId = (ep.json as { data: { id: string } }).data.id;
    const shift = await alice.post(
      `/api/v1/organizations/${orgA.id}/events/${eventV.id}/volunteer-positions/${epId}/shifts`,
      { startsAt: inHours(40, 18), endsAt: inHours(40, 23), requiredCount: 2 },
    );
    expect(shift.status).toBe(201);
    expect(
      (
        await alice.patch(`/api/v1/organizations/${orgA.id}/events/${eventV.id}/volunteering`, {
          recruitmentStatus: "open",
          questions: [{ label: "Taille de t-shirt", type: "single_choice", options: ["S", "M", "L"], required: true }],
        })
      ).status,
    ).toBe(200);
  }, 60_000);

  it("an outsider and another organization cannot read or configure A's volunteering (403/404)", async () => {
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/skills`)).status).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/volunteer-applications`)).status).toBe(403);
    expect((await carol.get(`/api/v1/organizations/${orgA.id}/events/${eventV.id}/volunteering`)).status).toBe(403);
    expect(
      (
        await bob.post(`/api/v1/organizations/${orgB.id}/volunteer-positions`, {
          teamId: "00000000-0000-4000-8000-000000000000",
          name: "Vol",
        })
      ).status,
    ).toBe(404);
    // A's event under B's organization: 404, nothing changed.
    expect(
      (
        await bob.patch(`/api/v1/organizations/${orgB.id}/events/${eventV.id}/volunteering`, {
          recruitmentStatus: "closed",
        })
      ).status,
    ).toBe(404);
    // Dave (event manager scoped to another event of A) sees nothing of this event.
    expect((await dave.get(`/api/v1/organizations/${orgA.id}/events/${eventV.id}/volunteering`)).status).toBe(403);
    expect(
      (await dave.get(`/api/v1/organizations/${orgA.id}/volunteer-applications?eventId=${eventV.id}`)).status,
    ).toBe(403);
  });

  it("a candidate applies; invalid ranges and missing answers are 422 with fieldErrors; the token is required (404)", async () => {
    const anon = new ApiClient(baseUrl!);
    const base = `/api/v1/public/organizations/${orgA.slug}/events/${eventV.slug}/volunteer-applications`;
    const bad = await anon.post(base, {
      email: candidateEmail,
      firstName: "Maya",
      lastName: "Bernard",
      positionPreferences: [positionId],
      availabilities: [{ kind: "available", startsAt: inHours(10, 10), endsAt: inHours(10, 12) }],
      answers: {},
    });
    expect(bad.status).toBe(422);
    const fe = (bad.json as { error: { fieldErrors?: Record<string, string[]> } }).error.fieldErrors ?? {};
    expect(Object.keys(fe).sort()).toEqual(["answers.taille_de_t_shirt", "availabilities"]);
    const ok = await anon.post(base, {
      email: candidateEmail,
      firstName: "Maya",
      lastName: "Bernard",
      positionPreferences: [positionId],
      availabilities: [{ kind: "available", startsAt: inHours(40, 16), endsAt: inHours(41, 3) }],
      skills: [{ skillId: sstId }],
      buddies: [buddyEmail],
      answers: { taille_de_t_shirt: "M" },
      status: "approved",
      internalNotes: "pwn",
    });
    expect(ok.status).toBe(201);
    application = (ok.json as { data: { id: string; accessToken: string } }).data;
    const body = JSON.stringify(ok.json);
    expect((ok.json as { data: { status: string } }).data.status).toBe("submitted");
    expect(body).not.toMatch(/internalNotes|accessTokenHash|reviewedBy|targetApplicationId|targetName/);
    expect((await anon.get(`/api/v1/public/volunteer-applications/${application.id}`)).status).toBe(404);
    expect((await anon.get(`/api/v1/public/volunteer-applications/${application.id}?k=forged`)).status).toBe(404);
    expect(
      (await anon.get(`/api/v1/public/volunteer-applications/${application.id}?k=${application.accessToken}`)).status,
    ).toBe(200);
    // Duplicate live application → 409.
    expect(
      (
        await anon.post(base, {
          email: candidateEmail.toUpperCase(),
          firstName: "Maya",
          lastName: "Bernard",
          positionPreferences: [positionId],
          availabilities: [{ kind: "available", startsAt: inHours(40, 16), endsAt: inHours(41, 3) }],
          answers: { taille_de_t_shirt: "M" },
        })
      ).status,
    ).toBe(409);
    // Other organization's slug with A's event slug → 404.
    expect(
      (
        await anon.post(`/api/v1/public/organizations/${orgB.slug}/events/${eventV.slug}/volunteer-applications`, {
          email: `x-${run}@sec.kroov.local`,
          firstName: "X",
          lastName: "Y",
          positionPreferences: [positionId],
          availabilities: [{ kind: "available", startsAt: inHours(40, 16), endsAt: inHours(41, 3) }],
          answers: { taille_de_t_shirt: "M" },
        })
      ).status,
    ).toBe(404);
  });

  it("the buddy wish never reveals whether the other person applied; staff-only fields are not patchable by the candidate", async () => {
    const anon = new ApiClient(baseUrl!);
    const q = `?k=${application.accessToken}`;
    const before = (await anon.get(`/api/v1/public/volunteer-applications/${application.id}${q}`)).json as {
      data: { buddies: Array<{ email: string; reciprocal: boolean }> };
    };
    expect(before.data.buddies).toEqual([{ email: buddyEmail, reciprocal: false }]);
    // Sam applies WITHOUT naming Maya: Maya's view must be byte-identical (no "has applied" signal).
    const sam = await anon.post(
      `/api/v1/public/organizations/${orgA.slug}/events/${eventV.slug}/volunteer-applications`,
      {
        email: buddyEmail,
        firstName: "Sam",
        lastName: "Moreau",
        positionPreferences: [positionId],
        availabilities: [{ kind: "available", startsAt: inHours(40, 16), endsAt: inHours(41, 3) }],
        answers: { taille_de_t_shirt: "L" },
      },
    );
    expect(sam.status).toBe(201);
    const after = (await anon.get(`/api/v1/public/volunteer-applications/${application.id}${q}`)).json as {
      data: { buddies: Array<{ email: string; reciprocal: boolean }> };
    };
    expect(after.data.buddies).toEqual(before.data.buddies);
    // Candidate PATCH ignores status / internalNotes (schema strips them).
    const patched = await anon.request("PATCH", `/api/v1/public/volunteer-applications/${application.id}${q}`, {
      status: "approved",
      internalNotes: "pwn",
      constraints: "Départ à 1 h",
    });
    expect(patched.status).toBe(200);
    expect((patched.json as { data: { status: string; constraints: string } }).data).toMatchObject({
      status: "submitted",
      constraints: "Départ à 1 h",
    });
    // Sam's token cannot read Maya's application.
    const samToken = (sam.json as { data: { accessToken: string } }).data.accessToken;
    expect((await anon.get(`/api/v1/public/volunteer-applications/${application.id}?k=${samToken}`)).status).toBe(404);
  });

  it("decisions: only A's reviewers; reject needs a reason (422); withdrawn is final; bulk reports per record", async () => {
    const anon = new ApiClient(baseUrl!);
    const path = `/api/v1/organizations/${orgA.id}/volunteer-applications/${application.id}`;
    expect((await carol.post(`${path}/approve`)).status).toBe(403);
    expect(
      (await bob.post(`/api/v1/organizations/${orgB.id}/volunteer-applications/${application.id}/approve`)).status,
    ).toBe(404);
    expect((await dave.post(`${path}/approve`)).status).toBe(403);
    expect((await alice.post(`${path}/reject`, {})).status).toBe(422);
    // Staff view carries the buddy resolution; the candidate's never does.
    const staff = (await alice.get(path)).json as {
      data: { internalNotes: string | null; buddies: Array<{ targetName: string | null }> };
    };
    expect(staff.data.internalNotes).toBeNull();
    expect(staff.data.buddies[0]?.targetName).toBe("Sam Moreau");
    expect((await alice.post(`${path}/approve`)).status).toBe(200);
    // Verify SST: now eligible for the position (mandatory verified skill).
    const verified = await alice.post(`${path}/skills/${sstId}`, { verified: true });
    expect(
      (verified.json as { data: { preferences: Array<{ eligible: boolean }> } }).data.preferences[0]?.eligible,
    ).toBe(true);
    const bulk = await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-applications/bulk`, {
      ids: [application.id, "00000000-0000-4000-8000-000000000000"],
      action: "waitlist",
    });
    expect(bulk.status).toBe(200);
    expect((bulk.json as { data: Array<{ ok: boolean }> }).data.map((r) => r.ok)).toEqual([true, false]);
    const withdrawn = await anon.post(
      `/api/v1/public/volunteer-applications/${application.id}/withdraw?k=${application.accessToken}`,
      { reason: "Empêchement" },
    );
    expect(withdrawn.status).toBe(200);
    expect((withdrawn.json as { data: { status: string } }).data.status).toBe("withdrawn");
    expect((await alice.post(`${path}/approve`)).status).toBe(409);
    expect(
      (
        await anon.post(
          `/api/v1/public/volunteer-applications/${application.id}/withdraw?k=${application.accessToken}`,
          {},
        )
      ).status,
    ).toBe(409);
  });
});

describeLive("S8. scheduling — isolation, publication guards, draft invisibility", () => {
  let eventS: EventJson;
  let positionId: string;
  let shiftId: string;
  let versionId: string;
  let versionToken: number;
  let maya: { id: string; accessToken: string };
  let lou: { id: string; accessToken: string };
  const inHours = (days: number, hour: number) => inDays(days, hour);
  const api = (path: string) => `/api/v1/organizations/${orgA.id}/events/${eventS.id}${path}`;

  beforeAll(async () => {
    const team = await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-teams`, { name: `Accueil ${run}` });
    const position = await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-positions`, {
      teamId: (team.json as { data: { id: string } }).data.id,
      name: `Accueil ${run}`,
    });
    positionId = (position.json as { data: { id: string } }).data.id;
    const loc = await alice.post(`/api/v1/organizations/${orgA.id}/locations`, { name: "Salle S", city: "Paris" });
    const ev = await alice.post(`/api/v1/organizations/${orgA.id}/events`, {
      title: `Nuit du planning ${run}`,
      description: "Une soirée où le planning se propose, s'arbitre et se publie — jamais tout seul.",
      startsAt: inHours(50, 18),
      endsAt: inHours(51, 2),
      capacity: 100,
      locationId: (loc.json as { data: { id: string } }).data.id,
    });
    eventS = (ev.json as { data: EventJson }).data;
    expect((await alice.post(api("/publish"), { version: eventS.version })).status).toBe(200);
    const ep = await alice.post(api("/volunteer-positions"), { positionId });
    const epId = (ep.json as { data: { id: string } }).data.id;
    const shift = await alice.post(api(`/volunteer-positions/${epId}/shifts`), {
      startsAt: inHours(50, 18),
      endsAt: inHours(50, 22),
      requiredCount: 1,
      maxCount: 1,
    });
    shiftId = (shift.json as { data: { id: string } }).data.id;
    expect((await alice.patch(api("/volunteering"), { recruitmentStatus: "open" })).status).toBe(200);
    const anon = new ApiClient(baseUrl!);
    const applyAs = async (first: string) => {
      const res = await anon.post(
        `/api/v1/public/organizations/${orgA.slug}/events/${eventS.slug}/volunteer-applications`,
        {
          email: `${first.toLowerCase()}-s-${run}@sec.kroov.local`,
          firstName: first,
          lastName: "Test",
          positionPreferences: [positionId],
          availabilities: [{ kind: "available", startsAt: inHours(50, 16), endsAt: inHours(51, 3) }],
        },
      );
      expect(res.status).toBe(201);
      const data = (res.json as { data: { id: string; accessToken: string } }).data;
      expect(
        (await alice.post(`/api/v1/organizations/${orgA.id}/volunteer-applications/${data.id}/approve`)).status,
      ).toBe(200);
      return data;
    };
    maya = await applyAs("Maya");
    lou = await applyAs("Lou");
  }, 60_000);

  it("outsiders and other organizations cannot create, read or publish schedule versions", async () => {
    expect((await carol.post(api("/schedule-versions"), {})).status).toBe(403);
    expect((await carol.get(api("/schedule-versions"))).status).toBe(403);
    expect((await dave.get(api("/schedule-versions"))).status).toBe(403);
    expect((await bob.post(`/api/v1/organizations/${orgB.id}/events/${eventS.id}/schedule-versions`, {})).status).toBe(
      404,
    );
    const created = await alice.post(api("/schedule-versions"), { notes: "Essai" });
    expect(created.status).toBe(201);
    versionId = (created.json as { data: { id: string } }).data.id;
    expect(
      (await bob.get(`/api/v1/organizations/${orgB.id}/events/${eventS.id}/schedule-versions/${versionId}`)).status,
    ).toBe(404);
    expect((await carol.post(api(`/schedule-versions/${versionId}/generate`), {})).status).toBe(403);
  });

  it("the engine proposes a draft; manual assignment is validated with the hard reason; the draft is invisible to volunteers", async () => {
    const gen = await alice.post(api(`/schedule-versions/${versionId}/generate`), {});
    expect(gen.status).toBe(200);
    const data = (
      gen.json as {
        data: { version: { status: string }; run: { status: string; coveredCount: number; inputHash: string } };
      }
    ).data;
    expect(data.version.status).toBe("proposed");
    expect(data.run).toMatchObject({ status: "succeeded", coveredCount: 1 });
    expect(data.run.inputHash).toHaveLength(64);
    const detail = (await alice.get(api(`/schedule-versions/${versionId}`))).json as {
      data: {
        version: number;
        shifts: Array<{ assignments: Array<{ id: string; applicationId: string }> }>;
        conflicts: unknown[];
      };
    };
    expect(detail.data.conflicts).toEqual([]);
    const assigned = detail.data.shifts[0]!.assignments[0]!;
    const other = assigned.applicationId === maya.id ? lou : maya;
    // The shift is full (max 1): the second volunteer is refused with an explanation, never silently.
    const refused = await alice.post(api(`/schedule-versions/${versionId}/assignments`), {
      shiftId,
      applicationId: other.id,
    });
    expect(refused.status).toBe(412);
    expect((refused.json as { error: { details?: { reason?: string } } }).error.details?.reason).toBe("shift_full");
    // Nothing is published: volunteers see no mission, whatever the token.
    const anon = new ApiClient(baseUrl!);
    expect(
      (await anon.get(`/api/v1/public/volunteer-applications/${maya.id}/missions?k=${maya.accessToken}`)).json,
    ).toEqual({ data: [] });
    expect((await anon.get(`/api/v1/public/volunteer-applications/${maya.id}/missions`)).status).toBe(404);
    versionToken = detail.data.version;
  });

  it("publication: scanner cannot publish; stale token 409; concurrent publish → one winner; published version is immutable", async () => {
    // Yanis-like scanner role: carol has no role; dave is event_manager on another event → 403.
    expect(
      (await dave.post(api(`/schedule-versions/${versionId}/publish`), { expectedVersion: versionToken })).status,
    ).toBe(403);
    expect(
      (await carol.post(api(`/schedule-versions/${versionId}/publish`), { expectedVersion: versionToken })).status,
    ).toBe(403);
    const stale = await alice.post(api(`/schedule-versions/${versionId}/publish`), {
      expectedVersion: versionToken + 7,
    });
    expect(stale.status).toBe(409);
    expect((stale.json as { error: { details?: { code?: string } } }).error.details?.code).toBe("stale_version");
    const [a, b] = await Promise.all([
      alice.post(api(`/schedule-versions/${versionId}/publish`), { expectedVersion: versionToken }),
      alice.post(api(`/schedule-versions/${versionId}/publish`), { expectedVersion: versionToken }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      (await alice.post(api(`/schedule-versions/${versionId}/assignments`), { shiftId, applicationId: maya.id }))
        .status,
    ).toBe(412);
    expect((await alice.post(api(`/schedule-versions/${versionId}/generate`), {})).status).toBe(412);
    // Exactly one published version.
    const list = (await alice.get(api("/schedule-versions"))).json as { data: Array<{ status: string }> };
    expect(list.data.filter((v) => v.status === "published")).toHaveLength(1);
  });

  it("volunteers see only their own published missions; confirmation and reports need their token; a report never removes the mission", async () => {
    const anon = new ApiClient(baseUrl!);
    const detail = (await alice.get(api(`/schedule-versions/${versionId}`))).json as {
      data: { shifts: Array<{ assignments: Array<{ id: string; applicationId: string }> }> };
    };
    const assignment = detail.data.shifts[0]!.assignments[0]!;
    const owner = assignment.applicationId === maya.id ? maya : lou;
    const stranger = owner === maya ? lou : maya;
    const mine = (await anon.get(`/api/v1/public/volunteer-applications/${owner.id}/missions?k=${owner.accessToken}`))
      .json as { data: Array<{ assignmentId: string }> };
    expect(mine.data.map((m) => m.assignmentId)).toEqual([assignment.id]);
    expect(JSON.stringify(mine)).not.toMatch(/applicationId|email/);
    expect(
      (await anon.get(`/api/v1/public/volunteer-applications/${stranger.id}/missions?k=${stranger.accessToken}`)).json,
    ).toEqual({ data: [] });
    // The stranger cannot confirm or report the owner's mission (404, even with a valid own token).
    expect(
      (
        await anon.post(
          `/api/v1/public/volunteer-applications/${stranger.id}/missions/${assignment.id}/confirm?k=${stranger.accessToken}`,
          {},
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anon.post(
          `/api/v1/public/volunteer-applications/${owner.id}/missions/${assignment.id}/confirm?k=forged`,
          {},
        )
      ).status,
    ).toBe(404);
    const confirmed = await anon.post(
      `/api/v1/public/volunteer-applications/${owner.id}/missions/${assignment.id}/confirm?k=${owner.accessToken}`,
      {},
    );
    expect(confirmed.status).toBe(200);
    expect((confirmed.json as { data: Array<{ confirmationStatus: string }> }).data[0]?.confirmationStatus).toBe(
      "confirmed",
    );
    const reported = await anon.post(
      `/api/v1/public/volunteer-applications/${owner.id}/missions/${assignment.id}/report-unavailable?k=${owner.accessToken}`,
      { message: "Empêchement" },
    );
    expect(reported.status).toBe(200);
    // The assignment is still there for the organizer, flagged declined with an open request.
    const after = (await alice.get(api(`/schedule-versions/${versionId}`))).json as {
      data: {
        shifts: Array<{ assignments: Array<{ id: string; confirmationStatus: string; openRequest: unknown }> }>;
        openRequests: number;
      };
    };
    expect(after.data.shifts[0]!.assignments.find((x) => x.id === assignment.id)).toMatchObject({
      confirmationStatus: "declined",
    });
    expect(after.data.openRequests).toBe(1);
    expect((await carol.get(api("/assignment-requests"))).status).toBe(403);
    expect(((await alice.get(api("/assignment-requests"))).json as { data: unknown[] }).data).toHaveLength(1);
    // Attendance: only on the published version, only by A's staff.
    expect((await carol.request("PUT", api(`/attendance/${assignment.id}`), { status: "present" })).status).toBe(403);
    expect((await alice.request("PUT", api(`/attendance/${assignment.id}`), { status: "present" })).status).toBe(204);
  });
});
