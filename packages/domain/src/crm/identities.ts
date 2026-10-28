/**
 * Pure helpers of the CRM module: identity normalisation and consent derivation.
 * No I/O here — covered by unit tests.
 */

export const MARKETING_EMAIL_STATUSES = ["none", "opted_in", "customer_only", "withdrawn", "suppressed"] as const;
export type MarketingEmailStatus = (typeof MARKETING_EMAIL_STATUSES)[number];

export const MARKETING_EMAIL_STATUS_LABELS: Record<MarketingEmailStatus, string> = {
  none: "Aucun consentement",
  opted_in: "Consentement explicite",
  customer_only: "Client·e sans consentement",
  withdrawn: "Consentement retiré",
  suppressed: "Exclu·e",
};

export const CONSENT_BASIS_LABELS = {
  explicit_opt_in: "case cochée (opt-in explicite)",
  customer_exception: "exception client (achat / adhésion, sans case cochée)",
  manual: "saisie par l'équipe",
  import: "import",
} as const;
export type ConsentBasis = keyof typeof CONSENT_BASIS_LABELS;

export const CRM_SOURCE_LABELS = {
  order: "Commande",
  membership: "Adhésion",
  volunteer_application: "Candidature bénévole",
  schedule: "Planning",
  staff: "Saisie manuelle",
  public_form: "Formulaire public",
  import: "Import",
  system: "Système",
} as const;
export type CrmSource = keyof typeof CRM_SOURCE_LABELS;

export const SUPPRESSION_REASON_LABELS = {
  unsubscribed: "Désinscription",
  bounced: "Adresse en erreur (rebond)",
  complaint: "Plainte",
  manual: "Exclusion manuelle",
  erased: "Effacement demandé",
} as const;
export type SuppressionReason = keyof typeof SUPPRESSION_REASON_LABELS;

/** Lower-case, trimmed; inner whitespace is never valid in an address. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

export function isValidEmail(input: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input);
}

/**
 * Phone normalisation to E.164 for duplicate detection only (never for matching contacts
 * automatically). Defaults to France (+33) for national numbers; Swiss numbers written
 * with 0041 / +41 keep their prefix. Returns null when the input is not a plausible number.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: "FR" | "CH" = "FR"): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `${defaultCountry === "CH" ? "+41" : "+33"}${digits.slice(1)}`;
  }
  return null;
}

export function normalizeName(input: string | null | undefined): string | null {
  const v = input?.trim().replace(/\s+/g, " ");
  return v ? v : null;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export interface ConsentLike {
  status: "granted" | "withdrawn";
  basis: ConsentBasis;
  occurredAt: Date;
}

/**
 * Derive the e-mail marketing status from the append-only journal.
 * Rules (French e-marketing: prior consent, or the "existing customer" exception with a
 * standing right to object):
 * - an active suppression wins over everything;
 * - the latest EXPLICIT record (opt-in, manual, import) decides: granted → opted_in,
 *   withdrawn → withdrawn — a later customer-exception record never re-grants after a
 *   withdrawal, because the person has exercised their right to object;
 * - with no explicit record, a customer-exception record yields customer_only (recorded as
 *   a legal basis, excluded from consented audiences by default);
 * - otherwise none.
 */
export function deriveMarketingStatus(records: readonly ConsentLike[], suppressed: boolean): MarketingEmailStatus {
  if (suppressed) return "suppressed";
  const sorted = [...records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let explicit: ConsentLike | null = null;
  let customer: ConsentLike | null = null;
  for (const r of sorted) {
    if (r.basis === "customer_exception") customer = r;
    else explicit = r;
  }
  if (explicit) return explicit.status === "granted" ? "opted_in" : "withdrawn";
  if (customer?.status === "granted") return "customer_only";
  return "none";
}

/** Marketing statuses that may receive promotional e-mail without a per-campaign legal decision. */
export const CONSENTED_STATUSES: readonly MarketingEmailStatus[] = ["opted_in"];

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Neutralise formula injection in spreadsheet software.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
