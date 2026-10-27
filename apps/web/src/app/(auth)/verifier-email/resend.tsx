"use client";

import { Alert, Button, FormField, Input } from "@kroov/ui";
import Link from "next/link";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ResendVerification({ email, next }: { email: string; next: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({ email: value, callbackURL: next });
    setPending(false);
    if (err && err.code === "TOO_MANY_REQUESTS") {
      setError(authErrorMessage(err.code));
      return;
    }
    // Same outcome whether or not the address exists: no account enumeration.
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {done ? (
        <Alert tone="success" className="mb-4">
          Si un compte existe pour cette adresse, un nouveau lien vient d'être envoyé.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <FormField label="Adresse e-mail" required>
        <Input type="email" name="email" defaultValue={email} autoComplete="email" required />
      </FormField>
      <Button type="submit" variant="secondary" fullWidth loading={pending} loadingLabel="Envoi en cours">
        Renvoyer le lien de confirmation
      </Button>
      <p className="mt-5 text-[12px] text-muted">
        Déjà confirmé ?{" "}
        <Link
          href={`/connexion?next=${encodeURIComponent(next)}`}
          className="font-bold text-ink underline underline-offset-4"
        >
          Se connecter
        </Link>
      </p>
    </form>
  );
}
