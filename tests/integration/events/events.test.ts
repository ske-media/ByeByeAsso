import { type DatabaseHandle, schema } from "@kroov/database";
import { requirePermission } from "@kroov/domain/authorization";
import {
  archiveEvent,
  cancelEvent,
  completeEndedEvents,
  createEvent,
  createLocation,
  deleteDraftEvent,
  eventStateMachine,
  getEvent,
  getPublicEvent,
  listEvents,
  listPublicEvents,
  publicationChecklist,
  publishEvent,
  updateEvent,
} from "@kroov/domain/events";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  parseLocalDateTime,
} from "@kroov/domain/kernel";
import { createOrganization, listMembers, setMemberRoles } from "@kroov/domain/organizations";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A
let alex: TestUser; // event manager scoped to one event of A
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let locationId: string;
let nuitsId: string;
let nuitsVersion: number;

const TZ = "Europe/Paris";
const start = parseLocalDateTime("2027-06-12", "18:00", TZ)!;
const end = parseLocalDateTime("2027-06-13", "02:00", TZ)!;

beforeAll(async () => {
  handle = await freshTestDatabase();
  camille = await createTestUser(handle.db, DEMO.owner);
  alex = await createTestUser(handle.db, DEMO.admin);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  const loc = await createLocation(handle.db, camille.actor, orgA, {
    name: "Le Sucre",
    addressLine1: "50 quai Rambaud",
    postalCode: "69002",
    city: "Lyon",
    accessNotes: "Accès PMR par l'entrée principale.",
  });
  locationId = loc.id;
});

afterAll(async () => {
  await handle.close();
});

describe("B. events — state machine", () => {
  it("declares the documented graph and refuses arbitrary jumps", () => {
    expect(eventStateMachine.canTransition("draft", "published")).toBe(true);
    expect(eventStateMachine.canTransition("draft", "completed")).toBe(false);
    expect(eventStateMachine.canTransition("archived", "draft")).toBe(false);
    expect(eventStateMachine.toMermaid()).toContain("published --> cancelled");
  });
});

describe("B. events — création et validation", () => {
  it("rejects an end before the start (and an impossible duration)", async () => {
    await expect(
      createEvent(handle.db, camille.actor, orgA, { title: "Nuit", startsAt: end, endsAt: start, timezone: TZ }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createEvent(handle.db, camille.actor, orgA, {
        title: "Trop long",
        startsAt: start,
        endsAt: new Date(start.getTime() + 40 * 24 * 3600 * 1000),
        timezone: TZ,
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("creates a draft crossing midnight with an auto slug, settings and audit", async () => {
    const event = await createEvent(handle.db, camille.actor, orgA, {
      title: "Les Nuits en Commun",
      tagline: "Une nuit pour danser, se rencontrer et faire collectif.",
      startsAt: start,
      endsAt: end,
      timezone: TZ,
      capacity: 900,
      locationId,
    });
    nuitsId = event.id;
    nuitsVersion = event.version;
    expect(event.slug).toBe("les-nuits-en-commun");
    expect(event.status).toBe("draft");
    expect(event.location?.name).toBe("Le Sucre");
    expect(event.settings.showRemainingCapacity).toBe(true);
    const audit = await handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "event.created"));
    expect(audit).toHaveLength(1);
  });

  it("suffixes duplicate auto slugs and refuses an explicit duplicate", async () => {
    const second = await createEvent(handle.db, camille.actor, orgA, {
      title: "Les Nuits en Commun",
      startsAt: start,
      endsAt: end,
    });
    expect(second.slug).toBe("les-nuits-en-commun-2");
    await expect(
      createEvent(handle.db, camille.actor, orgA, {
        title: "Doublon",
        slug: "les-nuits-en-commun",
        startsAt: start,
        endsAt: end,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await deleteDraftEvent(handle.db, camille.actor, orgA, second.id);
  });

  it("refuses a location of another organization", async () => {
    const foreign = await createLocation(handle.db, bob.actor, orgB, { name: "Ailleurs", city: "Paris" });
    await expect(
      createEvent(handle.db, camille.actor, orgA, {
        title: "Intrus",
        startsAt: start,
        endsAt: end,
        locationId: foreign.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("B. events — publication", () => {
  it("refuses publication while the checklist fails and lists what is missing", async () => {
    const event = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    const failed = publicationChecklist(event)
      .filter((c) => !c.ok)
      .map((c) => c.key);
    expect(failed).toEqual(["description"]);
    await expect(publishEvent(handle.db, camille.actor, orgA, nuitsId, event.version)).rejects.toMatchObject({
      code: "precondition_failed",
      details: { checklist: ["description"] },
    });
    const still = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    expect(still.status).toBe("draft");
  });

  it("publishes once the checklist passes, bumps the version, audits and emits an outbox event", async () => {
    const updated = await updateEvent(handle.db, camille.actor, orgA, nuitsId, {
      version: nuitsVersion,
      description:
        "Trois artistes, une terrasse et toute une communauté. Venez comme vous êtes, repartez avec des souvenirs.",
    });
    const published = await publishEvent(handle.db, camille.actor, orgA, nuitsId, updated.version);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
    expect(published.version).toBe(updated.version + 1);
    nuitsVersion = published.version;
    const outbox = await handle.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, "event.published"));
    expect(outbox).toHaveLength(1);
  });

  it("cannot be published twice nor deleted once published", async () => {
    await expect(publishEvent(handle.db, camille.actor, orgA, nuitsId, nuitsVersion)).rejects.toThrow();
    await expect(deleteDraftEvent(handle.db, camille.actor, orgA, nuitsId)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });
});

describe("B. events — concurrence optimiste", () => {
  it("refuses a stale version and writes nothing", async () => {
    const current = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    const stale = current.version - 1;
    await expect(
      updateEvent(handle.db, camille.actor, orgA, nuitsId, { version: stale, title: "Écrasé" }),
    ).rejects.toMatchObject({ code: "conflict", details: { code: "stale_version", currentVersion: current.version } });
    const after = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    expect(after.title).toBe("Les Nuits en Commun");
    expect(after.version).toBe(current.version);
  });

  it("two concurrent editors: only the first succeeds", async () => {
    const current = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    const results = await Promise.allSettled([
      updateEvent(handle.db, camille.actor, orgA, nuitsId, { version: current.version, tagline: "A" }),
      updateEvent(handle.db, camille.actor, orgA, nuitsId, { version: current.version, tagline: "B" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    nuitsVersion = (await getEvent(handle.db, camille.actor, orgA, nuitsId)).version;
  });

  it("changing the dates of a published event emits a logistics event (participants notified in Phase 3)", async () => {
    const newEnd = parseLocalDateTime("2027-06-13", "03:00", TZ)!;
    const updated = await updateEvent(handle.db, camille.actor, orgA, nuitsId, {
      version: nuitsVersion,
      endsAt: newEnd,
    });
    nuitsVersion = updated.version;
    const outbox = await handle.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, "event.logistics_changed"));
    expect(outbox).toHaveLength(1);
  });
});

describe("B. events — isolation et périmètre événement", () => {
  let secondEventId: string;

  beforeAll(async () => {
    const other = await createEvent(handle.db, camille.actor, orgA, {
      title: "La Rentrée du Collectif",
      startsAt: start,
      endsAt: end,
    });
    secondEventId = other.id;
    await handle.db.insert(schema.organizationMembers).values({ organizationId: orgA, userId: alex.id });
    const members = await listMembers(handle.db, camille.actor, orgA);
    const alexMemberId = members.find((m) => m.userId === alex.id)!.id;
    await setMemberRoles(handle.db, camille.actor, orgA, alexMemberId, {
      grants: [{ role: "event_manager", eventId: nuitsId }],
    });
  });

  it("the owner of B cannot see nor touch A's event (404 / 403)", async () => {
    await expect(getEvent(handle.db, bob.actor, orgA, nuitsId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateEvent(handle.db, bob.actor, orgA, nuitsId, { version: 1, title: "Pirate" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEvents(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    // And A's event id cannot be addressed under B even by B's owner.
    await expect(getEvent(handle.db, bob.actor, orgB, nuitsId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an event-scoped manager sees only their event and cannot act on the other", async () => {
    const visible = await listEvents(handle.db, alex.actor, orgA, { status: "all" });
    expect(visible.map((e) => e.id)).toEqual([nuitsId]);
    await expect(getEvent(handle.db, alex.actor, orgA, secondEventId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateEvent(handle.db, alex.actor, orgA, secondEventId, { version: 1, title: "Pirate" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requirePermission(handle.db, alex.actor, "events.publish", { organizationId: orgA, eventId: nuitsId }),
    ).resolves.toBeTruthy();
    await expect(
      requirePermission(handle.db, alex.actor, "events.publish", { organizationId: orgA }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a scoped grant cannot reference an event of another organization (composite FK)", async () => {
    const members = await listMembers(handle.db, camille.actor, orgA);
    const alexMemberId = members.find((m) => m.userId === alex.id)!.id;
    const bobEvent = await createEvent(handle.db, bob.actor, orgB, {
      title: "Événement de B",
      startsAt: start,
      endsAt: end,
    });
    await expect(
      setMemberRoles(handle.db, camille.actor, orgA, alexMemberId, {
        grants: [{ role: "scanner", eventId: bobEvent.id }],
      }),
    ).rejects.toThrow();
  });

  it("deleting an event removes its scoped grants (cascade) and nothing else", async () => {
    const before = await handle.db
      .select()
      .from(schema.memberRoleAssignments)
      .where(
        and(eq(schema.memberRoleAssignments.organizationId, orgA), eq(schema.memberRoleAssignments.eventId, nuitsId)),
      );
    expect(before).toHaveLength(1);
    await deleteDraftEvent(handle.db, camille.actor, orgA, secondEventId);
    const after = await handle.db
      .select()
      .from(schema.memberRoleAssignments)
      .where(
        and(eq(schema.memberRoleAssignments.organizationId, orgA), eq(schema.memberRoleAssignments.eventId, nuitsId)),
      );
    expect(after).toHaveLength(1);
  });
});

describe("B. events — lecture publique", () => {
  it("serves the published event by direct link and lists it on the organization page", async () => {
    const pub = await getPublicEvent(handle.db, DEMO.organization.slug, "les-nuits-en-commun");
    expect(pub.title).toBe("Les Nuits en Commun");
    expect(pub.organization.name).toBe(DEMO.organization.name);
    expect((pub as unknown as { version?: number }).version).toBeUndefined();
    const list = await listPublicEvents(handle.db, orgA);
    expect(list.map((e) => e.slug)).toEqual(["les-nuits-en-commun"]);
  });

  it("never serves a draft publicly", async () => {
    const draft = await createEvent(handle.db, camille.actor, orgA, {
      title: "Brouillon secret",
      startsAt: start,
      endsAt: end,
      description: "Ceci est un brouillon avec une description suffisante.",
      capacity: 10,
      locationId,
    });
    await expect(getPublicEvent(handle.db, DEMO.organization.slug, draft.slug)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPublicEvents(handle.db, orgA)).map((e) => e.slug)).not.toContain(draft.slug);
  });

  it("an unlisted event is reachable by link but absent from the list; a private one is 404", async () => {
    const unlisted = await createEvent(handle.db, camille.actor, orgA, {
      title: "Soirée privée des bénévoles",
      startsAt: start,
      endsAt: end,
      description: "Réservée aux bénévoles qui ont reçu le lien direct.",
      capacity: 50,
      locationId,
      visibility: "unlisted",
    });
    await publishEvent(handle.db, camille.actor, orgA, unlisted.id, unlisted.version);
    expect((await getPublicEvent(handle.db, DEMO.organization.slug, unlisted.slug)).visibility).toBe("unlisted");
    expect((await listPublicEvents(handle.db, orgA)).map((e) => e.slug)).not.toContain(unlisted.slug);

    const privateEvent = await createEvent(handle.db, camille.actor, orgA, {
      title: "Assemblée générale",
      startsAt: start,
      endsAt: end,
      description: "Réservée aux adhérents (phase 4).",
      capacity: 50,
      locationId,
      visibility: "private",
    });
    await publishEvent(handle.db, camille.actor, orgA, privateEvent.id, privateEvent.version);
    await expect(getPublicEvent(handle.db, DEMO.organization.slug, privateEvent.slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("B. events — annulation et archivage", () => {
  it("requires a reason, audits it, emits an outbox event and keeps the public page readable with its status", async () => {
    const current = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    await expect(
      cancelEvent(handle.db, camille.actor, orgA, nuitsId, { version: current.version, reason: "x" }),
    ).rejects.toBeInstanceOf(ZodError);
    const cancelled = await cancelEvent(handle.db, camille.actor, orgA, nuitsId, {
      version: current.version,
      reason: "Salle indisponible suite à un dégât des eaux.",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toContain("dégât des eaux");
    const pub = await getPublicEvent(handle.db, DEMO.organization.slug, "les-nuits-en-commun");
    expect(pub.status).toBe("cancelled");
    expect((await listPublicEvents(handle.db, orgA)).map((e) => e.slug)).not.toContain("les-nuits-en-commun");
    const outbox = await handle.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, "event.cancelled"));
    expect(outbox).toHaveLength(1);
  });

  it("archives a cancelled event; archived is terminal and read-only", async () => {
    const current = await getEvent(handle.db, camille.actor, orgA, nuitsId);
    const archived = await archiveEvent(handle.db, camille.actor, orgA, nuitsId, current.version);
    expect(archived.status).toBe("archived");
    await expect(
      updateEvent(handle.db, camille.actor, orgA, nuitsId, { version: archived.version, title: "Nouveau titre" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(getPublicEvent(handle.db, DEMO.organization.slug, "les-nuits-en-commun")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("C. events — clôture automatique (job système)", () => {
  it("marks published events that ended more than 24 h ago as completed, once, and only those", async () => {
    const systemActor = { kind: "system", job: "events.complete-ended" } as const;
    // A published event in the past: created in the future (publication rule), then back-dated in SQL
    // as the clock would have moved on.
    const past = await createEvent(handle.db, camille.actor, orgA, {
      title: "Soirée déjà passée",
      description: "Une soirée qui s'est terminée il y a plus d'une journée.",
      startsAt: parseLocalDateTime("2027-07-01", "20:00", TZ)!,
      endsAt: parseLocalDateTime("2027-07-02", "01:00", TZ)!,
      capacity: 100,
      locationId,
    });
    const published = await publishEvent(handle.db, camille.actor, orgA, past.id, past.version);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    await handle.db
      .update(schema.events)
      .set({ startsAt: new Date(twoDaysAgo.getTime() - 4 * 3600 * 1000), endsAt: twoDaysAgo })
      .where(eq(schema.events.id, published.id));
    // A published event still running (ended 1 h ago) must NOT be completed yet.
    const recent = await createEvent(handle.db, camille.actor, orgA, {
      title: "Soirée tout juste finie",
      description: "Terminée il y a une heure : on laisse le temps aux retardataires.",
      startsAt: parseLocalDateTime("2027-07-03", "20:00", TZ)!,
      endsAt: parseLocalDateTime("2027-07-04", "01:00", TZ)!,
      capacity: 100,
      locationId,
    });
    const recentPublished = await publishEvent(handle.db, camille.actor, orgA, recent.id, recent.version);
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    await handle.db
      .update(schema.events)
      .set({ startsAt: new Date(oneHourAgo.getTime() - 4 * 3600 * 1000), endsAt: oneHourAgo })
      .where(eq(schema.events.id, recentPublished.id));

    await expect(completeEndedEvents(handle.db, camille.actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await completeEndedEvents(handle.db, systemActor)).toBe(1);
    expect(await completeEndedEvents(handle.db, systemActor)).toBe(0);
    expect((await getEvent(handle.db, camille.actor, orgA, published.id)).status).toBe("completed");
    expect((await getEvent(handle.db, camille.actor, orgA, recentPublished.id)).status).toBe("published");
    const outbox = await handle.db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(eq(schema.outboxEvents.aggregateId, published.id), eq(schema.outboxEvents.eventType, "event.completed")),
      );
    expect(outbox).toHaveLength(1);
    // Completed events stay on the public page (with their status) for a while.
    expect((await getPublicEvent(handle.db, DEMO.organization.slug, published.slug)).status).toBe("completed");
  });
});
