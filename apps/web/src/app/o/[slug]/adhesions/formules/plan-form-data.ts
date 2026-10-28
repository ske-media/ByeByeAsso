import "server-only";
import { instantToWallClock, wallClockDateString } from "@kroov/domain/kernel";
import type { MembershipPlanView } from "@kroov/domain/memberships";
import type { PlanFormInitial } from "./plan-form";

export function emptyPlanForm(): PlanFormInitial {
  return {
    name: "",
    slug: "",
    description: "",
    price: "20,00",
    periodKind: "fixed",
    validFrom: "",
    validUntil: "",
    durationMonths: "12",
    requiresReview: false,
    maxMembers: "",
    public: true,
    position: "0",
    benefits: "",
  };
}

export function planToForm(plan: MembershipPlanView, timezone: string): PlanFormInitial {
  return {
    name: plan.name,
    slug: plan.slug,
    description: plan.description ?? "",
    price: (plan.priceMinor / 100).toFixed(2).replace(".", ","),
    periodKind: plan.periodKind,
    validFrom: plan.validFrom ? wallClockDateString(instantToWallClock(plan.validFrom, timezone)) : "",
    validUntil: plan.validUntil ? wallClockDateString(instantToWallClock(plan.validUntil, timezone)) : "",
    durationMonths: String(plan.durationMonths ?? 12),
    requiresReview: plan.requiresReview,
    maxMembers: plan.maxMembers ? String(plan.maxMembers) : "",
    public: plan.public,
    position: String(plan.position),
    benefits: plan.benefits.join("\n"),
  };
}
