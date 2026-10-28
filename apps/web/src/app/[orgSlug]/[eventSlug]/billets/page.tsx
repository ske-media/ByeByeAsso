import { getPublicEvent } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr, NotFoundError } from "@kroov/domain/kernel";
import { getPublicTicketing } from "@kroov/domain/ticketing";
import { Alert, Button } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";
import { TicketSelector } from "./ticket-selector";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  try {
    const event = await getPublicEvent(db(), orgSlug, eventSlug);
    return { title: `Billets · ${event.title}`, robots: { index: false } };
  } catch {
    return { title: "Événement introuvable" };
  }
}

/** Écran 28 — Vos places pour la nuit. */
export default async function PublicTicketsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  let event: Awaited<ReturnType<typeof getPublicEvent>>;
  try {
    event = await getPublicEvent(db(), orgSlug, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const ticketing = await getPublicTicketing(db(), event.organization.id, event.id, ticketingContext().fees);
  return (
    <AppPublicShell back={{ href: `/${orgSlug}/${eventSlug}`, label: "Retour à l'événement" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{event.organization.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          Vos places
          <br />
          pour la nuit.
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          {event.title} · {formatRangeFr(event.startsAt, event.endsAt, event.timezone)}
        </p>
        <p className="mt-3 text-[12px] text-muted">1. Billets → 2. Coordonnées → 3. Paiement</p>
        <div className="mt-5">
          {!ticketing.open || event.status !== "published" ? (
            <>
              <Alert tone="info" heading="Billetterie fermée">
                {ticketing.closedReason ?? "Cet événement n'est pas ouvert à la vente."}
              </Alert>
              <div className="mt-4">
                <Button asChild variant="secondary">
                  <Link href={`/${orgSlug}/${eventSlug}`}>Retour à l'événement</Link>
                </Button>
              </div>
            </>
          ) : ticketing.types.length === 0 ? (
            <Alert tone="info" heading="Aucun tarif disponible">
              L'organisation n'a pas encore mis de billets en vente.
            </Alert>
          ) : (
            <TicketSelector
              organizationSlug={orgSlug}
              eventSlug={eventSlug}
              currency={ticketing.currency}
              maxTicketsPerOrder={ticketing.maxTicketsPerOrder}
              types={ticketing.types.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                priceMinor: t.priceMinor,
                unitFeeMinor: t.unitFeeMinor,
                minPerOrder: t.minPerOrder,
                maxPerOrder: t.maxPerOrder,
                available: t.available,
                saleState: t.saleState,
                salesStartLabel: t.salesStartAt ? formatDateFr(t.salesStartAt, event.timezone) : null,
              }))}
            />
          )}
        </div>
      </div>
    </AppPublicShell>
  );
}
