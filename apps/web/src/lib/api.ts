import "server-only";
import { randomUUID } from "node:crypto";
import { API_PREFIX } from "@kroov/config/constants";
import { type Actor, httpStatusFor, isDomainError } from "@kroov/domain/kernel";
import { consumeRateLimit, type RateLimitRule } from "@kroov/domain/platform";
import { installFrenchErrorMap, toFieldErrors } from "@kroov/validation";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { currentSession } from "./auth";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";

installFrenchErrorMap();

/**
 * /api/v1 handler toolkit.
 * - Uniform JSON errors: { error: { code, message, fieldErrors? } }.
 * - Session cookie auth + origin check on every state-changing request (CSRF).
 * - Domain errors mapped to HTTP status; unknown errors logged and returned as 500 without details.
 */

export type ApiContext = {
  actor: Actor;
  user: { id: string; name: string; email: string; emailVerified: boolean } | null;
  request: Request;
  requestId: string;
};

/** Client address for rate limiting: x-forwarded-for only when TRUST_PROXY is set, else "direct". */
export function clientSubject(request: Request): string {
  if (env().TRUST_PROXY) {
    const xff = request.headers.get("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "direct";
}

/** Inbound request id (from the proxy) or a fresh one; always echoed back. */
export function requestIdOf(request: Request): string {
  const inbound = request.headers.get("x-request-id");
  return inbound && /^[A-Za-z0-9._-]{8,128}$/.test(inbound) ? inbound : randomUUID();
}

/**
 * Applies a public rate limit; returns the 429 response when exceeded. Limits scale with
 * RATE_LIMIT_FACTOR so tests can raise them without changing the rule.
 */
export async function enforceRateLimit(request: Request, rule: RateLimitRule): Promise<NextResponse<ApiError> | null> {
  const factor = env().RATE_LIMIT_FACTOR;
  const scaled = { ...rule, limit: Math.max(1, Math.round(rule.limit * factor)) };
  const decision = await consumeRateLimit(db(), scaled, clientSubject(request));
  if (decision.allowed) return null;
  logger.warn({ scope: rule.scope, retryAfter: decision.retryAfterSeconds }, "rate limit exceeded");
  const res = apiError(429, "rate_limited", "Trop de requêtes. Réessayez dans quelques instants.", {
    details: { retryAfterSeconds: decision.retryAfterSeconds },
  });
  res.headers.set("Retry-After", String(decision.retryAfterSeconds));
  res.headers.set("RateLimit-Limit", String(decision.limit));
  res.headers.set("RateLimit-Remaining", "0");
  return res;
}

export interface ApiError {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]>; details?: Record<string, unknown> };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Partial<ApiError["error"]>,
): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function originAllowed(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const appOrigin = new URL(env().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === appOrigin;
  // Non-browser clients send no Origin; accept only with an explicit header so a
  // cookie-bearing cross-site form post (which always carries Origin) cannot slip through.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return (
    request.headers.get("x-requested-with") === "kroov" ||
    request.headers.get("content-type")?.includes("application/json") === true
  );
}

type Handler<P> = (ctx: ApiContext, params: P) => Promise<Response>;

export function apiRoute<P = Record<string, string>>(
  options: { auth: "required" | "optional"; rateLimit?: RateLimitRule },
  handler: Handler<P>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    const requestId = requestIdOf(request);
    const startedAt = Date.now();
    let response: Response;
    try {
      if (!originAllowed(request)) {
        response = apiError(403, "forbidden_origin", "Origine de la requête non autorisée.");
      } else {
        const limited = options.rateLimit ? await enforceRateLimit(request, options.rateLimit) : null;
        if (limited) {
          response = limited;
        } else {
          const session = await currentSession();
          if (options.auth === "required" && !session) {
            response = apiError(401, "unauthenticated", "Connexion requise.");
          } else {
            const ctx: ApiContext = {
              actor: session?.actor ?? { kind: "anonymous" },
              user: session?.user ?? null,
              request,
              requestId,
            };
            const params = await context.params;
            response = await handler(ctx, params);
          }
        }
      }
    } catch (error) {
      response = errorResponse(error, request, requestId);
    }
    response.headers.set("x-request-id", requestId);
    const durationMs = Date.now() - startedAt;
    // One structured line per API request: method, path (no query → no tokens), status, duration.
    logger.info(
      { requestId, method: request.method, path: new URL(request.url).pathname, status: response.status, durationMs },
      "api request",
    );
    return response;
  };
}

export function errorResponse(error: unknown, request: Request, requestId?: string): NextResponse<ApiError> {
  if (error instanceof InvalidJsonError) {
    return apiError(400, "invalid_json", error.message);
  }
  if (error instanceof ZodError) {
    return apiError(422, "validation_failed", "Certaines valeurs sont invalides.", {
      fieldErrors: toFieldErrors(error),
    });
  }
  if (isDomainError(error)) {
    const status = httpStatusFor(error.code);
    const fieldErrors = error.details?.fieldErrors as Record<string, string[]> | undefined;
    return apiError(status, error.code, error.message, {
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(error.details ? { details: { ...error.details } } : {}),
    });
  }
  logger.error(
    { err: error, requestId, method: request.method, path: new URL(request.url).pathname },
    "unhandled API error",
  );
  return apiError(500, "internal", "Une erreur inattendue s'est produite.", {
    ...(requestId ? { details: { requestId } } : {}),
  });
}

/** Parse and validate a JSON body; invalid JSON is a 400, schema failures a 422. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new InvalidJsonError();
  }
  return schema.parse(json);
}

export class InvalidJsonError extends Error {
  constructor() {
    super("Corps JSON invalide.");
    this.name = "InvalidJsonError";
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T, location?: string): NextResponse<{ data: T }> {
  return NextResponse.json(
    { data },
    { status: 201, headers: location ? { Location: `${API_PREFIX}${location}` } : {} },
  );
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
