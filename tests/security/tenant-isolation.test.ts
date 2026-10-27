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
