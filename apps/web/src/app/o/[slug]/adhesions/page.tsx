import { formatDateFr } from "@kroov/domain/kernel";
import {
  listMembershipPlans,
  listMemberships,
  MEMBERSHIP_STATUS_LABELS,
  type MembershipStatus,
  membershipStats,
} from "@kroov/domain/memberships";
import {
  Badge,
  Button,
  EmptyState,
  ForbiddenState,
  PageHeader,
  Panel,
  PanelTitle,
  Person,
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
import { fmtMinor } from "@/lib/money";
import { loadOrgPage } from "@/lib/org-context";
import { MembershipsFilters, type MembershipsTab } from "./filters";
import { MEMBERSHIP_STATUS_TONE } from "./status-tone";

export const metadata: Metadata = { title: "Adhésions" };

const STATUS_VALUES = new Set<string>([
  "all",
  "pending",
  "awaiting_payment",
  "active",
  "suspended",
  "expired",
  "rejected",
  "cancelled",
]);

/** Écran 17 — Adhésions : indicateurs réels, onglets adhérents / formules / renouvellements. */
export default async function MembershipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ formule?: string; statut?: string; q?: string; onglet?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/adhesions`);
  if (!ctx.can("memberships.manage")) {
    return (
      <>
        <PageHeader eyebrow="Adhésions" title="On fait collectif." />
        <ForbiddenState description="La gestion des adhésions est réservée aux administrateurs et aux responsables adhésions." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const org = ctx.organization;
  const tab: MembershipsTab =
    sp.onglet === "formules" ? "formules" : sp.onglet === "renouvellements" ? "renouvellements" : "adherents";
  const status = (STATUS_VALUES.has(sp.statut ?? "") ? sp.statut : "all") as "all" | MembershipStatus;
  const [plans, stats] = await Promise.all([
    listMembershipPlans(db(), actor, org.id),
    membershipStats(db(), actor, org.id),
  ]);
  const planId = sp.formule && plans.some((p) => p.id === sp.formule) ? sp.formule : undefined;
  const memberships =
    tab === "formules"
      ? []
      : await listMemberships(db(), actor, org.id, {
          status: tab === "renouvellements" ? "to_renew" : status,
          ...(planId ? { planId } : {}),
          ...(sp.q ? { q: sp.q } : {}),
        });
  const activePlans = plans.filter((p) => p.status === "active");

  return (
    <>
      <PageHeader
        eyebrow="Adhésions"
        title="On fait collectif."
        description="Adhérents, formules et renouvellements de l'organisation."
        actions={
          <Button asChild variant="primary">
            <Link href={`/o/${slug}/adhesions/formules/nouvelle`}>Nouvelle formule</Link>
          </Button>
        }
      />
      <StatGrid>
        <Stat tone="lime" label="Adhérents actifs" value={String(stats.active)} hint="Adhésions en cours de validité" />
        <Stat tone="orange" label="À renouveler" value={String(stats.toRenew)} hint="Expirent sous 30 jours" />
        <Stat label="Demandes à examiner" value={String(stats.pending)} hint="En attente d'une décision" />
        <Stat
          tone="lavender"
          label="Cotisations encaissées"
          value={fmtMinor(stats.duesMinor, stats.currency)}
          hint="Adhésions actives, hors frais"
        />
      </StatGrid>

      <MembershipsFilters
        slug={slug}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        planId={planId ?? ""}
        status={status}
        q={sp.q ?? ""}
        tab={tab}
      />

      {tab === "formules" ? (
        <Panel>
          <PanelTitle>Formules</PanelTitle>
          {plans.length === 0 ? (
            <EmptyState
              title="Aucune formule"
              description="Créez une première formule pour ouvrir les adhésions sur votre page publique."
              action={
                <Button asChild variant="primary">
                  <Link href={`/o/${slug}/adhesions/formules/nouvelle`}>Créer une formule</Link>
                </Button>
              }
            />
          ) : (
            <TableContainer label="Formules" className="border-0 bg-transparent">
              <Table>
                <THead>
                  <TR>
                    <TH>Formule</TH>
                    <TH>Montant</TH>
                    <TH>Période</TH>
                    <TH>Adhérents</TH>
                    <TH>Statut</TH>
                    <TH>
                      <span className="k-sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {plans.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <b>{p.name}</b>
                        <span className="block text-[11px] text-muted">
                          {p.requiresReview ? "Sur revue" : "Activation directe"}
                          {p.public ? "" : " · non publique"}
                        </span>
                      </TD>
                      <TD>{p.priceMinor === 0 ? "Gratuit" : fmtMinor(p.priceMinor, p.currency)}</TD>
                      <TD>
                        {p.periodKind === "fixed"
                          ? `Jusqu'au ${p.validUntil ? formatDateFr(p.validUntil, org.timezone) : "—"}`
                          : `${p.durationMonths ?? 12} mois glissants`}
                      </TD>
                      <TD>
                        {p.activeMembers}
                        {p.maxMembers ? ` / ${p.maxMembers}` : ""}
                      </TD>
                      <TD>
                        <Badge tone={p.status === "active" ? "lime" : "neutral"}>
                          {p.status === "active" ? "Active" : "Archivée"}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <Link
                          href={`/o/${slug}/adhesions/formules/${p.id}`}
                          className="font-bold underline underline-offset-4"
                        >
                          Modifier →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
          <p className="mt-3 text-[12px] text-muted">
            Page publique :{" "}
            <Link href={`/${slug}/adherer`} className="underline underline-offset-4">
              /{slug}/adherer
            </Link>
            {activePlans.length === 0 ? " (aucune formule active pour l'instant)" : ""}
          </p>
        </Panel>
      ) : (
        <Panel>
          <PanelTitle>{tab === "renouvellements" ? "Adhésions à renouveler" : "Adhérents"}</PanelTitle>
          {memberships.length === 0 ? (
            <EmptyState
              title={tab === "renouvellements" ? "Rien à renouveler" : "Aucune adhésion"}
              description={
                tab === "renouvellements"
                  ? "Aucune adhésion n'expire dans les 30 prochains jours."
                  : sp.q || status !== "all" || planId
                    ? "Aucune adhésion ne correspond à ce filtre."
                    : "Les demandes apparaîtront ici dès qu'une personne adhère depuis votre page publique."
              }
            />
          ) : (
            <TableContainer label="Adhérents" className="border-0 bg-transparent">
              <Table>
                <THead>
                  <TR>
                    <TH>Adhérent</TH>
                    <TH>Formule</TH>
                    <TH>Validité</TH>
                    <TH>Membre depuis</TH>
                    <TH>Statut</TH>
                    <TH>
                      <span className="k-sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {memberships.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <Person name={m.memberName} secondary={`${m.memberEmail} · ${m.number}`} tone="lavender" />
                      </TD>
                      <TD>{m.planName}</TD>
                      <TD>{m.validUntil ? `→ ${formatDateFr(m.validUntil, org.timezone)}` : "—"}</TD>
                      <TD>{formatDateFr(m.memberSince, org.timezone)}</TD>
                      <TD>
                        <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{MEMBERSHIP_STATUS_LABELS[m.status]}</Badge>
                      </TD>
                      <TD className="text-right">
                        <Link href={`/o/${slug}/adhesions/${m.id}`} className="font-bold underline underline-offset-4">
                          Voir →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Panel>
      )}
    </>
  );
}
