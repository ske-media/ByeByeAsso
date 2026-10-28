import { StateMachine } from "../kernel";

export type EventStatus = "draft" | "published" | "suspended" | "completed" | "cancelled" | "archived";

export interface EventGuardContext {
  /** Publication checklist outcome (computed by `publicationChecklist`). */
  checklistPassed: boolean;
  organizationActive: boolean;
}

/**
 * Event lifecycle. Documented graph (Mermaid via `eventStateMachine.toMermaid()`):
 *   draft → published | archived
 *   published → cancelled | suspended | completed
 *   suspended → published | cancelled
 *   completed → archived ; cancelled → archived
 * `archived` is terminal. Status is only ever written through `transition()`.
 */
export const eventStateMachine = new StateMachine<EventStatus, EventGuardContext>({
  entity: "event",
  initial: "draft",
  transitions: {
    draft: ["published", "archived"],
    published: ["cancelled", "suspended", "completed"],
    suspended: ["published", "cancelled"],
    completed: ["archived"],
    cancelled: ["archived"],
    archived: [],
  },
  guards: {
    "draft->published": (_f, _t, ctx) =>
      !ctx.organizationActive
        ? "L'organisation n'est pas active."
        : ctx.checklistPassed || "La check-list de publication n'est pas complète.",
    "suspended->published": (_f, _t, ctx) => ctx.organizationActive || "L'organisation n'est pas active.",
  },
  terminal: ["archived"],
});

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Brouillon",
  published: "Publié",
  suspended: "Suspendu",
  completed: "Terminé",
  cancelled: "Annulé",
  archived: "Archivé",
};
