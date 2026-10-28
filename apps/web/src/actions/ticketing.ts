"use server";

import { parseLocalDateTime } from "@kroov/domain/kernel";
import {
  archiveTicketType,
  createPool,
  createPromoCode,
  createRefund,
  createTicketType,
  deletePool,
  resendOrderEmail,
  setPromoCodeActive,
  startPaymentOnboarding,
  syncPaymentAccount,
  updateTicketingSettings,
  updateTicketType,
} from "@kroov/domain/ticketing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ticketingContext } from "@/lib/ticketing";

/** "24,00" / "24.00" / "24" → minor units; empty → 0. */
function euros(value: string | undefined): number {
  const v = (value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new RangeError("Montant invalide.");
  return Math.round(n * 100);
}

function optionalInt(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
}

function optionalInstant(
  date: string | undefined,
  time: string | undefined,
  timezone: string,
): Date | null | "invalid" {
  if (!date) return null;
  const d = parseLocalDateTime(date, time || "00:00", timezone);
  return d ?? "invalid";
}

function ticketTypeFromForm(values: Record<string, string>, timezone: string) {
  const fieldErrors: Record<string, string[]> = {};
  let priceMinor = 0;
  try {
    priceMinor = euros(values.price);
  } catch {
    fieldErrors.price = ["Indiquez un prix valide (ex. 24,00)."];
  }
  const quota = optionalInt(values.quota);
  if (Number.isNaN(quota)) fieldErrors.quota = ["Quota invalide."];
  const salesStartAt = optionalInstant(values.salesStartDate, values.salesStartTime, timezone);
  const salesEndAt = optionalInstant(values.salesEndDate, values.salesEndTime, timezone);
  if (salesStartAt === "invalid") fieldErrors.salesStartDate = ["Date de début de vente invalide."];
  if (salesEndAt === "invalid") fieldErrors.salesEndDate = ["Date de fin de vente invalide."];
  if (Object.keys(fieldErrors).length > 0) return { ok: false as const, fieldErrors };
  return {
    ok: true as const,
    payload: {
      name: values.name ?? "",
      description: values.description || undefined,
      priceMinor,
      quota,
      salesStartAt: salesStartAt === "invalid" ? null : salesStartAt,
      salesEndAt: salesEndAt === "invalid" ? null : salesEndAt,
      minPerOrder: Number(values.minPerOrder || 1),
      maxPerOrder: Number(values.maxPerOrder || 10),
      hidden: values.hidden === "on",
      position: Number(values.position || 0),
      poolId: values.poolId && values.poolId !== "none" ? values.poolId : null,
    },
  };
}

export async function createTicketTypeAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  timezone: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const built = ticketTypeFromForm(values, timezone);
    if (!built.ok) return { status: "error", fieldErrors: built.fieldErrors, values };
    await createTicketType(db(), actor, organizationId, eventId, built.payload);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: `Tarif « ${built.payload.name} » ajouté.` };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function updateTicketTypeAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  timezone: string,
  ticketTypeId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const built = ticketTypeFromForm(values, timezone);
    if (!built.ok) return { status: "error", fieldErrors: built.fieldErrors, values };
    await updateTicketType(db(), actor, organizationId, eventId, ticketTypeId, built.payload);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: "Tarif enregistré." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archiveTicketTypeAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  ticketTypeId: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await archiveTicketType(db(), actor, organizationId, eventId, ticketTypeId);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: "Tarif archivé." };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateTicketingSettingsAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  timezone: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const close = optionalInstant(values.salesCloseDate, values.salesCloseTime, timezone);
    if (close === "invalid")
      return { status: "error", fieldErrors: { salesCloseDate: ["Date de clôture invalide."] }, values };
    await updateTicketingSettings(db(), actor, organizationId, eventId, {
      maxTicketsPerOrder: Number(values.maxTicketsPerOrder || 6),
      salesCloseAt: close,
      nominativeTickets: values.nominativeTickets === "on",
      ...(values.ticketingStatus === "open" || values.ticketingStatus === "closed"
        ? { ticketingStatus: values.ticketingStatus }
        : {}),
    });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}`);
    return { status: "success", message: "Paramètres de vente enregistrés." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function setTicketingStatusAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  status: "open" | "closed",
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await updateTicketingSettings(db(), actor, organizationId, eventId, { ticketingStatus: status });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}`);
    return { status: "success", message: status === "open" ? "Les ventes sont ouvertes." : "Les ventes sont closes." };
  } catch (error) {
    return actionError(error);
  }
}

export async function createPoolAction(
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
    await createPool(db(), actor, organizationId, eventId, {
      name: values.name ?? "",
      capacity: Number(values.capacity || 0),
    });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: "Pool de capacité créé." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function deletePoolAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  poolId: string,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await deletePool(db(), actor, organizationId, eventId, poolId);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: "Pool supprimé." };
  } catch (error) {
    return actionError(error);
  }
}

export async function createPromoCodeAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  timezone: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const kind = values.kind === "amount" ? "amount" : "percent";
    let value: number;
    try {
      value =
        kind === "amount" ? euros(values.value) : Math.round(Number((values.value ?? "").replace(",", ".")) * 100);
    } catch {
      return { status: "error", fieldErrors: { value: ["Valeur invalide."] }, values };
    }
    const validFrom = optionalInstant(values.validFromDate, values.validFromTime, timezone);
    const validUntil = optionalInstant(values.validUntilDate, values.validUntilTime, timezone);
    if (validFrom === "invalid" || validUntil === "invalid")
      return { status: "error", fieldErrors: { validFromDate: ["Dates invalides."] }, values };
    await createPromoCode(db(), actor, organizationId, eventId, {
      code: values.code ?? "",
      kind,
      value,
      maxRedemptions: optionalInt(values.maxRedemptions),
      validFrom,
      validUntil,
    });
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: `Code ${(values.code ?? "").toUpperCase()} créé.` };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function togglePromoCodeAction(
  organizationId: string,
  slug: string,
  eventId: string,
  eventSlug: string,
  promoCodeId: string,
  active: boolean,
): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await setPromoCodeActive(db(), actor, organizationId, eventId, promoCodeId, active);
    revalidatePath(`/o/${slug}/evenements/${eventSlug}/billets`);
    return { status: "success", message: active ? "Code activé." : "Code désactivé." };
  } catch (error) {
    return actionError(error);
  }
}

export async function refundOrderAction(
  organizationId: string,
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const ticketIds = formData.getAll("ticketIds").filter((v): v is string => typeof v === "string");
    const full = values.mode === "full";
    await createRefund(db(), ticketingContext(), actor, organizationId, orderId, {
      full,
      ticketIds: full ? undefined : ticketIds,
      reason: values.reason ?? "",
    });
    revalidatePath(`/o/${slug}/billetterie/commandes/${orderId}`);
    revalidatePath(`/o/${slug}/billetterie`);
    return {
      status: "success",
      message: full ? "Commande remboursée intégralement." : `${ticketIds.length} billet(s) remboursé(s).`,
    };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function resendOrderAction(organizationId: string, slug: string, orderId: string): Promise<ActionState> {
  try {
    const actor = await currentActor();
    await resendOrderEmail(db(), ticketingContext(), actor, organizationId, orderId);
    revalidatePath(`/o/${slug}/billetterie/commandes/${orderId}`);
    return { status: "success", message: "Billets renvoyés : les anciens liens ne fonctionnent plus." };
  } catch (error) {
    return actionError(error);
  }
}

export async function connectPaymentsAction(organizationId: string, slug: string): Promise<ActionState> {
  let url: string;
  try {
    const actor = await currentActor();
    const base = `${env().APP_URL}/o/${slug}/parametres`;
    const result = await startPaymentOnboarding(db(), ticketingContext(), actor, organizationId, {
      returnUrl: `${base}?paiements=retour`,
      refreshUrl: `${base}?paiements=relance`,
    });
    url = result.onboardingUrl;
  } catch (error) {
    return actionError(error);
  }
  redirect(url);
}

export async function syncPaymentsAction(organizationId: string, slug: string): Promise<ActionState> {
  try {
    const actor = await currentActor();
    const account = await syncPaymentAccount(db(), ticketingContext(), actor, organizationId);
    revalidatePath(`/o/${slug}/parametres`);
    return {
      status: "success",
      message: account.chargesEnabled
        ? "Compte de paiement actif."
        : "Compte en attente de validation par le prestataire.",
    };
  } catch (error) {
    return actionError(error);
  }
}
