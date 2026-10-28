import { emailSchema, optionalTextSchema, slugSchema, textSchema, timezoneSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

export const eventVisibilitySchema = z.enum(["public", "unlisted", "private"]);

const instant = z.coerce.date();

const settingsSchema = z.object({
  accessInfo: optionalTextSchema(4000),
  programme: optionalTextSchema(8000),
  contactEmail: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  externalUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  showRemainingCapacity: z.boolean().optional(),
});

/**
 * Event payload. Dates are instants (already converted from the organizer's wall clock in
 * the event timezone by the caller — see kernel/time). `endsAt` strictly after `startsAt`;
 * a next-day end (midnight crossing) is valid and displayed explicitly.
 */
export const createEventSchema = z
  .object({
    title: textSchema(140).pipe(z.string().min(2)),
    slug: slugSchema.optional(),
    tagline: optionalTextSchema(160),
    description: optionalTextSchema(20_000),
    startsAt: instant,
    endsAt: instant,
    doorsAt: instant.optional(),
    timezone: timezoneSchema.default("Europe/Paris"),
    capacity: z.coerce.number().int().min(0).max(1_000_000).default(0),
    visibility: eventVisibilitySchema.default("public"),
    locationId: uuidSchema.optional(),
    settings: settingsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt.getTime() <= v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La fin doit être postérieure au début." });
    }
    if (v.doorsAt && v.doorsAt.getTime() > v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["doorsAt"], message: "L'ouverture des portes doit précéder le début." });
    }
    const maxDays = 31;
    if (v.endsAt.getTime() - v.startsAt.getTime() > maxDays * 24 * 3600 * 1000) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: `Un événement ne peut pas durer plus de ${maxDays} jours.`,
      });
    }
  });
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    /** Optimistic concurrency token: the version the client last read. */
    version: z.coerce.number().int().min(1),
    title: textSchema(140).pipe(z.string().min(2)).optional(),
    tagline: optionalTextSchema(160),
    description: optionalTextSchema(20_000),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    doorsAt: instant.nullable().optional(),
    timezone: timezoneSchema.optional(),
    capacity: z.coerce.number().int().min(0).max(1_000_000).optional(),
    visibility: eventVisibilitySchema.optional(),
    locationId: uuidSchema.nullable().optional(),
    settings: settingsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La fin doit être postérieure au début." });
    }
  });
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const cancelEventSchema = z.object({
  version: z.coerce.number().int().min(1),
  reason: textSchema(1000).pipe(z.string().min(5, "Indiquez un motif d'au moins 5 caractères.")),
});
export type CancelEventInput = z.input<typeof cancelEventSchema>;

export const listEventsSchema = z.object({
  status: z
    .enum(["draft", "published", "suspended", "completed", "cancelled", "archived", "all", "active"])
    .default("active"),
  q: optionalTextSchema(80),
});
export type ListEventsInput = z.input<typeof listEventsSchema>;

export const locationSchema = z.object({
  name: textSchema(120),
  addressLine1: optionalTextSchema(200),
  addressLine2: optionalTextSchema(200),
  postalCode: optionalTextSchema(12),
  city: textSchema(120),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .default("FR"),
  accessNotes: optionalTextSchema(4000),
});
export type LocationInput = z.input<typeof locationSchema>;
export const updateLocationSchema = locationSchema.partial();
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
