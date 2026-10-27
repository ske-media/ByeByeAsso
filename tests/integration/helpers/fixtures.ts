import { randomUUID } from "node:crypto";
import type { Database } from "@kroov/database";
import { schema } from "@kroov/database";
import type { Actor } from "@kroov/domain/kernel";

/**
 * Test fixtures — clearly separated from production seeds. Users are inserted directly
 * (Better Auth is exercised by the API/E2E layers), profiles included as the auth hook would.
 */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  actor: Actor;
}

export async function createTestUser(
  db: Database,
  overrides: { email?: string; name?: string; emailVerified?: boolean } = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = overrides.email ?? `user-${id.slice(0, 8)}@test.kroov.local`;
  const name = overrides.name ?? `Test ${id.slice(0, 4)}`;
  await db.insert(schema.users).values({ id, email, name, emailVerified: overrides.emailVerified ?? true });
  await db.insert(schema.userProfiles).values({ userId: id });
  return { id, email, name, actor: { kind: "user", userId: id } };
}

export const DEMO = {
  organization: { name: "Le Collectif des Nuits", slug: "le-collectif-des-nuits" },
  owner: { name: "Camille Durand", email: "camille@collectif-des-nuits.test" },
  admin: { name: "Alex Garnier", email: "alex@collectif-des-nuits.test" },
  volunteerManager: { name: "Nora Diallo", email: "nora@collectif-des-nuits.test" },
  scanner: { name: "Yanis Roux", email: "yanis@collectif-des-nuits.test" },
} as const;
