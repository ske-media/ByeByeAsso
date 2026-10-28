import { describe, expect, it } from "vitest";
import { crossesMidnight, formatRangeFr, offsetMinutes, parseLocalDateTime, wallClockToInstant } from "./time";

describe("time helpers (Europe/Paris)", () => {
  it("converts a summer wall-clock time to UTC (+02:00)", () => {
    const instant = wallClockToInstant({ year: 2027, month: 6, day: 12, hour: 18, minute: 0 }, "Europe/Paris");
    expect(instant.toISOString()).toBe("2027-06-12T16:00:00.000Z");
  });

  it("converts a winter wall-clock time to UTC (+01:00)", () => {
    const instant = wallClockToInstant({ year: 2027, month: 12, day: 15, hour: 9, minute: 30 }, "Europe/Paris");
    expect(instant.toISOString()).toBe("2027-12-15T08:30:00.000Z");
  });

  it("handles the DST change night (28 March 2027: 02:00 → 03:00)", () => {
    // 01:30 exists (+01:00) ; 03:30 exists (+02:00) ; the event crosses the gap.
    const start = parseLocalDateTime("2027-03-28", "01:30", "Europe/Paris")!;
    const end = parseLocalDateTime("2027-03-28", "03:30", "Europe/Paris")!;
    expect(start.toISOString()).toBe("2027-03-28T00:30:00.000Z");
    expect(end.toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000); // only one real hour elapsed
    expect(offsetMinutes(start, "Europe/Paris")).toBe(60);
    expect(offsetMinutes(end, "Europe/Paris")).toBe(120);
  });

  it("rejects impossible dates and malformed input", () => {
    expect(parseLocalDateTime("2027-02-30", "10:00", "Europe/Paris")).toBeNull();
    expect(parseLocalDateTime("2027-13-01", "10:00", "Europe/Paris")).toBeNull();
    expect(parseLocalDateTime("12/06/2027", "18:00", "Europe/Paris")).toBeNull();
    expect(parseLocalDateTime("2027-06-12", "25:00", "Europe/Paris")).toBeNull();
  });

  it("detects and formats a midnight crossing explicitly", () => {
    const start = parseLocalDateTime("2027-06-12", "18:00", "Europe/Paris")!;
    const end = parseLocalDateTime("2027-06-13", "02:00", "Europe/Paris")!;
    expect(crossesMidnight(start, end, "Europe/Paris")).toBe(true);
    expect(formatRangeFr(start, end, "Europe/Paris")).toBe("Samedi 12 juin 2027, 18:00 → dimanche 13 juin, 02:00");
    const sameDayEnd = parseLocalDateTime("2027-06-12", "23:00", "Europe/Paris")!;
    expect(formatRangeFr(start, sameDayEnd, "Europe/Paris")).toBe("Samedi 12 juin 2027, 18:00 → 23:00");
  });
});
