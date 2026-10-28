"use client";

import { Alert, Button, FormField, Input, Panel } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtMinor } from "@/lib/money";

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  feeMinor: number;
  currency: string;
  periodLabel: string;
  requiresReview: boolean;
  benefits: string[];
  remaining: number | null;
}

/** Écran 35 — choisir une formule puis renseigner nom, prénom, e-mail. Sans compte. */
export function ApplyForm({
  organizationSlug,
  plans,
  defaults,
}: {
  organizationSlug: string;
  plans: PublicPlan[];
  defaults: { email: string; firstName: string; lastName: string };
}) {
  const router = useRouter();
  const [planId, setPlanId] = useState<string>(plans.length === 1 ? (plans[0]?.id ?? "") : "");
  const [email, setEmail] = useState(defaults.email);
  const [firstName, setFirstName] = useState(defaults.firstName);
  const [lastName, setLastName] = useState(defaults.lastName);
  const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const plan = plans.find((p) => p.id === planId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan) {
      setError("Choisissez une formule.");
      return;
    }
    if (!email.trim() || !firstName.trim() || !lastName.trim()) {
      setError("Nom, prénom et e-mail sont nécessaires pour établir la carte d'adhérent.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/organizations/${organizationSlug}/membership-applications`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "kroov" },
        body: JSON.stringify({ planId: plan.id, email: email.trim(), firstName, lastName, marketingOptIn: optIn }),
      });
      const json = (await res.json()) as {
        data?: { id: string; accessToken: string };
        error?: { message?: string; details?: { code?: string } };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "Impossible d'enregistrer la demande pour l'instant.");
        router.refresh();
        return;
      }
      router.push(`/adhesion/${json.data.id}?k=${encodeURIComponent(json.data.accessToken)}&nouveau=1`);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <fieldset className="m-0 space-y-3 border-0 p-0">
        <legend className="text-panel-title font-bold">1. Choisir une formule</legend>
        {plans.map((p) => {
          const full = p.remaining !== null && p.remaining <= 0;
          const selected = planId === p.id;
          return (
            <label key={p.id} className="block cursor-pointer">
              <input
                type="radio"
                name="planId"
                value={p.id}
                checked={selected}
                disabled={full}
                onChange={() => {
                  setPlanId(p.id);
                  setError(null);
                }}
                className="k-sr-only"
              />
              <Panel className={full ? "opacity-70" : selected ? "border-ink bg-[#fbffe0]" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-panel-title font-bold">{p.name}</h2>
                    {p.description ? <p className="text-[12px] text-muted">{p.description}</p> : null}
                    <p className="mt-2 text-[15px] font-bold">
                      {p.priceMinor === 0 ? "Gratuit" : fmtMinor(p.priceMinor, p.currency)}
                      {p.feeMinor > 0 ? (
                        <span className="block text-[11px] font-normal text-muted">
                          + {fmtMinor(p.feeMinor, p.currency)} de frais de service
                        </span>
                      ) : null}
                      <span className="block text-[11px] font-normal text-muted">{p.periodLabel}</span>
                    </p>
                    {p.benefits.length > 0 ? (
                      <ul className="m-0 mt-2 list-none p-0 text-[12px]">
                        {p.benefits.map((b) => (
                          <li key={b}>✓ {b}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <span
                    aria-hidden="true"
                    className={`mt-1 size-5 shrink-0 rounded-full border-[2px] border-ink ${selected ? "bg-ink" : ""}`}
                  />
                </div>
                <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
                  {full
                    ? "Complet pour le moment."
                    : p.requiresReview
                      ? "Demande examinée par l'organisation avant activation."
                      : p.priceMinor === 0
                        ? "Activation immédiate."
                        : "Activation dès le paiement de la cotisation."}
                  {p.remaining !== null && !full ? ` · ${p.remaining} place(s) restante(s)` : ""}
                </p>
              </Panel>
            </label>
          );
        })}
      </fieldset>

      <Panel>
        <h2 className="text-panel-title font-bold">2. Vos coordonnées</h2>
        <p className="text-[12px] text-muted">Elles figurent sur la carte d'adhérent. Aucun compte à créer.</p>
        <div className="mt-2 grid gap-x-3 sm:grid-cols-2">
          <FormField label="Prénom" required>
            <Input
              name="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </FormField>
          <FormField label="Nom" required>
            <Input
              name="lastName"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="E-mail" required hint="Votre carte et vos renouvellements arrivent à cette adresse.">
          <Input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <label className="flex items-start gap-2 py-2 text-[13px]">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-1 size-4 accent-ink"
          />
          <span>J'accepte de recevoir les actualités de l'organisation (facultatif).</span>
        </label>
      </Panel>

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" variant="primary" className="w-full" loading={pending} loadingLabel="Envoi">
        {plan
          ? plan.requiresReview
            ? "Envoyer ma demande"
            : plan.priceMinor === 0
              ? "Adhérer gratuitement"
              : `Adhérer · ${fmtMinor(plan.priceMinor + plan.feeMinor, plan.currency)} →`
          : "Choisir une formule"}
      </Button>
      <p className="text-center text-[11px] text-muted">
        Sans renouvellement automatique. L'accès aux événements nécessite un billet séparé.
      </p>
    </form>
  );
}
