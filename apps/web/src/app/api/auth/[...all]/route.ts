import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * Better Auth endpoints: /api/auth/sign-up/email, /sign-in/email, /sign-out,
 * /verify-email, /request-password-reset, /reset-password, /get-session, …
 * Rate limited and CSRF-protected by Better Auth (origin check on state-changing calls).
 */
const handler = toNextJsHandler((request: Request) => auth().handler(request));

export const GET = handler.GET;
export const POST = handler.POST;
