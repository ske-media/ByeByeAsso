import { formatDateFr, formatTimeFr, NotFoundError } from "@kroov/domain/kernel";
import { getOrderForBuyer, TICKET_STATUS_LABELS } from "@kroov/domain/ticketing";
import { Alert, Badge, Button, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { ticketingContext } from "@/lib/ticketing";
import { StatusPoller } from "./status-poller";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmation de commande", robots: { index: false } };

/** Écran 31 — C'est dans la poche ! (ou attente du webhook, ou échec → retour au réessai). */
export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { orderId } = await params;
  const { k } = await searchParams;
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
  if (order.status === "failed" || order.status === "expired" || order.status === "reserved") {
    redirect(`/commande/${order.id}?k=${encodeURIComponent(token)}`);
  }
  const paid = ["paid", "partially_refunded", "refunded"].includes(order.status);
  const live = order.tickets.filter((t) => t.status === "valid" || t.status === "used");
  const eventUrl = `/${order.organizationSlug}/${order.event.slug}`;

  return (
    <AppPublicShell back={{ href: eventUrl, label: "Retour à l'événement" }}>
      <div className="py-6">
        {!paid ? (
          <>
            <p className="text-eyebrow font-extrabold uppercase text-muted">Commande {order.number}</p>
            <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Un instant…</h1>
            <p className="mt-2 text-[13px] text-muted">
              Nous attendons la confirmation du prestataire de paiement. Vos billets ne sont émis qu'à ce moment-là.
            </p>
            <div className="mt-4">
              <StatusPoller orderId={order.id} accessToken={token} status={order.status} />
            </div>
          </>
        ) : (
          <>
            <p
              className="flex size-16 items-center justify-center rounded-full border-2 border-ink bg-lime text-[28px] font-black"
              aria-hidden="true"
            >
              ✓
            </p>
            <p className="mt-4 text-eyebrow font-extrabold uppercase text-muted">Commande {order.number}</p>
            <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
              C'est dans
              <br />
              la poche !
            </h1>
            <p className="mt-2 text-[13px]">
              {live.length > 0 ? (
                <>
                  {live.length > 1 ? `Vos ${live.length} billets ont été envoyés` : "Votre billet a été envoyé"} à{" "}
                  <b>{order.buyer.email}</b>.
                </>
              ) : (
                "Cette commande a été remboursée : aucun billet n'est actif."
              )}
            </p>
            {order.status !== "paid" ? (
              <Alert tone="info" className="mt-3">
                {order.status === "refunded"
                  ? "Commande intégralement remboursée."
                  : "Une partie de cette commande a été remboursée."}
              </Alert>
            ) : null}
            <Panel className="mt-4">
              <b>{order.event.title}</b>
              <dl className="m-0 mt-2 divide-y divide-border text-[13px]">
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Date</dt>
                  <dd className="m-0 font-bold">
                    {formatDateFr(order.event.startsAt, order.event.timezone)} ·{" "}
                    {formatTimeFr(order.event.startsAt, order.event.timezone)}
                  </dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Lieu</dt>
                  <dd className="m-0 font-bold">
                    {order.event.locationName
                      ? `${order.event.locationName}${order.event.city ? ` · ${order.event.city}` : ""}`
                      : "À confirmer"}
                  </dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Total payé</dt>
                  <dd className="m-0 font-bold">
                    {order.totalMinor === 0 ? "Gratuit" : fmtMinor(order.totalMinor, order.currency)}
                  </dd>
                </div>
              </dl>
            </Panel>
            {live.length > 0 ? (
              <ul className="m-0 mt-4 list-none space-y-2 p-0">
                {live.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/billets/${order.ticketLinks[t.id] ?? ""}`}
                      className="flex items-center justify-between gap-3 rounded-[9px] border-[1.5px] border-ink bg-lime px-4 py-3 text-[13px] font-bold"
                    >
                      <span>
                        {t.number} · {t.attendeeName ?? t.typeLabel}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={t.status === "valid" ? "outline" : "neutral"} noDot>
                          {TICKET_STATUS_LABELS[t.status]}
                        </Badge>
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {!session ? (
              <Panel className="mt-4 bg-pink">
                <b>Gardez la nuit à portée de main.</b>
                <p className="mt-1 text-[13px]">
                  Créez un compte avec votre adresse d'achat pour retrouver vos billets et vos adhésions.
                </p>
                <Button asChild variant="secondary" className="mt-3">
                  <Link href={`/inscription?next=${encodeURIComponent("/moi/billets")}`}>Créer mon compte →</Link>
                </Button>
              </Panel>
            ) : (
              <p className="mt-4 text-[13px]">
                <Link href="/moi/billets" className="font-bold underline underline-offset-4">
                  Voir tous mes billets →
                </Link>
              </p>
            )}
            <p className="mt-4 text-center text-[11px] text-muted">
              Une question ? Contactez l'organisateur : {order.organizationName}.
            </p>
          </>
        )}
      </div>
    </AppPublicShell>
  );
}
