import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";

/**
 * Transactional outbox writer. Call INSIDE the transaction of the state change so the
 * event is committed with it (and rolled back with it). The worker relays rows to the queue.
 */
export interface DomainEventEnvelope {
  aggregateType: string;
  aggregateId: string;
  eventType: `${string}.${string}`;
  organizationId?: string | null;
  payload: Record<string, unknown>;
}

export async function emitDomainEvent(db: DbExecutor, event: DomainEventEnvelope): Promise<void> {
  await db.insert(schema.outboxEvents).values({
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    organizationId: event.organizationId ?? null,
    payload: event.payload,
  });
}
