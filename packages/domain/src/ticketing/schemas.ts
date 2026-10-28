import { emailSchema, optionalTextSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

const instant = z.coerce.date();
const minor = z.coerce.number().int().min(0).max(100_000_000);

export const ticketTypeSchema = z
  .object({
    name: textSchema(80),
    description: optionalTextSchema(600),
    priceMinor: minor.default(0),
    quota: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
    salesStartAt: instant.nullable().optional(),
    salesEndAt: instant.nullable().optional(),
    minPerOrder: z.coerce.number().int().min(1).max(50).default(1),
    maxPerOrder: z.coerce.number().int().min(1).max(50).default(10),
    hidden: z.boolean().default(false),
    membersOnly: z.boolean().default(false),
    position: z.coerce.number().int().min(0).max(1000).default(0),
    poolId: uuidSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.maxPerOrder < v.minPerOrder) {
      ctx.addIssue({ code: "custom", path: ["maxPerOrder"], message: "Le maximum doit être ≥ au minimum." });
    }
    if (v.salesStartAt && v.salesEndAt && v.salesEndAt.getTime() <= v.salesStartAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["salesEndAt"], message: "La fin des ventes doit suivre le début." });
    }
  });
export type TicketTypeInput = z.input<typeof ticketTypeSchema>;
export type TicketTypeValues = z.output<typeof ticketTypeSchema>;

export const updateTicketTypeSchema = z
  .object({
    name: textSchema(80).optional(),
    description: optionalTextSchema(600),
    priceMinor: minor.optional(),
    quota: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
    salesStartAt: instant.nullable().optional(),
    salesEndAt: instant.nullable().optional(),
    minPerOrder: z.coerce.number().int().min(1).max(50).optional(),
    maxPerOrder: z.coerce.number().int().min(1).max(50).optional(),
    hidden: z.boolean().optional(),
    membersOnly: z.boolean().optional(),
    position: z.coerce.number().int().min(0).max(1000).optional(),
    poolId: uuidSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.minPerOrder !== undefined && v.maxPerOrder !== undefined && v.maxPerOrder < v.minPerOrder) {
      ctx.addIssue({ code: "custom", path: ["maxPerOrder"], message: "Le maximum doit être ≥ au minimum." });
    }
  });
export type UpdateTicketTypeInput = z.input<typeof updateTicketTypeSchema>;

export const poolSchema = z.object({
  name: textSchema(80),
  capacity: z.coerce.number().int().min(0).max(1_000_000),
});
export type PoolInput = z.input<typeof poolSchema>;

export const ticketingSettingsSchema = z.object({
  maxTicketsPerOrder: z.coerce.number().int().min(1).max(50).optional(),
  salesCloseAt: instant.nullable().optional(),
  nominativeTickets: z.boolean().optional(),
  /** open | closed — `not_configured` is never set by hand. */
  ticketingStatus: z.enum(["open", "closed"]).optional(),
});
export type TicketingSettingsInput = z.input<typeof ticketingSettingsSchema>;

export const promoCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,30}$/, "3 à 30 caractères : lettres, chiffres, tirets."),
    kind: z.enum(["percent", "amount"]),
    /** percent: basis points (1000 = 10 %) ; amount: minor units. */
    value: z.coerce.number().int().min(1).max(100_000_000),
    maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    validFrom: instant.nullable().optional(),
    validUntil: instant.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && v.value > 10_000) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Au plus 100 % (10 000 points de base)." });
    }
  });
export type PromoCodeInput = z.input<typeof promoCodeSchema>;

/* ---------------------------------- public --------------------------------- */

export const createPublicOrderSchema = z.object({
  organizationSlug: z.string().trim().min(1),
  eventSlug: z.string().trim().min(1),
  items: z
    .array(z.object({ ticketTypeId: uuidSchema, quantity: z.coerce.number().int().min(1).max(50) }))
    .min(1)
    .max(10),
  /** Optional e-mail at reservation time (collected at step 2 otherwise). */
  email: emailSchema.optional(),
  /** Campaign attribution parameter (`kc`) carried from a tracked link; ignored when invalid. */
  attribution: z.string().trim().max(200).optional(),
});
export type CreatePublicOrderInput = z.input<typeof createPublicOrderSchema>;

export const buyerDetailsSchema = z.object({
  email: emailSchema,
  firstName: textSchema(80),
  lastName: textSchema(80),
  /** One name per ticket when the event has nominative tickets (order of tickets). */
  attendees: z.array(z.object({ ticketTypeId: uuidSchema, names: z.array(textSchema(120)) })).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type BuyerDetailsInput = z.input<typeof buyerDetailsSchema>;

export const applyPromoSchema = z.object({ code: z.string().trim().min(1).max(40) });

export const refundRequestSchema = z
  .object({
    /** Tickets to refund; omit or empty with `full: true` to refund the whole order. */
    ticketIds: z.array(uuidSchema).max(200).optional(),
    full: z.boolean().optional(),
    reason: textSchema(500).pipe(z.string().min(3)),
  })
  .superRefine((v, ctx) => {
    if (!v.full && (!v.ticketIds || v.ticketIds.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["ticketIds"],
        message: "Choisissez des billets ou un remboursement intégral.",
      });
    }
  });
export type RefundRequestInput = z.input<typeof refundRequestSchema>;

export const scanSchema = z.object({
  credential: z.string().trim().min(8).max(200),
  device: optionalTextSchema(120),
});

export const listOrdersSchema = z.object({
  eventId: uuidSchema.optional(),
  status: z
    .enum(["all", "paid", "awaiting_payment", "reserved", "failed", "expired", "partially_refunded", "refunded"])
    .default("all"),
  q: z.string().trim().max(120).optional(),
});
export type ListOrdersInput = z.input<typeof listOrdersSchema>;
