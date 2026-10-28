import { listSegments } from "@kroov/domain/crm";
import type { Actor } from "@kroov/domain/kernel";
import { listTemplates } from "@kroov/domain/marketing";
import { db } from "@/lib/db";
import type { EditorOptions } from "./campaign-editor";

export async function editorOptions(
  actor: Actor,
  organizationId: string,
  canReadContacts: boolean,
): Promise<EditorOptions> {
  const [segments, templates] = await Promise.all([
    canReadContacts ? listSegments(db(), actor, organizationId) : Promise.resolve([]),
    listTemplates(db(), actor, organizationId),
  ]);
  return {
    segments: segments.map((s) => ({ id: s.id, name: s.name, memberCount: s.memberCount })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      preheader: t.preheader,
      body: t.body,
    })),
  };
}
