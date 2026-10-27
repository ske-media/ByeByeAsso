import type { Metadata } from "next";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Récupération</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Mot de passe oublié
      </h1>
      <p className="mt-3 text-muted">
        Indiquez votre adresse e-mail. Si un compte existe, vous recevrez un lien pour choisir un nouveau mot de passe.
      </p>
      <ForgotPasswordForm />
    </>
  );
}
