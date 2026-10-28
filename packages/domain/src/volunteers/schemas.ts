import { emailSchema, optionalTextSchema, slugSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

const instant = z.coerce.date();

/* Catalogue --------------------------------------------------------------- */

export const skillSchema = z.object({
  name: textSchema(80).pipe(z.string().min(2)),
  slug: slugSchema.optional(),
  description: optionalTextSchema(500),
  requiresVerification: z.boolean().default(false),
});
export type SkillInput = z.input<typeof skillSchema>;

export const teamSchema = z.object({
  name: textSchema(80).pipe(z.string().min(2)),
  slug: slugSchema.optional(),
  description: optionalTextSchema(500),
  color: z.enum(["lime", "lavender", "orange", "neutral"]).default("lavender"),
  position: z.coerce.number().int().min(0).max(1000).default(0),
});
export type TeamInput = z.input<typeof teamSchema>;

export const positionSchema = z.object({
  teamId: uuidSchema,
  name: textSchema(80).pipe(z.string().min(2)),
  slug: slugSchema.optional(),
  description: optionalTextSchema(1000),
  instructions: optionalTextSchema(4000),
  minAge: z.coerce.number().int().min(14).max(99).nullable().optional(),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  /** Required skills: mandatory = hard constraint for the scheduler. */
  skills: z
    .array(z.object({ skillId: uuidSchema, mandatory: z.boolean().default(true) }))
    .max(20)
    .default([]),
});
export type PositionInput = z.input<typeof positionSchema>;

/* Event staffing ---------------------------------------------------------- */

export const volunteeringSettingsSchema = z.object({
  recruitmentStatus: z.enum(["closed", "open"]).optional(),
  targetCount: z.coerce.number().int().min(0).max(10_000).optional(),
  maxHoursPerDay: z.coerce.number().int().min(0).max(24).optional(),
  minRestMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  /** Custom questions (replaces the whole list). */
  questions: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{0,60}$/)
          .optional(),
        label: textSchema(200),
        helpText: optionalTextSchema(500),
        type: z.enum(["short_text", "long_text", "single_choice", "checkbox"]).default("short_text"),
        required: z.boolean().default(false),
        options: z.array(textSchema(80)).max(12).default([]),
      }),
    )
    .max(12)
    .optional(),
});
export type VolunteeringSettingsInput = z.input<typeof volunteeringSettingsSchema>;

export const eventPositionSchema = z.object({
  positionId: uuidSchema,
  briefing: optionalTextSchema(4000),
});
export type EventPositionInput = z.input<typeof eventPositionSchema>;

export const shiftSchema = z
  .object({
    label: optionalTextSchema(80),
    startsAt: instant,
    endsAt: instant,
    requiredCount: z.coerce.number().int().min(0).max(500).default(1),
    maxCount: z.coerce.number().int().min(0).max(500).optional(),
    notes: optionalTextSchema(1000),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt.getTime() <= v.startsAt.getTime())
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La fin doit suivre le début." });
    if (v.endsAt.getTime() - v.startsAt.getTime() > 24 * 3_600_000)
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Un créneau dure au plus 24 heures." });
    if (v.maxCount !== undefined && v.maxCount < v.requiredCount)
      ctx.addIssue({ code: "custom", path: ["maxCount"], message: "Le maximum ne peut pas être inférieur au requis." });
  });
export type ShiftInput = z.input<typeof shiftSchema>;

/* Applications ------------------------------------------------------------ */

export const availabilityRangeSchema = z
  .object({
    kind: z.enum(["available", "unavailable"]).default("available"),
    startsAt: instant,
    endsAt: instant,
    note: optionalTextSchema(200),
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    path: ["endsAt"],
    message: "La fin doit suivre le début.",
  });

/** Fields the candidate may change after submission (while not assigned). */
export const candidateEditableSchema = z.object({
  positionPreferences: z.array(uuidSchema).max(10).optional(),
  availabilities: z.array(availabilityRangeSchema).max(40).optional(),
  skills: z
    .array(z.object({ skillId: uuidSchema, level: z.enum(["beginner", "intermediate", "expert"]).optional() }))
    .max(30)
    .optional(),
  buddies: z.array(emailSchema).max(3).optional(),
  constraints: optionalTextSchema(1000),
  phone: optionalTextSchema(40),
});
export type CandidateEditableInput = z.input<typeof candidateEditableSchema>;

export const volunteerApplicationSchema = candidateEditableSchema.extend({
  email: emailSchema,
  firstName: textSchema(80),
  lastName: textSchema(80),
  birthYear: z.coerce.number().int().min(1900).max(2030).nullable().optional(),
  motivation: optionalTextSchema(2000),
  experience: optionalTextSchema(2000),
  marketingOptIn: z.boolean().optional(),
  /** Answers to the event's custom questions, keyed by field key. */
  answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
});
export type VolunteerApplicationInput = z.input<typeof volunteerApplicationSchema>;

/** Staff edit of an approved (or any live) application. */
export const staffApplicationPatchSchema = candidateEditableSchema.extend({
  firstName: textSchema(80).optional(),
  lastName: textSchema(80).optional(),
  email: emailSchema.optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  verifiedSkillIds: z.array(uuidSchema).optional(),
});
export type StaffApplicationPatchInput = z.input<typeof staffApplicationPatchSchema>;

export const reasonSchema = z.object({ reason: textSchema(500).pipe(z.string().min(3)) });
export const optionalReasonSchema = z.object({ reason: optionalTextSchema(500) });

export const bulkDecisionSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(200),
  action: z.enum(["review", "approve", "waitlist", "reject"]),
  reason: optionalTextSchema(500),
});
export type BulkDecisionInput = z.input<typeof bulkDecisionSchema>;

export const listApplicationsSchema = z.object({
  eventId: uuidSchema.optional(),
  status: z
    .enum([
      "all",
      "to_review",
      "submitted",
      "under_review",
      "approved",
      "waitlisted",
      "rejected",
      "assigned",
      "confirmed",
      "withdrawn",
    ])
    .default("all"),
  positionId: uuidSchema.optional(),
  skillId: uuidSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListApplicationsInput = z.input<typeof listApplicationsSchema>;
