import { Alert, Button } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

/** Écran 46. Better Auth redirects here with ?token=… (or ?error=INVALID_TOKEN). */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Récupération</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Nouveau mot de passe
      </h1>
      {!token || error ? (
        <div className="mt-6">
          <Alert tone="error" heading="Ce lien n'est plus valide">
            Les liens de réinitialisation expirent après une heure et ne servent qu'une fois. Demandez-en un nouveau.
          </Alert>
          <div className="mt-4">
            <Button asChild variant="primary">
              <Link href="/mot-de-passe-oublie">Demander un nouveau lien</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-muted">
            Choisissez un mot de passe d'au moins 10 caractères. Vos autres sessions seront déconnectées.
          </p>
          <ResetPasswordForm token={token} />
        </>
      )}
    </>
  );
}
