"use server";

import {
  archiveEvent,
  cancelEvent,
  createEvent,
  createLocation,
  deleteDraftEvent,
  publishEvent,
  updateEvent,
} from "@kroov/domain/events";
import { parseLocalDateTime } from "@kroov/domain/kernel";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";

type Visibility = "public" | "unlisted" | "private";

/** Build the domain payload from the organizer's form (wall-clock dates in the event timezone). */
function eventPayloadFromForm(values: Record<string, string>) {
  const timezone = values.timezone || "Europe/Paris";
  const fieldErrors: Record<string, string[]> = {};
  const startsAt = parseLocalDateTime(values.startsDate ?? "", values.startsTime ?? "", timezone);
  const endsAt = parseLocalDateTime(values.endsDate ?? "", values.endsTime ?? "", timezone);
  if (!startsAt) fieldErrors.startsDate = ["Indiquez une date et une heure de début valides."];
  if (!endsAt) fieldErrors.endsDate = ["Indiquez une date et une heure de fin valides."];
  let doorsAt: Date | undefined;
  if (values.doorsTime) {
    const d = parseLocalDateTime(values.startsDate ?? "", values.doorsTime, timezone);
    if (!d) fieldErrors.doorsTime = ["Heure d'ouverture des portes invalide."];
    else doorsAt = d;
  }
  if (Object.keys(fieldErrors).length > 0 || !startsAt || !endsAt) {
    return { ok: false as const, fieldErrors };
  }
  return {
    ok: true as const,
    payload: {
      title: values.title ?? "",
      ...(values.slug ? { slug: values.slug } : {}),
      tagline: values.tagline ?? "",
      description: values.description ?? "",
      startsAt,
      endsAt,
      ...(doorsAt ? { doorsAt } : {}),
      timezone,
      capacity: values.capacity ?? "0",
      visibility: (values.visibility as Visibility | undefined) ?? "public",
      ...(values.locationId && values.locationId !== "none" ? { locationId: values.locationId } : {}),
      settings: {
        accessInfo: values.accessInfo ?? "",
        programme: values.programme ?? "",
        contactEmail: values.contactEmail ?? "",
        externalUrl: values.externalUrl ?? "",
        showRemainingCapacity: values.showRemainingCapacity === "on",
      },
    },
  };
}

export async function createEventAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const built = eventPayloadFromForm(values);
  if (!built.ok) return { status: "error", fieldErrors: built.fieldErrors, values };
  let eventSlug: string;
  try {
    const actor = await currentActor();
    const event = await createEvent(db(), actor, organizationId, built.payload);
    eventSlug = event.slug;
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}`, "layout");
  redirect(`/o/${slug}/evenements/${eventSlug}`);
}

export async function updateEventAction(
  organizationId: string,
  slug: string,
  eventId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const built = eventPayloadFromForm(values);
  if (!built.ok) return { status: "error", fieldErrors: built.fieldErrors, values };
  let eventSlug: string;
  try {
    const actor = await currentActor();
    const { slug: _ignored, ...rest } = built.payload;
    const event = await updateEvent(db(), actor, organizationId, eventId, {
      version: values.version ?? "0",
      ...rest,
      doorsAt: built.payload.doorsAt ?? null,
      locationId: values.locationId && values.locationId !== "none" ? values.locationId : null,
    });
    eventSlug = event.slug;
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}`, "layout");
  redirect(`/o/${slug}/evenements/${eventSlug}?enregistre=1`);
}

export async function publishEventAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  version: number,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await publishEvent(db(), actor, organizationId, eventId, version);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}`, "layout");
  redirect(`/o/${slug}/evenements/${eventSlug}?publie=1`);
}

export async function cancelEventAction(
  organizationId: string,
  slug: string,
  eventId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await cancelEvent(db(), actor, organizationId, eventId, {
      version: values.version ?? "0",
      reason: values.reason ?? "",
    });
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}`, "layout");
  return {
    status: "success",
    message: "Événement annulé. Les participants seront prévenus dès que la billetterie existera.",
  };
}

export async function archiveEventAction(
  organizationId: string,
  slug: string,
  eventId: string,
  version: number,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await archiveEvent(db(), actor, organizationId, eventId, version);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}`, "layout");
  redirect(`/o/${slug}/evenements?statut=archived`);
}

export async function deleteDraftEventAction(
  organizationId: string,
  slug: string,
  eventId: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await deleteDraftEvent(db(), actor, organizationId, eventId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}`, "layout");
  redirect(`/o/${slug}/evenements?supprime=1`);
}

export async function createLocationAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await createLocation(db(), actor, organizationId, {
      name: values.name ?? "",
      addressLine1: values.addressLine1 ?? "",
      addressLine2: values.addressLine2 ?? "",
      postalCode: values.postalCode ?? "",
      city: values.city ?? "",
      country: values.country ?? "FR",
      accessNotes: values.accessNotes ?? "",
    });
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}`, "layout");
  return { status: "success", message: `Lieu « ${values.name} » ajouté.` };
}
