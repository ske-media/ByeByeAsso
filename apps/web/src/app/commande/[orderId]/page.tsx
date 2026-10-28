import { formatDateFr, NotFoundError } from "@kroov/domain/kernel";
import { getOrderForBuyer } from "@kroov/domain/ticketing";
import { Alert, Button, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { ticketingContext } from "@/lib/ticketing";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Votre commande", robots: { index: false } };

/** Écrans 29 (coordonnées), 33 (paiement refusé, réessai), 34 (réservation expirée). */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ k?: string; annule?: string }>;
}) {
  const { orderId } = await params;
  const { k, annule } = await searchParams;
  const session = await currentSession();
  let order: Awaited<ReturnType<typeof getOrderForBuyer>>;
  try {
    order = await getOrderForBuyer(db(), ticketingContext(), orderId, {
      accessToken: k ?? null,
      actor: session?.actor,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const token = k ?? order.accessToken;
  if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
    redirect(`/commande/${order.id}/confirmation?k=${encodeURIComponent(token)}`);
  }
  const eventUrl = `/${order.organizationSlug}/${order.event.slug}`;
  const expired = order.status === "expired" || (order.expiresAt !== null && order.expiresAt.getTime() <= Date.now());
  const pendingTickets = order.tickets.filter((t) => t.status === "pending");

  if (expired) {
    return (
      <AppPublicShell back={{ href: eventUrl, label: "Retour à l'événement" }}>
        <div className="py-6">
          <p
            className="flex size-14 items-center justify-center rounded-full border-2 border-ink bg-orange text-[24px]"
            aria-hidden="true"
          >
            ⏱
          </p>
          <p className="mt-4 text-eyebrow font-extrabold uppercase text-muted">Délai écoulé</p>
          <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
            Vos places ont
            <br />
            été libérées.
          </h1>
          <p className="mt-3 text-[13px] text-muted">
            La réservation de 10 minutes est terminée. Aucun paiement n'a été confirmé.
          </p>
          <Panel className="mt-4">
            <b>{order.event.title}</b>
            <p className="text-[13px] text-muted">
              {formatDateFr(order.event.startsAt, order.event.timezone)}
              {order.event.locationName ? ` · ${order.event.locationName}` : ""}
            </p>
            <p className="mt-2 text-[13px]">
              {order.items.map((i) => `${i.quantity} × ${i.label}`).join(", ")} ·{" "}
              {fmtMinor(order.totalMinor, order.currency)}
            </p>
            <p className="mt-1 text-[12px] text-muted">La disponibilité sera vérifiée à nouveau au moment du choix.</p>
          </Panel>
          <div className="mt-4 grid gap-2">
            <Button asChild variant="primary">
              <Link href={`${eventUrl}/billets`}>Vérifier les places disponibles →</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={eventUrl}>Retour à l'événement</Link>
            </Button>
          </div>
        </div>
      </AppPublicShell>
    );
  }

  const retry = order.status === "failed";
  return (
    <AppPublicShell back={{ href: `${eventUrl}/billets`, label: "Retour au choix des billets" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">
          {retry ? "Paiement non abouti" : "Étape 2 sur 3"}
        </p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          {retry ? "On réessaie ?" : "À quel nom ?"}
        </h1>
        {retry ? (
          <Alert tone="error" heading="Le paiement a été refusé." className="mt-4">
            Aucun billet n'a été émis. Vous ne serez pas débité pour cette tentative.
            {order.payment?.failureReason ? ` (${order.payment.failureReason})` : ""}
          </Alert>
        ) : null}
        {annule ? (
          <Alert tone="info" className="mt-4">
            Paiement interrompu. Vos places restent réservées jusqu'à la fin du délai.
          </Alert>
        ) : null}
        <div className="mt-4">
          <CheckoutForm
            accessToken={token}
            retry={retry}
            order={{
              id: order.id,
              number: order.number,
              status: order.status,
              expiresAt: order.expiresAt?.toISOString() ?? null,
              currency: order.currency,
              subtotalMinor: order.subtotalMinor,
              discountMinor: order.discountMinor,
              feesMinor: order.feesMinor,
              totalMinor: order.totalMinor,
              promoCode: order.promoCode,
              nominative: order.event.nominativeTickets,
              buyer: { email: order.buyer.email, firstName: order.buyer.firstName, lastName: order.buyer.lastName },
              items: order.items.map((i) => ({
                ticketTypeId: i.ticketTypeId,
                label: i.label,
                quantity: i.quantity,
                unitPriceMinor: i.unitPriceMinor,
              })),
              tickets: pendingTickets.map((t) => ({
                id: t.id,
                number: t.number,
                ticketTypeId: t.ticketTypeId,
                typeLabel: t.typeLabel,
                attendeeName: t.attendeeName,
              })),
              marketingOptIn: order.marketingOptIn,
              organizationName: order.organizationName,
            }}
          />
        </div>
        {retry ? (
          <p className="mt-4 text-[11px] text-muted">
            Si votre banque affiche une opération en attente, elle peut correspondre à une autorisation temporaire.
          </p>
        ) : null}
      </div>
    </AppPublicShell>
  );
}
