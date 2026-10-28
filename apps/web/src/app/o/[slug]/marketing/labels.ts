/** Client-side copies of campaign labels (client components cannot import @kroov/domain/*). */
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "partially_failed" | "failed" | "cancelled";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Brouillon",
  scheduled: "Programmée",
  sending: "Envoi en cours",
  sent: "Envoyée",
  partially_failed: "Partiellement échouée",
  failed: "Échouée",
  cancelled: "Annulée",
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, "neutral" | "lime" | "lavender" | "orange" | "error"> = {
  draft: "neutral",
  scheduled: "lavender",
  sending: "orange",
  sent: "lime",
  partially_failed: "orange",
  failed: "error",
  cancelled: "neutral",
};

export const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  sent: "Envoyé",
  failed: "Échec",
  skipped: "Exclu",
  bounced: "Rebond",
  unsubscribed: "Désinscrit·e",
};

export const SKIP_REASON_LABELS: Record<string, string> = {
  not_consented: "pas de consentement",
  customer_only: "client·e sans consentement (exception non invoquée)",
  suppressed: "adresse exclue",
  invalid_email: "adresse invalide",
  duplicate: "doublon d'adresse",
};
