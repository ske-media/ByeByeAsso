import type { Metadata } from "next";
import { safeNext } from "@/lib/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <p className="text-eyebrow font-extrabold uppercase text-muted">Bienvenue</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Créer mon compte
      </h1>
      <p className="mt-3 text-muted">Un compte gratuit pour créer ou rejoindre une organisation.</p>
      <SignupForm next={safeNext(next)} />
    </>
  );
}
