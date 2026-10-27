/**
 * Who is performing a command. Every service function receives an Actor and
 * authorises against it server-side — never against client-provided ids.
 */
export type Actor =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "system"; readonly job: string }
  | { readonly kind: "webhook"; readonly provider: string; readonly eventId: string }
  | { readonly kind: "anonymous" };

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "user":
      return `user:${actor.userId}`;
    case "system":
      return `system:${actor.job}`;
    case "webhook":
      return `webhook:${actor.provider}:${actor.eventId}`;
    case "anonymous":
      return "anonymous";
  }
}
