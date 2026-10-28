"use client";

import { Alert, Badge, Button, ConfirmDialog, FormField, Input, Select } from "@kroov/ui";
import { useActionState, useState, useTransition } from "react";
import {
  createPoolAction,
  createPromoCodeAction,
  deletePoolAction,
  setTicketingStatusAction,
  togglePromoCodeAction,
  updateTicketingSettingsAction,
} from "@/actions/ticketing";
import { type ActionState, idleState } from "@/lib/action-state";
import { fmtMinor } from "@/lib/money";

interface Ctx {
  organizationId: string;
  slug: string;
  eventId: string;
  eventSlug: string;
  timezone: string;
  currency: string;
  canManage: boolean;
}

export function SalesSettingsForm({
  ctx,
  initial,
}: {
  ctx: Ctx;
  initial: {
    maxTicketsPerOrder: number;
    salesClose: { date: string; time: string } | null;
    nominativeTickets: boolean;
  };
}) {
  const [state, action, pending] = useActionState(
    updateTicketingSettingsAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, ctx.timezone),
    idleState,
  );
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} noValidate>
      {state.status === "success" ? (
        <Alert tone="success" className="mb-3">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
        <Alert tone="error" className="mb-3">
          {state.message}
        </Alert>
      ) : null}
      <FormField label="Billets maximum par commande" required error={errors.maxTicketsPerOrder}>
        <Select
          name="maxTicketsPerOrder"
          defaultValue={v.maxTicketsPerOrder ?? String(initial.maxTicketsPerOrder)}
          disabled={!ctx.canManage}
        >
          {[1, 2, 4, 6, 8, 10, 12, 20].map((n) => (
            <option key={n} value={n}>
              {n} billet{n > 1 ? "s" : ""}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Clôture des ventes" hint="Vide = au début de l'événement." error={errors.salesCloseDate}>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            type="date"
            name="salesCloseDate"
            defaultValue={v.salesCloseDate ?? initial.salesClose?.date ?? ""}
            disabled={!ctx.canManage}
          />
          <Input
            type="time"
            name="salesCloseTime"
            defaultValue={v.salesCloseTime ?? initial.salesClose?.time ?? ""}
            aria-label="Heure de clôture"
            disabled={!ctx.canManage}
          />
        </div>
      </FormField>
      <label className="flex items-start justify-between gap-3 py-2 text-[13px]">
        <span>
          Billets nominatifs
          <span className="block text-muted">Un nom par billet, demandé à la commande et affiché à l'entrée.</span>
        </span>
        <input
          type="checkbox"
          name="nominativeTickets"
          defaultChecked={v.nominativeTickets ? v.nominativeTickets === "on" : initial.nominativeTickets}
          className="mt-1 size-5 accent-ink"
          disabled={!ctx.canManage}
        />
      </label>
      {ctx.canManage ? (
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Enregistrement" className="mt-2">
          Enregistrer
        </Button>
      ) : null}
    </form>
  );
}

export function SalesStatusControl({
  ctx,
  status,
  canOpen,
  blockers,
}: {
  ctx: Ctx;
  status: "not_configured" | "open" | "closed";
  canOpen: boolean;
  blockers: string[];
}) {
  const [notice, setNotice] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge tone={status === "open" ? "lime" : status === "closed" ? "orange" : "neutral"}>
          {status === "open" ? "Ventes ouvertes" : status === "closed" ? "Ventes closes" : "Billetterie non ouverte"}
        </Badge>
      </div>
      {notice.status !== "idle" && notice.message ? (
        <Alert tone={notice.status === "success" ? "success" : "error"}>{notice.message}</Alert>
      ) : null}
      {blockers.length > 0 && status !== "open" ? (
        <ul className="m-0 list-disc pl-5 text-[13px] text-muted">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {ctx.canManage ? (
        status === "open" ? (
          <ConfirmDialog
            trigger={<Button variant="secondary">Fermer les ventes</Button>}
            title="Fermer les ventes en ligne ?"
            description="La page publique n'acceptera plus de nouvelle commande. Les réservations en cours peuvent aller au bout de leur délai. Vous pourrez rouvrir."
            confirmLabel="Fermer les ventes"
            pending={isPending}
            onConfirm={() =>
              startTransition(async () =>
                setNotice(
                  await setTicketingStatusAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, "closed"),
                ),
              )
            }
          />
        ) : (
          <Button
            variant="primary"
            disabled={!canOpen}
            disabledReason={blockers[0] ?? "Complétez la configuration."}
            loading={isPending}
            loadingLabel="Ouverture"
            onClick={() =>
              startTransition(async () =>
                setNotice(
                  await setTicketingStatusAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, "open"),
                ),
              )
            }
          >
            Ouvrir les ventes →
          </Button>
        )
      ) : null}
    </div>
  );
}

export function PoolsPanel({
  ctx,
  pools,
}: {
  ctx: Ctx;
  pools: Array<{ id: string; name: string; capacity: number; sold: number; held: number; ticketTypeIds: string[] }>;
}) {
  const [state, action, pending] = useActionState(
    createPoolAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug),
    idleState,
  );
  const [notice, setNotice] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <div className="space-y-3">
      {pools.length === 0 ? (
        <p className="text-[13px] text-muted">
          Aucun pool : chaque tarif est borné par son quota et par la capacité de l'événement.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
          {pools.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <b>{p.name}</b> · {p.capacity} places · {p.sold} vendues, {p.held} réservées
                <span className="block text-muted">{p.ticketTypeIds.length} tarif(s) rattaché(s)</span>
              </span>
              {ctx.canManage ? (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="ghost">
                      Supprimer
                    </Button>
                  }
                  title={`Supprimer le pool « ${p.name} » ?`}
                  description="Les tarifs rattachés ne seront plus limités que par leur quota et la capacité de l'événement."
                  confirmLabel="Supprimer"
                  destructive
                  pending={isPending}
                  onConfirm={() =>
                    startTransition(async () =>
                      setNotice(await deletePoolAction(ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, p.id)),
                    )
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {notice.status !== "idle" && notice.message ? (
        <Alert tone={notice.status === "success" ? "success" : "error"}>{notice.message}</Alert>
      ) : null}
      {ctx.canManage ? (
        <form
          action={action}
          noValidate
          className="grid items-end gap-2 sm:grid-cols-[1fr_120px_auto]"
          key={state.status === "success" ? state.message : "pool"}
        >
          <FormField label="Nouveau pool" error={errors.name} className="mb-0">
            <Input name="name" placeholder="Salle" maxLength={80} />
          </FormField>
          <FormField label="Places" error={errors.capacity} className="mb-0">
            <Input name="capacity" type="number" min={0} max={1_000_000} />
          </FormField>
          <Button type="submit" variant="secondary" loading={pending} loadingLabel="Création">
            Créer
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function PromoCodesPanel({
  ctx,
  codes,
}: {
  ctx: Ctx;
  codes: Array<{
    id: string;
    code: string;
    kind: "percent" | "amount";
    value: number;
    maxRedemptions: number | null;
    redemptions: number;
    active: boolean;
    validity: string;
  }>;
}) {
  const [state, action, pending] = useActionState(
    createPromoCodeAction.bind(null, ctx.organizationId, ctx.slug, ctx.eventId, ctx.eventSlug, ctx.timezone),
    idleState,
  );
  const [notice, setNotice] = useState<ActionState>(idleState);
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <div className="space-y-3">
      {codes.length === 0 ? (
        <p className="text-[13px] text-muted">Aucun code promo.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <code className="rounded bg-neutral px-1 font-bold">{c.code}</code> ·{" "}
                {c.kind === "percent" ? `−${(c.value / 100).toFixed(0)} %` : `−${fmtMinor(c.value, ctx.currency)}`} ·{" "}
                {c.redemptions}
                {c.maxRedemptions ? `/${c.maxRedemptions}` : ""} utilisation(s)
                <span className="block text-muted">{c.validity}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={c.active ? "lime" : "neutral"}>{c.active ? "Actif" : "Inactif"}</Badge>
                {ctx.canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={isPending}
                    onClick={() =>
                      startTransition(async () =>
                        setNotice(
                          await togglePromoCodeAction(
                            ctx.organizationId,
                            ctx.slug,
                            ctx.eventId,
                            ctx.eventSlug,
                            c.id,
                            !c.active,
                          ),
                        ),
                      )
                    }
                  >
                    {c.active ? "Désactiver" : "Activer"}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice.status !== "idle" && notice.message ? (
        <Alert tone={notice.status === "success" ? "success" : "error"}>{notice.message}</Alert>
      ) : null}
      {state.status === "error" && state.message && Object.keys(errors).length === 0 ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
      {ctx.canManage ? (
        <form
          action={action}
          noValidate
          className="grid gap-x-3 sm:grid-cols-2"
          key={state.status === "success" ? state.message : "promo"}
        >
          <FormField label="Code" required hint="Lettres, chiffres, tirets." error={errors.code}>
            <Input name="code" maxLength={30} placeholder="NUIT-10" className="uppercase" />
          </FormField>
          <FormField label="Remise" required error={errors.value}>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input name="value" inputMode="decimal" placeholder={kind === "percent" ? "10" : "5,00"} />
              <Select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "percent" | "amount")}
                aria-label="Type de remise"
              >
                <option value="percent">%</option>
                <option value="amount">{ctx.currency}</option>
              </Select>
            </div>
          </FormField>
          <FormField label="Utilisations max." hint="Vide = illimité." error={errors.maxRedemptions}>
            <Input name="maxRedemptions" type="number" min={1} />
          </FormField>
          <FormField label="Valable jusqu'au" hint="Vide = sans limite." error={errors.validFromDate}>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input type="date" name="validUntilDate" />
              <Input type="time" name="validUntilTime" aria-label="Heure de fin de validité" />
            </div>
          </FormField>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" loading={pending} loadingLabel="Création">
              Créer le code
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
