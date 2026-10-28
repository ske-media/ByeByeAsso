import { organizationDashboard } from "@kroov/domain/analytics";
import { EVENT_STATUS_LABELS, listEvents } from "@kroov/domain/events";
import { formatDateFr, formatRangeFr } from "@kroov/domain/kernel";
import { listNotifications } from "@kroov/domain/notifications";
import { listInvitations, listMembers } from "@kroov/domain/organizations";
import { listTasks } from "@kroov/domain/tasks";
import { Alert, Badge, Button, EventPoster, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/labels";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";

export const metadata: Metadata = { title: "Vue d'ensemble" };

/**
 * Écran 03 — Vue d'ensemble, construite uniquement sur l'état réel : prochain événement,
 * KPI calculés sur les enregistrements autoritaires (analytics.read), tâches en retard,
 * notifications non lues, équipe, invitations. Jamais un faux « 0 » : sans accès, « — ».
 */
export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bienvenue?: string }>;
}) {
  const { slug } = await params;
  const { bienvenue } = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}`);
  const canReadOrg = ctx.can("organization.read");
  const canInvite = ctx.can("members.invite");
  const canReadEvents = ctx.can("events.read") || ctx.member.eventPermissions.size > 0;
  const canCreate = ctx.can("events.create");
  const canAnalytics = ctx.can("analytics.read");
  const [members, invitations, events, dashboard, tasks, notifications] = await Promise.all([
    canReadOrg ? listMembers(db(), ctx.session.actor, ctx.organization.id) : Promise.resolve(null),
    canInvite ? listInvitations(db(), ctx.session.actor, ctx.organization.id) : Promise.resolve(null),
    canReadEvents
      ? listEvents(db(), ctx.session.actor, ctx.organization.id, { status: "active" })
      : Promise.resolve(null),
    canAnalytics ? organizationDashboard(db(), ctx.session.actor, ctx.organization.id) : Promise.resolve(null),
    canReadOrg
      ? listTasks(db(), ctx.session.actor, ctx.organization.id, { status: "open", pageSize: 6 })
      : Promise.resolve(null),
    listNotifications(db(), ctx.session.actor, ctx.organization.id, { unread: true, limit: 5 }),
  ]);
  const overdueTasks = tasks?.items.filter((t) => t.overdue) ?? [];
  const pending = invitations?.filter((i) => i.status === "pending").length ?? 0;
  const now = Date.now();
  const published = events?.filter((e) => e.status === "published") ?? [];
  const drafts = events?.filter((e) => e.status === "draft") ?? [];
  const next =
    published.filter((e) => e.endsAt.getTime() > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ??
    null;
  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: ctx.organization.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const firstName = ctx.session.user.name.split(" ")[0];
  // Brand-new organization: no event yet and nobody else on board → onboarding checklist.
  const fresh = events !== null && events.length === 0 && (members?.length ?? 0) <= 1;

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.organization.name} · ${today}`}
        title={
          <>
            Bonjour {firstName} <span aria-hidden="true">✳</span>
          </>
        }
        description="Des nuits mémorables, une organisation sereine."
        actions={
          canCreate ? (
            <Button asChild variant="primary">
              <Link href={`/o/${slug}/evenements/nouveau`}>+ Créer un événement</Link>
            </Button>
          ) : undefined
        }
      />

      {bienvenue ? (
        <Alert tone="success" heading="Bienvenue dans l'équipe" className="mb-6">
          Votre invitation a été acceptée. Vos accès correspondent au rôle qui vous a été attribué.
        </Alert>
      ) : null}

      <StatGrid>
        <Stat
          tone="lime"
          label="Événements publiés"
          value={events ? String(published.length) : "—"}
          hint={events ? `${drafts.length} brouillon(s) en préparation` : "Accès événements requis"}
        />
        <Stat
          tone="pink"
          label="Billets vendus"
          value={dashboard ? String(dashboard.ticketing.ticketsSold) : "—"}
          hint={
            dashboard
              ? `${dashboard.ticketing.paidOrders} commande(s) payée(s) · ${dashboard.ticketing.ticketsUsed} utilisé(s)`
              : "Droit « consulter les statistiques » requis"
          }
        />
        <Stat
          tone="lavender"
          label="Brut billetterie"
          value={dashboard ? fmtMinor(dashboard.ticketing.gross.amountMinor, dashboard.currency) : "—"}
          hint={
            dashboard
              ? `${fmtMinor(dashboard.ticketing.refunds.amountMinor, dashboard.currency)} remboursé(s) · grand livre`
              : "Droit « consulter les statistiques » requis"
          }
        />
        <Stat
          label="Adhérents actifs"
          value={dashboard ? String(dashboard.memberships.active) : "—"}
          hint={
            dashboard
              ? `${dashboard.memberships.pending} en attente · ${dashboard.memberships.expiringIn30Days} expirent sous 30 j`
              : "Droit « consulter les statistiques » requis"
          }
        />
        <Stat
          tone="orange"
          label="Bénévoles"
          value={dashboard ? String(dashboard.volunteers.applications) : "—"}
          hint={
            dashboard
              ? `${dashboard.volunteers.approved} acceptée(s) · couverture ${dashboard.volunteers.coverageRate === null ? "—" : `${Math.round(dashboard.volunteers.coverageRate * 100)} %`}`
              : "Droit « consulter les statistiques » requis"
          }
        />
        <Stat
          label="Tâches en retard"
          value={tasks ? String(tasks.counts.overdue) : "—"}
          hint={
            tasks
              ? `${tasks.counts.open} ouverte(s) · ${tasks.counts.mine} à moi`
              : "Lecture réservée aux rôles d'organisation"
          }
        />
        <Stat
          label="Équipe"
          value={members ? String(members.length) : "—"}
          hint={
            members
              ? `${members.length > 1 ? "personnes" : "personne"} avec un accès${invitations ? ` · ${pending} invitation(s)` : ""}`
              : "Lecture réservée aux rôles d'organisation"
          }
        />
        <Stat
          label="Vos rôles"
          value={String(ctx.member.organizationRoles.length + ctx.member.eventPermissions.size)}
          hint={
            [
              ...ctx.member.organizationRoles.map(roleLabel),
              ...(ctx.member.eventPermissions.size
                ? [`${ctx.member.eventPermissions.size} événement(s) attribué(s)`]
                : []),
            ].join(", ") || "Aucun rôle"
          }
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel>
          {next ? (
            <>
              <EventPoster
                organizationName={ctx.organization.name}
                title={next.title}
                dateLabel={formatDateFr(next.startsAt, next.timezone)}
                placeLabel={next.locationName ? `${next.city} · ${next.locationName}` : undefined}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-panel-title font-bold">{next.title}</h2>
                  <p className="text-meta text-muted">{formatRangeFr(next.startsAt, next.endsAt, next.timezone)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="lime">{EVENT_STATUS_LABELS[next.status]}</Badge>
                  <Button asChild variant="secondary">
                    <Link href={`/o/${slug}/evenements/${next.slug}`}>Gérer l'événement ↗</Link>
                  </Button>
                </div>
              </div>
            </>
          ) : events && drafts.length > 0 ? (
            <>
              <PanelTitle>Un brouillon attend sa publication</PanelTitle>
              <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
                {drafts.slice(0, 3).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <span>
                      <b>{d.title}</b>
                      <span className="block text-muted">{formatRangeFr(d.startsAt, d.endsAt, d.timezone)}</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/o/${slug}/evenements/${d.slug}`}>Piloter →</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <PanelTitle>Prochain événement</PanelTitle>
              <p className="text-[13px] text-muted">
                {events
                  ? "Aucun événement publié à venir. Créez-en un : il restera un brouillon jusqu'à publication."
                  : "Votre rôle ne donne pas accès aux événements."}
              </p>
              {canCreate ? (
                <div className="mt-4">
                  <Button asChild variant="primary">
                    <Link href={`/o/${slug}/evenements/nouveau`}>Créer un événement</Link>
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Panel>

        <Panel>
          <PanelTitle>{fresh ? "Démarrage" : "À faire aujourd'hui"}</PanelTitle>
          <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
            {fresh ? (
              <li className="flex items-start gap-3 py-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-lime text-[11px] font-bold"
                >
                  ✓
                </span>
                <span>
                  <b>Organisation créée</b> — {ctx.organization.name}
                  <span className="block text-muted">Prochaine étape : votre premier événement, puis l'équipe.</span>
                </span>
              </li>
            ) : null}
            {overdueTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <b>{t.title}</b>
                  <span className="block text-error-text">
                    En retard · {t.dueAt?.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    {t.assignee ? ` · ${t.assignee.name}` : ""}
                  </span>
                </span>
                <Link href={`/o/${slug}/taches?filtre=overdue`} aria-label="Voir les tâches en retard">
                  →
                </Link>
              </li>
            ))}
            {notifications.items.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <b>{n.title}</b>
                  {n.body ? <span className="block text-muted">{n.body}</span> : null}
                </span>
                <Link href={n.href ?? `/o/${slug}/notifications`} aria-label={`Ouvrir : ${n.title}`}>
                  →
                </Link>
              </li>
            ))}
            {drafts.length > 0 ? (
              <li className="flex items-center justify-between gap-3 py-3">
                <span>
                  <b>Publier {drafts.length > 1 ? `${drafts.length} brouillons` : "le brouillon"}</b>
                  <span className="block text-muted">{drafts[0]?.title}</span>
                </span>
                <Link href={`/o/${slug}/evenements?statut=draft`} aria-label="Voir les brouillons">
                  →
                </Link>
              </li>
            ) : null}
            {pending > 0 ? (
              <li className="flex items-center justify-between gap-3 py-3">
                <span>
                  <b>{pending} invitation(s) en attente</b>
                  <span className="block text-muted">Relancez ou annulez depuis l'équipe.</span>
                </span>
                <Link href={`/o/${slug}/equipe`} aria-label="Voir l'équipe">
                  →
                </Link>
              </li>
            ) : null}
            {members && members.length <= 1 && canInvite ? (
              <li className="flex items-center justify-between gap-3 py-3">
                <span>
                  <b>Constituer l'équipe</b>
                  <span className="block text-muted">Invitez vos collaborateurs avec le bon rôle.</span>
                </span>
                <Link href={`/o/${slug}/equipe`} aria-label="Inviter">
                  →
                </Link>
              </li>
            ) : null}
            {!fresh &&
            drafts.length === 0 &&
            pending === 0 &&
            overdueTasks.length === 0 &&
            notifications.items.length === 0 &&
            !(members && members.length <= 1 && canInvite) ? (
              <li className="py-3 text-muted">Rien d'urgent. Aucune tâche en retard, aucune notification non lue.</li>
            ) : null}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {tasks ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/o/${slug}/taches`}>Toutes les tâches ({tasks.counts.open})</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link href={`/o/${slug}/notifications`}>
                Notifications{notifications.unreadCount > 0 ? ` (${notifications.unreadCount} non lue(s))` : ""}
              </Link>
            </Button>
            {canAnalytics ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/o/${slug}/finances`}>Finances</Link>
              </Button>
            ) : null}
          </div>
          <div className="mt-4 rounded-[9px] bg-orange px-4 py-3 text-[12px]">
            <b>Organisation</b>
            <span className="block">
              /{ctx.organization.slug} · {ctx.organization.timezone}
            </span>
          </div>
        </Panel>
      </div>
    </>
  );
}
