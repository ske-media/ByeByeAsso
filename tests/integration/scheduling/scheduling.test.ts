import type { DatabaseHandle } from "@kroov/database";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import { type Actor, ForbiddenError, NotFoundError, parseLocalDateTime } from "@kroov/domain/kernel";
import { acceptInvitation, createInvitation, createOrganization } from "@kroov/domain/organizations";
import {
  assignVolunteer,
  confirmMission,
  createVersion,
  diffVersions,
  generateVersion,
  getVersion,
  listMissions,
  listRequests,
  listRuns,
  listVersions,
  markUnderReview,
  planningOverview,
  publishVersion,
  recordAttendance,
  reportUnavailable,
  resolveRequest,
  scheduleVersionStateMachine,
  setAssignmentLock,
  unassignVolunteer,
} from "@kroov/domain/scheduling";
import {
  activateEventPosition,
  applyAsVolunteer,
  createPosition,
  createShift,
  createSkill,
  createTeam,
  decideApplication,
  getApplicationForCandidate,
  updateApplicationByCandidate,
  updateVolunteering,
  type VolunteerContext,
  verifySkill,
} from "@kroov/domain/volunteers";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A (schedules.publish)
let nora: TestUser; // volunteer manager of A
let bob: TestUser; // owner of B
let orgA: string;
let email: ConsoleEmailAdapter;
let ctx: VolunteerContext;
let eventId: string;
let eventSlug: string;
let barOpen: string; // bar 17:00→23:00 required 2
let barNight: string; // bar 23:00→03:00 required 1
let secours: string; // secours 18:00→02:00 required 1 (SST verified)
let skillSst: string;
let barPosition: string;
let securityPosition: string;
const anon: Actor = { kind: "anonymous" };
const TZ = "Europe/Paris";
const t = (date: string, time: string) => parseLocalDateTime(date, time, TZ)!;
const volunteers: Record<string, { id: string; accessToken: string; email: string }> = {};

async function apply(name: string, from: string, to: string, prefs: string[], extra: Record<string, unknown> = {}) {
  const [firstName, lastName] = name.split(" ") as [string, string];
  const em = `${firstName.toLowerCase()}@example.test`;
  const v = await applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
    email: em,
    firstName,
    lastName,
    positionPreferences: prefs,
    availabilities: [
      { kind: "available", startsAt: t("2027-06-12", from), endsAt: t(to < from ? "2027-06-13" : "2027-06-12", to) },
    ],
    ...extra,
  });
  await decideApplication(handle.db, ctx, nora.actor, orgA, v.id, "approve");
  volunteers[firstName] = { id: v.id, accessToken: v.accessToken, email: em };
  return v.id;
}

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new ConsoleEmailAdapter(() => undefined);
  ctx = { email, appName: "Kroov", appUrl: "http://test.local", credentialSecret: "integration-credential-secret" };
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" });
  await createInvitation(handle.db, camille.actor, ctx, orgA, { email: nora.email, role: "volunteer_manager" });
  const token = email.lastTo(nora.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, nora.actor, token!);
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const ev = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière, trois scènes, et un planning à proposer puis à valider à la main.",
    startsAt: t("2027-06-12", "18:00"),
    endsAt: t("2027-06-13", "02:00"),
    capacity: 900,
    locationId: loc.id,
  });
  const pub = await publishEvent(handle.db, camille.actor, orgA, ev.id, ev.version);
  eventId = pub.id;
  eventSlug = pub.slug;
  skillSst = (await createSkill(handle.db, nora.actor, orgA, { name: "SST", requiresVerification: true })).id;
  const team = (await createTeam(handle.db, nora.actor, orgA, { name: "Bar" })).id;
  barPosition = (await createPosition(handle.db, nora.actor, orgA, { teamId: team, name: "Bar principal" })).id;
  securityPosition = (
    await createPosition(handle.db, nora.actor, orgA, {
      teamId: team,
      name: "Poste de secours",
      skills: [{ skillId: skillSst, mandatory: true }],
    })
  ).id;
  const bar = await activateEventPosition(handle.db, nora.actor, orgA, eventId, { positionId: barPosition });
  const sec = await activateEventPosition(handle.db, nora.actor, orgA, eventId, { positionId: securityPosition });
  barOpen = (
    await createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
      label: "Ouverture",
      startsAt: t("2027-06-12", "17:00"),
      endsAt: t("2027-06-12", "23:00"),
      requiredCount: 2,
      maxCount: 3,
    })
  ).id;
  barNight = (
    await createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
      label: "Nuit",
      startsAt: t("2027-06-12", "23:00"),
      endsAt: t("2027-06-13", "03:00"),
      requiredCount: 1,
    })
  ).id;
  secours = (
    await createShift(handle.db, nora.actor, orgA, eventId, sec.id, {
      startsAt: t("2027-06-12", "18:00"),
      endsAt: t("2027-06-13", "02:00"),
      requiredCount: 1,
    })
  ).id;
  await updateVolunteering(handle.db, nora.actor, orgA, eventId, {
    recruitmentStatus: "open",
    maxHoursPerDay: 10,
    minRestMinutes: 0,
  });
  // Volunteers: Maya (SST verified, all night), Sam (evening only), Lou (all night), Noé (night only).
  await apply("Maya Bernard", "16:00", "03:00", [securityPosition, barPosition], { skills: [{ skillId: skillSst }] });
  await verifySkill(handle.db, nora.actor, orgA, volunteers.Maya!.id, skillSst, true);
  await apply("Sam Moreau", "16:00", "23:30", [barPosition]);
  await apply("Lou Martin", "16:00", "03:00", [barPosition]);
  await apply("Noe Garnier", "22:00", "03:00", [barPosition]);
});

afterAll(async () => {
  await handle.close();
});

let v1: string;
let v2: string;

describe("A. versions and generation", () => {
  it("declares the version graph: published only moves to superseded; superseded is terminal", () => {
    const sm = scheduleVersionStateMachine;
    expect(sm.canTransition("draft", "generating")).toBe(true);
    expect(sm.canTransition("proposed", "under_review")).toBe(true);
    expect(sm.canTransition("under_review", "published")).toBe(true);
    expect(sm.canTransition("published", "under_review")).toBe(false);
    expect(sm.canTransition("published", "superseded")).toBe(true);
    expect(sm.canTransition("superseded", "published")).toBe(false);
  });

  it("creates a version and generates a proposal: full coverage, journaled run with immutable snapshot", async () => {
    await expect(createVersion(handle.db, bob.actor, orgA, eventId)).rejects.toBeInstanceOf(ForbiddenError);
    const created = await createVersion(handle.db, nora.actor, orgA, eventId, { notes: "Première proposition" });
    v1 = created.id;
    expect(created).toMatchObject({ number: 1, label: "V1", status: "draft", requiredTotal: 4 });
    const { version, run, output } = await generateVersion(handle.db, nora.actor, orgA, v1);
    expect(version.status).toBe("proposed");
    expect(run).toMatchObject({
      status: "succeeded",
      algorithmVersion: "kroov-greedy-ls/1",
      coveredCount: 4,
      unfilledCount: 0,
    });
    expect(run.inputHash).toHaveLength(64);
    expect(output.solverStatus).toBe("complete");
    const detail = await getVersion(handle.db, nora.actor, orgA, v1);
    expect(detail.coveredCount).toBe(4);
    expect(detail.conflicts).toEqual([]);
    // Only Maya has a verified SST: she is on the secours shift.
    const sec = detail.shifts.find((s) => s.shiftId === secours)!;
    expect(sec.assignments.map((a) => a.applicationId)).toEqual([volunteers.Maya!.id]);
    // Noé is the only one free for the night once Maya is on secours (Lou could be, but night ≥ 1 is covered).
    const night = detail.shifts.find((s) => s.shiftId === barNight)!;
    expect(night.assignments).toHaveLength(1);
    expect((await listRuns(handle.db, nora.actor, orgA, eventId))[0]?.id).toBe(run.id);
    // Snapshot is immutable: the run keeps the volunteers it saw.
    const snapshot = (await listRuns(handle.db, nora.actor, orgA, eventId))[0];
    expect(snapshot?.diagnostics).toMatchObject({ requiredTotal: 4 });
    expect(JSON.stringify(detail)).not.toMatch(/internalNotes|accessTokenHash/);
  });

  it("manual edits are validated with explanations; locks survive regeneration; published-style immutability is enforced later", async () => {
    const detail = await getVersion(handle.db, nora.actor, orgA, v1);
    const open = detail.shifts.find((s) => s.shiftId === barOpen)!;
    // Sam cannot take the night shift (unavailable after 23:30); the exclusion is explained.
    const night = detail.shifts.find((s) => s.shiftId === barNight)!;
    expect(night.excluded.find((e) => e.applicationId === volunteers.Sam!.id)?.reason).toBe("not_available");
    await expect(
      assignVolunteer(handle.db, nora.actor, orgA, v1, { shiftId: barNight, applicationId: volunteers.Sam!.id }),
    ).rejects.toMatchObject({ details: { code: "hard_constraint", reason: "not_available" } });
    // Lou cannot take secours (no verified SST).
    await expect(
      assignVolunteer(handle.db, nora.actor, orgA, v1, { shiftId: secours, applicationId: volunteers.Lou!.id }),
    ).rejects.toMatchObject({ details: { reason: "missing_skill" } });
    // Remove one bar opener, add them back manually and lock.
    const victim = open.assignments[0]!;
    let after = await unassignVolunteer(handle.db, nora.actor, orgA, v1, victim.id);
    expect(after.shifts.find((s) => s.shiftId === barOpen)!.missing).toBe(1);
    after = await assignVolunteer(handle.db, nora.actor, orgA, v1, {
      shiftId: barOpen,
      applicationId: victim.applicationId,
      lock: true,
    });
    const locked = after.shifts
      .find((s) => s.shiftId === barOpen)!
      .assignments.find((a) => a.applicationId === victim.applicationId)!;
    expect(locked).toMatchObject({ source: "manual", locked: true });
    // Partial regeneration of the bar shifts keeps the lock and the secours assignment untouched.
    const { output } = await generateVersion(handle.db, nora.actor, orgA, v1, { shiftIds: [barOpen, barNight] });
    expect(
      output.assignments.find((a) => a.shiftId === barOpen && a.volunteerId === victim.applicationId)?.source,
    ).toBe("locked");
    expect(output.assignments.find((a) => a.shiftId === secours)?.source).toBe("fixed");
    const regenerated = await getVersion(handle.db, nora.actor, orgA, v1);
    expect(regenerated.coveredCount).toBe(4);
    expect(
      regenerated.shifts
        .find((s) => s.shiftId === barOpen)!
        .assignments.find((a) => a.applicationId === victim.applicationId)?.locked,
    ).toBe(true);
    // Bob cannot read A's version; Nora cannot unlock a foreign assignment id.
    await expect(getVersion(handle.db, bob.actor, orgA, v1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setAssignmentLock(handle.db, nora.actor, orgA, v1, "00000000-0000-4000-8000-000000000000", false),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("B. publication", () => {
  it("refuses publication without schedules.publish, with a stale version, or when a conflict appeared on current data", async () => {
    const detail = await markUnderReview(handle.db, nora.actor, orgA, v1);
    expect(detail.status).toBe("under_review");
    // Nora (volunteer_manager) has schedules.publish in the catalogue; Bob has nothing here.
    await expect(
      publishVersion(handle.db, ctx, bob.actor, orgA, v1, { expectedVersion: detail.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      publishVersion(handle.db, ctx, camille.actor, orgA, v1, { expectedVersion: detail.version - 1 }),
    ).rejects.toMatchObject({ details: { code: "stale_version" } });
    // Noé narrows his availability after the proposal: the night assignment becomes a blocking conflict.
    const night = detail.shifts.find((s) => s.shiftId === barNight)!;
    const nightVolunteer = night.assignments[0]!.applicationId;
    const who = Object.values(volunteers).find((v) => v.id === nightVolunteer)!;
    await updateApplicationByCandidate(
      handle.db,
      ctx,
      who.id,
      { accessToken: who.accessToken },
      {
        availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "01:00") }],
      },
    );
    const withConflict = await getVersion(handle.db, nora.actor, orgA, v1);
    expect(withConflict.conflicts).toEqual([
      expect.objectContaining({ shiftId: barNight, applicationId: who.id, reason: "not_available" }),
    ]);
    expect(withConflict.canPublish).toBe(false);
    await expect(
      publishVersion(handle.db, ctx, camille.actor, orgA, v1, { expectedVersion: withConflict.version }),
    ).rejects.toMatchObject({ details: { code: "conflicts" } });
    // Restore availability.
    await updateApplicationByCandidate(
      handle.db,
      ctx,
      who.id,
      { accessToken: who.accessToken },
      {
        availabilities: [
          {
            kind: "available",
            startsAt: t("2027-06-12", who.email.startsWith("noe") ? "22:00" : "16:00"),
            endsAt: t("2027-06-13", "03:00"),
          },
        ],
      },
    );
    expect((await getVersion(handle.db, nora.actor, orgA, v1)).conflicts).toEqual([]);
  });

  it("unfilled required positions need an explicit acknowledgement; concurrent publications: exactly one wins", async () => {
    // Cancel coverage artificially: unassign the night volunteer → 1 unfilled.
    let detail = await getVersion(handle.db, nora.actor, orgA, v1);
    const night = detail.shifts.find((s) => s.shiftId === barNight)!;
    const removed = night.assignments[0]!;
    detail = await unassignVolunteer(handle.db, nora.actor, orgA, v1, removed.id);
    expect(detail.unfilled).toHaveLength(1);
    await expect(
      publishVersion(handle.db, ctx, camille.actor, orgA, v1, { expectedVersion: detail.version }),
    ).rejects.toMatchObject({ details: { code: "unfilled" } });
    detail = await assignVolunteer(handle.db, nora.actor, orgA, v1, {
      shiftId: barNight,
      applicationId: removed.applicationId,
    });
    expect(detail.unfilled).toEqual([]);
    // Two managers publish the same version concurrently with the same expected token.
    const results = await Promise.allSettled([
      publishVersion(handle.db, ctx, camille.actor, orgA, v1, { expectedVersion: detail.version }),
      publishVersion(handle.db, ctx, nora.actor, orgA, v1, { expectedVersion: detail.version }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    const published = await getVersion(handle.db, nora.actor, orgA, v1);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
    // Every volunteer in the version got exactly one e-mail with their missions; applications are `assigned`.
    for (const v of Object.values(volunteers)) {
      const mail = email.lastTo(v.email);
      expect(mail?.subject).toContain("Planning V1");
      expect(mail?.text).toContain("NOUVEAU");
      const app = await getApplicationForCandidate(handle.db, ctx, v.id, { accessToken: v.accessToken });
      expect(app.status).toBe("assigned");
      expect(app.editable).toBe(false);
    }
    // Published version is immutable.
    await expect(
      assignVolunteer(handle.db, nora.actor, orgA, v1, { shiftId: barOpen, applicationId: volunteers.Lou!.id }),
    ).rejects.toMatchObject({ details: { code: "version_immutable" } });
    await expect(generateVersion(handle.db, nora.actor, orgA, v1)).rejects.toMatchObject({
      details: { code: "version_immutable" },
    });
  });

  it("the volunteer sees only their published missions, confirms, then reports an unavailability (arbitration request)", async () => {
    const maya = volunteers.Maya!;
    await expect(listMissions(handle.db, maya.id, { accessToken: "forged" })).rejects.toBeInstanceOf(NotFoundError);
    const missions = await listMissions(handle.db, maya.id, { accessToken: maya.accessToken });
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({
      positionName: "Poste de secours",
      versionLabel: "V1",
      confirmationStatus: "pending",
    });
    expect(JSON.stringify(missions)).not.toMatch(/Sam|Lou|Noe/);
    const confirmed = await confirmMission(
      handle.db,
      maya.id,
      { accessToken: maya.accessToken },
      missions[0]!.assignmentId,
    );
    expect(confirmed[0]?.confirmationStatus).toBe("confirmed");
    expect((await getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: maya.accessToken })).status).toBe(
      "confirmed",
    );
    // Sam reports an unavailability on his mission: the assignment stays, a request is opened, the manager sees it.
    const sam = volunteers.Sam!;
    const samMissions = await listMissions(handle.db, sam.id, { accessToken: sam.accessToken });
    const reported = await reportUnavailable(
      handle.db,
      ctx,
      sam.id,
      { accessToken: sam.accessToken },
      samMissions[0]!.assignmentId,
      "Empêchement familial",
    );
    expect(reported[0]).toMatchObject({ confirmationStatus: "declined", openRequest: { kind: "unavailable" } });
    expect(email.lastTo(sam.email)?.subject).toContain("Indisponibilité reçue");
    await expect(
      reportUnavailable(
        handle.db,
        ctx,
        sam.id,
        { accessToken: sam.accessToken },
        samMissions[0]!.assignmentId,
        undefined,
      ),
    ).rejects.toMatchObject({ details: { code: "request_open" } });
    const requests = await listRequests(handle.db, nora.actor, orgA, eventId);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      volunteerName: "Sam Moreau",
      kind: "unavailable",
      message: "Empêchement familial",
      status: "open",
    });
    expect((await getVersion(handle.db, nora.actor, orgA, v1)).openRequests).toBe(1);
    // Sam cannot confirm/report someone else's mission.
    await expect(
      confirmMission(handle.db, sam.id, { accessToken: sam.accessToken }, missions[0]!.assignmentId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a new version based on the published one replaces Sam, the diff is explicit, and publication notifies changed missions only", async () => {
    const created = await createVersion(handle.db, nora.actor, orgA, eventId, { basedOnVersionId: v1 });
    v2 = created.id;
    expect(created).toMatchObject({ number: 2, status: "draft", assignmentsCount: 4 });
    let detail = await getVersion(handle.db, nora.actor, orgA, v2);
    const samAssignment = detail.shifts
      .flatMap((s) => s.assignments)
      .find((a) => a.applicationId === volunteers.Sam!.id)!;
    detail = await unassignVolunteer(handle.db, nora.actor, orgA, v2, samAssignment.id);
    detail = await assignVolunteer(handle.db, nora.actor, orgA, v2, {
      shiftId: barOpen,
      applicationId: volunteers.Lou!.id,
    }).catch(async (e) => {
      // Lou may already be on the opening shift; then put Noé there if free, else accept partial coverage.
      if ((e as { details?: { code?: string } }).details?.code === "already_assigned")
        return getVersion(handle.db, nora.actor, orgA, v2);
      throw e;
    });
    const diff = await diffVersions(handle.db, nora.actor, orgA, v2, v1);
    expect(diff.some((d) => d.applicationId === volunteers.Sam!.id && d.change === "removed")).toBe(true);
    const before = email.sent.length;
    const result = await publishVersion(handle.db, ctx, camille.actor, orgA, v2, {
      expectedVersion: detail.version,
      acknowledgeUnfilled: true,
      notes: "Remplacement de Sam",
    });
    expect(result.version.status).toBe("published");
    expect(result.supersededVersionId).toBe(v1);
    expect((await getVersion(handle.db, nora.actor, orgA, v1)).status).toBe("superseded");
    expect(result.changes.length).toBeGreaterThan(0);
    // Maya's mission did not change: no e-mail for her; Sam is told his mission is removed.
    const sentAfter = email.sent.slice(before);
    expect(sentAfter.some((m) => m.to === volunteers.Maya!.email)).toBe(false);
    const samMail = sentAfter.find((m) => m.to === volunteers.Sam!.email);
    expect(samMail?.text).toContain("RETIRÉ");
    expect(result.notified).toBe(sentAfter.length);
    // Sam is back to approved; Maya stays confirmed (her unchanged mission kept its confirmation).
    expect(
      (
        await getApplicationForCandidate(handle.db, ctx, volunteers.Sam!.id, {
          accessToken: volunteers.Sam!.accessToken,
        })
      ).status,
    ).toBe("approved");
    expect(
      (
        await getApplicationForCandidate(handle.db, ctx, volunteers.Maya!.id, {
          accessToken: volunteers.Maya!.accessToken,
        })
      ).status,
    ).toBe("confirmed");
    expect(
      (await listMissions(handle.db, volunteers.Maya!.id, { accessToken: volunteers.Maya!.accessToken }))[0]
        ?.confirmationStatus,
    ).toBe("confirmed");
    expect(await listMissions(handle.db, volunteers.Sam!.id, { accessToken: volunteers.Sam!.accessToken })).toEqual([]);
    // Only one published version per event.
    const versions = await listVersions(handle.db, nora.actor, orgA, eventId);
    expect(versions.filter((v) => v.status === "published")).toHaveLength(1);
    await resolveRequest(
      handle.db,
      nora.actor,
      orgA,
      (await listRequests(handle.db, nora.actor, orgA, eventId))[0]!.id,
      "resolved",
      "Remplacé dans V2",
    );
    expect(await listRequests(handle.db, nora.actor, orgA, eventId)).toEqual([]);
  });

  it("attendance is recorded on the published version only; the overview lists the event", async () => {
    const published = await getVersion(handle.db, nora.actor, orgA, v2);
    const maya = published.shifts.flatMap((s) => s.assignments).find((a) => a.applicationId === volunteers.Maya!.id)!;
    await recordAttendance(handle.db, nora.actor, orgA, maya.id, { status: "present" });
    await recordAttendance(handle.db, nora.actor, orgA, maya.id, { status: "late", note: "15 min" });
    const again = await getVersion(handle.db, nora.actor, orgA, v2);
    expect(again.shifts.flatMap((s) => s.assignments).find((a) => a.id === maya.id)?.attendance).toEqual({
      status: "late",
      note: "15 min",
    });
    const old = await getVersion(handle.db, nora.actor, orgA, v1);
    const oldAssignment = old.shifts.flatMap((s) => s.assignments)[0]!;
    await expect(
      recordAttendance(handle.db, nora.actor, orgA, oldAssignment.id, { status: "present" }),
    ).rejects.toMatchObject({ details: { code: "not_published" } });
    const overview = await planningOverview(handle.db, nora.actor, orgA, [eventId]);
    expect(overview[0]).toMatchObject({
      eventTitle: "Les Nuits en Commun",
      publishedVersion: expect.objectContaining({ label: "V2" }),
      openRequests: 0,
    });
  });
});
