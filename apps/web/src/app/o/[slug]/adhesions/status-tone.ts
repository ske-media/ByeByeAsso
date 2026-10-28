import type { MembershipStatus } from "@kroov/domain/memberships";

export const MEMBERSHIP_STATUS_TONE: Record<MembershipStatus, "lime" | "orange" | "neutral" | "error" | "lavender"> = {
  pending: "orange",
  awaiting_payment: "orange",
  active: "lime",
  suspended: "error",
  rejected: "neutral",
  expired: "neutral",
  cancelled: "neutral",
};
