"use client";

import { Alert, Button, FormField, Input, Panel, PanelTitle, Select, Textarea } from "@kroov/ui";
import { useActionState, useState } from "react";
import { savePlanAction } from "@/actions/memberships";
import { idleState } from "@/lib/action-state";
import { fmtMinor } from "@/lib/money";

export interface PlanFormInitial {
  name: string;
  slug: string;
  description: string;
  price: string;
  periodKind: "fixed" | "rolling";
  validFrom: string;
  validUntil: string;
  durationMonths: string;
  requiresReview: boolean;
  maxMembers: string;
  public: boolean;
  position: string;
  benefits: string;
}

/** Écran 18 — formulaire de formule + aperçu public vivant. */
export function PlanForm({
  organizationId,
  slug,
  organizationName,
  timezone,
  currency,
  planId,
  initial,
}: {
  organizationId: string;
  slug: string;
  organizationName: string;
  timezone: string;
  currency: string;
  planId: string | null;
  initial: PlanFormInitial;
}) {
  const [state, action, pending] = useActionState(
    savePlanAction.bind(null, organizationId, slug, timezone, planId),
    idleState,
  );
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const str = (k: keyof PlanFormInitial) => v[k] ?? String(initial[k] ?? "");
  const [name, setName] = useState(str("name"));
  const [price, setPrice] = useState(str("price"));
  const [periodKind, setPeriodKind] = useState<"fixed" | "rolling">(
    (v.periodKind as "fixed" | "rolling") ?? initial.periodKind,
  );
  const [validUntil, setValidUntil] = useState(str("validUntil"));
  const [duration, setDuration] = useState(str("durationMonths") || "12");
  const [benefits, setBenefits] = useState(str("benefits"));
  const priceMinor = Math.round(Number(price.replace(",", ".")) * 100) || 0;
  return (
    <form action={action} noValidate className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
        {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
          <Alert tone="error" heading="Enregistrement impossible">
            {state.message}
          </Alert>
        ) : null}
        <Panel>
          <PanelTitle>La formule</PanelTitle>
          <FormField label="Nom" required error={errors.name}>
            <Input
              name="name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Adhésion annuelle 2027"
            />
          </FormField>
          <FormField label={`Montant (${currency})`} required hint="0 = adhésion gratuite." error={errors.price}>
            <Input name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </FormField>
          <FormField label="Période" required error={errors.periodKind}>
            <Select
              name="periodKind"
              value={periodKind}
              onChange={(e) => setPeriodKind(e.target.value as "fixed" | "rolling")}
            >
              <option value="fixed">Saison à dates fixes</option>
              <option value="rolling">Durée glissante à partir de l'activation</option>
            </Select>
          </FormField>
          {periodKind === "fixed" ? (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FormField label="Début de validité" required error={errors.validFrom}>
                <Input type="date" name="validFrom" defaultValue={str("validFrom")} />
              </FormField>
              <FormField label="Fin de validité" required error={errors.validUntil}>
                <Input
                  type="date"
                  name="validUntil"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </FormField>
            </div>
          ) : (
            <FormField label="Durée (mois)" required error={errors.durationMonths}>
              <Input
                type="number"
                name="durationMonths"
                min={1}
                max={60}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </FormField>
          )}
          <FormField label="Description" error={errors.description}>
            <Textarea
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={str("description")}
              placeholder="Soutenez les projets du collectif, participez aux assemblées…"
            />
          </FormField>
          <FormField
            label="Avantages"
            hint="Un avantage par ligne (affichés sur la page publique)."
            error={errors.benefits}
          >
            <Textarea
              name="benefits"
              rows={3}
              value={benefits}
              onChange={(e) => setBenefits(e.target.value)}
              placeholder={"Soutenir les projets de l'association\nParticiper aux assemblées"}
            />
          </FormField>
        </Panel>
        <Panel>
          <PanelTitle>Règles</PanelTitle>
          <label className="flex items-start justify-between gap-3 py-2 text-[13px]">
            <span>
              Revue des demandes
              <span className="block text-muted">
                Chaque candidature est approuvée ou refusée à la main avant activation / paiement.
              </span>
            </span>
            <input
              type="checkbox"
              name="requiresReview"
              defaultChecked={state.status === "error" ? v.requiresReview === "on" : initial.requiresReview}
              className="mt-1 size-5 accent-ink"
            />
          </label>
          <label className="flex items-start justify-between gap-3 py-2 text-[13px]">
            <span>
              Visible sur la page publique
              <span className="block text-muted">Décochée : réservée aux renouvellements et aux liens directs.</span>
            </span>
            <input
              type="checkbox"
              name="public"
              defaultChecked={state.status === "error" ? v.public === "on" : initial.public}
              className="mt-1 size-5 accent-ink"
            />
          </label>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <FormField label="Nombre max. d'adhérents" hint="Vide = illimité." error={errors.maxMembers}>
              <Input type="number" name="maxMembers" min={1} defaultValue={str("maxMembers")} />
            </FormField>
            <FormField label="Identifiant d'adresse" hint="Dérivé du nom si vide." error={errors.slug}>
              <Input name="slug" maxLength={63} defaultValue={str("slug")} />
            </FormField>
            <FormField label="Ordre" error={errors.position}>
              <Input type="number" name="position" min={0} defaultValue={str("position") || "0"} />
            </FormField>
          </div>
          <p className="text-[12px] text-muted">
            Nom, prénom et e-mail sont obligatoires à la demande ; l'accord pour recevoir les actualités est facultatif.
            Pas de renouvellement automatique.
          </p>
        </Panel>
      </div>
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Panel className="bg-lavender">
          <PanelTitle>Aperçu public</PanelTitle>
          <p className="text-eyebrow font-extrabold uppercase">{organizationName}</p>
          <p className="mt-2 text-[26px] font-black uppercase leading-[1]">On fait collectif.</p>
          <p className="mt-3 text-[36px] font-black leading-none">
            {priceMinor === 0 ? "Gratuit" : fmtMinor(priceMinor, currency)}
          </p>
          <p className="text-[13px] text-muted">{name || "Nom de la formule"}</p>
          <p className="mt-2 text-[13px]">
            {periodKind === "fixed"
              ? validUntil
                ? `Valable jusqu'au ${new Date(`${validUntil}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`
                : "Valable sur la saison."
              : `Valable ${duration || "12"} mois à partir de l'activation.`}
            <span className="block">Sans renouvellement automatique.</span>
          </p>
          {benefits.trim() ? (
            <ul className="m-0 mt-3 list-none p-0 text-[13px]">
              {benefits
                .split("\n")
                .filter((b) => b.trim())
                .map((b) => (
                  <li key={b}>✓ {b.trim()}</li>
                ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px] text-muted">L'accès aux événements nécessite un billet séparé.</p>
        </Panel>
        <Button type="submit" variant="primary" className="w-full" loading={pending} loadingLabel="Enregistrement">
          Enregistrer la formule
        </Button>
      </aside>
    </form>
  );
}
