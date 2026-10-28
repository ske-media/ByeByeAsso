import "server-only";
import type { EventView } from "@kroov/domain/events";
import { instantToWallClock, wallClockDateString, wallClockTimeString } from "@kroov/domain/kernel";
import type { EventFormInitial } from "@/app/o/[slug]/evenements/event-form";

export function emptyEventForm(timezone: string): EventFormInitial {
  return {
    title: "",
    tagline: "",
    description: "",
    startsDate: "",
    startsTime: "18:00",
    endsDate: "",
    endsTime: "23:00",
    doorsTime: "",
    timezone,
    capacity: "0",
    visibility: "public",
    locationId: "none",
    accessInfo: "",
    programme: "",
    contactEmail: "",
    externalUrl: "",
    showRemainingCapacity: true,
  };
}

export function eventToForm(event: EventView): EventFormInitial {
  const s = instantToWallClock(event.startsAt, event.timezone);
  const e = instantToWallClock(event.endsAt, event.timezone);
  const d = event.doorsAt ? instantToWallClock(event.doorsAt, event.timezone) : null;
  return {
    title: event.title,
    slug: event.slug,
    tagline: event.tagline ?? "",
    description: event.description ?? "",
    startsDate: wallClockDateString(s),
    startsTime: wallClockTimeString(s),
    endsDate: wallClockDateString(e),
    endsTime: wallClockTimeString(e),
    doorsTime: d ? wallClockTimeString(d) : "",
    timezone: event.timezone,
    capacity: String(event.capacity),
    visibility: event.visibility,
    locationId: event.location?.id ?? "none",
    accessInfo: event.settings.accessInfo ?? "",
    programme: event.settings.programme ?? "",
    contactEmail: event.settings.contactEmail ?? "",
    externalUrl: event.settings.externalUrl ?? "",
    showRemainingCapacity: event.settings.showRemainingCapacity,
  };
}
