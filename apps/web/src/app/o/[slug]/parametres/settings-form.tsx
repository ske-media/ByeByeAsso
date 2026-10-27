"use client";

import type { OrganizationDetail } from "@kroov/domain/organizations";
import { Alert, Button, FormField, Input, Select } from "@kroov/ui";
import { useActionState } from "react";
import { updateOrganizationAction } from "@/actions/organizations";
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

export function SettingsForm({ organization }: { organization: OrganizationDetail }) {
  const [state, action, pending] = useActionState(
    updateOrganizationAction.bind(null, organization.id, organization.slug),
    idleState,
  );
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} noValidate>
      {state.status === "success" ? (
        <Alert tone="success" className="mb-4">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
        <Alert tone="error" className="mb-4">
          {state.message}
        </Alert>
      ) : null}
      <FormField label="Nom" required error={errors.name}>
        <Input name="name" required maxLength={120} defaultValue={values.name ?? organization.name} />
      </FormField>
      <FormField label="Identifiant d'adresse" hint="Non modifiable : il forme vos adresses publiques.">
        <Input value={organization.slug} readOnly aria-readonly="true" />
      </FormField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Forme" required error={errors.legalForm}>
          <Select name="legalForm" defaultValue={values.legalForm ?? organization.legalForm}>
            {LEGAL_FORMS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Pays" required error={errors.country}>
          <Select name="country" defaultValue={values.country ?? organization.country}>
            <option value="FR">France</option>
            <option value="BE">Belgique</option>
            <option value="CH">Suisse</option>
            <option value="LU">Luxembourg</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Fuseau horaire" required error={errors.timezone}>
        <Select name="timezone" defaultValue={values.timezone ?? organization.timezone}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="E-mail de contact"
        hint="Affiché aux participants pour les questions sur vos événements."
        error={errors["settings.contactEmail"]}
      >
        <Input
          type="email"
          name="contactEmail"
          defaultValue={values.contactEmail ?? organization.settings.contactEmail ?? ""}
        />
      </FormField>
      <FormField label="Site web" error={errors["settings.website"]}>
        <Input
          type="url"
          name="website"
          placeholder="https://"
          defaultValue={values.website ?? organization.settings.website ?? ""}
        />
      </FormField>
      <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
        Enregistrer
      </Button>
    </form>
  );
}
