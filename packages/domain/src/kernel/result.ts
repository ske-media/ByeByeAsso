import type { DomainError } from "./errors";

/**
 * Explicit success/failure result for domain commands.
 * Commands that can fail for business reasons return a Result rather than throwing,
 * so callers must handle the failure branch.
 */
export type Result<T, E extends DomainError = DomainError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E extends DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Unwrap a result or throw its error. Use at the edge (route handlers), not inside services. */
export function unwrap<T, E extends DomainError>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}
