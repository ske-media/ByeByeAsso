#!/usr/bin/env node
/**
 * Minimal secret scanner for tracked files. Exit code 1 when a finding exists.
 * Patterns target real credential shapes, not placeholders in .env.example.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  { name: "Stripe live secret key", re: /sk_live_[0-9a-zA-Z]{16,}/ },
  { name: "Stripe test secret key", re: /sk_test_[0-9a-zA-Z]{16,}/ },
  { name: "Stripe webhook secret", re: /whsec_[0-9a-zA-Z]{16,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Resend API key", re: /\bre_[0-9a-zA-Z]{20,}\b/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "Postgres URL with non-local password",
    re: /postgres(?:ql)?:\/\/[^:\s]+:(?!kroov@|password@|postgres@)[^@\s]{8,}@(?!localhost|127\.0\.0\.1|db|postgres)/,
  },
];

const allowlist = [/^pnpm-lock\.yaml$/, /^scripts\/scan-secrets\.mjs$/, /\.png$/, /\.jpg$/, /\.ico$/];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !allowlist.some((re) => re.test(f)));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of patterns) {
    const match = content.match(re);
    if (match) {
      const line = content.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} — ${name}`);
    }
  }
}

for (const f of findings) console.error(`SECRET? ${f}`);
console.log(`scan-secrets: ${files.length} file(s) scanned, ${findings.length} finding(s)`);
process.exit(findings.length > 0 ? 1 : 0);
