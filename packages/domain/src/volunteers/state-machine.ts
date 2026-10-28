import { StateMachine } from "../kernel";

export type VolunteerApplicationStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "waitlisted"
  | "rejected"
  | "assigned"
  | "confirmed"
  | "withdrawn";

/**
 * VOLUNTEER APPLICATION
 * submitted → under_review | approved | waitlisted | rejected | withdrawn
 * under_review → approved | waitlisted | rejected | withdrawn
 * approved → waitlisted | rejected | assigned (phase 6) | withdrawn
 * waitlisted → approved | rejected | withdrawn
 * assigned → confirmed | approved (unassigned) | withdrawn
 * confirmed → assigned (mission changed) | withdrawn
 * rejected, withdrawn: terminal.
 */
export const volunteerApplicationStateMachine = new StateMachine<VolunteerApplicationStatus>({
  entity: "volunteer_application",
  initial: "submitted",
  transitions: {
    submitted: ["under_review", "approved", "waitlisted", "rejected", "withdrawn"],
    under_review: ["approved", "waitlisted", "rejected", "withdrawn"],
    approved: ["waitlisted", "rejected", "assigned", "withdrawn"],
    waitlisted: ["approved", "rejected", "withdrawn"],
    assigned: ["confirmed", "approved", "withdrawn"],
    confirmed: ["assigned", "withdrawn"],
    rejected: [],
    withdrawn: [],
  },
  terminal: ["rejected", "withdrawn"],
});

export const VOLUNTEER_APPLICATION_STATUS_LABELS: Record<VolunteerApplicationStatus, string> = {
  submitted: "Reçue",
  under_review: "À l'étude",
  approved: "Acceptée",
  waitlisted: "Liste d'attente",
  rejected: "Non retenue",
  assigned: "Mission proposée",
  confirmed: "Mission confirmée",
  withdrawn: "Retirée",
};

/** Statuses that count as "live" (one per e-mail and event). */
export const LIVE_STATUSES: VolunteerApplicationStatus[] = [
  "submitted",
  "under_review",
  "approved",
  "waitlisted",
  "assigned",
  "confirmed",
];

/** Statuses from which the candidate may still edit preferences/availabilities. */
export const CANDIDATE_EDITABLE_STATUSES: VolunteerApplicationStatus[] = [
  "submitted",
  "under_review",
  "approved",
  "waitlisted",
];
