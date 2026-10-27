"use client";

import { Alert, Button, FormField, Input, PasswordInput } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function LoginForm({ next, notice }: { next: string; notice?: string | undefined }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (err) {
      if (err.code === "EMAIL_NOT_VERIFIED") setUnverifiedEmail(email);
      setError(authErrorMessage(err.code));
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {notice ? (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
          {unverifiedEmail ? (
            <>
              {" "}
              <Link
                href={`/verifier-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="font-bold underline"
              >
                Renvoyer le lien
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      <FormField label="Adresse e-mail" required>
        <Input type="email" name="email" autoComplete="email" inputMode="email" required />
      </FormField>
      <FormField label="Mot de passe" required>
        <PasswordInput name="password" autoComplete="current-password" required />
      </FormField>
      <div className="mb-5 text-right text-[12px]">
        <Link href="/mot-de-passe-oublie" className="font-bold underline underline-offset-4">
          Mot de passe oublié ?
        </Link>
      </div>
      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Connexion en cours">
        Se connecter →
      </Button>
      <p className="mt-5 text-[12px] text-muted">
        Pas encore de compte ?{" "}
        <Link
          href={`/inscription?next=${encodeURIComponent(next)}`}
          className="font-bold text-ink underline underline-offset-4"
        >
          Créer mon compte
        </Link>
      </p>
      <p className="mt-6 text-[11px] text-muted">
        En continuant, vous acceptez les conditions d'utilisation. Confidentialité · Aide
      </p>
    </form>
  );
}
