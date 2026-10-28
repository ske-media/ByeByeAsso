import { eventDashboard } from "@kroov/domain/analytics";
import { EVENT_STATUS_LABELS, getEventBySlug, publicationChecklist } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr, NotFoundError } from "@kroov/domain/kernel";
import { listAssignableMembers, listTasks } from "@kroov/domain/tasks";
import { getTicketingSettings, ticketingStats } from "@kroov/domain/ticketing";
import { applicationStats, getVolunteering } from "@kroov/domain/volunteers";
import { Alert, Badge, Button, EventPoster, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { toTaskRow } from "@/lib/tasks";
import { NewTaskButton, type TaskCtx, TaskList } from "../../taches/tasks-panel";
import { CopyLink, EventLifecycleActions } from "./actions-panel";

export const metadata: Metadata = { title: "Piloter l'événement" };

/** Écran 08 — Piloter un événement. */
export default async function EventPilotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
  searchParams: Promise<{ publie?: string; enregistre?: string }>;
}) {
  const { slug, eventSlug } = await params;
  const { publie, enregistre } = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements/${eventSlug}`);
  let event: Awaited<ReturnType<typeof getEventBySlug>>;
  try {
    event = await getEventBySlug(db(), ctx.session.actor, ctx.organization.id, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p, event.id);
  const canAnalytics = ctx.can("analytics.read") || can("events.read");
  const canReadOrg = ctx.can("organization.read");
  const canManageTasks = ctx.can("tasks.manage");
  const [stats, ticketing, volunteering, volunteerStats, dashboard, tasks, members] = await Promise.all([
    can("orders.read") ? ticketingStats(db(), ctx.session.actor, ctx.organization.id, event.id) : Promise.resolve(null),
    getTicketingSettings(db(), ctx.session.actor, ctx.organization.id, event.id),
    can("volunteers.review")
      ? getVolunteering(db(), ctx.session.actor, ctx.organization.id, event.id)
      : Promise.resolve(null),
    can("volunteers.review")
      ? applicationStats(db(), ctx.session.actor, ctx.organization.id, event.id)
      : Promise.resolve(null),
    canAnalytics ? eventDashboard(db(), ctx.session.actor, ctx.organization.id, event.id) : Promise.resolve(null),
    canReadOrg
      ? listTasks(db(), ctx.session.actor, ctx.organization.id, { status: "open", eventId: event.id, pageSize: 20 })
      : Promise.resolve(null),
    canManageTasks ? listAssignableMembers(db(), ctx.session.actor, ctx.organization.id) : Promise.resolve([]),
  ]);
  const taskCtx: TaskCtx | null = tasks
    ? {
        organizationId: ctx.organization.id,
        slug,
        canManage: canManageTasks,
        members: members.map((m) => ({ memberId: m.memberId, name: m.name })),
        events: [{ id: event.id, title: event.title, slug: event.slug }],
        eventId: event.id,
        eventSlug: event.slug,
      }
    : null;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const checklist = publicationChecklist(event);
  const missing = checklist.filter((c) => !c.ok);
  const publicUrl = `${env().APP_URL}/${ctx.organization.slug}/${event.slug}`;
  // The public page serves published, cancelled (with the notice) and completed events.
  const publicOnline =
    event.visibility !== "private" &&
    (event.status === "published" || event.status === "cancelled" || event.status === "completed");
  const statusTone = {
    draft: "neutral",
    published: "lime",
    suspended: "orange",
    completed: "lavender",
    cancelled: "error",
    archived: "neutral",
  } as const;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            Événement · <Badge tone={statusTone[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Badge>
          </>
        }
        title={event.title}
        description={formatRangeFr(event.startsAt, event.endsAt, event.timezone)}
        actions={
          <>
            {can("events.update") && event.status !== "archived" ? (
              <Button asChild variant="secondary">
                <Link href={`/o/${slug}/evenements/${event.slug}/modifier`}>Modifier</Link>
              </Button>
            ) : null}
            {event.status === "draft" && can("events.publish") ? (
              <Button asChild variant="primary">
                <Link href={`/o/${slug}/evenements/${event.slug}/publier`}>Publier →</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {publie ? (
        <Alert tone="success" heading="Événement publié" className="mb-5">
          Sa page publique est en ligne. Partagez le lien ci-dessous.
        </Alert>
      ) : null}
      {enregistre ? (
        <Alert tone="success" className="mb-5">
          Modifications enregistrées.
        </Alert>
      ) : null}
      {event.status === "cancelled" ? (
        <Alert tone="error" heading="Événement annulé" className="mb-5">
          Motif : « {event.cancellationReason} ». La page publique affiche l'annulation.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <EventPoster
              organizationName={ctx.organization.name}
              title={event.title}
              dateLabel={formatDateFr(event.startsAt, event.timezone)}
              placeLabel={event.location ? `${event.location.city} · ${event.location.name}` : undefined}
            />
            <StatGrid className="mt-5 sm:grid-cols-3 xl:grid-cols-3">
              <Stat
                label="Capacité"
                value={event.capacity > 0 ? String(event.capacity) : "—"}
                hint={event.capacity > 0 ? "places au total" : "à définir"}
              />
              <Stat
                label="Lieu"
                value={event.location ? event.location.city : "—"}
                hint={event.location?.name ?? "à définir"}
              />
              <Stat
                label="Visibilité"
                value={
                  event.visibility === "public" ? "Public" : event.visibility === "unlisted" ? "Lien direct" : "Privé"
                }
                hint={publicOnline ? "page en ligne" : "page hors ligne"}
              />
            </StatGrid>
          </Panel>

          <Panel>
            <PanelTitle>Page publique</PanelTitle>
            {publicOnline ? (
              <CopyLink url={publicUrl} />
            ) : event.status === "draft" ? (
              <p className="text-[13px] text-muted">
                Adresse réservée : <code className="rounded bg-neutral px-1">{publicUrl}</code>. Elle sera active à la
                publication.
              </p>
            ) : (
              <p className="text-[13px] text-muted">
                Page hors ligne ({event.visibility === "private" ? "événement privé" : "événement non publié"}).
              </p>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Billetterie</PanelTitle>
            {stats ? (
              <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
                <Stat
                  tone="lime"
                  label="Billets payés"
                  value={String(stats.paidTickets)}
                  hint={`${stats.admitted} entrée(s) validée(s)`}
                />
                <Stat
                  label="Recettes brutes"
                  value={fmtMinor(stats.grossRevenueMinor, stats.currency)}
                  hint="hors frais acheteur"
                />
                <Stat
                  tone={stats.pendingOrders > 0 ? "orange" : "surface"}
                  label="En attente"
                  value={String(stats.pendingOrders)}
                  hint="commandes à payer"
                />
              </StatGrid>
            ) : null}
            <p className="mt-3 text-[13px]">
              Ventes :{" "}
              <b>
                {ticketing.ticketingStatus === "open"
                  ? "ouvertes"
                  : ticketing.ticketingStatus === "closed"
                    ? "closes"
                    : "non configurées"}
              </b>
              {ticketing.nominativeTickets ? " · billets nominatifs" : ""} · {ticketing.maxTicketsPerOrder} billets max.
              par commande
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {can("events.read") ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/o/${slug}/evenements/${event.slug}/billets`}>Configurer les billets</Link>
                </Button>
              ) : null}
              {can("orders.read") ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/o/${slug}/billetterie?evenement=${event.id}`}>Commandes</Link>
                </Button>
              ) : null}
              {can("checkins.scan") ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/controle/${slug}/${event.slug}`}>Contrôle d'accès ↗</Link>
                </Button>
              ) : null}
            </div>
          </Panel>
          {volunteering && volunteerStats ? (
            <Panel>
              <PanelTitle>Équipe bénévole</PanelTitle>
              <StatGrid className="mt-2">
                <Stat
                  tone="lime"
                  label="Personnes acceptées"
                  value={String(volunteerStats.approved)}
                  unit={volunteering.targetCount > 0 ? `/ ${volunteering.targetCount}` : undefined}
                  hint="objectif"
                />
                <Stat tone="orange" label="À examiner" value={String(volunteerStats.toReview)} hint="candidatures" />
                <Stat
                  label="Affectations à couvrir"
                  value={String(volunteering.requiredTotal)}
                  hint="effectifs requis des créneaux"
                />
              </StatGrid>
              <p className="mt-3 text-[13px]">
                Recrutement : <b>{volunteering.recruitmentStatus === "open" ? "ouvert" : "fermé"}</b> ·{" "}
                {volunteering.positions.filter((p) => p.status === "active").length} poste(s) activé(s). Le planning se
                propose, s'arbitre et se publie depuis sa page.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/o/${slug}/evenements/${event.slug}/benevoles`}>Postes et besoins</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/o/${slug}/benevoles?evenement=${event.id}`}>Candidatures</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/o/${slug}/evenements/${event.slug}/planning`}>Planning</Link>
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel>
              <PanelTitle>Prochaines étapes</PanelTitle>
              <ul className="m-0 list-none space-y-2 p-0 text-[13px]">
                <li className="text-muted">
                  <b className="text-ink">Planning bénévole</b> — accessible aux responsables bénévoles depuis la page
                  Planning.
                </li>
              </ul>
            </Panel>
          )}

          {dashboard ? (
            <Panel>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <PanelTitle className="mb-0">Chiffres</PanelTitle>
                <Button asChild size="sm" variant="secondary">
                  <a href={`/api/v1/organizations/${ctx.organization.id}/events/${event.id}/report/export`}>
                    Rapport (CSV)
                  </a>
                </Button>
              </div>
              <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
                <Stat
                  tone="lime"
                  label="Remplissage"
                  value={pct(dashboard.ticketing.occupancyRate)}
                  hint={`${dashboard.ticketing.ticketsSold} billet(s) sur ${dashboard.capacity} place(s)`}
                />
                <Stat
                  tone="pink"
                  label="Brut billetterie"
                  value={fmtMinor(dashboard.ticketing.gross.amountMinor, dashboard.currency)}
                  hint={`${fmtMinor(dashboard.ticketing.refunds.amountMinor, dashboard.currency)} remboursé(s) · ${dashboard.ticketing.paidOrders} commande(s)`}
                />
                <Stat
                  tone="lavender"
                  label="Net estimé"
                  value={fmtMinor(dashboard.ticketing.netEstimate.amountMinor, dashboard.currency)}
                  hint="hors frais du prestataire et versements"
                />
                <Stat
                  label="Contrôles d'accès"
                  value={String(dashboard.checkins.accepted)}
                  hint={`${dashboard.checkins.refused} refusé(s) · ${dashboard.checkins.alreadyUsed} déjà utilisé(s)`}
                />
                <Stat
                  tone="orange"
                  label="Couverture bénévole"
                  value={pct(dashboard.volunteers.coverageRate)}
                  hint={
                    dashboard.volunteers.publishedVersion
                      ? `${dashboard.volunteers.shiftsCovered}/${dashboard.volunteers.shiftsRequired} places · ${dashboard.volunteers.unfilledShifts.length} créneau(x) non pourvu(s)`
                      : "Aucune version publiée du planning"
                  }
                />
                <Stat
                  label="Attribué aux campagnes"
                  value={String(dashboard.campaigns.attributedPaidOrders)}
                  hint={`commande(s) payée(s) · ${fmtMinor(dashboard.campaigns.attributedRevenue.amountMinor, dashboard.currency)}`}
                />
              </StatGrid>
              {dashboard.ticketing.byType.length > 0 ? (
                <ul className="mt-3 m-0 list-none divide-y divide-border p-0 text-[13px]">
                  {dashboard.ticketing.byType.map((t) => (
                    <li key={t.name} className="flex items-center justify-between gap-3 py-2">
                      <span>{t.name}</span>
                      <span className="k-tabular text-muted">
                        {t.sold}
                        {t.quota !== null ? ` / ${t.quota}` : ""} · {fmtMinor(t.grossMinor, dashboard.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-[12px] text-muted">
                Sources : billets, commandes, contrôles, grand livre, planning publié, attribution des commandes. Aucune
                valeur estimée hors « net estimé ».
              </p>
            </Panel>
          ) : null}

          {taskCtx && tasks ? (
            <Panel>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <PanelTitle className="mb-0">Tâches ({tasks.counts.open > 0 ? tasks.items.length : 0})</PanelTitle>
                <NewTaskButton ctx={taskCtx} label="+ Tâche" />
              </div>
              <TaskList
                ctx={taskCtx}
                tasks={tasks.items.map(toTaskRow)}
                emptyTitle="Aucune tâche ouverte pour cet événement"
              />
            </Panel>
          ) : null}
        </div>

        <div className="space-y-5">
          {event.status === "draft" ? (
            <Panel className="bg-lavender">
              <PanelTitle>Check-list de publication</PanelTitle>
              <ul className="m-0 list-none space-y-2 p-0 text-[13px]">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${c.ok ? "bg-lime" : "border border-ink"}`}
                    >
                      {c.ok ? "✓" : ""}
                    </span>
                    <span>
                      <span className="k-sr-only">{c.ok ? "Fait : " : "À faire : "}</span>
                      {c.label}
                      {!c.ok && c.hint ? <span className="block text-muted">{c.hint}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px]">
                {missing.length === 0
                  ? "Tout est prêt pour la publication."
                  : `${missing.length} point(s) à compléter.`}
              </p>
            </Panel>
          ) : null}
          <Panel>
            <PanelTitle>Actions</PanelTitle>
            <EventLifecycleActions
              organizationId={ctx.organization.id}
              slug={slug}
              event={{
                id: event.id,
                slug: event.slug,
                title: event.title,
                status: event.status,
                version: event.version,
              }}
              permissions={{ update: can("events.update"), cancel: can("events.cancel") }}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
