import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, ConflictError, NotFoundError, PreconditionFailedError } from "../kernel";
import { type MembershipPlanInput, membershipPlanSchema } from "./schemas";

export interface MembershipPlanView {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  periodKind: "fixed" | "rolling";
  validFrom: Date | null;
  validUntil: Date | null;
  durationMonths: number | null;
  requiresReview: boolean;
  maxMembers: number | null;
  public: boolean;
  position: number;
  status: "active" | "archived";
  benefits: string[];
  /** active + pending + awaiting_payment memberships (what counts against the quota). */
  taken: number;
  activeMembers: number;
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function loadPlans(db: DbExecutor, organizationId: string, planIds?: string[]): Promise<MembershipPlanView[]> {
  const conditions = [eq(schema.membershipPlans.organizationId, organizationId)];
  if (planIds) conditions.push(inArray(schema.membershipPlans.id, planIds));
  const plans = await db
    .select({
      plan: schema.membershipPlans,
      taken: sql<number>`(select count(*)::int from ${schema.memberships} m where m.plan_id = "membership_plans"."id" and m.status in ('active','pending','awaiting_payment','suspended'))`,
      active: sql<number>`(select count(*)::int from ${schema.memberships} m where m.plan_id = "membership_plans"."id" and m.status = 'active')`,
    })
    .from(schema.membershipPlans)
    .where(and(...conditions))
    .orderBy(asc(schema.membershipPlans.position), asc(schema.membershipPlans.createdAt));
  if (plans.length === 0) return [];
  const benefits = await db
    .select()
    .from(schema.membershipPlanBenefits)
    .where(
      inArray(
        schema.membershipPlanBenefits.planId,
        plans.map((p) => p.plan.id),
      ),
    )
    .orderBy(asc(schema.membershipPlanBenefits.position));
  return plans.map((p) => ({
    id: p.plan.id,
    organizationId: p.plan.organizationId,
    slug: p.plan.slug,
    name: p.plan.name,
    description: p.plan.description,
    priceMinor: p.plan.priceMinor,
    currency: p.plan.currency,
    periodKind: p.plan.periodKind,
    validFrom: p.plan.validFrom,
    validUntil: p.plan.validUntil,
    durationMonths: p.plan.durationMonths,
    requiresReview: p.plan.requiresReview,
    maxMembers: p.plan.maxMembers,
    public: p.plan.public,
    position: p.plan.position,
    status: p.plan.status,
    benefits: benefits.filter((b) => b.planId === p.plan.id).map((b) => b.label),
    taken: p.taken,
    activeMembers: p.active,
  }));
}

export async function listMembershipPlans(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
): Promise<MembershipPlanView[]> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  return loadPlans(db, organizationId);
}

export async function getMembershipPlan(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  planId: string,
): Promise<MembershipPlanView> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const plan = (await loadPlans(db, organizationId, [planId]))[0];
  if (!plan) throw new NotFoundError("Formule", planId);
  return plan;
}

/** Public: active, public plans of an organization, with remaining places when capped. */
export async function listPublicMembershipPlans(db: DbExecutor, organizationId: string): Promise<MembershipPlanView[]> {
  return (await loadPlans(db, organizationId)).filter((p) => p.status === "active" && p.public);
}

export async function loadPlanUnchecked(
  db: DbExecutor,
  organizationId: string,
  planId: string,
): Promise<MembershipPlanView> {
  const plan = (await loadPlans(db, organizationId, [planId]))[0];
  if (!plan) throw new NotFoundError("Formule", planId);
  return plan;
}

async function saveBenefits(tx: DbExecutor, organizationId: string, planId: string, benefits: string[]) {
  await tx.delete(schema.membershipPlanBenefits).where(eq(schema.membershipPlanBenefits.planId, planId));
  if (benefits.length > 0) {
    await tx
      .insert(schema.membershipPlanBenefits)
      .values(benefits.map((label, position) => ({ organizationId, planId, label, position })));
  }
}

export async function createMembershipPlan(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: MembershipPlanInput,
): Promise<MembershipPlanView> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const v = membershipPlanSchema.parse(input);
  const currency =
    (
      await db
        .select({ c: schema.organizationSettings.currency })
        .from(schema.organizationSettings)
        .where(eq(schema.organizationSettings.organizationId, organizationId))
        .limit(1)
    )[0]?.c ?? "EUR";
  return db.transaction(async (tx) => {
    const base = v.slug ?? slugify(v.name);
    let slug = base || "formule";
    for (let i = 2; i < 50; i += 1) {
      const taken = await tx
        .select({ id: schema.membershipPlans.id })
        .from(schema.membershipPlans)
        .where(and(eq(schema.membershipPlans.organizationId, organizationId), eq(schema.membershipPlans.slug, slug)))
        .limit(1);
      if (!taken[0]) break;
      if (v.slug) throw new ConflictError("Cet identifiant de formule est déjà utilisé.", { field: "slug" });
      slug = `${base}-${i}`;
    }
    const [row] = await tx
      .insert(schema.membershipPlans)
      .values({
        organizationId,
        slug,
        name: v.name,
        description: v.description ?? null,
        priceMinor: v.priceMinor,
        currency,
        periodKind: v.periodKind,
        validFrom: v.periodKind === "fixed" ? (v.validFrom ?? null) : null,
        validUntil: v.periodKind === "fixed" ? (v.validUntil ?? null) : null,
        durationMonths: v.periodKind === "rolling" ? (v.durationMonths ?? null) : null,
        requiresReview: v.requiresReview,
        maxMembers: v.maxMembers ?? null,
        public: v.public,
        position: v.position,
      })
      .returning({ id: schema.membershipPlans.id });
    if (!row) throw new Error("insert failed");
    await saveBenefits(tx, organizationId, row.id, v.benefits);
    await recordAudit(tx, actor, {
      organizationId,
      action: "membership_plan.created",
      targetType: "membership_plan",
      targetId: row.id,
      metadata: { name: v.name, priceMinor: v.priceMinor, periodKind: v.periodKind },
    });
    return loadPlanUnchecked(tx, organizationId, row.id);
  });
}

export async function updateMembershipPlan(
  db: Database,
  actor: Actor,
  organizationId: string,
  planId: string,
  input: MembershipPlanInput,
): Promise<MembershipPlanView> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const v = membershipPlanSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select()
        .from(schema.membershipPlans)
        .where(and(eq(schema.membershipPlans.id, planId), eq(schema.membershipPlans.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError("Formule", planId);
    if (current.status === "archived") throw new PreconditionFailedError("Formule archivée.");
    if (v.slug && v.slug !== current.slug) {
      const taken = await tx
        .select({ id: schema.membershipPlans.id })
        .from(schema.membershipPlans)
        .where(and(eq(schema.membershipPlans.organizationId, organizationId), eq(schema.membershipPlans.slug, v.slug)))
        .limit(1);
      if (taken[0]) throw new ConflictError("Cet identifiant de formule est déjà utilisé.", { field: "slug" });
    }
    await tx
      .update(schema.membershipPlans)
      .set({
        slug: v.slug ?? current.slug,
        name: v.name,
        description: v.description ?? null,
        priceMinor: v.priceMinor,
        periodKind: v.periodKind,
        validFrom: v.periodKind === "fixed" ? (v.validFrom ?? null) : null,
        validUntil: v.periodKind === "fixed" ? (v.validUntil ?? null) : null,
        durationMonths: v.periodKind === "rolling" ? (v.durationMonths ?? null) : null,
        requiresReview: v.requiresReview,
        maxMembers: v.maxMembers ?? null,
        public: v.public,
        position: v.position,
      })
      .where(eq(schema.membershipPlans.id, planId));
    await saveBenefits(tx, organizationId, planId, v.benefits);
    await recordAudit(tx, actor, {
      organizationId,
      action: "membership_plan.updated",
      targetType: "membership_plan",
      targetId: planId,
      metadata: { name: v.name, priceMinor: v.priceMinor },
    });
    return loadPlanUnchecked(tx, organizationId, planId);
  });
}

/** Archive: hidden from the public page; existing memberships keep their validity. */
export async function archiveMembershipPlan(
  db: Database,
  actor: Actor,
  organizationId: string,
  planId: string,
): Promise<void> {
  await requirePermission(db, actor, "memberships.manage", { organizationId });
  const updated = await db
    .update(schema.membershipPlans)
    .set({ status: "archived", public: false })
    .where(and(eq(schema.membershipPlans.id, planId), eq(schema.membershipPlans.organizationId, organizationId)))
    .returning({ id: schema.membershipPlans.id });
  if (updated.length === 0) throw new NotFoundError("Formule", planId);
  await recordAudit(db, actor, {
    organizationId,
    action: "membership_plan.archived",
    targetType: "membership_plan",
    targetId: planId,
  });
}
