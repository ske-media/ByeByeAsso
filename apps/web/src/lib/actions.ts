import "server-only";
import { isDomainError } from "@kroov/domain/kernel";
import { installFrenchErrorMap, toFieldErrors } from "@kroov/validation";
import { ZodError } from "zod";
import type { ActionState } from "./action-state";
import { logger } from "./logger";

installFrenchErrorMap();

export type { ActionState } from "./action-state";
export { idleState } from "./action-state";

/** Plain object from FormData (first value per key, strings only). */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !(key in out)) out[key] = value;
  }
  return out;
}

/** Map thrown errors to an ActionState; rethrows Next.js control-flow errors (redirect). */
export function actionError(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof ZodError) {
    return { status: "error", fieldErrors: toFieldErrors(error), ...(values ? { values } : {}) };
  }
  if (isDomainError(error)) {
    const field = typeof error.details?.field === "string" ? error.details.field : undefined;
    const fieldErrors = error.details?.fieldErrors as Record<string, string[]> | undefined;
    return {
      status: "error",
      message: error.message,
      ...(fieldErrors ? { fieldErrors } : field ? { fieldErrors: { [field]: [error.message] } } : {}),
      ...(values ? { values } : {}),
    };
  }
  if (
    error &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_")
  ) {
    throw error;
  }
  logger.error({ err: error }, "server action failed");
  return {
    status: "error",
    message: "Une erreur inattendue s'est produite. Vos données saisies sont conservées.",
    ...(values ? { values } : {}),
  };
}
