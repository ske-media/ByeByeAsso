import { emailSchema, optionalTextSchema, slugSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

const instant = z.coerce.date();

export const templateInputSchema = z.object({
  name: textSchema(120),
  slug: slugSchema.optional(),
  subject: z.string().trim().max(200).default(""),
  preheader: optionalTextSchema(200),
  body: z.string().max(20_000).default(""),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

export const templateUpdateSchema = z.object({
  name: textSchema(120).optional(),
  subject: z.string().trim().max(200).optional(),
  preheader: optionalTextSchema(200),
  body: z.string().max(20_000).optional(),
});

export const campaignInputSchema = z.object({
  name: textSchema(120),
  slug: slugSchema.optional(),
  subject: z.string().trim().max(200).default(""),
  preheader: optionalTextSchema(200),
  fromName: z.string().trim().max(80).default(""),
  replyTo: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  body: z.string().max(20_000).default(""),
  segmentId: uuidSchema.nullable().optional(),
  templateId: uuidSchema.nullable().optional(),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

/** Partial update: no defaults here, so an omitted field is left untouched (a `.partial()` of a defaulted field would reset it). */
export const campaignUpdateSchema = z.object({
  name: textSchema(120).optional(),
  slug: slugSchema.optional(),
  subject: z.string().trim().max(200).optional(),
  preheader: optionalTextSchema(200),
  fromName: z.string().trim().max(80).optional(),
  replyTo: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  body: z.string().max(20_000).optional(),
  segmentId: uuidSchema.nullable().optional(),
  templateId: uuidSchema.nullable().optional(),
  version: z.coerce.number().int().min(1).optional(),
});
export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>;

export const scheduleSchema = z.object({
  /** Absent = send now (next worker tick). */
  sendAt: instant.optional(),
  includeCustomerException: z.boolean().default(false),
  legalNote: optionalTextSchema(1000),
  version: z.coerce.number().int().min(1).optional(),
});
export type ScheduleInput = z.input<typeof scheduleSchema>;

export const listCampaignsSchema = z.object({
  status: z
    .enum(["all", "draft", "scheduled", "sending", "sent", "partially_failed", "failed", "cancelled"])
    .default("all"),
});

export const listRecipientsSchema = z.object({
  status: z.enum(["all", "pending", "sent", "failed", "skipped", "bounced", "unsubscribed"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Provider delivery callback (normalised by the route from the provider's own payload). */
export const deliveryCallbackSchema = z.object({
  providerMessageId: z.string().min(1).max(200),
  event: z.enum(["delivered", "bounced", "complained", "failed"]),
  /** Hard bounces suppress the address; soft ones only mark the delivery. */
  hard: z.boolean().default(true),
  reason: optionalTextSchema(500),
  occurredAt: instant.optional(),
});
export type DeliveryCallback = z.input<typeof deliveryCallbackSchema>;
