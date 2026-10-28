import { StateMachine } from "../kernel";

export type MembershipStatus =
  | "pending"
  | "awaiting_payment"
  | "active"
  | "rejected"
  | "suspended"
  | "expired"
  | "cancelled";

/**
 * MEMBERSHIP
 * pending → awaiting_payment (approved, paid plan) | active (approved, free plan) | rejected | cancelled
 * awaiting_payment → active (payment webhook) | rejected | cancelled
 * active ↔ suspended ; active | suspended → expired (job) | cancelled (with reason)
 * rejected, expired, cancelled: terminal.
 */
export const membershipStateMachine = new StateMachine<MembershipStatus>({
  entity: "membership",
  initial: "pending",
  transitions: {
    pending: ["awaiting_payment", "active", "rejected", "cancelled"],
    awaiting_payment: ["active", "rejected", "cancelled"],
    active: ["suspended", "expired", "cancelled"],
    suspended: ["active", "expired", "cancelled"],
    rejected: [],
    expired: [],
    cancelled: [],
  },
  terminal: ["rejected", "expired", "cancelled"],
});

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  pending: "À examiner",
  awaiting_payment: "Paiement attendu",
  active: "Active",
  rejected: "Refusée",
  suspended: "Suspendue",
  expired: "Expirée",
  cancelled: "Annulée",
};

/** Validity window of a membership from its plan, chained after a previous membership for rolling plans. */
export function computeValidity(
  plan: {
    periodKind: "fixed" | "rolling";
    validFrom: Date | null;
    validUntil: Date | null;
    durationMonths: number | null;
  },
  activation: Date,
  previousValidUntil: Date | null,
): { validFrom: Date; validUntil: Date } {
  if (plan.periodKind === "fixed") {
    if (!plan.validFrom || !plan.validUntil) throw new Error("Formule à période fixe sans dates.");
    return { validFrom: plan.validFrom, validUntil: plan.validUntil };
  }
  const months = plan.durationMonths ?? 12;
  const start =
    previousValidUntil && previousValidUntil.getTime() > activation.getTime() ? previousValidUntil : activation;
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);
  return { validFrom: start, validUntil: end };
}

/** Days before expiry at which the renewal reminder is sent, once. */
export const RENEWAL_REMINDER_DAYS = 30;
/** Renewal is offered from this many days before expiry, and up to a year after. */
export const RENEWAL_WINDOW_BEFORE_DAYS = 60;
export const RENEWAL_WINDOW_AFTER_DAYS = 365;
