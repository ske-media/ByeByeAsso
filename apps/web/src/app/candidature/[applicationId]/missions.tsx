"use client";

import { Alert, Badge, Button, ConfirmDialog, FormField, Panel, Textarea } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MissionItem {
  assignmentId: string;
  versionLabel: string;
  positionName: string;
  teamName: string;
  label: string | null;
  briefing: string | null;
  instructions: string | null;
  rangeLabel: string;
  confirmationStatus: "pending" | "confirmed" | "declined";
  openRequest: boolean;
}

/** Écran 40 — missions publiées : confirmer, signaler une indisponibilité (crée un arbitrage, ne retire rien). */
export function Missions({
  applicationId,
  accessToken,
  missions,
}: {
  applicationId: string;
  accessToken: string;
  missions: MissionItem[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const call = async (assignmentId: string, action: "confirm" | "report-unavailable", body: unknown) => {
    setPending(assignmentId);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/v1/public/volunteer-applications/${applicationId}/missions/${assignmentId}/${action}?k=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "kroov" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setMessage({ tone: "error", text: json.error?.message ?? "Action impossible." });
        return;
      }
      setMessage({
        tone: "success",
        text:
          action === "confirm"
            ? "Mission confirmée. Merci !"
            : "Indisponibilité transmise : l'équipe arbitre et vous tient au courant.",
      });
      setReason("");
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Connexion impossible. Réessayez." });
    } finally {
      setPending(null);
    }
  };
  if (missions.length === 0) return null;
  return (
    <Panel className="mt-4 bg-lime">
      <h2 className="text-panel-title font-bold">Mes missions · planning {missions[0]?.versionLabel}</h2>
      <p className="text-[12px]">
        Cette version fait foi. Confirmez chaque mission ; en cas d'empêchement, signalez-le : rien n'est retiré sans
        arbitrage.
      </p>
      {message ? (
        <Alert tone={message.tone} className="mt-2">
          {message.text}
        </Alert>
      ) : null}
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {missions.map((m) => (
          <li key={m.assignmentId} className="rounded-[9px] bg-white p-3 text-[13px]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span>
                <b>{m.positionName}</b>
                {m.label ? ` · ${m.label}` : ""}
                <span className="block text-[12px] text-muted">
                  {m.teamName} · {m.rangeLabel}
                </span>
              </span>
              <Badge
                tone={
                  m.confirmationStatus === "confirmed"
                    ? "lime"
                    : m.confirmationStatus === "declined"
                      ? "orange"
                      : "neutral"
                }
                noDot
              >
                {m.confirmationStatus === "confirmed"
                  ? "Confirmée"
                  : m.confirmationStatus === "declined"
                    ? "Indisponibilité signalée"
                    : "À confirmer"}
              </Badge>
            </div>
            {m.briefing || m.instructions ? (
              <p className="mt-2 whitespace-pre-line text-[12px]">{m.briefing ?? m.instructions}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {m.confirmationStatus !== "confirmed" && !m.openRequest ? (
                <Button
                  variant="primary"
                  className="min-h-9"
                  loading={pending === m.assignmentId}
                  loadingLabel="…"
                  onClick={() => void call(m.assignmentId, "confirm", {})}
                >
                  Je confirme
                </Button>
              ) : null}
              {!m.openRequest ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="secondary" className="min-h-9">
                      Je ne suis plus disponible
                    </Button>
                  }
                  title="Signaler une indisponibilité ?"
                  description="L'équipe est prévenue et cherche un remplacement. La mission reste affichée jusqu'à sa décision ; vous recevrez un e-mail."
                  confirmLabel="Envoyer le signalement"
                  pending={pending === m.assignmentId}
                  onConfirm={() => call(m.assignmentId, "report-unavailable", { message: reason || undefined })}
                >
                  <FormField label="Un mot pour l'équipe (facultatif)">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} />
                  </FormField>
                </ConfirmDialog>
              ) : (
                <span className="text-[12px] text-muted">Signalement en attente d'arbitrage.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
