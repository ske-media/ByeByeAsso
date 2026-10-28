"use client";

import { Alert, Button, FormField, Input, Panel } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtMinor } from "@/lib/money";

interface OrderForForm {
  id: string;
  number: string;
  status: string;
  expiresAt: string | null;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  feesMinor: number;
  totalMinor: number;
  promoCode: string | null;
  nominative: boolean;
  buyer: { email: string; firstName: string | null; lastName: string | null };
  items: Array<{ ticketTypeId: string; label: string; quantity: number; unitPriceMinor: number }>;
  tickets: Array<{ id: string; number: string; ticketTypeId: string; typeLabel: string; attendeeName: string | null }>;
  marketingOptIn: boolean;
  organizationName: string;
}

export function Countdown({ expiresAt, label }: { expiresAt: string; label: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setLeft(next);
      if (next === 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <p
      className={`rounded-[9px] px-3 py-2 text-[13px] font-bold ${left < 120_000 ? "bg-orange" : "bg-lime"}`}
      aria-live="polite"
    >
      ⏱ {label} · {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </p>
  );
}

/** Écran 29 (+ 33 : réessai après refus). */
export function CheckoutForm({
  order,
  accessToken,
  retry,
}: {
  order: OrderForForm;
  accessToken: string;
  retry: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(order.buyer.email.endsWith("@kroov.invalid") ? "" : order.buyer.email);
  const [firstName, setFirstName] = useState(order.buyer.firstName ?? "");
  const [lastName, setLastName] = useState(order.buyer.lastName ?? "");
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.tickets.map((t) => [t.id, t.attendeeName ?? ""])),
  );
  const [optIn, setOptIn] = useState(order.marketingOptIn);
  const [promo, setPromo] = useState("");
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const headers = { "content-type": "application/json", "x-requested-with": "kroov" };
  const q = `?k=${encodeURIComponent(accessToken)}`;

  const applyPromo = async () => {
    setPromoMsg(null);
    const res = await fetch(`/api/v1/public/orders/${order.id}/promo${q}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code: promo }),
    });
    const json = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) {
      setPromoMsg(json.error?.message ?? "Code invalide.");
      return;
    }
    setPromoMsg("Code appliqué.");
    router.refresh();
  };

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    if (!terms) {
      setError("Acceptez les conditions de vente pour continuer.");
      return;
    }
    setPending(true);
    try {
      const byType = new Map<string, string[]>();
      for (const t of order.tickets) {
        const list = byType.get(t.ticketTypeId) ?? [];
        list.push((names[t.id] ?? "").trim());
        byType.set(t.ticketTypeId, list);
      }
      const patch = await fetch(`/api/v1/public/orders/${order.id}${q}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          marketingOptIn: optIn,
          ...(order.nominative
            ? { attendees: [...byType.entries()].map(([ticketTypeId, list]) => ({ ticketTypeId, names: list })) }
            : {}),
        }),
      });
      if (!patch.ok) {
        const json = (await patch.json()) as { error?: { message?: string; fieldErrors?: Record<string, string[]> } };
        setFieldErrors(json.error?.fieldErrors ?? {});
        setError(
          json.error?.fieldErrors
            ? "Vérifiez les champs signalés."
            : (json.error?.message ?? "Enregistrement impossible."),
        );
        return;
      }
      const checkout = await fetch(`/api/v1/public/orders/${order.id}/checkout${q}`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const json = (await checkout.json()) as {
        data?: { kind: "paid" } | { kind: "redirect"; url: string };
        error?: { message?: string };
      };
      if (!checkout.ok || !json.data) {
        setError(json.error?.message ?? "Le paiement ne peut pas démarrer pour l'instant.");
        return;
      }
      if (json.data.kind === "paid") router.push(`/commande/${order.id}/confirmation${q}`);
      else window.location.assign(json.data.url);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(false);
    }
  };

  const err = (k: string) => fieldErrors[k]?.[0];
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {order.expiresAt ? (
        <Countdown
          expiresAt={order.expiresAt}
          label={retry ? "Vos places sont encore réservées" : "Vos places sont réservées"}
        />
      ) : null}
      <FormField
        label="E-mail de réception"
        required
        hint="Vos billets seront envoyés à cette adresse."
        error={err("email")}
      >
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </FormField>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Prénom" required error={err("firstName")}>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
        </FormField>
        <FormField label="Nom" required error={err("lastName")}>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
        </FormField>
      </div>
      {order.nominative
        ? order.tickets.map((t, i) => (
            <Panel key={t.id}>
              <p className="text-[13px] font-bold">
                Billet {i + 1} · {t.typeLabel}
              </p>
              <FormField label="Participant" required className="mb-0 mt-2">
                <Input
                  value={names[t.id] ?? ""}
                  onChange={(e) => setNames((n) => ({ ...n, [t.id]: e.target.value }))}
                  placeholder={i === 0 && firstName ? `${firstName} ${lastName}`.trim() : "Prénom Nom"}
                  required
                />
              </FormField>
              {i === 0 && firstName && !(names[t.id] ?? "").trim() ? (
                <button
                  type="button"
                  className="mt-1 text-[12px] font-bold underline"
                  onClick={() => setNames((n) => ({ ...n, [t.id]: `${firstName} ${lastName}`.trim() }))}
                >
                  C'est pour moi
                </button>
              ) : null}
            </Panel>
          ))
        : null}

      <Panel>
        <p className="text-[13px] font-bold">Votre commande · {order.number}</p>
        <dl className="m-0 mt-2 divide-y divide-border text-[13px]">
          {order.items.map((i) => (
            <div key={i.ticketTypeId} className="flex justify-between py-2">
              <dt>
                {i.quantity} × {i.label}
              </dt>
              <dd className="m-0">{fmtMinor(i.quantity * i.unitPriceMinor, order.currency)}</dd>
            </div>
          ))}
          {order.discountMinor > 0 ? (
            <div className="flex justify-between py-2">
              <dt>Remise {order.promoCode}</dt>
              <dd className="m-0">−{fmtMinor(order.discountMinor, order.currency)}</dd>
            </div>
          ) : null}
          {order.feesMinor > 0 ? (
            <div className="flex justify-between py-2">
              <dt>Frais de service</dt>
              <dd className="m-0">{fmtMinor(order.feesMinor, order.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between py-2 font-bold">
            <dt>Total à payer</dt>
            <dd className="m-0">{fmtMinor(order.totalMinor, order.currency)}</dd>
          </div>
        </dl>
        {order.subtotalMinor > 0 && !order.promoCode ? (
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <Input
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
              placeholder="Code promo"
              aria-label="Code promo"
              className="uppercase"
            />
            <Button type="button" variant="secondary" onClick={() => void applyPromo()} disabled={!promo.trim()}>
              Appliquer
            </Button>
            {promoMsg ? <p className="col-span-2 text-[12px]">{promoMsg}</p> : null}
          </div>
        ) : null}
      </Panel>

      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
          className="mt-1 size-4 accent-ink"
        />
        <span>
          Je souhaite recevoir les actualités de {order.organizationName}.
          <span className="block text-[11px] text-muted">Facultatif · Désinscription à tout moment.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-1 size-4 accent-ink"
        />
        <span>J'accepte les conditions de vente et j'ai pris connaissance des conditions de remboursement.</span>
      </label>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" variant="primary" className="w-full" loading={pending} loadingLabel="Vérification">
        {order.totalMinor === 0
          ? "Confirmer ma réservation →"
          : retry
            ? "Utiliser une autre carte →"
            : `Continuer vers le paiement · ${fmtMinor(order.totalMinor, order.currency)} →`}
      </Button>
      <p className="text-center text-[11px] text-muted">
        {order.totalMinor === 0
          ? "Entrée gratuite : aucun paiement."
          : "Paiement sécurisé sur la page de notre prestataire. Aucune donnée bancaire ne transite par Kroov."}
      </p>
    </form>
  );
}
