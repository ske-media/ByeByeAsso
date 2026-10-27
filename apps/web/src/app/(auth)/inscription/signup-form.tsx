"use client";

import { Alert, Button, FormField, Input, PasswordInput } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ password?: string; email?: string }>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    setFieldError({});
    if (password.length < 10) {
      setFieldError({ password: "Choisissez un mot de passe d'au moins 10 caractères." });
      return;
    }
    setPending(true);
    const { error: err } = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (err) {
      if (err.code === "USER_ALREADY_EXISTS" || err.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        setFieldError({ email: authErrorMessage(err.code) });
      } else if (err.code === "PASSWORD_TOO_SHORT" || err.code === "PASSWORD_TOO_LONG") {
        setFieldError({ password: authErrorMessage(err.code) });
      } else {
        setError(authErrorMessage(err.code));
      }
      return;
    }
    router.push(`/verifier-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <FormField label="Votre nom" required hint="Tel qu'il apparaîtra à votre équipe.">
        <Input name="name" autoComplete="name" required maxLength={80} />
      </FormField>
      <FormField label="Adresse e-mail" required error={fieldError.email}>
        <Input type="email" name="email" autoComplete="email" inputMode="email" required />
      </FormField>
      <FormField
        label="Mot de passe"
        required
        hint="10 caractères minimum. Une phrase facile à retenir fonctionne très bien."
        error={fieldError.password}
      >
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </FormField>
      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Création du compte">
        Créer mon compte →
      </Button>
      <p className="mt-5 text-[12px] text-muted">
        Déjà un compte ?{" "}
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
