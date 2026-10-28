"use client";

import { Alert, Button, Panel } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtMinor } from "@/lib/money";

export interface RenewalPlanOption {
  id: string;
  name: string;
  priceMinor: number;
  feeMinor: number;
  currency: string;
  periodLabel: string;
  requiresReview: boolean;
}

/** Paiement de la cotisation (hébergé) et renouvellement (nouvelle adhésion liée). */
export function MemberActions({
  membershipId,
  accessToken,
  status,
  totalMinor,
  currency,
  renewalPlans,
  cancelled,
}: {
  membershipId: string;
  accessToken: string;
  status: string;
  /** Cotisation + frais de service : ce qui est réellement débité. */
  totalMinor: number;
  currency: string;
  renewalPlans: RenewalPlanOption[];
  cancelled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    cancelled ? "Paiement annulé : aucune somme n'a été prélevée." : null,
  );
  const [pending, setPending] = useState<string | null>(null);
  const headers = { "content-type": "application/json", "x-requested-with": "kroov" };

  const pay = async () => {
    setPending("pay");
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/public/memberships/${membershipId}/checkout?k=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers,
          body: "{}",
        },
      );
      const json = (await res.json()) as { data?: { kind: string; url?: string }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "Paiement indisponible pour l'instant.");
        return;
      }
      if (json.data.kind === "active") {
        router.refresh();
        return;
      }
      if (json.data.url) window.location.assign(json.data.url);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(null);
    }
  };

  const renew = async (planId: string) => {
    setPending(planId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/memberships/${membershipId}/renew?k=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId }),
      });
      const json = (await res.json()) as { data?: { id: string; accessToken: string }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "Renouvellement impossible pour l'instant.");
        return;
      }
      router.push(`/adhesion/${json.data.id}?k=${encodeURIComponent(json.data.accessToken)}&nouveau=1`);
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {status === "awaiting_payment" ? (
        <Button
          variant="primary"
          className="w-full"
          loading={pending === "pay"}
          loadingLabel="Redirection"
          onClick={() => void pay()}
        >
          Régler ma cotisation · {fmtMinor(totalMinor, currency)} →
        </Button>
      ) : null}
      {renewalPlans.length > 0 ? (
        <Panel className="bg-lime">
          <h2 className="text-panel-title font-bold">Renouveler mon adhésion</h2>
          <p className="text-[12px]">
            Pas de renouvellement automatique : vous choisissez. La nouvelle période démarre à la fin de l'actuelle.
          </p>
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {renewalPlans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] bg-white px-3 py-2 text-[13px]"
              >
                <span>
                  <b>{p.name}</b>
                  <span className="block text-[11px] text-muted">
                    {p.priceMinor === 0 ? "Gratuit" : fmtMinor(p.priceMinor, p.currency)}
                    {p.feeMinor > 0 ? ` + ${fmtMinor(p.feeMinor, p.currency)} de frais` : ""} · {p.periodLabel}
                    {p.requiresReview ? " · sur revue" : ""}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  loading={pending === p.id}
                  loadingLabel="Renouvellement"
                  onClick={() => void renew(p.id)}
                >
                  Renouveler
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
