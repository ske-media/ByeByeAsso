import type { FieldErrors } from "@kroov/validation";

/**
 * Server-action result consumed by `useActionState` (shared by client and server code,
 * so this module must stay free of server-only imports). Field values are echoed back
 * so a server-side error never wipes what the person typed.
 */
export type ActionState =
  | { status: "idle" }
  | { status: "error"; message?: string; fieldErrors?: FieldErrors; values?: Record<string, string> }
  | { status: "success"; message?: string };

export const idleState: ActionState = { status: "idle" };
