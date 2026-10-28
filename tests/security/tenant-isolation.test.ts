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
const inDays = (days: number, hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

describeLive("S4. events — tenant isolation, scoped grants and public exposure", () => {
  let eventA: EventJson; // draft in A (complete enough to publish)
  let eventA2: EventJson; // second draft in A (used for scoped grant)
  let eventB: EventJson; // draft in B
  let locationA: { id: string };
  let dave: ApiClient; // event-scoped manager of A on eventA2 only

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
