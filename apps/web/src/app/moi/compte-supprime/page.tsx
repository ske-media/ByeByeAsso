import { Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AppPublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Compte supprimé" };

/** Page de confirmation après suppression du compte (la session a été purgée côté serveur). */
export default function AccountDeletedPage() {
  return (
    <AppPublicShell back={{ href: "/", label: "Retour à l'accueil" }}>
      <div className="py-10">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Mon compte</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Votre compte a été supprimé.</h1>
        <Panel className="mt-6">
          <PanelTitle>Ce qui s'est passé</PanelTitle>
          <ul className="m-0 list-disc space-y-1 pl-5 text-[13px]">
            <li>Votre nom, votre adresse e-mail, votre téléphone et vos connexions ont été effacés.</li>
            <li>Vos accès aux organisations ont été retirés ; vos notifications ont été supprimées.</li>
            <li>
              Les commandes, billets et écritures comptables sont conservés sans votre identité (obligation légale).
            </li>
          </ul>
          <p className="mt-4 text-[13px] text-muted">
            Vous pouvez créer un nouveau compte à tout moment avec la même adresse.{" "}
            <Link href="/inscription" className="font-bold underline underline-offset-4">
              Créer un compte
            </Link>
          </p>
        </Panel>
      </div>
    </AppPublicShell>
  );
}
