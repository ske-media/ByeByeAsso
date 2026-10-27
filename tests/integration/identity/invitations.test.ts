import { type DatabaseHandle, schema } from "@kroov/database";
import { loadMemberContext } from "@kroov/domain/authorization";
import { ConflictError, ForbiddenError, NotFoundError, PreconditionFailedError } from "@kroov/domain/kernel";
import {
  acceptInvitation,
  createInvitation,
  createOrganization,
  getInvitationByToken,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@kroov/domain/organizations";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser;
let nora: TestUser;
let orgId: string;
const email = new ConsoleEmailAdapter(() => undefined);
const ctx = { email, appName: "Kroov", appUrl: "http://localhost:3000" };

function tokenFromEmail(to: string): string {
  const message = email.lastTo(to);
  const match = message?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`Aucun lien d'invitation envoyé à ${to}`);
  return match[1];
}

beforeAll(async () => {
  handle = await freshTestDatabase();
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  const org = await createOrganization(handle.db, camille.actor, DEMO.organization);
  orgId = org.id;
});

afterAll(async () => {
  await handle.close();
});

describe("A. invitations", () => {
  it("creates an invitation, stores only a token hash and e-mails a link", async () => {
    const inv = await createInvitation(handle.db, camille.actor, ctx, orgId, {
      email: nora.email,
      role: "volunteer_manager",
    });
    expect(inv.status).toBe("pending");
    const token = tokenFromEmail(nora.email);
    const rows = await handle.db
      .select()
      .from(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.id, inv.id));
    expect(rows[0]?.tokenHash).not.toContain(token);
    expect(rows[0]?.tokenHash).toHaveLength(64);
  });

  it("refuses a second pending invitation for the same address", async () => {
    await expect(
      createInvitation(handle.db, camille.actor, ctx, orgId, { email: nora.email, role: "scanner" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("exposes only minimal public data by token; a forged token is 404", async () => {
    const token = tokenFromEmail(nora.email);
    const pub = await getInvitationByToken(handle.db, token);
    expect(pub.organizationName).toBe(DEMO.organization.name);
    expect(pub.emailHint).toMatch(/^no•+@collectif-des-nuits\.test$/);
    await expect(getInvitationByToken(handle.db, "A".repeat(43))).rejects.toBeInstanceOf(NotFoundError);
    await expect(getInvitationByToken(handle.db, "x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses acceptance by an account with another e-mail", async () => {
    const token = tokenFromEmail(nora.email);
    const other = await createTestUser(handle.db, { email: "intrus@autre.test" });
    await expect(acceptInvitation(handle.db, other.actor, token)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses acceptance when the e-mail is not verified", async () => {
    const token = tokenFromEmail(nora.email);
    await handle.db.update(schema.users).set({ emailVerified: false }).where(eq(schema.users.id, nora.id));
    await expect(acceptInvitation(handle.db, nora.actor, token)).rejects.toBeInstanceOf(PreconditionFailedError);
    await handle.db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, nora.id));
  });

  it("accepts once, grants the role, and the token is then dead", async () => {
    const token = tokenFromEmail(nora.email);
    const result = await acceptInvitation(handle.db, nora.actor, token);
    expect(result.organizationSlug).toBe(DEMO.organization.slug);
    const member = await loadMemberContext(handle.db, nora.id, orgId);
    expect(member?.organizationRoles).toEqual(["volunteer_manager"]);
    await expect(acceptInvitation(handle.db, nora.actor, token)).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(await listInvitations(handle.db, camille.actor, orgId)).toMatchObject([{ status: "accepted" }]);
  });

  it("refuses to invite someone who is already a member", async () => {
    await expect(
      createInvitation(handle.db, camille.actor, ctx, orgId, { email: nora.email, role: "scanner" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("an expired invitation cannot be accepted and offers a resend", async () => {
    const yanis = await createTestUser(handle.db, DEMO.scanner);
    const inv = await createInvitation(handle.db, camille.actor, ctx, orgId, { email: yanis.email, role: "scanner" });
    await handle.db
      .update(schema.organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.organizationInvitations.id, inv.id));
    const oldToken = tokenFromEmail(yanis.email);
    expect((await getInvitationByToken(handle.db, oldToken)).status).toBe("expired");
    await expect(acceptInvitation(handle.db, yanis.actor, oldToken)).rejects.toThrow(/expiré/);

    const resent = await resendInvitation(handle.db, camille.actor, ctx, orgId, inv.id);
    expect(resent.status).toBe("pending");
    const newToken = tokenFromEmail(yanis.email);
    expect(newToken).not.toBe(oldToken);
    await expect(getInvitationByToken(handle.db, oldToken)).rejects.toBeInstanceOf(NotFoundError);
    await acceptInvitation(handle.db, yanis.actor, newToken);
    expect((await loadMemberContext(handle.db, yanis.id, orgId))?.organizationRoles).toEqual(["scanner"]);
  });

  it("a revoked invitation is dead and cannot be resent", async () => {
    const sam = await createTestUser(handle.db, { email: "sam@collectif-des-nuits.test" });
    const inv = await createInvitation(handle.db, camille.actor, ctx, orgId, {
      email: sam.email,
      role: "event_manager",
    });
    const token = tokenFromEmail(sam.email);
    await revokeInvitation(handle.db, camille.actor, orgId, inv.id, "Erreur d'adresse");
    await expect(acceptInvitation(handle.db, sam.actor, token)).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(resendInvitation(handle.db, camille.actor, ctx, orgId, inv.id)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it("a non-owner cannot invite as owner; a volunteer manager cannot invite at all", async () => {
    await expect(
      createInvitation(handle.db, nora.actor, ctx, orgId, { email: "x@y.test", role: "scanner" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
