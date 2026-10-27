import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { optionalTextSchema, textSchema, timezoneSchema } from "@kroov/validation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Actor, NotFoundError, UnauthenticatedError } from "../kernel";

/**
 * identity module — the acting user's own profile. Only the user can read or edit it.
 */

export const updateProfileSchema = z.object({
  name: textSchema(80).optional(),
  locale: z.enum(["fr-FR"]).optional(),
  timezone: timezoneSchema.optional(),
  phone: optionalTextSchema(30),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export interface Profile {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  locale: string;
  timezone: string;
  phone: string | null;
  createdAt: Date;
}

function requireUser(actor: Actor): string {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  return actor.userId;
}

export async function getProfile(db: DbExecutor, actor: Actor): Promise<Profile> {
  const userId = requireUser(actor);
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      locale: schema.userProfiles.locale,
      timezone: schema.userProfiles.timezone,
      phone: schema.userProfiles.phone,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .innerJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Profil", userId);
  return row;
}

export async function updateProfile(db: DbExecutor, actor: Actor, input: UpdateProfileInput): Promise<Profile> {
  const userId = requireUser(actor);
  if (input.name !== undefined) {
    await db.update(schema.users).set({ name: input.name, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  }
  const profilePatch: Partial<typeof schema.userProfiles.$inferInsert> = {};
  if (input.locale !== undefined) profilePatch.locale = input.locale;
  if (input.timezone !== undefined) profilePatch.timezone = input.timezone;
  if ("phone" in input) profilePatch.phone = input.phone ?? null;
  if (Object.keys(profilePatch).length > 0) {
    await db.update(schema.userProfiles).set(profilePatch).where(eq(schema.userProfiles.userId, userId));
  }
  return getProfile(db, actor);
}
