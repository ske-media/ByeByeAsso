"use client";

import { Alert, Button, ConfirmDialog, FormField, Input } from "@kroov/ui";
import { useActionState, useState } from "react";
import { deleteAccountAction } from "@/actions/identity";
import { idleState } from "@/lib/action-state";

/** « Mes données » (phase 10) : export JSON et suppression du compte avec confirmation par l'adresse. */
export function PrivacyPanel({
  email,
  lastOwnerOf,
}: {
  email: string;
  lastOwnerOf: Array<{ name: string; slug: string }>;
}) {
  const [state, action, pending] = useActionState(deleteAccountAction, idleState);
  const [open, setOpen] = useState(false);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const blocked = lastOwnerOf.length > 0;
  return (
    <div className="space-y-4 text-[13px]">
      <div>
        <p className="font-bold">Exporter mes données</p>
        <p className="text-muted">
          Un fichier JSON avec votre profil, vos organisations et rôles, vos adhésions, vos commandes et billets, vos
          candidatures bénévoles, vos notifications et le journal de vos propres actions.
        </p>
        <Button asChild variant="secondary" className="mt-2">
          <a href="/api/v1/profiles/me/export">Télécharger mes données (JSON)</a>
        </Button>
      </div>
      <div>
        <p className="font-bold">Supprimer mon compte</p>
        <p className="text-muted">
          Votre identité est effacée (nom, adresse, téléphone, connexions), vos accès aux organisations sont retirés,
          vos notifications supprimées. Les commandes, billets et écritures comptables sont conservés (obligation
          légale) mais détachés de votre identité. Cette action est irréversible.
        </p>
        {blocked ? (
          <Alert tone="warning" className="mt-2">
            Vous êtes la dernière personne propriétaire de {lastOwnerOf.map((o) => o.name).join(", ")} : transférez la
            propriété (Équipe & accès) ou supprimez l'organisation avant de supprimer votre compte.
          </Alert>
        ) : null}
        {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
          <Alert tone="error" className="mt-2">
            {state.message}
          </Alert>
        ) : null}
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Supprimer définitivement votre compte ?"
          description="Saisissez l'adresse e-mail de votre compte pour confirmer. Vous serez déconnecté·e immédiatement."
          confirmLabel="Supprimer mon compte"
          destructive
          pending={pending}
          onConfirm={() => {
            const form = document.getElementById("delete-account-form") as HTMLFormElement | null;
            form?.requestSubmit();
          }}
          trigger={
            <Button variant="danger" className="mt-2" disabled={blocked}>
              Supprimer mon compte…
            </Button>
          }
        >
          <form id="delete-account-form" action={action} noValidate>
            <FormField label="Adresse e-mail du compte" required error={errors.confirmEmail} hint={email}>
              <Input name="confirmEmail" type="email" required autoComplete="off" />
            </FormField>
          </form>
        </ConfirmDialog>
      </div>
    </div>
  );
}
