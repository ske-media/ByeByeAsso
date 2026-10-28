import { randomBytes } from "node:crypto";
import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import type { EmailPort } from "@kroov/notifications";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import { isValidEmail, resolveDefinition, segmentDefinitionSchema, slugify, suppressEmail } from "../crm";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../kernel";
import { emitDomainEvent } from "../outbox";
import { deriveToken, tokensEqual } from "../ticketing/context";
import { extractLinks, isValidEmailAddress, renderCampaign, withSourceParams } from "./render";
import {
  type CampaignInput,
  type CampaignUpdateInput,
  campaignInputSchema,
  campaignUpdateSchema,
  type DeliveryCallback,
  deliveryCallbackSchema,
  listRecipientsSchema,
  type ScheduleInput,
  scheduleSchema,
  type TemplateInput,
  templateInputSchema,
  templateUpdateSchema,
} from "./schemas";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus, campaignStateMachine } from "./state-machine";

export interface MarketingContext {
  readonly email: EmailPort;
  readonly appName: string;
  readonly appUrl: string;
  readonly credentialSecret: string;
  /** Recipients per dispatch batch (one short transaction each). */
  readonly batchSize?: number;
  /** Max send attempts per recipient before `failed`. */
  readonly maxAttempts?: number;
}

export const RECIPIENT_TOKEN_SCOPE = "campaign-recipient";
const DEFAULT_BATCH = 50;
const DEFAULT_ATTEMPTS = 3;

type CampaignRow = typeof schema.campaigns.$inferSelect;
type RecipientRow = typeof schema.campaignRecipients.$inferSelect;

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface CampaignView {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  statusLabel: string;
  subject: string;
  preheader: string | null;
  fromName: string;
  replyTo: string | null;
  body: string;
  segmentId: string | null;
  segmentName: string | null;
  templateId: string | null;
  includeCustomerException: boolean;
  legalNote: string | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  audienceCount: number | null;
  eligibleCount: number | null;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  error: string | null;
  version: number;
  createdAt: Date;
}

export interface AudienceCheck {
  segmentCount: number;
  notConsentedCount: number;
  customerOnlyCount: number;
  suppressedCount: number;
  invalidCount: number;
  duplicateCount: number;
  eligibleCount: number;
  computedAt: Date;
  sample: Array<{ email: string; name: string; status: string }>;
}

export interface CampaignReport {
  recipients: Record<"pending" | "sent" | "failed" | "skipped" | "bounced" | "unsubscribed", number>;
  deliveries: Record<"queued" | "accepted" | "delivered" | "bounced" | "complained" | "failed", number>;
  clicks: { total: number; uniqueRecipients: number };
  unsubscribes: number;
  links: Array<{ id: string; targetUrl: string; clicksCount: number; uniqueClicksCount: number }>;
  attribution: {
    ordersCount: number;
    paidOrdersCount: number;
    confirmedRevenueMinor: number;
    currency: string;
    disclosure: string;
  };
  audiences: Array<{
    stage: string;
    computedAt: Date;
    segmentCount: number;
    notConsentedCount: number;
    suppressedCount: number;
    invalidCount: number;
    duplicateCount: number;
    eligibleCount: number;
  }>;
}

export interface CampaignDetail extends CampaignView {
  report: CampaignReport;
  preview: { subject: string; text: string; html: string };
}

const ATTRIBUTION_DISCLOSURE =
  "Attribution incomplète par construction : seules les commandes passées depuis un lien de cette campagne, dans la même navigation, sont rattachées. Aucune résolution d'identité par adresse e-mail n'est faite ; les achats réalisés autrement (recherche, bouche-à-oreille, lien copié) ne sont pas comptés. Le chiffre d'affaires confirmé ne compte que les commandes payées.";

function toView(c: CampaignRow, segmentName: string | null): CampaignView {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    statusLabel: CAMPAIGN_STATUS_LABELS[c.status],
    subject: c.subject,
    preheader: c.preheader,
    fromName: c.fromName,
    replyTo: c.replyTo,
    body: c.body,
    segmentId: c.segmentId,
    segmentName,
    templateId: c.templateId,
    includeCustomerException: c.includeCustomerException,
    legalNote: c.legalNote,
    scheduledAt: c.scheduledAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    audienceCount: c.audienceCount,
    eligibleCount: c.eligibleCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    skippedCount: c.skippedCount,
    error: c.error,
    version: c.version,
    createdAt: c.createdAt,
  };
}

async function authorize(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  p: "campaigns.manage" | "campaigns.send",
) {
  await requirePermission(db, actor, p, { organizationId });
}

async function loadCampaign(
  db: DbExecutor,
  organizationId: string,
  campaignId: string,
  lock = false,
): Promise<CampaignRow> {
  const q = db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.organizationId, organizationId)))
    .limit(1);
  const rows = lock ? await q.for("update") : await q;
  const c = rows[0];
  if (!c) throw new NotFoundError("campaign", campaignId);
  return c;
}

async function segmentNameOf(db: DbExecutor, organizationId: string, segmentId: string | null): Promise<string | null> {
  if (!segmentId) return null;
  const rows = await db
    .select({ name: schema.segments.name })
    .from(schema.segments)
    .where(and(eq(schema.segments.id, segmentId), eq(schema.segments.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

async function organizationName(db: DbExecutor, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? "";
}

async function uniqueSlug(
  db: DbExecutor,
  table: "campaigns" | "email_templates",
  organizationId: string,
  base: string,
) {
  const root = base || "campagne";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const rows = await db.execute<{ id: string }>(
      table === "campaigns"
        ? sql`select id from campaigns where organization_id = ${organizationId} and slug = ${candidate} limit 1`
        : sql`select id from email_templates where organization_id = ${organizationId} and slug = ${candidate} limit 1`,
    );
    if (rows.rows.length === 0) return candidate;
  }
  throw new ConflictError("Impossible de générer un identifiant unique.");
}

/* ------------------------------------------------------------------------- */
/* templates                                                                  */
/* ------------------------------------------------------------------------- */

export async function listTemplates(db: Database, actor: Actor, organizationId: string) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  return db
    .select()
    .from(schema.emailTemplates)
    .where(and(eq(schema.emailTemplates.organizationId, organizationId), isNull(schema.emailTemplates.archivedAt)))
    .orderBy(asc(schema.emailTemplates.name));
}

export async function createTemplate(db: Database, actor: Actor, organizationId: string, input: TemplateInput) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const v = templateInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const slug = v.slug ?? (await uniqueSlug(tx, "email_templates", organizationId, slugify(v.name)));
    const inserted = await tx
      .insert(schema.emailTemplates)
      .values({
        organizationId,
        name: v.name,
        slug,
        subject: v.subject,
        preheader: v.preheader ?? null,
        body: v.body,
        createdBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("insert failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "email_template.created",
      targetType: "email_template",
      targetId: row.id,
    });
    return row;
  });
}

export async function updateTemplate(
  db: Database,
  actor: Actor,
  organizationId: string,
  templateId: string,
  input: Partial<TemplateInput>,
) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const v = templateUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.id, templateId), eq(schema.emailTemplates.organizationId, organizationId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("email_template", templateId);
    const updated = await tx
      .update(schema.emailTemplates)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.subject !== undefined ? { subject: v.subject } : {}),
        ...(v.preheader !== undefined ? { preheader: v.preheader ?? null } : {}),
        ...(v.body !== undefined ? { body: v.body } : {}),
      })
      .where(eq(schema.emailTemplates.id, templateId))
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "email_template.updated",
      targetType: "email_template",
      targetId: templateId,
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return row;
  });
}

export async function archiveTemplate(db: Database, actor: Actor, organizationId: string, templateId: string) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  return db.transaction(async (tx) => {
    const r = await tx
      .update(schema.emailTemplates)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.emailTemplates.id, templateId), eq(schema.emailTemplates.organizationId, organizationId)))
      .returning({ id: schema.emailTemplates.id });
    if (r.length === 0) throw new NotFoundError("email_template", templateId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "email_template.archived",
      targetType: "email_template",
      targetId: templateId,
    });
  });
}

/* ------------------------------------------------------------------------- */
/* campaigns CRUD                                                             */
/* ------------------------------------------------------------------------- */

export async function listCampaigns(
  db: Database,
  actor: Actor,
  organizationId: string,
  status: "all" | CampaignStatus = "all",
): Promise<CampaignView[]> {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const conditions = [eq(schema.campaigns.organizationId, organizationId)];
  if (status !== "all") conditions.push(eq(schema.campaigns.status, status));
  const rows = await db
    .select({ c: schema.campaigns, segmentName: schema.segments.name })
    .from(schema.campaigns)
    .leftJoin(schema.segments, eq(schema.segments.id, schema.campaigns.segmentId))
    .where(and(...conditions))
    .orderBy(desc(schema.campaigns.createdAt));
  return rows.map(({ c, segmentName }) => toView(c, segmentName));
}

async function assertSegment(db: DbExecutor, organizationId: string, segmentId: string | null | undefined) {
  if (!segmentId) return;
  const rows = await db
    .select({ id: schema.segments.id })
    .from(schema.segments)
    .where(
      and(
        eq(schema.segments.id, segmentId),
        eq(schema.segments.organizationId, organizationId),
        isNull(schema.segments.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new ValidationError({ segmentId: ["Segment inconnu dans cette organisation."] });
}

async function assertTemplate(db: DbExecutor, organizationId: string, templateId: string | null | undefined) {
  if (!templateId) return;
  const rows = await db
    .select({ id: schema.emailTemplates.id })
    .from(schema.emailTemplates)
    .where(and(eq(schema.emailTemplates.id, templateId), eq(schema.emailTemplates.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new ValidationError({ templateId: ["Gabarit inconnu dans cette organisation."] });
}

export async function createCampaign(db: Database, actor: Actor, organizationId: string, input: CampaignInput) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const v = campaignInputSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertSegment(tx, organizationId, v.segmentId);
    await assertTemplate(tx, organizationId, v.templateId);
    const slug = v.slug ?? (await uniqueSlug(tx, "campaigns", organizationId, slugify(v.name)));
    const inserted = await tx
      .insert(schema.campaigns)
      .values({
        organizationId,
        name: v.name,
        slug,
        subject: v.subject,
        preheader: v.preheader ?? null,
        fromName: v.fromName,
        replyTo: v.replyTo ?? null,
        body: v.body,
        segmentId: v.segmentId ?? null,
        templateId: v.templateId ?? null,
        createdBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("insert failed");
    await recordAudit(tx, actor, {
      organizationId,
      action: "campaign.created",
      targetType: "campaign",
      targetId: row.id,
      metadata: { name: v.name },
    });
    return toView(row, await segmentNameOf(tx, organizationId, row.segmentId));
  });
}

export async function updateCampaign(
  db: Database,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  input: CampaignUpdateInput,
) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const v = campaignUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadCampaign(tx, organizationId, campaignId, true);
    if (c.status !== "draft")
      throw new PreconditionFailedError("Seul un brouillon est modifiable (déprogrammez d'abord).", {
        code: "campaign_locked",
      });
    if (v.version !== undefined && v.version !== c.version)
      throw new ConflictError("La campagne a été modifiée entre-temps ; rechargez.", { code: "stale_version" });
    if (v.segmentId !== undefined) await assertSegment(tx, organizationId, v.segmentId);
    if (v.templateId !== undefined) await assertTemplate(tx, organizationId, v.templateId);
    const updated = await tx
      .update(schema.campaigns)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.subject !== undefined ? { subject: v.subject } : {}),
        ...(v.preheader !== undefined ? { preheader: v.preheader ?? null } : {}),
        ...(v.fromName !== undefined ? { fromName: v.fromName } : {}),
        ...(v.replyTo !== undefined ? { replyTo: v.replyTo ?? null } : {}),
        ...(v.body !== undefined ? { body: v.body } : {}),
        ...(v.segmentId !== undefined ? { segmentId: v.segmentId ?? null } : {}),
        ...(v.templateId !== undefined ? { templateId: v.templateId ?? null } : {}),
        version: c.version + 1,
      })
      .where(eq(schema.campaigns.id, c.id))
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "campaign.updated",
      targetType: "campaign",
      targetId: c.id,
      metadata: { fields: Object.keys(v).filter((k) => k !== "version") },
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return toView(row, await segmentNameOf(tx, organizationId, row.segmentId));
  });
}

/* ------------------------------------------------------------------------- */
/* rendering, preview, test                                                   */
/* ------------------------------------------------------------------------- */

export function recipientRef(secret: string, recipientId: string): string {
  return `${recipientId}.${deriveToken(secret, RECIPIENT_TOKEN_SCOPE, recipientId, 1)}`;
}

export function parseRecipientRef(secret: string, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const dot = ref.indexOf(".");
  if (dot <= 0) return null;
  const id = ref.slice(0, dot);
  const token = ref.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/.test(id) || token.length < 20) return null;
  return tokensEqual(deriveToken(secret, RECIPIENT_TOKEN_SCOPE, id, 1), token) ? id : null;
}

function renderFor(
  ctx: MarketingContext,
  c: CampaignRow,
  orgName: string,
  recipient: { id: string | null; email: string; firstName: string | null; lastName: string | null },
  links: Map<string, string>,
) {
  const ref = recipient.id ? recipientRef(ctx.credentialSecret, recipient.id) : "test";
  const rewriteUrl = (url: string) => {
    const token = links.get(url);
    if (!token) return withSourceParams(url, { utm_source: "kroov", utm_medium: "email", utm_campaign: c.slug });
    return `${ctx.appUrl}/l/${token}${recipient.id ? `?r=${encodeURIComponent(ref)}` : ""}`;
  };
  return renderCampaign({
    subject: c.subject,
    preheader: c.preheader,
    body: c.body,
    organizationName: orgName,
    unsubscribeUrl: `${ctx.appUrl}/desinscription/${ref}`,
    rewriteUrl,
    vars: {
      prenom: recipient.firstName ?? "",
      nom: recipient.lastName ?? "",
      email: recipient.email,
      organisation: orgName,
    },
  });
}

export async function previewCampaign(
  db: Database,
  ctx: MarketingContext,
  actor: Actor,
  organizationId: string,
  campaignId: string,
) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const c = await loadCampaign(db, organizationId, campaignId);
  const orgName = await organizationName(db, organizationId);
  return renderFor(
    ctx,
    c,
    orgName,
    { id: null, email: "prenom.nom@exemple.fr", firstName: "Prénom", lastName: "Nom" },
    new Map(),
  );
}

/** Test e-mail to the signed-in user: transactional path, never touches recipients. */
export async function sendTestEmail(
  db: Database,
  ctx: MarketingContext,
  actor: Actor,
  organizationId: string,
  campaignId: string,
) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  if (actor.kind !== "user") throw new ForbiddenError("campaigns.manage");
  const c = await loadCampaign(db, organizationId, campaignId);
  if (!c.subject.trim() || !c.body.trim())
    throw new PreconditionFailedError("Renseignez l'objet et le corps avant d'envoyer un test.");
  const user = (
    await db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, actor.userId))
      .limit(1)
  )[0];
  if (!user) throw new NotFoundError("user", actor.userId);
  const orgName = await organizationName(db, organizationId);
  const [firstName, ...rest] = user.name.split(" ");
  const rendered = renderFor(
    ctx,
    c,
    orgName,
    { id: null, email: user.email, firstName: firstName ?? "", lastName: rest.join(" ") },
    new Map(),
  );
  const delivery = (
    await db
      .insert(schema.messageDeliveries)
      .values({
        organizationId,
        kind: "test",
        campaignId: c.id,
        toEmail: user.email,
        subject: rendered.subject,
        provider: ctx.email.name,
      })
      .returning()
  )[0];
  if (!delivery) throw new Error("insert failed");
  try {
    const r = await ctx.email.send({
      to: user.email,
      subject: `[TEST] ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
      ...(c.replyTo ? { replyTo: c.replyTo } : {}),
      deliveryId: delivery.id,
    });
    await db
      .update(schema.messageDeliveries)
      .set({ status: "accepted", providerMessageId: r.providerMessageId, acceptedAt: r.acceptedAt })
      .where(eq(schema.messageDeliveries.id, delivery.id));
  } catch (error) {
    await db
      .update(schema.messageDeliveries)
      .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .where(eq(schema.messageDeliveries.id, delivery.id));
    throw new PreconditionFailedError("L'envoi du test a échoué chez le fournisseur.", { code: "provider_failed" });
  }
  await recordAudit(db, actor, {
    organizationId,
    action: "campaign.test_sent",
    targetType: "campaign",
    targetId: c.id,
    metadata: { to: user.email },
  });
  return { to: user.email };
}

/* ------------------------------------------------------------------------- */
/* audience                                                                   */
/* ------------------------------------------------------------------------- */

interface AudienceMember {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  eligible: boolean;
  reason: "not_consented" | "customer_only" | "suppressed" | "invalid_email" | "duplicate" | null;
}

/** Eligibility computed NOW from the sources of truth — never from a previous snapshot. */
async function computeAudience(
  db: DbExecutor,
  organizationId: string,
  c: CampaignRow,
  includeCustomerException: boolean,
): Promise<{ members: AudienceMember[]; check: AudienceCheck; definition: unknown }> {
  let definition: unknown = { match: "all", rules: [] };
  let ids: string[] = [];
  if (c.segmentId) {
    const seg = (
      await db
        .select()
        .from(schema.segments)
        .where(and(eq(schema.segments.id, c.segmentId), eq(schema.segments.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!seg)
      throw new PreconditionFailedError("Le segment de la campagne n'existe plus.", { code: "segment_missing" });
    definition = seg.definition;
    if (seg.kind === "static") {
      const rows = await db
        .select({ id: schema.segmentMembers.contactId })
        .from(schema.segmentMembers)
        .where(eq(schema.segmentMembers.segmentId, seg.id));
      ids = rows.map((r) => r.id);
    } else {
      ids = await resolveDefinition(db, organizationId, segmentDefinitionSchema.parse(seg.definition ?? {}));
    }
  } else {
    ids = await resolveDefinition(db, organizationId, { match: "all", rules: [] });
  }
  const contacts = ids.length
    ? await db
        .select()
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.organizationId, organizationId),
            inArray(schema.contacts.id, ids),
            eq(schema.contacts.status, "active"),
          ),
        )
        .orderBy(asc(schema.contacts.primaryEmail))
    : [];
  const suppressed = new Set(
    (
      await db
        .select({ email: schema.contactSuppressions.email })
        .from(schema.contactSuppressions)
        .where(
          and(
            eq(schema.contactSuppressions.organizationId, organizationId),
            isNull(schema.contactSuppressions.liftedAt),
          ),
        )
    ).map((r) => r.email),
  );
  const seen = new Set<string>();
  const members: AudienceMember[] = [];
  const counts = {
    segmentCount: contacts.length,
    notConsentedCount: 0,
    customerOnlyCount: 0,
    suppressedCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    eligibleCount: 0,
  };
  for (const ct of contacts) {
    const email = ct.primaryEmail;
    let reason: AudienceMember["reason"] = null;
    if (!isValidEmail(email) || !isValidEmailAddress(email)) reason = "invalid_email";
    else if (suppressed.has(email) || ct.marketingEmailStatus === "suppressed") reason = "suppressed";
    else if (ct.marketingEmailStatus === "customer_only" && !includeCustomerException) reason = "customer_only";
    else if (ct.marketingEmailStatus !== "opted_in" && ct.marketingEmailStatus !== "customer_only")
      reason = "not_consented";
    else if (seen.has(email)) reason = "duplicate";
    if (!reason) seen.add(email);
    if (reason === "not_consented") counts.notConsentedCount += 1;
    else if (reason === "customer_only") counts.customerOnlyCount += 1;
    else if (reason === "suppressed") counts.suppressedCount += 1;
    else if (reason === "invalid_email") counts.invalidCount += 1;
    else if (reason === "duplicate") counts.duplicateCount += 1;
    else counts.eligibleCount += 1;
    members.push({
      contactId: ct.id,
      email,
      firstName: ct.firstName,
      lastName: ct.lastName,
      eligible: !reason,
      reason,
    });
  }
  const eligibleSample = members.filter((m) => m.eligible).slice(0, 8);
  return {
    members,
    definition,
    check: {
      ...counts,
      computedAt: new Date(),
      sample: eligibleSample.map((m) => ({
        email: m.email,
        name: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email,
        status: "eligible",
      })),
    },
  };
}

async function storeAudience(
  tx: DbExecutor,
  organizationId: string,
  c: CampaignRow,
  stage: "check" | "schedule" | "dispatch",
  a: Awaited<ReturnType<typeof computeAudience>>,
) {
  await tx.insert(schema.campaignAudiences).values({
    organizationId,
    campaignId: c.id,
    segmentId: c.segmentId,
    definition: a.definition ?? {},
    stage,
    segmentCount: a.check.segmentCount,
    notConsentedCount: a.check.notConsentedCount + a.check.customerOnlyCount,
    suppressedCount: a.check.suppressedCount,
    invalidCount: a.check.invalidCount,
    duplicateCount: a.check.duplicateCount,
    eligibleCount: a.check.eligibleCount,
  });
}

/** Écran 21 — recount the audience now, with the reasons of every exclusion. */
export async function checkAudience(
  db: Database,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  includeCustomerException?: boolean,
): Promise<AudienceCheck> {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const c = await loadCampaign(db, organizationId, campaignId);
  const a = await computeAudience(db, organizationId, c, includeCustomerException ?? c.includeCustomerException);
  await db.transaction((tx) => storeAudience(tx, organizationId, c, "check", a));
  return a.check;
}

/* ------------------------------------------------------------------------- */
/* schedule / unschedule / cancel                                             */
/* ------------------------------------------------------------------------- */

function transition(
  tx: DbExecutor,
  actor: Actor,
  c: CampaignRow,
  to: CampaignStatus,
  extra: Partial<CampaignRow> = {},
  now = new Date(),
) {
  campaignStateMachine.transition(c.status, to, { actor: actor.kind, now });
  return tx
    .update(schema.campaigns)
    .set({ status: to, version: c.version + 1, ...extra })
    .where(eq(schema.campaigns.id, c.id))
    .returning();
}

/** Human decision: send now (next worker tick) or at a given time. Audience snapshot taken here; eligibility re-validated at dispatch. */
export async function scheduleCampaign(
  db: Database,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  input: ScheduleInput,
  now = new Date(),
) {
  await authorize(db, actor, organizationId, "campaigns.send");
  const v = scheduleSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadCampaign(tx, organizationId, campaignId, true);
    if (c.status !== "draft")
      throw new PreconditionFailedError(
        `Campagne ${CAMPAIGN_STATUS_LABELS[c.status].toLowerCase()} : seule un brouillon se programme.`,
        { code: "campaign_locked" },
      );
    if (v.version !== undefined && v.version !== c.version)
      throw new ConflictError("La campagne a été modifiée entre-temps ; rechargez la vérification.", {
        code: "stale_version",
      });
    const fieldErrors: Record<string, string[]> = {};
    if (!c.subject.trim()) fieldErrors.subject = ["L'objet est obligatoire."];
    if (!c.body.trim()) fieldErrors.body = ["Le corps est obligatoire."];
    if (!c.fromName.trim()) fieldErrors.fromName = ["Le nom d'expéditeur est obligatoire."];
    if (!c.segmentId) fieldErrors.segmentId = ["Choisissez une audience (segment)."];
    if (v.includeCustomerException && !v.legalNote)
      fieldErrors.legalNote = ["Justifiez l'inclusion de l'exception client (offre analogue, droit d'opposition)."];
    if (v.sendAt && v.sendAt.getTime() < now.getTime() - 60_000) fieldErrors.sendAt = ["La date d'envoi est passée."];
    if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);
    const a = await computeAudience(tx, organizationId, c, v.includeCustomerException);
    if (a.check.eligibleCount === 0)
      throw new PreconditionFailedError("Aucun destinataire éligible : personne n'est consenti dans cette audience.", {
        code: "no_recipients",
        check: a.check,
      });
    await storeAudience(tx, organizationId, c, "schedule", a);
    const scheduledAt = v.sendAt ?? now;
    const updated = await transition(
      tx,
      actor,
      c,
      "scheduled",
      {
        scheduledAt,
        includeCustomerException: v.includeCustomerException,
        legalNote: v.legalNote ?? null,
        audienceCount: a.check.segmentCount,
        eligibleCount: a.check.eligibleCount,
        scheduledBy: actor.kind === "user" ? actor.userId : null,
        error: null,
      },
      now,
    );
    await recordAudit(tx, actor, {
      organizationId,
      action: "campaign.scheduled",
      targetType: "campaign",
      targetId: c.id,
      reason: v.legalNote ?? null,
      metadata: {
        sendAt: scheduledAt,
        eligible: a.check.eligibleCount,
        segment: a.check.segmentCount,
        includeCustomerException: v.includeCustomerException,
      },
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return { campaign: toView(row, await segmentNameOf(tx, organizationId, row.segmentId)), check: a.check };
  });
}

export async function unscheduleCampaign(db: Database, actor: Actor, organizationId: string, campaignId: string) {
  await authorize(db, actor, organizationId, "campaigns.send");
  return db.transaction(async (tx) => {
    const c = await loadCampaign(tx, organizationId, campaignId, true);
    if (c.status !== "scheduled")
      throw new PreconditionFailedError("Seule une campagne programmée (non lancée) se déprogramme.", {
        code: "campaign_locked",
      });
    const updated = await transition(tx, actor, c, "draft", {
      scheduledAt: null,
      audienceCount: null,
      eligibleCount: null,
    });
    await recordAudit(tx, actor, {
      organizationId,
      action: "campaign.unscheduled",
      targetType: "campaign",
      targetId: c.id,
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return toView(row, await segmentNameOf(tx, organizationId, row.segmentId));
  });
}

export async function cancelCampaign(
  db: Database,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  reason?: string,
) {
  await authorize(db, actor, organizationId, "campaigns.send");
  return db.transaction(async (tx) => {
    const c = await loadCampaign(tx, organizationId, campaignId, true);
    if (!campaignStateMachine.canTransition(c.status, "cancelled"))
      throw new PreconditionFailedError("Une campagne lancée ne peut plus être annulée.", { code: "campaign_locked" });
    const updated = await transition(tx, actor, c, "cancelled", { scheduledAt: null });
    await recordAudit(tx, actor, {
      organizationId,
      action: "campaign.cancelled",
      targetType: "campaign",
      targetId: c.id,
      reason: reason ?? null,
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return toView(row, await segmentNameOf(tx, organizationId, row.segmentId));
  });
}

/* ------------------------------------------------------------------------- */
/* dispatch (worker)                                                          */
/* ------------------------------------------------------------------------- */

function linkToken(): string {
  return randomBytes(18).toString("base64url");
}

async function ensureTrackingLinks(
  tx: DbExecutor,
  organizationId: string,
  c: CampaignRow,
): Promise<Map<string, string>> {
  const urls = extractLinks(c.body);
  for (const url of urls) {
    await tx
      .insert(schema.trackingLinks)
      .values({ organizationId, campaignId: c.id, token: linkToken(), targetUrl: url })
      .onConflictDoNothing();
  }
  const rows = await tx
    .select({ token: schema.trackingLinks.token, targetUrl: schema.trackingLinks.targetUrl })
    .from(schema.trackingLinks)
    .where(eq(schema.trackingLinks.campaignId, c.id));
  return new Map(rows.map((r) => [r.targetUrl, r.token]));
}

/** Claim due campaigns (scheduled & due, or `sending` left over by a crash) and run them. Returns the number processed. */
export async function dispatchDueCampaigns(
  db: Database,
  ctx: MarketingContext,
  actor: Actor,
  now = new Date(),
): Promise<number> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const due = await db
    .select({ id: schema.campaigns.id, organizationId: schema.campaigns.organizationId })
    .from(schema.campaigns)
    .where(
      sql`(${schema.campaigns.status} = 'scheduled' and ${schema.campaigns.scheduledAt} <= ${now}) or ${schema.campaigns.status} = 'sending'`,
    )
    .orderBy(asc(schema.campaigns.scheduledAt));
  let processed = 0;
  for (const d of due) {
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; status: string }>(
        sql`select id, status from campaigns where id = ${d.id} and (status = 'scheduled' or status = 'sending') for update skip locked`,
      );
      const row = rows.rows[0];
      if (!row) return false;
      if (row.status === "scheduled") {
        const c = await loadCampaign(tx, d.organizationId, d.id);
        await transition(tx, actor, c, "sending", { startedAt: now }, now);
        await recordAudit(tx, actor, {
          organizationId: d.organizationId,
          action: "campaign.started",
          targetType: "campaign",
          targetId: d.id,
        });
      }
      return true;
    });
    if (!claimed) continue;
    await runCampaign(db, ctx, actor, d.organizationId, d.id, now);
    processed += 1;
  }
  return processed;
}

/** Idempotent: recipients are created once (unique per e-mail), `sent` rows are never re-sent, pending ones resume. */
export async function runCampaign(
  db: Database,
  ctx: MarketingContext,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  now = new Date(),
): Promise<CampaignView> {
  if (actor.kind !== "system") throw new ForbiddenError("system");
  const batchSize = ctx.batchSize ?? DEFAULT_BATCH;
  const maxAttempts = ctx.maxAttempts ?? DEFAULT_ATTEMPTS;
  const orgName = await organizationName(db, organizationId);

  // 1. Audience at dispatch time (only once per campaign).
  const { c, links } = await db.transaction(async (tx) => {
    const c = await loadCampaign(tx, organizationId, campaignId, true);
    if (c.status !== "sending") throw new PreconditionFailedError("Campagne non lancée.", { code: "campaign_locked" });
    const existing = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.campaignAudiences)
      .where(and(eq(schema.campaignAudiences.campaignId, c.id), eq(schema.campaignAudiences.stage, "dispatch")));
    if ((existing[0]?.n ?? 0) === 0) {
      const a = await computeAudience(tx, organizationId, c, c.includeCustomerException);
      await storeAudience(tx, organizationId, c, "dispatch", a);
      for (let i = 0; i < a.members.length; i += 500) {
        const slice = a.members.slice(i, i + 500);
        if (slice.length === 0) break;
        await tx
          .insert(schema.campaignRecipients)
          .values(
            slice.map((m) => ({
              organizationId,
              campaignId: c.id,
              contactId: m.contactId,
              email: m.email,
              firstName: m.firstName,
              lastName: m.lastName,
              status: m.eligible ? ("pending" as const) : ("skipped" as const),
              skipReason: m.reason,
            })),
          )
          .onConflictDoNothing();
      }
      await tx
        .update(schema.campaigns)
        .set({ audienceCount: a.check.segmentCount, eligibleCount: a.check.eligibleCount })
        .where(eq(schema.campaigns.id, c.id));
    }
    const links = await ensureTrackingLinks(tx, organizationId, c);
    return { c, links };
  });

  // 2. Batches.
  for (;;) {
    const done = await db.transaction(async (tx) => {
      const batch = await tx.execute<RecipientRow & { first_name: string | null; last_name: string | null }>(
        sql`select * from campaign_recipients where campaign_id = ${c.id} and status = 'pending' and attempts < ${maxAttempts}
            order by created_at limit ${batchSize} for update skip locked`,
      );
      if (batch.rows.length === 0) return true;
      for (const raw of batch.rows) {
        const r = {
          id: raw.id,
          email: raw.email,
          firstName: raw.first_name,
          lastName: raw.last_name,
          attempts: raw.attempts,
        };
        const rendered = renderFor(
          ctx,
          c,
          orgName,
          { id: r.id, email: r.email, firstName: r.firstName, lastName: r.lastName },
          links,
        );
        const delivery = (
          await tx
            .insert(schema.messageDeliveries)
            .values({
              organizationId,
              kind: "campaign",
              campaignId: c.id,
              recipientId: r.id,
              toEmail: r.email,
              subject: rendered.subject,
              provider: ctx.email.name,
            })
            .returning()
        )[0];
        if (!delivery) throw new Error("insert failed");
        try {
          const sent = await ctx.email.send({
            to: r.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
            ...(c.replyTo ? { replyTo: c.replyTo } : {}),
            listUnsubscribeUrl: `${ctx.appUrl}/api/v1/public/unsubscribe/${recipientRef(ctx.credentialSecret, r.id)}`,
            deliveryId: delivery.id,
          });
          await tx
            .update(schema.messageDeliveries)
            .set({ status: "accepted", providerMessageId: sent.providerMessageId, acceptedAt: sent.acceptedAt })
            .where(eq(schema.messageDeliveries.id, delivery.id));
          await tx
            .update(schema.campaignRecipients)
            .set({
              status: "sent",
              sentAt: sent.acceptedAt,
              deliveryId: delivery.id,
              attempts: r.attempts + 1,
              lastError: null,
            })
            .where(eq(schema.campaignRecipients.id, r.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const attempts = r.attempts + 1;
          await tx
            .update(schema.messageDeliveries)
            .set({ status: "failed", error: message })
            .where(eq(schema.messageDeliveries.id, delivery.id));
          await tx
            .update(schema.campaignRecipients)
            .set({ attempts, lastError: message, ...(attempts >= maxAttempts ? { status: "failed" as const } : {}) })
            .where(eq(schema.campaignRecipients.id, r.id));
        }
      }
      return false;
    });
    if (done) break;
  }

  // 3. Close.
  return db.transaction(async (tx) => {
    const fresh = await loadCampaign(tx, organizationId, campaignId, true);
    const counts = await tx
      .select({ status: schema.campaignRecipients.status, n: sql<number>`count(*)::int` })
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.campaignId, c.id))
      .groupBy(schema.campaignRecipients.status);
    const n = (s: RecipientRow["status"]) => counts.find((x) => x.status === s)?.n ?? 0;
    const sent = n("sent");
    const failed = n("failed");
    const skipped = n("skipped");
    const to: CampaignStatus = sent === 0 ? "failed" : failed > 0 ? "partially_failed" : "sent";
    const updated = await transition(tx, actor, fresh, to, {
      sentCount: sent,
      failedCount: failed,
      skippedCount: skipped,
      finishedAt: now,
      error: sent === 0 ? "Aucun message n'a pu être envoyé." : null,
    });
    await recordAudit(tx, actor, {
      organizationId,
      action: `campaign.${to}`,
      targetType: "campaign",
      targetId: c.id,
      metadata: { sent, failed, skipped },
    });
    await emitDomainEvent(tx, {
      aggregateType: "campaign",
      aggregateId: c.id,
      eventType: "campaign.finished",
      organizationId,
      payload: { status: to, sent, failed, skipped },
    });
    const row = updated[0];
    if (!row) throw new Error("update failed");
    return toView(row, await segmentNameOf(tx, organizationId, row.segmentId));
  });
}

/* ------------------------------------------------------------------------- */
/* recipients, report, detail                                                 */
/* ------------------------------------------------------------------------- */

export async function listRecipients(
  db: Database,
  actor: Actor,
  organizationId: string,
  campaignId: string,
  input: { status?: string; page?: number; pageSize?: number } = {},
) {
  await authorize(db, actor, organizationId, "campaigns.manage");
  await loadCampaign(db, organizationId, campaignId);
  const f = listRecipientsSchema.parse(input);
  const conditions = [eq(schema.campaignRecipients.campaignId, campaignId)];
  if (f.status !== "all") conditions.push(eq(schema.campaignRecipients.status, f.status));
  const rows = await db
    .select()
    .from(schema.campaignRecipients)
    .where(and(...conditions))
    .orderBy(asc(schema.campaignRecipients.email))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const total = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.campaignRecipients)
    .where(and(...conditions));
  return {
    recipients: rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      email: r.email,
      name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
      status: r.status,
      skipReason: r.skipReason,
      attempts: r.attempts,
      lastError: r.lastError,
      sentAt: r.sentAt,
      clicksCount: r.clicksCount,
    })),
    total: total[0]?.n ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  };
}

async function buildReport(db: DbExecutor, organizationId: string, c: CampaignRow): Promise<CampaignReport> {
  const rec = await db
    .select({ status: schema.campaignRecipients.status, n: sql<number>`count(*)::int` })
    .from(schema.campaignRecipients)
    .where(eq(schema.campaignRecipients.campaignId, c.id))
    .groupBy(schema.campaignRecipients.status);
  const del = await db
    .select({ status: schema.messageDeliveries.status, n: sql<number>`count(*)::int` })
    .from(schema.messageDeliveries)
    .where(and(eq(schema.messageDeliveries.campaignId, c.id), eq(schema.messageDeliveries.kind, "campaign")))
    .groupBy(schema.messageDeliveries.status);
  const clicks = await db
    .select({ total: sql<number>`count(*)::int`, uniq: sql<number>`count(distinct recipient_id)::int` })
    .from(schema.trackingEvents)
    .where(and(eq(schema.trackingEvents.campaignId, c.id), eq(schema.trackingEvents.kind, "click")));
  const unsub = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.trackingEvents)
    .where(and(eq(schema.trackingEvents.campaignId, c.id), eq(schema.trackingEvents.kind, "unsubscribe")));
  const links = await db
    .select()
    .from(schema.trackingLinks)
    .where(eq(schema.trackingLinks.campaignId, c.id))
    .orderBy(desc(schema.trackingLinks.clicksCount));
  const orders = await db
    .select({
      total: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where status in ('paid','partially_refunded'))::int`,
      revenue: sql<number>`coalesce(sum(total_minor) filter (where status in ('paid','partially_refunded')), 0)::int`,
      currency: sql<string>`coalesce(min(currency), 'EUR')`,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.campaignId, c.id)));
  const audiences = await db
    .select()
    .from(schema.campaignAudiences)
    .where(eq(schema.campaignAudiences.campaignId, c.id))
    .orderBy(desc(schema.campaignAudiences.computedAt))
    .limit(5);
  const r = (s: RecipientRow["status"]) => rec.find((x) => x.status === s)?.n ?? 0;
  const d = (s: typeof schema.messageDeliveries.$inferSelect.status) => del.find((x) => x.status === s)?.n ?? 0;
  return {
    recipients: {
      pending: r("pending"),
      sent: r("sent"),
      failed: r("failed"),
      skipped: r("skipped"),
      bounced: r("bounced"),
      unsubscribed: r("unsubscribed"),
    },
    deliveries: {
      queued: d("queued"),
      accepted: d("accepted"),
      delivered: d("delivered"),
      bounced: d("bounced"),
      complained: d("complained"),
      failed: d("failed"),
    },
    clicks: { total: clicks[0]?.total ?? 0, uniqueRecipients: clicks[0]?.uniq ?? 0 },
    unsubscribes: unsub[0]?.n ?? 0,
    links: links.map((l) => ({
      id: l.id,
      targetUrl: l.targetUrl,
      clicksCount: l.clicksCount,
      uniqueClicksCount: l.uniqueClicksCount,
    })),
    attribution: {
      ordersCount: orders[0]?.total ?? 0,
      paidOrdersCount: orders[0]?.paid ?? 0,
      confirmedRevenueMinor: orders[0]?.revenue ?? 0,
      currency: orders[0]?.currency ?? "EUR",
      disclosure: ATTRIBUTION_DISCLOSURE,
    },
    audiences: audiences.map((a) => ({
      stage: a.stage,
      computedAt: a.computedAt,
      segmentCount: a.segmentCount,
      notConsentedCount: a.notConsentedCount,
      suppressedCount: a.suppressedCount,
      invalidCount: a.invalidCount,
      duplicateCount: a.duplicateCount,
      eligibleCount: a.eligibleCount,
    })),
  };
}

export async function getCampaign(
  db: Database,
  ctx: MarketingContext,
  actor: Actor,
  organizationId: string,
  campaignId: string,
): Promise<CampaignDetail> {
  await authorize(db, actor, organizationId, "campaigns.manage");
  const c = await loadCampaign(db, organizationId, campaignId);
  const orgName = await organizationName(db, organizationId);
  return {
    ...toView(c, await segmentNameOf(db, organizationId, c.segmentId)),
    report: await buildReport(db, organizationId, c),
    preview: renderFor(
      ctx,
      c,
      orgName,
      { id: null, email: "prenom.nom@exemple.fr", firstName: "Prénom", lastName: "Nom" },
      new Map(),
    ),
  };
}

/* ------------------------------------------------------------------------- */
/* tracking, unsubscribe, attribution, callbacks (public / system)            */
/* ------------------------------------------------------------------------- */

/** Resolve a tracked link click: record the event (no IP), return the redirect target with source params + attribution. */
export async function trackClick(
  db: Database,
  ctx: MarketingContext,
  token: string,
  ref: string | null,
  userAgent: string | null,
): Promise<{ redirectUrl: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = (await db.select().from(schema.trackingLinks).where(eq(schema.trackingLinks.token, token)).limit(1))[0];
  if (!link) return null;
  const c = (await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, link.campaignId)).limit(1))[0];
  if (!c) return null;
  const recipientId = parseRecipientRef(ctx.credentialSecret, ref);
  const recipient = recipientId
    ? (
        await db
          .select({ id: schema.campaignRecipients.id, campaignId: schema.campaignRecipients.campaignId })
          .from(schema.campaignRecipients)
          .where(eq(schema.campaignRecipients.id, recipientId))
          .limit(1)
      )[0]
    : undefined;
  const validRecipient = recipient && recipient.campaignId === c.id ? recipient.id : null;
  await db.transaction(async (tx) => {
    const first = validRecipient
      ? (
          await tx
            .select({ id: schema.trackingEvents.id })
            .from(schema.trackingEvents)
            .where(
              and(
                eq(schema.trackingEvents.linkId, link.id),
                eq(schema.trackingEvents.recipientId, validRecipient),
                eq(schema.trackingEvents.kind, "click"),
              ),
            )
            .limit(1)
        ).length === 0
      : false;
    await tx.insert(schema.trackingEvents).values({
      organizationId: link.organizationId,
      campaignId: c.id,
      linkId: link.id,
      recipientId: validRecipient,
      kind: "click",
      userAgent: userAgent ? userAgent.slice(0, 200) : null,
    });
    await tx
      .update(schema.trackingLinks)
      .set({
        clicksCount: sql`${schema.trackingLinks.clicksCount} + 1`,
        ...(first ? { uniqueClicksCount: sql`${schema.trackingLinks.uniqueClicksCount} + 1` } : {}),
      })
      .where(eq(schema.trackingLinks.id, link.id));
    if (validRecipient)
      await tx
        .update(schema.campaignRecipients)
        .set({ clicksCount: sql`${schema.campaignRecipients.clicksCount} + 1` })
        .where(eq(schema.campaignRecipients.id, validRecipient));
  });
  const kc = `${link.token}.${validRecipient ? recipientRef(ctx.credentialSecret, validRecipient) : ""}`;
  return {
    redirectUrl: withSourceParams(link.targetUrl, {
      utm_source: "kroov",
      utm_medium: "email",
      utm_campaign: c.slug,
      kc,
    }),
  };
}

export interface Attribution {
  organizationId: string;
  campaignId: string;
  trackingLinkId: string;
  campaignRecipientId: string | null;
}

/** Validate a `kc` parameter carried through checkout. Link-level evidence; recipient only with a valid token. */
export async function resolveAttribution(
  db: DbExecutor,
  ctx: Pick<MarketingContext, "credentialSecret">,
  kc: string | null | undefined,
): Promise<Attribution | null> {
  if (!kc) return null;
  const dot = kc.indexOf(".");
  const token = dot === -1 ? kc : kc.slice(0, dot);
  const ref = dot === -1 ? "" : kc.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = (await db.select().from(schema.trackingLinks).where(eq(schema.trackingLinks.token, token)).limit(1))[0];
  if (!link) return null;
  const recipientId = parseRecipientRef(ctx.credentialSecret, ref || null);
  const recipient = recipientId
    ? (
        await db
          .select({ id: schema.campaignRecipients.id, campaignId: schema.campaignRecipients.campaignId })
          .from(schema.campaignRecipients)
          .where(eq(schema.campaignRecipients.id, recipientId))
          .limit(1)
      )[0]
    : undefined;
  return {
    organizationId: link.organizationId,
    campaignId: link.campaignId,
    trackingLinkId: link.id,
    campaignRecipientId: recipient && recipient.campaignId === link.campaignId ? recipient.id : null,
  };
}

export interface UnsubscribeInfo {
  recipientId: string;
  organizationName: string;
  campaignName: string;
  email: string;
  alreadyUnsubscribed: boolean;
}

/** Public page data. 404 (null) for any invalid or forged reference; `test` refs render a non-functional notice. */
export async function unsubscribeInfo(
  db: Database,
  ctx: MarketingContext,
  ref: string,
): Promise<UnsubscribeInfo | null> {
  const id = parseRecipientRef(ctx.credentialSecret, ref);
  if (!id) return null;
  const rows = await db
    .select({
      r: schema.campaignRecipients,
      campaignName: schema.campaigns.name,
      organizationName: schema.organizations.name,
    })
    .from(schema.campaignRecipients)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignRecipients.campaignId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.campaignRecipients.organizationId))
    .where(eq(schema.campaignRecipients.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    recipientId: row.r.id,
    organizationName: row.organizationName,
    campaignName: row.campaignName,
    email: row.r.email,
    alreadyUnsubscribed: row.r.status === "unsubscribed",
  };
}

/** One-click unsubscribe (no login): suppression by address + recipient status + tracking event. Idempotent. */
export async function confirmUnsubscribe(
  db: Database,
  ctx: MarketingContext,
  ref: string,
  userAgent: string | null = null,
): Promise<UnsubscribeInfo | null> {
  const info = await unsubscribeInfo(db, ctx, ref);
  if (!info) return null;
  const actor: Actor = { kind: "system", job: "email.unsubscribe" };
  await db.transaction(async (tx) => {
    const r = (
      await tx
        .select()
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.id, info.recipientId))
        .limit(1)
    )[0];
    if (!r) return;
    await suppressEmail(tx, actor, r.organizationId, {
      email: r.email,
      reason: "unsubscribed",
      note: `Lien de désinscription — campagne « ${info.campaignName} »`,
      source: "system",
    });
    if (r.status !== "unsubscribed") {
      await tx
        .update(schema.campaignRecipients)
        .set({ status: "unsubscribed" })
        .where(eq(schema.campaignRecipients.id, r.id));
      await tx.insert(schema.trackingEvents).values({
        organizationId: r.organizationId,
        campaignId: r.campaignId,
        recipientId: r.id,
        kind: "unsubscribe",
        userAgent: userAgent ? userAgent.slice(0, 200) : null,
      });
    }
  });
  return { ...info, alreadyUnsubscribed: true };
}

/** Provider callback (delivered / bounced / complained / failed). Idempotent per (provider, message id, event). */
export async function recordDeliveryEvent(
  db: Database,
  provider: string,
  input: DeliveryCallback,
): Promise<"applied" | "duplicate" | "unknown"> {
  const v = deliveryCallbackSchema.parse(input);
  const actor: Actor = { kind: "system", job: `email.webhook.${provider}` };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.messageDeliveries)
      .where(
        and(
          eq(schema.messageDeliveries.provider, provider),
          eq(schema.messageDeliveries.providerMessageId, v.providerMessageId),
        ),
      )
      .limit(1)
      .for("update");
    const d = rows[0];
    if (!d) return "unknown";
    const at = v.occurredAt ?? new Date();
    if (v.event === "delivered") {
      if (d.status === "delivered") return "duplicate";
      if (d.status === "bounced" || d.status === "complained") return "duplicate"; // out of order: a bounce wins
      await tx
        .update(schema.messageDeliveries)
        .set({ status: "delivered", deliveredAt: at })
        .where(eq(schema.messageDeliveries.id, d.id));
      return "applied";
    }
    const target = v.event === "bounced" ? "bounced" : v.event === "complained" ? "complained" : "failed";
    if (d.status === target) return "duplicate";
    await tx
      .update(schema.messageDeliveries)
      .set({ status: target, bouncedAt: at, error: v.reason ?? null })
      .where(eq(schema.messageDeliveries.id, d.id));
    if (d.organizationId && (v.event === "complained" || (v.event === "bounced" && v.hard))) {
      await suppressEmail(tx, actor, d.organizationId, {
        email: d.toEmail,
        reason: v.event === "complained" ? "complaint" : "bounced",
        note: v.reason ?? `Rappel ${provider} (${v.event})`,
        source: "system",
      });
    }
    if (d.recipientId && d.kind === "campaign" && (v.event === "bounced" || v.event === "complained")) {
      await tx
        .update(schema.campaignRecipients)
        .set({ status: "bounced", lastError: v.reason ?? v.event })
        .where(
          and(
            eq(schema.campaignRecipients.id, d.recipientId),
            inArray(schema.campaignRecipients.status, ["sent", "pending"]),
          ),
        );
    }
    return "applied";
  });
}

/* Overview for the dashboard / list page. */
export async function campaignStats(db: DbExecutor, organizationId: string) {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      drafts: sql<number>`count(*) filter (where status = 'draft')::int`,
      scheduled: sql<number>`count(*) filter (where status = 'scheduled')::int`,
      sent: sql<number>`coalesce(sum(sent_count), 0)::int`,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.organizationId, organizationId));
  const r = rows[0];
  return { total: r?.total ?? 0, drafts: r?.drafts ?? 0, scheduled: r?.scheduled ?? 0, sent: r?.sent ?? 0 };
}
