import { findDuplicates, listContacts, listTags } from "@kroov/domain/crm";
import { listEvents } from "@kroov/domain/events";
import { formatDateFr } from "@kroov/domain/kernel";
import { ForbiddenState, PageHeader, Panel, PanelTitle, Stat, StatGrid } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { ContactsFilters, type ContactsTab } from "./filters";
import { ContactsTable, DuplicatesPanel, HeaderActions, TagsPanel } from "./panels";

export const metadata: Metadata = { title: "Contacts" };

const MARKETING = new Set(["none", "opted_in", "customer_only", "withdrawn", "suppressed"]);
const SOURCES = new Set(["order", "membership", "volunteer_application", "schedule", "staff", "public_form", "import"]);

/** Contacts — vue unifiée par organisation : indicateurs, recherche, filtres, export, étiquettes, doublons. */
export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    consentement?: string;
    etiquette?: string;
    source?: string;
    evenement?: string;
    statut?: string;
    page?: string;
    onglet?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadOrgPage(slug, `/o/${slug}/contacts`);
  if (!ctx.can("contacts.read")) {
    return (
      <>
        <PageHeader eyebrow="Contacts" title="Une base, une organisation." />
        <ForbiddenState description="La base de contacts est réservée aux personnes disposant du droit « consulter les contacts »." />
      </>
    );
  }
  const actor = ctx.session.actor;
  const org = ctx.organization;
  const canManage = ctx.can("contacts.manage");
  const canExport = ctx.can("contacts.export");
  const tab: ContactsTab =
    sp.onglet === "etiquettes" ? "etiquettes" : sp.onglet === "doublons" ? "doublons" : "contacts";
  const [tags, events] = await Promise.all([
    listTags(db(), actor, org.id),
    ctx.can("events.read") ? listEvents(db(), actor, org.id, { status: "all" }) : Promise.resolve([]),
  ]);
  const marketing = MARKETING.has(sp.consentement ?? "") ? (sp.consentement as "opted_in") : undefined;
  const source = SOURCES.has(sp.source ?? "") ? (sp.source as "order") : undefined;
  const tagId = sp.etiquette && tags.some((t) => t.id === sp.etiquette) ? sp.etiquette : undefined;
  const eventId = sp.evenement && events.some((e) => e.id === sp.evenement) ? sp.evenement : undefined;
  const status = sp.statut === "archived" ? "archived" : "active";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const filters = {
    ...(sp.q ? { q: sp.q } : {}),
    ...(marketing ? { marketing } : {}),
    ...(source ? { source } : {}),
    ...(tagId ? { tagId } : {}),
    ...(eventId ? { eventId } : {}),
    status,
    page,
    pageSize: 25,
  } as const;
  const list = await listContacts(db(), actor, org.id, filters);
  const duplicates = tab === "doublons" ? await findDuplicates(db(), actor, org.id) : [];
  const exportQs = new URLSearchParams();
  if (sp.q) exportQs.set("q", sp.q);
  if (marketing) exportQs.set("marketing", marketing);
  if (source) exportQs.set("source", source);
  if (tagId) exportQs.set("tagId", tagId);
  if (eventId) exportQs.set("eventId", eventId);
  if (status !== "active") exportQs.set("status", status);
  const panelCtx = { organizationId: org.id, slug };
  const filtered = Boolean(sp.q || marketing || source || tagId || eventId);

  return (
    <>
      <PageHeader
        eyebrow="Contacts"
        title="Une base, une organisation."
        description="Nourrie automatiquement par les commandes, adhésions, candidatures et missions. Jamais partagée avec une autre organisation."
        actions={
          <HeaderActions
            ctx={panelCtx}
            canManage={canManage}
            canExport={canExport}
            exportHref={`/api/v1/organizations/${org.id}/contacts/export${exportQs.size ? `?${exportQs}` : ""}`}
            exportCount={list.total}
          />
        }
      />
      <StatGrid>
        <Stat
          label="Contacts actifs"
          value={String(list.stats.total)}
          hint={`${list.stats.withAccount} avec un compte`}
        />
        <Stat
          tone="lime"
          label="Consentis (e-mail)"
          value={String(list.stats.optedIn)}
          hint="Case cochée ou consentement saisi avec preuve"
        />
        <Stat
          tone="lavender"
          label="Client·es sans consentement"
          value={String(list.stats.customerOnly)}
          hint="Achat ou adhésion ≠ consentement marketing"
        />
        <Stat
          tone="orange"
          label="Exclu·es"
          value={String(list.stats.suppressed)}
          hint={`${list.stats.newLast30Days} nouveau(x) contact(s) sur 30 jours`}
        />
      </StatGrid>

      <ContactsFilters
        slug={slug}
        tab={tab}
        q={sp.q ?? ""}
        marketing={marketing ?? ""}
        source={source ?? ""}
        tagId={tagId ?? ""}
        eventId={eventId ?? ""}
        status={status}
        tags={tags.map((t) => ({ id: t.id, name: t.name }))}
        events={events.map((e) => ({ id: e.id, title: e.title }))}
      />

      {tab === "contacts" ? (
        <Panel>
          <PanelTitle>
            Contacts{" "}
            <span className="text-[13px] font-normal text-muted">
              · {list.total} résultat(s){filtered ? " filtrés" : ""}
            </span>
          </PanelTitle>
          <ContactsTable
            slug={slug}
            rows={list.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              status: c.status,
              marketing: c.marketingEmailStatus,
              source: c.source,
              tags: c.tags,
              ordersCount: c.ordersCount,
              membershipsCount: c.membershipsCount,
              applicationsCount: c.applicationsCount,
              missionsCount: c.missionsCount,
              hasAccount: c.hasAccount,
              lastActivity: c.lastActivityAt ? formatDateFr(c.lastActivityAt, org.timezone) : "—",
            }))}
            emptyDescription={
              filtered
                ? "Aucun contact ne correspond à ce filtre."
                : "Les contacts apparaissent dès la première commande payée, adhésion ou candidature. Vous pouvez aussi en créer à la main."
            }
          />
          {list.total > list.pageSize ? (
            <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-[13px]">
              <span className="text-muted">
                Page {list.page} / {Math.ceil(list.total / list.pageSize)}
              </span>
              <span className="flex gap-3">
                {list.page > 1 ? (
                  <Link href={pageHref(slug, sp, list.page - 1)} className="font-bold underline underline-offset-4">
                    ← Précédente
                  </Link>
                ) : null}
                {list.page * list.pageSize < list.total ? (
                  <Link href={pageHref(slug, sp, list.page + 1)} className="font-bold underline underline-offset-4">
                    Suivante →
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </Panel>
      ) : tab === "etiquettes" ? (
        <TagsPanel ctx={panelCtx} canManage={canManage} tags={tags} />
      ) : (
        <DuplicatesPanel slug={slug} groups={duplicates} />
      )}
    </>
  );
}

function pageHref(slug: string, sp: Record<string, string | undefined>, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
  p.set("page", String(page));
  return `/o/${slug}/contacts?${p}`;
}
