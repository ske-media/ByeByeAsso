import { StateMachine } from "../kernel";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "partially_failed" | "failed" | "cancelled";

/**
 * CAMPAIGN
 * draft → scheduled | cancelled
 * scheduled → draft (unschedule) | cancelled (before start) | sending (worker)
 * sending → sent | partially_failed | failed
 * sent / partially_failed / failed / cancelled: terminal — a launched campaign is never "cancelled" retroactively.
 */
export const campaignStateMachine = new StateMachine<CampaignStatus>({
  entity: "campaign",
  initial: "draft",
  transitions: {
    draft: ["scheduled", "cancelled"],
    scheduled: ["draft", "cancelled", "sending"],
    sending: ["sent", "partially_failed", "failed"],
    sent: [],
    partially_failed: [],
    failed: [],
    cancelled: [],
  },
  terminal: ["sent", "partially_failed", "failed", "cancelled"],
});

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Brouillon",
  scheduled: "Programmée",
  sending: "Envoi en cours",
  sent: "Envoyée",
  partially_failed: "Partiellement échouée",
  failed: "Échouée",
  cancelled: "Annulée",
};

export const EDITABLE_CAMPAIGN_STATUSES: CampaignStatus[] = ["draft"];
