import { emailSchema, optionalTextSchema, slugSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { MARKETING_EMAIL_STATUSES } from "./identities";

const instant = z.coerce.date();

export const CRM_SOURCES = [
  "order",
  "membership",
  "volunteer_application",
  "schedule",
  "staff",
  "public_form",
  "import",
  "system",
] as const;

export const TAG_COLORS = ["lime", "lavender", "orange", "pink", "neutral"] as const;

/* Contacts ---------------------------------------------------------------- */

export const contactInputSchema = z.object({
  email: emailSchema,
  firstName: optionalTextSchema(80),
  lastName: optionalTextSchema(80),
  phone: optionalTextSchema(40),
  city: optionalTextSchema(120),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export const contactUpdateSchema = contactInputSchema.partial().extend({
  version: z.coerce.number().int().min(1).optional(),
});
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

export const listContactsSchema = z.object({
  q: optionalTextSchema(120),
  status: z.enum(["active", "archived", "merged", "all"]).default("active"),
  marketing: z.enum(MARKETING_EMAIL_STATUSES).optional(),
  tagId: uuidSchema.optional(),
  source: z.enum(CRM_SOURCES).optional(),
  eventId: uuidSchema.optional(),
  segmentId: uuidSchema.optional(),
  sort: z.enum(["activity", "name", "created"]).default("activity"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListContactsInput = z.input<typeof listContactsSchema>;

export const noteSchema = z.object({
  body: textSchema(4000),
  pinned: z.boolean().default(false),
});
export type NoteInput = z.input<typeof noteSchema>;

export const tagSchema = z.object({
  name: textSchema(60),
  slug: slugSchema.optional(),
  color: z.enum(TAG_COLORS).default("lime"),
});
export type TagInput = z.input<typeof tagSchema>;

export const setTagsSchema = z.object({ tagIds: z.array(uuidSchema).max(50) });

export const manualConsentSchema = z.object({
  status: z.enum(["granted", "withdrawn"]),
  evidence: textSchema(1000).pipe(z.string().min(5)),
  occurredAt: instant.optional(),
});
export type ManualConsentInput = z.input<typeof manualConsentSchema>;

export const suppressionSchema = z.object({
  email: emailSchema,
  reason: z.enum(["unsubscribed", "bounced", "complaint", "manual", "erased"]).default("manual"),
  note: optionalTextSchema(500),
});
export type SuppressionInput = z.input<typeof suppressionSchema>;

export const liftSuppressionSchema = z.object({ reason: textSchema(500).pipe(z.string().min(3)) });

export const mergeSchema = z.object({
  mergedContactId: uuidSchema,
  reason: optionalTextSchema(500),
});
export type MergeInput = z.input<typeof mergeSchema>;

/* Segments ---------------------------------------------------------------- */

const idList = z.array(uuidSchema).min(1).max(100);

export const segmentRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tag"), op: z.enum(["in", "not_in"]).default("in"), tagIds: idList }),
  z.object({ type: z.literal("marketing_email"), statuses: z.array(z.enum(MARKETING_EMAIL_STATUSES)).min(1) }),
  z.object({
    type: z.literal("event"),
    relation: z.enum(["ordered", "attended", "volunteered", "assigned"]).default("ordered"),
    eventIds: idList,
  }),
  z.object({
    type: z.literal("membership"),
    state: z.enum(["active", "expired", "never", "any"]).default("active"),
    planIds: z.array(uuidSchema).max(100).optional(),
  }),
  z.object({
    type: z.literal("orders"),
    minCount: z.coerce.number().int().min(0).max(10_000).optional(),
    minTotalMinor: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  }),
  z.object({ type: z.literal("activity"), after: instant.optional(), before: instant.optional() }),
  z.object({ type: z.literal("source"), sources: z.array(z.enum(CRM_SOURCES)).min(1) }),
  z.object({ type: z.literal("search"), q: textSchema(120) }),
]);
export type SegmentRule = z.output<typeof segmentRuleSchema>;

export const segmentDefinitionSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(segmentRuleSchema).max(20).default([]),
});
export type SegmentDefinition = z.output<typeof segmentDefinitionSchema>;
export type SegmentDefinitionInput = z.input<typeof segmentDefinitionSchema>;

export const segmentInputSchema = z.object({
  name: textSchema(120),
  slug: slugSchema.optional(),
  description: optionalTextSchema(500),
  kind: z.enum(["dynamic", "static"]).default("dynamic"),
  definition: segmentDefinitionSchema.default({ match: "all", rules: [] }),
});
export type SegmentInput = z.input<typeof segmentInputSchema>;

export const segmentUpdateSchema = segmentInputSchema.partial().extend({
  version: z.coerce.number().int().min(1).optional(),
});
export type SegmentUpdateInput = z.input<typeof segmentUpdateSchema>;

export const segmentMembersSchema = z.object({
  add: z.array(uuidSchema).max(500).default([]),
  remove: z.array(uuidSchema).max(500).default([]),
});
