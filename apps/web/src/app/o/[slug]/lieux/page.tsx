import { listLocations } from "@kroov/domain/events";
import { ForbiddenState, PageHeader, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";
import { LocationForm } from "./location-form";

export const metadata: Metadata = { title: "Lieux" };

export default async function LocationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadOrgPage(slug, `/o/${slug}/lieux`);
  if (!ctx.can("events.read")) {
    return (
      <>
        <PageHeader eyebrow="Événements" title="Lieux" />
        <ForbiddenState description="Les lieux sont visibles des rôles d'organisation ayant accès aux événements." />
      </>
    );
  }
  const locations = await listLocations(db(), ctx.session.actor, ctx.organization.id);
  const canEdit = ctx.can("events.update");

  return (
    <>
      <PageHeader
        eyebrow="Événements"
        title="Vos lieux"
        description="Salles, terrasses, parcs : enregistrez-les une fois, réutilisez-les pour chaque événement."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel>
          <PanelTitle>Lieux enregistrés</PanelTitle>
          {locations.length === 0 ? (
            <p className="text-[13px] text-muted">
              Aucun lieu pour le moment. Ajoutez-en un pour pouvoir publier un événement.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {locations.map((l) => (
                <li key={l.id} className="py-3 text-[13px]">
                  <b>{l.name}</b>
                  <span className="block text-muted">
                    {[l.addressLine1, l.addressLine2, [l.postalCode, l.city].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", ")}{" "}
                    · {l.country}
                  </span>
                  {l.accessNotes ? <span className="block text-muted">{l.accessNotes}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {canEdit ? (
          <Panel>
            <PanelTitle>Ajouter un lieu</PanelTitle>
            <LocationForm organizationId={ctx.organization.id} slug={slug} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
