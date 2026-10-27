"use client";

import { Alert, Button, FormField, Input, PasswordInput, Select } from "@kroov/ui";
import { useActionState, useState } from "react";
import { updateProfileAction } from "@/actions/identity";
import { idleState } from "@/lib/action-state";
import { authClient, authErrorMessage } from "@/lib/auth-client";

const TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Luxembourg",
  "America/Martinique",
  "Indian/Reunion",
];

export function ProfileForm({ profile }: { profile: { name: string; timezone: string; phone: string } }) {
  const [state, action, pending] = useActionState(updateProfileAction, idleState);
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
        <Input name="name" required maxLength={80} defaultValue={values.name ?? profile.name} autoComplete="name" />
      </FormField>
      <FormField label="Fuseau horaire" required error={errors.timezone}>
        <Select name="timezone" defaultValue={values.timezone ?? profile.timezone}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Téléphone" hint="Facultatif. Utile pour les responsables le jour J." error={errors.phone}>
        <Input
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={30}
          defaultValue={values.phone ?? profile.phone}
        />
      </FormField>
      <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
        Enregistrer
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    setMessage(null);
    setFieldError(undefined);
    if (newPassword.length < 10) {
      setFieldError("Choisissez un mot de passe d'au moins 10 caractères.");
      return;
    }
    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);
    if (error) {
      setMessage({ tone: "error", text: authErrorMessage(error.code, "Le mot de passe actuel est incorrect.") });
      return;
    }
    form.reset();
    setMessage({ tone: "success", text: "Mot de passe modifié. Vos autres sessions ont été déconnectées." });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {message ? (
        <Alert tone={message.tone} className="mb-4">
          {message.text}
        </Alert>
      ) : null}
      <FormField label="Mot de passe actuel" required>
        <PasswordInput name="currentPassword" autoComplete="current-password" required />
      </FormField>
      <FormField label="Nouveau mot de passe" required hint="10 caractères minimum." error={fieldError}>
        <PasswordInput name="newPassword" autoComplete="new-password" required minLength={10} maxLength={128} />
      </FormField>
      <Button type="submit" variant="secondary" loading={pending} loadingLabel="Modification">
        Modifier le mot de passe
      </Button>
    </form>
  );
}
