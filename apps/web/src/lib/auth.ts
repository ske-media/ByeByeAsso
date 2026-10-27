import "server-only";
import { type Auth, createAuth } from "@kroov/auth/server";
import type { Actor } from "@kroov/domain/kernel";
import { headers } from "next/headers";
import { db } from "./db";
import { email } from "./email";
import { env } from "./env";

const globalForAuth = globalThis as unknown as { __kroovAuth?: Auth };

/** Better Auth singleton for the web process. */
export function auth(): Auth {
  if (!globalForAuth.__kroovAuth) {
    const e = env();
    if (e.APP_ENV !== "development" && !e.AUTH_SECRET) {
      throw new Error("AUTH_SECRET est requis hors développement (APP_ENV).");
    }
    globalForAuth.__kroovAuth = createAuth({
      db: db(),
      secret: e.AUTH_SECRET ?? "dev-only-secret-change-me-dev-only-secret-change-me",
      baseURL: e.APP_URL,
      appName: e.APP_NAME,
      email: email(),
      appEnv: e.APP_ENV,
      trustedOrigins: [e.APP_URL],
      rateLimitEnabled: e.APP_ENV !== "test",
    });
  }
  return globalForAuth.__kroovAuth;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/** Current session from the request cookies, or null. */
export async function currentSession(): Promise<{ user: SessionUser; actor: Actor } | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    },
    actor: { kind: "user", userId: session.user.id },
  };
}

/** Actor for the current request: anonymous when signed out. */
export async function currentActor(): Promise<Actor> {
  const session = await currentSession();
  return session?.actor ?? { kind: "anonymous" };
}
