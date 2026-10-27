import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const outboxPath = resolve(process.env.EMAIL_FILE_PATH ?? ".tmp/outbox.jsonl");

/** Last link matching `pattern` in the most recent e-mail sent to `to` (EMAIL_PROVIDER=file). */
export function lastLinkTo(to: string, pattern: RegExp): string {
  const lines = readFileSync(outboxPath, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const record = JSON.parse(lines[i]!) as { to: string; text: string };
    if (record.to.toLowerCase() === to.toLowerCase()) {
      const match = record.text.match(pattern);
      if (match?.[0]) return match[0];
    }
  }
  throw new Error(`Aucun e-mail avec lien pour ${to}`);
}

/** Rewrite an absolute link from APP_URL onto the base URL under test. */
export function onBase(link: string, baseURL: string): string {
  const url = new URL(link);
  return `${baseURL}${url.pathname}${url.search}`;
}
