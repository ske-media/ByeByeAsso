import "server-only";
import { redirect } from "next/navigation";
import { currentSession } from "./auth";

/** Build a safe `next` parameter: same-origin paths only. */
export function safeNext(next: string | null | undefined, fallback = "/organisations"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}

/**
 * Require a signed-in session for a page; otherwise redirect to /connexion with `next`.
 * `requireVerified` additionally sends unverified accounts to the verification notice.
 */
export async function requireSession(nextPath: string, options: { requireVerified?: boolean } = {}) {
  const session = await currentSession();
  if (!session) {
    redirect(`/connexion?next=${encodeURIComponent(nextPath)}`);
  }
  if (options.requireVerified !== false && !session.user.emailVerified) {
    redirect(`/verifier-email?email=${encodeURIComponent(session.user.email)}&next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}
