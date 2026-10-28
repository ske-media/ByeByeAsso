"use server";

import type { Role } from "@kroov/auth";
import {
  createInvitation,
  createOrganization,
  removeMember,
  resendInvitation,
  revokeInvitation,
  setMemberRoles,
  updateOrganization,
} from "@kroov/domain/organizations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { invitationContext } from "@/lib/email";

export async function createOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  let slug: string;
  try {
    const actor = await currentActor();
    const org = await createOrganization(db(), actor, {
      name: values.name ?? "",
      slug: values.slug ?? "",
      legalForm:
        (values.legalForm as "association" | "company" | "collective" | "public_body" | "other" | undefined) ??
        "association",
      country: values.country ?? "FR",
      timezone: values.timezone ?? "Europe/Paris",
    });
    slug = org.slug;
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/o/${slug}`);
}

export async function updateOrganizationAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await updateOrganization(db(), actor, organizationId, {
      name: values.name,
      legalForm: values.legalForm as "association" | "company" | "collective" | "public_body" | "other" | undefined,
      country: values.country,
      timezone: values.timezone,
      settings: { contactEmail: values.contactEmail ?? "", website: values.website ?? "" },
    });
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}`, "layout");
  return { status: "success", message: "Réglages enregistrés." };
}

export async function inviteMemberAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await createInvitation(db(), actor, invitationContext(), organizationId, {
      email: values.email ?? "",
      role: values.role as Role,
      ...(values.eventId && values.eventId !== "organization" ? { eventId: values.eventId } : {}),
    });
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath(`/o/${slug}/equipe`);
  return { status: "success", message: `Invitation envoyée à ${values.email}.` };
}

export async function revokeInvitationAction(
  organizationId: string,
  slug: string,
  invitationId: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await revokeInvitation(db(), actor, organizationId, invitationId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}/equipe`);
  return { status: "success", message: "Invitation annulée." };
}

export async function resendInvitationAction(
  organizationId: string,
  slug: string,
  invitationId: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await resendInvitation(db(), actor, invitationContext(), organizationId, invitationId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}/equipe`);
  return { status: "success", message: "Invitation renvoyée avec un nouveau lien valable 7 jours." };
}

export async function setMemberRolesAction(
  organizationId: string,
  slug: string,
  memberId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = formData.get("grants");
  const reason = formData.get("reason");
  let grants: Array<{ role: Role; eventId?: string }> = [];
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      grants = parsed
        .filter(
          (g): g is { role: Role; eventId?: string } =>
            typeof g === "object" && g !== null && typeof (g as { role?: unknown }).role === "string",
        )
        .map((g) => (g.eventId ? { role: g.role, eventId: g.eventId } : { role: g.role }));
    }
  } catch {
    return { status: "error", message: "Rôles illisibles. Rechargez la page et réessayez." };
  }
  try {
    const actor = await currentActor();
    await setMemberRoles(db(), actor, organizationId, memberId, {
      grants,
      reason: typeof reason === "string" ? reason : undefined,
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}/equipe`);
  return { status: "success", message: "Rôles mis à jour." };
}

export async function removeMemberAction(
  organizationId: string,
  slug: string,
  memberId: string,
  reason?: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await removeMember(db(), actor, organizationId, memberId, reason);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/o/${slug}/equipe`);
  return { status: "success", message: "Accès retiré." };
}
