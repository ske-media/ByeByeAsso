import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, desc, eq, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission, systemRoleId } from "../authorization";
import { type Actor, ConflictError, NotFoundError, UnauthenticatedError } from "../kernel";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./schemas";
import { createOrganizationSchema, updateOrganizationSchema } from "./schemas";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  legalForm: string;
  country: string;
  timezone: string;
  status: string;
  createdAt: Date;
}

export interface OrganizationDetail extends OrganizationSummary {
  settings: { currency: string; locale: string; contactEmail: string | null; website: string | null };
}

function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") throw new UnauthenticatedError();
  return actor.userId;
}

/**
 * Create an organization: the creator becomes its first active member with the `owner`
 * role, settings row is created, audit written — all in ONE transaction.
 */
export async function createOrganization(
  db: Database,
  actor: Actor,
  rawInput: CreateOrganizationInput,
): Promise<OrganizationDetail> {
  const userId = requireUserId(actor);
  const input = createOrganizationSchema.parse(rawInput);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, input.slug))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError("Cet identifiant d'organisation est déjà utilisé.", { field: "slug" });
    }

    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: input.name,
        slug: input.slug,
        legalForm: input.legalForm,
        country: input.country,
        timezone: input.timezone,
        createdBy: userId,
      })
      .returning();
    if (!org) throw new Error("Insertion de l'organisation échouée");

    await tx.insert(schema.organizationSettings).values({ organizationId: org.id, locale: "fr-FR", currency: "EUR" });

    const [member] = await tx
      .insert(schema.organizationMembers)
      .values({ organizationId: org.id, userId })
      .returning({ id: schema.organizationMembers.id });
    if (!member) throw new Error("Insertion du membre échouée");

    await tx.insert(schema.memberRoleAssignments).values({
      organizationId: org.id,
      memberId: member.id,
      roleId: await systemRoleId(tx, "owner"),
      grantedBy: userId,
    });

    await recordAudit(tx, actor, {
      organizationId: org.id,
      action: "organization.created",
      targetType: "organization",
      targetId: org.id,
      metadata: { slug: org.slug, legalForm: org.legalForm },
    });

    return getOrganizationUnchecked(tx, org.id);
  });
}

async function getOrganizationUnchecked(db: DbExecutor, organizationId: string): Promise<OrganizationDetail> {
  const rows = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      legalForm: schema.organizations.legalForm,
      country: schema.organizations.country,
      timezone: schema.organizations.timezone,
      status: schema.organizations.status,
      createdAt: schema.organizations.createdAt,
      currency: schema.organizationSettings.currency,
      locale: schema.organizationSettings.locale,
      contactEmail: schema.organizationSettings.contactEmail,
      website: schema.organizationSettings.website,
    })
    .from(schema.organizations)
    .innerJoin(schema.organizationSettings, eq(schema.organizationSettings.organizationId, schema.organizations.id))
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Organisation", organizationId);
  const { currency, locale, contactEmail, website, ...rest } = row;
  return { ...rest, settings: { currency, locale, contactEmail, website } };
}

/** Read an organization the actor belongs to (organization.read). Non-members get 404, not 403: existence is not disclosed. */
export async function getOrganization(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
): Promise<OrganizationDetail> {
  try {
    await requirePermission(db, actor, "organization.read", { organizationId });
  } catch (error) {
    if (error instanceof UnauthenticatedError) throw error;
    throw new NotFoundError("Organisation", organizationId);
  }
  return getOrganizationUnchecked(db, organizationId);
}

/** Resolve a slug to an organization the actor can read. 404 when unknown or not a member. */
export async function getOrganizationBySlug(db: DbExecutor, actor: Actor, slug: string): Promise<OrganizationDetail> {
  const rows = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Organisation", slug);
  return getOrganization(db, actor, row.id);
}

/** Organizations where the actor is an active member, with its organization-wide role keys. */
export async function listMyOrganizations(
  db: DbExecutor,
  actor: Actor,
): Promise<Array<OrganizationSummary & { roles: string[] }>> {
  const userId = requireUserId(actor);
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    legal_form: string;
    country: string;
    timezone: string;
    status: string;
    created_at: Date;
    roles: string[] | null;
  }>(sql`
    select o.id, o.name, o.slug, o.legal_form, o.country, o.timezone, o.status, o.created_at,
      (select array_agg(distinct r.key order by r.key)
         from member_role_assignments a join roles r on r.id = a.role_id
        where a.member_id = m.id and a.event_id is null) as roles
    from organization_members m
    join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} and m.status = 'active' and o.status <> 'archived'
    order by o.name
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    legalForm: r.legal_form,
    country: r.country,
    timezone: r.timezone,
    status: r.status,
    createdAt: new Date(r.created_at),
    roles: r.roles ?? [],
  }));
}

export async function updateOrganization(
  db: Database,
  actor: Actor,
  organizationId: string,
  rawInput: UpdateOrganizationInput,
): Promise<OrganizationDetail> {
  await requirePermission(db, actor, "organization.manage", { organizationId });
  const input = updateOrganizationSchema.parse(rawInput);

  return db.transaction(async (tx) => {
    const orgPatch: Partial<typeof schema.organizations.$inferInsert> = {};
    if (input.name !== undefined) orgPatch.name = input.name;
    if (input.legalForm !== undefined) orgPatch.legalForm = input.legalForm;
    if (input.country !== undefined) orgPatch.country = input.country;
    if (input.timezone !== undefined) orgPatch.timezone = input.timezone;
    if (Object.keys(orgPatch).length > 0) {
      await tx.update(schema.organizations).set(orgPatch).where(eq(schema.organizations.id, organizationId));
    }
    if (input.settings) {
      const settingsPatch: Partial<typeof schema.organizationSettings.$inferInsert> = {};
      if ("contactEmail" in input.settings) settingsPatch.contactEmail = input.settings.contactEmail ?? null;
      if ("website" in input.settings) settingsPatch.website = input.settings.website ?? null;
      if (Object.keys(settingsPatch).length > 0) {
        await tx
          .update(schema.organizationSettings)
          .set(settingsPatch)
          .where(eq(schema.organizationSettings.organizationId, organizationId));
      }
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "organization.updated",
      targetType: "organization",
      targetId: organizationId,
      metadata: { fields: Object.keys(input) },
    });
    return getOrganizationUnchecked(tx, organizationId);
  });
}

/** Recent audit entries for an organization (organization.manage). */
export async function listAuditLog(db: DbExecutor, actor: Actor, organizationId: string, limit = 50) {
  await requirePermission(db, actor, "organization.manage", { organizationId });
  return db
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.organizationId, organizationId)))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}
