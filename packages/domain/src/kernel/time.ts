/**
 * Time helpers without external dependencies. Instants are stored in UTC (timestamptz);
 * organizers enter wall-clock times in the event's IANA timezone.
 */

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function partsIn(instant: Date, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return { year: map.year!, month: map.month!, day: map.day!, hour: map.hour!, minute: map.minute! };
}

/** Offset (minutes) of `timeZone` from UTC at `instant`. */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant. Handles DST: two iterations
 * converge for every regular case; during a spring-forward gap the instant after the gap
 * is returned; during a fall-back overlap the first (DST) occurrence is returned.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** Parse "YYYY-MM-DD" + "HH:MM" entered in `timeZone`. Returns null when malformed. */
export function parseLocalDateTime(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall: WallClock = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 23 || wall.minute > 59)
    return null;
  const instant = wallClockToInstant(wall, timeZone);
  // Reject impossible dates such as 2027-02-30 (which Date.UTC would roll over).
  const back = partsIn(instant, timeZone);
  if (back.month !== wall.month || back.day !== wall.day) return null;
  return instant;
}

/** Wall-clock parts of an instant in a timezone — for pre-filling forms. */
export function instantToWallClock(instant: Date, timeZone: string): WallClock {
  return partsIn(instant, timeZone);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function wallClockDateString(w: WallClock): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function wallClockTimeString(w: WallClock): string {
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Whether two instants fall on different calendar days in `timeZone` (midnight crossing). */
export function crossesMidnight(start: Date, end: Date, timeZone: string): boolean {
  const a = partsIn(start, timeZone);
  const b = partsIn(end, timeZone);
  return a.year !== b.year || a.month !== b.month || a.day !== b.day;
}

/** French long date, e.g. "samedi 12 juin 2027". */
export function formatDateFr(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(instant);
}

/** "18:00" in `timeZone`. */
export function formatTimeFr(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    instant,
  );
}

/**
 * Unambiguous range: "Samedi 12 juin 2027, 18:00 → dimanche 13 juin, 02:00" when the end is on
 * another day, otherwise "Samedi 12 juin 2027, 18:00 → 23:00".
 */
export function formatRangeFr(start: Date, end: Date, timeZone: string): string {
  const startDate = formatDateFr(start, timeZone);
  const startLabel = `${startDate.charAt(0).toUpperCase()}${startDate.slice(1)}, ${formatTimeFr(start, timeZone)}`;
  if (crossesMidnight(start, end, timeZone)) {
    const endDate = new Intl.DateTimeFormat("fr-FR", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(end);
    return `${startLabel} → ${endDate}, ${formatTimeFr(end, timeZone)}`;
  }
  return `${startLabel} → ${formatTimeFr(end, timeZone)}`;
}
