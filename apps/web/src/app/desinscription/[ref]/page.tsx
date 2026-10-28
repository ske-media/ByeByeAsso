import { unsubscribeInfo } from "@kroov/domain/marketing";
import { Alert, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";
import { UnsubscribeForm } from "./unsubscribe-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Se désinscrire", robots: { index: false } };

/** Public unsubscribe page — works without any account; the reference is a signed per-recipient token. */
export default async function UnsubscribePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (ref === "test") {
    return (
      <AppPublicShell>
        <div className="py-6">
          <h1 className="text-[32px] font-black leading-[1.04] tracking-[-1.2px]">Lien de test</h1>
          <p className="mt-3 text-muted">
            Ce message était un e-mail de test envoyé à l'équipe : le lien de désinscription n'agit sur aucune adresse.
            Dans une campagne réelle, chaque destinataire reçoit son propre lien.
          </p>
        </div>
      </AppPublicShell>
    );
  }
  const info = await unsubscribeInfo(db(), marketingContext(), ref);
  if (!info) notFound();
  return (
    <AppPublicShell>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{info.organizationName}</p>
        <h1 className="mt-2 text-[32px] font-black leading-[1.04] tracking-[-1.2px]">
          {info.alreadyUnsubscribed ? "Vous êtes désinscrit·e." : "Ne plus recevoir ces e-mails ?"}
        </h1>
        <Panel className="mt-5">
          {info.alreadyUnsubscribed ? (
            <Alert tone="success">
              L'adresse <b>{info.email}</b> ne recevra plus de campagnes de {info.organizationName}. Les e-mails liés à
              vos commandes, adhésions ou missions continuent d'arriver.
            </Alert>
          ) : (
            <>
              <p className="text-[15px]">
                En confirmant, l'adresse <b>{info.email}</b> est exclue des campagnes de <b>{info.organizationName}</b>.
                Aucune connexion n'est nécessaire. Les e-mails de service (billets, adhésion, missions) ne sont pas
                concernés.
              </p>
              <UnsubscribeForm refToken={ref} />
            </>
          )}
        </Panel>
      </div>
    </AppPublicShell>
  );
}
