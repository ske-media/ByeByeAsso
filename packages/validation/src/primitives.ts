import { RESERVED_SLUGS, SLUG_PATTERN, SUPPORTED_CURRENCIES } from "@kroov/config/constants";
import { z } from "zod";

/** UUID v4/v7 identifiers. All primary keys are UUIDs. */
export const uuidSchema = z.string().uuid();

/** Trimmed, non-empty text with an upper bound (default 255). */
export const textSchema = (max = 255) => z.string().trim().min(1).max(max);

/** Optional trimmed text: empty strings become undefined. */
export const optionalTextSchema = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional();

/** E-mail, lower-cased and trimmed. */
export const emailSchema = z.string().trim().toLowerCase().max(320).email();

/** URL-safe slug, reserved words rejected. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(63)
  .regex(SLUG_PATTERN, "Utilisez uniquement des lettres minuscules, des chiffres et des tirets.")
  .refine((s) => !RESERVED_SLUGS.has(s), "Cet identifiant est réservé.");

/** ISO 4217 currency code limited to supported currencies. */
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

/** Monetary amount in integer minor units (centimes). Never a float. */
export const minorUnitsSchema = z.number().int().nonnegative().max(1_000_000_000);

/** IANA timezone identifier, validated through Intl. */
export const timezoneSchema = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Fuseau horaire inconnu.");

/** ISO 8601 instant string → Date. */
export const instantSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

/** A half-open interval [start, end) with end strictly after start. */
export const intervalSchema = z
  .object({ start: instantSchema, end: instantSchema })
  .refine((v) => v.end.getTime() > v.start.getTime(), {
    message: "La fin doit être postérieure au début.",
    path: ["end"],
  });

/** Pagination parameters for list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;
