"use client";

import type { MembershipStatus } from "@kroov/domain/memberships";
import { Alert, Button, ConfirmDialog, FormField, Input, Textarea } from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import { extendMembershipAction, membershipAction } from "@/actions/memberships";
import { idleState } from "@/lib/action-state";

type Action = "approve" | "reject" | "suspend" | "reactivate" | "cancel" | "resend";

/** Décisions sur une adhésion : chaque action irréversible demande une confirmation et, si besoin, un motif. */
export function MembershipActionsPanel({
  organizationId,
  slug,
  membershipId,
  status,
  timezone,
  paid,
}: {
  organizationId: string;
  slug: string;
  membershipId: string;
  status: MembershipStatus;
  timezone: string;
  paid: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const run = (action: Action) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await membershipAction(organizationId, slug, membershipId, action, reason || undefined);
        setMessage(
          r.status === "error"
            ? { tone: "error", text: r.message ?? "Action impossible." }
            : { tone: "success", text: r.status === "success" ? (r.message ?? "") : "" },
        );
        setReason("");
        resolve();
      });
    });
  const reasonField = (
    <FormField label="Motif" required hint="Transmis à la personne et conservé dans l'historique.">
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
    </FormField>
  );
  const [extendState, extendAction, extendPending] = useActionState(
    extendMembershipAction.bind(null, organizationId, slug, membershipId, timezone),
    idleState,
  );
  const extendErrors = extendState.status === "error" ? (extendState.fieldErrors ?? {}) : {};
  const canExtend = status === "active" || status === "suspended";

  return (
    <div className="space-y-4">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {status === "pending" ? (
          <>
            <ConfirmDialog
              trigger={<Button variant="primary">Approuver</Button>}
              title="Approuver cette demande ?"
              description={
                paid
                  ? "La personne reçoit un lien pour régler sa cotisation ; l'adhésion devient active au paiement."
                  : "L'adhésion gratuite devient active immédiatement et la carte est envoyée par e-mail."
              }
              confirmLabel="Approuver"
              pending={pending}
              onConfirm={() => run("approve")}
            />
            <ConfirmDialog
              trigger={<Button variant="secondary">Refuser</Button>}
              title="Refuser cette demande ?"
              description="La personne est informée du refus avec votre motif. Cette décision est définitive."
              confirmLabel="Refuser la demande"
              destructive
              pending={pending}
              onConfirm={() => run("reject")}
            >
              {reasonField}
            </ConfirmDialog>
          </>
        ) : null}
        {status === "awaiting_payment" ? (
          <>
            <ConfirmDialog
              trigger={<Button variant="secondary">Renvoyer le lien</Button>}
              title="Renvoyer le lien de paiement ?"
              description="Un nouveau lien est envoyé par e-mail ; l'ancien cesse de fonctionner."
              confirmLabel="Renvoyer"
              pending={pending}
              onConfirm={() => run("resend")}
            />
            <ConfirmDialog
              trigger={<Button variant="secondary">Refuser</Button>}
              title="Refuser cette adhésion ?"
              description="La personne est informée du refus. Aucun paiement n'est encaissé."
              confirmLabel="Refuser"
              destructive
              pending={pending}
              onConfirm={() => run("reject")}
            >
              {reasonField}
            </ConfirmDialog>
          </>
        ) : null}
        {status === "active" ? (
          <>
            <ConfirmDialog
              trigger={<Button variant="secondary">Renvoyer la carte</Button>}
              title="Renvoyer la carte d'adhérent ?"
              description="Un nouveau lien vers la carte est envoyé ; l'ancien lien ne fonctionne plus."
              confirmLabel="Renvoyer"
              pending={pending}
              onConfirm={() => run("resend")}
            />
            <ConfirmDialog
              trigger={<Button variant="secondary">Suspendre</Button>}
              title="Suspendre cette adhésion ?"
              description="Les avantages (tarifs adhérents) sont désactivés jusqu'à réactivation. La personne n'est pas remboursée."
              confirmLabel="Suspendre"
              destructive
              pending={pending}
              onConfirm={() => run("suspend")}
            >
              {reasonField}
            </ConfirmDialog>
          </>
        ) : null}
        {status === "suspended" ? (
          <ConfirmDialog
            trigger={<Button variant="primary">Réactiver</Button>}
            title="Réactiver cette adhésion ?"
            description="Les avantages sont rétablis immédiatement, sans changer la date de fin."
            confirmLabel="Réactiver"
            pending={pending}
            onConfirm={() => run("reactivate")}
          />
        ) : null}
        {status === "pending" || status === "awaiting_payment" || status === "active" || status === "suspended" ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-bordeaux">
                Annuler l'adhésion
              </Button>
            }
            title="Annuler cette adhésion ?"
            description="Décision définitive : l'adhésion ne pourra pas être réactivée. Un éventuel remboursement se fait depuis le paiement."
            confirmLabel="Annuler définitivement"
            destructive
            pending={pending}
            onConfirm={() => run("cancel")}
          >
            {reasonField}
          </ConfirmDialog>
        ) : null}
      </div>
      {canExtend ? (
        <form
          action={extendAction}
          noValidate
          className="space-y-2 border-t border-border pt-4"
          key={extendState.status === "success" ? extendState.message : "extend"}
        >
          <p className="text-[13px] font-bold">Prolonger la validité</p>
          {extendState.status === "success" ? <Alert tone="success">{extendState.message}</Alert> : null}
          {extendState.status === "error" && extendState.message ? (
            <Alert tone="error">{extendState.message}</Alert>
          ) : null}
          <div className="grid gap-x-3 sm:grid-cols-2">
            <FormField label="Nouvelle date de fin" required error={extendErrors.validUntil}>
              <Input type="date" name="validUntil" required />
            </FormField>
            <FormField label="Motif" required error={extendErrors.reason}>
              <Input name="reason" maxLength={500} placeholder="Geste commercial, erreur…" />
            </FormField>
          </div>
          <Button type="submit" variant="secondary" loading={extendPending} loadingLabel="Prolongation">
            Prolonger
          </Button>
        </form>
      ) : null}
    </div>
  );
}
