"use client";

import { Alert, Button, FormField, Input, Select, Textarea } from "@kroov/ui";
import { useActionState } from "react";
import { createLocationAction } from "@/actions/events";
import { idleState } from "@/lib/action-state";

export function LocationForm({ organizationId, slug }: { organizationId: string; slug: string }) {
  const [state, action, pending] = useActionState(createLocationAction.bind(null, organizationId, slug), idleState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} noValidate key={state.status === "success" ? state.message : "form"}>
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
      <FormField label="Nom du lieu" required error={errors.name}>
        <Input name="name" required maxLength={120} defaultValue={values.name ?? ""} placeholder="Le Sucre" />
      </FormField>
      <FormField label="Adresse" error={errors.addressLine1}>
        <Input
          name="addressLine1"
          maxLength={200}
          defaultValue={values.addressLine1 ?? ""}
          placeholder="50 quai Rambaud"
        />
      </FormField>
      <FormField label="Complément" error={errors.addressLine2}>
        <Input name="addressLine2" maxLength={200} defaultValue={values.addressLine2 ?? ""} />
      </FormField>
      <div className="grid gap-x-4 sm:grid-cols-[1fr_2fr]">
        <FormField label="Code postal" error={errors.postalCode}>
          <Input name="postalCode" maxLength={12} inputMode="numeric" defaultValue={values.postalCode ?? ""} />
        </FormField>
        <FormField label="Ville" required error={errors.city}>
          <Input name="city" required maxLength={120} defaultValue={values.city ?? ""} />
        </FormField>
      </div>
      <FormField label="Pays" required error={errors.country}>
        <Select name="country" defaultValue={values.country ?? "FR"}>
          <option value="FR">France</option>
          <option value="BE">Belgique</option>
          <option value="CH">Suisse</option>
          <option value="LU">Luxembourg</option>
        </Select>
      </FormField>
      <FormField label="Accès et accessibilité" hint="Transports, parking, accès PMR." error={errors.accessNotes}>
        <Textarea name="accessNotes" rows={3} maxLength={4000} defaultValue={values.accessNotes ?? ""} />
      </FormField>
      <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
        Ajouter le lieu
      </Button>
    </form>
  );
}
