import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from "../kernel";
import { type ContactListItem, eventRelationSql, searchSql, sqlList } from "./contacts";
import { slugify } from "./identities";
import {
  type SegmentDefinition,
  type SegmentDefinitionInput,
  type SegmentInput,
  type SegmentUpdateInput,
  segmentDefinitionSchema,
  segmentInputSchema,
  segmentMembersSchema,
  segmentUpdateSchema,
} from "./schemas";

export interface SegmentView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: "dynamic" | "static";
  definition: SegmentDefinition;
  memberCount: number | null;
  computedAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
}

type SegmentRow = typeof schema.segments.$inferSelect;

function toView(r: SegmentRow): SegmentView {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    kind: r.kind,
    definition: segmentDefinitionSchema.parse(r.definition ?? {}),
    memberCount: r.memberCount,
    computedAt: r.computedAt,
    archivedAt: r.archivedAt,
    version: r.version,
    createdAt: r.createdAt,
  };
}

async function loadSegment(db: DbExecutor, organizationId: string, segmentId: string): Promise<SegmentRow> {
  const rows = await db
    .select()
    .from(schema.segments)
    .where(and(eq(schema.segments.id, segmentId), eq(schema.segments.organizationId, organizationId)))
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError("segment", segmentId);
  return r;
}

/* ------------------------------------------------------------------------- */
/* rule compilation — every subquery is bound to the organization             */
/* ------------------------------------------------------------------------- */

/** Compile a segment definition into a SQL predicate over the `contacts` table (alias "contacts"). */
export function compileDefinition(organizationId: string, def: SegmentDefinition): SQL {
  const parts: SQL[] = [];
  for (const rule of def.rules) {
    switch (rule.type) {
      case "tag": {
        const ex = sql`exists (select 1 from contact_tag_assignments ta where ta.contact_id = "contacts"."id" and ta.tag_id in ${sqlList(rule.tagIds)})`;
        parts.push(rule.op === "in" ? ex : sql`not ${ex}`);
        break;
      }
      case "marketing_email":
        parts.push(sql`"contacts"."marketing_email_status" in ${sqlList(rule.statuses)}`);
        break;
      case "event":
        parts.push(eventRelationSql(organizationId, rule.relation, rule.eventIds));
        break;
      case "membership": {
        const plan = rule.planIds?.length ? sql` and m.plan_id in ${sqlList(rule.planIds)}` : sql``;
        const base = sql`select 1 from memberships m where m.organization_id = ${organizationId}
          and m.member_email in (select ci.value from contact_identities ci where ci.contact_id = "contacts"."id" and ci.kind = 'email')${plan}`;
        if (rule.state === "active") parts.push(sql`exists (${base} and m.status = 'active')`);
        else if (rule.state === "expired")
          parts.push(
            sql`exists (${base} and m.status in ('expired','cancelled')) and not exists (${base} and m.status = 'active')`,
          );
        else if (rule.state === "never")
          parts.push(sql`not exists (${base} and m.status in ('active','suspended','expired','cancelled'))`);
        else parts.push(sql`exists (${base} and m.status in ('active','suspended','expired','cancelled'))`);
        break;
      }
      case "orders": {
        const sub = sql`(select coalesce(sum(o.total_minor), 0) from orders o where o.organization_id = ${organizationId}
          and o.status in ('paid','partially_refunded')
          and o.buyer_email in (select ci.value from contact_identities ci where ci.contact_id = "contacts"."id" and ci.kind = 'email'))`;
        if (rule.minCount !== undefined) parts.push(sql`"contacts"."orders_count" >= ${rule.minCount}`);
        if (rule.minTotalMinor !== undefined) parts.push(sql`${sub} >= ${rule.minTotalMinor}`);
        if (rule.minCount === undefined && rule.minTotalMinor === undefined)
          parts.push(sql`"contacts"."orders_count" >= 1`);
        break;
      }
      case "activity":
        if (rule.after) parts.push(sql`"contacts"."last_activity_at" >= ${rule.after}`);
        if (rule.before) parts.push(sql`"contacts"."last_activity_at" < ${rule.before}`);
        break;
      case "source":
        parts.push(sql`"contacts"."source" in ${sqlList(rule.sources)}`);
        break;
      case "search":
        parts.push(searchSql(rule.q));
        break;
    }
  }
  if (parts.length === 0) return sql`true`;
  const joined = sql.join(parts, def.match === "any" ? sql` or ` : sql` and `);
  return sql`(${joined})`;
}

export interface SegmentEvaluation {
  count: number;
  /** First contacts matched (preview); the authoritative list is recomputed at use. */
  sample: Array<Pick<ContactListItem, "id" | "email" | "name" | "marketingEmailStatus">>;
  /** How many of the matched contacts are actually consented for e-mail (opted_in). */
  consented: number;
  computedAt: Date;
}

export async function evaluateDefinition(
  db: DbExecutor,
  organizationId: string,
  def: SegmentDefinition,
  sampleSize = 10,
): Promise<SegmentEvaluation> {
  const predicate = compileDefinition(organizationId, def);
  const base = and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.status, "active"), predicate);
  const counts = await db
    .select({
      n: sql<number>`count(*)::int`,
      consented: sql<number>`count(*) filter (where "contacts"."marketing_email_status" = 'opted_in')::int`,
    })
    .from(schema.contacts)
    .where(base);
  const sample = await db
    .select({
      id: schema.contacts.id,
      email: schema.contacts.primaryEmail,
      firstName: schema.contacts.firstName,
      lastName: schema.contacts.lastName,
      marketingEmailStatus: schema.contacts.marketingEmailStatus,
    })
    .from(schema.contacts)
    .where(base)
    .orderBy(asc(schema.contacts.lastName), asc(schema.contacts.primaryEmail))
    .limit(sampleSize);
  return {
    count: counts[0]?.n ?? 0,
    consented: counts[0]?.consented ?? 0,
    sample: sample.map((c) => ({
      id: c.id,
      email: c.email,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email,
      marketingEmailStatus: c.marketingEmailStatus,
    })),
    computedAt: new Date(),
  };
}

/** Ids of the contacts matching a definition (for materialisation and for phase 8 dispatch). */
export async function resolveDefinition(
  db: DbExecutor,
  organizationId: string,
  def: SegmentDefinition,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.organizationId, organizationId),
        eq(schema.contacts.status, "active"),
        compileDefinition(organizationId, def),
      ),
    );
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* ------------------------------------------------------------------------- */

async function authorize(db: DbExecutor, actor: Actor, organizationId: string, p: "contacts.read" | "contacts.manage") {
  await requirePermission(db, actor, p, { organizationId });
}

async function assertReferences(db: DbExecutor, organizationId: string, def: SegmentDefinition) {
  const fieldErrors: Record<string, string[]> = {};
  for (const [i, rule] of def.rules.entries()) {
    if (rule.type === "tag") {
      const known = await db
        .select({ id: schema.contactTags.id })
        .from(schema.contactTags)
        .where(and(eq(schema.contactTags.organizationId, organizationId), inArray(schema.contactTags.id, rule.tagIds)));
      if (known.length !== new Set(rule.tagIds).size) fieldErrors[`rules.${i}.tagIds`] = ["Étiquette inconnue."];
    } else if (rule.type === "event") {
      const known = await db
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.organizationId, organizationId), inArray(schema.events.id, rule.eventIds)));
      if (known.length !== new Set(rule.eventIds).size) fieldErrors[`rules.${i}.eventIds`] = ["Événement inconnu."];
    } else if (rule.type === "membership" && rule.planIds?.length) {
      const known = await db
        .select({ id: schema.membershipPlans.id })
        .from(schema.membershipPlans)
        .where(
          and(
            eq(schema.membershipPlans.organizationId, organizationId),
            inArray(schema.membershipPlans.id, rule.planIds),
          ),
        );
      if (known.length !== new Set(rule.planIds).size) fieldErrors[`rules.${i}.planIds`] = ["Formule inconnue."];
    }
  }
  if (Object.keys(fieldErrors).length > 0) throw new ValidationError(fieldErrors);
}

export async function listSegments(db: Database, actor: Actor, organizationId: string): Promise<SegmentView[]> {
  await authorize(db, actor, organizationId, "contacts.read");
  const rows = await db
    .select()
    .from(schema.segments)
    .where(and(eq(schema.segments.organizationId, organizationId), isNull(schema.segments.archivedAt)))
    .orderBy(asc(schema.segments.name));
  return rows.map(toView);
}

export async function previewSegment(
  db: Database,
  actor: Actor,
  organizationId: string,
  definition: SegmentDefinitionInput,
): Promise<SegmentEvaluation> {
  await authorize(db, actor, organizationId, "contacts.read");
  const def = segmentDefinitionSchema.parse(definition);
  await assertReferences(db, organizationId, def);
  return evaluateDefinition(db, organizationId, def);
}

export async function createSegment(db: Database, actor: Actor, organizationId: string, input: SegmentInput) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = segmentInputSchema.parse(input);
  const slug = v.slug ?? slugify(v.name);
  if (!slug) throw new ValidationError({ name: ["Nom invalide."] });
  await assertReferences(db, organizationId, v.definition);
  return db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: schema.segments.id })
      .from(schema.segments)
      .where(and(eq(schema.segments.organizationId, organizationId), eq(schema.segments.slug, slug)))
      .limit(1);
    if (dup.length > 0) throw new ConflictError("Un segment porte déjà ce nom.");
    const inserted = await tx
      .insert(schema.segments)
      .values({
        organizationId,
        name: v.name,
        slug,
        description: v.description ?? null,
        kind: v.kind,
        definition: v.definition,
        createdBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning();
    const row = inserted[0] as SegmentRow;
    await recordAudit(tx, actor, {
      organizationId,
      action: "segment.created",
      targetType: "segment",
      targetId: row.id,
      metadata: { name: v.name, kind: v.kind, rules: v.definition.rules.length },
    });
    const refreshed = v.kind === "dynamic" ? await materialise(tx, organizationId, row) : row;
    return toView(refreshed);
  });
}

export async function updateSegment(
  db: Database,
  actor: Actor,
  organizationId: string,
  segmentId: string,
  input: SegmentUpdateInput,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = segmentUpdateSchema.parse(input);
  if (v.definition) await assertReferences(db, organizationId, v.definition);
  return db.transaction(async (tx) => {
    const s = await loadSegment(tx, organizationId, segmentId);
    if (s.archivedAt) throw new PreconditionFailedError("Segment archivé.");
    if (v.version !== undefined && v.version !== s.version)
      throw new ConflictError("Le segment a été modifié entre-temps ; rechargez.", { code: "stale_version" });
    const updated = await tx
      .update(schema.segments)
      .set({
        ...(v.name ? { name: v.name } : {}),
        ...(v.description !== undefined ? { description: v.description ?? null } : {}),
        ...(v.kind ? { kind: v.kind } : {}),
        ...(v.definition ? { definition: v.definition } : {}),
        version: s.version + 1,
      })
      .where(eq(schema.segments.id, s.id))
      .returning();
    const row = updated[0] as SegmentRow;
    await recordAudit(tx, actor, {
      organizationId,
      action: "segment.updated",
      targetType: "segment",
      targetId: s.id,
      metadata: { fields: Object.keys(v).filter((k) => k !== "version") },
    });
    const refreshed = row.kind === "dynamic" ? await materialise(tx, organizationId, row) : row;
    return toView(refreshed);
  });
}

export async function archiveSegment(db: Database, actor: Actor, organizationId: string, segmentId: string) {
  await authorize(db, actor, organizationId, "contacts.manage");
  return db.transaction(async (tx) => {
    const s = await loadSegment(tx, organizationId, segmentId);
    if (s.archivedAt) return;
    await tx.update(schema.segments).set({ archivedAt: new Date() }).where(eq(schema.segments.id, s.id));
    await recordAudit(tx, actor, { organizationId, action: "segment.archived", targetType: "segment", targetId: s.id });
  });
}

/** Snapshot a dynamic segment's members (count + table) — the list is still recomputed at dispatch time. */
async function materialise(tx: DbExecutor, organizationId: string, s: SegmentRow): Promise<SegmentRow> {
  const def = segmentDefinitionSchema.parse(s.definition ?? {});
  const ids = await resolveDefinition(tx, organizationId, def);
  await tx.delete(schema.segmentMembers).where(eq(schema.segmentMembers.segmentId, s.id));
  for (let i = 0; i < ids.length; i += 500) {
    await tx
      .insert(schema.segmentMembers)
      .values(ids.slice(i, i + 500).map((contactId) => ({ organizationId, segmentId: s.id, contactId })))
      .onConflictDoNothing();
  }
  const updated = await tx
    .update(schema.segments)
    .set({ memberCount: ids.length, computedAt: new Date() })
    .where(eq(schema.segments.id, s.id))
    .returning();
  return updated[0] ?? s;
}

export interface SegmentDetail extends SegmentView {
  evaluation: SegmentEvaluation;
}

export async function getSegment(
  db: Database,
  actor: Actor,
  organizationId: string,
  segmentId: string,
): Promise<SegmentDetail> {
  await authorize(db, actor, organizationId, "contacts.read");
  const s = await loadSegment(db, organizationId, segmentId);
  const view = toView(s);
  if (s.kind === "dynamic")
    return { ...view, evaluation: await evaluateDefinition(db, organizationId, view.definition) };
  const members = await db
    .select({
      id: schema.contacts.id,
      email: schema.contacts.primaryEmail,
      firstName: schema.contacts.firstName,
      lastName: schema.contacts.lastName,
      marketingEmailStatus: schema.contacts.marketingEmailStatus,
    })
    .from(schema.segmentMembers)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.segmentMembers.contactId))
    .where(and(eq(schema.segmentMembers.segmentId, s.id), eq(schema.contacts.status, "active")))
    .orderBy(asc(schema.contacts.lastName), asc(schema.contacts.primaryEmail));
  return {
    ...view,
    evaluation: {
      count: members.length,
      consented: members.filter((m) => m.marketingEmailStatus === "opted_in").length,
      sample: members.map((c) => ({
        id: c.id,
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email,
        marketingEmailStatus: c.marketingEmailStatus,
      })),
      computedAt: s.computedAt ?? s.createdAt,
    },
  };
}

/** Recompute a dynamic segment now (count stored for the list page). */
export async function recomputeSegment(db: Database, actor: Actor, organizationId: string, segmentId: string) {
  await authorize(db, actor, organizationId, "contacts.read");
  return db.transaction(async (tx) => {
    const s = await loadSegment(tx, organizationId, segmentId);
    if (s.kind !== "dynamic") return toView(s);
    return toView(await materialise(tx, organizationId, s));
  });
}

export async function setStaticMembers(
  db: Database,
  actor: Actor,
  organizationId: string,
  segmentId: string,
  input: { add?: string[]; remove?: string[] },
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = segmentMembersSchema.parse(input);
  return db.transaction(async (tx) => {
    const s = await loadSegment(tx, organizationId, segmentId);
    if (s.kind !== "static") throw new PreconditionFailedError("Les membres d'un segment dynamique sont calculés.");
    const all = [...v.add, ...v.remove];
    if (all.length > 0) {
      const known = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.organizationId, organizationId), inArray(schema.contacts.id, all)));
      if (known.length !== new Set(all).size) throw new NotFoundError("contact");
    }
    if (v.add.length > 0)
      await tx
        .insert(schema.segmentMembers)
        .values(
          v.add.map((contactId) => ({
            organizationId,
            segmentId: s.id,
            contactId,
            addedBy: actor.kind === "user" ? actor.userId : null,
          })),
        )
        .onConflictDoNothing();
    if (v.remove.length > 0)
      await tx
        .delete(schema.segmentMembers)
        .where(and(eq(schema.segmentMembers.segmentId, s.id), inArray(schema.segmentMembers.contactId, v.remove)));
    const count = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.segmentMembers)
      .where(eq(schema.segmentMembers.segmentId, s.id));
    const updated = await tx
      .update(schema.segments)
      .set({ memberCount: count[0]?.n ?? 0, computedAt: new Date(), version: s.version + 1 })
      .where(eq(schema.segments.id, s.id))
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "segment.members_changed",
      targetType: "segment",
      targetId: s.id,
      metadata: { added: v.add.length, removed: v.remove.length },
    });
    return toView(updated[0] as SegmentRow);
  });
}

/** Segments ordered by most recent computation first — used by the overview and phase 8. */
export async function segmentsSummary(db: DbExecutor, organizationId: string) {
  const rows = await db
    .select({ id: schema.segments.id, name: schema.segments.name, memberCount: schema.segments.memberCount })
    .from(schema.segments)
    .where(and(eq(schema.segments.organizationId, organizationId), isNull(schema.segments.archivedAt)))
    .orderBy(desc(schema.segments.computedAt))
    .limit(10);
  return rows;
}
