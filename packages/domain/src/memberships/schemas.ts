import { emailSchema, optionalTextSchema, slugSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

const instant = z.coerce.date();

export const membershipPlanSchema = z
  .object({
    name: textSchema(120).pipe(z.string().min(2)),
    slug: slugSchema.optional(),
    description: optionalTextSchema(2000),
    priceMinor: z.coerce.number().int().min(0).max(100_000_000).default(0),
    periodKind: z.enum(["fixed", "rolling"]).default("fixed"),
    validFrom: instant.nullable().optional(),
    validUntil: instant.nullable().optional(),
    durationMonths: z.coerce.number().int().min(1).max(60).nullable().optional(),
    requiresReview: z.boolean().default(false),
    maxMembers: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    public: z.boolean().default(true),
    position: z.coerce.number().int().min(0).max(1000).default(0),
    benefits: z.array(textSchema(160)).max(12).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.periodKind === "fixed") {
      if (!v.validFrom)
        ctx.addIssue({ code: "custom", path: ["validFrom"], message: "Indiquez le début de validité." });
      if (!v.validUntil)
        ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Indiquez la fin de validité." });
      if (v.validFrom && v.validUntil && v.validUntil.getTime() <= v.validFrom.getTime()) {
        ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La fin doit suivre le début." });
      }
    } else if (!v.durationMonths) {
      ctx.addIssue({ code: "custom", path: ["durationMonths"], message: "Indiquez la durée en mois." });
    }
  });
export type MembershipPlanInput = z.input<typeof membershipPlanSchema>;

export const updateMembershipPlanSchema = membershipPlanSchema;

export const membershipApplicationSchema = z.object({
  planId: uuidSchema,
  email: emailSchema,
  firstName: textSchema(80),
  lastName: textSchema(80),
  marketingOptIn: z.boolean().optional(),
});
export type MembershipApplicationInput = z.input<typeof membershipApplicationSchema>;

export const reasonSchema = z.object({ reason: textSchema(500).pipe(z.string().min(3)) });

export const extendValiditySchema = z.object({
  validUntil: instant,
  reason: textSchema(500).pipe(z.string().min(3)),
});
export type ExtendValidityInput = z.input<typeof extendValiditySchema>;

export const renewSchema = z.object({ planId: uuidSchema });

export const listMembershipsSchema = z.object({
  status: z
    .enum(["all", "pending", "awaiting_payment", "active", "suspended", "expired", "rejected", "cancelled", "to_renew"])
    .default("all"),
  planId: uuidSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListMembershipsInput = z.input<typeof listMembershipsSchema>;
