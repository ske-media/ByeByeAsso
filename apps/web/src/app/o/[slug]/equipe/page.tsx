import { listInvitations, listMembers } from "@kroov/domain/organizations";
import {
  Badge,
  ForbiddenState,
  PageHeader,
  Panel,
  PanelTitle,
  Person,
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
import { roleLabel } from "@/lib/labels";
import { loadOrgPage } from "@/lib/org-context";
import { InvitationActions, InviteForm, MemberActions } from "./team-actions";

export const metadata: Metadata = { title: "Équipe & accès" };

function formatDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString("fr-FR", { timeZone, day: "numeric", month: "short", year: "numeric" });
}

/** Écran 23 — Équipe & RBAC. */
export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/equipe`);
  if (!ctx.can("organization.read")) {
    return (
      <>
        <PageHeader eyebrow="Équipe & accès" title="Chacun son rôle." />
        <ForbiddenState description="La liste de l'équipe est réservée aux rôles d'organisation. Demandez l'accès à une personne administratrice." />
      </>
    );
  }
  const canInvite = ctx.can("members.invite");
  const canManage = ctx.can("members.manage");
  const actorIsOwner = ctx.member.organizationRoles.includes("owner");
  const org = ctx.organization;
  const [members, invitations] = await Promise.all([
    listMembers(db(), ctx.session.actor, org.id),
    canInvite ? listInvitations(db(), ctx.session.actor, org.id) : Promise.resolve([]),
  ]);
  const pending = invitations.filter((i) => i.status === "pending" || i.status === "expired");
  const owners = members.filter((m) => m.grants.some((g) => g.role === "owner" && g.eventId === null)).length;

  return (
    <>
      <PageHeader
        eyebrow="Équipe & accès"
        title="Chacun son rôle. Ensemble, le contrôle."
        description="Les rôles s'appliquent à votre organisation. Les périmètres par événement arriveront avec les événements."
      />

      <Panel>
        <PanelTitle>Votre équipe</PanelTitle>
        <TableContainer label="Membres de l'organisation" className="border-0 bg-transparent">
          <Table>
            <THead>
              <TR>
                <TH>Membre</TH>
                <TH>Rôles</TH>
                <TH>Périmètre</TH>
                <TH>État</TH>
                <TH>
                  <span className="k-sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => {
                const isSelf = m.userId === ctx.session.user.id;
                const isOwner = m.grants.some((g) => g.role === "owner" && g.eventId === null);
                return (
                  <TR key={m.id}>
                    <TD>
                      <Person name={m.name} secondary={m.email} tone={isOwner ? "lime" : "lavender"} />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {m.grants.length === 0 ? <Badge tone="neutral">Aucun rôle</Badge> : null}
                        {m.grants.map((g) => (
                          <Badge
                            key={`${g.role}-${g.eventId ?? "org"}`}
                            tone={g.role === "owner" ? "lime" : "neutral"}
                            noDot
                          >
                            {roleLabel(g.role)}
                          </Badge>
                        ))}
                      </div>
                    </TD>
                    <TD>{m.grants.some((g) => g.eventId) ? "Événements attribués" : "Organisation"}</TD>
                    <TD>
                      {m.emailVerified ? (
                        <Badge tone="lime">Actif</Badge>
                      ) : (
                        <Badge tone="orange">E-mail à confirmer</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      {isSelf ? (
                        <span className="text-muted">Vous</span>
                      ) : canManage ? (
                        <MemberActions
                          organizationId={org.id}
                          slug={org.slug}
                          member={{
                            id: m.id,
                            name: m.name,
                            roles: m.grants.filter((g) => !g.eventId).map((g) => g.role),
                          }}
                          actorIsOwner={actorIsOwner}
                          targetIsLastOwner={isOwner && owners <= 1}
                        />
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      </Panel>

      {canInvite ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel>
            <PanelTitle>Inviter un membre</PanelTitle>
            <InviteForm organizationId={org.id} slug={org.slug} actorIsOwner={actorIsOwner} />
          </Panel>
          <Panel>
            <PanelTitle>Invitations en attente</PanelTitle>
            {pending.length === 0 ? (
              <p className="text-[13px] text-muted">
                Aucune invitation en attente. Les invitations acceptées rejoignent l'équipe ci-dessus.
              </p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {pending.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{inv.email}</div>
                      <div className="text-[11px] text-muted">
                        {roleLabel(inv.role)} · {inv.status === "expired" ? "expirée le" : "expire le"}{" "}
                        {formatDate(inv.expiresAt, org.timezone)} · invitée par {inv.invitedByName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.status === "expired" ? (
                        <Badge tone="orange">Expirée</Badge>
                      ) : (
                        <Badge tone="orange">Invitation envoyée</Badge>
                      )}
                      <InvitationActions
                        organizationId={org.id}
                        slug={org.slug}
                        invitationId={inv.id}
                        email={inv.email}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
