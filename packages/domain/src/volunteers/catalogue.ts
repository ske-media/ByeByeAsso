import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { type Actor, ConflictError, NotFoundError, PreconditionFailedError } from "../kernel";
import {
  type PositionInput,
  positionSchema,
  type SkillInput,
  skillSchema,
  type TeamInput,
  teamSchema,
} from "./schemas";

export interface SkillView {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  requiresVerification: boolean;
  status: "active" | "archived";
  /** Positions requiring this skill (any event). */
  positionsCount: number;
}

export interface TeamView {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  status: "active" | "archived";
  positionsCount: number;
}

export interface PositionView {
  id: string;
  organizationId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  slug: string;
  name: string;
  description: string | null;
  instructions: string | null;
  minAge: number | null;
  position: number;
  status: "active" | "archived";
  skills: Array<{ skillId: string; name: string; mandatory: boolean; requiresVerification: boolean }>;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function uniqueSlug(
  tx: DbExecutor,
  table: typeof schema.skills | typeof schema.volunteerTeams | typeof schema.volunteerPositions,
  organizationId: string,
  wanted: string | undefined,
  fallback: string,
  excludeId?: string,
): Promise<string> {
  const base = wanted ?? slugify(fallback);
  let slug = base || "element";
  for (let i = 2; i < 100; i += 1) {
    const taken = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), eq(table.slug, slug)))
      .limit(1);
    if (!taken[0] || taken[0].id === excludeId) return slug;
    if (wanted) throw new ConflictError("Cet identifiant est déjà utilisé.", { field: "slug" });
    slug = `${base}-${i}`;
  }
  throw new ConflictError("Impossible de dériver un identifiant unique.", { field: "slug" });
}

/* ------------------------------------------------------------------------- */
/* Skills                                                                     */
/* ------------------------------------------------------------------------- */

export async function loadSkillsUnchecked(db: DbExecutor, organizationId: string): Promise<SkillView[]> {
  const rows = await db
    .select({
      s: schema.skills,
      positionsCount: sql<number>`(select count(*)::int from ${schema.positionRequiredSkills} r where r.skill_id = "skills"."id")`,
    })
    .from(schema.skills)
    .where(eq(schema.skills.organizationId, organizationId))
    .orderBy(asc(schema.skills.name));
  return rows.map((r) => ({
    id: r.s.id,
    organizationId: r.s.organizationId,
    slug: r.s.slug,
    name: r.s.name,
    description: r.s.description,
    requiresVerification: r.s.requiresVerification,
    status: r.s.status,
    positionsCount: r.positionsCount,
  }));
}

export async function listSkills(db: DbExecutor, actor: Actor, organizationId: string): Promise<SkillView[]> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  return loadSkillsUnchecked(db, organizationId);
}

export async function createSkill(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: SkillInput,
): Promise<SkillView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = skillSchema.parse(input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, schema.skills, organizationId, v.slug, v.name);
    const [row] = await tx
      .insert(schema.skills)
      .values({
        organizationId,
        slug,
        name: v.name,
        description: v.description ?? null,
        requiresVerification: v.requiresVerification,
      })
      .returning({ id: schema.skills.id });
    if (!row) throw new Error("insert failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "skill.created",
      targetType: "skill",
      targetId: row.id,
      metadata: { name: v.name, requiresVerification: v.requiresVerification },
    });
    const skill = (await loadSkillsUnchecked(tx, organizationId)).find((s) => s.id === row.id);
    if (!skill) throw new Error("reload failed");
    return skill;
  });
}

export async function updateSkill(
  db: Database,
  actor: Actor,
  organizationId: string,
  skillId: string,
  input: SkillInput,
): Promise<SkillView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = skillSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.id, skillId), eq(schema.skills.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError("Compétence", skillId);
    const slug = v.slug ? await uniqueSlug(tx, schema.skills, organizationId, v.slug, v.name, skillId) : current.slug;
    await tx
      .update(schema.skills)
      .set({ slug, name: v.name, description: v.description ?? null, requiresVerification: v.requiresVerification })
      .where(eq(schema.skills.id, skillId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "skill.updated",
      targetType: "skill",
      targetId: skillId,
      metadata: { name: v.name },
    });
    const skill = (await loadSkillsUnchecked(tx, organizationId)).find((s) => s.id === skillId);
    if (!skill) throw new Error("reload failed");
    return skill;
  });
}

export async function archiveSkill(db: Database, actor: Actor, organizationId: string, skillId: string): Promise<void> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const updated = await db
    .update(schema.skills)
    .set({ status: "archived" })
    .where(and(eq(schema.skills.id, skillId), eq(schema.skills.organizationId, organizationId)))
    .returning({ id: schema.skills.id });
  if (updated.length === 0) throw new NotFoundError("Compétence", skillId);
  await recordAudit(db, actor, { organizationId, action: "skill.archived", targetType: "skill", targetId: skillId });
}

/* ------------------------------------------------------------------------- */
/* Teams                                                                      */
/* ------------------------------------------------------------------------- */

export async function loadTeamsUnchecked(db: DbExecutor, organizationId: string): Promise<TeamView[]> {
  const rows = await db
    .select({
      t: schema.volunteerTeams,
      positionsCount: sql<number>`(select count(*)::int from ${schema.volunteerPositions} p where p.team_id = "volunteer_teams"."id" and p.status = 'active')`,
    })
    .from(schema.volunteerTeams)
    .where(eq(schema.volunteerTeams.organizationId, organizationId))
    .orderBy(asc(schema.volunteerTeams.position), asc(schema.volunteerTeams.name));
  return rows.map((r) => ({
    id: r.t.id,
    organizationId: r.t.organizationId,
    slug: r.t.slug,
    name: r.t.name,
    description: r.t.description,
    color: r.t.color,
    position: r.t.position,
    status: r.t.status,
    positionsCount: r.positionsCount,
  }));
}

export async function listTeams(db: DbExecutor, actor: Actor, organizationId: string): Promise<TeamView[]> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  return loadTeamsUnchecked(db, organizationId);
}

export async function createTeam(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: TeamInput,
): Promise<TeamView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = teamSchema.parse(input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, schema.volunteerTeams, organizationId, v.slug, v.name);
    const [row] = await tx
      .insert(schema.volunteerTeams)
      .values({
        organizationId,
        slug,
        name: v.name,
        description: v.description ?? null,
        color: v.color,
        position: v.position,
      })
      .returning({ id: schema.volunteerTeams.id });
    if (!row) throw new Error("insert failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_team.created",
      targetType: "volunteer_team",
      targetId: row.id,
      metadata: { name: v.name },
    });
    const team = (await loadTeamsUnchecked(tx, organizationId)).find((t) => t.id === row.id);
    if (!team) throw new Error("reload failed");
    return team;
  });
}

export async function updateTeam(
  db: Database,
  actor: Actor,
  organizationId: string,
  teamId: string,
  input: TeamInput,
): Promise<TeamView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = teamSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select()
        .from(schema.volunteerTeams)
        .where(and(eq(schema.volunteerTeams.id, teamId), eq(schema.volunteerTeams.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError("Équipe", teamId);
    const slug = v.slug
      ? await uniqueSlug(tx, schema.volunteerTeams, organizationId, v.slug, v.name, teamId)
      : current.slug;
    await tx
      .update(schema.volunteerTeams)
      .set({ slug, name: v.name, description: v.description ?? null, color: v.color, position: v.position })
      .where(eq(schema.volunteerTeams.id, teamId));
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_team.updated",
      targetType: "volunteer_team",
      targetId: teamId,
      metadata: { name: v.name },
    });
    const team = (await loadTeamsUnchecked(tx, organizationId)).find((t) => t.id === teamId);
    if (!team) throw new Error("reload failed");
    return team;
  });
}

export async function archiveTeam(db: Database, actor: Actor, organizationId: string, teamId: string): Promise<void> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  await db.transaction(async (tx) => {
    const active = await tx
      .select({ id: schema.volunteerPositions.id })
      .from(schema.volunteerPositions)
      .where(
        and(
          eq(schema.volunteerPositions.organizationId, organizationId),
          eq(schema.volunteerPositions.teamId, teamId),
          eq(schema.volunteerPositions.status, "active"),
        ),
      )
      .limit(1);
    if (active[0])
      throw new PreconditionFailedError("Archivez ou déplacez d'abord les postes de cette équipe.", {
        code: "team_has_positions",
      });
    const updated = await tx
      .update(schema.volunteerTeams)
      .set({ status: "archived" })
      .where(and(eq(schema.volunteerTeams.id, teamId), eq(schema.volunteerTeams.organizationId, organizationId)))
      .returning({ id: schema.volunteerTeams.id });
    if (updated.length === 0) throw new NotFoundError("Équipe", teamId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_team.archived",
      targetType: "volunteer_team",
      targetId: teamId,
    });
  });
}

/* ------------------------------------------------------------------------- */
/* Positions (templates)                                                      */
/* ------------------------------------------------------------------------- */

export async function loadPositionsUnchecked(
  db: DbExecutor,
  organizationId: string,
  positionIds?: string[],
): Promise<PositionView[]> {
  const conditions = [eq(schema.volunteerPositions.organizationId, organizationId)];
  if (positionIds) {
    if (positionIds.length === 0) return [];
    conditions.push(inArray(schema.volunteerPositions.id, positionIds));
  }
  const rows = await db
    .select({ p: schema.volunteerPositions, team: schema.volunteerTeams })
    .from(schema.volunteerPositions)
    .innerJoin(schema.volunteerTeams, eq(schema.volunteerTeams.id, schema.volunteerPositions.teamId))
    .where(and(...conditions))
    .orderBy(
      asc(schema.volunteerTeams.position),
      asc(schema.volunteerTeams.name),
      asc(schema.volunteerPositions.position),
      asc(schema.volunteerPositions.name),
    );
  if (rows.length === 0) return [];
  const req = await db
    .select({ r: schema.positionRequiredSkills, skill: schema.skills })
    .from(schema.positionRequiredSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.positionRequiredSkills.skillId))
    .where(
      inArray(
        schema.positionRequiredSkills.positionId,
        rows.map((r) => r.p.id),
      ),
    )
    .orderBy(asc(schema.skills.name));
  return rows.map((r) => ({
    id: r.p.id,
    organizationId: r.p.organizationId,
    teamId: r.p.teamId,
    teamName: r.team.name,
    teamColor: r.team.color,
    slug: r.p.slug,
    name: r.p.name,
    description: r.p.description,
    instructions: r.p.instructions,
    minAge: r.p.minAge,
    position: r.p.position,
    status: r.p.status,
    skills: req
      .filter((x) => x.r.positionId === r.p.id)
      .map((x) => ({
        skillId: x.skill.id,
        name: x.skill.name,
        mandatory: x.r.mandatory,
        requiresVerification: x.skill.requiresVerification,
      })),
  }));
}

export async function listPositions(db: DbExecutor, actor: Actor, organizationId: string): Promise<PositionView[]> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  return loadPositionsUnchecked(db, organizationId);
}

async function assertSkillsBelong(tx: DbExecutor, organizationId: string, skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return;
  const found = await tx
    .select({ id: schema.skills.id })
    .from(schema.skills)
    .where(and(eq(schema.skills.organizationId, organizationId), inArray(schema.skills.id, skillIds)));
  if (found.length !== new Set(skillIds).size) throw new NotFoundError("Compétence", skillIds.join(","));
}

async function saveRequiredSkills(
  tx: DbExecutor,
  organizationId: string,
  positionId: string,
  skills: Array<{ skillId: string; mandatory: boolean }>,
): Promise<void> {
  await assertSkillsBelong(
    tx,
    organizationId,
    skills.map((s) => s.skillId),
  );
  await tx.delete(schema.positionRequiredSkills).where(eq(schema.positionRequiredSkills.positionId, positionId));
  if (skills.length > 0) {
    const unique = new Map(skills.map((s) => [s.skillId, s.mandatory]));
    await tx
      .insert(schema.positionRequiredSkills)
      .values([...unique].map(([skillId, mandatory]) => ({ organizationId, positionId, skillId, mandatory })));
  }
}

export async function createPosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: PositionInput,
): Promise<PositionView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = positionSchema.parse(input);
  return db.transaction(async (tx) => {
    const team = (
      await tx
        .select({ id: schema.volunteerTeams.id, status: schema.volunteerTeams.status })
        .from(schema.volunteerTeams)
        .where(and(eq(schema.volunteerTeams.id, v.teamId), eq(schema.volunteerTeams.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!team) throw new NotFoundError("Équipe", v.teamId);
    if (team.status !== "active") throw new PreconditionFailedError("Équipe archivée.", { code: "team_archived" });
    const slug = await uniqueSlug(tx, schema.volunteerPositions, organizationId, v.slug, v.name);
    const [row] = await tx
      .insert(schema.volunteerPositions)
      .values({
        organizationId,
        teamId: v.teamId,
        slug,
        name: v.name,
        description: v.description ?? null,
        instructions: v.instructions ?? null,
        minAge: v.minAge ?? null,
        position: v.position,
      })
      .returning({ id: schema.volunteerPositions.id });
    if (!row) throw new Error("insert failed");
    await saveRequiredSkills(tx, organizationId, row.id, v.skills);
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_position.created",
      targetType: "volunteer_position",
      targetId: row.id,
      metadata: { name: v.name, teamId: v.teamId, skills: v.skills.length },
    });
    const position = (await loadPositionsUnchecked(tx, organizationId, [row.id]))[0];
    if (!position) throw new Error("reload failed");
    return position;
  });
}

export async function updatePosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  positionId: string,
  input: PositionInput,
): Promise<PositionView> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const v = positionSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select()
        .from(schema.volunteerPositions)
        .where(
          and(
            eq(schema.volunteerPositions.id, positionId),
            eq(schema.volunteerPositions.organizationId, organizationId),
          ),
        )
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError("Poste", positionId);
    const team = (
      await tx
        .select({ id: schema.volunteerTeams.id })
        .from(schema.volunteerTeams)
        .where(and(eq(schema.volunteerTeams.id, v.teamId), eq(schema.volunteerTeams.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!team) throw new NotFoundError("Équipe", v.teamId);
    const slug = v.slug
      ? await uniqueSlug(tx, schema.volunteerPositions, organizationId, v.slug, v.name, positionId)
      : current.slug;
    await tx
      .update(schema.volunteerPositions)
      .set({
        teamId: v.teamId,
        slug,
        name: v.name,
        description: v.description ?? null,
        instructions: v.instructions ?? null,
        minAge: v.minAge ?? null,
        position: v.position,
      })
      .where(eq(schema.volunteerPositions.id, positionId));
    await saveRequiredSkills(tx, organizationId, positionId, v.skills);
    await recordAudit(tx, actor, {
      organizationId,
      action: "volunteer_position.updated",
      targetType: "volunteer_position",
      targetId: positionId,
      metadata: { name: v.name, skills: v.skills.length },
    });
    const position = (await loadPositionsUnchecked(tx, organizationId, [positionId]))[0];
    if (!position) throw new Error("reload failed");
    return position;
  });
}

export async function archivePosition(
  db: Database,
  actor: Actor,
  organizationId: string,
  positionId: string,
): Promise<void> {
  await requirePermission(db, actor, "volunteers.review", { organizationId });
  const updated = await db
    .update(schema.volunteerPositions)
    .set({ status: "archived" })
    .where(
      and(eq(schema.volunteerPositions.id, positionId), eq(schema.volunteerPositions.organizationId, organizationId)),
    )
    .returning({ id: schema.volunteerPositions.id });
  if (updated.length === 0) throw new NotFoundError("Poste", positionId);
  await recordAudit(db, actor, {
    organizationId,
    action: "volunteer_position.archived",
    targetType: "volunteer_position",
    targetId: positionId,
  });
}
