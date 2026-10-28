import { formatDateFr, formatTimeFr } from "@kroov/domain/kernel";
import { campaignStats, listCampaigns } from "@kroov/domain/marketing";
import {
  Badge,
  Button,
  EmptyState,
  ForbiddenState,
  PageHeader,
  Panel,
  PanelTitle,
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
import { loadOrgPage } from "@/lib/org-context";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "./labels";

export const metadata: Metadata = { title: "Marketing" };

/** Écran 19 — campagnes : états, audience, résultats. */
export default async function MarketingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/marketing`);
  if (!ctx.can("campaigns.manage")) {
    return (
      <>
        <PageHeader eyebrow="Marketing" title="Parler aux bonnes personnes." />
        <ForbiddenState description="Les campagnes sont réservées aux personnes disposant du droit « préparer des campagnes »." />
      </>
    );
  }
  const org = ctx.organization;
  const [campaigns, stats] = await Promise.all([
    listCampaigns(db(), ctx.session.actor, org.id),
    campaignStats(db(), org.id),
  ]);
  const tz = org.timezone;
  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Parler aux bonnes personnes."
        description="Une campagne ne part qu'aux personnes consenties, après vérification de l'audience. Le lien de désinscription est systématique ; aucun suivi d'ouverture."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/o/${slug}/marketing/gabarits`}>Gabarits</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/o/${slug}/contacts/segments`}>Segments</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href={`/o/${slug}/marketing/nouvelle`}>+ Nouvelle campagne</Link>
            </Button>
          </>
        }
      />
      <StatGrid>
        <Stat label="Campagnes" value={String(stats.total)} hint={`${stats.drafts} brouillon(s)`} />
        <Stat
          tone="lavender"
          label="Programmées"
          value={String(stats.scheduled)}
          hint="Audience revérifiée à l'envoi"
        />
        <Stat
          tone="lime"
          label="Messages envoyés"
          value={String(stats.sent)}
          hint="Acceptés par le fournisseur, toutes campagnes"
        />
        <Stat label="Suivi" value="clics" hint="Envois, clics, rebonds, désinscriptions — pas d'ouverture" />
      </StatGrid>
      <Panel>
        <PanelTitle>Campagnes</PanelTitle>
        {campaigns.length === 0 ? (
          <EmptyState
            title="Aucune campagne"
            description="Créez un brouillon, choisissez un segment, envoyez-vous un test, vérifiez l'audience, puis envoyez ou programmez."
          />
        ) : (
          <TableContainer label="Campagnes" className="border-0 bg-transparent">
            <Table>
              <THead>
                <TR>
                  <TH>Campagne</TH>
                  <TH>Statut</TH>
                  <TH>Audience</TH>
                  <TH>Envoyés / échecs</TH>
                  <TH>Date</TH>
                  <TH>
                    <span className="k-sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <b>{c.name}</b>
                      <span className="block text-[11px] text-muted">
                        {c.subject || "— sans objet —"}
                        {c.segmentName ? ` · ${c.segmentName}` : ""}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                    </TD>
                    <TD className="text-[12px]">
                      {c.eligibleCount !== null ? (
                        <>
                          <b>{c.eligibleCount}</b> éligible(s) / {c.audienceCount ?? 0}
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-[12px]">
                      {c.status === "draft" || c.status === "scheduled" ? "—" : `${c.sentCount} / ${c.failedCount}`}
                    </TD>
                    <TD className="text-[12px]">
                      {c.finishedAt
                        ? `${formatDateFr(c.finishedAt, tz)} · ${formatTimeFr(c.finishedAt, tz)}`
                        : c.scheduledAt
                          ? `prévue ${formatDateFr(c.scheduledAt, tz)} · ${formatTimeFr(c.scheduledAt, tz)}`
                          : formatDateFr(c.createdAt, tz)}
                    </TD>
                    <TD className="text-right">
                      <Link href={`/o/${slug}/marketing/${c.id}`} className="font-bold underline underline-offset-4">
                        {c.status === "draft" ? "Modifier →" : "Ouvrir →"}
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
