import "server-only";
import { API_PREFIX } from "@kroov/config/constants";
import { type Actor, httpStatusFor, isDomainError } from "@kroov/domain/kernel";
import { installFrenchErrorMap, toFieldErrors } from "@kroov/validation";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { currentSession } from "./auth";
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
};

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
  options: { auth: "required" | "optional" },
  handler: Handler<P>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    try {
      if (!originAllowed(request)) {
        return apiError(403, "forbidden_origin", "Origine de la requête non autorisée.");
      }
      const session = await currentSession();
      if (options.auth === "required" && !session) {
        return apiError(401, "unauthenticated", "Connexion requise.");
      }
      const ctx: ApiContext = {
        actor: session?.actor ?? { kind: "anonymous" },
        user: session?.user ?? null,
        request,
      };
      const params = await context.params;
      return await handler(ctx, params);
    } catch (error) {
      return errorResponse(error, request);
    }
  };
}

export function errorResponse(error: unknown, request: Request): NextResponse<ApiError> {
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
  logger.error({ err: error, method: request.method, url: request.url }, "unhandled API error");
  return apiError(500, "internal", "Une erreur inattendue s'est produite.");
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
