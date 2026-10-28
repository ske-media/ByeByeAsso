import type { Database } from "@kroov/database";
import { schema } from "@kroov/database";
import { type EmailPort, renderTransactionalEmail } from "@kroov/notifications";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export interface CreateAuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  appName: string;
  email: EmailPort;
  /** Policy environment (APP_ENV). */
  appEnv: "development" | "test" | "staging" | "production";
  trustedOrigins?: string[];
  /** Tests disable rate limiting to run flows quickly. Production always keeps it on. */
  rateLimitEnabled?: boolean;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 jours
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // rafraîchi au plus une fois par jour

/**
 * Better Auth instance (sessions en base, e-mail + mot de passe, vérification obligatoire,
 * réinitialisation sans divulgation d'existence, rate limiting en base).
 *
 * The profile row (`user_profiles`) is created in the user-creation hook so every user
 * always has one.
 */
export function createAuth(options: CreateAuthOptions) {
  const isProduction = options.appEnv === "production" || options.appEnv === "staging";
  const rateLimitEnabled = isProduction ? true : (options.rateLimitEnabled ?? true);

  return betterAuth({
    appName: options.appName,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: options.trustedOrigins ?? [],
    database: drizzleAdapter(options.db, {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        rateLimits: schema.rateLimits,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "kroov",
      useSecureCookies: isProduction,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      autoSignIn: false,
      sendResetPassword: async ({ user, url }) => {
        const { text, html } = renderTransactionalEmail({
          appName: options.appName,
          title: "Réinitialiser votre mot de passe",
          paragraphs: [
            `Bonjour ${user.name},`,
            "Vous avez demandé à réinitialiser votre mot de passe. Ce lien est valable une heure et ne peut être utilisé qu'une fois.",
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.",
          ],
          action: { label: "Choisir un nouveau mot de passe", url },
        });
        await options.email.send({
          to: user.email,
          subject: `${options.appName} · Réinitialisation du mot de passe`,
          text,
          html,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        const { text, html } = renderTransactionalEmail({
          appName: options.appName,
          title: "Confirmez votre adresse e-mail",
          paragraphs: [
            `Bonjour ${user.name},`,
            "Merci de confirmer votre adresse pour activer votre compte. Ce lien est valable 24 heures.",
          ],
          action: { label: "Confirmer mon adresse", url },
        });
        await options.email.send({
          to: user.email,
          subject: `${options.appName} · Confirmez votre adresse`,
          text,
          html,
        });
      },
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Phase 10: no cookie cache — a revoked session (account deletion, sign-out elsewhere) must
      // stop authenticating at once. The session lookup is one indexed query per request.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: rateLimitEnabled,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await options.db.insert(schema.userProfiles).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
