"use server";

import { parseLocalDateTime } from "@kroov/domain/kernel";
import {
  activateEventPosition,
  archivePosition,
  archiveSkill,
  archiveTeam,
  bulkDecide,
  cancelShift,
  createPosition,
  createShift,
  createSkill,
  createTeam,
  deactivateEventPosition,
  decideApplication,
  updateApplicationByStaff,
  updatePosition,
  updateShift,
  updateSkill,
  updateTeam,
  updateVolunteering,
  verifySkill,
} from "@kroov/domain/volunteers";
import { revalidatePath } from "next/cache";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

/* Catalogue ---------------------------------------------------------------- */

export async function saveSkillAction(
  organizationId: string,
  slug: string,
  skillId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const payload = {
      name: values.name ?? "",
      description: values.description || undefined,
      requiresVerification: values.requiresVerification === "on",
    };
    if (skillId) await updateSkill(db(), actor, organizationId, skillId, payload);
    else await createSkill(db(), actor, organizationId, payload);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: skillId ? "Compétence mise à jour." : "Compétence ajoutée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archiveSkillAction(organizationId: string, slug: string, skillId: string): Promise<ActionState> {
  try {
    await archiveSkill(db(), await currentActor(), organizationId, skillId);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: "Compétence archivée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveTeamAction(
  organizationId: string,
  slug: string,
  teamId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const payload = {
      name: values.name ?? "",
      description: values.description || undefined,
      color: (values.color as "lime" | "lavender" | "orange" | "neutral") || "lavender",
      position: Number(values.position || 0),
    };
    if (teamId) await updateTeam(db(), actor, organizationId, teamId, payload);
    else await createTeam(db(), actor, organizationId, payload);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: teamId ? "Équipe mise à jour." : "Équipe créée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archiveTeamAction(organizationId: string, slug: string, teamId: string): Promise<ActionState> {
  try {
    await archiveTeam(db(), await currentActor(), organizationId, teamId);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: "Équipe archivée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function savePositionAction(
  organizationId: string,
  slug: string,
  positionId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const mandatory = formData.getAll("mandatorySkills").map(String);
    const optional = formData.getAll("optionalSkills").map(String);
    const payload = {
      teamId: values.teamId ?? "",
      name: values.name ?? "",
      description: values.description || undefined,
      instructions: values.instructions || undefined,
      minAge: values.minAge ? Number(values.minAge) : null,
      position: Number(values.position || 0),
      skills: [
        ...mandatory.map((skillId) => ({ skillId, mandatory: true })),
        ...optional.filter((id) => !mandatory.includes(id)).map((skillId) => ({ skillId, mandatory: false })),
      ],
    };
    if (positionId) await updatePosition(db(), actor, organizationId, positionId, payload);
    else await createPosition(db(), actor, organizationId, payload);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: positionId ? "Poste mis à jour." : "Poste créé." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archivePositionAction(
  organizationId: string,
  slug: string,
  positionId: string,
): Promise<ActionState> {
  try {
    await archivePosition(db(), await currentActor(), organizationId, positionId);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: "Poste archivé." };
  } catch (error) {
    return actionError(error);
  }
}

/* Event staffing ----------------------------------------------------------- */

export async function saveVolunteeringAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const labels = formData.getAll("questionLabel").map(String);
    const types = formData.getAll("questionType").map(String);
    const requireds = formData.getAll("questionRequired").map(String);
    const options = formData.getAll("questionOptions").map(String);
    const questions = labels
      .map((label, i) => ({
        label: label.trim(),
        type: (types[i] as "short_text" | "long_text" | "single_choice" | "checkbox") || "short_text",
        required: requireds[i] === "1",
        options: (options[i] ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      }))
      .filter((q) => q.label.length > 0);
    await updateVolunteering(db(), actor, organizationId, eventId, {
      targetCount: Number(values.targetCount || 0),
      maxHoursPerDay: Number(values.maxHoursPerDay || 0),
      minRestMinutes: Number(values.minRestMinutes || 0),
      questions,
    });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    return { status: "success", message: "Réglages enregistrés." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function setRecruitmentAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  status: "open" | "closed",
): Promise<ActionState> {
  try {
    await updateVolunteering(db(), await currentActor(), organizationId, eventId, { recruitmentStatus: status });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}`);
    return { status: "success", message: status === "open" ? "Recrutement ouvert." : "Recrutement fermé." };
  } catch (error) {
    return actionError(error);
  }
}

export async function activatePositionAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  positionId: string,
): Promise<ActionState> {
  try {
    await activateEventPosition(db(), await currentActor(), organizationId, eventId, { positionId });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    return { status: "success", message: "Poste activé sur l'événement." };
  } catch (error) {
    return actionError(error);
  }
}

export async function deactivatePositionAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  eventPositionId: string,
): Promise<ActionState> {
  try {
    await deactivateEventPosition(db(), await currentActor(), organizationId, eventId, eventPositionId);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    return { status: "success", message: "Poste retiré de l'événement (créneaux annulés)." };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveShiftAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  eventPositionId: string,
  shiftId: string | null,
  timezone: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const startsAt = parseLocalDateTime(values.startsDate ?? "", values.startsTime ?? "", timezone);
    const endsAt = parseLocalDateTime(values.endsDate ?? "", values.endsTime ?? "", timezone);
    const fieldErrors: Record<string, string[]> = {};
    if (!startsAt) fieldErrors.startsDate = ["Date et heure de début invalides."];
    if (!endsAt) fieldErrors.endsDate = ["Date et heure de fin invalides."];
    if (!startsAt || !endsAt) return { status: "error", fieldErrors, values };
    const payload = {
      label: values.label || undefined,
      startsAt,
      endsAt,
      requiredCount: Number(values.requiredCount || 0),
      maxCount: values.maxCount ? Number(values.maxCount) : undefined,
      notes: values.notes || undefined,
    };
    if (shiftId) await updateShift(db(), actor, organizationId, eventId, shiftId, payload);
    else await createShift(db(), actor, organizationId, eventId, eventPositionId, payload);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    return { status: "success", message: shiftId ? "Créneau mis à jour." : "Créneau ajouté." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function cancelShiftAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  shiftId: string,
): Promise<ActionState> {
  try {
    await cancelShift(db(), await currentActor(), organizationId, eventId, shiftId);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/benevoles`);
    return { status: "success", message: "Créneau annulé." };
  } catch (error) {
    return actionError(error);
  }
}

/* Applications ------------------------------------------------------------- */

export type DecisionAction = "review" | "approve" | "waitlist" | "reject";

export async function decideAction(
  organizationId: string,
  slug: string,
  applicationId: string,
  action: DecisionAction,
  reason?: string,
): Promise<ActionState> {
  try {
    await decideApplication(
      db(),
      ticketingContext(),
      await currentActor(),
      organizationId,
      applicationId,
      action,
      reason,
    );
    revalidatePath(`/o/${slug}/benevoles`);
    revalidatePath(`/o/${slug}/benevoles/candidatures/${applicationId}`);
    const messages: Record<DecisionAction, string> = {
      review: "Candidature marquée à l'étude.",
      approve: "Candidature acceptée, la personne est prévenue.",
      waitlist: "Candidature placée en liste d'attente.",
      reject: "Candidature non retenue, la personne est informée du motif.",
    };
    return { status: "success", message: messages[action] };
  } catch (error) {
    return actionError(error);
  }
}

export async function bulkDecideAction(
  organizationId: string,
  slug: string,
  ids: string[],
  action: DecisionAction,
  reason?: string,
): Promise<ActionState & { results?: Array<{ id: string; ok: boolean; error?: string }> }> {
  try {
    const results = await bulkDecide(db(), ticketingContext(), await currentActor(), organizationId, {
      ids,
      action,
      ...(reason ? { reason } : {}),
    });
    revalidatePath(`/o/${slug}/benevoles`);
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    return {
      status: failed === 0 ? "success" : "error",
      message:
        failed === 0 ? `${ok} candidature(s) traitée(s).` : `${ok} traitée(s), ${failed} en échec (détail ci-dessous).`,
      results: results.map((r) => ({ id: r.id, ok: r.ok, ...(r.error ? { error: r.error } : {}) })),
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function verifySkillAction(
  organizationId: string,
  slug: string,
  applicationId: string,
  skillId: string,
  verified: boolean,
): Promise<ActionState> {
  try {
    await verifySkill(db(), await currentActor(), organizationId, applicationId, skillId, verified);
    revalidatePath(`/o/${slug}/benevoles/candidatures/${applicationId}`);
    return { status: "success", message: verified ? "Compétence vérifiée." : "Vérification retirée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveInternalNotesAction(
  organizationId: string,
  slug: string,
  applicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await updateApplicationByStaff(db(), await currentActor(), organizationId, applicationId, {
      internalNotes: values.internalNotes ?? "",
    });
    revalidatePath(`/o/${slug}/benevoles/candidatures/${applicationId}`);
    return { status: "success", message: "Notes internes enregistrées (jamais visibles du candidat)." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function staffEditApplicationAction(
  organizationId: string,
  slug: string,
  applicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const prefs = formData.getAll("positionPreferences").map(String).filter(Boolean);
    await updateApplicationByStaff(db(), await currentActor(), organizationId, applicationId, {
      firstName: values.firstName || undefined,
      lastName: values.lastName || undefined,
      email: values.email || undefined,
      phone: values.phone ?? "",
      constraints: values.constraints ?? "",
      ...(prefs.length > 0 ? { positionPreferences: prefs } : {}),
    });
    revalidatePath(`/o/${slug}/benevoles/candidatures/${applicationId}`);
    revalidatePath(`/o/${slug}/benevoles`);
    return { status: "success", message: "Candidature mise à jour." };
  } catch (error) {
    return actionError(error, values);
  }
}
