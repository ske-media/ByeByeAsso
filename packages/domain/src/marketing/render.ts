/**
 * Pure rendering of a campaign: restricted Markdown → responsive HTML + plain text, with
 * personalisation placeholders and link rewriting (tracked links). No raw HTML is ever accepted.
 *
 * Supported syntax (one block per line, blank lines separate paragraphs):
 *   # Titre / ## Sous-titre      headings
 *   - item                       bullet list
 *   > [Texte](https://…)         call-to-action button
 *   **gras**, [texte](https://…) inline
 */

export interface RenderInput {
  subject: string;
  preheader?: string | null;
  body: string;
  organizationName: string;
  /** Postal address / legal footer line shown under the unsubscribe link. */
  footerNote?: string | null;
  unsubscribeUrl: string;
  /** Rewrites an absolute http(s) URL (tracked link); identity when tracking is off. */
  rewriteUrl?: (url: string) => string;
  vars: Record<string, string>;
}

export interface RenderOutput {
  subject: string;
  text: string;
  html: string;
}

export const PLACEHOLDERS = ["prenom", "nom", "organisation", "email"] as const;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function personalize(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => vars[key.toLowerCase()] ?? "");
}

/** Extract every absolute http(s) link target in document order (deduplicated). */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = m[1] ?? "";
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\/[^\s<>"']+$/.test(url);
}

interface Block {
  kind: "h1" | "h2" | "p" | "ul" | "button";
  text?: string;
  items?: string[];
  label?: string;
  url?: string;
}

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (list.length) {
      blocks.push({ kind: "ul", items: list });
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const button = line.match(/^>\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/);
    if (button) {
      flush();
      blocks.push({ kind: "button", label: button[1] ?? "", url: button[2] ?? "" });
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (paragraph.length) {
        blocks.push({ kind: "p", text: paragraph.join(" ") });
        paragraph = [];
      }
      list.push(line.slice(2).trim());
      continue;
    }
    if (list.length) {
      blocks.push({ kind: "ul", items: list });
      list = [];
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Inline: **bold** and [text](url). Everything is escaped first; URLs are validated. */
function inlineHtml(text: string, rewrite: (u: string) => string): string {
  let out = "";
  let i = 0;
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const m of text.matchAll(re)) {
    out += escapeHtml(text.slice(i, m.index));
    if (m[1] !== undefined) out += `<strong>${escapeHtml(m[1])}</strong>`;
    else if (m[2] !== undefined && m[3] !== undefined && isSafeUrl(m[3]))
      out += `<a href="${escapeHtml(rewrite(m[3]))}" style="color:#181914;font-weight:700">${escapeHtml(m[2])}</a>`;
    else out += escapeHtml(m[0]);
    i = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHtml(text.slice(i));
}

function inlineText(text: string, rewrite: (u: string) => string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => `${label} (${rewrite(url)})`);
}

export function renderCampaign(input: RenderInput): RenderOutput {
  const vars = { ...input.vars, organisation: input.vars.organisation ?? input.organizationName };
  const rewrite = input.rewriteUrl ?? ((u: string) => u);
  const subject = personalize(input.subject, vars).trim();
  const preheader = input.preheader ? personalize(input.preheader, vars).trim() : "";
  const blocks = parseBlocks(personalize(input.body, vars));
  const org = escapeHtml(input.organizationName);

  const htmlBlocks = blocks
    .map((b) => {
      switch (b.kind) {
        case "h1":
          return `<h1 style="font-size:26px;line-height:1.15;letter-spacing:-.6px;margin:0 0 16px">${inlineHtml(b.text ?? "", rewrite)}</h1>`;
        case "h2":
          return `<h2 style="font-size:19px;line-height:1.2;margin:24px 0 10px">${inlineHtml(b.text ?? "", rewrite)}</h2>`;
        case "p":
          return `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${inlineHtml(b.text ?? "", rewrite)}</p>`;
        case "ul":
          return `<ul style="font-size:15px;line-height:1.55;margin:0 0 14px;padding-left:20px">${(b.items ?? []).map((i) => `<li>${inlineHtml(i, rewrite)}</li>`).join("")}</ul>`;
        case "button":
          return isSafeUrl(b.url ?? "")
            ? `<p style="margin:22px 0"><a href="${escapeHtml(rewrite(b.url ?? ""))}" style="display:inline-block;background:#dfff00;color:#181914;border:1.5px solid #181914;border-radius:9px;padding:12px 18px;font-weight:700;text-decoration:none">${escapeHtml(b.label ?? "")}</a></p>`
            : "";
        default:
          return "";
      }
    })
    .join("\n");

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#faf7ee;font-family:Arial,Helvetica,sans-serif;color:#181914">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7ee"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf7;border:1px solid #e5e2d6;border-radius:14px"><tr><td style="padding:28px 24px">
<p style="font:900 22px/1 'Arial Black',Arial,sans-serif;letter-spacing:-1px;margin:0 0 20px">${org}</p>
${htmlBlocks}
</td></tr></table>
<p style="max-width:560px;font-size:12px;line-height:1.5;color:#63665b;margin:16px auto 0;text-align:center">
Vous recevez ce message parce que vous avez accepté les actualités de ${org}.
<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#63665b">Se désinscrire</a>${input.footerNote ? ` · ${escapeHtml(input.footerNote)}` : ""}
</p>
</td></tr></table></body></html>`;

  const textBlocks = blocks.map((b) => {
    switch (b.kind) {
      case "h1":
        return `${inlineText(b.text ?? "", rewrite).toUpperCase()}\n`;
      case "h2":
        return `${inlineText(b.text ?? "", rewrite)}\n`;
      case "p":
        return `${inlineText(b.text ?? "", rewrite)}\n`;
      case "ul":
        return `${(b.items ?? []).map((i) => `- ${inlineText(i, rewrite)}`).join("\n")}\n`;
      case "button":
        return `${b.label} : ${rewrite(b.url ?? "")}\n`;
      default:
        return "";
    }
  });
  const text = [
    ...(preheader ? [preheader, ""] : []),
    ...textBlocks,
    `Vous recevez ce message parce que vous avez accepté les actualités de ${input.organizationName}.`,
    `Se désinscrire : ${input.unsubscribeUrl}`,
  ].join("\n");

  return { subject, text, html };
}

/** Append campaign source parameters to a target URL (never alters an existing query key). */
export function withSourceParams(targetUrl: string, params: Record<string, string>): string {
  try {
    const url = new URL(targetUrl);
    for (const [k, v] of Object.entries(params)) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    return url.toString();
  } catch {
    return targetUrl;
  }
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) && email.length <= 320;
}
