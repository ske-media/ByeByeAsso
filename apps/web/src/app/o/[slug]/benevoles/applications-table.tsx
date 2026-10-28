"use client";

import type { VolunteerApplicationStatus } from "@kroov/domain/volunteers";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FormField,
  Table,
  TableContainer,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkDecideAction, type DecisionAction } from "@/actions/volunteers";
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUS_TONE } from "./status-tone";

export interface ApplicationRow {
  id: string;
  number: string;
  status: VolunteerApplicationStatus;
  name: string;
  email: string;
  eventTitle: string;
  firstChoice: string | null;
  skillsCount: number;
  verifiedSkillsCount: number;
  effectiveHours: number;
  receivedLabel: string;
}

/** Écran 11 — liste avec sélection et traitement en lot (validation par enregistrement). */
export function ApplicationsTable({
  organizationId,
  slug,
  rows,
  showEvent,
  emptyDescription,
}: {
  organizationId: string;
  slug: string;
  rows: ApplicationRow[];
  showEvent: boolean;
  emptyDescription: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
    results?: Array<{ id: string; ok: boolean; error?: string }>;
  } | null>(null);
  const all = rows.map((r) => r.id);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const run = (action: DecisionAction) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await bulkDecideAction(organizationId, slug, selected, action, reason || undefined);
        setFeedback({
          tone: r.status === "error" ? "error" : "success",
          text: r.status === "idle" ? "" : (r.message ?? ""),
          ...(r.results ? { results: r.results } : {}),
        });
        setSelected([]);
        setReason("");
        router.refresh();
        resolve();
      });
    });
  const byId = (id: string) => rows.find((r) => r.id === id);
  return (
    <div className="space-y-3">
      {feedback ? (
        <Alert tone={feedback.tone}>
          {feedback.text}
          {feedback.results?.some((r) => !r.ok) ? (
            <ul className="m-0 mt-1 list-disc pl-5 text-[12px]">
              {feedback.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.id}>
                    {byId(r.id)?.name ?? r.id} : {r.error}
                  </li>
                ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[9px] bg-lavender px-3 py-2 text-[13px]">
          <b>{selected.length} sélectionnée(s)</b>
          <ConfirmDialog
            trigger={
              <Button variant="primary" className="min-h-9">
                Accepter
              </Button>
            }
            title={`Accepter ${selected.length} candidature(s) ?`}
            description="Chaque personne reçoit un e-mail. Accepter ne publie pas de mission : le planning reste à faire."
            confirmLabel="Accepter"
            pending={pending}
            onConfirm={() => run("approve")}
          />
          <ConfirmDialog
            trigger={
              <Button variant="secondary" className="min-h-9">
                Liste d'attente
              </Button>
            }
            title={`Placer ${selected.length} candidature(s) en liste d'attente ?`}
            description="Les personnes sont informées et peuvent élargir leurs vœux."
            confirmLabel="Placer en attente"
            pending={pending}
            onConfirm={() => run("waitlist")}
          />
          <ConfirmDialog
            trigger={
              <Button variant="secondary" className="min-h-9">
                À l'étude
              </Button>
            }
            title={`Marquer ${selected.length} candidature(s) à l'étude ?`}
            description="Aucun e-mail n'est envoyé."
            confirmLabel="Marquer"
            pending={pending}
            onConfirm={() => run("review")}
          />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="min-h-9 text-bordeaux">
                Non retenues
              </Button>
            }
            title={`Refuser ${selected.length} candidature(s) ?`}
            description="Décision définitive. Le motif est transmis à chaque personne."
            confirmLabel="Refuser"
            destructive
            pending={pending}
            onConfirm={() => run("reject")}
          >
            <FormField label="Motif communiqué" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
            </FormField>
          </ConfirmDialog>
          <button type="button" className="ml-auto text-[12px] underline" onClick={() => setSelected([])}>
            Tout désélectionner
          </button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Aucune candidature" description={emptyDescription} />
      ) : (
        <TableContainer label="Candidatures" className="border-0 bg-transparent">
          <Table>
            <THead>
              <TR>
                <TH>
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    className="size-4 accent-ink"
                    checked={selected.length === all.length && all.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? all : [])}
                  />
                </TH>
                <TH>Candidat·e</TH>
                {showEvent ? <TH>Événement</TH> : null}
                <TH>1er vœu</TH>
                <TH>Compétences</TH>
                <TH>Dispo.</TH>
                <TH>Statut</TH>
                <TH>
                  <span className="k-sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${r.name}`}
                      className="size-4 accent-ink"
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </TD>
                  <TD>
                    <b>{r.name}</b>
                    <span className="block text-[11px] text-muted">
                      {r.email} · {r.number} · {r.receivedLabel}
                    </span>
                  </TD>
                  {showEvent ? <TD>{r.eventTitle}</TD> : null}
                  <TD>{r.firstChoice ?? "—"}</TD>
                  <TD>
                    {r.skillsCount}
                    {r.verifiedSkillsCount > 0 ? (
                      <span className="text-[11px] text-muted"> ({r.verifiedSkillsCount} vérifiée(s))</span>
                    ) : null}
                  </TD>
                  <TD>{r.effectiveHours} h</TD>
                  <TD>
                    <Badge tone={APPLICATION_STATUS_TONE[r.status]}>{APPLICATION_STATUS_LABELS[r.status]}</Badge>
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/o/${slug}/benevoles/candidatures/${r.id}`}
                      className="font-bold underline underline-offset-4"
                    >
                      Examiner →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
