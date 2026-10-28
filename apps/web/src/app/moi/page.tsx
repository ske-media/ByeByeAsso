import { getProfile } from "@kroov/domain/identity";
import { Badge, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { UserMenu } from "../o/[slug]/user-menu";
import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Mon compte" };

/** Écran 45 — Profil et préférences. */
export default async function ProfilePage() {
  const session = await requireSession("/moi", { requireVerified: false });
  const profile = await getProfile(db(), session.actor);

  return (
    <AppPublicShell
      back={{ href: "/organisations", label: "Retour à mes organisations" }}
      headerActions={<UserMenu name={profile.name} />}
    >
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Mon compte</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Profil et préférences</h1>
        <p className="mt-2 text-muted">
          {profile.email}{" "}
          {profile.emailVerified ? (
            <Badge tone="lime">Adresse confirmée</Badge>
          ) : (
            <Badge tone="orange">Adresse à confirmer</Badge>
          )}
        </p>
        <Panel className="mt-6 bg-lime">
          <PanelTitle>Mes billets</PanelTitle>
          <p className="text-[13px]">
            Retrouvez les commandes passées avec cette adresse et vos billets à présenter à l'entrée.
          </p>
          <Link href="/moi/billets" className="mt-2 inline-block font-bold underline underline-offset-4">
            Voir mes billets →
          </Link>
        </Panel>
        <Panel>
          <PanelTitle>Identité</PanelTitle>
          <ProfileForm profile={{ name: profile.name, timezone: profile.timezone, phone: profile.phone ?? "" }} />
        </Panel>
        <Panel>
          <PanelTitle>Mot de passe</PanelTitle>
          <PasswordForm />
        </Panel>
        <Panel className="bg-lavender">
          <PanelTitle>Préférences de communication</PanelTitle>
          <p className="text-[13px]">
            Les préférences de notification (billets, missions, campagnes) seront proposées avec les modules
            correspondants. Aucun message marketing ne vous est envoyé sans votre accord explicite.
          </p>
        </Panel>
      </div>
    </AppPublicShell>
  );
}
