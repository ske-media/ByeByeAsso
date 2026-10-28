/**
 * Kroov scheduling engine — `kroov-greedy-ls/1`.
 *
 * Pure, deterministic constraint-satisfaction heuristic (no I/O): hard constraints are never
 * violated; soft objectives are optimised lexicographically (coverage of required positions
 * first, then preferences, time fit, reciprocal buddies, fairness, optional skills).
 * Output is a DRAFT: the caller persists it, a human reviews and publishes.
 */
import { coverageOf, type Interval } from "../volunteers/availability";

export const ALGORITHM_VERSION = "kroov-greedy-ls/1";

export interface EngineShift {
  id: string;
  positionId: string;
  positionName: string;
  start: number;
  end: number;
  required: number;
  max: number;
  mandatorySkillIds: string[];
  optionalSkillIds: string[];
  minAge: number | null;
}

export interface EngineVolunteer {
  id: string;
  name: string;
  availability: Interval[];
  /** Skills that count as qualifications (declared, and verified when the skill requires it). */
  qualifiedSkillIds: string[];
  /** Position id → rank (1 = favourite). Positions absent were not wished. */
  preferences: Record<string, number>;
  /** Ids of volunteers with a reciprocal buddy wish. */
  buddies: string[];
  birthYear: number | null;
}

export interface EngineRules {
  /** 0 = unlimited. A shift counts on the calendar day (in `timezone`) it starts. */
  maxHoursPerDay: number;
  minRestMinutes: number;
  timezone: string;
  /** Year of the event, for the minimum-age check against birth year. */
  eventYear: number;
}

export interface EngineWeights {
  preference: number;
  timeFit: number;
  buddy: number;
  fairness: number;
  optionalSkill: number;
}

export const DEFAULT_WEIGHTS: EngineWeights = {
  preference: 10,
  timeFit: 2,
  buddy: 4,
  fairness: 3,
  optionalSkill: 1,
};

export interface EngineAssignment {
  shiftId: string;
  volunteerId: string;
}

export interface EngineInput {
  shifts: EngineShift[];
  volunteers: EngineVolunteer[];
  rules: EngineRules;
  /** Assignments that must be preserved (locked by a human). Invalid ones are reported, not kept. */
  locks: EngineAssignment[];
  /** Assignments outside the regeneration scope: kept as-is, they constrain the rest. */
  fixed: EngineAssignment[];
  /** Shift ids to (re)generate; undefined = all shifts. */
  scope?: string[] | undefined;
  weights?: Partial<EngineWeights> | undefined;
  /** Safety bounds. */
  limits?: { maxIterations?: number; maxMillis?: number } | undefined;
}

export type HardReason =
  | "not_available"
  | "overlap"
  | "rest"
  | "missing_skill"
  | "min_age"
  | "max_hours"
  | "shift_full"
  | "unknown_volunteer"
  | "unknown_shift";

export const HARD_REASON_LABELS: Record<HardReason, string> = {
  not_available: "Indisponible sur tout le créneau",
  overlap: "Déjà affecté·e sur un créneau qui se chevauche",
  rest: "Repos minimum non respecté entre deux créneaux",
  missing_skill: "Compétence obligatoire manquante ou non vérifiée",
  min_age: "Âge minimum du poste non atteint",
  max_hours: "Heures maximales par jour dépassées",
  shift_full: "Créneau complet",
  unknown_volunteer: "Bénévole inconnu·e ou non éligible",
  unknown_shift: "Créneau inconnu ou annulé",
};

export interface UnfilledShift {
  shiftId: string;
  positionName: string;
  missing: number;
  /** Why each non-assigned volunteer was excluded (first hard reason). */
  reasons: Array<{ volunteerId: string; reason: HardReason }>;
}

export interface EngineScore {
  coverage: number;
  preference: number;
  timeFit: number;
  buddy: number;
  fairness: number;
  optionalSkill: number;
  total: number;
}

export interface EngineOutput {
  algorithmVersion: string;
  assignments: Array<EngineAssignment & { source: "auto" | "locked" | "fixed" }>;
  unfilled: UnfilledShift[];
  invalidLocks: Array<EngineAssignment & { reason: HardReason }>;
  requiredTotal: number;
  coveredCount: number;
  score: EngineScore;
  solverStatus: "complete" | "partial" | "infeasible";
  iterations: number;
  durationMs: number;
}

/* ------------------------------------------------------------------------- */
/* hard constraints                                                           */
/* ------------------------------------------------------------------------- */

function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
}

function hours(s: EngineShift): number {
  return (s.end - s.start) / 3_600_000;
}

/**
 * First hard reason preventing `v` from taking `shift`, given the shifts `v` already holds.
 * `null` = allowed. The shift capacity is checked by the caller.
 */
export function hardViolation(
  v: EngineVolunteer,
  shift: EngineShift,
  held: EngineShift[],
  rules: EngineRules,
): HardReason | null {
  if (coverageOf(v.availability, { start: shift.start, end: shift.end }) !== "full") return "not_available";
  for (const skill of shift.mandatorySkillIds) if (!v.qualifiedSkillIds.includes(skill)) return "missing_skill";
  if (shift.minAge !== null && v.birthYear !== null && rules.eventYear - v.birthYear < shift.minAge) return "min_age";
  const rest = rules.minRestMinutes * 60_000;
  for (const h of held) {
    if (h.id === shift.id) return "overlap";
    if (h.start < shift.end && h.end > shift.start) return "overlap";
    if (rest > 0 && (Math.abs(h.start - shift.end) < rest || Math.abs(shift.start - h.end) < rest)) return "rest";
  }
  if (rules.maxHoursPerDay > 0) {
    const day = dayKey(shift.start, rules.timezone);
    const total = held.filter((h) => dayKey(h.start, rules.timezone) === day).reduce((a, h) => a + hours(h), 0);
    if (total + hours(shift) > rules.maxHoursPerDay + 1e-9) return "max_hours";
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* soft objectives                                                            */
/* ------------------------------------------------------------------------- */

interface State {
  byShift: Map<string, Set<string>>;
  byVolunteer: Map<string, Set<string>>;
  source: Map<string, "auto" | "locked" | "fixed">; // key shiftId|volunteerId
}

const key = (shiftId: string, volunteerId: string) => `${shiftId}|${volunteerId}`;

function heldShifts(state: State, shifts: Map<string, EngineShift>, volunteerId: string): EngineShift[] {
  const out: EngineShift[] = [];
  for (const id of state.byVolunteer.get(volunteerId) ?? []) {
    const s = shifts.get(id);
    if (s) out.push(s);
  }
  return out;
}

function volunteerHours(state: State, shifts: Map<string, EngineShift>, volunteerId: string): number {
  return heldShifts(state, shifts, volunteerId).reduce((a, s) => a + hours(s), 0);
}

function softScore(
  v: EngineVolunteer,
  shift: EngineShift,
  state: State,
  shifts: Map<string, EngineShift>,
  volunteersById: Map<string, EngineVolunteer>,
  w: EngineWeights,
  meanHours: number,
): number {
  const rank = v.preferences[shift.positionId];
  const preference = rank ? w.preference / rank : -w.preference * 0.25;
  const margin = 30 * 60_000;
  const timeFit =
    coverageOf(v.availability, { start: shift.start - margin, end: shift.end + margin }) === "full" ? w.timeFit : 0;
  let buddy = 0;
  for (const other of state.byShift.get(shift.id) ?? []) {
    if (v.buddies.includes(other) && volunteersById.get(other)?.buddies.includes(v.id)) buddy += w.buddy;
  }
  const mine = volunteerHours(state, shifts, v.id);
  const fairness = (-w.fairness * Math.max(0, mine - meanHours)) / Math.max(1, meanHours);
  const optional = shift.optionalSkillIds.filter((s) => v.qualifiedSkillIds.includes(s)).length * w.optionalSkill;
  return preference + timeFit + buddy + fairness + optional;
}

function totalScore(
  state: State,
  shifts: Map<string, EngineShift>,
  volunteersById: Map<string, EngineVolunteer>,
  w: EngineWeights,
): EngineScore {
  let preference = 0;
  let timeFit = 0;
  let buddy = 0;
  let optionalSkill = 0;
  let covered = 0;
  for (const [shiftId, vols] of state.byShift) {
    const shift = shifts.get(shiftId);
    if (!shift) continue;
    covered += Math.min(vols.size, shift.required);
    const list = [...vols];
    for (const vid of list) {
      const v = volunteersById.get(vid);
      if (!v) continue;
      const rank = v.preferences[shift.positionId];
      preference += rank ? w.preference / rank : -w.preference * 0.25;
      const margin = 30 * 60_000;
      if (coverageOf(v.availability, { start: shift.start - margin, end: shift.end + margin }) === "full")
        timeFit += w.timeFit;
      optionalSkill += shift.optionalSkillIds.filter((s) => v.qualifiedSkillIds.includes(s)).length * w.optionalSkill;
      for (const other of list) {
        if (other > vid && v.buddies.includes(other) && volunteersById.get(other)?.buddies.includes(vid))
          buddy += w.buddy;
      }
    }
  }
  const hoursList = [...volunteersById.keys()].map((id) => volunteerHours(state, shifts, id)).filter((h) => h > 0);
  const mean = hoursList.length ? hoursList.reduce((a, b) => a + b, 0) / hoursList.length : 0;
  const variance = hoursList.length ? hoursList.reduce((a, h) => a + (h - mean) ** 2, 0) / hoursList.length : 0;
  const fairness = -w.fairness * Math.sqrt(variance);
  return {
    coverage: covered,
    preference: round(preference),
    timeFit: round(timeFit),
    buddy: round(buddy),
    fairness: round(fairness),
    optionalSkill: round(optionalSkill),
    total: round(preference + timeFit + buddy + fairness + optionalSkill),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------------- */
/* solver                                                                     */
/* ------------------------------------------------------------------------- */

export function runEngine(input: EngineInput, now: () => number = () => Date.now()): EngineOutput {
  const startedAt = now();
  const w: EngineWeights = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const maxIterations = input.limits?.maxIterations ?? 20_000;
  const maxMillis = input.limits?.maxMillis ?? 5_000;
  const shifts = new Map(input.shifts.map((s) => [s.id, s]));
  const volunteersById = new Map(input.volunteers.map((v) => [v.id, v]));
  const scope = new Set(input.scope ?? input.shifts.map((s) => s.id));
  const state: State = { byShift: new Map(), byVolunteer: new Map(), source: new Map() };
  for (const s of input.shifts) state.byShift.set(s.id, new Set());
  for (const v of input.volunteers) state.byVolunteer.set(v.id, new Set());
  const invalidLocks: EngineOutput["invalidLocks"] = [];
  let iterations = 0;

  const place = (shiftId: string, volunteerId: string, source: "auto" | "locked" | "fixed") => {
    state.byShift.get(shiftId)?.add(volunteerId);
    state.byVolunteer.get(volunteerId)?.add(shiftId);
    state.source.set(key(shiftId, volunteerId), source);
  };
  const remove = (shiftId: string, volunteerId: string) => {
    state.byShift.get(shiftId)?.delete(volunteerId);
    state.byVolunteer.get(volunteerId)?.delete(shiftId);
    state.source.delete(key(shiftId, volunteerId));
  };
  const canTake = (v: EngineVolunteer, shift: EngineShift): HardReason | null => {
    if ((state.byShift.get(shift.id)?.size ?? 0) >= shift.max) return "shift_full";
    return hardViolation(v, shift, heldShifts(state, shifts, v.id), input.rules);
  };

  // 1. Fixed (out of scope) and locked assignments first — invalid ones are reported, never kept.
  const seed = (list: EngineAssignment[], source: "locked" | "fixed") => {
    const ordered = [...list].sort((a, b) => (a.shiftId + a.volunteerId).localeCompare(b.shiftId + b.volunteerId));
    for (const a of ordered) {
      const shift = shifts.get(a.shiftId);
      const v = volunteersById.get(a.volunteerId);
      if (!shift) {
        invalidLocks.push({ ...a, reason: "unknown_shift" });
        continue;
      }
      if (!v) {
        invalidLocks.push({ ...a, reason: "unknown_volunteer" });
        continue;
      }
      if (state.byShift.get(shift.id)?.has(v.id)) continue;
      const reason = canTake(v, shift);
      if (reason) invalidLocks.push({ ...a, reason });
      else place(shift.id, v.id, source);
    }
  };
  seed(input.fixed, "fixed");
  seed(input.locks, "locked");

  // 2. Greedy fill, scarcest shifts first.
  const targets = input.shifts.filter((s) => scope.has(s.id));
  const eligibleCount = new Map<string, number>();
  for (const s of targets) {
    let n = 0;
    for (const v of input.volunteers) if (hardViolation(v, s, [], input.rules) === null) n += 1;
    eligibleCount.set(s.id, n);
  }
  const ordered = [...targets].sort(
    (a, b) =>
      (eligibleCount.get(a.id) ?? 0) - (eligibleCount.get(b.id) ?? 0) || a.start - b.start || a.id.localeCompare(b.id),
  );
  const meanTarget = () => {
    const h = input.volunteers.map((v) => volunteerHours(state, shifts, v.id));
    return h.reduce((a, b) => a + b, 0) / Math.max(1, input.volunteers.length);
  };
  for (const shift of ordered) {
    while ((state.byShift.get(shift.id)?.size ?? 0) < shift.required) {
      iterations += 1;
      const mean = meanTarget();
      let best: { v: EngineVolunteer; score: number } | null = null;
      for (const v of input.volunteers) {
        if (canTake(v, shift) !== null) continue;
        const score = softScore(v, shift, state, shifts, volunteersById, w, mean);
        if (!best || score > best.score || (score === best.score && v.id < best.v.id)) best = { v, score };
      }
      if (!best) break;
      place(shift.id, best.v.id, "auto");
    }
  }

  // 3. Local search — fill remaining required slots with one-level moves (never reduces coverage).
  const missing = (s: EngineShift) => Math.max(0, s.required - (state.byShift.get(s.id)?.size ?? 0));
  let improved = true;
  while (improved && iterations < maxIterations && now() - startedAt < maxMillis) {
    improved = false;
    for (const target of ordered) {
      if (missing(target) === 0) continue;
      for (const donor of input.shifts) {
        if (donor.id === target.id || missing(target) === 0) continue;
        for (const vid of [...(state.byShift.get(donor.id) ?? [])].sort()) {
          iterations += 1;
          if (state.source.get(key(donor.id, vid)) !== "auto") continue;
          const v = volunteersById.get(vid);
          if (!v) continue;
          // Would v fit the target once freed from the donor?
          remove(donor.id, vid);
          const fits = canTake(v, target) === null;
          if (!fits) {
            place(donor.id, vid, "auto");
            continue;
          }
          // Donor must not lose coverage: find a replacement W, or the donor had surplus.
          const donorNeedsRefill = (state.byShift.get(donor.id)?.size ?? 0) < donor.required;
          let replacement: EngineVolunteer | null = null;
          if (donorNeedsRefill) {
            for (const wv of input.volunteers) {
              if (wv.id === vid) continue;
              if (canTake(wv, donor) === null) {
                replacement = wv;
                break;
              }
            }
          }
          if (donorNeedsRefill && !replacement) {
            place(donor.id, vid, "auto");
            continue;
          }
          place(target.id, vid, "auto");
          if (replacement) place(donor.id, replacement.id, "auto");
          improved = true;
          if (missing(target) === 0) break;
        }
        if (missing(target) === 0) break;
      }
    }
  }

  // 4. Score-improving swaps between auto assignments (coverage preserved by construction).
  let swaps = true;
  let guard = 0;
  while (swaps && iterations < maxIterations && now() - startedAt < maxMillis && guard < 50) {
    swaps = false;
    guard += 1;
    const before = totalScore(state, shifts, volunteersById, w).total;
    const entries = [...state.source.entries()]
      .filter(([, src]) => src === "auto")
      .map(([k]) => k.split("|") as [string, string]);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [s1, v1] = entries[i]!;
        const [s2, v2] = entries[j]!;
        if (s1 === s2 || v1 === v2) continue;
        if (!state.byShift.get(s1)?.has(v1) || !state.byShift.get(s2)?.has(v2)) continue;
        iterations += 1;
        const shiftA = shifts.get(s1);
        const shiftB = shifts.get(s2);
        const va = volunteersById.get(v1);
        const vb = volunteersById.get(v2);
        if (!shiftA || !shiftB || !va || !vb) continue;
        remove(s1, v1);
        remove(s2, v2);
        const ok = canTake(va, shiftB) === null && canTake(vb, shiftA) === null;
        if (ok) {
          place(s2, v1, "auto");
          place(s1, v2, "auto");
          const after = totalScore(state, shifts, volunteersById, w).total;
          if (after > before + 1e-9) {
            swaps = true;
            break;
          }
          remove(s2, v1);
          remove(s1, v2);
        }
        place(s1, v1, "auto");
        place(s2, v2, "auto");
      }
      if (swaps) break;
    }
  }

  // 5. Output.
  const assignments: EngineOutput["assignments"] = [];
  for (const [k, source] of state.source) {
    const [shiftId, volunteerId] = k.split("|") as [string, string];
    assignments.push({ shiftId, volunteerId, source });
  }
  assignments.sort((a, b) => a.shiftId.localeCompare(b.shiftId) || a.volunteerId.localeCompare(b.volunteerId));
  const unfilled: UnfilledShift[] = [];
  for (const shift of input.shifts) {
    const gap = missing(shift);
    if (gap === 0) continue;
    const reasons: UnfilledShift["reasons"] = [];
    for (const v of input.volunteers) {
      if (state.byShift.get(shift.id)?.has(v.id)) continue;
      const reason = hardViolation(v, shift, heldShifts(state, shifts, v.id), input.rules);
      if (reason) reasons.push({ volunteerId: v.id, reason });
    }
    unfilled.push({ shiftId: shift.id, positionName: shift.positionName, missing: gap, reasons });
  }
  const score = totalScore(state, shifts, volunteersById, w);
  const requiredTotal = input.shifts.reduce((a, s) => a + s.required, 0);
  return {
    algorithmVersion: ALGORITHM_VERSION,
    assignments,
    unfilled,
    invalidLocks,
    requiredTotal,
    coveredCount: score.coverage,
    score,
    solverStatus:
      unfilled.length === 0 ? "complete" : score.coverage === 0 && requiredTotal > 0 ? "infeasible" : "partial",
    iterations,
    durationMs: now() - startedAt,
  };
}

/**
 * Validate a full set of assignments against hard constraints (used before publication, on
 * CURRENT data). Returns one entry per violation with the reason.
 */
export function validateAssignments(
  assignments: EngineAssignment[],
  shifts: EngineShift[],
  volunteers: EngineVolunteer[],
  rules: EngineRules,
): Array<EngineAssignment & { reason: HardReason }> {
  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const volunteersById = new Map(volunteers.map((v) => [v.id, v]));
  const held = new Map<string, EngineShift[]>();
  const perShift = new Map<string, number>();
  const violations: Array<EngineAssignment & { reason: HardReason }> = [];
  const sorted = [...assignments].sort((a, b) => (a.shiftId + a.volunteerId).localeCompare(b.shiftId + b.volunteerId));
  for (const a of sorted) {
    const shift = shiftsById.get(a.shiftId);
    const v = volunteersById.get(a.volunteerId);
    if (!shift) {
      violations.push({ ...a, reason: "unknown_shift" });
      continue;
    }
    if (!v) {
      violations.push({ ...a, reason: "unknown_volunteer" });
      continue;
    }
    const count = perShift.get(shift.id) ?? 0;
    if (count >= shift.max) {
      violations.push({ ...a, reason: "shift_full" });
      continue;
    }
    const reason = hardViolation(v, shift, held.get(v.id) ?? [], rules);
    if (reason) {
      violations.push({ ...a, reason });
      continue;
    }
    perShift.set(shift.id, count + 1);
    held.set(v.id, [...(held.get(v.id) ?? []), shift]);
  }
  return violations;
}
