/**
 * Client-side copies of the CRM labels (client components cannot import @kroov/domain/*:
 * the module pulls the PostgreSQL driver). Keep in sync with packages/domain/src/crm/identities.ts.
 */
export type MarketingStatus = "none" | "opted_in" | "customer_only" | "withdrawn" | "suppressed";

export const MARKETING_LABELS: Record<MarketingStatus, string> = {
  none: "Aucun consentement",
  opted_in: "Consentement explicite",
  customer_only: "Client·e sans consentement",
  withdrawn: "Consentement retiré",
  suppressed: "Exclu·e",
};

export const MARKETING_TONE: Record<MarketingStatus, "neutral" | "lime" | "lavender" | "orange" | "error"> = {
  none: "neutral",
  opted_in: "lime",
  customer_only: "lavender",
  withdrawn: "orange",
  suppressed: "error",
};

export const SOURCE_LABELS: Record<string, string> = {
  order: "Commande",
  membership: "Adhésion",
  volunteer_application: "Candidature bénévole",
  schedule: "Planning",
  staff: "Saisie manuelle",
  public_form: "Formulaire public",
  import: "Import",
  system: "Système",
};

export const BASIS_LABELS: Record<string, string> = {
  explicit_opt_in: "case cochée (opt-in explicite)",
  customer_exception: "exception client (achat / adhésion, sans case cochée)",
  manual: "saisie par l'équipe",
  import: "import",
};

export const SUPPRESSION_LABELS: Record<string, string> = {
  unsubscribed: "Désinscription",
  bounced: "Adresse en erreur (rebond)",
  complaint: "Plainte",
  manual: "Exclusion manuelle",
  erased: "Effacement demandé",
};

export const TAG_COLOR_CLASS: Record<string, string> = {
  lime: "bg-lime",
  lavender: "bg-lavender",
  orange: "bg-orange",
  pink: "bg-pink",
  neutral: "bg-neutral",
};

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  merged: "Fusionné",
  archived: "Archivé",
};
