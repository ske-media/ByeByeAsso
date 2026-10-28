import { StateMachine } from "../kernel";

export type ScheduleVersionStatus =
  | "draft"
  | "generating"
  | "generation_failed"
  | "proposed"
  | "under_review"
  | "published"
  | "superseded";

/**
 * SCHEDULE VERSION
 * draft → generating | under_review | superseded
 * generating → proposed | generation_failed
 * generation_failed → generating | draft
 * proposed → under_review | generating | superseded
 * under_review → published | generating | draft | superseded
 * published → superseded (only by the publication of another version)
 * superseded: terminal.
 */
export const scheduleVersionStateMachine = new StateMachine<ScheduleVersionStatus>({
  entity: "schedule_version",
  initial: "draft",
  transitions: {
    draft: ["generating", "under_review", "superseded"],
    generating: ["proposed", "generation_failed"],
    generation_failed: ["generating", "draft"],
    proposed: ["under_review", "generating", "superseded"],
    under_review: ["published", "generating", "draft", "superseded"],
    published: ["superseded"],
    superseded: [],
  },
  terminal: ["superseded"],
});

export const SCHEDULE_VERSION_STATUS_LABELS: Record<ScheduleVersionStatus, string> = {
  draft: "Brouillon",
  generating: "Génération en cours",
  generation_failed: "Génération échouée",
  proposed: "Proposition",
  under_review: "En arbitrage",
  published: "Publiée",
  superseded: "Remplacée",
};

/** Versions whose assignments may still be edited. */
export const EDITABLE_VERSION_STATUSES: ScheduleVersionStatus[] = [
  "draft",
  "proposed",
  "under_review",
  "generation_failed",
];
