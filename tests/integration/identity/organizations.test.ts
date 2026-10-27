import { type DatabaseHandle, schema } from "@kroov/database";
import { countActiveOwners, loadMemberContext, requirePermission } from "@kroov/domain/authorization";
import { ConflictError, ForbiddenError, NotFoundError, PreconditionFailedError } from "@kroov/domain/kernel";
import {
  createOrganization,
  getOrganization,
  getOrganizationBySlug,
  listMembers,
  listMyOrganizations,
  removeMember,
  setMemberRoles,
  updateOrganization,
} from "@kroov/domain/organizations";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser;
let alex: TestUser;
let nora: TestUser;
let stranger: TestUser;
let orgId: string;

beforeAll(async () => {
  handle = await freshTestDatabase();
  camille = await createTestUser(handle.db, DEMO.owner);
  alex = await createTestUser(handle.db, DEMO.admin);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  stranger = await createTestUser(handle.db, { name: "Autre Organisation", email: "autre@autre-asso.test" });
});

afterAll(async () => {
  await handle.close();
});

describe("A. organisations — création", () => {
  it("owner creates an organization and becomes its only owner, with settings and audit", async () => {
    const org = await createOrganization(handle.db, camille.actor, DEMO.organization);
    orgId = org.id;
    expect(org.slug).toBe("le-collectif-des-nuits");
    expect(org.settings.currency).toBe("EUR");
    expect(await countActiveOwners(handle.db, org.id)).toBe(1);

    const ctx = await loadMemberContext(handle.db, camille.id, org.id);
    expect(ctx?.organizationRoles).toEqual(["owner"]);
    expect(ctx?.organizationPermissions.has("billing.manage")).toBe(true);

    const audit = await handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, org.id));
    expect(audit.map((a) => a.action)).toContain("organization.created");
  });

  it("rejects a duplicate slug and a reserved slug", async () => {
    await expect(createOrganization(handle.db, alex.actor, DEMO.organization)).rejects.toBeInstanceOf(ConflictError);
    await expect(createOrganization(handle.db, alex.actor, { name: "Admin", slug: "admin" })).rejects.toThrow();
  });

  it("lists only the organizations the user belongs to", async () => {
    const mine = await listMyOrganizations(handle.db, camille.actor);
    expect(mine.map((o) => o.slug)).toEqual(["le-collectif-des-nuits"]);
    expect(mine[0]?.roles).toEqual(["owner"]);
    expect(await listMyOrganizations(handle.db, stranger.actor)).toEqual([]);
  });
});

describe("A. organisations — isolation tenant", () => {
  it("a non-member gets 404 (not 403) on read: existence is not disclosed", async () => {
    await expect(getOrganization(handle.db, stranger.actor, orgId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrganizationBySlug(handle.db, stranger.actor, "le-collectif-des-nuits")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("a non-member is forbidden on every mutation", async () => {
    await expect(updateOrganization(handle.db, stranger.actor, orgId, { name: "Piraté" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listMembers(handle.db, stranger.actor, orgId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      removeMember(handle.db, stranger.actor, orgId, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an anonymous actor is unauthenticated, never authorized", async () => {
    await expect(
      requirePermission(handle.db, { kind: "anonymous" }, "organization.read", { organizationId: orgId }),
    ).rejects.toThrow(/Connexion requise/);
  });
});

describe("A. organisations — rôles et dernier propriétaire", () => {
  let alexMemberId: string;
  let noraMemberId: string;

  beforeAll(async () => {
    // Add Alex and Nora as members directly (invitation flow is tested separately).
    for (const u of [alex, nora]) {
      await handle.db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: u.id });
    }
    const members = await listMembers(handle.db, camille.actor, orgId);
    alexMemberId = members.find((m) => m.userId === alex.id)!.id;
    noraMemberId = members.find((m) => m.userId === nora.id)!.id;
  });

  it("a member without any grant has no permission (deny by default)", async () => {
    await expect(listMembers(handle.db, alex.actor, orgId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("owner grants organization_admin; admin can then read and manage members but not billing", async () => {
    const view = await setMemberRoles(handle.db, camille.actor, orgId, alexMemberId, {
      grants: [{ role: "organization_admin" }],
    });
    expect(view.grants.map((g) => g.role)).toEqual(["organization_admin"]);
    const ctx = await loadMemberContext(handle.db, alex.id, orgId);
    expect(ctx?.organizationPermissions.has("members.manage")).toBe(true);
    expect(ctx?.organizationPermissions.has("billing.manage")).toBe(false);
  });

  it("event-scoped grants only apply to that event", async () => {
    const eventA = "11111111-1111-4111-8111-111111111111";
    const eventB = "22222222-2222-4222-8222-222222222222";
    await setMemberRoles(handle.db, alex.actor, orgId, noraMemberId, {
      grants: [{ role: "volunteer_manager", eventId: eventA }],
    });
    await expect(
      requirePermission(handle.db, nora.actor, "volunteers.review", { organizationId: orgId, eventId: eventA }),
    ).resolves.toBeTruthy();
    await expect(
      requirePermission(handle.db, nora.actor, "volunteers.review", { organizationId: orgId, eventId: eventB }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requirePermission(handle.db, nora.actor, "volunteers.review", { organizationId: orgId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an admin cannot grant or revoke the owner role", async () => {
    await expect(
      setMemberRoles(handle.db, alex.actor, orgId, noraMemberId, { grants: [{ role: "owner" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the last owner cannot be demoted nor removed", async () => {
    const members = await listMembers(handle.db, camille.actor, orgId);
    const camilleMemberId = members.find((m) => m.userId === camille.id)!.id;
    await expect(
      setMemberRoles(handle.db, camille.actor, orgId, camilleMemberId, { grants: [{ role: "organization_admin" }] }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(removeMember(handle.db, camille.actor, orgId, camilleMemberId)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(await countActiveOwners(handle.db, orgId)).toBe(1);
  });

  it("with a second owner, the first can step down; then the second becomes protected", async () => {
    await setMemberRoles(handle.db, camille.actor, orgId, alexMemberId, { grants: [{ role: "owner" }] });
    expect(await countActiveOwners(handle.db, orgId)).toBe(2);
    const members = await listMembers(handle.db, camille.actor, orgId);
    const camilleMemberId = members.find((m) => m.userId === camille.id)!.id;
    await setMemberRoles(handle.db, camille.actor, orgId, camilleMemberId, {
      grants: [{ role: "organization_admin" }],
    });
    expect(await countActiveOwners(handle.db, orgId)).toBe(1);
    await expect(removeMember(handle.db, camille.actor, orgId, alexMemberId)).rejects.toBeInstanceOf(ForbiddenError);
    // Restore Camille as owner for the following tests.
    await setMemberRoles(handle.db, alex.actor, orgId, camilleMemberId, { grants: [{ role: "owner" }] });
  });

  it("removing a member deletes grants, keeps the row for audit, and blocks further access", async () => {
    await removeMember(handle.db, camille.actor, orgId, noraMemberId, "Fin de mission");
    expect(await loadMemberContext(handle.db, nora.id, orgId)).toBeNull();
    const rows = await handle.db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.id, noraMemberId));
    expect(rows[0]?.status).toBe("removed");
    await expect(getOrganization(handle.db, nora.actor, orgId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("organization update is audited with the changed fields", async () => {
    const org = await updateOrganization(handle.db, camille.actor, orgId, {
      name: "Le Collectif des Nuits — Lyon",
      settings: { contactEmail: "bonjour@collectif.test", website: "https://collectif.test" },
    });
    expect(org.name).toBe("Le Collectif des Nuits — Lyon");
    expect(org.settings.contactEmail).toBe("bonjour@collectif.test");
    const audit = await handle.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "organization.updated"));
    expect(audit.length).toBeGreaterThan(0);
  });
});
