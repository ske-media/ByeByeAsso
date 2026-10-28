"use client";

import type { EventLocationView, EventView } from "@kroov/domain/events";
import { Alert, Button, FormField, Input, Panel, PanelTitle, Select, Textarea } from "@kroov/ui";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createEventAction, updateEventAction } from "@/actions/events";
import { idleState } from "@/lib/action-state";

const TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Luxembourg",
  "America/Martinique",
  "Indian/Reunion",
];

export interface EventFormInitial {
  title: string;
  slug?: string;
  tagline: string;
  description: string;
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
  doorsTime: string;
  timezone: string;
  capacity: string;
  visibility: string;
  locationId: string;
  accessInfo: string;
  programme: string;
  contactEmail: string;
  externalUrl: string;
  showRemainingCapacity: boolean;
}

export function EventForm({
  organizationId,
  slug,
  locations,
  initial,
  event,
}: {
  organizationId: string;
  slug: string;
  locations: EventLocationView[];
  initial: EventFormInitial;
  /** Present when editing: carries id + version for optimistic concurrency. */
  event?: Pick<EventView, "id" | "version" | "status">;
}) {
  const bound = event
    ? updateEventAction.bind(null, organizationId, slug, event.id)
    : createEventAction.bind(null, organizationId, slug);
  const [state, action, pending] = useActionState(bound, idleState);
  const v = { ...initial, ...(state.status === "error" ? (state.values ?? {}) : {}) } as Record<
    string,
    string | boolean
  >;
  const str = (k: keyof EventFormInitial) => String(v[k] ?? "");
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [startsDate, setStartsDate] = useState(str("startsDate"));
  const [endsDate, setEndsDate] = useState(str("endsDate"));
  const crossesMidnight = startsDate && endsDate && startsDate !== endsDate;
  const isPublished = event?.status === "published";

  return (
    <form action={action} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      {event ? <input type="hidden" name="version" value={event.version} /> : null}
      <div className="space-y-5">
        {state.status === "error" && state.message ? (
          <Alert tone="error" heading={state.fieldErrors ? undefined : "Enregistrement impossible"}>
            {state.message}
          </Alert>
        ) : null}
        <Panel>
          <PanelTitle>Informations</PanelTitle>
          <FormField
            label="Titre"
            required
            hint="Court et évocateur : il devient le titre de l'affiche."
            error={errors.title}
          >
            <Input name="title" required minLength={2} maxLength={140} defaultValue={str("title")} />
          </FormField>
          {!event ? (
            <FormField
              label="Identifiant d'adresse"
              hint="Laissez vide : il est généré depuis le titre."
              error={errors.slug}
            >
              <Input name="slug" maxLength={63} defaultValue={str("slug")} placeholder="les-nuits-en-commun" />
            </FormField>
          ) : null}
          <FormField
            label="Accroche"
            hint="Une phrase, affichée sous le titre sur la page publique."
            error={errors.tagline}
          >
            <Input name="tagline" maxLength={160} defaultValue={str("tagline")} />
          </FormField>
          <FormField
            label="Description"
            required
            hint="Au moins 20 caractères. Ce que les participants vont vivre."
            error={errors.description}
          >
            <Textarea name="description" rows={6} maxLength={20000} defaultValue={str("description")} />
          </FormField>
        </Panel>

        <Panel>
          <PanelTitle>Dates</PanelTitle>
          {isPublished ? (
            <Alert tone="warning" className="mb-4">
              Cet événement est publié : un changement de date ou de lieu sera signalé aux participants dès que la
              billetterie existera.
            </Alert>
          ) : null}
          <FormField label="Fuseau horaire" required error={errors.timezone}>
            <Select name="timezone" defaultValue={str("timezone") || "Europe/Paris"}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="Date de début" required error={errors.startsDate}>
              <Input
                type="date"
                name="startsDate"
                required
                value={startsDate}
                onChange={(e) => setStartsDate(e.target.value)}
              />
            </FormField>
            <FormField label="Heure de début" required error={errors.startsTime}>
              <Input type="time" name="startsTime" required defaultValue={str("startsTime")} />
            </FormField>
            <FormField
              label="Date de fin"
              required
              hint={crossesMidnight ? "La fin est le lendemain : l'affichage le précisera partout." : undefined}
              error={errors.endsDate ?? errors.endsAt}
            >
              <Input
                type="date"
                name="endsDate"
                required
                value={endsDate}
                onChange={(e) => setEndsDate(e.target.value)}
              />
            </FormField>
            <FormField label="Heure de fin" required error={errors.endsTime}>
              <Input type="time" name="endsTime" required defaultValue={str("endsTime")} />
            </FormField>
            <FormField
              label="Ouverture des portes"
              hint="Facultatif, le jour du début."
              error={errors.doorsTime ?? errors.doorsAt}
            >
              <Input type="time" name="doorsTime" defaultValue={str("doorsTime")} />
            </FormField>
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Lieu et capacité</PanelTitle>
          <FormField
            label="Lieu"
            hint={
              locations.length === 0 ? (
                <>
                  Aucun lieu enregistré.{" "}
                  <Link href={`/o/${slug}/lieux`} className="font-bold underline">
                    Ajouter un lieu
                  </Link>{" "}
                  (obligatoire avant publication).
                </>
              ) : (
                <Link href={`/o/${slug}/lieux`} className="font-bold underline">
                  Gérer les lieux
                </Link>
              )
            }
            error={errors.locationId}
          >
            <Select name="locationId" defaultValue={str("locationId") || "none"}>
              <option value="none">À définir</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.city}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Capacité"
            required
            hint="Nombre total de places. Les quotas par tarif viendront avec la billetterie."
            error={errors.capacity}
          >
            <Input
              type="number"
              name="capacity"
              min={0}
              max={1000000}
              inputMode="numeric"
              required
              defaultValue={str("capacity")}
            />
          </FormField>
        </Panel>

        <Panel>
          <PanelTitle>Page publique</PanelTitle>
          <FormField
            label="Visibilité"
            required
            hint="Public : listé sur votre page. Non répertorié : accessible uniquement par lien direct."
            error={errors.visibility}
          >
            <Select name="visibility" defaultValue={str("visibility") || "public"}>
              <option value="public">Public</option>
              <option value="unlisted">Non répertorié (lien direct)</option>
            </Select>
          </FormField>
          <FormField label="Programme" hint="Un paragraphe par ligne." error={errors["settings.programme"]}>
            <Textarea name="programme" rows={4} maxLength={8000} defaultValue={str("programme")} />
          </FormField>
          <FormField
            label="Accès et accueil"
            hint="Transports, accessibilité, consignes."
            error={errors["settings.accessInfo"]}
          >
            <Textarea name="accessInfo" rows={3} maxLength={4000} defaultValue={str("accessInfo")} />
          </FormField>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <FormField label="E-mail de contact" error={errors["settings.contactEmail"]}>
              <Input type="email" name="contactEmail" defaultValue={str("contactEmail")} />
            </FormField>
            <FormField label="Lien externe" error={errors["settings.externalUrl"]}>
              <Input type="url" name="externalUrl" placeholder="https://" defaultValue={str("externalUrl")} />
            </FormField>
          </div>
          <label className="flex items-start gap-3 text-[13px]">
            <input
              type="checkbox"
              name="showRemainingCapacity"
              defaultChecked={Boolean(v.showRemainingCapacity)}
              className="mt-1 size-4 accent-ink"
            />
            <span>Afficher les places restantes sur la page publique (quand la billetterie sera ouverte).</span>
          </label>
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Panel className="bg-lavender">
          <PanelTitle>{event ? "Enregistrer" : "Créer en brouillon"}</PanelTitle>
          <p className="text-[13px]">
            {event
              ? "Vos modifications sont conservées même en cas d'erreur. Une personne qui aurait modifié l'événement entre-temps sera détectée."
              : "L'événement reste un brouillon invisible du public jusqu'à sa publication. Vous pourrez tout modifier."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
              {event ? "Enregistrer" : "Créer l'événement"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={event ? `/o/${slug}/evenements` : `/o/${slug}/evenements`}>Annuler</Link>
            </Button>
          </div>
        </Panel>
      </aside>
    </form>
  );
}
