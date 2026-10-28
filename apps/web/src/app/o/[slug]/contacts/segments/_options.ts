import { listTags } from "@kroov/domain/crm";
import { listEvents } from "@kroov/domain/events";
import type { Actor } from "@kroov/domain/kernel";
import { listMembershipPlans } from "@kroov/domain/memberships";
import { db } from "@/lib/db";
import type { EditorOptions } from "./segment-editor";

/** Options the rule builder offers — all scoped to the organization. */
export async function editorOptions(
  actor: Actor,
  organizationId: string,
  can: (p: "events.read" | "memberships.manage") => boolean,
): Promise<EditorOptions> {
  const [tags, events, plans] = await Promise.all([
    listTags(db(), actor, organizationId),
    can("events.read") ? listEvents(db(), actor, organizationId, { status: "all" }) : Promise.resolve([]),
    can("memberships.manage") ? listMembershipPlans(db(), actor, organizationId) : Promise.resolve([]),
  ]);
  return {
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    events: events.map((e) => ({ id: e.id, title: e.title })),
    plans: plans.map((p) => ({ id: p.id, name: p.name })),
  };
}
