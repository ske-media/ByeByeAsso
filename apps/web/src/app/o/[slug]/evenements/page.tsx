import { EVENT_STATUS_LABELS, type EventStatus, listEvents } from "@kroov/domain/events";
import { formatRangeFr } from "@kroov/domain/kernel";
import { Alert, Badge, Button, EmptyState, ForbiddenState, PageHeader, Panel } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";

export const metadata: Metadata = { title: "Événements" };

const FILTERS: Array<{
  key: "active" | "draft" | "published" | "completed" | "cancelled" | "archived" | "all";
  label: string;
}> = [
  { key: "active", label: "En cours" },
  { key: "draft", label: "Brouillons" },
  { key: "published", label: "Publiés" },
  { key: "completed", label: "Terminés" },
  { key: "cancelled", label: "Annulés" },
  { key: "archived", label: "Archivés" },
  { key: "all", label: "Tous" },
];

const STATUS_TONE: Record<EventStatus, "neutral" | "lime" | "orange" | "error" | "lavender"> = {
  draft: "neutral",
  published: "lime",
  suspended: "orange",
  completed: "lavender",
  cancelled: "error",
  archived: "neutral",
};

/** Écran 04 — Liste des événements. */
export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ statut?: string; supprime?: string }>;
}) {
  const { slug } = await params;
  const { statut, supprime } = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/evenements`);
  const canRead = ctx.can("events.read") || ctx.member.eventPermissions.size > 0;
  if (!canRead) {
    return (
      <>
        <PageHeader eyebrow="Événements" title="Vos événements" />
        <ForbiddenState description="Vous n'avez pas de rôle donnant accès aux événements. Demandez-le à une personne administratrice." />
      </>
    );
  }
  const filter = (FILTERS.find((f) => f.key === statut)?.key ?? "active") as (typeof FILTERS)[number]["key"];
  const events = await listEvents(db(), ctx.session.actor, ctx.organization.id, { status: filter });
  const canCreate = ctx.can("events.create");

  return (
    <>
      <PageHeader
        eyebrow="Événements"
        title="Vos événements"
        description="Brouillons, publications et historique. Chaque événement a sa page publique une fois publié."
        actions={
          canCreate ? (
            <>
              <Button asChild variant="secondary">
                <Link href={`/o/${slug}/lieux`}>Lieux</Link>
              </Button>
              <Button asChild variant="primary">
                <Link href={`/o/${slug}/evenements/nouveau`}>+ Créer un événement</Link>
              </Button>
            </>
          ) : undefined
        }
      />
      {supprime ? (
        <Alert tone="success" className="mb-4">
          Brouillon supprimé.
        </Alert>
      ) : null}
      <nav aria-label="Filtrer par statut" className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/o/${slug}/evenements${f.key === "active" ? "" : `?statut=${f.key}`}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={`rounded-pill border px-3 py-1.5 text-[12px] font-bold ${filter === f.key ? "border-ink bg-lime" : "border-border-strong bg-surface hover:border-ink"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <EmptyState
          title={filter === "active" ? "Aucun événement pour le moment" : "Aucun événement dans ce filtre"}
          description={
            filter === "active"
              ? "Créez votre premier événement : dates, lieu, capacité. Il restera un brouillon jusqu'à publication."
              : "Changez de filtre pour voir vos autres événements."
          }
          action={
            canCreate && filter === "active" ? (
              <Button asChild variant="primary">
                <Link href={`/o/${slug}/evenements/nouveau`}>Créer un événement</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/o/${slug}/evenements/${e.slug}`} className="block rounded-panel">
                <Panel className="h-full transition-colors hover:border-ink">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-panel-title font-bold">{e.title}</h2>
                    <Badge tone={STATUS_TONE[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>
                  </div>
                  <p className="mt-1 text-[13px]">{formatRangeFr(e.startsAt, e.endsAt, e.timezone)}</p>
                  <p className="mt-1 text-meta text-muted">
                    {e.locationName ? `${e.locationName} · ${e.city}` : "Lieu à définir"} ·{" "}
                    {e.capacity > 0 ? `${e.capacity} places` : "capacité à définir"}
                    {e.visibility === "unlisted" ? " · non répertorié" : ""}
                  </p>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
