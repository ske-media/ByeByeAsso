/**
 * Domain error taxonomy. Route handlers map these to HTTP status codes;
 * UI maps them to user-readable French messages. Never leak stack traces.
 */
export type DomainErrorCode =
  | "validation_failed"
  | "not_found"
  | "forbidden"
  | "unauthenticated"
  | "conflict"
  | "invalid_transition"
  | "precondition_failed"
  | "rate_limited"
  | "dependency_unavailable"
  | "internal";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super("not_found", `${resource} introuvable.`, id ? { resource, id } : { resource });
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(permission?: string) {
    super(
      "forbidden",
      "Vous n'avez pas l'autorisation d'effectuer cette action.",
      permission ? { permission } : undefined,
    );
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor() {
    super("unauthenticated", "Connexion requise.");
    this.name = "UnauthenticatedError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("conflict", message, details);
    this.name = "ConflictError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super("invalid_transition", `Transition impossible pour ${entity} : ${from} → ${to}.`, { entity, from, to });
    this.name = "InvalidTransitionError";
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("precondition_failed", message, details);
    this.name = "PreconditionFailedError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** HTTP status for a domain error code. */
export function httpStatusFor(code: DomainErrorCode): number {
  switch (code) {
    case "validation_failed":
      return 422;
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "unauthenticated":
      return 401;
    case "conflict":
    case "invalid_transition":
      return 409;
    case "precondition_failed":
      return 412;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
    case "internal":
      return 500;
  }
}
