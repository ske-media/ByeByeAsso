import { getEventBySlug } from "@kroov/domain/events";
import {
  formatDateFr,
  instantToWallClock,
  NotFoundError,
  wallClockDateString,
  wallClockTimeString,
} from "@kroov/domain/kernel";
import { getTicketingSettings, listPools, listPromoCodes, listTicketTypes, unitFee } from "@kroov/domain/ticketing";
import { Alert, Button, ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { ticketingContext } from "@/lib/ticketing";
import { PoolsPanel, PromoCodesPanel, SalesSettingsForm, SalesStatusControl } from "./settings-panels";
import { TicketTypesPanel } from "./ticket-types-panel";

export const metadata: Metadata = { title: "Billets" };

function wall(d: Date | null, tz: string): { date: string; time: string } | null {
  if (!d) return null;
  const w = instantToWallClock(d, tz);
  return { date: wallClockDateString(w), time: wallClockTimeString(w) };
}

/** Écran 06 — Configuration des billets : tarifs, pools, codes promo, paramètres de vente, ouverture. */
export default async function TicketsConfigPage({ params }: { params: Promise<{ slug: string; eventSlug: string }> }) {
  const { slug, eventSlug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}/billets`);
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), ctx.session.actor, ctx.organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canManage = ctx.can("tickets.manage", event.id);
  if (!ctx.can("events.read", event.id)) {
    return (
      <>
        <PageHeader eyebrow="Billetterie" title={event.title} />
        <ForbiddenState description="La configuration des billets est réservée aux responsables billetterie et événement." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const [types, pools, settings, codes] = await Promise.all([
    listTicketTypes(db(), actor, ctx.organization.id, event.id),
    listPools(db(), actor, ctx.organization.id, event.id),
    getTicketingSettings(db(), actor, ctx.organization.id, event.id),
    canManage ? listPromoCodes(db(), actor, ctx.organization.id, event.id) : Promise.resolve([]),
  ]);
  const tz = event.timezone;
  const quotaSum = types.filter((t) => t.status === "active").reduce((a, t) => a + (t.quota ?? 0), 0);
  const unbounded = types.some((t) => t.status === "active" && t.quota === null);
  const blockers: string[] = [];
  if (types.filter((t) => t.status === "active").length === 0) blockers.push("Ajoutez au moins un tarif.");
  if (event.status !== "published") blockers.push("Publiez l'événement.");
  const fees = ticketingContext().fees;
  const samplePaid = types.find((t) => t.status === "active" && t.priceMinor > 0) ?? null;
  const panelCtx = {
    organizationId: ctx.organization.id,
    slug,
    eventId: event.id,
    eventSlug: event.slug,
    timezone: tz,
    currency: settings.currency,
    canManage,
  };
  const salesLabel = (t: (typeof types)[number]) => {
    if (t.salesStartAt && t.salesEndAt)
      return `Du ${formatDateFr(t.salesStartAt, tz)} au ${formatDateFr(t.salesEndAt, tz)}`;
    if (t.salesStartAt) return `À partir du ${formatDateFr(t.salesStartAt, tz)}`;
    if (t.salesEndAt) return `Jusqu'au ${formatDateFr(t.salesEndAt, tz)}`;
    return "Dès l'ouverture";
  };

  return (
    <>
      <PageHeader
        eyebrow={`${event.title} · Billets`}
        title="À chacun son billet."
        description={
          event.capacity > 0
            ? `La capacité totale reste limitée à ${event.capacity} personnes.`
            : "Définissez une capacité sur l'événement pour borner les ventes."
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/o/${slug}/evenements/${event.slug}`}>← Piloter l'événement</Link>
          </Button>
        }
      />
      {event.status !== "published" ? (
        <Alert tone="info" className="mb-5">
          L'événement est en « {event.status === "draft" ? "brouillon" : event.status} » : vous pouvez préparer les
          tarifs, les ventes s'ouvriront après publication.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Tarifs</PanelTitle>
            <TicketTypesPanel
              ctx={panelCtx}
              pools={pools.map((p) => ({ id: p.id, name: p.name, capacity: p.capacity }))}
              types={types.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                priceMinor: t.priceMinor,
                currency: t.currency,
                quota: t.quota,
                salesStart: wall(t.salesStartAt, tz),
                salesEnd: wall(t.salesEndAt, tz),
                salesLabel: salesLabel(t),
                minPerOrder: t.minPerOrder,
                maxPerOrder: t.maxPerOrder,
                hidden: t.hidden,
                membersOnly: t.membersOnly,
                position: t.position,
                status: t.status,
                poolId: t.poolId,
                poolName: t.poolName,
                sold: t.sold,
                held: t.held,
                available: t.available,
              }))}
            />
          </Panel>
          <Panel>
            <PanelTitle>Pools de capacité partagée</PanelTitle>
            <PoolsPanel ctx={panelCtx} pools={pools} />
          </Panel>
          {canManage ? (
            <Panel>
              <PanelTitle>Codes promo</PanelTitle>
              <PromoCodesPanel
                ctx={panelCtx}
                codes={codes.map((c) => ({
                  id: c.id,
                  code: c.code,
                  kind: c.kind,
                  value: c.value,
                  maxRedemptions: c.maxRedemptions,
                  redemptions: c.redemptions,
                  active: c.active,
                  validity: c.validUntil ? `Valable jusqu'au ${formatDateFr(c.validUntil, tz)}` : "Sans date limite",
                }))}
              />
            </Panel>
          ) : null}
        </div>
        <div className="space-y-5">
          <Panel className="bg-lavender">
            <PanelTitle>Ouverture des ventes</PanelTitle>
            <SalesStatusControl
              ctx={panelCtx}
              status={settings.ticketingStatus}
              canOpen={blockers.length === 0}
              blockers={blockers}
            />
          </Panel>
          <Panel>
            <PanelTitle>Paramètres de vente</PanelTitle>
            <SalesSettingsForm
              ctx={panelCtx}
              initial={{
                maxTicketsPerOrder: settings.maxTicketsPerOrder,
                salesClose: wall(settings.salesCloseAt, tz),
                nominativeTickets: settings.nominativeTickets,
              }}
            />
          </Panel>
          <Panel>
            <PanelTitle>Récapitulatif</PanelTitle>
            <dl className="m-0 divide-y divide-border text-[13px]">
              <div className="flex justify-between py-2">
                <dt>Capacité événement</dt>
                <dd className="m-0 font-bold">{event.capacity > 0 ? `${event.capacity} places` : "non définie"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt>Somme des quotas</dt>
                <dd className="m-0 font-bold">{unbounded ? `${quotaSum} + illimité` : `${quotaSum} billets`}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt>Frais acheteur</dt>
                <dd className="m-0 font-bold">
                  {samplePaid
                    ? `${fmtMinor(unitFee(samplePaid.priceMinor, fees), settings.currency)} par billet à ${fmtMinor(samplePaid.priceMinor, settings.currency)}`
                    : "aucun sur les billets gratuits"}
                </dd>
              </div>
            </dl>
            <p
              className={`mt-3 rounded-[9px] px-3 py-2 text-[12px] ${event.capacity > 0 && !unbounded && quotaSum > event.capacity ? "bg-orange" : "bg-lime"}`}
            >
              {event.capacity === 0
                ? "Sans capacité, seuls les quotas et pools bornent les ventes."
                : unbounded || quotaSum <= event.capacity
                  ? "✓ Les quotas respectent la capacité de l'événement."
                  : "La somme des quotas dépasse la capacité : la capacité l'emporte, les derniers tarifs seront épuisés plus tôt."}
            </p>
            <p className="mt-2 text-[12px] text-muted">
              Les frais acheteur sont annoncés avant le paiement et encaissés par la plateforme ; les billets gratuits
              n'en portent aucun.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
