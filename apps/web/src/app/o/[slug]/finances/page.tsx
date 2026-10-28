import { financeOverview } from "@kroov/domain/analytics";
import {
  Alert,
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
import { db } from "@/lib/db";
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";

export const metadata: Metadata = { title: "Finances" };

const KIND_LABELS: Record<string, string> = {
  order_paid: "Commande payée",
  order_refunded: "Remboursement",
};
const ACCOUNT_LABELS: Record<string, string> = {
  receivable_provider: "Encaissé par le prestataire",
  revenue_tickets: "Revenu billetterie",
  platform_fees: "Frais de plateforme",
};
const DOC_LABELS: Record<string, string> = { invoice: "Facture", receipt: "Reçu", credit_note: "Avoir" };

/** Écran 22 — Finances : ce que le grand livre sait, et ce qu'il ne sait pas (versements). */
export default async function FinancesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/finances`);
  if (!ctx.can("analytics.read")) {
    return (
      <>
        <PageHeader eyebrow="Finances" title="Les comptes, sans approximation." />
        <ForbiddenState description="Les finances sont réservées aux personnes disposant du droit « consulter les statistiques »." />
      </>
    );
  }
  const f = await financeOverview(db(), ctx.session.actor, ctx.organization.id, 50);
  const b = f.balances;
  const money = (m: number) => fmtMinor(m, f.currency);
  const fmt = (d: Date) =>
    d.toLocaleString("fr-FR", {
      timeZone: ctx.organization.timezone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <PageHeader
        eyebrow="Finances"
        title="Les comptes, sans approximation."
        description="Chaque montant vient du grand livre en partie double ou des remboursements effectifs. Le net organisateur est une estimation tant que le prestataire n'a pas versé."
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/v1/organizations/${ctx.organization.id}/finances/export`}>Exporter le journal (CSV)</a>
          </Button>
        }
      />
      <StatGrid>
        <Stat tone="lime" label="Brut billetterie" value={money(b.gross.amountMinor)} hint={b.gross.source} />
        <Stat tone="pink" label="Remboursements" value={money(b.refunds.amountMinor)} hint={b.refunds.source} />
        <Stat label="Frais de plateforme" value={money(b.platformFees.amountMinor)} hint={b.platformFees.source} />
        <Stat
          tone="lavender"
          label="Net organisateur (estimation)"
          value={money(b.netEstimate.amountMinor)}
          hint={b.netEstimate.source}
        />
      </StatGrid>
      <Alert tone="info" heading="Versements" className="mb-5">
        {f.payouts.note} Encaissé par le prestataire à ce jour : <b>{money(b.receivableFromProvider.amountMinor)}</b>.
      </Alert>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Par événement</PanelTitle>
            {f.byEvent.length === 0 ? (
              <EmptyState
                title="Aucune commande encore"
                description="Les montants apparaîtront dès la première commande payée."
              />
            ) : (
              <TableContainer label="Montants par événement">
                <Table>
                  <THead>
                    <TR>
                      <TH>Événement</TH>
                      <TH className="text-right">Commandes payées</TH>
                      <TH className="text-right">Brut</TH>
                      <TH className="text-right">Remboursé</TH>
                      <TH className="text-right">Frais</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {f.byEvent.map((e) => (
                      <TR key={e.eventId}>
                        <TD>{e.title}</TD>
                        <TD className="k-tabular text-right">{e.paidOrders}</TD>
                        <TD className="k-tabular text-right">{money(e.grossMinor)}</TD>
                        <TD className="k-tabular text-right">{money(e.refundsMinor)}</TD>
                        <TD className="k-tabular text-right">{money(e.feesMinor)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Panel>
          <Panel>
            <PanelTitle>Journal (50 dernières écritures)</PanelTitle>
            {f.journal.length === 0 ? (
              <p className="text-[13px] text-muted">Aucune écriture.</p>
            ) : (
              <TableContainer label="Journal des écritures">
                <Table>
                  <THead>
                    <TR>
                      <TH>Date</TH>
                      <TH>Type</TH>
                      <TH>Référence</TH>
                      <TH>Écritures</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {f.journal.map((j) => (
                      <TR key={j.id}>
                        <TD className="whitespace-nowrap">{fmt(j.occurredAt)}</TD>
                        <TD>{KIND_LABELS[j.kind] ?? j.kind}</TD>
                        <TD>{j.reference ?? j.description ?? "—"}</TD>
                        <TD>
                          <ul className="m-0 list-none p-0 text-[12px]">
                            {j.entries.map((e) => (
                              <li key={`${j.id}-${e.account}`} className="k-tabular">
                                {ACCOUNT_LABELS[e.account] ?? e.account} : {e.amountMinor > 0 ? "D" : "C"}{" "}
                                {money(Math.abs(e.amountMinor))}
                              </li>
                            ))}
                          </ul>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </Panel>
        </div>
        <Panel>
          <PanelTitle>Documents</PanelTitle>
          {f.documents.length === 0 ? (
            <p className="text-[13px] text-muted">
              Aucun document financier émis. Kroov n'émet pas encore de factures ni de reçus : la table existe, la
              génération arrivera avec la facturation.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
              {f.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <b>{DOC_LABELS[d.kind] ?? d.kind}</b> {d.reference}
                  </span>
                  <span className="text-muted">{fmt(d.issuedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[12px] text-muted">
            Conventions : crédit (C) sur « revenu billetterie » = vente ; débit (D) = remboursement. Le compte «
            encaissé par le prestataire » est débité à la vente et crédité au remboursement.
          </p>
        </Panel>
      </div>
    </>
  );
}
