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
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import { archiveTicketTypeAction, createTicketTypeAction, updateTicketTypeAction } from "@/actions/ticketing";
import { type ActionState, idleState } from "@/lib/action-state";
import { fmtMinor, majorString } from "@/lib/money";

export interface TicketTypeRow {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  quota: number | null;
  salesStart: { date: string; time: string } | null;
  salesEnd: { date: string; time: string } | null;
  salesLabel: string;
  minPerOrder: number;
  maxPerOrder: number;
  hidden: boolean;
  position: number;
  status: "active" | "archived";
  poolId: string | null;
  poolName: string | null;
  sold: number;
  held: number;
  available: number | null;
}

export interface PoolOption {
  id: string;
  name: string;
  capacity: number;
}

interface Ctx {
  organizationId: string;
  slug: string;
  eventId: string;
  eventSlug: string;
  timezone: string;
  currency: string;
  canManage: boolean;
}

function TicketTypeForm({
  ctx,
  pools,
  initial,
  onDone,
}: {
  ctx: Ctx;
  pools: PoolOption[];
  initial: TicketTypeRow | null;
  onDone: () => void;
}) {
  const bound = initial
    ? updateTicketTypeAction.bind(
        null,
        ctx.organizationId,
        ctx.slug,
        ctx.eventId,
        ctx.eventSlug,
        ctx.timezone,
        initial.id,
      )
    : createTicketTypeAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, ctx.timezone);
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await bound(prev, formData);
    if (next.status === "success") onDone();
    return next;
  }, idleState);
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const str = (k: string, fallback = "") => v[k] ?? fallback;
  return (
    <form action={action} noValidate className="space-y-1">
      {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
        <Alert tone="error" className="mb-3">
          {state.message}
        </Alert>
      ) : null}
      <FormField label="Nom du tarif" required error={errors.name}>
        <Input
          name="name"
          required
          maxLength={80}
          defaultValue={str("name", initial?.name ?? "")}
          placeholder="Tarif standard"
        />
      </FormField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField
          label={`Prix public (${ctx.currency})`}
          required
          hint="0 = gratuit, sans frais ni paiement."
          error={errors.price}
        >
          <Input
            name="price"
            inputMode="decimal"
            defaultValue={str("price", initial ? majorString(initial.priceMinor) : "0,00")}
          />
        </FormField>
        <FormField label="Quota" hint="Vide = limité par la capacité (et le pool)." error={errors.quota}>
          <Input
            name="quota"
            type="number"
            min={0}
            max={1_000_000}
            defaultValue={str("quota", initial?.quota?.toString() ?? "")}
          />
        </FormField>
      </div>
      <FormField label="Description" error={errors.description}>
        <Textarea
          name="description"
          rows={2}
          maxLength={600}
          defaultValue={str("description", initial?.description ?? "")}
        />
      </FormField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Début des ventes" hint="Vide = dès l'ouverture." error={errors.salesStartDate}>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              type="date"
              name="salesStartDate"
              defaultValue={str("salesStartDate", initial?.salesStart?.date ?? "")}
            />
            <Input
              type="time"
              name="salesStartTime"
              defaultValue={str("salesStartTime", initial?.salesStart?.time ?? "")}
              aria-label="Heure de début des ventes"
            />
          </div>
        </FormField>
        <FormField label="Fin des ventes" hint="Vide = jusqu'à la clôture." error={errors.salesEndDate}>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input type="date" name="salesEndDate" defaultValue={str("salesEndDate", initial?.salesEnd?.date ?? "")} />
            <Input
              type="time"
              name="salesEndTime"
              defaultValue={str("salesEndTime", initial?.salesEnd?.time ?? "")}
              aria-label="Heure de fin des ventes"
            />
          </div>
        </FormField>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <FormField label="Min. par commande" error={errors.minPerOrder}>
          <Input
            name="minPerOrder"
            type="number"
            min={1}
            max={50}
            defaultValue={str("minPerOrder", String(initial?.minPerOrder ?? 1))}
          />
        </FormField>
        <FormField label="Max. par commande" error={errors.maxPerOrder}>
          <Input
            name="maxPerOrder"
            type="number"
            min={1}
            max={50}
            defaultValue={str("maxPerOrder", String(initial?.maxPerOrder ?? 10))}
          />
        </FormField>
        <FormField label="Ordre d'affichage" error={errors.position}>
          <Input
            name="position"
            type="number"
            min={0}
            max={1000}
            defaultValue={str("position", String(initial?.position ?? 0))}
          />
        </FormField>
      </div>
      <FormField
        label="Pool de capacité partagée"
        hint="Plusieurs tarifs peuvent puiser dans la même jauge."
        error={errors.poolId}
      >
        <Select name="poolId" defaultValue={str("poolId", initial?.poolId ?? "none")}>
          <option value="none">Aucun</option>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.capacity} places
            </option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-start gap-2 py-2 text-[13px]">
        <input
          type="checkbox"
          name="hidden"
          defaultChecked={initial?.hidden ?? false}
          className="mt-1 size-4 accent-ink"
        />
        <span>
          Tarif masqué
          <span className="block text-muted">
            Absent de la page publique ; réservé aux liens directs (invités, partenaires).
          </span>
        </span>
      </label>
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Ajouter le tarif"}
        </Button>
      </div>
    </form>
  );
}

export function TicketTypesPanel({ ctx, types, pools }: { ctx: Ctx; types: TicketTypeRow[]; pools: PoolOption[] }) {
  const [open, setOpen] = useState<null | "new" | string>(null);
  const [notice, setNotice] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  const editing = typeof open === "string" && open !== "new" ? (types.find((t) => t.id === open) ?? null) : null;
  const active = types.filter((t) => t.status === "active");
  const archived = types.filter((t) => t.status === "archived");

  return (
    <div className="space-y-3">
      {notice.status !== "idle" && notice.message ? (
        <Alert tone={notice.status === "success" ? "success" : "error"}>{notice.message}</Alert>
      ) : null}
      {active.length === 0 ? (
        <p className="text-[13px] text-muted">
          Aucun tarif pour l'instant. Un événement gratuit a aussi besoin d'un tarif (à 0) pour émettre des billets.
        </p>
      ) : (
        <TableContainer label="Tarifs de l'événement" className="border-0 bg-transparent">
          <Table>
            <THead>
              <TR>
                <TH>Billet</TH>
                <TH>Prix public</TH>
                <TH>Quota</TH>
                <TH>Vendus · réservés · restants</TH>
                <TH>Disponibilité</TH>
                <TH>
                  <span className="k-sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {active.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <b>{t.name}</b>
                    {t.hidden ? (
                      <Badge tone="lavender" noDot className="ml-2">
                        Masqué
                      </Badge>
                    ) : null}
                    {t.poolName ? <span className="block text-[11px] text-muted">Pool « {t.poolName} »</span> : null}
                  </TD>
                  <TD>{t.priceMinor === 0 ? "Gratuit" : fmtMinor(t.priceMinor, t.currency)}</TD>
                  <TD>{t.quota ?? "—"}</TD>
                  <TD>
                    {t.sold} · {t.held} · {t.available ?? "∞"}
                  </TD>
                  <TD>{t.salesLabel}</TD>
                  <TD className="text-right">
                    {ctx.canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(t.id)}>
                          Modifier
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="ghost">
                              Archiver
                            </Button>
                          }
                          title={`Archiver « ${t.name} » ?`}
                          description="Le tarif disparaît de la vente. Les billets déjà émis restent valides. Impossible tant que des réservations en cours l'utilisent."
                          confirmLabel="Archiver"
                          pending={isPending}
                          onConfirm={() =>
                            startTransition(async () =>
                              setNotice(
                                await archiveTicketTypeAction(
                                  ctx.organizationId,
                                  ctx.slug,
                                  ctx.eventId,
                                  ctx.eventSlug,
                                  t.id,
                                ),
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
      {archived.length > 0 ? (
        <p className="text-[12px] text-muted">
          {archived.length} tarif(s) archivé(s) : {archived.map((t) => t.name).join(", ")}.
        </p>
      ) : null}
      {ctx.canManage ? (
        <Dialog open={open !== null} onOpenChange={(o) => setOpen(o ? (open ?? "new") : null)}>
          <DialogTrigger asChild>
            <Button variant="secondary" onClick={() => setOpen("new")}>
              + Ajouter un tarif
            </Button>
          </DialogTrigger>
          <DialogPanel
            title={editing ? `Modifier « ${editing.name} »` : "Nouveau tarif"}
            description="Le prix est affiché hors frais ; les frais acheteur sont annoncés avant le paiement."
            className="max-w-[640px]"
          >
            <TicketTypeForm
              key={open ?? "closed"}
              ctx={ctx}
              pools={pools}
              initial={editing}
              onDone={() => setOpen(null)}
            />
          </DialogPanel>
        </Dialog>
      ) : null}
    </div>
  );
}
