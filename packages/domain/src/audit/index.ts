import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import type { Actor } from "../kernel";

/**
 * audit module — append-only trail of sensitive actions.
 * Called INSIDE the transaction of the action it records, so the log and the change
 * commit or roll back together.
 */
export interface AuditEntry {
  organizationId?: string | null;
  action: `${string}.${string}`;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAudit(db: DbExecutor, actor: Actor, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values({
    organizationId: entry.organizationId ?? null,
    actorKind: actor.kind,
    actorId:
      actor.kind === "user"
        ? actor.userId
        : actor.kind === "system"
          ? actor.job
          : actor.kind === "webhook"
            ? `${actor.provider}:${actor.eventId}`
            : null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress ?? null,
  });
}
