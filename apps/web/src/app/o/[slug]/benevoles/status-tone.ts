import type { VolunteerApplicationStatus } from "@kroov/domain/volunteers";

export const APPLICATION_STATUS_TONE: Record<
  VolunteerApplicationStatus,
  "lime" | "orange" | "neutral" | "error" | "lavender"
> = {
  submitted: "orange",
  under_review: "orange",
  approved: "lime",
  waitlisted: "lavender",
  rejected: "neutral",
  assigned: "lime",
  confirmed: "lime",
  withdrawn: "neutral",
};

/** Client-safe copy of the domain labels (the domain module pulls the database driver). */
export const APPLICATION_STATUS_LABELS: Record<VolunteerApplicationStatus, string> = {
  submitted: "Reçue",
  under_review: "À l'étude",
  approved: "Acceptée",
  waitlisted: "Liste d'attente",
  rejected: "Non retenue",
  assigned: "Mission proposée",
  confirmed: "Mission confirmée",
  withdrawn: "Retirée",
};
