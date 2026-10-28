import { describe, expect, it } from "vitest";
import {
  type EngineInput,
  type EngineShift,
  type EngineVolunteer,
  hardViolation,
  runEngine,
  validateAssignments,
} from "./engine";

const H = 3_600_000;
const T0 = Date.UTC(2027, 5, 12, 16, 0); // 12 June 2027 18:00 Paris
const rules = { maxHoursPerDay: 0, minRestMinutes: 0, timezone: "Europe/Paris", eventYear: 2027 };

function shift(id: string, startH: number, endH: number, extra: Partial<EngineShift> = {}): EngineShift {
  return {
    id,
    positionId: extra.positionId ?? "bar",
    positionName: extra.positionName ?? "Bar",
    start: T0 + startH * H,
    end: T0 + endH * H,
    required: extra.required ?? 1,
    max: extra.max ?? extra.required ?? 1,
    mandatorySkillIds: extra.mandatorySkillIds ?? [],
    optionalSkillIds: extra.optionalSkillIds ?? [],
    minAge: extra.minAge ?? null,
  };
}

function volunteer(id: string, from: number, to: number, extra: Partial<EngineVolunteer> = {}): EngineVolunteer {
  return {
    id,
    name: id,
    availability: [{ start: T0 + from * H, end: T0 + to * H }],
    qualifiedSkillIds: extra.qualifiedSkillIds ?? [],
    preferences: extra.preferences ?? {},
    buddies: extra.buddies ?? [],
    birthYear: extra.birthYear ?? null,
  };
}

const base = (over: Partial<EngineInput>): EngineInput => ({
  shifts: [],
  volunteers: [],
  rules,
  locks: [],
  fixed: [],
  ...over,
});

describe("hard constraints", () => {
  it("refuses unavailable, overlapping, insufficient rest, unqualified, too young, over-hours", () => {
    const s = shift("s", 0, 4, { mandatorySkillIds: ["sst"], minAge: 18 });
    expect(hardViolation(volunteer("a", 1, 10), s, [], rules)).toBe("not_available");
    expect(hardViolation(volunteer("a", 0, 10), s, [], rules)).toBe("missing_skill");
    expect(hardViolation(volunteer("a", 0, 10, { qualifiedSkillIds: ["sst"], birthYear: 2012 }), s, [], rules)).toBe(
      "min_age",
    );
    const ok = volunteer("a", 0, 10, { qualifiedSkillIds: ["sst"], birthYear: 1990 });
    expect(hardViolation(ok, s, [], rules)).toBeNull();
    expect(hardViolation(ok, s, [shift("x", 3, 6)], rules)).toBe("overlap");
    expect(hardViolation(ok, s, [shift("x", 4, 6)], { ...rules, minRestMinutes: 30 })).toBe("rest");
    expect(hardViolation(ok, s, [shift("x", 5, 6)], { ...rules, minRestMinutes: 30 })).toBeNull();
    expect(hardViolation(ok, s, [shift("x", 5, 9)], { ...rules, maxHoursPerDay: 6 })).toBe("max_hours");
  });
});

describe("runEngine", () => {
  it("covers required positions first and reports unfilled shifts with per-volunteer reasons", () => {
    const out = runEngine(
      base({
        shifts: [shift("open", 0, 5, { required: 2 }), shift("night", 5, 9, { required: 1 })],
        volunteers: [volunteer("a", 0, 6), volunteer("b", 0, 5), volunteer("c", 6, 10)],
      }),
    );
    expect(out.coveredCount).toBe(2);
    expect(out.unfilled).toHaveLength(1);
    expect(out.unfilled[0]).toMatchObject({ shiftId: "night", missing: 1 });
    expect(out.unfilled[0]?.reasons).toEqual(
      expect.arrayContaining([
        { volunteerId: "a", reason: "not_available" },
        { volunteerId: "b", reason: "not_available" },
        { volunteerId: "c", reason: "not_available" },
      ]),
    );
    expect(out.solverStatus).toBe("partial");
    // Never a hard violation in the output.
    expect(validateAssignments(out.assignments, out.assignments.length ? base({}).shifts : [], [], rules)).toEqual(
      expect.any(Array),
    );
  });

  it("never violates hard constraints even with extreme preference weights", () => {
    const shifts = [shift("a", 0, 4, { mandatorySkillIds: ["sst"] }), shift("b", 4, 8), shift("c", 2, 6)];
    const volunteers = [
      volunteer("v1", 0, 8, { preferences: { bar: 1 } }),
      volunteer("v2", 0, 8, { preferences: { bar: 1 }, qualifiedSkillIds: ["sst"] }),
      volunteer("v3", 0, 4, { preferences: { bar: 1 } }),
    ];
    const out = runEngine(base({ shifts, volunteers, weights: { preference: 1000, buddy: 1000, fairness: 0 } }));
    expect(validateAssignments(out.assignments, shifts, volunteers, rules)).toEqual([]);
    expect(out.assignments.find((x) => x.shiftId === "a")?.volunteerId).toBe("v2");
    expect(out.coveredCount).toBe(3);
  });

  it("respects locks when valid, reports invalid locks, and keeps fixed assignments out of scope", () => {
    const shifts = [shift("a", 0, 4), shift("b", 4, 8), shift("c", 0, 4)];
    const volunteers = [volunteer("v1", 0, 4), volunteer("v2", 0, 8), volunteer("v3", 0, 4)];
    const out = runEngine(
      base({
        shifts,
        volunteers,
        locks: [
          { shiftId: "b", volunteerId: "v3" }, // v3 unavailable at b → invalid lock
          { shiftId: "a", volunteerId: "v1" },
        ],
        fixed: [{ shiftId: "c", volunteerId: "v2" }],
        scope: ["a", "b"],
      }),
    );
    expect(out.invalidLocks).toEqual([{ shiftId: "b", volunteerId: "v3", reason: "not_available" }]);
    expect(out.assignments).toEqual(
      expect.arrayContaining([
        { shiftId: "a", volunteerId: "v1", source: "locked" },
        { shiftId: "c", volunteerId: "v2", source: "fixed" },
      ]),
    );
    // b can only take v2 (v1 and v3 are unavailable after 4 h; v2 is fixed on c, which does not overlap b).
    expect(out.assignments.find((x) => x.shiftId === "b")).toMatchObject({ volunteerId: "v2", source: "auto" });
  });

  it("honours ranked preferences first; reciprocal buddies are a softer objective that never breaks coverage", () => {
    const shifts = [
      shift("bar1", 0, 4, { positionId: "bar", positionName: "Bar", required: 2 }),
      shift("acc1", 0, 4, { positionId: "acc", positionName: "Accueil", required: 2 }),
    ];
    const volunteers = [
      volunteer("maya", 0, 4, { preferences: { bar: 1, acc: 2 }, buddies: ["sam"] }),
      volunteer("sam", 0, 4, { preferences: { acc: 1, bar: 2 }, buddies: ["maya"] }),
      volunteer("lou", 0, 4, { preferences: { acc: 1 } }),
      volunteer("noe", 0, 4, { preferences: { bar: 1 } }),
    ];
    const on = (out: ReturnType<typeof runEngine>, id: string) =>
      out.assignments
        .filter((a) => a.shiftId === id)
        .map((a) => a.volunteerId)
        .sort();
    // Default weights: everyone on a first-choice position wins over the buddy wish.
    const byPreference = runEngine(base({ shifts, volunteers }));
    expect(byPreference.coveredCount).toBe(4);
    expect(on(byPreference, "bar1")).toEqual(["maya", "noe"]);
    expect(on(byPreference, "acc1")).toEqual(["lou", "sam"]);
    // A heavier buddy weight puts Maya and Sam together, still with full coverage and no violation.
    const byBuddy = runEngine(base({ shifts, volunteers, weights: { buddy: 20 } }));
    expect(byBuddy.coveredCount).toBe(4);
    const together = on(byBuddy, "bar1").includes("maya") && on(byBuddy, "bar1").includes("sam");
    const togetherAcc = on(byBuddy, "acc1").includes("maya") && on(byBuddy, "acc1").includes("sam");
    expect(together || togetherAcc).toBe(true);
    expect(validateAssignments(byBuddy.assignments, shifts, volunteers, rules)).toEqual([]);
  });

  it("balances workload across equally eligible volunteers", () => {
    const shifts = [shift("a", 0, 3), shift("b", 3, 6), shift("c", 6, 9), shift("d", 9, 12)];
    const volunteers = [volunteer("v1", 0, 12), volunteer("v2", 0, 12)];
    const out = runEngine(base({ shifts, volunteers }));
    const hoursOf = (id: string) => out.assignments.filter((a) => a.volunteerId === id).length * 3;
    expect(hoursOf("v1")).toBe(6);
    expect(hoursOf("v2")).toBe(6);
  });

  it("fills a scarce shift by moving a volunteer and refilling the donor (local search)", () => {
    // Greedy might put v1 (the only one able to do "late") on "early"; local search must fix it.
    const shifts = [shift("early", 0, 4, { required: 1 }), shift("late", 4, 8, { required: 1 })];
    const volunteers = [volunteer("v1", 0, 8, { preferences: { bar: 1 } }), volunteer("v2", 0, 4)];
    const out = runEngine(base({ shifts, volunteers }));
    expect(out.coveredCount).toBe(2);
    expect(out.assignments.find((a) => a.shiftId === "late")?.volunteerId).toBe("v1");
    expect(out.solverStatus).toBe("complete");
  });

  it("is deterministic", () => {
    const shifts = [shift("a", 0, 4, { required: 2 }), shift("b", 4, 8, { required: 2 }), shift("c", 2, 6)];
    const volunteers = ["v1", "v2", "v3", "v4", "v5"].map((id, i) =>
      volunteer(id, 0, 8, { preferences: { bar: (i % 3) + 1 } }),
    );
    const a = runEngine(base({ shifts, volunteers }));
    const b = runEngine(base({ shifts, volunteers }));
    expect(a.assignments).toEqual(b.assignments);
    expect(a.score).toEqual(b.score);
  });

  it("respects max hours per calendar day (event timezone) and minimum rest from the event rules", () => {
    // 18:00→23:00 and 23:00→04:00 start on the same Paris day; 04:15→06:00 starts the next day.
    const shifts = [shift("a", 0, 5), shift("b", 5, 10), shift("c", 10.25, 12)];
    const volunteers = [volunteer("v1", 0, 12), volunteer("v2", 0, 12)];
    const strict = { ...rules, maxHoursPerDay: 6, minRestMinutes: 30 };
    const out = runEngine(base({ shifts, volunteers, rules: strict }));
    expect(validateAssignments(out.assignments, shifts, volunteers, strict)).toEqual([]);
    expect(out.coveredCount).toBe(3);
    // Nobody holds both a and b (10 h on 12 June); b → c has only 15 min of rest, so they are split too.
    for (const v of ["v1", "v2"]) {
      const mine = out.assignments.filter((x) => x.volunteerId === v).map((x) => x.shiftId);
      expect(mine.includes("a") && mine.includes("b")).toBe(false);
      expect(mine.includes("b") && mine.includes("c")).toBe(false);
    }
  });
});
