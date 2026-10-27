import { randomUUID } from "node:crypto";

/** UUID generation lives in one place so it can be swapped (e.g. UUID v7) without touching modules. */
export function newId(): string {
  return randomUUID();
}

/**
 * Human-facing references such as "KR-1048" are NOT primary keys. They are generated
 * from a per-organization sequence (Phase 3) and stored alongside the UUID.
 */
export function formatReference(prefix: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Séquence invalide : ${sequence}`);
  }
  return `${prefix}-${sequence}`;
}
