import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, NotFoundError } from "../kernel";
import type { EventLocationView } from "./events";
import { type LocationInput, locationSchema, type UpdateLocationInput } from "./schemas";

const selectLocation = {
  id: schema.eventLocations.id,
  name: schema.eventLocations.name,
  addressLine1: schema.eventLocations.addressLine1,
  addressLine2: schema.eventLocations.addressLine2,
  postalCode: schema.eventLocations.postalCode,
  city: schema.eventLocations.city,
  country: schema.eventLocations.country,
  accessNotes: schema.eventLocations.accessNotes,
};

/** Active venues of the organization (events.read). */
export async function listLocations(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
): Promise<EventLocationView[]> {
  await requirePermission(db, actor, "events.read", { organizationId });
  return db
    .select(selectLocation)
    .from(schema.eventLocations)
    .where(and(eq(schema.eventLocations.organizationId, organizationId), isNull(schema.eventLocations.archivedAt)))
    .orderBy(asc(schema.eventLocations.name));
}

export async function createLocation(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: LocationInput,
): Promise<EventLocationView> {
  await requirePermission(db, actor, "events.update", { organizationId });
  const input = locationSchema.parse(rawInput);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.eventLocations)
      .values({
        organizationId,
        name: input.name,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        postalCode: input.postalCode ?? null,
        city: input.city,
        country: input.country,
        accessNotes: input.accessNotes ?? null,
      })
      .returning(selectLocation);
    if (!row) throw new Error("Insertion du lieu échouée");
    await recordAudit(tx, actor, {
      organizationId,
      action: "location.created",
      targetType: "event_location",
      targetId: row.id,
      metadata: { name: row.name },
    });
    return row;
  });
}

export async function updateLocation(
  db: Database,
  actor: Actor,
  organizationId: string,
  locationId: string,
  rawInput: UpdateLocationInput,
): Promise<EventLocationView> {
  await requirePermission(db, actor, "events.update", { organizationId });
  const input = locationSchema.partial().parse(rawInput);
  return db.transaction(async (tx) => {
    const patch: Partial<typeof schema.eventLocations.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if ("addressLine1" in input) patch.addressLine1 = input.addressLine1 ?? null;
    if ("addressLine2" in input) patch.addressLine2 = input.addressLine2 ?? null;
    if ("postalCode" in input) patch.postalCode = input.postalCode ?? null;
    if (input.city !== undefined) patch.city = input.city;
    if (input.country !== undefined) patch.country = input.country;
    if ("accessNotes" in input) patch.accessNotes = input.accessNotes ?? null;
    const [row] = await tx
      .update(schema.eventLocations)
      .set(patch)
      .where(and(eq(schema.eventLocations.id, locationId), eq(schema.eventLocations.organizationId, organizationId)))
      .returning(selectLocation);
    if (!row) throw new NotFoundError("Lieu", locationId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "location.updated",
      targetType: "event_location",
      targetId: locationId,
      metadata: { fields: Object.keys(input) },
    });
    return row;
  });
}

export async function archiveLocation(
  db: Database,
  actor: Actor,
  organizationId: string,
  locationId: string,
): Promise<void> {
  await requirePermission(db, actor, "events.update", { organizationId });
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.eventLocations)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.eventLocations.id, locationId), eq(schema.eventLocations.organizationId, organizationId)))
      .returning({ id: schema.eventLocations.id });
    if (updated.length === 0) throw new NotFoundError("Lieu", locationId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "location.archived",
      targetType: "event_location",
      targetId: locationId,
    });
  });
}
