import { formatDateFr, formatTimeFr, NotFoundError } from "@kroov/domain/kernel";
import { allocateDiscount, getOrder, ORDER_STATUS_LABELS, TICKET_STATUS_LABELS } from "@kroov/domain/ticketing";
import {
  Badge,
  Button,
  PageHeader,
  Panel,
  PanelTitle,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { RefundPanel, ResendButton } from "./refund-panel";

export const metadata: Metadata = { title: "Commande" };

/** Écran 10 — Détail et remboursement. */
export default async function OrderDetailPage({ params }: { params: Promise<{ slug: string; orderId: string }> }) {
  const { slug, orderId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/billetterie/commandes/${orderId}`);
  let order: Awaited<ReturnType<typeof getOrder>>;
  try {
    order = await getOrder(db(), ctx.session.actor, ctx.organization.id, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const tz = order.event.timezone;
  const canRefund = ctx.can("orders.refund", order.event.id);
  const live = order.tickets.filter((t) => t.status === "valid" || t.status === "used");
  const priced = order.tickets.filter((t) => t.status !== "revoked" && t.status !== "pending");
  const shares = allocateDiscount(
    priced.map((t) => t.priceMinor),
    order.discountMinor,
  );
  const shareOf = new Map(priced.map((t, i) => [t.id, shares[i] ?? 0]));
  const refundable = live.map((t) => ({
    id: t.id,
    number: t.number,
    attendeeName: t.attendeeName,
    typeLabel: t.typeLabel,
    amountMinor: t.priceMinor - (shareOf.get(t.id) ?? 0) + t.feeMinor,
    status: t.status as "valid" | "used",
  }));
  const refundableMinor = refundable.reduce((a, t) => a + t.amountMinor, 0);
  const buyerName = [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(" ") || order.buyer.email;
  const tone =
    order.status === "paid"
      ? "lime"
      : order.status === "failed"
        ? "error"
        : order.status.includes("refund")
          ? "lavender"
          : order.status === "expired"
            ? "neutral"
            : "orange";

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href={`/o/${slug}/billetterie`} className="underline underline-offset-4">
              Billetterie
            </Link>{" "}
            / Commande {order.number}
          </>
        }
        title={`La commande de ${order.buyer.firstName ?? buyerName}.`}
        description={
          <>
            {formatDateFr(order.createdAt, tz)} · {formatTimeFr(order.createdAt, tz)} ·{" "}
            <Badge tone={tone}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          </>
        }
        actions={
          ["paid", "partially_refunded"].includes(order.status) ? (
            <ResendButton organizationId={ctx.organization.id} slug={slug} orderId={order.id} />
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>
              {order.tickets.length} billet{order.tickets.length > 1 ? "s" : ""} · {order.event.title}
            </PanelTitle>
            <TableContainer label="Billets de la commande" className="border-0 bg-transparent">
              <Table>
                <THead>
                  <TR>
                    <TH>Billet</TH>
                    <TH>Participant</TH>
                    <TH>Tarif</TH>
                    <TH>Prix</TH>
                    <TH>État</TH>
                  </TR>
                </THead>
                <TBody>
                  {order.tickets.map((t) => (
                    <TR key={t.id}>
                      <TD>
                        <b>{t.number}</b>
                      </TD>
                      <TD>{t.attendeeName ?? "—"}</TD>
                      <TD>{t.typeLabel}</TD>
                      <TD>{fmtMinor(t.priceMinor, order.currency)}</TD>
                      <TD>
                        <Badge
                          tone={
                            t.status === "valid"
                              ? "lime"
                              : t.status === "used"
                                ? "neutral"
                                : t.status === "refunded"
                                  ? "lavender"
                                  : "orange"
                          }
                        >
                          {TICKET_STATUS_LABELS[t.status]}
                        </Badge>
                        {t.usedAt ? (
                          <span className="block text-[11px] text-muted">Entrée {formatTimeFr(t.usedAt, tz)}</span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <p className="mt-2 text-[12px] text-muted">
              Acheteur : {buyerName} · {order.buyer.email}
              {order.marketingOptIn ? " · accepte les actualités" : ""}
            </p>
          </Panel>
          <Panel>
            <PanelTitle>Paiement</PanelTitle>
            <dl className="m-0 divide-y divide-border text-[13px]">
              <div className="flex justify-between py-2">
                <dt>{order.items.map((i) => `${i.quantity} × ${i.label}`).join(", ")}</dt>
                <dd className="m-0">{fmtMinor(order.subtotalMinor, order.currency)}</dd>
              </div>
              {order.discountMinor > 0 ? (
                <div className="flex justify-between py-2">
                  <dt>Remise{order.promoCode ? ` (${order.promoCode})` : ""}</dt>
                  <dd className="m-0">−{fmtMinor(order.discountMinor, order.currency)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between py-2">
                <dt>Frais acheteur</dt>
                <dd className="m-0">{fmtMinor(order.feesMinor, order.currency)}</dd>
              </div>
              <div className="flex justify-between py-2 font-bold">
                <dt>Total encaissé</dt>
                <dd className="m-0">{fmtMinor(order.totalMinor, order.currency)}</dd>
              </div>
              {order.payment ? (
                <>
                  <div className="flex justify-between py-2">
                    <dt>Moyen de paiement</dt>
                    <dd className="m-0">
                      {order.payment.methodLabel ?? `${order.payment.provider} · ${order.payment.status}`}
                    </dd>
                  </div>
                  {order.payment.refundedMinor > 0 ? (
                    <div className="flex justify-between py-2">
                      <dt>Déjà remboursé</dt>
                      <dd className="m-0">{fmtMinor(order.payment.refundedMinor, order.currency)}</dd>
                    </div>
                  ) : null}
                  {order.payment.failureReason ? (
                    <div className="flex justify-between py-2 text-error-text">
                      <dt>Dernier refus</dt>
                      <dd className="m-0">{order.payment.failureReason}</dd>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex justify-between py-2">
                  <dt>Moyen de paiement</dt>
                  <dd className="m-0">{order.totalMinor === 0 ? "Gratuit" : "Aucun paiement engagé"}</dd>
                </div>
              )}
            </dl>
          </Panel>
          <Panel>
            <PanelTitle>Historique</PanelTitle>
            <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
              {order.history.map((h) => (
                <li key={`${h.at.toISOString()}-${h.label}`} className="flex justify-between gap-4 py-2">
                  <span className="text-muted">
                    {formatDateFr(h.at, tz)} · {formatTimeFr(h.at, tz)}
                  </span>
                  <span className="text-right">{h.label}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Rembourser la commande</PanelTitle>
            {["paid", "partially_refunded"].includes(order.status) ? (
              <RefundPanel
                organizationId={ctx.organization.id}
                slug={slug}
                orderId={order.id}
                currency={order.currency}
                tickets={refundable}
                refundableMinor={refundableMinor}
                canRefund={canRefund}
              />
            ) : (
              <p className="text-[13px] text-muted">
                {order.status === "refunded"
                  ? "Cette commande a été intégralement remboursée."
                  : "Seule une commande payée peut être remboursée."}
              </p>
            )}
            {order.refunds.length > 0 ? (
              <ul className="m-0 mt-4 list-none divide-y divide-border p-0 text-[12px]">
                {order.refunds.map((r) => (
                  <li key={r.id} className="py-2">
                    <b>{fmtMinor(r.amountMinor, order.currency)}</b> ·{" "}
                    {r.status === "succeeded" ? "effectué" : r.status === "failed" ? "échoué" : "en cours"} · {r.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <Panel>
            <PanelTitle>Événement</PanelTitle>
            <p className="text-[13px]">
              <b>{order.event.title}</b>
              <span className="block text-muted">{formatDateFr(order.event.startsAt, tz)}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/o/${slug}/evenements/${order.event.slug}`}>Piloter</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/o/${slug}/billetterie?evenement=${order.event.id}`}>Toutes les commandes</Link>
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
