"use client";

import { Alert, Badge, Button } from "@kroov/ui";
import { useState, useTransition } from "react";
import { connectPaymentsAction, syncPaymentsAction } from "@/actions/ticketing";
import { type ActionState, idleState } from "@/lib/action-state";

export function PaymentsPanel({
  organizationId,
  slug,
  account,
  providerName,
  simulated,
}: {
  organizationId: string;
  slug: string;
  account: {
    status: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    providerAccountId: string;
    lastSyncedAt: string | null;
  } | null;
  providerName: string;
  simulated: boolean;
}) {
  const [state, setState] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="space-y-3 text-[13px]">
      {simulated ? (
        <Alert tone="info">
          Fournisseur de paiement <b>simulé</b> (développement / test) : aucun argent réel ne circule. En production,
          Kroov utilise Stripe Connect.
        </Alert>
      ) : null}
      {account ? (
        <>
          <p className="flex items-center gap-2">
            <Badge tone={account.chargesEnabled ? "lime" : "orange"}>
              {account.chargesEnabled
                ? "Encaissements actifs"
                : account.status === "pending"
                  ? "Inscription à terminer"
                  : "Compte restreint"}
            </Badge>
            <Badge tone={account.payoutsEnabled ? "lime" : "neutral"} noDot>
              {account.payoutsEnabled ? "Versements actifs" : "Versements inactifs"}
            </Badge>
          </p>
          <p className="text-muted">
            Compte {providerName} <code className="rounded bg-neutral px-1">{account.providerAccountId}</code>
            {account.lastSyncedAt
              ? ` · vérifié le ${new Date(account.lastSyncedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
              : ""}
          </p>
        </>
      ) : (
        <p>
          Aucun compte de paiement : les billets payants ne peuvent pas encore être vendus. Les billets gratuits
          fonctionnent sans compte.
        </p>
      )}
      {state.status !== "idle" && state.message ? (
        <Alert tone={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!account?.chargesEnabled ? (
          <Button
            variant="primary"
            loading={isPending}
            loadingLabel="Redirection"
            onClick={() => startTransition(async () => setState(await connectPaymentsAction(organizationId, slug)))}
          >
            {account ? "Terminer l'inscription" : simulated ? "Connecter un compte (simulé)" : "Connecter Stripe"}
          </Button>
        ) : null}
        {account ? (
          <Button
            variant="secondary"
            loading={isPending}
            loadingLabel="Vérification"
            onClick={() => startTransition(async () => setState(await syncPaymentsAction(organizationId, slug)))}
          >
            Vérifier l'état
          </Button>
        ) : null}
      </div>
      <p className="text-[12px] text-muted">
        Les frais acheteur (commission Kroov) sont prélevés sur chaque paiement ; le reste est versé sur ce compte par
        le prestataire.
      </p>
    </div>
  );
}
