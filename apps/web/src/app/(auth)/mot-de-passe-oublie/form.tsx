"use client";

import { Alert, Button, FormField, Input } from "@kroov/ui";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: "/reinitialiser-mot-de-passe" });
    setPending(false);
    if (err && err.code === "TOO_MANY_REQUESTS") {
      setError(authErrorMessage(err.code));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-6">
        <Alert tone="success" heading="Vérifiez votre boîte de réception">
          Si un compte existe pour cette adresse, un lien de réinitialisation valable une heure vient d'être envoyé.
        </Alert>
        <p className="mt-5 text-[12px] text-muted">
          <Link href="/connexion" className="font-bold text-ink underline underline-offset-4">
            Retour à la connexion
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <FormField label="Adresse e-mail" required>
        <Input type="email" name="email" autoComplete="email" inputMode="email" required />
      </FormField>
      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Envoi en cours">
        Envoyer le lien
      </Button>
      <p className="mt-5 text-[12px] text-muted">
        <Link href="/connexion" className="font-bold text-ink underline underline-offset-4">
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
