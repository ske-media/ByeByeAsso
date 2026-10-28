"use client";

import { Alert, Badge, Button, ConfirmDialog, FormField, Input, Panel, PanelTitle, Select, Textarea } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { archiveSegmentAction, saveSegmentAction, staticMembersAction } from "@/actions/crm";
import { MARKETING_LABELS, MARKETING_TONE, type MarketingStatus, SOURCE_LABELS } from "../labels";

interface Ctx {
  organizationId: string;
  slug: string;
}

/** Mirror of the server-side rule schema (client cannot import the domain). */
export type Rule =
  | { type: "tag"; op: "in" | "not_in"; tagIds: string[] }
  | { type: "marketing_email"; statuses: MarketingStatus[] }
  | { type: "event"; relation: "ordered" | "attended" | "volunteered" | "assigned"; eventIds: string[] }
  | { type: "membership"; state: "active" | "expired" | "never" | "any"; planIds?: string[] | undefined }
  | { type: "orders"; minCount?: number | undefined; minTotalMinor?: number | undefined }
  | { type: "activity"; after?: string | undefined; before?: string | undefined }
  | { type: "source"; sources: string[] }
  | { type: "search"; q: string };

export interface Definition {
  match: "all" | "any";
  rules: Rule[];
}

export interface EditorOptions {
  tags: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string }>;
  plans: Array<{ id: string; name: string }>;
}

const RULE_LABELS: Record<Rule["type"], string> = {
  marketing_email: "Consentement e-mail",
  tag: "Étiquette",
  event: "Événement",
  membership: "Adhésion",
  orders: "Commandes",
  activity: "Dernière activité",
  source: "Origine",
  search: "Recherche texte",
};

function defaultRule(type: Rule["type"], o: EditorOptions): Rule {
  switch (type) {
    case "tag":
      return { type, op: "in", tagIds: o.tags[0] ? [o.tags[0].id] : [] };
    case "marketing_email":
      return { type, statuses: ["opted_in"] };
    case "event":
      return { type, relation: "ordered", eventIds: o.events[0] ? [o.events[0].id] : [] };
    case "membership":
      return { type, state: "active" };
    case "orders":
      return { type, minCount: 1 };
    case "activity":
      return { type };
    case "source":
      return { type, sources: ["order"] };
    case "search":
      return { type, q: "" };
  }
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="text-[12px] font-bold">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <label
              key={o.id}
              className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-[12px] ${on ? "border-ink bg-lime" : "border-border"}`}
            >
              <input
                type="checkbox"
                className="size-3 accent-ink"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
              />
              {o.label}
            </label>
          );
        })}
        {options.length === 0 ? <span className="text-[12px] text-muted">Aucune option disponible.</span> : null}
      </div>
    </fieldset>
  );
}

function RuleEditor({ rule, options, onChange }: { rule: Rule; options: EditorOptions; onChange: (r: Rule) => void }) {
  switch (rule.type) {
    case "marketing_email":
      return (
        <MultiSelect
          label="Statuts acceptés"
          options={(Object.keys(MARKETING_LABELS) as MarketingStatus[]).map((s) => ({
            id: s,
            label: MARKETING_LABELS[s],
          }))}
          value={rule.statuses}
          onChange={(statuses) => onChange({ ...rule, statuses: statuses as MarketingStatus[] })}
        />
      );
    case "tag":
      return (
        <div className="space-y-2">
          <Select
            value={rule.op}
            onChange={(e) => onChange({ ...rule, op: e.target.value as "in" | "not_in" })}
            aria-label="Opérateur"
          >
            <option value="in">Porte au moins une de ces étiquettes</option>
            <option value="not_in">Ne porte aucune de ces étiquettes</option>
          </Select>
          <MultiSelect
            label="Étiquettes"
            options={options.tags.map((t) => ({ id: t.id, label: t.name }))}
            value={rule.tagIds}
            onChange={(tagIds) => onChange({ ...rule, tagIds })}
          />
        </div>
      );
    case "event":
      return (
        <div className="space-y-2">
          <Select
            value={rule.relation}
            onChange={(e) =>
              onChange({ ...rule, relation: e.target.value as "ordered" | "attended" | "volunteered" | "assigned" })
            }
            aria-label="Relation"
          >
            <option value="ordered">A commandé des billets pour</option>
            <option value="attended">A été contrôlé·e à l'entrée de</option>
            <option value="volunteered">A été accepté·e comme bénévole sur</option>
            <option value="assigned">A une mission publiée sur</option>
          </Select>
          <MultiSelect
            label="Événements (au moins un)"
            options={options.events.map((e) => ({ id: e.id, label: e.title }))}
            value={rule.eventIds}
            onChange={(eventIds) => onChange({ ...rule, eventIds })}
          />
        </div>
      );
    case "membership":
      return (
        <div className="space-y-2">
          <Select
            value={rule.state}
            onChange={(e) => onChange({ ...rule, state: e.target.value as "active" | "expired" | "never" | "any" })}
            aria-label="État d'adhésion"
          >
            <option value="active">Adhésion active</option>
            <option value="expired">Adhésion expirée ou résiliée (aucune active)</option>
            <option value="never">N'a jamais adhéré</option>
            <option value="any">A adhéré au moins une fois</option>
          </Select>
          {rule.state !== "never" ? (
            <MultiSelect
              label="Formules (facultatif)"
              options={options.plans.map((p) => ({ id: p.id, label: p.name }))}
              value={rule.planIds ?? []}
              onChange={(planIds) => onChange({ ...rule, planIds })}
            />
          ) : null}
        </div>
      );
    case "orders":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <FormField label="Commandes payées, au moins">
            <Input
              type="number"
              min={0}
              value={rule.minCount ?? ""}
              onChange={(e) =>
                onChange({ ...rule, minCount: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </FormField>
          <FormField label="Total dépensé, au moins (€)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={rule.minTotalMinor === undefined ? "" : rule.minTotalMinor / 100}
              onChange={(e) =>
                onChange({
                  ...rule,
                  minTotalMinor: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </FormField>
        </div>
      );
    case "activity":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <FormField label="Après le">
            <Input
              type="date"
              value={rule.after ?? ""}
              onChange={(e) => onChange({ ...rule, after: e.target.value || undefined })}
            />
          </FormField>
          <FormField label="Avant le">
            <Input
              type="date"
              value={rule.before ?? ""}
              onChange={(e) => onChange({ ...rule, before: e.target.value || undefined })}
            />
          </FormField>
        </div>
      );
    case "source":
      return (
        <MultiSelect
          label="Origine de la fiche"
          options={Object.entries(SOURCE_LABELS)
            .filter(([v]) => v !== "system")
            .map(([id, label]) => ({ id, label }))}
          value={rule.sources}
          onChange={(sources) => onChange({ ...rule, sources })}
        />
      );
    case "search":
      return (
        <FormField label="Texte (nom, e-mail)">
          <Input value={rule.q} onChange={(e) => onChange({ ...rule, q: e.target.value })} />
        </FormField>
      );
  }
}

interface Preview {
  count: number;
  consented: number;
  sample: Array<{ id: string; email: string; name: string; marketingEmailStatus: MarketingStatus }>;
}

export function SegmentEditor({
  ctx,
  options,
  initial,
  canManage,
}: {
  ctx: Ctx;
  options: EditorOptions;
  initial: {
    id: string;
    version: number;
    name: string;
    description: string;
    kind: "dynamic" | "static";
    definition: Definition;
    memberCount: number | null;
    members: Array<{ id: string; email: string; name: string; marketingEmailStatus: MarketingStatus }>;
  } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<"dynamic" | "static">(initial?.kind ?? "dynamic");
  const [def, setDef] = useState<Definition>(
    initial?.definition ?? { match: "all", rules: [{ type: "marketing_email", statuses: ["opted_in"] }] },
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [addType, setAddType] = useState<Rule["type"]>("tag");
  const [keys, setKeys] = useState<string[]>(() => (initial?.definition.rules ?? [{}]).map(() => crypto.randomUUID()));

  const runPreview = useCallback(async () => {
    if (kind !== "dynamic") return;
    try {
      const res = await fetch(`/api/v1/organizations/${ctx.organizationId}/segments/preview`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "kroov" },
        body: JSON.stringify(def),
      });
      const body = (await res.json()) as {
        data?: Preview;
        error?: { message: string; fieldErrors?: Record<string, string[]> };
      };
      if (!res.ok || !body.data) {
        setPreview(null);
        setPreviewError(
          body.error?.fieldErrors
            ? Object.values(body.error.fieldErrors).flat().join(" ")
            : (body.error?.message ?? "Aperçu impossible."),
        );
        return;
      }
      setPreviewError(null);
      setPreview(body.data);
    } catch {
      setPreviewError("Aperçu impossible (réseau).");
    }
  }, [ctx.organizationId, def, kind]);

  useEffect(() => {
    const t = setTimeout(() => void runPreview(), 250);
    return () => clearTimeout(t);
  }, [runPreview]);

  const save = () =>
    start(async () => {
      const r = await saveSegmentAction(ctx.organizationId, ctx.slug, initial?.id ?? null, initial?.version ?? null, {
        name,
        description,
        kind,
        definition: def,
      });
      if (r.status === "error") {
        setMessage({ tone: "error", text: r.message ?? "Enregistrement impossible." });
        return;
      }
      if (!initial && r.segmentId) {
        router.push(`/o/${ctx.slug}/contacts/segments/${r.segmentId}`);
        return;
      }
      setMessage({ tone: "success", text: r.status === "success" ? (r.message ?? "") : "" });
      router.refresh();
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <Panel>
          <PanelTitle>Définition</PanelTitle>
          <div className="space-y-2">
            <FormField label="Nom du segment" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                disabled={!canManage}
                placeholder="Acheteurs consentis 2027"
              />
            </FormField>
            <FormField label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={!canManage}
              />
            </FormField>
            <FormField label="Type" hint="Dynamique : recalculé à chaque usage. Statique : liste tenue à la main.">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as "dynamic" | "static")}
                disabled={!canManage || Boolean(initial)}
              >
                <option value="dynamic">Dynamique (règles)</option>
                <option value="static">Statique (liste)</option>
              </Select>
            </FormField>
          </div>
        </Panel>
        {kind === "dynamic" ? (
          <Panel>
            <PanelTitle>Règles</PanelTitle>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
              Le contact correspond si
              <Select
                value={def.match}
                onChange={(e) => setDef({ ...def, match: e.target.value as "all" | "any" })}
                aria-label="Combinaison"
                className="w-auto"
                disabled={!canManage}
              >
                <option value="all">toutes les règles</option>
                <option value="any">au moins une règle</option>
              </Select>
              s'appliquent.
            </div>
            {def.rules.length === 0 ? (
              <p className="text-[13px] text-muted">Sans règle, le segment contient tous les contacts actifs.</p>
            ) : null}
            <ol className="m-0 list-none space-y-3 p-0">
              {def.rules.map((rule, i) => (
                <li key={keys[i] ?? `${rule.type}-${i}`} className="rounded-[9px] border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <b className="text-[13px]">
                      {i + 1}. {RULE_LABELS[rule.type]}
                    </b>
                    {canManage ? (
                      <button
                        type="button"
                        className="text-[12px] underline"
                        onClick={() => {
                          setDef({ ...def, rules: def.rules.filter((_, j) => j !== i) });
                          setKeys((k) => k.filter((_, j) => j !== i));
                        }}
                      >
                        Retirer
                      </button>
                    ) : null}
                  </div>
                  <fieldset className="m-0 border-0 p-0" disabled={!canManage}>
                    <RuleEditor
                      rule={rule}
                      options={options}
                      onChange={(r) => setDef({ ...def, rules: def.rules.map((x, j) => (j === i ? r : x)) })}
                    />
                  </fieldset>
                </li>
              ))}
            </ol>
            {canManage ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <FormField label="Ajouter une règle">
                  <Select value={addType} onChange={(e) => setAddType(e.target.value as Rule["type"])}>
                    {(Object.keys(RULE_LABELS) as Rule["type"][]).map((t) => (
                      <option key={t} value={t}>
                        {RULE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDef({ ...def, rules: [...def.rules, defaultRule(addType, options)] });
                    setKeys((k) => [...k, crypto.randomUUID()]);
                  }}
                >
                  + Ajouter
                </Button>
              </div>
            ) : null}
          </Panel>
        ) : initial ? (
          <StaticMembers ctx={ctx} segmentId={initial.id} members={initial.members} canManage={canManage} />
        ) : (
          <Panel>
            <PanelTitle>Membres</PanelTitle>
            <p className="text-[13px] text-muted">
              Enregistrez d'abord le segment, puis ajoutez des contacts depuis la recherche.
            </p>
          </Panel>
        )}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={pending}
              loadingLabel="Enregistrement"
              onClick={save}
              disabled={name.trim().length === 0}
            >
              {initial ? "Enregistrer le segment" : "Créer le segment"}
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/o/${ctx.slug}/contacts/segments`}>Retour aux segments</Link>
            </Button>
            {initial ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" className="text-bordeaux">
                    Archiver
                  </Button>
                }
                title={`Archiver « ${initial.name} » ?`}
                description="Le segment disparaît des listes ; les contacts ne sont pas touchés."
                confirmLabel="Archiver"
                destructive
                onConfirm={async () => {
                  await archiveSegmentAction(ctx.organizationId, ctx.slug, initial.id);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-5">
        <Panel className={kind === "dynamic" ? "bg-lavender" : "bg-neutral"}>
          <PanelTitle>{kind === "dynamic" ? "Aperçu en direct" : "Membres"}</PanelTitle>
          {kind === "dynamic" ? (
            previewError ? (
              <Alert tone="error">{previewError}</Alert>
            ) : preview ? (
              <>
                <p className="text-[36px] font-black leading-none">{preview.count}</p>
                <p className="mt-1 text-[13px]">
                  contact(s) correspondant(s) · <b>{preview.consented}</b> consenti(s) pour l'e-mail
                </p>
                {preview.count > preview.consented ? (
                  <p className="mt-2 text-[12px] text-muted">
                    {preview.count - preview.consented} contact(s) sans consentement explicite ne recevront pas de
                    campagne, sauf décision motivée au moment de l'envoi.
                  </p>
                ) : null}
                {preview.sample.length > 0 ? (
                  <ul className="m-0 mt-3 list-none divide-y divide-ink/10 p-0 text-[12px]">
                    {preview.sample.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-1">
                        <span>
                          <b>{c.name}</b> <span className="text-muted">· {c.email}</span>
                        </span>
                        <Badge tone={MARKETING_TONE[c.marketingEmailStatus]} noDot>
                          {MARKETING_LABELS[c.marketingEmailStatus]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-3 text-[11px] text-muted">
                  Recalculé maintenant ; l'audience est recalculée à l'envoi (phase 8).
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted">Calcul…</p>
            )
          ) : (
            <p className="text-[36px] font-black leading-none">{initial?.memberCount ?? 0}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function StaticMembers({
  ctx,
  segmentId,
  members,
  canManage,
}: {
  ctx: Ctx;
  segmentId: string;
  members: Array<{ id: string; email: string; name: string; marketingEmailStatus: MarketingStatus }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const search = async () => {
    const res = await fetch(
      `/api/v1/organizations/${ctx.organizationId}/contacts?q=${encodeURIComponent(q)}&pageSize=8`,
      {
        headers: { "x-requested-with": "kroov" },
      },
    );
    if (!res.ok) return setResults([]);
    const body = (await res.json()) as { data: { contacts: Array<{ id: string; name: string; email: string }> } };
    setResults(body.data.contacts.filter((c) => !members.some((m) => m.id === c.id)));
  };
  const change = (c: { add?: string[]; remove?: string[] }) =>
    start(async () => {
      const r = await staticMembersAction(ctx.organizationId, ctx.slug, segmentId, c);
      setMessage({
        tone: r.status === "error" ? "error" : "success",
        text: r.status === "idle" ? "" : (r.message ?? ""),
      });
      setResults([]);
      router.refresh();
    });
  return (
    <Panel>
      <PanelTitle>Membres ({members.length})</PanelTitle>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {members.length === 0 ? (
        <p className="text-[13px] text-muted">Aucun membre.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-1">
              <span>
                <Link href={`/o/${ctx.slug}/contacts/${m.id}`} className="font-bold underline underline-offset-4">
                  {m.name}
                </Link>{" "}
                <span className="text-muted">· {m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={MARKETING_TONE[m.marketingEmailStatus]} noDot>
                  {MARKETING_LABELS[m.marketingEmailStatus]}
                </Badge>
                {canManage ? (
                  <button
                    type="button"
                    className="text-[12px] underline"
                    disabled={pending}
                    onClick={() => change({ remove: [m.id] })}
                  >
                    Retirer
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="mt-3 space-y-2">
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
              placeholder="Nom ou e-mail"
              aria-label="Rechercher un contact à ajouter"
            />
            <Button type="submit" variant="secondary" className="min-h-9">
              Chercher
            </Button>
          </form>
          {results.length > 0 ? (
            <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                  <span>
                    <b>{r.name}</b> <span className="text-muted">· {r.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    className="min-h-9 text-[12px]"
                    loading={pending}
                    loadingLabel="…"
                    onClick={() => change({ add: [r.id] })}
                  >
                    Ajouter
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
