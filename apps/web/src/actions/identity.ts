"use server";

import { updateProfile } from "@kroov/domain/identity";
import { acceptInvitation } from "@kroov/domain/organizations";
import { deleteAccount } from "@kroov/domain/privacy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    await updateProfile(db(), actor, { name: values.name, timezone: values.timezone, phone: values.phone ?? "" });
  } catch (error) {
    return actionError(error, values);
  }
  revalidatePath("/moi");
  return { status: "success", message: "Profil enregistré." };
}

export async function acceptInvitationAction(token: string): Promise<ActionState> {
  let slug: string;
  try {
    const actor = await currentActor();
    const result = await acceptInvitation(db(), actor, token);
    slug = result.organizationSlug;
  } catch (error) {
    return actionError(error);
  }
  redirect(`/o/${slug}?bienvenue=1`);
}

/** Account deletion (phase 10): anonymisation in one transaction, then sign-out by cookie purge. */
export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await deleteAccount(db(), await currentActor(), { confirmEmail: values.confirmEmail ?? "" });
  } catch (error) {
    return actionError(error, values);
  }
  redirect("/moi/compte-supprime");
}
