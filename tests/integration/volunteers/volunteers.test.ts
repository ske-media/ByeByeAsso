import type { DatabaseHandle } from "@kroov/database";
import { createEvent, createLocation, publishEvent } from "@kroov/domain/events";
import { type Actor, ForbiddenError, NotFoundError, parseLocalDateTime } from "@kroov/domain/kernel";
import { acceptInvitation, createInvitation, createOrganization } from "@kroov/domain/organizations";
import {
  activateEventPosition,
  applicationStats,
  applyAsVolunteer,
  availabilityMatrix,
  bulkDecide,
  cancelShift,
  coverageOf,
  createPosition,
  createShift,
  createSkill,
  createTeam,
  decideApplication,
  effectiveAvailability,
  getApplication,
  getApplicationForCandidate,
  getPublicVolunteering,
  getVolunteering,
  listApplications,
  listMyApplications,
  listPositions,
  listSkills,
  mergeIntervals,
  subtractIntervals,
  updateApplicationByCandidate,
  updateApplicationByStaff,
  updateVolunteering,
  type VolunteerContext,
  validateRanges,
  verifySkill,
  volunteerApplicationStateMachine,
  withdrawApplication,
} from "@kroov/domain/volunteers";
import { ConsoleEmailAdapter } from "@kroov/notifications";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "../helpers/db";
import { createTestUser, DEMO, type TestUser } from "../helpers/fixtures";

let handle: DatabaseHandle;
let camille: TestUser; // owner of A
let nora: TestUser; // volunteer manager of A (organization-wide)
let bob: TestUser; // owner of B
let orgA: string;
let orgB: string;
let email: ConsoleEmailAdapter;
let ctx: VolunteerContext;
let eventId: string;
let eventSlug: string;
let barTeam: string;
let barPosition: string;
let welcomePosition: string;
let securityPosition: string;
let skillBar: string; // no verification
let skillSst: string; // requires verification
let shiftEarly: string; // 17:00 → 23:00
let shiftLate: string; // 23:00 → 03:00
const anon: Actor = { kind: "anonymous" };
const TZ = "Europe/Paris";
const t = (date: string, time: string) => parseLocalDateTime(date, time, TZ)!;
const EVENT_START = t("2027-06-12", "18:00");
const EVENT_END = t("2027-06-13", "02:00");

beforeAll(async () => {
  handle = await freshTestDatabase();
  email = new ConsoleEmailAdapter(() => undefined);
  ctx = { email, appName: "Kroov", appUrl: "http://test.local", credentialSecret: "integration-credential-secret" };
  camille = await createTestUser(handle.db, DEMO.owner);
  nora = await createTestUser(handle.db, DEMO.volunteerManager);
  bob = await createTestUser(handle.db, { name: "Bob B", email: "bob@autre-asso.test" });
  orgA = (await createOrganization(handle.db, camille.actor, DEMO.organization)).id;
  orgB = (await createOrganization(handle.db, bob.actor, { name: "Autre Asso", slug: "autre-asso" })).id;
  await createInvitation(handle.db, camille.actor, ctx, orgA, { email: nora.email, role: "volunteer_manager" });
  const token = email.lastTo(nora.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
  await acceptInvitation(handle.db, nora.actor, token!);
  const loc = await createLocation(handle.db, camille.actor, orgA, { name: "Le Sucre", city: "Lyon" });
  const ev = await createEvent(handle.db, camille.actor, orgA, {
    title: "Les Nuits en Commun",
    slug: "les-nuits-en-commun",
    description: "Une nuit entière, trois scènes, et une équipe de bénévoles pour la faire tenir debout.",
    startsAt: EVENT_START,
    endsAt: EVENT_END,
    capacity: 900,
    locationId: loc.id,
  });
  const pub = await publishEvent(handle.db, camille.actor, orgA, ev.id, ev.version);
  eventId = pub.id;
  eventSlug = pub.slug;
});

afterAll(async () => {
  await handle.close();
});

describe("A. pure rules", () => {
  it("declares the application graph: terminal states never move, assigned/confirmed reserved to phase 6", () => {
    const sm = volunteerApplicationStateMachine;
    expect(sm.canTransition("submitted", "approved")).toBe(true);
    expect(sm.canTransition("approved", "waitlisted")).toBe(true);
    expect(sm.canTransition("waitlisted", "approved")).toBe(true);
    expect(sm.canTransition("approved", "assigned")).toBe(true);
    expect(sm.canTransition("rejected", "approved")).toBe(false);
    expect(sm.canTransition("withdrawn", "submitted")).toBe(false);
    expect(sm.canTransition("submitted", "confirmed")).toBe(false);
  });

  it("merges, subtracts and validates availability ranges", () => {
    const h = (n: number) => n * 3_600_000;
    expect(
      mergeIntervals([
        { start: h(1), end: h(3) },
        { start: h(2), end: h(5) },
        { start: h(7), end: h(8) },
      ]),
    ).toEqual([
      { start: h(1), end: h(5) },
      { start: h(7), end: h(8) },
    ]);
    expect(
      subtractIntervals(
        [{ start: h(0), end: h(10) }],
        [
          { start: h(3), end: h(4) },
          { start: h(9), end: h(12) },
        ],
      ),
    ).toEqual([
      { start: h(0), end: h(3) },
      { start: h(4), end: h(9) },
    ]);
    const eff = effectiveAvailability([
      { kind: "available", startsAt: new Date(h(0)), endsAt: new Date(h(10)) },
      { kind: "unavailable", startsAt: new Date(h(5)), endsAt: new Date(h(6)) },
    ]);
    expect(coverageOf(eff, { start: h(1), end: h(4) })).toBe("full");
    expect(coverageOf(eff, { start: h(4), end: h(7) })).toBe("partial");
    expect(coverageOf(eff, { start: h(11), end: h(12) })).toBe("none");
    const window = { start: h(0), end: h(48) };
    expect(
      validateRanges([{ kind: "available", startsAt: new Date(h(-2)), endsAt: new Date(h(3)) }], window),
    ).toContain("Une plage sort de la fenêtre de l'événement (la veille au lendemain).");
    expect(
      validateRanges(
        [
          { kind: "available", startsAt: new Date(h(1)), endsAt: new Date(h(5)) },
          { kind: "available", startsAt: new Date(h(4)), endsAt: new Date(h(6)) },
        ],
        window,
      ),
    ).toContain("Deux plages disponibles se chevauchent : fusionnez-les.");
    expect(validateRanges([{ kind: "available", startsAt: new Date(h(1)), endsAt: new Date(h(5)) }], window)).toEqual(
      [],
    );
  });
});

describe("B. catalogue and staffing", () => {
  it("creates skills, a team and positions with required skills; B cannot see or use A's catalogue", async () => {
    skillBar = (await createSkill(handle.db, nora.actor, orgA, { name: "Service au bar" })).id;
    skillSst = (
      await createSkill(handle.db, nora.actor, orgA, { name: "SST (secourisme)", requiresVerification: true })
    ).id;
    barTeam = (await createTeam(handle.db, nora.actor, orgA, { name: "Bar", color: "lime" })).id;
    const welcomeTeam = (await createTeam(handle.db, nora.actor, orgA, { name: "Accueil" })).id;
    barPosition = (
      await createPosition(handle.db, nora.actor, orgA, {
        teamId: barTeam,
        name: "Bar principal",
        skills: [{ skillId: skillBar, mandatory: false }],
      })
    ).id;
    welcomePosition = (await createPosition(handle.db, nora.actor, orgA, { teamId: welcomeTeam, name: "Accueil" })).id;
    securityPosition = (
      await createPosition(handle.db, nora.actor, orgA, {
        teamId: welcomeTeam,
        name: "Poste de secours",
        minAge: 18,
        skills: [{ skillId: skillSst, mandatory: true }],
      })
    ).id;
    const positions = await listPositions(handle.db, nora.actor, orgA);
    expect(positions.map((p) => p.name)).toEqual(["Accueil", "Poste de secours", "Bar principal"]);
    expect(positions.find((p) => p.id === securityPosition)?.skills).toEqual([
      expect.objectContaining({ skillId: skillSst, mandatory: true, requiresVerification: true }),
    ]);
    await expect(listSkills(handle.db, bob.actor, orgA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPosition(handle.db, bob.actor, orgB, { teamId: barTeam, name: "Vol" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createPosition(handle.db, nora.actor, orgA, {
        teamId: barTeam,
        name: "Avec compétence étrangère",
        skills: [{ skillId: "00000000-0000-4000-8000-000000000000", mandatory: true }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("activates positions on the event, creates shifts within the window, refuses bad shifts, opens recruitment", async () => {
    await expect(
      updateVolunteering(handle.db, nora.actor, orgA, eventId, { recruitmentStatus: "open" }),
    ).rejects.toMatchObject({ details: { code: "no_positions" } });
    const bar = await activateEventPosition(handle.db, nora.actor, orgA, eventId, { positionId: barPosition });
    await activateEventPosition(handle.db, nora.actor, orgA, eventId, { positionId: welcomePosition });
    const secours = await activateEventPosition(handle.db, nora.actor, orgA, eventId, { positionId: securityPosition });
    shiftEarly = (
      await createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
        label: "Ouverture",
        startsAt: t("2027-06-12", "17:00"),
        endsAt: t("2027-06-12", "23:00"),
        requiredCount: 2,
        maxCount: 3,
      })
    ).id;
    shiftLate = (
      await createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
        label: "Nuit",
        startsAt: t("2027-06-12", "23:00"),
        endsAt: t("2027-06-13", "03:00"),
        requiredCount: 2,
      })
    ).id;
    await createShift(handle.db, nora.actor, orgA, eventId, secours.id, {
      startsAt: t("2027-06-12", "18:00"),
      endsAt: t("2027-06-13", "02:00"),
      requiredCount: 1,
    });
    await expect(
      createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
        startsAt: t("2027-06-10", "10:00"),
        endsAt: t("2027-06-10", "12:00"),
        requiredCount: 1,
      }),
    ).rejects.toMatchObject({ details: { code: "shift_outside_event" } });
    await expect(
      createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
        startsAt: t("2027-06-12", "20:00"),
        endsAt: t("2027-06-12", "19:00"),
        requiredCount: 1,
      }),
    ).rejects.toThrow();
    await expect(
      createShift(handle.db, nora.actor, orgA, eventId, bar.id, {
        startsAt: t("2027-06-12", "20:00"),
        endsAt: t("2027-06-12", "22:00"),
        requiredCount: 3,
        maxCount: 2,
      }),
    ).rejects.toThrow();
    // A scoped volunteers.schedule is required: Bob (other org) cannot touch A's event.
    await expect(
      createShift(handle.db, bob.actor, orgA, eventId, bar.id, {
        startsAt: t("2027-06-12", "20:00"),
        endsAt: t("2027-06-12", "22:00"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const view = await updateVolunteering(handle.db, nora.actor, orgA, eventId, {
      recruitmentStatus: "open",
      targetCount: 36,
      questions: [
        { label: "Avez-vous déjà été bénévole en festival ?", type: "checkbox" },
        { label: "Taille de t-shirt", type: "single_choice", options: ["S", "M", "L", "XL"], required: true },
      ],
    });
    expect(view.recruitmentStatus).toBe("open");
    expect(view.requiredTotal).toBe(5);
    expect(view.questions.map((q) => q.key)).toEqual(["avez_vous_deja_ete_benevole_en_festival", "taille_de_t_shirt"]);
    const pub = await getPublicVolunteering(handle.db, orgA, eventId);
    expect(pub.open).toBe(true);
    expect(pub.positions).toHaveLength(3);
    expect(pub.positions.find((p) => p.id === barPosition)?.shifts).toHaveLength(2);
    expect(JSON.stringify(pub)).not.toMatch(/requiredCount|internal/);
  });
});

let maya: { id: string; accessToken: string };
let sam: { id: string; accessToken: string };
const mayaEmail = "maya.bernard@example.test";
const samEmail = "sam.moreau@example.test";

describe("C. applications", () => {
  it("Maya applies without an account: ranked wishes, availabilities, skills, buddy and answers are stored; a tracking link is e-mailed", async () => {
    const view = await applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
      email: "Maya.Bernard@example.test",
      firstName: "Maya",
      lastName: "Bernard",
      phone: "06 12 34 56 78",
      motivation: "J'adore l'ambiance des Nuits et je veux aider à les faire tenir.",
      positionPreferences: [barPosition, welcomePosition],
      availabilities: [
        { kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "03:00") },
        { kind: "unavailable", startsAt: t("2027-06-12", "21:00"), endsAt: t("2027-06-12", "22:00"), note: "Pause" },
      ],
      skills: [{ skillId: skillBar, level: "intermediate" }, { skillId: skillSst }],
      buddies: [samEmail],
      answers: { avez_vous_deja_ete_benevole_en_festival: true, taille_de_t_shirt: "M" },
    });
    maya = { id: view.id, accessToken: view.accessToken };
    expect(view.number).toBe("B-0001");
    expect(view.status).toBe("submitted");
    expect(view.email).toBe(mayaEmail);
    expect(view.preferences.map((p) => [p.rank, p.positionName])).toEqual([
      [1, "Bar principal"],
      [2, "Accueil"],
    ]);
    expect(view.effectiveHours).toBe(10);
    expect(view.skills.find((s) => s.skillId === skillSst)).toMatchObject({
      verified: false,
      requiresVerification: true,
    });
    expect(view.buddies).toEqual([{ email: samEmail, reciprocal: false }]);
    expect(view.answers).toEqual([
      {
        key: "avez_vous_deja_ete_benevole_en_festival",
        label: "Avez-vous déjà été bénévole en festival ?",
        value: true,
      },
      { key: "taille_de_t_shirt", label: "Taille de t-shirt", value: "M" },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/internalNotes|accessTokenHash|reviewedBy/);
    expect(email.lastTo(mayaEmail)?.text).toContain(`/candidature/${view.id}?k=${view.accessToken}`);
    // Sam, who has not applied, receives the buddy invitation; nothing about Sam is told to Maya.
    expect(email.lastTo(samEmail)?.subject).toContain("Maya Bernard vous propose un binôme");
  });

  it("refuses incomplete or invalid applications, duplicates and closed recruitment", async () => {
    const base = {
      email: "lou@example.test",
      firstName: "Lou",
      lastName: "Martin",
      positionPreferences: [barPosition],
      availabilities: [
        { kind: "available" as const, startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "03:00") },
      ],
      answers: { taille_de_t_shirt: "M" },
    };
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, { ...base, positionPreferences: [] }),
    ).rejects.toMatchObject({ details: { fieldErrors: { positionPreferences: expect.any(Array) } } });
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
        ...base,
        availabilities: [{ kind: "available", startsAt: t("2027-06-01", "10:00"), endsAt: t("2027-06-01", "12:00") }],
      }),
    ).rejects.toMatchObject({ details: { fieldErrors: { availabilities: expect.any(Array) } } });
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, { ...base, answers: {} }),
    ).rejects.toMatchObject({ details: { fieldErrors: { "answers.taille_de_t_shirt": expect.any(Array) } } });
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
        ...base,
        answers: { taille_de_t_shirt: "XXL" },
      }),
    ).rejects.toMatchObject({ details: { fieldErrors: { "answers.taille_de_t_shirt": expect.any(Array) } } });
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
        ...base,
        positionPreferences: ["00000000-0000-4000-8000-000000000000"],
      }),
    ).rejects.toMatchObject({ details: { fieldErrors: { positionPreferences: expect.any(Array) } } });
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
        ...base,
        buddies: ["lou@example.test"],
      }),
    ).rejects.toMatchObject({ details: { fieldErrors: { buddies: expect.any(Array) } } });
    // Duplicate live application for Maya (case-insensitive).
    await expect(
      applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
        ...base,
        email: "MAYA.bernard@example.test",
      }),
    ).rejects.toMatchObject({ details: { code: "application_exists" } });
    // Closed recruitment → 412; unknown org → 404.
    await updateVolunteering(handle.db, nora.actor, orgA, eventId, { recruitmentStatus: "closed" });
    await expect(applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, base)).rejects.toMatchObject(
      { details: { code: "recruitment_closed" } },
    );
    await updateVolunteering(handle.db, nora.actor, orgA, eventId, { recruitmentStatus: "open" });
    await expect(applyAsVolunteer(handle.db, ctx, anon, "autre-asso", eventSlug, base)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("the candidate reads and edits with the token only; the buddy becomes reciprocal when Sam applies and names Maya", async () => {
    await expect(getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: "forged" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getApplicationForCandidate(handle.db, ctx, maya.id, {})).rejects.toBeInstanceOf(NotFoundError);
    const mine = await getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: maya.accessToken });
    expect(mine.editable).toBe(true);
    const samView = await applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
      email: samEmail,
      firstName: "Sam",
      lastName: "Moreau",
      positionPreferences: [welcomePosition, barPosition],
      availabilities: [{ kind: "available", startsAt: t("2027-06-12", "17:00"), endsAt: t("2027-06-12", "23:30") }],
      buddies: [mayaEmail],
      answers: { taille_de_t_shirt: "L" },
    });
    sam = { id: samView.id, accessToken: samView.accessToken };
    expect(samView.buddies).toEqual([{ email: mayaEmail, reciprocal: true }]);
    const mayaAgain = await getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: maya.accessToken });
    expect(mayaAgain.buddies).toEqual([{ email: samEmail, reciprocal: true }]);
    // Maya widens her availability and drops the buddy: reciprocity disappears on Sam's side too.
    const updated = await updateApplicationByCandidate(
      handle.db,
      ctx,
      maya.id,
      { accessToken: maya.accessToken },
      {
        availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-13", "02:00") }],
        buddies: [],
        constraints: "Je dois partir avant 3 h.",
      },
    );
    expect(updated.effectiveHours).toBe(10);
    expect(updated.buddies).toEqual([]);
    expect(updated.constraints).toBe("Je dois partir avant 3 h.");
    expect(
      (await getApplicationForCandidate(handle.db, ctx, sam.id, { accessToken: sam.accessToken })).buddies,
    ).toEqual([{ email: mayaEmail, reciprocal: false }]);
    // Restore the wish for the rest of the scenario.
    await updateApplicationByCandidate(
      handle.db,
      ctx,
      maya.id,
      { accessToken: maya.accessToken },
      { buddies: [samEmail] },
    );
  });

  it("staff review: skill match per wish, shift coverage, verification of SST, internal notes never leak to the candidate", async () => {
    await expect(getApplication(handle.db, bob.actor, orgA, maya.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getApplication(handle.db, bob.actor, orgB, maya.id)).rejects.toBeInstanceOf(NotFoundError);
    let staff = await getApplication(handle.db, nora.actor, orgA, maya.id);
    expect(staff.buddies[0]).toMatchObject({ email: samEmail, reciprocal: true, targetName: "Sam Moreau" });
    expect(staff.shiftCoverage.map((s) => [s.label, s.coverage])).toEqual([
      ["Ouverture", "full"],
      [null, "full"],
      ["Nuit", "partial"],
    ]);
    // Security position needs a verified SST: Maya declared it, not verified yet.
    staff = await updateApplicationByStaff(handle.db, nora.actor, orgA, maya.id, {
      positionPreferences: [securityPosition, barPosition],
      internalNotes: "Connue de l'équipe bar 2026, très fiable.",
    });
    expect(staff.preferences[0]).toMatchObject({ positionName: "Poste de secours", eligible: false });
    staff = await verifySkill(handle.db, nora.actor, orgA, maya.id, skillSst, true);
    expect(staff.preferences[0]).toMatchObject({ eligible: true });
    expect(staff.skills.find((s) => s.skillId === skillSst)).toMatchObject({ verified: true });
    expect(staff.internalNotes).toBe("Connue de l'équipe bar 2026, très fiable.");
    const candidate = await getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: maya.accessToken });
    expect(JSON.stringify(candidate)).not.toContain("très fiable");
    expect(candidate.skills.find((s) => s.skillId === skillSst)?.verified).toBe(true);
  });

  it("decisions: review → approve (e-mail), waitlist, reject requires a reason; rejected is terminal", async () => {
    const reviewed = await decideApplication(handle.db, ctx, nora.actor, orgA, maya.id, "review");
    expect(reviewed.status).toBe("under_review");
    const approved = await decideApplication(handle.db, ctx, nora.actor, orgA, maya.id, "approve");
    expect(approved.status).toBe("approved");
    expect(email.lastTo(mayaEmail)?.subject).toContain("Candidature acceptée");
    await expect(decideApplication(handle.db, ctx, nora.actor, orgA, sam.id, "reject")).rejects.toMatchObject({
      details: { fieldErrors: { reason: expect.any(Array) } },
    });
    const waitlisted = await decideApplication(handle.db, ctx, nora.actor, orgA, sam.id, "waitlist");
    expect(waitlisted.status).toBe("waitlisted");
    expect(email.lastTo(samEmail)?.subject).toContain("Liste d'attente");
    // Waitlisted can still edit; approved from waitlist works.
    await updateApplicationByCandidate(
      handle.db,
      ctx,
      sam.id,
      { accessToken: sam.accessToken },
      { phone: "07 00 00 00 00" },
    );
    expect((await decideApplication(handle.db, ctx, nora.actor, orgA, sam.id, "approve")).status).toBe("approved");
    // A third candidate is rejected with a reason; the reason reaches them, and nothing more can happen.
    const lou = await applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
      email: "lou@example.test",
      firstName: "Lou",
      lastName: "Martin",
      positionPreferences: [securityPosition],
      availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-12", "20:00") }],
      answers: { taille_de_t_shirt: "S" },
    });
    const rejected = await decideApplication(
      handle.db,
      ctx,
      nora.actor,
      orgA,
      lou.id,
      "reject",
      "Le poste de secours exige un SST vérifié.",
    );
    expect(rejected.status).toBe("rejected");
    expect(email.lastTo("lou@example.test")?.text).toContain("Le poste de secours exige un SST vérifié.");
    const louView = await getApplicationForCandidate(handle.db, ctx, lou.id, { accessToken: lou.accessToken });
    expect(louView.decisionReason).toBe("Le poste de secours exige un SST vérifié.");
    expect(louView.editable).toBe(false);
    await expect(decideApplication(handle.db, ctx, nora.actor, orgA, lou.id, "approve")).rejects.toThrow();
    // Lou may apply again (rejected is not live).
    const louAgain = await applyAsVolunteer(handle.db, ctx, anon, DEMO.organization.slug, eventSlug, {
      email: "lou@example.test",
      firstName: "Lou",
      lastName: "Martin",
      positionPreferences: [welcomePosition],
      availabilities: [{ kind: "available", startsAt: t("2027-06-12", "16:00"), endsAt: t("2027-06-12", "20:00") }],
      answers: { taille_de_t_shirt: "S" },
    });
    expect(louAgain.number).toBe("B-0004");
  });

  it("lists with filters and stats; a volunteer manager scoped to another event sees nothing here", async () => {
    const all = await listApplications(handle.db, nora.actor, orgA, { eventId });
    expect(all.map((a) => a.number).sort()).toEqual(["B-0001", "B-0002", "B-0003", "B-0004"]);
    const approved = await listApplications(handle.db, nora.actor, orgA, { status: "approved" });
    expect(approved.map((a) => a.firstName).sort()).toEqual(["Maya", "Sam"]);
    const withSst = await listApplications(handle.db, nora.actor, orgA, { skillId: skillSst });
    expect(withSst.map((a) => a.firstName)).toEqual(["Maya"]);
    const byPosition = await listApplications(handle.db, nora.actor, orgA, {
      positionId: welcomePosition,
      status: "all",
    });
    expect(byPosition.map((a) => a.firstName).sort()).toEqual(["Lou", "Sam"]);
    expect((await listApplications(handle.db, nora.actor, orgA, { q: "moreau" }))[0]?.firstName).toBe("Sam");
    const stats = await applicationStats(handle.db, nora.actor, orgA, eventId);
    expect(stats).toMatchObject({ approved: 2, target: 36, toReview: 1, waitlisted: 0, requiredTotal: 5 });
    // Scoped manager on a second event of A.
    const other = await createEvent(handle.db, camille.actor, orgA, {
      title: "Autre soirée",
      startsAt: t("2027-09-01", "20:00"),
      endsAt: t("2027-09-01", "23:00"),
    });
    const scoped = await createTestUser(handle.db, { name: "Dave D", email: "dave@collectif-des-nuits.test" });
    await createInvitation(handle.db, camille.actor, ctx, orgA, {
      email: scoped.email,
      role: "volunteer_manager",
      eventId: other.id,
    });
    const token = email.lastTo(scoped.email)?.text.match(/\/invitation\/([A-Za-z0-9_-]+)/)?.[1];
    await acceptInvitation(handle.db, scoped.actor, token!);
    expect(await listApplications(handle.db, scoped.actor, orgA)).toEqual([]);
    await expect(listApplications(handle.db, scoped.actor, orgA, { eventId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getApplication(handle.db, scoped.actor, orgA, maya.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getVolunteering(handle.db, scoped.actor, orgA, eventId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getVolunteering(handle.db, scoped.actor, orgA, other.id)).positions).toEqual([]);
  });

  it("availability matrix counts fully available approved volunteers per shift; cancelled shifts disappear", async () => {
    const matrix = await availabilityMatrix(handle.db, nora.actor, orgA, eventId);
    expect(matrix.shifts).toHaveLength(3);
    expect(matrix.volunteers.map((v) => v.name).sort()).toEqual(["Maya Bernard", "Sam Moreau"]);
    expect(matrix.availablePerShift[shiftEarly]).toBe(2);
    expect(matrix.availablePerShift[shiftLate]).toBe(0);
    await cancelShift(handle.db, nora.actor, orgA, eventId, shiftLate);
    expect((await availabilityMatrix(handle.db, nora.actor, orgA, eventId)).shifts.map((s) => s.id)).not.toContain(
      shiftLate,
    );
  });

  it("bulk decisions validate each record on its own; withdrawal is final and breaks reciprocity", async () => {
    const lou = (
      await listApplications(handle.db, nora.actor, orgA, { q: "lou@example.test", status: "submitted" })
    )[0];
    const results = await bulkDecide(handle.db, ctx, nora.actor, orgA, {
      ids: [lou!.id, maya.id, "00000000-0000-4000-8000-000000000000"],
      action: "waitlist",
    });
    expect(results).toEqual([
      { id: lou!.id, ok: true, status: "waitlisted" },
      { id: maya.id, ok: true, status: "waitlisted" },
      { id: "00000000-0000-4000-8000-000000000000", ok: false, error: expect.any(String) },
    ]);
    await decideApplication(handle.db, ctx, nora.actor, orgA, maya.id, "approve");
    const withdrawn = await withdrawApplication(
      handle.db,
      ctx,
      sam.id,
      { accessToken: sam.accessToken },
      "Empêchement",
    );
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.editable).toBe(false);
    expect(email.lastTo(samEmail)?.subject).toContain("Candidature retirée");
    expect(
      (await getApplicationForCandidate(handle.db, ctx, maya.id, { accessToken: maya.accessToken })).buddies,
    ).toEqual([{ email: samEmail, reciprocal: false }]);
    expect(withdrawn.buddies).toEqual([{ email: mayaEmail, reciprocal: false }]);
    await expect(
      withdrawApplication(handle.db, ctx, sam.id, { accessToken: sam.accessToken }, undefined),
    ).rejects.toThrow();
    await expect(decideApplication(handle.db, ctx, nora.actor, orgA, sam.id, "approve")).rejects.toThrow();
    expect((await applicationStats(handle.db, nora.actor, orgA, eventId)).approved).toBe(1);
  });

  it("a signed-in user sees their own applications by account or verified e-mail", async () => {
    const mayaUser = await createTestUser(handle.db, { name: "Maya Bernard", email: mayaEmail });
    const mine = await listMyApplications(handle.db, ctx, mayaUser.actor, mayaEmail);
    expect(mine.map((a) => a.number)).toEqual(["B-0001"]);
    expect(
      (await getApplicationForCandidate(handle.db, ctx, maya.id, { actor: mayaUser.actor, email: mayaEmail })).status,
    ).toBe("approved");
    await expect(listMyApplications(handle.db, ctx, anon, mayaEmail)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
