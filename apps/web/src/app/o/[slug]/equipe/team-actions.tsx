"use client";

import { ROLES, type Role } from "@kroov/auth/catalogue";
import {
  Alert,
  Badge,
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

export interface ScopeOption {
  id: string;
  title: string;
}

export interface Grant {
  role: Role;
  eventId: string | null;
}

function scopeLabel(eventId: string | null, events: ScopeOption[]): string {
  if (!eventId) return "Organisation";
  return events.find((e) => e.id === eventId)?.title ?? "Événement";
}

export function InviteForm({
  organizationId,
  slug,
  actorIsOwner,
  events,
}: {
  organizationId: string;
  slug: string;
  actorIsOwner: boolean;
  events: ScopeOption[];
}) {
  const [state, action, pending] = useActionState(inviteMemberAction.bind(null, organizationId, slug), idleState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [role, setRole] = useState<Role>((values.role as Role) ?? "event_manager");
  const [scope, setScope] = useState<string>(values.eventId ?? "organization");
  const roles = ROLES.filter((r) => actorIsOwner || r !== "owner");
  // Owner / admin are organization-wide by nature.
  const scopable = role !== "owner" && role !== "organization_admin";

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
        <Select
          name="role"
          value={role}
          onChange={(e) => {
            const next = e.target.value as Role;
            setRole(next);
            if (next === "owner" || next === "organization_admin") setScope("organization");
          }}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Périmètre"
        hint={
          scopable
            ? "Toute l'organisation, ou un seul événement : la personne ne verra alors que celui-ci."
            : "Ce rôle s'applique à toute l'organisation."
        }
        error={errors.eventId}
      >
        <Select name="eventId" value={scope} onChange={(e) => setScope(e.target.value)} disabled={!scopable}>
          <option value="organization">Organisation</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              Événement · {ev.title}
            </option>
          ))}
        </Select>
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
  events,
}: {
  organizationId: string;
  slug: string;
  member: { id: string; name: string; grants: Grant[] };
  actorIsOwner: boolean;
  targetIsLastOwner: boolean;
  events: ScopeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    setMemberRolesAction.bind(null, organizationId, slug, member.id),
    idleState,
  );
  const [removeResult, setRemoveResult] = useState<ActionState>(idleState);
  const [grants, setGrants] = useState<Grant[]>(member.grants);
  const [newRole, setNewRole] = useState<Role>("event_manager");
  const [newScope, setNewScope] = useState<string>("organization");
  const targetIsOwner = member.grants.some((g) => g.role === "owner" && g.eventId === null);
  const canTouch = actorIsOwner || !targetIsOwner;
  const scopable = newRole !== "owner" && newRole !== "organization_admin";

  function addGrant() {
    const eventId = scopable && newScope !== "organization" ? newScope : null;
    if (grants.some((g) => g.role === newRole && g.eventId === eventId)) return;
    setGrants([...grants, { role: newRole, eventId }]);
  }

  function removeGrant(index: number) {
    setGrants(grants.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setGrants(member.grants);
        }}
      >
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
          description="Les rôles se cumulent. Un rôle peut couvrir toute l'organisation ou un seul événement ; chaque permission est vérifiée côté serveur."
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
            <input
              type="hidden"
              name="grants"
              value={JSON.stringify(grants.map((g) => (g.eventId ? g : { role: g.role })))}
            />
            <p className="mb-2 text-[12px] font-bold">Rôles attribués</p>
            {grants.length === 0 ? (
              <p className="mb-3 text-[13px] text-muted">Aucun rôle : cette personne ne pourra rien voir ni faire.</p>
            ) : (
              <ul className="m-0 mb-3 list-none space-y-2 p-0">
                {grants.map((g, i) => {
                  const lockedOwner = g.role === "owner" && g.eventId === null && (targetIsLastOwner || !actorIsOwner);
                  return (
                    <li
                      key={`${g.role}-${g.eventId ?? "org"}`}
                      className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-[13px]"
                    >
                      <span>
                        <b>{ROLE_LABELS[g.role]}</b>
                        <span className="ml-2">
                          <Badge tone={g.eventId ? "lavender" : "neutral"} noDot>
                            {scopeLabel(g.eventId, events)}
                          </Badge>
                        </span>
                        {lockedOwner ? (
                          <span className="block text-[11px] text-muted">
                            {targetIsLastOwner
                              ? "Dernier propriétaire : nommez-en un autre avant de retirer ce rôle."
                              : "Réservé aux propriétaires."}
                          </span>
                        ) : null}
                      </span>
                      <Button size="sm" variant="ghost" disabled={lockedOwner} onClick={() => removeGrant(i)}>
                        Retirer
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <fieldset className="m-0 mb-4 rounded-control border border-border-strong p-3">
              <legend className="px-1 text-[12px] font-bold">Ajouter un rôle</legend>
              <div className="grid gap-x-3 sm:grid-cols-2">
                <FormField label="Rôle" hint={ROLE_HELP[newRole]}>
                  <Select
                    value={newRole}
                    onChange={(e) => {
                      const next = e.target.value as Role;
                      setNewRole(next);
                      if (next === "owner" || next === "organization_admin") setNewScope("organization");
                    }}
                  >
                    {ROLES.filter((r) => actorIsOwner || r !== "owner").map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Périmètre">
                  <Select value={newScope} onChange={(e) => setNewScope(e.target.value)} disabled={!scopable}>
                    <option value="organization">Organisation</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        Événement · {ev.title}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <Button size="sm" variant="secondary" onClick={addGrant}>
                + Ajouter
              </Button>
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
