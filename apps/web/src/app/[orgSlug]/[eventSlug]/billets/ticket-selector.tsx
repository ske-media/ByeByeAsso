"use client";

import { Alert, Button, FormField, Input, Panel } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fmtMinor } from "@/lib/money";
import { AttributionKeeper, currentAttribution } from "../attribution";

export interface SelectableType {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  unitFeeMinor: number;
  minPerOrder: number;
  maxPerOrder: number;
  available: number | null;
  saleState: "upcoming" | "on_sale" | "ended" | "sold_out";
  salesStartLabel: string | null;
  membersOnly: boolean;
}

/** Écran 28 — Choix des billets : quantités, disponibilité, frais annoncés, total. */
export function TicketSelector({
  organizationSlug,
  eventSlug,
  types,
  currency,
  maxTicketsPerOrder,
}: {
  organizationSlug: string;
  eventSlug: string;
  types: SelectableType[];
  currency: string;
  maxTicketsPerOrder: number;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const needsMemberEmail = types.some((t) => t.membersOnly && (qty[t.id] ?? 0) > 0);
  const total = useMemo(() => {
    let subtotal = 0;
    let fees = 0;
    let count = 0;
    for (const t of types) {
      const n = qty[t.id] ?? 0;
      subtotal += n * t.priceMinor;
      fees += n * t.unitFeeMinor;
      count += n;
    }
    return { subtotal, fees, count, total: subtotal + fees };
  }, [qty, types]);

  const set = (t: SelectableType, next: number) => {
    const max = Math.min(t.maxPerOrder, t.available ?? t.maxPerOrder);
    const clamped = Math.max(0, Math.min(max, next));
    // Respect the type minimum: jumping from 0 goes straight to min.
    const value = clamped > 0 && clamped < t.minPerOrder ? (next > (qty[t.id] ?? 0) ? t.minPerOrder : 0) : clamped;
    setQty((q) => ({ ...q, [t.id]: value }));
    setError(null);
  };

  const submit = async () => {
    const items = types
      .filter((t) => (qty[t.id] ?? 0) > 0)
      .map((t) => ({ ticketTypeId: t.id, quantity: qty[t.id] ?? 0 }));
    if (items.length === 0) {
      setError("Choisissez au moins un billet.");
      return;
    }
    if (total.count > maxTicketsPerOrder) {
      setError(`Au plus ${maxTicketsPerOrder} billets par commande.`);
      return;
    }
    if (needsMemberEmail && !memberEmail.trim()) {
      setError("Indiquez l'e-mail de votre adhésion pour les tarifs réservés aux adhérents.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "kroov" },
        body: JSON.stringify({
          organizationSlug,
          eventSlug,
          items,
          ...(needsMemberEmail ? { email: memberEmail.trim() } : {}),
          ...(currentAttribution() ? { attribution: currentAttribution() } : {}),
        }),
      });
      const json = (await res.json()) as { data?: { id: string; accessToken: string }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "Impossible de réserver ces places pour l'instant.");
        router.refresh(); // live availability
        return;
      }
      router.push(`/commande/${json.data.id}?k=${encodeURIComponent(json.data.accessToken)}`);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <AttributionKeeper />
      {types.map((t) => {
        const n = qty[t.id] ?? 0;
        const disabled = t.saleState !== "on_sale";
        return (
          <Panel key={t.id} className={disabled ? "opacity-70" : n > 0 ? "border-ink bg-[#fbffe0]" : ""}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-panel-title font-bold">
                  {t.name}
                  {t.membersOnly ? (
                    <span className="ml-2 inline-block rounded-[5px] bg-lavender px-2 py-0.5 align-middle text-[10px] font-bold uppercase">
                      Réservé aux adhérents
                    </span>
                  ) : null}
                </h2>
                {t.description ? <p className="text-[12px] text-muted">{t.description}</p> : null}
                <p className="mt-2 text-[15px] font-bold">
                  {t.priceMinor === 0 ? "Gratuit" : fmtMinor(t.priceMinor, currency)}
                  {t.unitFeeMinor > 0 ? (
                    <span className="block text-[11px] font-normal text-muted">
                      + {fmtMinor(t.unitFeeMinor, currency)} de frais / billet
                    </span>
                  ) : null}
                </p>
              </div>
              {disabled ? (
                <span className="shrink-0 rounded-[5px] bg-neutral px-2 py-1 text-[10px] font-bold">
                  {t.saleState === "sold_out"
                    ? "Épuisé"
                    : t.saleState === "ended"
                      ? "Ventes terminées"
                      : `Dès le ${t.salesStartLabel ?? "—"}`}
                </span>
              ) : (
                <fieldset className="m-0 flex shrink-0 items-center rounded-[9px] border-[1.5px] border-ink p-0">
                  <legend className="k-sr-only">Quantité pour {t.name}</legend>
                  <button
                    type="button"
                    className="min-h-touch px-3 text-[18px] font-bold"
                    onClick={() => set(t, n - 1)}
                    aria-label="Retirer un billet"
                    disabled={n === 0}
                  >
                    −
                  </button>
                  <span className="min-w-8 text-center text-[16px] font-bold" aria-live="polite">
                    {n}
                  </span>
                  <button
                    type="button"
                    className="min-h-touch px-3 text-[18px] font-bold"
                    onClick={() => set(t, n + 1)}
                    aria-label="Ajouter un billet"
                    disabled={n >= Math.min(t.maxPerOrder, t.available ?? t.maxPerOrder)}
                  >
                    +
                  </button>
                </fieldset>
              )}
            </div>
            {!disabled ? (
              <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
                {t.available !== null
                  ? `${t.available} place${t.available > 1 ? "s" : ""} restante${t.available > 1 ? "s" : ""} · `
                  : ""}
                {t.maxPerOrder} billets maximum
              </p>
            ) : null}
          </Panel>
        );
      })}

      <Panel>
        <h2 className="text-panel-title font-bold">Votre commande</h2>
        {total.count === 0 ? (
          <p className="text-[13px] text-muted">Aucun billet sélectionné.</p>
        ) : (
          <dl className="m-0 divide-y divide-border text-[13px]">
            {types
              .filter((t) => (qty[t.id] ?? 0) > 0)
              .map((t) => (
                <div key={t.id} className="flex justify-between py-2">
                  <dt>
                    {qty[t.id]} × {t.name}
                  </dt>
                  <dd className="m-0">{fmtMinor((qty[t.id] ?? 0) * t.priceMinor, currency)}</dd>
                </div>
              ))}
            {total.fees > 0 ? (
              <div className="flex justify-between py-2">
                <dt>Frais de service</dt>
                <dd className="m-0">{fmtMinor(total.fees, currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between py-2 font-bold">
              <dt>Total à payer</dt>
              <dd className="m-0">{fmtMinor(total.total, currency)}</dd>
            </div>
          </dl>
        )}
      </Panel>
      {needsMemberEmail ? (
        <Panel>
          <h2 className="text-panel-title font-bold">Tarif adhérent</h2>
          <p className="text-[12px] text-muted">
            Votre adhésion est vérifiée à cette adresse avant la réservation. Elle devra aussi être l'adresse de la
            commande.
          </p>
          <FormField label="E-mail de votre adhésion" required className="mt-2">
            <Input
              type="email"
              name="memberEmail"
              autoComplete="email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="vous@exemple.fr"
            />
          </FormField>
        </Panel>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p className="rounded-[9px] bg-lavender px-3 py-2 text-[12px]">
        Vos places seront réservées pendant 10 minutes à l'étape suivante.
      </p>
      <Button
        variant="primary"
        className="w-full"
        loading={pending}
        loadingLabel="Réservation"
        disabled={total.count === 0}
        disabledReason="Choisissez au moins un billet."
        onClick={() => void submit()}
      >
        Continuer{total.count > 0 ? ` · ${fmtMinor(total.total, currency)}` : ""} →
      </Button>
      <p className="text-center text-[11px] text-muted">Achat possible sans créer de compte.</p>
    </div>
  );
}
