import { listEvents } from "@kroov/domain/events";
import { formatDateFr } from "@kroov/domain/kernel";
import { planningOverview, SCHEDULE_VERSION_STATUS_LABELS } from "@kroov/domain/scheduling";
import {
  Badge,
  EmptyState,
  ForbiddenState,
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
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";

export const metadata: Metadata = { title: "Planning" };

/** Vue d'ensemble du planning : par événement, version publiée, couverture, arbitrages en attente. */
export default async function PlanningOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/planning`);
  const scoped = [...ctx.member.eventPermissions.entries()]
    .filter(([, p]) => p.has("volunteers.review"))
    .map(([id]) => id);
  if (!ctx.can("volunteers.review") && scoped.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Planning" title="Qui, où, quand." />
        <ForbiddenState description="Le planning est réservé aux responsables bénévoles, événement et aux administrateurs." />
      </>
    );
  }
  const events = (await listEvents(db(), ctx.session.actor, ctx.organization.id, { status: "all" })).filter(
    (e) => (ctx.can("volunteers.review") || scoped.includes(e.id)) && ["draft", "published"].includes(e.status),
  );
  const overview = await planningOverview(
    db(),
    ctx.session.actor,
    ctx.organization.id,
    events.map((e) => e.id),
  );
  return (
    <>
      <PageHeader
        eyebrow="Planning"
        title="Qui, où, quand."
        description="Une version publiée par événement fait foi ; le moteur propose, vous validez."
      />
      <Panel>
        <PanelTitle>Événements</PanelTitle>
        {overview.length === 0 ? (
          <EmptyState
            title="Aucun événement actif"
            description="Le planning se construit depuis la page « Planning » d'un événement en préparation ou publié."
          />
        ) : (
          <TableContainer label="Planning par événement" className="border-0 bg-transparent">
            <Table>
              <THead>
                <TR>
                  <TH>Événement</TH>
                  <TH>Version publiée</TH>
                  <TH>Couverture</TH>
                  <TH>Arbitrages</TH>
                  <TH>
                    <span className="k-sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {overview.map((o) => (
                  <TR key={o.eventId}>
                    <TD>
                      <b>{o.eventTitle}</b>
                      <span className="block text-[11px] text-muted">
                        {formatDateFr(o.startsAt, ctx.organization.timezone)}
                      </span>
                    </TD>
                    <TD>
                      {o.publishedVersion ? (
                        <Badge tone="lime">{o.publishedVersion.label}</Badge>
                      ) : o.latestVersion ? (
                        <Badge tone="orange">
                          {o.latestVersion.label} · {SCHEDULE_VERSION_STATUS_LABELS[o.latestVersion.status]}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Aucune</Badge>
                      )}
                    </TD>
                    <TD>
                      {(o.publishedVersion ?? o.latestVersion)?.coveredCount ?? 0} / {o.requiredTotal}
                    </TD>
                    <TD>{o.openRequests > 0 ? <Badge tone="orange">{o.openRequests} ouverte(s)</Badge> : "—"}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/o/${slug}/evenements/${o.eventSlug}/planning`}
                        className="font-bold underline underline-offset-4"
                      >
                        Ouvrir →
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Panel>
    </>
  );
}
