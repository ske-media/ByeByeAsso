"use client";

import { Alert, Button, ConfirmDialog, FormField, Input, Panel, PanelTitle, Select, Textarea } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { cancelCampaignAction, createCampaignAction, sendTestAction, updateCampaignAction } from "@/actions/marketing";
import { idleState } from "@/lib/action-state";

interface Ctx {
  organizationId: string;
  slug: string;
}

export interface CampaignDraft {
  id: string;
  version: number;
  name: string;
  subject: string;
  preheader: string;
  fromName: string;
  replyTo: string;
  body: string;
  segmentId: string;
  templateId: string;
}

export interface EditorOptions {
  segments: Array<{ id: string; name: string; memberCount: number | null }>;
  templates: Array<{ id: string; name: string; subject: string; preheader: string | null; body: string }>;
}

const HELP = [
  "# Titre · ## Sous-titre",
  "**gras** · [texte](https://…) · - liste",
  "> [Bouton](https://…) pour un appel à l'action",
  "{{prenom}} {{nom}} {{organisation}} {{email}}",
].join("\n");

/** Écran 20 — éditeur de campagne : contenu, audience, aperçu, test. */
export function CampaignEditor({
  ctx,
  options,
  initial,
  preview,
  canSend,
}: {
  ctx: Ctx;
  options: EditorOptions;
  initial: CampaignDraft | null;
  preview: { subject: string; html: string; text: string } | null;
  canSend: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    initial
      ? updateCampaignAction.bind(null, ctx.organizationId, ctx.slug, initial.id, initial.version)
      : createCampaignAction.bind(null, ctx.organizationId, ctx.slug),
    idleState,
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const [body, setBody] = useState(values.body ?? initial?.body ?? "");
  const [subject, setSubject] = useState(values.subject ?? initial?.subject ?? "");
  const [preheader, setPreheader] = useState(values.preheader ?? initial?.preheader ?? "");
  const [templateId, setTemplateId] = useState(values.templateId ?? initial?.templateId ?? "");
  const [tab, setTab] = useState<"html" | "text">("html");
  const [testPending, startTest] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = options.templates.find((x) => x.id === id);
    if (!t) return;
    if (!subject.trim()) setSubject(t.subject);
    if (!preheader.trim() && t.preheader) setPreheader(t.preheader);
    if (!body.trim()) setBody(t.body);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <form action={action} noValidate className="space-y-5">
        {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
        {state.status === "success" && state.message ? <Alert tone="success">{state.message}</Alert> : null}
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <Panel>
          <PanelTitle>Campagne</PanelTitle>
          <div className="space-y-2">
            <FormField
              label="Nom interne"
              required
              error={errors.name}
              hint="Sert d'identifiant de campagne (utm_campaign) ; non visible des destinataires."
            >
              <Input
                name="name"
                required
                maxLength={120}
                defaultValue={values.name ?? initial?.name ?? ""}
                placeholder="Annonce des Nuits en Commun"
              />
            </FormField>
            <FormField
              label="Audience (segment)"
              required
              error={errors.segmentId}
              hint="Recomptée à la vérification et revérifiée à l'envoi."
            >
              <Select name="segmentId" defaultValue={values.segmentId ?? initial?.segmentId ?? ""}>
                <option value="">— Choisir un segment —</option>
                {options.segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.memberCount !== null ? ` (${s.memberCount} au dernier calcul)` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            {options.segments.length === 0 ? (
              <p className="text-[12px] text-muted">
                Aucun segment :{" "}
                <Link href={`/o/${ctx.slug}/contacts/segments/nouveau`} className="underline underline-offset-4">
                  créez-en un depuis les contacts
                </Link>
                .
              </p>
            ) : null}
            <FormField label="Gabarit (facultatif)" hint="Pré-remplit l'objet et le corps s'ils sont vides.">
              <Select name="templateId" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Aucun —</option>
                {options.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Panel>
        <Panel>
          <PanelTitle>Message</PanelTitle>
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField label="Nom d'expéditeur" required error={errors.fromName}>
                <Input
                  name="fromName"
                  required
                  maxLength={80}
                  defaultValue={values.fromName ?? initial?.fromName ?? ""}
                  placeholder="Le Collectif des Nuits"
                />
              </FormField>
              <FormField label="Adresse de réponse" error={errors.replyTo}>
                <Input
                  name="replyTo"
                  type="email"
                  maxLength={320}
                  defaultValue={values.replyTo ?? initial?.replyTo ?? ""}
                  placeholder="contact@…"
                />
              </FormField>
            </div>
            <FormField label="Objet" required error={errors.subject}>
              <Input
                name="subject"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="{{prenom}}, Les Nuits reviennent"
              />
            </FormField>
            <FormField label="Pré-en-tête" error={errors.preheader} hint="Texte d'aperçu dans la boîte de réception.">
              <Input
                name="preheader"
                maxLength={200}
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
              />
            </FormField>
            <FormField label="Corps" required error={errors.body} hint={HELP}>
              <Textarea
                name="body"
                rows={14}
                maxLength={20000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-mono text-[13px]"
              />
            </FormField>
            <p className="text-[12px] text-muted">
              Les liens sont suivis (clics par destinataire, sans adresse IP) et reçoivent les paramètres de source. Le
              lien de désinscription est ajouté automatiquement. Aucun HTML brut n'est accepté.
            </p>
          </div>
        </Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={pending} loadingLabel="Enregistrement">
            {initial ? "Enregistrer le brouillon" : "Créer le brouillon"}
          </Button>
          {initial ? (
            <>
              <Button
                variant="secondary"
                loading={testPending}
                loadingLabel="Envoi du test"
                onClick={() =>
                  startTest(async () => {
                    const r = await sendTestAction(ctx.organizationId, ctx.slug, initial.id);
                    setMessage({
                      tone: r.status === "error" ? "error" : "success",
                      text: r.status === "idle" ? "" : (r.message ?? ""),
                    });
                  })
                }
              >
                M'envoyer un test
              </Button>
              {canSend ? (
                <Button asChild variant="secondary">
                  <Link href={`/o/${ctx.slug}/marketing/${initial.id}/verification`}>Vérifier et envoyer →</Link>
                </Button>
              ) : null}
              {canSend ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" className="text-bordeaux">
                      Annuler la campagne
                    </Button>
                  }
                  title="Annuler ce brouillon ?"
                  description="La campagne passe en « annulée » et ne pourra plus être envoyée."
                  confirmLabel="Annuler la campagne"
                  destructive
                  onConfirm={async () => {
                    const r = await cancelCampaignAction(ctx.organizationId, ctx.slug, initial.id);
                    setMessage({
                      tone: r.status === "error" ? "error" : "success",
                      text: r.status === "idle" ? "" : (r.message ?? ""),
                    });
                    router.refresh();
                  }}
                />
              ) : null}
            </>
          ) : null}
          <Button asChild variant="ghost">
            <Link href={`/o/${ctx.slug}/marketing`}>Retour</Link>
          </Button>
        </div>
        <p className="text-[12px] text-muted">
          Enregistrez avant de tester ou de vérifier : l'aperçu et le test reflètent le dernier brouillon enregistré.
        </p>
      </form>
      <div className="space-y-5">
        <Panel>
          <PanelTitle>Aperçu</PanelTitle>
          {preview ? (
            <>
              <p className="text-[13px]">
                <b>Objet :</b> {preview.subject || "—"}
              </p>
              <div className="my-2 flex gap-3 border-b border-border text-[13px] font-bold">
                {(["html", "text"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    aria-pressed={tab === t}
                    className={`-mb-px border-b-2 px-1 py-1 ${tab === t ? "border-ink" : "border-transparent text-muted"}`}
                  >
                    {t === "html" ? "HTML" : "Texte"}
                  </button>
                ))}
              </div>
              {tab === "html" ? (
                <iframe
                  title="Aperçu de l'e-mail"
                  srcDoc={preview.html}
                  sandbox=""
                  className="h-[560px] w-full rounded-[9px] border border-border bg-white"
                />
              ) : (
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-[9px] border border-border bg-neutral p-3 text-[12px]">
                  {preview.text}
                </pre>
              )}
              <p className="mt-2 text-[11px] text-muted">
                Rendu avec des valeurs d'exemple (Prénom Nom) et un lien de désinscription de test.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted">L'aperçu apparaît après le premier enregistrement.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
