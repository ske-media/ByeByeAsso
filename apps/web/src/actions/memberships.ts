"use server";

import { parseLocalDateTime } from "@kroov/domain/kernel";
import {
  approveMembership,
  archiveMembershipPlan,
  cancelMembership,
  createMembershipPlan,
  extendMembership,
  reactivateMembership,
  rejectMembership,
  resendMembershipLink,
  suspendMembership,
  updateMembershipPlan,
} from "@kroov/domain/memberships";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";

function euros(value: string | undefined): number {
  const v = (value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new RangeError("Montant invalide.");
  return Math.round(n * 100);
}

function planFromForm(values: Record<string, string>, timezone: string) {
  const fieldErrors: Record<string, string[]> = {};
  let priceMinor = 0;
  try {
    priceMinor = euros(values.price);
  } catch {
    fieldErrors.price = ["Indiquez un montant valide (ex. 20,00)."];
  }
  const periodKind: "fixed" | "rolling" = values.periodKind === "rolling" ? "rolling" : "fixed";
  const validFrom = values.validFrom ? parseLocalDateTime(values.validFrom, "00:00", timezone) : null;
  const validUntil = values.validUntil ? parseLocalDateTime(values.validUntil, "23:59", timezone) : null;
  if (periodKind === "fixed" && values.validFrom && !validFrom) fieldErrors.validFrom = ["Date invalide."];
  if (periodKind === "fixed" && values.validUntil && !validUntil) fieldErrors.validUntil = ["Date invalide."];
  const benefits = (values.benefits ?? "")
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (Object.keys(fieldErrors).length > 0) return { ok: false as const, fieldErrors };
  return {
    ok: true as const,
    payload: {
      name: values.name ?? "",
      slug: values.slug || undefined,
      description: values.description || undefined,
      priceMinor,
      periodKind,
      validFrom,
      validUntil,
      durationMonths: values.durationMonths ? Number(values.durationMonths) : null,
      requiresReview: values.requiresReview === "on",
      maxMembers: values.maxMembers ? Number(values.maxMembers) : null,
      public: values.public === "on",
      position: Number(values.position || 0),
      benefits,
    },
  };
}

export async function savePlanAction(
  organizationId: string,
  slug: string,
  timezone: string,
  planId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  let createdId: string | null = null;
  try {
    const actor = await currentActor();
    const built = planFromForm(values, timezone);
    if (!built.ok) return { status: "error", fieldErrors: built.fieldErrors, values };
    if (planId) {
      await updateMembershipPlan(db(), actor, organizationId, planId, built.payload);
    } else {
      createdId = (await createMembershipPlan(db(), actor, organizationId, built.payload)).id;
    }
    revalidatePath(`/o/${slug}/adhesions`);
  } catch (error) {
    return actionError(error, values);
  }
  if (createdId) redirect(`/o/${slug}/adhesions/formules/${createdId}?cree=1`);
  return { status: "success", message: "Formule enregistrée." };
}

export async function archivePlanAction(organizationId: string, slug: string, planId: string): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await archiveMembershipPlan(db(), actor, organizationId, planId);
    revalidatePath(`/o/${slug}/adhesions`);
    return { status: "success", message: "Formule archivée." };
  } catch (error) {
    return actionError(error);
  }
}

type MembershipAction = "approve" | "reject" | "suspend" | "reactivate" | "cancel" | "resend";

export async function membershipAction(
  organizationId: string,
  slug: string,
  membershipId: string,
  action: MembershipAction,
  reason?: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const ctx = ticketingContext();
    switch (action) {
      case "approve":
        await approveMembership(db(), ctx, actor, organizationId, membershipId);
        break;
      case "reject":
        await rejectMembership(db(), ctx, actor, organizationId, membershipId, reason ?? "");
        break;
      case "suspend":
        await suspendMembership(db(), ctx, actor, organizationId, membershipId, reason ?? "");
        break;
      case "reactivate":
        await reactivateMembership(db(), ctx, actor, organizationId, membershipId);
        break;
      case "cancel":
        await cancelMembership(db(), ctx, actor, organizationId, membershipId, reason ?? "");
        break;
      case "resend":
        await resendMembershipLink(db(), ctx, actor, organizationId, membershipId);
        break;
    }
    revalidatePath(`/o/${slug}/adhesions`);
    revalidatePath(`/o/${slug}/adhesions/${membershipId}`);
    const messages: Record<MembershipAction, string> = {
      approve: "Demande approuvée.",
      reject: "Demande refusée, la personne est informée.",
      suspend: "Adhésion suspendue.",
      reactivate: "Adhésion réactivée.",
      cancel: "Adhésion annulée.",
      resend: "Lien renvoyé : l'ancien lien ne fonctionne plus.",
    };
    return { status: "success", message: messages[action] };
  } catch (error) {
    return actionError(error);
  }
}

export async function extendMembershipAction(
  organizationId: string,
  slug: string,
  membershipId: string,
  timezone: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const until = values.validUntil ? parseLocalDateTime(values.validUntil, "23:59", timezone) : null;
    if (!until) return { status: "error", fieldErrors: { validUntil: ["Indiquez une date valide."] }, values };
    await extendMembership(db(), ticketingContext(), actor, organizationId, membershipId, {
      validUntil: until,
      reason: values.reason ?? "",
    });
    revalidatePath(`/o/${slug}/adhesions/${membershipId}`);
    return { status: "success", message: "Validité prolongée (tracée dans l'historique)." };
  } catch (error) {
    return actionError(error, values);
  }
}
