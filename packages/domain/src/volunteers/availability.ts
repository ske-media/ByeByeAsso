/**
 * Pure interval arithmetic for availabilities (used by the review screens now and by the
 * scheduler in phase 6). Intervals are half-open [start, end) in epoch milliseconds.
 */
export interface Interval {
  start: number;
  end: number;
}

/** Hours of slack accepted around the event window (set-up / tear-down). */
export const AVAILABILITY_WINDOW_SLACK_HOURS = 24;

export function eventAvailabilityWindow(event: { startsAt: Date; endsAt: Date }): Interval {
  const slack = AVAILABILITY_WINDOW_SLACK_HOURS * 3_600_000;
  return { start: event.startsAt.getTime() - slack, end: event.endsAt.getTime() + slack };
}

/** Sort + merge overlapping or touching intervals. */
export function mergeIntervals(input: Interval[]): Interval[] {
  const sorted = input
    .filter((i) => i.end > i.start)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

/** available − unavailable, both merged first. */
export function subtractIntervals(available: Interval[], unavailable: Interval[]): Interval[] {
  const base = mergeIntervals(available);
  const holes = mergeIntervals(unavailable);
  const out: Interval[] = [];
  for (const a of base) {
    let cursor = a.start;
    for (const h of holes) {
      if (h.end <= cursor || h.start >= a.end) continue;
      if (h.start > cursor) out.push({ start: cursor, end: Math.min(h.start, a.end) });
      cursor = Math.max(cursor, h.end);
      if (cursor >= a.end) break;
    }
    if (cursor < a.end) out.push({ start: cursor, end: a.end });
  }
  return out;
}

/** Effective availability of a candidate from declared ranges. */
export function effectiveAvailability(
  ranges: Array<{ kind: "available" | "unavailable"; startsAt: Date; endsAt: Date }>,
): Interval[] {
  const toI = (r: { startsAt: Date; endsAt: Date }) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() });
  return subtractIntervals(
    ranges.filter((r) => r.kind === "available").map(toI),
    ranges.filter((r) => r.kind === "unavailable").map(toI),
  );
}

export type Coverage = "full" | "partial" | "none";

/** Whether a shift lies entirely within the effective availability (hard constraint in phase 6). */
export function coverageOf(availability: Interval[], shift: Interval): Coverage {
  for (const a of availability) {
    if (a.start <= shift.start && a.end >= shift.end) return "full";
  }
  for (const a of availability) {
    if (a.start < shift.end && a.end > shift.start) return "partial";
  }
  return "none";
}

/** Validation errors for declared ranges against an event window. Empty = valid. */
export function validateRanges(
  ranges: Array<{ kind: "available" | "unavailable"; startsAt: Date; endsAt: Date }>,
  window: Interval,
): string[] {
  const errors: string[] = [];
  for (const r of ranges) {
    const s = r.startsAt.getTime();
    const e = r.endsAt.getTime();
    if (e <= s) errors.push("Une plage se termine avant de commencer.");
    if (s < window.start || e > window.end)
      errors.push("Une plage sort de la fenêtre de l'événement (la veille au lendemain).");
  }
  const available = ranges.filter((r) => r.kind === "available");
  const sorted = available
    .map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.start < prev.end) {
      errors.push("Deux plages disponibles se chevauchent : fusionnez-les.");
      break;
    }
  }
  return [...new Set(errors)];
}

export function totalHours(intervals: Interval[]): number {
  return Math.round((intervals.reduce((a, i) => a + (i.end - i.start), 0) / 3_600_000) * 10) / 10;
}
