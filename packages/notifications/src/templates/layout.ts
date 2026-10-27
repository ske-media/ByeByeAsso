/**
 * Minimal transactional e-mail layout: plain-text first (always present), HTML second.
 * Tone: chaleureux mais concret ; un seul appel à l'action.
 */
export interface TransactionalEmailInput {
  appName: string;
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderTransactionalEmail(input: TransactionalEmailInput): { text: string; html: string } {
  const text = [
    input.title,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    ...(input.action ? [`${input.action.label} : ${input.action.url}`, ""] : []),
    input.footer ?? `— ${input.appName}`,
  ].join("\n");

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#faf7ee;font-family:Arial,Helvetica,sans-serif;color:#181914">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <p style="font:900 28px/1 'Arial Black',Arial,sans-serif;letter-spacing:-2px;margin:0 0 24px">${escapeHtml(input.appName).toUpperCase()}<span style="color:#dfff00">.</span></p>
  <h1 style="font-size:24px;line-height:1.15;letter-spacing:-.6px;margin:0 0 16px">${escapeHtml(input.title)}</h1>
  ${input.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${escapeHtml(p)}</p>`).join("")}
  ${
    input.action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#dfff00;color:#181914;border:1.5px solid #181914;border-radius:9px;padding:12px 18px;font-weight:700;text-decoration:none">${escapeHtml(input.action.label)}</a></p>
  <p style="font-size:12px;color:#63665b;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${escapeHtml(input.action.url)}</p>`
      : ""
  }
  <p style="font-size:12px;color:#63665b;margin-top:32px">${escapeHtml(input.footer ?? `— ${input.appName}`)}</p>
</div></body></html>`;

  return { text, html };
}
