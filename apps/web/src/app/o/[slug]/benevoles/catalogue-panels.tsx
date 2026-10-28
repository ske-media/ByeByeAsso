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
  Textarea,
} from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  archivePositionAction,
  archiveSkillAction,
  archiveTeamAction,
  savePositionAction,
  saveSkillAction,
  saveTeamAction,
} from "@/actions/volunteers";
import { idleState } from "@/lib/action-state";

export interface SkillItem {
  id: string;
  name: string;
  description: string | null;
  requiresVerification: boolean;
  status: "active" | "archived";
  positionsCount: number;
}
export interface TeamItem {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  status: "active" | "archived";
  positionsCount: number;
}
export interface PositionItem {
  id: string;
  teamId: string;
  teamName: string;
  name: string;
  description: string | null;
  instructions: string | null;
  minAge: number | null;
  position: number;
  status: "active" | "archived";
  skills: Array<{ skillId: string; name: string; mandatory: boolean }>;
}

interface Ctx {
  organizationId: string;
  slug: string;
}

export const TEAM_COLOR_CLASS: Record<string, string> = {
  lime: "bg-lime",
  lavender: "bg-lavender",
  orange: "bg-orange",
  neutral: "bg-neutral",
};

function ArchiveButton({
  label,
  title,
  description,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => Promise<{ status: string; message?: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {error ? <span className="text-[11px] text-error-text">{error}</span> : null}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" className="min-h-9 text-[12px]">
            {label}
          </Button>
        }
        title={title}
        description={description}
        confirmLabel="Archiver"
        destructive
        pending={pending}
        onConfirm={() =>
          new Promise<void>((resolve) => {
            start(async () => {
              const r = await onConfirm();
              if (r.status === "error") setError(r.message ?? "Impossible.");
              else router.refresh();
              resolve();
            });
          })
        }
      />
    </span>
  );
}

/* Skills ------------------------------------------------------------------ */

function SkillForm({ ctx, initial, onDone }: { ctx: Ctx; initial: SkillItem | null; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveSkillAction.bind(null, ctx.organizationId, ctx.slug, initial?.id ?? null),
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
      <FormField label="Nom de la compétence" required error={errors.name}>
        <Input
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name ?? ""}
          placeholder="SST, service au bar, permis B…"
        />
      </FormField>
      <FormField label="Description" error={errors.description}>
        <Textarea name="description" rows={2} maxLength={500} defaultValue={initial?.description ?? ""} />
      </FormField>
      <label className="flex items-start gap-2 py-2 text-[13px]">
        <input
          type="checkbox"
          name="requiresVerification"
          defaultChecked={initial?.requiresVerification ?? false}
          className="mt-1 size-4 accent-ink"
        />
        <span>
          Vérification requise
          <span className="block text-muted">
            Une déclaration ne compte comme qualification qu'après vérification par l'équipe (diplôme, carte…).
          </span>
        </span>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Ajouter la compétence"}
        </Button>
      </div>
    </form>
  );
}

export function SkillsPanel({ ctx, skills }: { ctx: Ctx; skills: SkillItem[] }) {
  const [open, setOpen] = useState<"new" | string | null>(null);
  const editing = open && open !== "new" ? (skills.find((s) => s.id === open) ?? null) : null;
  const active = skills.filter((s) => s.status === "active");
  return (
    <Panel>
      <PanelTitle>Compétences</PanelTitle>
      <p className="text-[12px] text-muted">
        Déclarées par les candidats, exigées par les postes. Les compétences « à vérifier » deviennent des contraintes
        dures du planning une fois vérifiées.
      </p>
      {active.length === 0 ? (
        <EmptyState
          title="Aucune compétence"
          description="Ajoutez les compétences que vos postes exigent ou apprécient."
        />
      ) : (
        <ul className="m-0 mt-3 list-none divide-y divide-border p-0">
          {active.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span>
                <b>{s.name}</b>
                {s.requiresVerification ? (
                  <Badge tone="orange" noDot className="ml-2">
                    À vérifier
                  </Badge>
                ) : null}
                <span className="block text-[11px] text-muted">
                  {s.description ?? ""}
                  {s.positionsCount > 0 ? ` · exigée par ${s.positionsCount} poste(s)` : ""}
                </span>
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setOpen(s.id)}>
                  Modifier
                </Button>
                <ArchiveButton
                  label="Archiver"
                  title={`Archiver « ${s.name} » ?`}
                  description="Elle ne sera plus proposée aux candidats ; les déclarations existantes restent visibles."
                  onConfirm={() => archiveSkillAction(ctx.organizationId, ctx.slug, s.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => setOpen(o ? (open ?? "new") : null)}>
        <DialogTrigger asChild>
          <Button variant="secondary" className="mt-3" onClick={() => setOpen("new")}>
            + Ajouter une compétence
          </Button>
        </DialogTrigger>
        <DialogPanel title={editing ? `Modifier « ${editing.name} »` : "Nouvelle compétence"}>
          <SkillForm key={open ?? "closed"} ctx={ctx} initial={editing} onDone={() => setOpen(null)} />
        </DialogPanel>
      </Dialog>
    </Panel>
  );
}

/* Teams ------------------------------------------------------------------- */

function TeamForm({ ctx, initial, onDone }: { ctx: Ctx; initial: TeamItem | null; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveTeamAction.bind(null, ctx.organizationId, ctx.slug, initial?.id ?? null),
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
      <FormField label="Nom de l'équipe" required error={errors.name}>
        <Input
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name ?? ""}
          placeholder="Bar, Accueil, Technique…"
        />
      </FormField>
      <FormField label="Description" error={errors.description}>
        <Textarea name="description" rows={2} maxLength={500} defaultValue={initial?.description ?? ""} />
      </FormField>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Couleur (planning)" error={errors.color}>
          <Select name="color" defaultValue={initial?.color ?? "lavender"}>
            <option value="lime">Citron</option>
            <option value="lavender">Lavande</option>
            <option value="orange">Orange</option>
            <option value="neutral">Neutre</option>
          </Select>
        </FormField>
        <FormField label="Ordre" error={errors.position}>
          <Input type="number" name="position" min={0} defaultValue={String(initial?.position ?? 0)} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
          {initial ? "Enregistrer" : "Créer l'équipe"}
        </Button>
      </div>
    </form>
  );
}

/* Positions --------------------------------------------------------------- */

function PositionForm({
  ctx,
  teams,
  skills,
  initial,
  onDone,
}: {
  ctx: Ctx;
  teams: TeamItem[];
  skills: SkillItem[];
  initial: PositionItem | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    savePositionAction.bind(null, ctx.organizationId, ctx.slug, initial?.id ?? null),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  if (state.status === "success") {
    router.refresh();
    onDone();
  }
  const activeTeams = teams.filter((t) => t.status === "active");
  const activeSkills = skills.filter((s) => s.status === "active");
  return (
    <form action={action} noValidate className="space-y-2">
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Nom du poste" required error={errors.name}>
          <Input name="name" required maxLength={80} defaultValue={initial?.name ?? ""} placeholder="Bar principal" />
        </FormField>
        <FormField label="Équipe" required error={errors.teamId}>
          <Select name="teamId" defaultValue={initial?.teamId ?? activeTeams[0]?.id ?? ""}>
            {activeTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Description (visible des candidats)" error={errors.description}>
        <Textarea name="description" rows={2} maxLength={1000} defaultValue={initial?.description ?? ""} />
      </FormField>
      <FormField label="Consignes (bénévoles acceptés)" error={errors.instructions}>
        <Textarea name="instructions" rows={2} maxLength={4000} defaultValue={initial?.instructions ?? ""} />
      </FormField>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField label="Âge minimum" hint="Vide = aucun." error={errors.minAge}>
          <Input
            type="number"
            name="minAge"
            min={14}
            max={99}
            defaultValue={initial?.minAge ? String(initial.minAge) : ""}
          />
        </FormField>
        <FormField label="Ordre" error={errors.position}>
          <Input type="number" name="position" min={0} defaultValue={String(initial?.position ?? 0)} />
        </FormField>
      </div>
      {activeSkills.length > 0 ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 text-[12px] font-bold">Compétences</legend>
          <p className="text-[11px] text-muted">Obligatoire = contrainte dure du planning ; souhaitée = préférence.</p>
          <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
            {activeSkills.map((s) => {
              const current = initial?.skills.find((x) => x.skillId === s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{s.name}</span>
                  <span className="flex gap-3 text-[12px]">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        name="mandatorySkills"
                        value={s.id}
                        defaultChecked={current?.mandatory === true}
                        className="size-4 accent-ink"
                      />
                      Obligatoire
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        name="optionalSkills"
                        value={s.id}
                        defaultChecked={current?.mandatory === false}
                        className="size-4 accent-ink"
                      />
                      Souhaitée
                    </label>
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        <p className="text-[12px] text-muted">Ajoutez des compétences dans l'onglet dédié pour les exiger ici.</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button variant="secondary">Annuler</Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          loadingLabel="Enregistrement"
          disabled={activeTeams.length === 0}
          disabledReason="Créez d'abord une équipe."
        >
          {initial ? "Enregistrer" : "Créer le poste"}
        </Button>
      </div>
    </form>
  );
}

export function TeamsAndPositionsPanel({
  ctx,
  teams,
  positions,
  skills,
}: {
  ctx: Ctx;
  teams: TeamItem[];
  positions: PositionItem[];
  skills: SkillItem[];
}) {
  const [teamOpen, setTeamOpen] = useState<"new" | string | null>(null);
  const [positionOpen, setPositionOpen] = useState<"new" | string | null>(null);
  const editingTeam = teamOpen && teamOpen !== "new" ? (teams.find((t) => t.id === teamOpen) ?? null) : null;
  const editingPosition =
    positionOpen && positionOpen !== "new" ? (positions.find((p) => p.id === positionOpen) ?? null) : null;
  const activeTeams = teams.filter((t) => t.status === "active");
  return (
    <div className="space-y-5">
      <Panel>
        <PanelTitle>Équipes et postes types</PanelTitle>
        <p className="text-[12px] text-muted">
          Les postes types se réutilisent d'un événement à l'autre ; chaque événement active les siens et définit ses
          créneaux.
        </p>
        {activeTeams.length === 0 ? (
          <EmptyState
            title="Aucune équipe"
            description="Commencez par une équipe (Bar, Accueil, Technique…), puis ses postes."
          />
        ) : (
          <div className="mt-3 space-y-4">
            {activeTeams.map((t) => {
              const own = positions.filter((p) => p.teamId === t.id && p.status === "active");
              return (
                <section key={t.id} className="rounded-[9px] border border-border p-3">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="m-0 text-[14px] font-bold">
                      <span
                        className={`mr-2 inline-block size-3 rounded-full ${TEAM_COLOR_CLASS[t.color] ?? "bg-neutral"}`}
                        aria-hidden="true"
                      />
                      {t.name}
                      <span className="ml-2 text-[11px] font-normal text-muted">{own.length} poste(s)</span>
                    </h3>
                    <span className="flex gap-1">
                      <Button variant="ghost" className="min-h-9 text-[12px]" onClick={() => setTeamOpen(t.id)}>
                        Modifier
                      </Button>
                      <ArchiveButton
                        label="Archiver"
                        title={`Archiver l'équipe « ${t.name} » ?`}
                        description="Possible seulement sans poste actif."
                        onConfirm={() => archiveTeamAction(ctx.organizationId, ctx.slug, t.id)}
                      />
                    </span>
                  </header>
                  {own.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted">Aucun poste dans cette équipe.</p>
                  ) : (
                    <ul className="m-0 mt-2 list-none divide-y divide-border p-0 text-[13px]">
                      {own.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span>
                            <b>{p.name}</b>
                            {p.minAge ? <span className="ml-2 text-[11px] text-muted">{p.minAge} ans min.</span> : null}
                            <span className="block text-[11px] text-muted">
                              {p.skills.length === 0
                                ? "Aucune compétence requise"
                                : p.skills.map((s) => `${s.name}${s.mandatory ? " (obligatoire)" : ""}`).join(" · ")}
                            </span>
                          </span>
                          <span className="flex gap-1">
                            <Button
                              variant="ghost"
                              className="min-h-9 text-[12px]"
                              onClick={() => setPositionOpen(p.id)}
                            >
                              Modifier
                            </Button>
                            <ArchiveButton
                              label="Archiver"
                              title={`Archiver le poste « ${p.name} » ?`}
                              description="Il ne pourra plus être activé sur de nouveaux événements."
                              onConfirm={() => archivePositionAction(ctx.organizationId, ctx.slug, p.id)}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Dialog open={teamOpen !== null} onOpenChange={(o) => setTeamOpen(o ? (teamOpen ?? "new") : null)}>
            <DialogTrigger asChild>
              <Button variant="secondary" onClick={() => setTeamOpen("new")}>
                + Nouvelle équipe
              </Button>
            </DialogTrigger>
            <DialogPanel title={editingTeam ? `Modifier « ${editingTeam.name} »` : "Nouvelle équipe"}>
              <TeamForm key={teamOpen ?? "closed"} ctx={ctx} initial={editingTeam} onDone={() => setTeamOpen(null)} />
            </DialogPanel>
          </Dialog>
          <Dialog
            open={positionOpen !== null}
            onOpenChange={(o) => setPositionOpen(o ? (positionOpen ?? "new") : null)}
          >
            <DialogTrigger asChild>
              <Button
                variant="primary"
                onClick={() => setPositionOpen("new")}
                disabled={activeTeams.length === 0}
                disabledReason="Créez d'abord une équipe."
              >
                + Nouveau poste
              </Button>
            </DialogTrigger>
            <DialogPanel
              title={editingPosition ? `Modifier « ${editingPosition.name} »` : "Nouveau poste type"}
              className="max-w-[640px]"
            >
              <PositionForm
                key={positionOpen ?? "closed"}
                ctx={ctx}
                teams={teams}
                skills={skills}
                initial={editingPosition}
                onDone={() => setPositionOpen(null)}
              />
            </DialogPanel>
          </Dialog>
        </div>
      </Panel>
    </div>
  );
}
