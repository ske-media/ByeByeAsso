"use server";

import {
  archiveTemplate,
  cancelCampaign,
  confirmUnsubscribe,
  createCampaign,
  createTemplate,
  scheduleCampaign,
  sendTestEmail,
  unscheduleCampaign,
  updateCampaign,
  updateTemplate,
} from "@kroov/domain/marketing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";

const base = (slug: string) => `/o/${slug}/marketing`;

function campaignPayload(values: Record<string, string>) {
  return {
    name: values.name ?? "",
    subject: values.subject ?? "",
    preheader: values.preheader || undefined,
    fromName: values.fromName ?? "",
    replyTo: values.replyTo || undefined,
    body: values.body ?? "",
    segmentId: values.segmentId || null,
    templateId: values.templateId || null,
  };
}

export async function createCampaignAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  let id: string;
  try {
    const c = await createCampaign(db(), await currentActor(), organizationId, campaignPayload(values));
    id = c.id;
    revalidatePath(base(slug));
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`${base(slug)}/${id}`);
}

export async function updateCampaignAction(
  organizationId: string,
  slug: string,
  campaignId: string,
  version: number,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await updateCampaign(db(), await currentActor(), organizationId, campaignId, {
      ...campaignPayload(values),
      version,
    });
    revalidatePath(`${base(slug)}/${campaignId}`);
    return { status: "success", message: "Brouillon enregistré." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function sendTestAction(organizationId: string, slug: string, campaignId: string): Promise<ActionState> {
  try {
    const r = await sendTestEmail(db(), marketingContext(), await currentActor(), organizationId, campaignId);
    revalidatePath(`${base(slug)}/${campaignId}`);
    return { status: "success", message: `E-mail de test envoyé à ${r.to}.` };
  } catch (error) {
    return actionError(error);
  }
}

export async function scheduleAction(
  organizationId: string,
  _slug: string,
  campaignId: string,
  version: number,
  input: { sendAt: string | null; includeCustomerException: boolean; legalNote: string },
): Promise<ActionState> {
  try {
    const r = await scheduleCampaign(db(), await currentActor(), organizationId, campaignId, {
      ...(input.sendAt ? { sendAt: new Date(input.sendAt) } : {}),
      includeCustomerException: input.includeCustomerException,
      legalNote: input.legalNote || undefined,
      version,
    });
    // No revalidatePath here: it would re-render the verification page, whose server component redirects
    // a non-draft campaign to its report and would hide the confirmation. Pages are dynamic anyway.
    return {
      status: "success",
      message: input.sendAt
        ? `Campagne programmée : ${r.check.eligibleCount} destinataire(s) éligible(s) au moment de la programmation ; l'éligibilité sera revérifiée à l'envoi.`
        : `Envoi lancé : ${r.check.eligibleCount} destinataire(s) éligible(s). Le worker envoie par lots dans la minute ; l'éligibilité est revérifiée à l'envoi.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function unscheduleAction(organizationId: string, slug: string, campaignId: string): Promise<ActionState> {
  try {
    await unscheduleCampaign(db(), await currentActor(), organizationId, campaignId);
    revalidatePath(`${base(slug)}/${campaignId}`);
    revalidatePath(base(slug));
    return { status: "success", message: "Campagne déprogrammée : elle redevient un brouillon." };
  } catch (error) {
    return actionError(error);
  }
}

export async function cancelCampaignAction(
  organizationId: string,
  slug: string,
  campaignId: string,
): Promise<ActionState> {
  try {
    await cancelCampaign(db(), await currentActor(), organizationId, campaignId);
    revalidatePath(`${base(slug)}/${campaignId}`);
    revalidatePath(base(slug));
    return { status: "success", message: "Campagne annulée." };
  } catch (error) {
    return actionError(error);
  }
}

/* Templates ----------------------------------------------------------------- */

export async function saveTemplateAction(
  organizationId: string,
  slug: string,
  templateId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const payload = {
      name: values.name ?? "",
      subject: values.subject ?? "",
      preheader: values.preheader || undefined,
      body: values.body ?? "",
    };
    if (templateId) await updateTemplate(db(), actor, organizationId, templateId, payload);
    else await createTemplate(db(), actor, organizationId, payload);
    revalidatePath(`${base(slug)}/gabarits`);
    return { status: "success", message: templateId ? "Gabarit enregistré." : "Gabarit créé." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archiveTemplateAction(
  organizationId: string,
  slug: string,
  templateId: string,
): Promise<ActionState> {
  try {
    await archiveTemplate(db(), await currentActor(), organizationId, templateId);
    revalidatePath(`${base(slug)}/gabarits`);
    return { status: "success", message: "Gabarit archivé." };
  } catch (error) {
    return actionError(error);
  }
}

/* Public --------------------------------------------------------------------- */

export async function unsubscribeAction(ref: string): Promise<ActionState> {
  try {
    const done = await confirmUnsubscribe(db(), marketingContext(), ref, null);
    if (!done) return { status: "error", message: "Lien de désinscription inconnu ou expiré." };
    return { status: "success", message: "Désinscription enregistrée." };
  } catch (error) {
    return actionError(error);
  }
}
