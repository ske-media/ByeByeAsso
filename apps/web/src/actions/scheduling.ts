"use server";

import {
  assignVolunteer,
  createVersion,
  generateVersion,
  markUnderReview,
  publishVersion,
  recordAttendance,
  resolveRequest,
  setAssignmentLock,
  unassignVolunteer,
} from "@kroov/domain/scheduling";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

const planningPath = (slug: string, eventSlug: string) => `/o/${slug}/evenements/${eventSlug}/planning`;

export async function createVersionAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  basedOnVersionId: string | null,
  generate: boolean,
): Promise<ActionState> {
  let versionId: string;
  try {
    const actor = await currentActor();
    const created = await createVersion(
      db(),
      actor,
      organizationId,
      eventId,
      basedOnVersionId ? { basedOnVersionId } : {},
    );
    versionId = created.id;
    if (generate) await generateVersion(db(), actor, organizationId, versionId);
    revalidatePath(planningPath(slug, eventSlug));
  } catch (error) {
    return actionError(error);
  }
  redirect(`${planningPath(slug, eventSlug)}?version=${versionId}`);
}

export async function generateAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
  shiftIds: string[] | null,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const { run } = await generateVersion(db(), actor, organizationId, versionId, shiftIds ? { shiftIds } : {});
    revalidatePath(planningPath(slug, eventSlug));
    const missing = run.unfilledCount ?? 0;
    return {
      status: "success",
      message:
        missing === 0
          ? `Proposition générée : ${run.coveredCount ?? 0} affectation(s) couvertes, tous les besoins sont pourvus.`
          : `Proposition générée : ${run.coveredCount ?? 0} couvertes, ${missing} non pourvue(s) — voir les explications.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function assignAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await assignVolunteer(db(), actor, organizationId, versionId, {
      shiftId: values.shiftId ?? "",
      applicationId: values.applicationId ?? "",
      lock: values.lock === "on",
    });
    revalidatePath(planningPath(slug, eventSlug));
    return { status: "success", message: "Affectation ajoutée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function unassignAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
  assignmentId: string,
): Promise<ActionState> {
  try {
    await unassignVolunteer(db(), await currentActor(), organizationId, versionId, assignmentId);
    revalidatePath(planningPath(slug, eventSlug));
    return { status: "success", message: "Affectation retirée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function lockAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
  assignmentId: string,
  locked: boolean,
): Promise<ActionState> {
  try {
    await setAssignmentLock(db(), await currentActor(), organizationId, versionId, assignmentId, locked);
    revalidatePath(planningPath(slug, eventSlug));
    return {
      status: "success",
      message: locked ? "Affectation verrouillée : conservée par les régénérations." : "Verrou retiré.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function reviewAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
): Promise<ActionState> {
  try {
    await markUnderReview(db(), await currentActor(), organizationId, versionId);
    revalidatePath(planningPath(slug, eventSlug));
    return { status: "success", message: "Version passée en arbitrage." };
  } catch (error) {
    return actionError(error);
  }
}

export async function publishAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  versionId: string,
  expectedVersion: number,
  acknowledgeUnfilled: boolean,
  notes: string,
): Promise<ActionState> {
  try {
    const result = await publishVersion(db(), ticketingContext(), await currentActor(), organizationId, versionId, {
      expectedVersion,
      acknowledgeUnfilled,
      ...(notes ? { notes } : {}),
    });
    revalidatePath(planningPath(slug, eventSlug));
    revalidatePath(`/o/${slug}/planning`);
    return {
      status: "success",
      message: `Planning ${result.version.label} publié : ${result.notified} bénévole(s) notifié(s)${result.supersededVersionId ? ", version précédente remplacée" : ""}.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function resolveRequestAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  requestId: string,
  outcome: "resolved" | "dismissed",
  resolution: string,
): Promise<ActionState> {
  try {
    await resolveRequest(db(), await currentActor(), organizationId, requestId, outcome, resolution);
    revalidatePath(planningPath(slug, eventSlug));
    return {
      status: "success",
      message: outcome === "resolved" ? "Demande traitée." : "Demande écartée : la personne reste sur sa mission.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function attendanceAction(
  organizationId: string,
  slug: string,
  eventSlug: string,
  assignmentId: string,
  status: "present" | "absent" | "late" | "excused",
): Promise<ActionState> {
  try {
    await recordAttendance(db(), await currentActor(), organizationId, assignmentId, { status });
    revalidatePath(planningPath(slug, eventSlug));
    return { status: "success", message: "Présence enregistrée." };
  } catch (error) {
    return actionError(error);
  }
}
