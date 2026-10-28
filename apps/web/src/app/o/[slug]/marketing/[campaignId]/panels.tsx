"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
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
import { useState, useTransition } from "react";
import { cancelCampaignAction, unscheduleAction } from "@/actions/marketing";
import { RECIPIENT_STATUS_LABELS, SKIP_REASON_LABELS } from "../labels";

interface Ctx {
  organizationId: string;
  slug: string;
}

export function ScheduledActions({
  ctx,
  campaignId,
  scheduledLabel,
}: {
  ctx: Ctx;
  campaignId: string;
  scheduledLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<{ status: string; message?: string }>) =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await fn();
        setMessage({ tone: r.status === "error" ? "error" : "success", text: r.message ?? "" });
        router.refresh();
        resolve();
      });
    });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={<Button variant="secondary">Déprogrammer</Button>}
          title="Déprogrammer la campagne ?"
          description={`Prévue le ${scheduledLabel}. Elle redevient un brouillon modifiable ; rien n'est envoyé.`}
          confirmLabel="Déprogrammer"
          pending={pending}
          onConfirm={() => run(() => unscheduleAction(ctx.organizationId, ctx.slug, campaignId))}
        />
        <ConfirmDialog
          trigger={
            <Button variant="ghost" className="text-bordeaux">
              Annuler
            </Button>
          }
          title="Annuler la campagne ?"
          description="Possible tant que l'envoi n'a pas commencé. Une campagne lancée ne peut plus être annulée."
          confirmLabel="Annuler la campagne"
          destructive
          pending={pending}
          onConfirm={() => run(() => cancelCampaignAction(ctx.organizationId, ctx.slug, campaignId))}
        />
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}

export interface RecipientRow {
  id: string;
  contactId: string;
  email: string;
  name: string;
  status: string;
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  clicksCount: number;
}

const TONE: Record<string, "neutral" | "lime" | "lavender" | "orange" | "error"> = {
  pending: "lavender",
  sent: "lime",
  failed: "error",
  skipped: "neutral",
  bounced: "orange",
  unsubscribed: "orange",
};

export function RecipientsTable({
  slug,
  campaignId,
  status,
  rows,
  total,
}: {
  slug: string;
  campaignId: string;
  status: string;
  rows: RecipientRow[];
  total: number;
}) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={(e) =>
            router.push(
              `/o/${slug}/marketing/${campaignId}${e.target.value === "all" ? "" : `?statut=${e.target.value}`}`,
            )
          }
          aria-label="Filtrer par statut"
          className="w-auto"
        >
          <option value="all">Tous les statuts</option>
          {Object.entries(RECIPIENT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-muted">
          {total} destinataire(s){total > rows.length ? ` · ${rows.length} affiché(s)` : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Aucun destinataire"
          description="Les destinataires apparaissent au lancement de l'envoi, une fois l'éligibilité revérifiée."
        />
      ) : (
        <TableContainer label="Destinataires" className="border-0 bg-transparent">
          <Table>
            <THead>
              <TR>
                <TH>Destinataire</TH>
                <TH>Statut</TH>
                <TH>Détail</TH>
                <TH>Clics</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/o/${slug}/contacts/${r.contactId}`}
                      className="font-bold underline underline-offset-4"
                    >
                      {r.name}
                    </Link>
                    <span className="block text-[11px] text-muted">{r.email}</span>
                  </TD>
                  <TD>
                    <Badge tone={TONE[r.status] ?? "neutral"}>{RECIPIENT_STATUS_LABELS[r.status] ?? r.status}</Badge>
                  </TD>
                  <TD className="text-[12px]">
                    {r.status === "skipped" ? (SKIP_REASON_LABELS[r.skipReason ?? ""] ?? r.skipReason) : null}
                    {r.status === "sent" && r.sentAt
                      ? `envoyé le ${r.sentAt}${r.attempts > 1 ? ` (${r.attempts} tentatives)` : ""}`
                      : null}
                    {r.status === "failed" ? `${r.attempts} tentative(s) · ${r.lastError ?? ""}` : null}
                    {r.status === "bounced" ? (r.lastError ?? "rebond") : null}
                    {r.status === "pending"
                      ? `en attente${r.attempts > 0 ? ` · ${r.attempts} tentative(s)` : ""}`
                      : null}
                  </TD>
                  <TD className="text-[12px]">{r.clicksCount || "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
