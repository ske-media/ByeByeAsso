"use client";

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
  Panel,
  PanelTitle,
  Select,
  Textarea,
} from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addNoteAction,
  archiveContactAction,
  consentAction,
  deleteNoteAction,
  mergeAction,
  setTagsAction,
  updateContactAction,
} from "@/actions/crm";
import { idleState } from "@/lib/action-state";
import { BASIS_LABELS, SOURCE_LABELS, TAG_COLOR_CLASS } from "../labels";

interface Ctx {
  organizationId: string;
  slug: string;
}

/* Header actions: edit, archive ------------------------------------------------- */

function EditForm({
  ctx,
  contact,
  onDone,
}: {
  ctx: Ctx;
  contact: {
    id: string;
    version: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    city: string | null;
  };
  onDone: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    updateContactAction.bind(null, ctx.organizationId, ctx.slug, contact.id, contact.version),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onDone();
    }
  }, [state.status, router, onDone]);
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField
        label="E-mail principal"
        required
        error={errors.email}
        hint="Changer l'adresse conserve l'ancienne comme identité secondaire."
      >
        <Input name="email" type="email" required defaultValue={contact.email} />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Prénom" error={errors.firstName}>
          <Input name="firstName" maxLength={80} defaultValue={contact.firstName ?? ""} />
        </FormField>
        <FormField label="Nom" error={errors.lastName}>
          <Input name="lastName" maxLength={80} defaultValue={contact.lastName ?? ""} />
        </FormField>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Téléphone" error={errors.phone}>
          <Input name="phone" maxLength={40} defaultValue={contact.phone ?? ""} />
        </FormField>
        <FormField label="Ville" error={errors.city}>
          <Input name="city" maxLength={120} defaultValue={contact.city ?? ""} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function ContactActions({
  ctx,
  contact,
}: {
  ctx: Ctx;
  contact: {
    id: string;
    status: "active" | "merged" | "archived";
    version: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    city: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (contact.status === "merged") return null;
  const archived = contact.status === "archived";
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={<Button variant="ghost">{archived ? "Restaurer" : "Archiver"}</Button>}
          title={archived ? "Restaurer ce contact ?" : "Archiver ce contact ?"}
          description={
            archived
              ? "Le contact réapparaît dans les listes et les segments."
              : "Le contact sort des listes et des segments ; son historique est conservé et il sera restauré à sa prochaine activité. Pour exclure une adresse des envois, utilisez plutôt les exclusions."
          }
          confirmLabel={archived ? "Restaurer" : "Archiver"}
          destructive={!archived}
          pending={pending}
          onConfirm={() =>
            new Promise<void>((resolve) => {
              start(async () => {
                const r = await archiveContactAction(ctx.organizationId, ctx.slug, contact.id, !archived);
                setMessage({
                  tone: r.status === "error" ? "error" : "success",
                  text: r.status === "idle" ? "" : (r.message ?? ""),
                });
                router.refresh();
                resolve();
              });
            })
          }
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">Modifier</Button>
          </DialogTrigger>
          <DialogPanel title="Modifier la fiche">
            <EditForm key={String(open)} ctx={ctx} contact={contact} onDone={() => setOpen(false)} />
          </DialogPanel>
        </Dialog>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}

/* Identities --------------------------------------------------------------------- */

export function IdentityPanel({
  identities,
  phone,
  hasAccount,
}: {
  identities: Array<{
    id: string;
    kind: "email" | "phone" | "user";
    value: string;
    verified: boolean;
    isPrimary: boolean;
  }>;
  phone: string | null;
  hasAccount: boolean;
}) {
  return (
    <ul className="m-0 list-none p-0 text-[13px]">
      {identities
        .filter((i) => i.kind !== "user")
        .map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
            <span>
              <span className="text-[11px] text-muted">{i.kind === "email" ? "E-mail" : "Téléphone"} · </span>
              {i.kind === "phone" && phone ? phone : i.value}
            </span>
            <span className="flex gap-1">
              {i.isPrimary ? (
                <Badge tone="neutral" noDot>
                  principal
                </Badge>
              ) : null}
              {i.verified ? (
                <Badge tone="lime" noDot>
                  vérifié
                </Badge>
              ) : null}
            </span>
          </li>
        ))}
      <li className="py-1 text-[12px] text-muted">
        {hasAccount
          ? "Compte Kroov rattaché (adresse vérifiée)."
          : "Aucun compte Kroov rattaché : rattachement automatique à la première commande ou candidature connectée."}
      </li>
    </ul>
  );
}

/* Tags ----------------------------------------------------------------------------- */

export function TagsSelector({
  ctx,
  contactId,
  all,
  selected,
}: {
  ctx: Ctx;
  contactId: string;
  all: Array<{ id: string; name: string; color: string }>;
  selected: string[];
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(selected);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty = current.length !== selected.length || current.some((id) => !selected.includes(id));
  if (all.length === 0)
    return <p className="text-[13px] text-muted">Aucune étiquette définie. Créez-en depuis l'onglet « Étiquettes ».</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {all.map((t) => {
          const on = current.includes(t.id);
          return (
            <label
              key={t.id}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-1 text-[12px] font-bold ${on ? `border-ink ${TAG_COLOR_CLASS[t.color] ?? "bg-neutral"}` : "border-border"}`}
            >
              <input
                type="checkbox"
                className="size-3 accent-ink"
                checked={on}
                onChange={() => setCurrent((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}
              />
              {t.name}
            </label>
          );
        })}
      </div>
      {dirty ? (
        <Button
          variant="primary"
          className="min-h-9"
          loading={pending}
          loadingLabel="…"
          onClick={() =>
            start(async () => {
              const r = await setTagsAction(ctx.organizationId, ctx.slug, contactId, current);
              setMessage({
                tone: r.status === "error" ? "error" : "success",
                text: r.status === "idle" ? "" : (r.message ?? ""),
              });
              router.refresh();
            })
          }
        >
          Enregistrer les étiquettes
        </Button>
      ) : null}
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}

/* Consent ----------------------------------------------------------------------------- */

export function ConsentPanel({
  ctx,
  contactId,
  canManage,
  records,
}: {
  ctx: Ctx;
  contactId: string;
  canManage: boolean;
  records: Array<{
    id: string;
    status: "granted" | "withdrawn";
    basis: string;
    source: string;
    evidence: string;
    when: string;
    recordedBy: string | null;
  }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    consentAction.bind(null, ctx.organizationId, ctx.slug, contactId),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      setOpen(false);
    }
  }, [state.status, router]);
  return (
    <div className="space-y-3">
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {records.length === 0 ? (
        <p className="text-[13px] text-muted">
          Aucun enregistrement : cette personne n'a jamais coché la case ni exprimé de consentement. Un achat ou une
          adhésion ne vaut pas consentement marketing.
        </p>
      ) : (
        <ol className="m-0 list-none divide-y divide-border p-0 text-[13px]">
          {records.map((r) => (
            <li key={r.id} className="grid gap-1 py-2 sm:grid-cols-[150px_1fr]">
              <span className="text-[12px] text-muted">{r.when}</span>
              <span>
                <Badge
                  tone={r.status === "granted" ? (r.basis === "customer_exception" ? "lavender" : "lime") : "orange"}
                  noDot
                >
                  {r.status === "granted" ? "Accordé" : "Retiré"}
                </Badge>{" "}
                <span className="text-[12px]">
                  {BASIS_LABELS[r.basis] ?? r.basis} · {SOURCE_LABELS[r.source] ?? r.source}
                  {r.recordedBy ? ` · par ${r.recordedBy}` : ""}
                </span>
                <span className="block text-[12px] text-muted">{r.evidence}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {canManage ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" className="min-h-9">
              Enregistrer un consentement ou un retrait
            </Button>
          </DialogTrigger>
          <DialogPanel title="Consentement e-mail — enregistrement manuel">
            <form action={action} noValidate className="space-y-2">
              {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
              <FormField label="Nature" required>
                <Select name="status" defaultValue="granted">
                  <option value="granted">Consentement accordé (opt-in explicite)</option>
                  <option value="withdrawn">Consentement retiré (opposition)</option>
                </Select>
              </FormField>
              <FormField
                label="Preuve"
                required
                error={errors.evidence}
                hint="Obligatoire et conservée : formulaire papier daté, e-mail reçu, échange au stand… Jamais « oral sans trace »."
              >
                <Textarea
                  name="evidence"
                  rows={3}
                  maxLength={1000}
                  required
                  placeholder="Ex. : bulletin d'adhésion papier signé le 12 juin 2027, case cochée"
                />
              </FormField>
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild>
                  <Button variant="secondary">Annuler</Button>
                </DialogClose>
                <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
                  Enregistrer
                </Button>
              </div>
            </form>
          </DialogPanel>
        </Dialog>
      ) : null}
    </div>
  );
}

/* Notes ----------------------------------------------------------------------------- */

export function NotesPanel({
  ctx,
  contactId,
  canManage,
  notes,
}: {
  ctx: Ctx;
  contactId: string;
  canManage: boolean;
  notes: Array<{ id: string; body: string; pinned: boolean; author: string | null; when: string }>;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    addNoteAction.bind(null, ctx.organizationId, ctx.slug, contactId),
    idleState,
  );
  const [key, setKey] = useState(0);
  const [, start] = useTransition();
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      setKey((k) => k + 1);
    }
  }, [state.status, router]);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <Panel>
      <PanelTitle>Notes internes</PanelTitle>
      <p className="text-[12px] text-muted">Visibles par l'équipe seulement ; jamais exportées ni envoyées.</p>
      {notes.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">Aucune note.</p>
      ) : (
        <ul className="m-0 mt-3 list-none divide-y divide-border p-0 text-[13px]">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                {n.pinned ? (
                  <Badge tone="orange" noDot className="mr-2">
                    épinglée
                  </Badge>
                ) : null}
                {n.body}
                <span className="block text-[11px] text-muted">
                  {n.author ?? "—"} · {n.when}
                </span>
              </span>
              {canManage ? (
                <button
                  type="button"
                  className="text-[12px] underline"
                  onClick={() =>
                    start(async () => {
                      await deleteNoteAction(ctx.organizationId, ctx.slug, contactId, n.id);
                      router.refresh();
                    })
                  }
                >
                  Supprimer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form key={key} action={action} noValidate className="mt-3 space-y-2">
          {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
          <FormField label="Nouvelle note" error={errors.body}>
            <Textarea
              name="body"
              rows={2}
              maxLength={4000}
              required
              placeholder="Ce qu'il faut savoir pour bien accueillir cette personne…"
            />
          </FormField>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="pinned" className="size-4 accent-ink" /> Épingler en haut
          </label>
          <Button type="submit" variant="secondary" className="min-h-9" loading={pending} loadingLabel="…">
            Ajouter la note
          </Button>
        </form>
      ) : null}
    </Panel>
  );
}

/* Merge --------------------------------------------------------------------------------- */

export function MergePanel({ ctx, survivorId, survivorName }: { ctx: Ctx; survivorId: string; survivorName: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [picked, setPicked] = useState<{ id: string; name: string; email: string } | null>(null);
  const [state, action, pending] = useActionState(
    mergeAction.bind(null, ctx.organizationId, ctx.slug, survivorId),
    idleState,
  );
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      setPicked(null);
      setResults([]);
      setQ("");
    }
  }, [state.status, router]);
  const search = async () => {
    const res = await fetch(
      `/api/v1/organizations/${ctx.organizationId}/contacts?q=${encodeURIComponent(q)}&pageSize=8`,
      { headers: { "x-requested-with": "kroov" } },
    );
    if (!res.ok) return setResults([]);
    const body = (await res.json()) as { data: { contacts: Array<{ id: string; name: string; email: string }> } };
    setResults(body.data.contacts.filter((c) => c.id !== survivorId));
  };
  return (
    <div className="space-y-2 text-[13px]">
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <p className="text-[12px] text-muted">
        La fiche choisie est rattachée à <b>{survivorName}</b> : identités, étiquettes, notes, consentements et
        historique suivent. Irréversible ; un enregistrement de fusion conserve l'instantané.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nom ou e-mail du doublon"
          aria-label="Rechercher un doublon"
        />
        <Button type="submit" variant="secondary" className="min-h-9">
          Chercher
        </Button>
      </form>
      {results.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1">
              <span>
                <b>{r.name}</b> <span className="text-muted">· {r.email}</span>
              </span>
              <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setPicked(r)}>
                Choisir
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {picked ? (
        <form action={action} noValidate className="space-y-2 rounded-[9px] bg-neutral p-3">
          <input type="hidden" name="mergedContactId" value={picked.id} />
          <p>
            Fusionner <b>{picked.name}</b> ({picked.email}) dans <b>{survivorName}</b> ?
          </p>
          <FormField label="Motif (facultatif)">
            <Input name="reason" maxLength={500} placeholder="Même personne, téléphone identique" />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className="min-h-9" onClick={() => setPicked(null)}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" className="min-h-9" loading={pending} loadingLabel="Fusion">
              Fusionner
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
