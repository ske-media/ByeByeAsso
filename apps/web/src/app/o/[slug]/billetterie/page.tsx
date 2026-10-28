import { listEvents } from "@kroov/domain/events";
import { formatDateFr } from "@kroov/domain/kernel";
import {
  listOrders,
  listTickets,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  TICKET_STATUS_LABELS,
  ticketingStats,
} from "@kroov/domain/ticketing";
import {
  Badge,
  Button,
  EmptyState,
  ForbiddenState,
  PageHeader,
  Panel,
  PanelTitle,
  Person,
  Stat,
  StatGrid,
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
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { OrdersFilters } from "./filters";

export const metadata: Metadata = { title: "Billetterie" };

const STATUS_TONE: Record<OrderStatus, "lime" | "orange" | "neutral" | "error" | "lavender"> = {
  draft: "neutral",
  reserved: "orange",
  awaiting_payment: "orange",
  paid: "lime",
  failed: "error",
  expired: "neutral",
  partially_refunded: "lavender",
  refunded: "lavender",
};

/** Écran 09 — Commandes : indicateurs réels, sélecteur d'événement, recherche, filtre, export. */
export default async function TicketingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ evenement?: string; statut?: string; q?: string; onglet?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/billetterie`);
  const canRead = ctx.can("orders.read") || [...ctx.member.eventPermissions.values()].some((p) => p.has("orders.read"));
  if (!canRead) {
    return (
      <>
        <PageHeader eyebrow="Billetterie" title="Chaque place, chaque personne." />
        <ForbiddenState description="La lecture des commandes est réservée aux responsables billetterie, événement et aux administrateurs." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const events = await listEvents(db(), actor, ctx.organization.id, { status: "all" });
  const selectable = events.filter((e) => ctx.can("orders.read", e.id));
  const eventId = sp.evenement && selectable.some((e) => e.id === sp.evenement) ? sp.evenement : undefined;
  const status = (sp.statut ?? "all") as "all" | OrderStatus;
  const tab = sp.onglet === "participants" ? "participants" : "commandes";
  const [orders, stats, tickets] = await Promise.all([
    listOrders(db(), actor, ctx.organization.id, {
      ...(eventId ? { eventId } : {}),
      status: status === "draft" || status === "reserved" ? "all" : status,
      ...(sp.q ? { q: sp.q } : {}),
    }),
    ticketingStats(db(), actor, ctx.organization.id, eventId),
    tab === "participants" ? listTickets(db(), actor, ctx.organization.id, { eventId, q: sp.q }) : Promise.resolve([]),
  ]);
  const visible = eventId ? orders : orders.filter((o) => ctx.can("orders.read", o.eventId));
  const visibleTickets = eventId ? tickets : tickets.filter((t) => ctx.can("orders.read", t.eventId));
  const exportQuery = new URLSearchParams({
    ...(eventId ? { evenement: eventId } : {}),
    ...(sp.statut ? { statut: sp.statut } : {}),
    ...(sp.q ? { q: sp.q } : {}),
  }).toString();

  return (
    <>
      <PageHeader
        eyebrow="Billetterie"
        title="Chaque place, chaque personne."
        description={
          eventId ? (selectable.find((e) => e.id === eventId)?.title ?? "") : "Toutes les commandes de l'organisation."
        }
        actions={
          <Button asChild variant="secondary">
            <a href={`/o/${slug}/billetterie/export?${exportQuery}`}>Exporter CSV</a>
          </Button>
        }
      />
      <StatGrid>
        <Stat tone="lime" label="Billets payés" value={String(stats.paidTickets)} hint="Hors commandes en attente" />
        <Stat
          label="Recettes brutes"
          value={fmtMinor(stats.grossRevenueMinor, stats.currency)}
          hint="Hors frais acheteur"
        />
        <Stat
          tone="orange"
          label="Commandes à traiter"
          value={String(stats.pendingOrders)}
          hint="Paiement en attente"
        />
        <Stat
          tone="lavender"
          label="Remboursé"
          value={fmtMinor(stats.refundedMinor, stats.currency)}
          hint={`${stats.admitted} entrée(s) validée(s)`}
        />
      </StatGrid>

      <OrdersFilters
        slug={slug}
        events={selectable.map((e) => ({ id: e.id, title: e.title }))}
        eventId={eventId ?? ""}
        status={status}
        q={sp.q ?? ""}
        tab={tab}
      />

      <Panel>
        {tab === "commandes" ? (
          <>
            <PanelTitle>Dernières commandes</PanelTitle>
            {visible.length === 0 ? (
              <EmptyState
                title="Aucune commande"
                description={
                  sp.q || status !== "all"
                    ? "Aucune commande ne correspond à ce filtre."
                    : "Les commandes apparaîtront ici dès l'ouverture des ventes."
                }
              />
            ) : (
              <TableContainer label="Commandes" className="border-0 bg-transparent">
                <Table>
                  <THead>
                    <TR>
                      <TH>Commande</TH>
                      <TH>Acheteur</TH>
                      <TH>Billets</TH>
                      <TH>Total payé</TH>
                      <TH>Statut</TH>
                      <TH>
                        <span className="k-sr-only">Actions</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visible.map((o) => (
                      <TR key={o.id}>
                        <TD>
                          <b>{o.number}</b>
                          <span className="block text-[11px] text-muted">
                            {o.eventTitle} · {formatDateFr(o.createdAt, ctx.organization.timezone)}
                          </span>
                        </TD>
                        <TD>
                          <Person name={o.buyerName || "—"} secondary={o.buyerEmail} tone="lavender" />
                        </TD>
                        <TD>{o.ticketsSummary}</TD>
                        <TD>{fmtMinor(o.totalMinor, o.currency)}</TD>
                        <TD>
                          <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                        </TD>
                        <TD className="text-right">
                          <Link
                            href={`/o/${slug}/billetterie/commandes/${o.id}`}
                            className="font-bold underline underline-offset-4"
                          >
                            Voir →
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </>
        ) : (
          <>
            <PanelTitle>Participants</PanelTitle>
            {visibleTickets.length === 0 ? (
              <EmptyState
                title="Aucun billet émis"
                description="Les participants apparaissent dès qu'une commande est payée."
              />
            ) : (
              <TableContainer label="Participants" className="border-0 bg-transparent">
                <Table>
                  <THead>
                    <TR>
                      <TH>Billet</TH>
                      <TH>Participant</TH>
                      <TH>Tarif</TH>
                      <TH>Commande</TH>
                      <TH>État</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visibleTickets.map((t) => (
                      <TR key={t.id}>
                        <TD>
                          <b>{t.number}</b>
                          <span className="block text-[11px] text-muted">{t.eventTitle}</span>
                        </TD>
                        <TD>{t.attendeeName ?? "—"}</TD>
                        <TD>{t.typeLabel}</TD>
                        <TD>
                          <Link
                            href={`/o/${slug}/billetterie/commandes/${t.orderId}`}
                            className="font-bold underline underline-offset-4"
                          >
                            {t.orderNumber}
                          </Link>
                          <span className="block text-[11px] text-muted">{t.buyerEmail}</span>
                        </TD>
                        <TD>
                          <Badge tone={t.status === "valid" ? "lime" : t.status === "used" ? "neutral" : "lavender"}>
                            {TICKET_STATUS_LABELS[t.status]}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
