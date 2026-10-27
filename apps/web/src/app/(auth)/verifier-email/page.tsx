import { Alert } from "@kroov/ui";
import type { Metadata } from "next";
import { safeNext } from "@/lib/session";
import { ResendVerification } from "./resend";

export const metadata: Metadata = { title: "Confirmez votre adresse" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; error?: string }>;
}) {
  const { email, next, error } = await searchParams;
  return (
    <>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Une dernière étape</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Confirmez votre adresse
      </h1>
      <p className="mt-3 text-muted">
        {email ? (
          <>
            Nous avons envoyé un lien de confirmation à <b className="text-ink">{email}</b>. Il est valable 24 heures.
          </>
        ) : (
          "Nous vous avons envoyé un lien de confirmation. Il est valable 24 heures."
        )}
      </p>
      {error ? (
        <Alert tone="error" className="mt-4">
          Ce lien n'est plus valide. Demandez un nouveau lien ci-dessous.
        </Alert>
      ) : null}
      <ResendVerification email={email ?? ""} next={safeNext(next)} />
    </>
  );
}
