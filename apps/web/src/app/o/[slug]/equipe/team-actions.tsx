"use client";

import { ROLES, type Role } from "@kroov/auth/catalogue";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogPanel,
  DialogTrigger,
  FormField,
  Input,
  Select,
} from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import {
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  setMemberRolesAction,
} from "@/actions/organizations";
import { type ActionState, idleState } from "@/lib/action-state";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/labels";

export function InviteForm({
  organizationId,
  slug,
  actorIsOwner,
}: {
  organizationId: string;
  slug: string;
  actorIsOwner: boolean;
}) {
  const [state, action, pending] = useActionState(inviteMemberAction.bind(null, organizationId, slug), idleState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [role, setRole] = useState<Role>((values.role as Role) ?? "event_manager");
  const roles = ROLES.filter((r) => actorIsOwner || r !== "owner");

  return (
    <form action={action} noValidate key={state.status === "success" ? state.message : "form"}>
      {state.status === "success" ? (
        <Alert tone="success" className="mb-4">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "error" && state.message && !errors.email ? (
        <Alert tone="error" className="mb-4">
          {state.message}
        </Alert>
      ) : null}
      <FormField label="Adresse e-mail" required error={errors.email}>
        <Input
          type="email"
          name="email"
          inputMode="email"
          autoComplete="off"
          required
          defaultValue={values.email ?? ""}
        />
      </FormField>
      <FormField label="Rôle" required hint={ROLE_HELP[role]} error={errors.role}>
        <Select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Périmètre" hint="Les périmètres limités à un événement seront disponibles avec les événements.">
        <Input value="Organisation" readOnly aria-readonly="true" />
      </FormField>
      <Button type="submit" variant="primary" loading={pending} loadingLabel="Envoi de l'invitation">
        Envoyer l'invitation
      </Button>
    </form>
  );
}

export function InvitationActions({
  organizationId,
  slug,
  invitationId,
  email,
}: {
  organizationId: string;
  slug: string;
  invitationId: string;
  email: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(idleState);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        onClick={() =>
          startTransition(async () => setResult(await resendInvitationAction(organizationId, slug, invitationId)))
        }
      >
        Renvoyer
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="ghost">
            Annuler
          </Button>
        }
        title="Annuler cette invitation ?"
        description={`Le lien envoyé à ${email} cessera de fonctionner immédiatement. Vous pourrez inviter à nouveau cette adresse plus tard.`}
        confirmLabel="Annuler l'invitation"
        cancelLabel="Conserver"
        destructive
        onConfirm={async () => setResult(await revokeInvitationAction(organizationId, slug, invitationId))}
      />
      {result.status === "error" ? (
        <span role="alert" className="text-[11px] font-bold text-error-text">
          {result.message}
        </span>
      ) : null}
    </div>
  );
}

export function MemberActions({
  organizationId,
  slug,
  member,
  actorIsOwner,
  targetIsLastOwner,
}: {
  organizationId: string;
  slug: string;
  member: { id: string; name: string; roles: Role[] };
  actorIsOwner: boolean;
  targetIsLastOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    setMemberRolesAction.bind(null, organizationId, slug, member.id),
    idleState,
  );
  const [removeResult, setRemoveResult] = useState<ActionState>(idleState);
  const targetIsOwner = member.roles.includes("owner");
  const canTouch = actorIsOwner || !targetIsOwner;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canTouch}
            disabledReason="Seul un propriétaire peut modifier un autre propriétaire."
          >
            Gérer →
          </Button>
        </DialogTrigger>
        <DialogPanel
          title={`Rôles de ${member.name}`}
          description="Les rôles se cumulent. Chaque rôle ouvre un ensemble précis de permissions, vérifiées côté serveur."
        >
          <form action={action} noValidate>
            {state.status === "success" ? (
              <Alert tone="success" className="mb-4">
                {state.message}
              </Alert>
            ) : null}
            {state.status === "error" ? (
              <Alert tone="error" className="mb-4">
                {state.message}
              </Alert>
            ) : null}
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-[12px] font-bold">Rôles d'organisation</legend>
              {ROLES.map((r) => {
                const lockedOwner = r === "owner" && (!actorIsOwner || targetIsLastOwner);
                return (
                  <label key={r} className="mb-2 flex items-start gap-3 text-[13px]">
                    <input
                      type="checkbox"
                      name="roles"
                      value={r}
                      defaultChecked={member.roles.includes(r)}
                      disabled={lockedOwner}
                      className="mt-1 size-4 accent-ink"
                    />
                    <span>
                      <b>{ROLE_LABELS[r]}</b>
                      <span className="block text-muted">
                        {ROLE_HELP[r]}
                        {lockedOwner && targetIsLastOwner
                          ? " Dernier propriétaire : nommez-en un autre avant de retirer ce rôle."
                          : ""}
                        {lockedOwner && !actorIsOwner ? " Réservé aux propriétaires." : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <FormField label="Motif (facultatif)" hint="Conservé dans le journal d'audit.">
              <Input name="reason" maxLength={500} />
            </FormField>
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary">Fermer</Button>
              </DialogClose>
              <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
                Enregistrer les rôles
              </Button>
            </div>
          </form>
        </DialogPanel>
      </Dialog>
      <ConfirmDialog
        trigger={
          <Button
            size="sm"
            variant="ghost"
            disabled={!canTouch || targetIsLastOwner}
            disabledReason={
              targetIsLastOwner
                ? "Impossible de retirer le dernier propriétaire."
                : "Seul un propriétaire peut retirer un propriétaire."
            }
          >
            Retirer
          </Button>
        }
        title={`Retirer l'accès de ${member.name} ?`}
        description="Cette personne perdra immédiatement tous ses rôles dans cette organisation. Son compte Kroov et ses autres organisations ne sont pas concernés. L'action est inscrite au journal d'audit."
        confirmLabel="Retirer l'accès"
        destructive
        onConfirm={async () => setRemoveResult(await removeMemberAction(organizationId, slug, member.id))}
      />
      {removeResult.status === "error" ? (
        <span role="alert" className="w-full text-right text-[11px] font-bold text-error-text">
          {removeResult.message}
        </span>
      ) : null}
    </div>
  );
}
