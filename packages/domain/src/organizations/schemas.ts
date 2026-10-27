import { ROLES } from "@kroov/auth";
import { emailSchema, optionalTextSchema, slugSchema, textSchema, timezoneSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

export const legalFormSchema = z.enum(["association", "company", "collective", "public_body", "other"]);

export const createOrganizationSchema = z.object({
  name: textSchema(120).pipe(z.string().min(2)),
  slug: slugSchema,
  legalForm: legalFormSchema.default("association"),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .default("FR"),
  timezone: timezoneSchema.default("Europe/Paris"),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: textSchema(120).pipe(z.string().min(2)).optional(),
  legalForm: legalFormSchema.optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  timezone: timezoneSchema.optional(),
  settings: z
    .object({
      contactEmail: emailSchema.optional().or(z.literal("").transform(() => undefined)),
      website: optionalTextSchema(255),
    })
    .optional(),
});
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

/** A role grant: organization-wide or scoped to one event. */
export const roleGrantSchema = z.object({
  role: z.enum(ROLES),
  eventId: uuidSchema.optional(),
});
export type RoleGrant = z.infer<typeof roleGrantSchema>;

export const setMemberRolesSchema = z.object({
  grants: z.array(roleGrantSchema).min(0).max(20),
  reason: optionalTextSchema(500),
});
export type SetMemberRolesInput = z.input<typeof setMemberRolesSchema>;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES),
  eventId: uuidSchema.optional(),
});
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
