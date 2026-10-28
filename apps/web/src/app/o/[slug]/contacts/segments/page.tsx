import { listSegments } from "@kroov/domain/crm";
import { formatDateFr, formatTimeFr } from "@kroov/domain/kernel";
import {
  Badge,
  Button,
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

export const metadata: Metadata = { title: "Segments" };

/** Écran 19 (partie audience) — segments dynamiques et statiques. */
export default async function SegmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts/segments`);
  if (!ctx.can("contacts.read")) {
    return (
      <>
        <PageHeader eyebrow="Contacts · Segments" title="Accès réservé." />
        <ForbiddenState description="Les segments sont réservés aux personnes disposant du droit « consulter les contacts »." />
      </>
    );
  }
  const segments = await listSegments(db(), ctx.session.actor, ctx.organization.id);
  const tz = ctx.organization.timezone;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/contacts`} className="underline underline-offset-4">
            ← Contacts
          </Link>
        }
        title="Segments"
        description="Des audiences par règles, recalculées à chaque affichage et au moment de l'envoi — jamais figées. Par défaut, seules les personnes consenties reçoivent une campagne."
        actions={
          ctx.can("contacts.manage") ? (
            <Button asChild variant="primary">
              <Link href={`/o/${slug}/contacts/segments/nouveau`}>+ Nouveau segment</Link>
            </Button>
          ) : null
        }
      />
      <Panel>
        <PanelTitle>Segments</PanelTitle>
        {segments.length === 0 ? (
          <EmptyState
            title="Aucun segment"
            description="Combinez consentement, étiquettes, événements et adhésions pour constituer une audience."
          />
        ) : (
          <TableContainer label="Segments" className="border-0 bg-transparent">
            <Table>
              <THead>
                <TR>
                  <TH>Segment</TH>
                  <TH>Type</TH>
                  <TH>Règles</TH>
                  <TH>Contacts (dernier calcul)</TH>
                  <TH>
                    <span className="k-sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {segments.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <b>{s.name}</b>
                      {s.description ? <span className="block text-[11px] text-muted">{s.description}</span> : null}
                    </TD>
                    <TD>
                      <Badge tone={s.kind === "dynamic" ? "lavender" : "neutral"} noDot>
                        {s.kind === "dynamic" ? "Dynamique" : "Statique"}
                      </Badge>
                    </TD>
                    <TD className="text-[12px]">
                      {s.kind === "dynamic"
                        ? `${s.definition.rules.length} règle(s) · ${s.definition.match === "all" ? "toutes" : "au moins une"}`
                        : "liste manuelle"}
                    </TD>
                    <TD>
                      <b>{s.memberCount ?? "—"}</b>
                      {s.computedAt ? (
                        <span className="block text-[11px] text-muted">
                          {formatDateFr(s.computedAt, tz)} · {formatTimeFr(s.computedAt, tz)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/o/${slug}/contacts/segments/${s.id}`}
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
