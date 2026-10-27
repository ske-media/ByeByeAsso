import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { safeNext } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string }>;
}) {
  const { next, message } = await searchParams;
  const session = await currentSession();
  const destination = safeNext(next);
  if (session?.user.emailVerified) redirect(destination);

  return (
    <>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Bon retour</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">On reprend ?</h1>
      <p className="mt-3 text-muted">Connectez-vous à votre espace Kroov.</p>
      <LoginForm
        next={destination}
        notice={message === "reinitialise" ? "Mot de passe modifié. Connectez-vous avec le nouveau." : undefined}
      />
    </>
  );
}
