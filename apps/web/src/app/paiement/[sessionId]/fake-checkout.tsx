"use client";

import { Button, Panel } from "@kroov/ui";
import { useState } from "react";
import { fmtMinor } from "@/lib/money";

export function FakeCheckout({
  sessionId,
  orderNumber,
  amountMinor,
  currency,
  description,
  status,
  successUrl,
  cancelUrl,
}: {
  sessionId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  description: string;
  status: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const [pending, setPending] = useState<"succeeded" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settle = async (decision: "succeeded" | "failed") => {
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/v1/payments/fake/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "kroov" },
        body: JSON.stringify({ decision }),
      });
      const json = (await res.json()) as { data?: { redirectUrl: string }; error?: { message?: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "Simulation impossible.");
        return;
      }
      window.location.assign(json.data.redirectUrl);
    } catch {
      setError("Connexion impossible.");
    } finally {
      setPending(null);
    }
  };
  return (
    <Panel className="mt-4">
      <dl className="m-0 divide-y divide-border text-[13px]">
        <div className="flex justify-between py-2">
          <dt>Commande</dt>
          <dd className="m-0 font-bold">{orderNumber}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>Description</dt>
          <dd className="m-0">{description}</dd>
        </div>
        <div className="flex justify-between py-2 font-bold">
          <dt>Montant</dt>
          <dd className="m-0">{fmtMinor(amountMinor, currency)}</dd>
        </div>
      </dl>
      {status !== "pending" ? (
        <p className="mt-3 text-[13px]">
          Cette session est déjà {status === "succeeded" ? "payée" : "refusée"}.{" "}
          <a href={status === "succeeded" ? successUrl : cancelUrl} className="font-bold underline">
            Retour à Kroov
          </a>
        </p>
      ) : (
        <div className="mt-4 grid gap-2">
          <Button
            variant="primary"
            loading={pending === "succeeded"}
            loadingLabel="Paiement"
            onClick={() => void settle("succeeded")}
            disabled={pending !== null}
          >
            Payer {fmtMinor(amountMinor, currency)}
          </Button>
          <Button
            variant="danger"
            loading={pending === "failed"}
            loadingLabel="Refus"
            onClick={() => void settle("failed")}
            disabled={pending !== null}
          >
            Simuler un refus de la banque
          </Button>
          <a href={cancelUrl} className="text-center text-[12px] font-bold underline">
            Annuler et revenir à Kroov
          </a>
        </div>
      )}
      {error ? <p className="mt-3 text-[13px] text-error-text">{error}</p> : null}
    </Panel>
  );
}
