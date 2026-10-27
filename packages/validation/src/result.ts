import type { z } from "zod";
import { type FieldErrors, toFieldErrors } from "./messages";

/**
 * Validate input at a trust boundary and return a discriminated result instead of throwing.
 * Keeps route handlers and server actions free of try/catch noise.
 */
export type ValidationResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors };

export function validate<S extends z.ZodType>(schema: S, input: unknown): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
}
