import { formatDateFr, formatMoney, formatTimeFr, isDomainError } from "@kroov/domain/kernel";
import { getCampaign, listRecipients } from "@kroov/domain/marketing";
import { Alert, Badge, ForbiddenState, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";
import { loadOrgPage } from "@/lib/org-context";
import { editorOptions } from "../_options";
import { CampaignEditor } from "../campaign-editor";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "../labels";
import { RecipientsTable, ScheduledActions } from "./panels";

export const metadata: Metadata = { title: "Campagne" };

/** Écran 20 (brouillon) / rapport (programmée, en cours, envoyée). */
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; campaignId: string }>;
  searchParams: Promise<{ statut?: string }>;
}) {
  const { slug, campaignId } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/marketing/${campaignId}`);
  if (!ctx.can("campaigns.manage")) {
    return (
      <>
        <PageHeader eyebrow="Marketing" title="Accès réservé." />
        <ForbiddenState description="Les campagnes sont réservées aux personnes disposant du droit « préparer des campagnes »." />
      </>
    );
  }
  const org = ctx.organization;
  const actor = ctx.session.actor;
  let c: Awaited<ReturnType<typeof getCampaign>>;
  try {
    c = await getCampaign(db(), marketingContext(), actor, org.id, campaignId);
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  }
  const tz = org.timezone;
  const when = (d: Date | null) => (d ? `${formatDateFr(d, tz)} · ${formatTimeFr(d, tz)}` : "—");
  const panelCtx = { organizationId: org.id, slug };
  const canSend = ctx.can("campaigns.send");

  if (c.status === "draft") {
    const options = await editorOptions(actor, org.id, ctx.can("contacts.read"));
    return (
      <>
        <PageHeader
          eyebrow={
            <Link href={`/o/${slug}/marketing`} className="underline underline-offset-4">
              ← Marketing
            </Link>
          }
          title={c.name}
          description="Brouillon — modifiable jusqu'à la programmation."
        />
        <CampaignEditor
          ctx={panelCtx}
          options={options}
          initial={{
            id: c.id,
            version: c.version,
            name: c.name,
            subject: c.subject,
            preheader: c.preheader ?? "",
            fromName: c.fromName,
            replyTo: c.replyTo ?? "",
            body: c.body,
            segmentId: c.segmentId ?? "",
            templateId: c.templateId ?? "",
          }}
          preview={c.preview}
          canSend={canSend}
        />
      </>
    );
  }

  const r = c.report;
  const status =
    sp.statut && ["pending", "sent", "failed", "skipped", "bounced", "unsubscribed"].includes(sp.statut)
      ? sp.statut
      : "all";
  const recipients =
    c.status === "scheduled" || c.status === "cancelled"
      ? null
      : await listRecipients(db(), actor, org.id, c.id, { status, pageSize: 100 });
  const lastAudience = r.audiences[0];
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/marketing`} className="underline underline-offset-4">
            ← Marketing
          </Link>
        }
        title={c.name}
        description={`${c.subject} · ${c.segmentName ?? "sans segment"} · ${c.fromName}`}
        actions={
          c.status === "scheduled" && canSend ? (
            <ScheduledActions ctx={panelCtx} campaignId={c.id} scheduledLabel={when(c.scheduledAt)} />
          ) : null
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
        {c.status === "scheduled" ? (
          <span className="text-[13px]">
            Envoi prévu le {when(c.scheduledAt)} — l'éligibilité sera revérifiée à ce moment.
          </span>
        ) : null}
        {c.status === "sending" ? (
          <span className="text-[13px]">
            Envoi par lots en cours depuis {when(c.startedAt)} ; cette page se met à jour au rechargement.
          </span>
        ) : null}
        {c.finishedAt ? <span className="text-[13px]">Terminée le {when(c.finishedAt)}.</span> : null}
        {c.error ? <Alert tone="error">{c.error}</Alert> : null}
        {c.includeCustomerException ? (
          <Alert tone="info">
            Exception client invoquée (contacts « client·e sans consentement » inclus). Justification tracée :{" "}
            {c.legalNote}
          </Alert>
        ) : null}
      </div>
      <StatGrid>
        <Stat
          label="Audience"
          value={String(c.audienceCount ?? lastAudience?.segmentCount ?? 0)}
          hint="Contacts du segment au dernier calcul"
        />
        <Stat
          tone="lime"
          label="Éligibles"
          value={String(c.eligibleCount ?? lastAudience?.eligibleCount ?? 0)}
          hint="Consentis, non exclus, adresse valide, sans doublon"
        />
        <Stat
          tone="lavender"
          label="Envoyés"
          value={String(c.status === "scheduled" ? 0 : c.sentCount)}
          hint={`${c.failedCount} échec(s) définitif(s) · ${r.deliveries.delivered} livré(s) confirmé(s)`}
        />
        <Stat
          tone="orange"
          label="Clics"
          value={String(r.clicks.total)}
          hint={`${r.clicks.uniqueRecipients} destinataire(s) distinct(s) · ${r.unsubscribes} désinscription(s) · ${r.deliveries.bounced} rebond(s)`}
        />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {recipients ? (
            <Panel>
              <PanelTitle>Destinataires</PanelTitle>
              <RecipientsTable
                slug={slug}
                campaignId={c.id}
                status={status}
                rows={recipients.recipients.map((x) => ({ ...x, sentAt: x.sentAt ? when(x.sentAt) : null }))}
                total={recipients.total}
              />
            </Panel>
          ) : null}
          <Panel>
            <PanelTitle>Liens suivis</PanelTitle>
            {r.links.length === 0 ? (
              <p className="text-[13px] text-muted">Aucun lien suivi (les liens sont créés à l'envoi).</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
                {r.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="break-all">{l.targetUrl}</span>
                    <span className="text-muted">
                      {l.clicksCount} clic(s) · {l.uniqueClicksCount} destinataire(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="bg-lavender">
            <PanelTitle>Attribution</PanelTitle>
            <p className="text-[32px] font-black leading-none">{r.attribution.paidOrdersCount}</p>
            <p className="mt-1 text-[13px]">
              commande(s) payée(s) attribuée(s) ·{" "}
              {formatMoney({
                amountMinor: r.attribution.confirmedRevenueMinor,
                currency: r.attribution.currency as "EUR",
              })}{" "}
              confirmés
              {r.attribution.ordersCount > r.attribution.paidOrdersCount
                ? ` · ${r.attribution.ordersCount - r.attribution.paidOrdersCount} réservation(s) non payée(s)`
                : ""}
            </p>
            <p className="mt-3 text-[12px] text-muted">{r.attribution.disclosure}</p>
          </Panel>
          {lastAudience ? (
            <Panel>
              <PanelTitle>Dernier contrôle d'audience</PanelTitle>
              <ul className="m-0 list-none p-0 text-[13px]">
                <li>Segment : {lastAudience.segmentCount}</li>
                <li>Sans consentement : −{lastAudience.notConsentedCount}</li>
                <li>Exclu·es : −{lastAudience.suppressedCount}</li>
                <li>Adresses invalides : −{lastAudience.invalidCount}</li>
                <li>Doublons : −{lastAudience.duplicateCount}</li>
                <li>
                  <b>Éligibles : {lastAudience.eligibleCount}</b>
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-muted">
                {lastAudience.stage === "dispatch"
                  ? "Calculé à l'envoi"
                  : lastAudience.stage === "schedule"
                    ? "Calculé à la programmation"
                    : "Calculé à la vérification"}{" "}
                · {when(lastAudience.computedAt)}
              </p>
            </Panel>
          ) : null}
          <Panel>
            <PanelTitle>Livraisons</PanelTitle>
            <ul className="m-0 list-none p-0 text-[13px]">
              <li>
                Acceptées par le fournisseur :{" "}
                {r.deliveries.accepted + r.deliveries.delivered + r.deliveries.bounced + r.deliveries.complained}
              </li>
              <li>Livrées (confirmées par rappel) : {r.deliveries.delivered}</li>
              <li>
                Rebonds : {r.deliveries.bounced} · Plaintes : {r.deliveries.complained}
              </li>
              <li>Échecs : {r.deliveries.failed}</li>
            </ul>
            <p className="mt-2 text-[11px] text-muted">
              Les confirmations de livraison dépendent des rappels du fournisseur ; aucun suivi d'ouverture.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
