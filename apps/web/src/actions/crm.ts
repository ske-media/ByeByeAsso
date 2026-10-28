"use server";

import {
  addNote,
  archiveSegment,
  createContact,
  createSegment,
  createTag,
  deleteNote,
  deleteTag,
  liftSuppression,
  mergeContacts,
  rebuildContacts,
  recordManualConsent,
  type SegmentDefinitionInput,
  setContactArchived,
  setContactTags,
  setStaticMembers,
  suppressEmail,
  updateContact,
  updateSegment,
  updateTag,
} from "@kroov/domain/crm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";

const base = (slug: string) => `/o/${slug}/contacts`;

/* Contacts ------------------------------------------------------------------ */

export async function createContactAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  let id: string;
  try {
    const c = await createContact(db(), await currentActor(), organizationId, {
      email: values.email ?? "",
      firstName: values.firstName || undefined,
      lastName: values.lastName || undefined,
      phone: values.phone || undefined,
      city: values.city || undefined,
    });
    id = c.id;
    revalidatePath(base(slug));
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`${base(slug)}/${id}`);
}

export async function updateContactAction(
  organizationId: string,
  slug: string,
  contactId: string,
  version: number,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await updateContact(db(), await currentActor(), organizationId, contactId, {
      email: values.email ?? "",
      firstName: values.firstName ?? "",
      lastName: values.lastName ?? "",
      phone: values.phone ?? "",
      city: values.city ?? "",
      version,
    });
    revalidatePath(`${base(slug)}/${contactId}`);
    return { status: "success", message: "Fiche mise à jour." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function archiveContactAction(
  organizationId: string,
  slug: string,
  contactId: string,
  archived: boolean,
): Promise<ActionState> {
  try {
    await setContactArchived(db(), await currentActor(), organizationId, contactId, archived);
    revalidatePath(`${base(slug)}/${contactId}`);
    revalidatePath(base(slug));
    return { status: "success", message: archived ? "Contact archivé." : "Contact restauré." };
  } catch (error) {
    return actionError(error);
  }
}

export async function addNoteAction(
  organizationId: string,
  slug: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await addNote(db(), await currentActor(), organizationId, contactId, {
      body: values.body ?? "",
      pinned: values.pinned === "on",
    });
    revalidatePath(`${base(slug)}/${contactId}`);
    return { status: "success", message: "Note ajoutée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function deleteNoteAction(
  organizationId: string,
  slug: string,
  contactId: string,
  noteId: string,
): Promise<ActionState> {
  try {
    await deleteNote(db(), await currentActor(), organizationId, contactId, noteId);
    revalidatePath(`${base(slug)}/${contactId}`);
    return { status: "success", message: "Note supprimée." };
  } catch (error) {
    return actionError(error);
  }
}

export async function setTagsAction(
  organizationId: string,
  slug: string,
  contactId: string,
  tagIds: string[],
): Promise<ActionState> {
  try {
    await setContactTags(db(), await currentActor(), organizationId, contactId, { tagIds });
    revalidatePath(`${base(slug)}/${contactId}`);
    return { status: "success", message: "Étiquettes enregistrées." };
  } catch (error) {
    return actionError(error);
  }
}

export async function consentAction(
  organizationId: string,
  slug: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const r = await recordManualConsent(db(), await currentActor(), organizationId, contactId, {
      status: values.status === "withdrawn" ? "withdrawn" : "granted",
      evidence: values.evidence ?? "",
    });
    revalidatePath(`${base(slug)}/${contactId}`);
    return {
      status: "success",
      message:
        r.marketingEmailStatus === "opted_in"
          ? "Consentement enregistré : la personne est désormais consentie."
          : r.marketingEmailStatus === "withdrawn"
            ? "Retrait enregistré : la personne ne recevra plus de campagnes."
            : "Enregistré (statut inchangé : une exclusion prime).",
    };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function mergeAction(
  organizationId: string,
  slug: string,
  survivingContactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await mergeContacts(db(), await currentActor(), organizationId, survivingContactId, {
      mergedContactId: values.mergedContactId ?? "",
      reason: values.reason || undefined,
    });
    revalidatePath(`${base(slug)}/${survivingContactId}`);
    revalidatePath(base(slug));
    return { status: "success", message: "Fiches fusionnées : l'historique a été rattaché à cette fiche." };
  } catch (error) {
    return actionError(error, values);
  }
}

/* Tags ---------------------------------------------------------------------- */

export async function saveTagAction(
  organizationId: string,
  slug: string,
  tagId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await currentActor();
    const color = (values.color ?? "lime") as "lime" | "lavender" | "orange" | "pink" | "neutral";
    if (tagId) await updateTag(db(), actor, organizationId, tagId, { name: values.name ?? "", color });
    else await createTag(db(), actor, organizationId, { name: values.name ?? "", color });
    revalidatePath(base(slug));
    return { status: "success", message: tagId ? "Étiquette mise à jour." : "Étiquette créée." };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function deleteTagAction(organizationId: string, slug: string, tagId: string): Promise<ActionState> {
  try {
    await deleteTag(db(), await currentActor(), organizationId, tagId);
    revalidatePath(base(slug));
    return { status: "success", message: "Étiquette supprimée." };
  } catch (error) {
    return actionError(error);
  }
}

/* Suppressions -------------------------------------------------------------- */

export async function suppressAction(
  organizationId: string,
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const r = await suppressEmail(db(), await currentActor(), organizationId, {
      email: values.email ?? "",
      reason: (values.reason ?? "manual") as "unsubscribed" | "bounced" | "complaint" | "manual" | "erased",
      note: values.note || undefined,
    });
    revalidatePath(`${base(slug)}/exclusions`);
    revalidatePath(base(slug));
    return {
      status: "success",
      message: r.created ? "Adresse exclue des envois." : "Cette adresse était déjà exclue.",
    };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function liftSuppressionAction(
  organizationId: string,
  slug: string,
  suppressionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await liftSuppression(db(), await currentActor(), organizationId, suppressionId, { reason: values.reason ?? "" });
    revalidatePath(`${base(slug)}/exclusions`);
    revalidatePath(base(slug));
    return { status: "success", message: "Exclusion levée (motif tracé)." };
  } catch (error) {
    return actionError(error, values);
  }
}

/* Segments ------------------------------------------------------------------ */

export async function saveSegmentAction(
  organizationId: string,
  slug: string,
  segmentId: string | null,
  version: number | null,
  input: { name: string; description: string; kind: "dynamic" | "static"; definition: unknown },
): Promise<ActionState & { segmentId?: string }> {
  try {
    const actor = await currentActor();
    const payload = {
      name: input.name,
      description: input.description || undefined,
      kind: input.kind,
      definition: input.definition as SegmentDefinitionInput,
    };
    const seg = segmentId
      ? await updateSegment(db(), actor, organizationId, segmentId, {
          ...payload,
          ...(version !== null ? { version } : {}),
        })
      : await createSegment(db(), actor, organizationId, payload);
    revalidatePath(`${base(slug)}/segments`);
    revalidatePath(`${base(slug)}/segments/${seg.id}`);
    return {
      status: "success",
      message: segmentId
        ? `Segment enregistré : ${seg.memberCount ?? 0} contact(s).`
        : `Segment créé : ${seg.memberCount ?? 0} contact(s).`,
      segmentId: seg.id,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function archiveSegmentAction(
  organizationId: string,
  slug: string,
  segmentId: string,
): Promise<ActionState> {
  try {
    await archiveSegment(db(), await currentActor(), organizationId, segmentId);
    revalidatePath(`${base(slug)}/segments`);
  } catch (error) {
    return actionError(error);
  }
  redirect(`${base(slug)}/segments`);
}

export async function staticMembersAction(
  organizationId: string,
  slug: string,
  segmentId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<ActionState> {
  try {
    const seg = await setStaticMembers(db(), await currentActor(), organizationId, segmentId, change);
    revalidatePath(`${base(slug)}/segments/${segmentId}`);
    return { status: "success", message: `Membres mis à jour : ${seg.memberCount ?? 0} contact(s).` };
  } catch (error) {
    return actionError(error);
  }
}

/* Maintenance --------------------------------------------------------------- */

export async function rebuildAction(organizationId: string, slug: string): Promise<ActionState> {
  try {
    const r = await rebuildContacts(db(), await currentActor(), organizationId);
    revalidatePath(base(slug));
    return {
      status: "success",
      message: `Base reconstruite depuis l'historique : ${r.touched} point(s) de contact rejoués${r.skipped ? `, ${r.skipped} ignoré(s) (adresse invalide)` : ""}.`,
    };
  } catch (error) {
    return actionError(error);
  }
}
