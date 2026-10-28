import { listEvents } from "@kroov/domain/events";
import { listAssignableMembers, listTasks } from "@kroov/domain/tasks";
import { Button, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { toTaskRow } from "@/lib/tasks";
import { NewTaskButton, type TaskCtx, TaskList } from "./tasks-panel";

export const metadata: Metadata = { title: "Tâches" };

const FILTERS = [
  { key: "open", label: "Ouvertes" },
  { key: "mine", label: "Mes tâches" },
  { key: "overdue", label: "En retard" },
  { key: "done", label: "Terminées" },
  { key: "all", label: "Toutes" },
] as const;

/** Tâches d'organisation (phase 9) : lecture organization.read, écriture tasks.manage. */
export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filtre?: string; evenement?: string }>;
}) {
  const { slug } = await params;
  const { filtre, evenement } = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/taches`);
  const filter = FILTERS.some((f) => f.key === filtre) ? (filtre as (typeof FILTERS)[number]["key"]) : "open";
  const input =
    filter === "mine"
      ? { status: "open" as const, mine: true }
      : filter === "overdue"
        ? { status: "open" as const, overdue: true }
        : { status: filter };
  const canManage = ctx.can("tasks.manage");
  const canReadEvents = ctx.can("events.read") || ctx.member.eventPermissions.size > 0;
  const [list, members, events] = await Promise.all([
    listTasks(db(), ctx.session.actor, ctx.organization.id, { ...input, ...(evenement ? { eventId: evenement } : {}) }),
    canManage ? listAssignableMembers(db(), ctx.session.actor, ctx.organization.id) : Promise.resolve([]),
    canManage && canReadEvents
      ? listEvents(db(), ctx.session.actor, ctx.organization.id, { status: "active" })
      : Promise.resolve([]),
  ]);
  const taskCtx: TaskCtx = {
    organizationId: ctx.organization.id,
    slug,
    canManage,
    members: members.map((m) => ({ memberId: m.memberId, name: m.name })),
    events: events.map((e) => ({ id: e.id, title: e.title, slug: e.slug })),
  };

  return (
    <>
      <PageHeader
        eyebrow="Opérations"
        title="Ce qui reste à faire."
        description="Les tâches de l'équipe : échéance, responsable, événement lié. Les tâches système sont créées automatiquement (indisponibilité signalée…) et restent jusqu'à ce que vous les terminiez."
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`/api/v1/organizations/${ctx.organization.id}/tasks/export`}>Exporter (CSV)</a>
            </Button>
            <NewTaskButton ctx={taskCtx} />
          </>
        }
      />
      <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
        <Stat tone="lime" label="Ouvertes" value={String(list.counts.open)} hint="à faire ou en cours" />
        <Stat
          tone={list.counts.overdue > 0 ? "pink" : undefined}
          label="En retard"
          value={String(list.counts.overdue)}
          hint="échéance dépassée"
        />
        <Stat tone="lavender" label="Mes tâches" value={String(list.counts.mine)} hint="qui me sont attribuées" />
      </StatGrid>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <PanelTitle className="mb-0">{FILTERS.find((f) => f.key === filter)?.label}</PanelTitle>
          <nav aria-label="Filtres" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/o/${slug}/taches${f.key === "open" ? "" : `?filtre=${f.key}`}`}
                aria-current={f.key === filter ? "page" : undefined}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-bold ${f.key === filter ? "bg-ink text-surface" : "bg-neutral"}`}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <TaskList
          ctx={taskCtx}
          tasks={list.items.map(toTaskRow)}
          emptyTitle={filter === "open" ? "Rien d'ouvert" : "Aucune tâche"}
        />
        {list.total > list.items.length ? (
          <p className="mt-3 text-[12px] text-muted">
            {list.items.length} sur {list.total} affichées — utilisez l'export pour tout obtenir.
          </p>
        ) : null}
      </Panel>
    </>
  );
}
