import { getContact, listTags } from "@kroov/domain/crm";
import { formatDateFr, formatTimeFr, isDomainError } from "@kroov/domain/kernel";
import { Badge, ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { MARKETING_LABELS, MARKETING_TONE, SOURCE_LABELS } from "../labels";
import { TagChip } from "../panels";
import { ConsentPanel, ContactActions, IdentityPanel, MergePanel, NotesPanel, TagsSelector } from "./contact-panels";

export const metadata: Metadata = { title: "Contact" };

/** Fiche contact 360° : identités, consentement avec journal, étiquettes, notes, historique, fusion. */
export default async function ContactPage({ params }: { params: Promise<{ slug: string; contactId: string }> }) {
  const { slug, contactId } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts/${contactId}`);
  if (!ctx.can("contacts.read")) {
    return (
      <>
        <PageHeader eyebrow="Contacts" title="Accès réservé." />
        <ForbiddenState description="La base de contacts est réservée aux personnes disposant du droit « consulter les contacts »." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const org = ctx.organization;
  const canManage = ctx.can("contacts.manage");
  let contact: Awaited<ReturnType<typeof getContact>>;
  try {
    contact = await getContact(db(), actor, org.id, contactId);
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  }
  const tags = await listTags(db(), actor, org.id);
  const tz = org.timezone;
  const panelCtx = { organizationId: org.id, slug };
  const when = (d: Date) => `${formatDateFr(d, tz)} · ${formatTimeFr(d, tz)}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${slug}/contacts`} className="underline underline-offset-4">
            ← Contacts
          </Link>
        }
        title={contact.name}
        description={`${contact.email}${contact.city ? ` · ${contact.city}` : ""} · ${SOURCE_LABELS[contact.source] ?? contact.source} · depuis le ${formatDateFr(contact.firstSeenAt, tz)}`}
        actions={
          canManage ? (
            <ContactActions
              ctx={panelCtx}
              contact={{
                id: contact.id,
                status: contact.status,
                version: contact.version,
                email: contact.email,
                firstName: contact.firstName,
                lastName: contact.lastName,
                phone: contact.phone,
                city: contact.city,
              }}
            />
          ) : null
        }
      />
      {contact.status === "merged" ? (
        <Panel className="mb-5 bg-neutral">
          <PanelTitle>Fiche fusionnée</PanelTitle>
          <p className="text-[13px]">
            Cette fiche a été rattachée à{" "}
            <Link
              href={`/o/${slug}/contacts/${contact.mergedIntoContactId}`}
              className="font-bold underline underline-offset-4"
            >
              une autre fiche
            </Link>
            . Elle est conservée en lecture seule pour la traçabilité.
          </p>
        </Panel>
      ) : null}
      {contact.status === "archived" ? (
        <Panel className="mb-5 bg-neutral">
          <PanelTitle>Fiche archivée</PanelTitle>
          <p className="text-[13px]">
            Absente des listes et des segments ; restaurée automatiquement à la prochaine activité.
          </p>
        </Panel>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Consentement e-mail</PanelTitle>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={MARKETING_TONE[contact.marketingEmailStatus]}>
                {MARKETING_LABELS[contact.marketingEmailStatus]}
              </Badge>
              {contact.suppression ? (
                <span className="text-[12px] text-muted">
                  Exclusion active depuis le {formatDateFr(contact.suppression.createdAt, tz)} —{" "}
                  <Link href={`/o/${slug}/contacts/exclusions`} className="underline underline-offset-4">
                    gérer les exclusions
                  </Link>
                </span>
              ) : null}
            </div>
            <ConsentPanel
              ctx={panelCtx}
              contactId={contact.id}
              canManage={canManage && contact.status !== "merged"}
              records={contact.consents.map((c) => ({
                id: c.id,
                status: c.status,
                basis: c.basis,
                source: c.source,
                evidence: c.evidence,
                when: when(c.occurredAt),
                recordedBy: c.recordedBy,
              }))}
            />
          </Panel>
          <Panel>
            <PanelTitle>Historique</PanelTitle>
            <p className="text-[12px] text-muted">
              {[
                `${contact.ordersCount} commande(s)`,
                `${contact.ticketsCount} billet(s)`,
                `${contact.membershipsCount} adhésion(s)`,
                `${contact.applicationsCount} candidature(s)`,
                `${contact.missionsCount} mission(s) publiée(s)`,
              ].join(" · ")}
            </p>
            {contact.timeline.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Aucune activité enregistrée pour cette adresse.</p>
            ) : (
              <ol className="m-0 mt-3 list-none divide-y divide-border p-0">
                {contact.timeline.map((e) => (
                  <li key={e.key} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[150px_1fr]">
                    <span className="text-[12px] text-muted">{when(e.at)}</span>
                    <span>
                      {e.href ? (
                        <Link href={`/o/${slug}/${e.href}`} className="font-bold underline underline-offset-4">
                          {e.title}
                        </Link>
                      ) : (
                        <b>{e.title}</b>
                      )}
                      {e.detail ? <span className="block text-[12px] text-muted">{e.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <NotesPanel
            ctx={panelCtx}
            contactId={contact.id}
            canManage={canManage}
            notes={contact.notes.map((n) => ({ ...n, when: when(n.createdAt) }))}
          />
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelTitle>Identités</PanelTitle>
            <IdentityPanel identities={contact.identities} phone={contact.phone} hasAccount={contact.userId !== null} />
          </Panel>
          <Panel>
            <PanelTitle>Étiquettes</PanelTitle>
            {canManage && contact.status !== "merged" ? (
              <TagsSelector
                ctx={panelCtx}
                contactId={contact.id}
                all={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
                selected={contact.tags.map((t) => t.id)}
              />
            ) : contact.tags.length === 0 ? (
              <p className="text-[13px] text-muted">Aucune étiquette.</p>
            ) : (
              <span className="flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </span>
            )}
          </Panel>
          {canManage && contact.status === "active" ? (
            <Panel>
              <PanelTitle>Fusionner un doublon</PanelTitle>
              <MergePanel ctx={panelCtx} survivorId={contact.id} survivorName={contact.name} />
            </Panel>
          ) : null}
          {contact.merges.length > 0 ? (
            <Panel>
              <PanelTitle>Fusions</PanelTitle>
              <ul className="m-0 list-none p-0 text-[13px]">
                {contact.merges.map((m) => (
                  <li key={m.id} className="py-1">
                    <b>{m.mergedEmail}</b> rattaché·e le {formatDateFr(m.createdAt, tz)}
                    {m.reason ? <span className="block text-[12px] text-muted">{m.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
