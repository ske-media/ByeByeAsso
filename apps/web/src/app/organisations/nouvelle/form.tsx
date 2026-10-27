"use client";

import { Alert, Button, FormField, Input, Panel, PanelTitle, Select } from "@kroov/ui";
import { useActionState, useState } from "react";
import { createOrganizationAction } from "@/actions/organizations";
import { idleState } from "@/lib/action-state";

const LEGAL_FORMS = [
  ["association", "Association (loi 1901)"],
  ["company", "Entreprise"],
  ["collective", "Collectif informel"],
  ["public_body", "Collectivité ou établissement public"],
  ["other", "Autre"],
] as const;

const TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Luxembourg",
  "America/Martinique",
  "Indian/Reunion",
];

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, idleState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [slug, setSlug] = useState(values.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(values.slug));

  return (
    <form action={action} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]" noValidate>
      <Panel>
        <PanelTitle>Identité de l'organisation</PanelTitle>
        {state.status === "error" && state.message && !Object.keys(errors).length ? (
          <Alert tone="error" className="mb-4">
            {state.message}
          </Alert>
        ) : null}
        <FormField
          label="Nom"
          required
          hint="Le nom public, tel qu'il apparaîtra sur vos événements et vos billets."
          error={errors.name}
        >
          <Input
            name="name"
            required
            maxLength={120}
            defaultValue={values.name ?? ""}
            onChange={(e) => {
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </FormField>
        <FormField
          label="Identifiant d'adresse"
          required
          hint="Lettres minuscules, chiffres et tirets. Il formera l'adresse de vos pages publiques."
          error={errors.slug}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[12px] text-muted">kroov.fr/</span>
            <Input
              name="slug"
              required
              minLength={3}
              maxLength={63}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </div>
        </FormField>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <FormField label="Forme" required error={errors.legalForm}>
            <Select name="legalForm" defaultValue={values.legalForm ?? "association"}>
              {LEGAL_FORMS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Pays" required error={errors.country}>
            <Select name="country" defaultValue={values.country ?? "FR"}>
              <option value="FR">France</option>
              <option value="BE">Belgique</option>
              <option value="CH">Suisse</option>
              <option value="LU">Luxembourg</option>
            </Select>
          </FormField>
        </div>
        <FormField
          label="Fuseau horaire"
          required
          hint="Utilisé pour afficher les dates de vos événements."
          error={errors.timezone}
        >
          <Select name="timezone" defaultValue={values.timezone ?? "Europe/Paris"}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={pending} loadingLabel="Création en cours">
            Créer l'organisation →
          </Button>
        </div>
      </Panel>
      <aside className="space-y-4">
        <Panel className="bg-lavender">
          <PanelTitle>Ce que vous pourrez faire ensuite</PanelTitle>
          <ul className="m-0 list-disc space-y-2 pl-5 text-[13px]">
            <li>
              Inviter votre équipe avec des rôles précis (administration, événement, bénévoles, billetterie, contrôle).
            </li>
            <li>Créer vos événements et ouvrir la billetterie.</li>
            <li>Proposer des adhésions à votre communauté.</li>
          </ul>
        </Panel>
        <Panel>
          <PanelTitle>Bon à savoir</PanelTitle>
          <p className="text-[13px] text-muted">
            Vous pourrez modifier le nom, la forme et le fuseau plus tard dans les réglages. L'identifiant d'adresse,
            lui, est définitif une fois vos premières pages publiées.
          </p>
        </Panel>
      </aside>
    </form>
  );
}
