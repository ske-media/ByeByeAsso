"use client";

import { Alert, Button, FormField, PasswordInput } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    setError(null);
    setFieldError(undefined);
    if (password.length < 10) {
      setFieldError("Choisissez un mot de passe d'au moins 10 caractères.");
      return;
    }
    if (password !== confirm) {
      setFieldError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (err) {
      setError(authErrorMessage(err.code));
      return;
    }
    router.push("/connexion?message=reinitialise");
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <FormField label="Nouveau mot de passe" required error={fieldError}>
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </FormField>
      <FormField label="Confirmez le mot de passe" required>
        <PasswordInput name="confirm" autoComplete="new-password" required minLength={10} maxLength={128} />
      </FormField>
      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Enregistrement">
        Enregistrer le nouveau mot de passe
      </Button>
    </form>
  );
}
