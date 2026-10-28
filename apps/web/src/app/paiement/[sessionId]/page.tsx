import { Alert } from "@kroov/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fakeProvider } from "@/lib/ticketing";
import { FakeCheckout } from "./fake-checkout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Paiement (simulation)", robots: { index: false } };

/**
 * Page de paiement du fournisseur SIMULÉ (développement / test uniquement — 404 ailleurs).
 * Elle tient le rôle de la page hébergée du prestataire : aucune donnée de carte n'est saisie,
 * et c'est un webhook signé — pas la redirection — qui confirme la commande.
 */
export default async function FakePaymentPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const provider = fakeProvider();
  const session = provider?.sessions.get(sessionId);
  if (!provider || !session) notFound();
  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-gutter-mobile py-10">
      <p className="text-eyebrow font-extrabold uppercase text-muted">Prestataire de paiement · simulation</p>
      <h1 className="mt-2 text-[28px] font-black leading-[1.05] tracking-[-1px]">Page de paiement simulée</h1>
      <Alert tone="info" className="mt-4">
        Environnement de démonstration : aucune carte n'est demandée. Choisissez l'issue du paiement comme le ferait
        votre banque.
      </Alert>
      <FakeCheckout
        sessionId={session.id}
        orderNumber={session.orderNumber}
        amountMinor={session.amountMinor}
        currency={session.currency}
        description={session.description}
        status={session.status}
        successUrl={session.successUrl}
        cancelUrl={session.cancelUrl}
      />
    </main>
  );
}
