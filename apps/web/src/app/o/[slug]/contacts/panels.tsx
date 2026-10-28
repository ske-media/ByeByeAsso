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
  EmptyState,
  FormField,
  Input,
  Panel,
  PanelTitle,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { createContactAction, deleteTagAction, rebuildAction, saveTagAction } from "@/actions/crm";
import { idleState } from "@/lib/action-state";
import { MARKETING_LABELS, MARKETING_TONE, type MarketingStatus, SOURCE_LABELS, TAG_COLOR_CLASS } from "./labels";

interface Ctx {
  organizationId: string;
  slug: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  status: "active" | "merged" | "archived";
  marketing: MarketingStatus;
  source: string;
  tags: Array<{ id: string; name: string; color: string }>;
  ordersCount: number;
  membershipsCount: number;
  applicationsCount: number;
  missionsCount: number;
  hasAccount: boolean;
  lastActivity: string;
}

export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`inline-block rounded-[5px] px-[7px] py-[2px] text-[10px] font-bold ${TAG_COLOR_CLASS[color] ?? "bg-neutral"}`}
    >
      {name}
    </span>
  );
}

/* Header actions: new contact, export, rebuild ------------------------------- */

function NewContactForm({ ctx }: { ctx: Ctx }) {
  const [state, action, pending] = useActionState(
    createContactAction.bind(null, ctx.organizationId, ctx.slug),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField label="E-mail" required error={errors.email}>
        <Input name="email" type="email" required defaultValue={values.email ?? ""} autoComplete="off" />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Prénom" error={errors.firstName}>
          <Input name="firstName" maxLength={80} defaultValue={values.firstName ?? ""} />
        </FormField>
        <FormField label="Nom" error={errors.lastName}>
          <Input name="lastName" maxLength={80} defaultValue={values.lastName ?? ""} />
        </FormField>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Téléphone" error={errors.phone}>
          <Input name="phone" maxLength={40} defaultValue={values.phone ?? ""} />
        </FormField>
        <FormField label="Ville" error={errors.city}>
          <Input name="city" maxLength={120} defaultValue={values.city ?? ""} />
        </FormField>
      </div>
      <p className="text-[12px] text-muted">
        Une fiche créée à la main n'a aucun consentement marketing : enregistrez-en un avec sa preuve depuis la fiche.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Création">
          Créer le contact
        </Button>
      </div>
    </form>
  );
}

export function HeaderActions({
  ctx,
  canManage,
  canExport,
  exportHref,
  exportCount,
}: {
  ctx: Ctx;
  canManage: boolean;
  canExport: boolean;
  exportHref: string;
  exportCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {canExport ? (
          <a
            href={exportHref}
            className="inline-flex min-h-11 items-center rounded-[8px] border border-ink bg-transparent px-4 text-[13px] font-bold"
            download
          >
            Exporter CSV ({exportCount})
          </a>
        ) : null}
        {canManage ? (
          <ConfirmDialog
            trigger={<Button variant="secondary">Reconstruire</Button>}
            title="Reconstruire la base depuis l'historique ?"
            description="Rejoue toutes les commandes payées, adhésions et candidatures de l'organisation. Opération idempotente : rien n'est dupliqué, les fiches existantes sont complétées et recomptées."
            confirmLabel="Reconstruire"
            pending={pending}
            onConfirm={() =>
              new Promise<void>((resolve) => {
                start(async () => {
                  const r = await rebuildAction(ctx.organizationId, ctx.slug);
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
        ) : null}
        {canManage ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="primary">+ Nouveau contact</Button>
            </DialogTrigger>
            <DialogPanel title="Nouveau contact">
              <NewContactForm key={String(open)} ctx={ctx} />
            </DialogPanel>
          </Dialog>
        ) : null}
      </div>
      {message ? (
        <Alert tone={message.tone} className="max-w-[420px]">
          {message.text}
        </Alert>
      ) : null}
    </div>
  );
}

/* Contacts table --------------------------------------------------------------- */

export function ContactsTable({
  slug,
  rows,
  emptyDescription,
}: {
  slug: string;
  rows: ContactRow[];
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState title="Aucun contact" description={emptyDescription} />;
  return (
    <TableContainer label="Contacts" className="border-0 bg-transparent">
      <Table>
        <THead>
          <TR>
            <TH>Contact</TH>
            <TH>Consentement e-mail</TH>
            <TH>Étiquettes</TH>
            <TH>Historique</TH>
            <TH>Origine</TH>
            <TH>Dernière activité</TH>
            <TH>
              <span className="k-sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <b>{r.name}</b>
                <span className="block text-[11px] text-muted">
                  {r.email}
                  {r.hasAccount ? " · compte" : ""}
                  {r.status === "archived" ? " · archivé" : ""}
                </span>
              </TD>
              <TD>
                <Badge tone={MARKETING_TONE[r.marketing]}>{MARKETING_LABELS[r.marketing]}</Badge>
              </TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {r.tags.map((t) => (
                    <TagChip key={t.id} name={t.name} color={t.color} />
                  ))}
                </span>
              </TD>
              <TD className="text-[12px]">
                {[
                  r.ordersCount ? `${r.ordersCount} commande(s)` : null,
                  r.membershipsCount ? `${r.membershipsCount} adhésion(s)` : null,
                  r.applicationsCount ? `${r.applicationsCount} candidature(s)` : null,
                  r.missionsCount ? `${r.missionsCount} mission(s)` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </TD>
              <TD className="text-[12px]">{SOURCE_LABELS[r.source] ?? r.source}</TD>
              <TD className="text-[12px]">{r.lastActivity}</TD>
              <TD className="text-right">
                <Link href={`/o/${slug}/contacts/${r.id}`} className="font-bold underline underline-offset-4">
                  Ouvrir →
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}

/* Tags --------------------------------------------------------------------- */

export interface TagItem {
  id: string;
  name: string;
  color: string;
  count: number;
}

function TagForm({ ctx, initial, onDone }: { ctx: Ctx; initial: TagItem | null; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveTagAction.bind(null, ctx.organizationId, ctx.slug, initial?.id ?? null),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  if (state.status === "success") {
    router.refresh();
    onDone();
  }
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <FormField label="Nom de l'étiquette" required error={errors.name}>
        <Input
          name="name"
          required
          maxLength={60}
          defaultValue={initial?.name ?? ""}
          placeholder="VIP, presse, partenaire…"
        />
      </FormField>
      <FormField label="Couleur">
        <Select name="color" defaultValue={initial?.color ?? "lime"}>
          <option value="lime">Lime</option>
          <option value="lavender">Lavande</option>
          <option value="orange">Orange</option>
          <option value="pink">Rose</option>
          <option value="neutral">Neutre</option>
        </Select>
      </FormField>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Créer l'étiquette"}
        </Button>
      </div>
    </form>
  );
}

export function TagsPanel({ ctx, canManage, tags }: { ctx: Ctx; canManage: boolean; tags: TagItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<"new" | string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = open && open !== "new" ? (tags.find((t) => t.id === open) ?? null) : null;
  return (
    <Panel>
      <PanelTitle>Étiquettes</PanelTitle>
      <p className="text-[12px] text-muted">
        Libres et propres à l'organisation. Elles servent aux filtres et aux segments ; elles ne valent jamais
        consentement.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {tags.length === 0 ? (
        <EmptyState title="Aucune étiquette" description="Créez vos premières étiquettes : VIP, presse, partenaires…" />
      ) : (
        <ul className="m-0 mt-3 list-none divide-y divide-border p-0">
          {tags.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span className="flex items-center gap-2">
                <TagChip name={t.name} color={t.color} />
                <span className="text-muted">{t.count} contact(s)</span>
              </span>
              {canManage ? (
                <span className="flex gap-1">
                  <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setOpen(t.id)}>
                    Modifier
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" className="min-h-9 text-[12px] text-bordeaux">
                        Supprimer
                      </Button>
                    }
                    title={`Supprimer « ${t.name} » ?`}
                    description={`L'étiquette est retirée de ${t.count} contact(s). Les segments qui l'utilisent ne correspondront plus à personne.`}
                    confirmLabel="Supprimer"
                    destructive
                    pending={pending}
                    onConfirm={() =>
                      new Promise<void>((resolve) => {
                        start(async () => {
                          const r = await deleteTagAction(ctx.organizationId, ctx.slug, t.id);
                          if (r.status === "error") setError(r.message ?? "Impossible.");
                          else router.refresh();
                          resolve();
                        });
                      })
                    }
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <Dialog open={open !== null} onOpenChange={(o) => setOpen(o ? (open ?? "new") : null)}>
          <DialogTrigger asChild>
            <Button variant="secondary" className="mt-3" onClick={() => setOpen("new")}>
              + Nouvelle étiquette
            </Button>
          </DialogTrigger>
          <DialogPanel title={editing ? `Modifier « ${editing.name} »` : "Nouvelle étiquette"}>
            <TagForm key={open ?? "closed"} ctx={ctx} initial={editing} onDone={() => setOpen(null)} />
          </DialogPanel>
        </Dialog>
      ) : null}
    </Panel>
  );
}

/* Duplicates ------------------------------------------------------------------- */

export function DuplicatesPanel({
  slug,
  groups,
}: {
  slug: string;
  groups: Array<{ kind: "phone" | "name"; key: string; contacts: Array<{ id: string; name: string; email: string }> }>;
}) {
  return (
    <Panel>
      <PanelTitle>Doublons probables</PanelTitle>
      <p className="text-[12px] text-muted">
        Même téléphone ou même nom. Rien n'est fusionné automatiquement : ouvrez la fiche à conserver et fusionnez
        l'autre depuis « Fusionner un doublon ».
      </p>
      {groups.length === 0 ? (
        <EmptyState
          title="Aucun doublon détecté"
          description="Les adresses e-mail distinctes avec des noms différents restent des contacts distincts."
        />
      ) : (
        <ul className="m-0 mt-3 list-none divide-y divide-border p-0">
          {groups.map((g) => (
            <li key={`${g.kind}-${g.key}`} className="py-3 text-[13px]">
              <b>{g.kind === "phone" ? `Téléphone ${g.key}` : `Nom « ${g.key} »`}</b>
              <ul className="m-0 mt-1 list-none p-0">
                {g.contacts.map((c) => (
                  <li key={c.id}>
                    <Link href={`/o/${slug}/contacts/${c.id}`} className="underline underline-offset-4">
                      {c.name}
                    </Link>{" "}
                    <span className="text-muted">· {c.email}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
