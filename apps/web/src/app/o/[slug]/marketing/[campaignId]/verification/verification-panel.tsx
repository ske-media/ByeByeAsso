"use client";

import { Alert, Button, ConfirmDialog, FormField, Input, Panel, PanelTitle, Textarea } from "@kroov/ui";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { scheduleAction } from "@/actions/marketing";

interface Ctx {
  organizationId: string;
  slug: string;
}

export interface Check {
  segmentCount: number;
  notConsentedCount: number;
  customerOnlyCount: number;
  suppressedCount: number;
  invalidCount: number;
  duplicateCount: number;
  eligibleCount: number;
  sample: Array<{ email: string; name: string; status: string }>;
}

export function VerificationPanel({
  ctx,
  campaign,
  missing,
  initialCheck,
  preview,
}: {
  ctx: Ctx;
  campaign: {
    id: string;
    version: number;
    name: string;
    subject: string;
    fromName: string;
    segmentName: string | null;
    timezone: string;
  };
  missing: string[];
  initialCheck: Check | null;
  preview: { subject: string; html: string };
}) {
  const [includeException, setIncludeException] = useState(false);
  const [legalNote, setLegalNote] = useState("");
  const [check, setCheck] = useState<Check | null>(initialCheck);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState("");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!initialCheck) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/v1/organizations/${ctx.organizationId}/campaigns/${campaign.id}/check`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "kroov" },
        body: JSON.stringify({ includeCustomerException: includeException }),
      });
      const body = (await res.json()) as { data?: Check };
      if (!cancelled && res.ok && body.data) setCheck(body.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [includeException, ctx.organizationId, campaign.id, initialCheck]);

  const blocked =
    missing.length > 0 ||
    !check ||
    check.eligibleCount === 0 ||
    (includeException && legalNote.trim().length < 10) ||
    (mode === "later" && !sendAt);
  const submit = () =>
    new Promise<void>((resolve) => {
      start(async () => {
        const r = await scheduleAction(ctx.organizationId, ctx.slug, campaign.id, campaign.version, {
          sendAt: mode === "later" ? new Date(sendAt).toISOString() : null,
          includeCustomerException: includeException,
          legalNote,
        });
        setMessage({
          tone: r.status === "error" ? "error" : "success",
          text: r.status === "idle" ? "" : (r.message ?? ""),
        });
        // No refresh here: the server page redirects a non-draft campaign to its report, which would hide this message.
        if (r.status === "success") setDone(true);
        resolve();
      });
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {done ? (
          <Panel className="bg-lime">
            <PanelTitle>C'est parti</PanelTitle>
            <p className="text-[13px]">
              Suivez l'avancement depuis la{" "}
              <Link href={`/o/${ctx.slug}/marketing/${campaign.id}`} className="font-bold underline underline-offset-4">
                page de la campagne
              </Link>
              .
            </p>
          </Panel>
        ) : null}
        {missing.length > 0 ? (
          <Alert tone="error">
            Complétez d'abord {missing.join(", ")} dans le{" "}
            <Link href={`/o/${ctx.slug}/marketing/${campaign.id}`} className="underline underline-offset-4">
              brouillon
            </Link>
            .
          </Alert>
        ) : null}
        <Panel>
          <PanelTitle>Audience recomptée</PanelTitle>
          {!check ? (
            <p className="text-[13px] text-muted">Choisissez un segment pour compter l'audience.</p>
          ) : (
            <>
              <p className="text-[13px] text-muted">Segment « {campaign.segmentName} »</p>
              <ul className="m-0 mt-2 list-none divide-y divide-border p-0 text-[14px]">
                <li className="flex justify-between py-1">
                  <span>Contacts dans le segment</span>
                  <b>{check.segmentCount}</b>
                </li>
                <li className="flex justify-between py-1 text-muted">
                  <span>Sans consentement explicite</span>
                  <span>−{check.notConsentedCount}</span>
                </li>
                <li className="flex justify-between py-1 text-muted">
                  <span>
                    Client·es sans consentement {includeException ? "(inclus par exception)" : "(exclus par défaut)"}
                  </span>
                  <span>{includeException ? `+${check.customerOnlyCount}` : `−${check.customerOnlyCount}`}</span>
                </li>
                <li className="flex justify-between py-1 text-muted">
                  <span>Adresses exclues (désinscription, rebond, plainte)</span>
                  <span>−{check.suppressedCount}</span>
                </li>
                <li className="flex justify-between py-1 text-muted">
                  <span>Adresses invalides</span>
                  <span>−{check.invalidCount}</span>
                </li>
                <li className="flex justify-between py-1 text-muted">
                  <span>Doublons d'adresse</span>
                  <span>−{check.duplicateCount}</span>
                </li>
                <li className="flex justify-between py-2 text-[16px]">
                  <b>Destinataires réels</b>
                  <b>{check.eligibleCount}</b>
                </li>
              </ul>
              {check.eligibleCount === 0 ? (
                <Alert tone="error">Personne n'est éligible : rien ne peut partir.</Alert>
              ) : null}
              {check.sample.length > 0 ? (
                <p className="mt-2 text-[12px] text-muted">
                  Par exemple : {check.sample.map((s) => s.email).join(", ")}
                  {check.eligibleCount > check.sample.length ? "…" : ""}
                </p>
              ) : null}
            </>
          )}
        </Panel>
        <Panel>
          <PanelTitle>Décision légale</PanelTitle>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-ink"
              checked={includeException}
              onChange={(e) => setIncludeException(e.target.checked)}
            />
            <span>
              Inclure les <b>client·es sans consentement explicite</b> au titre de l'exception « client existant » (art.
              L.34-5 CPCE) : uniquement pour des offres analogues à ce qu'ils ont acheté, avec le lien de désinscription
              dans chaque message.
            </span>
          </label>
          {includeException ? (
            <FormField
              label="Justification (tracée dans l'audit)"
              required
              hint="Quelle offre analogue ? Pourquoi ces personnes ?"
              className="mt-3"
            >
              <Textarea
                value={legalNote}
                onChange={(e) => setLegalNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Même événement que leur achat précédent : nouvelle édition, mêmes tarifs."
              />
            </FormField>
          ) : null}
        </Panel>
        <Panel>
          <PanelTitle>Quand envoyer ?</PanelTitle>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                className="accent-ink"
                checked={mode === "now"}
                onChange={() => setMode("now")}
              />{" "}
              Maintenant (dans la minute, par lots)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                className="accent-ink"
                checked={mode === "later"}
                onChange={() => setMode("later")}
              />{" "}
              Programmer
            </label>
          </div>
          {mode === "later" ? (
            <FormField label="Date et heure d'envoi" required hint={`Fuseau ${campaign.timezone}`} className="mt-3">
              <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
            </FormField>
          ) : null}
        </Panel>
        {!done ? (
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmDialog
              trigger={
                <Button
                  variant="primary"
                  disabled={blocked}
                  disabledReason="Complétez la campagne et vérifiez l'audience."
                >
                  {mode === "now" ? `Envoyer à ${check?.eligibleCount ?? 0} destinataire(s)` : "Programmer l'envoi"}
                </Button>
              }
              title={mode === "now" ? "Confirmer l'envoi ?" : "Confirmer la programmation ?"}
              description={`« ${campaign.subject} » de la part de ${campaign.fromName}, à ${check?.eligibleCount ?? 0} destinataire(s) éligible(s) aujourd'hui. L'éligibilité est revérifiée à l'envoi ; une campagne lancée ne peut plus être annulée.`}
              confirmLabel={mode === "now" ? "Envoyer" : "Programmer"}
              pending={pending}
              onConfirm={submit}
            />
            <Button asChild variant="ghost">
              <Link href={`/o/${ctx.slug}/marketing/${campaign.id}`}>Revenir au brouillon</Link>
            </Button>
          </div>
        ) : null}
      </div>
      <Panel>
        <PanelTitle>Aperçu</PanelTitle>
        <p className="mb-2 text-[13px]">
          <b>Objet :</b> {preview.subject}
        </p>
        <iframe
          title="Aperçu de l'e-mail"
          srcDoc={preview.html}
          sandbox=""
          className="h-[520px] w-full rounded-[9px] border border-border bg-white"
        />
      </Panel>
    </div>
  );
}
