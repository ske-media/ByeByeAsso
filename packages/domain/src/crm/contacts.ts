import type { Database, DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, asc, desc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { requirePermission } from "../authorization";
import {
  type Actor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../kernel";
import {
  type ConsentBasis,
  type CrmSource,
  csvEscape,
  deriveMarketingStatus,
  isValidEmail,
  MARKETING_EMAIL_STATUS_LABELS,
  type MarketingEmailStatus,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type SuppressionReason,
  slugify,
} from "./identities";
import {
  type ContactInput,
  type ContactUpdateInput,
  contactInputSchema,
  contactUpdateSchema,
  type ListContactsInput,
  liftSuppressionSchema,
  listContactsSchema,
  type ManualConsentInput,
  type MergeInput,
  manualConsentSchema,
  mergeSchema,
  type NoteInput,
  noteSchema,
  type SuppressionInput,
  setTagsSchema,
  suppressionSchema,
  type TagInput,
  tagSchema,
} from "./schemas";

/** Parameterised `in (…)` list for raw SQL fragments (Drizzle serialises JS arrays as JSON, not as SQL arrays). */
export function sqlList(values: readonly (string | number)[]): SQL {
  if (values.length === 0) return sql`(null)`;
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

function first<T>(rows: T[], what: string): T {
  const r = rows[0];
  if (r === undefined) throw new Error(`${what}: insert returned no row`);
  return r;
}

/* ------------------------------------------------------------------------- */
/* views                                                                      */
/* ------------------------------------------------------------------------- */

export interface ContactListItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  city: string | null;
  status: "active" | "merged" | "archived";
  marketingEmailStatus: MarketingEmailStatus;
  source: CrmSource;
  tags: Array<{ id: string; name: string; color: string }>;
  ordersCount: number;
  ticketsCount: number;
  membershipsCount: number;
  applicationsCount: number;
  missionsCount: number;
  hasAccount: boolean;
  lastActivityAt: Date | null;
  firstSeenAt: Date;
}

export interface ContactStats {
  total: number;
  optedIn: number;
  customerOnly: number;
  suppressed: number;
  newLast30Days: number;
  withAccount: number;
}

export interface ContactTimelineEntry {
  key: string;
  at: Date;
  kind: "order" | "ticket_used" | "membership" | "application" | "mission" | "consent" | "note" | "merge";
  title: string;
  detail: string | null;
  href: string | null;
}

export interface ContactDetail extends ContactListItem {
  phone: string | null;
  userId: string | null;
  mergedIntoContactId: string | null;
  identities: Array<{
    id: string;
    kind: "email" | "phone" | "user";
    value: string;
    verified: boolean;
    isPrimary: boolean;
  }>;
  consents: Array<{
    id: string;
    status: "granted" | "withdrawn";
    basis: ConsentBasis;
    source: CrmSource;
    evidence: string;
    occurredAt: Date;
    recordedBy: string | null;
  }>;
  suppression: { id: string; reason: SuppressionReason; note: string | null; createdAt: Date } | null;
  notes: Array<{ id: string; body: string; pinned: boolean; author: string | null; createdAt: Date }>;
  orders: Array<{
    id: string;
    number: string;
    status: string;
    eventId: string;
    eventTitle: string;
    totalMinor: number;
    currency: string;
    ticketsCount: number;
    paidAt: Date | null;
  }>;
  memberships: Array<{
    id: string;
    number: string;
    status: string;
    planName: string;
    validFrom: Date | null;
    validUntil: Date | null;
  }>;
  applications: Array<{
    id: string;
    number: string;
    status: string;
    eventId: string;
    eventTitle: string;
    createdAt: Date;
  }>;
  missions: Array<{
    assignmentId: string;
    eventTitle: string;
    startsAt: Date;
    endsAt: Date;
    confirmationStatus: string;
  }>;
  merges: Array<{ id: string; mergedContactId: string; mergedEmail: string; reason: string | null; createdAt: Date }>;
  timeline: ContactTimelineEntry[];
  version: number;
}

type ContactRow = typeof schema.contacts.$inferSelect;

/* ------------------------------------------------------------------------- */
/* authorization helpers                                                      */
/* ------------------------------------------------------------------------- */

async function authorize(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  permission: "contacts.read" | "contacts.manage" | "contacts.export",
) {
  await requirePermission(db, actor, permission, { organizationId });
}

async function loadContact(db: DbExecutor, organizationId: string, contactId: string): Promise<ContactRow> {
  const rows = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("contact", contactId);
  return row;
}

function fullName(first: string | null, last: string | null, email: string): string {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || email;
}

/* ------------------------------------------------------------------------- */
/* status refresh (counters + consent)                                        */
/* ------------------------------------------------------------------------- */

async function emailsOf(db: DbExecutor, contact: ContactRow): Promise<string[]> {
  const ids = await db
    .select({ value: schema.contactIdentities.value })
    .from(schema.contactIdentities)
    .where(and(eq(schema.contactIdentities.contactId, contact.id), eq(schema.contactIdentities.kind, "email")));
  return [...new Set([contact.primaryEmail, ...ids.map((i) => i.value)])];
}

async function isSuppressed(db: DbExecutor, organizationId: string, emails: string[]): Promise<boolean> {
  if (emails.length === 0) return false;
  const rows = await db
    .select({ id: schema.contactSuppressions.id })
    .from(schema.contactSuppressions)
    .where(
      and(
        eq(schema.contactSuppressions.organizationId, organizationId),
        inArray(schema.contactSuppressions.email, emails),
        isNull(schema.contactSuppressions.liftedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Recompute everything derived on a contact from the sources of truth (orders, memberships,
 * volunteer applications, published assignments, consent journal, suppressions). Idempotent:
 * used after every touchpoint, after a merge, and by the nightly rebuild.
 */
export async function refreshContact(db: DbExecutor, organizationId: string, contactId: string): Promise<ContactRow> {
  const contact = await loadContact(db, organizationId, contactId);
  const emails = await emailsOf(db, contact);
  const stats = await db.execute<{
    orders: string;
    tickets: string;
    memberships: string;
    applications: string;
    missions: string;
    last_activity: Date | null;
  }>(sql`
    with o as (
      select count(*)::int as orders, max(paid_at) as last
      from orders where organization_id = ${organizationId} and buyer_email in ${sqlList(emails)}
        and status in ('paid','partially_refunded','refunded')
    ),
    t as (
      select count(*)::int as tickets
      from tickets tk join orders o2 on o2.id = tk.order_id
      where o2.organization_id = ${organizationId} and o2.buyer_email in ${sqlList(emails)} and tk.status in ('valid','used')
    ),
    m as (
      select count(*)::int as memberships, max(coalesce(activated_at, created_at)) as last
      from memberships where organization_id = ${organizationId} and member_email in ${sqlList(emails)}
        and status in ('active','suspended','expired','cancelled')
    ),
    a as (
      select count(*)::int as applications, max(created_at) as last
      from volunteer_applications where organization_id = ${organizationId} and email in ${sqlList(emails)}
    ),
    s as (
      select count(*)::int as missions
      from active_volunteer_commitments where organization_id = ${organizationId} and email in ${sqlList(emails)}
    )
    select o.orders::text, t.tickets::text, m.memberships::text, a.applications::text, s.missions::text,
      greatest(o.last, m.last, a.last) as last_activity
    from o, t, m, a, s
  `);
  const st = stats.rows[0];
  const consents = await db
    .select({
      status: schema.consentRecords.status,
      basis: schema.consentRecords.basis,
      occurredAt: schema.consentRecords.occurredAt,
    })
    .from(schema.consentRecords)
    .where(and(eq(schema.consentRecords.contactId, contact.id), eq(schema.consentRecords.channel, "email")));
  const suppressed = await isSuppressed(db, organizationId, emails);
  const marketing = deriveMarketingStatus(consents, suppressed);
  const lastActivity = st?.last_activity ? new Date(st.last_activity) : null;
  const updated = await db
    .update(schema.contacts)
    .set({
      ordersCount: Number(st?.orders ?? 0),
      ticketsCount: Number(st?.tickets ?? 0),
      membershipsCount: Number(st?.memberships ?? 0),
      applicationsCount: Number(st?.applications ?? 0),
      missionsCount: Number(st?.missions ?? 0),
      lastActivityAt:
        lastActivity && contact.lastActivityAt && contact.lastActivityAt > lastActivity
          ? contact.lastActivityAt
          : (lastActivity ?? contact.lastActivityAt),
      marketingEmailStatus: marketing,
    })
    .where(eq(schema.contacts.id, contact.id))
    .returning();
  return updated[0] ?? contact;
}

/* ------------------------------------------------------------------------- */
/* touchpoints — the ONLY write path other modules use                         */
/* ------------------------------------------------------------------------- */

export interface Touchpoint {
  organizationId: string;
  source: "order" | "membership" | "volunteer_application" | "schedule";
  /** Aggregate id of the source (order, membership, application, assignment). */
  sourceId: string;
  /** Human reference used in the consent evidence (order number, membership number…). */
  sourceLabel: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  userId?: string | null;
  occurredAt: Date;
  /**
   * null/undefined = the source carries no consent information (e.g. a schedule publication).
   * true = the person ticked the marketing box → explicit opt-in.
   * false = box present and left unticked: nothing explicit; with `customerRelationship` the
   * "existing customer" legal basis is recorded (status customer_only, never opted_in).
   */
  marketingOptIn?: boolean | null;
  customerRelationship?: boolean;
}

async function resolveContactByIdentity(
  db: DbExecutor,
  organizationId: string,
  kind: "email" | "user",
  value: string,
): Promise<ContactRow | null> {
  const rows = await db
    .select({ c: schema.contacts })
    .from(schema.contactIdentities)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactIdentities.contactId))
    .where(
      and(
        eq(schema.contactIdentities.organizationId, organizationId),
        eq(schema.contactIdentities.kind, kind),
        eq(schema.contactIdentities.value, value),
      ),
    )
    .limit(1);
  let c = rows[0]?.c ?? null;
  // Follow merge chains (bounded).
  for (let i = 0; c && c.status === "merged" && c.mergedIntoContactId && i < 10; i += 1) {
    const next = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, c.mergedIntoContactId), eq(schema.contacts.organizationId, organizationId)))
      .limit(1);
    c = next[0] ?? null;
  }
  return c;
}

async function ensureIdentity(
  db: DbExecutor,
  contact: ContactRow,
  kind: "email" | "phone" | "user",
  value: string,
  opts: { verified?: boolean; isPrimary?: boolean; source: CrmSource },
): Promise<void> {
  await db
    .insert(schema.contactIdentities)
    .values({
      organizationId: contact.organizationId,
      contactId: contact.id,
      kind,
      value,
      verified: opts.verified ?? false,
      isPrimary: opts.isPrimary ?? false,
      source: opts.source,
    })
    .onConflictDoNothing();
}

/**
 * Create or update the organization's contact for a person seen through a source module.
 * Called INSIDE the source module's transaction (dependency rule #3: a module writes its own
 * tables through its own commands). Never throws for a bad e-mail: a touchpoint must not
 * break a payment — the row is skipped and reported by `rebuildContacts`.
 */
export async function recordTouchpoint(db: DbExecutor, input: Touchpoint): Promise<string | null> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return null;
  const org = input.organizationId;
  let contact = await resolveContactByIdentity(db, org, "email", email);
  if (!contact && input.userId) contact = await resolveContactByIdentity(db, org, "user", input.userId);
  if (!contact) {
    const existing = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, org),
          eq(schema.contacts.primaryEmail, email),
          eq(schema.contacts.status, "active"),
        ),
      )
      .limit(1);
    contact = existing[0] ?? null;
  }
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const phone = normalizeName(input.phone);
  if (!contact) {
    const inserted = await db
      .insert(schema.contacts)
      .values({
        organizationId: org,
        primaryEmail: email,
        firstName,
        lastName,
        phone,
        userId: input.userId ?? null,
        source: input.source,
        firstSeenAt: input.occurredAt,
        lastActivityAt: input.occurredAt,
      })
      .returning();
    contact = inserted[0] as ContactRow;
    await ensureIdentity(db, contact, "email", email, { isPrimary: true, source: input.source, verified: false });
  } else {
    const patch: Partial<ContactRow> = {};
    if (!contact.firstName && firstName) patch.firstName = firstName;
    if (!contact.lastName && lastName) patch.lastName = lastName;
    if (!contact.phone && phone) patch.phone = phone;
    if (!contact.userId && input.userId) patch.userId = input.userId;
    if (!contact.lastActivityAt || contact.lastActivityAt < input.occurredAt) patch.lastActivityAt = input.occurredAt;
    if (contact.status === "archived") {
      patch.status = "active";
      patch.archivedAt = null;
    }
    if (Object.keys(patch).length > 0) {
      const updated = await db.update(schema.contacts).set(patch).where(eq(schema.contacts.id, contact.id)).returning();
      contact = updated[0] ?? contact;
    }
    await ensureIdentity(db, contact, "email", email, { source: input.source });
  }
  if (input.userId) {
    // A verified account identity is attached once; a second contact claiming the same
    // account is left as a duplicate for a human merge (never merged automatically).
    const user = await db
      .select({ verified: schema.users.emailVerified, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    const u = user[0];
    if (u) {
      await ensureIdentity(db, contact, "user", input.userId, { verified: u.verified, source: input.source });
      if (u.verified) {
        const ue = normalizeEmail(u.email);
        if (ue === email)
          await db
            .update(schema.contactIdentities)
            .set({ verified: true })
            .where(
              and(
                eq(schema.contactIdentities.contactId, contact.id),
                eq(schema.contactIdentities.kind, "email"),
                eq(schema.contactIdentities.value, ue),
              ),
            );
      }
    }
  }
  if (phone) {
    const normalized = normalizePhone(phone);
    if (normalized) await ensureIdentity(db, contact, "phone", normalized, { source: input.source });
  }
  // Consent: explicit opt-in, or the customer exception — never both for one source.
  if (input.marketingOptIn === true) {
    await db
      .insert(schema.consentRecords)
      .values({
        organizationId: org,
        contactId: contact.id,
        channel: "email",
        status: "granted",
        basis: "explicit_opt_in",
        source: input.source,
        sourceId: input.sourceId,
        evidence: `Case « recevoir les actualités » cochée — ${input.sourceLabel}`,
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing();
  } else if (input.marketingOptIn === false && input.customerRelationship) {
    await db
      .insert(schema.consentRecords)
      .values({
        organizationId: org,
        contactId: contact.id,
        channel: "email",
        status: "granted",
        basis: "customer_exception",
        source: input.source,
        sourceId: input.sourceId,
        evidence: `Relation client sans case cochée — ${input.sourceLabel} (base légale : exception client, droit d'opposition à chaque message)`,
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing();
  }
  await refreshContact(db, org, contact.id);
  return contact.id;
}

/**
 * Replay the whole history of an organization into its contact base. Idempotent (identities
 * and consent rows are keyed by source). Returns counts for the audit trail.
 */
export async function rebuildContacts(
  db: Database,
  actor: Actor,
  organizationId: string,
): Promise<{ touched: number; skipped: number }> {
  if (actor.kind !== "system") await authorize(db, actor, organizationId, "contacts.manage");
  let touched = 0;
  let skipped = 0;
  const orders = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        inArray(schema.orders.status, ["paid", "partially_refunded", "refunded"]),
      ),
    )
    .orderBy(asc(schema.orders.paidAt));
  const memberships = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        inArray(schema.memberships.status, ["active", "suspended", "expired", "cancelled"]),
      ),
    )
    .orderBy(asc(schema.memberships.createdAt));
  const applications = await db
    .select()
    .from(schema.volunteerApplications)
    .where(eq(schema.volunteerApplications.organizationId, organizationId))
    .orderBy(asc(schema.volunteerApplications.createdAt));
  await db.transaction(async (tx) => {
    for (const o of orders) {
      const id = await recordTouchpoint(tx, {
        organizationId,
        source: "order",
        sourceId: o.id,
        sourceLabel: `commande ${o.number}`,
        email: o.buyerEmail,
        firstName: o.buyerFirstName,
        lastName: o.buyerLastName,
        userId: o.userId,
        occurredAt: o.paidAt ?? o.createdAt,
        marketingOptIn: o.marketingOptIn,
        customerRelationship: o.totalMinor > 0,
      });
      if (id) touched += 1;
      else skipped += 1;
    }
    for (const m of memberships) {
      const id = await recordTouchpoint(tx, {
        organizationId,
        source: "membership",
        sourceId: m.id,
        sourceLabel: `adhésion ${m.number}`,
        email: m.memberEmail,
        firstName: m.memberFirstName,
        lastName: m.memberLastName,
        userId: m.userId,
        occurredAt: m.activatedAt ?? m.createdAt,
        marketingOptIn: m.marketingOptIn,
        customerRelationship: m.priceMinor > 0,
      });
      if (id) touched += 1;
      else skipped += 1;
    }
    for (const a of applications) {
      const id = await recordTouchpoint(tx, {
        organizationId,
        source: "volunteer_application",
        sourceId: a.id,
        sourceLabel: `candidature ${a.number}`,
        email: a.email,
        firstName: a.firstName,
        lastName: a.lastName,
        phone: a.phone,
        userId: a.userId,
        occurredAt: a.createdAt,
        marketingOptIn: a.marketingOptIn,
        customerRelationship: false,
      });
      if (id) touched += 1;
      else skipped += 1;
    }
    // Contacts without any remaining source still get their counters refreshed.
    const all = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), ne(schema.contacts.status, "merged")));
    for (const c of all) await refreshContact(tx, organizationId, c.id);
    await recordAudit(tx, actor, {
      organizationId,
      action: "contacts.rebuilt",
      targetType: "organization",
      targetId: organizationId,
      metadata: { touched, skipped },
    });
  });
  return { touched, skipped };
}

/* ------------------------------------------------------------------------- */
/* list, stats, detail                                                        */
/* ------------------------------------------------------------------------- */

async function tagsFor(db: DbExecutor, contactIds: string[]) {
  if (contactIds.length === 0) return new Map<string, ContactListItem["tags"]>();
  const rows = await db
    .select({
      contactId: schema.contactTagAssignments.contactId,
      id: schema.contactTags.id,
      name: schema.contactTags.name,
      color: schema.contactTags.color,
    })
    .from(schema.contactTagAssignments)
    .innerJoin(schema.contactTags, eq(schema.contactTags.id, schema.contactTagAssignments.tagId))
    .where(inArray(schema.contactTagAssignments.contactId, contactIds))
    .orderBy(asc(schema.contactTags.name));
  const map = new Map<string, ContactListItem["tags"]>();
  for (const r of rows) {
    const list = map.get(r.contactId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.contactId, list);
  }
  return map;
}

function toListItem(c: ContactRow, tags: ContactListItem["tags"]): ContactListItem {
  return {
    id: c.id,
    email: c.primaryEmail,
    firstName: c.firstName,
    lastName: c.lastName,
    name: fullName(c.firstName, c.lastName, c.primaryEmail),
    city: c.city,
    status: c.status,
    marketingEmailStatus: c.marketingEmailStatus,
    source: c.source,
    tags,
    ordersCount: c.ordersCount,
    ticketsCount: c.ticketsCount,
    membershipsCount: c.membershipsCount,
    applicationsCount: c.applicationsCount,
    missionsCount: c.missionsCount,
    hasAccount: c.userId !== null,
    lastActivityAt: c.lastActivityAt,
    firstSeenAt: c.firstSeenAt,
  };
}

/** SQL predicate "contact is linked to event X through relation R" — shared with segments. */
export function eventRelationSql(
  organizationId: string,
  relation: "ordered" | "attended" | "volunteered" | "assigned",
  eventIds: string[],
) {
  const emails = sql`(select ci.value from contact_identities ci where ci.contact_id = "contacts"."id" and ci.kind = 'email')`;
  switch (relation) {
    case "ordered":
      return sql`exists (select 1 from orders o where o.organization_id = ${organizationId} and o.event_id in ${sqlList(eventIds)}
        and o.status in ('paid','partially_refunded') and o.buyer_email in ${emails})`;
    case "attended":
      return sql`exists (select 1 from tickets tk join orders o on o.id = tk.order_id
        where o.organization_id = ${organizationId} and o.event_id in ${sqlList(eventIds)} and tk.status = 'used' and o.buyer_email in ${emails})`;
    case "volunteered":
      return sql`exists (select 1 from volunteer_applications va where va.organization_id = ${organizationId}
        and va.event_id in ${sqlList(eventIds)} and va.status in ('approved','assigned','confirmed') and va.email in ${emails})`;
    case "assigned":
      return sql`exists (select 1 from active_volunteer_commitments avc where avc.organization_id = ${organizationId}
        and avc.event_id in ${sqlList(eventIds)} and avc.email in ${emails})`;
  }
}

export function searchSql(q: string) {
  const like = `%${q.trim().toLowerCase()}%`;
  return sql`(lower("contacts"."primary_email") like ${like}
    or lower(coalesce("contacts"."first_name",'') || ' ' || coalesce("contacts"."last_name",'')) like ${like}
    or lower(coalesce("contacts"."last_name",'') || ' ' || coalesce("contacts"."first_name",'')) like ${like}
    or exists (select 1 from contact_identities ci where ci.contact_id = "contacts"."id" and lower(ci.value) like ${like}))`;
}

export async function listContacts(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: ListContactsInput = {},
): Promise<{ contacts: ContactListItem[]; total: number; page: number; pageSize: number; stats: ContactStats }> {
  await authorize(db, actor, organizationId, "contacts.read");
  const f = listContactsSchema.parse(input);
  const conditions = [eq(schema.contacts.organizationId, organizationId)];
  if (f.status !== "all") conditions.push(eq(schema.contacts.status, f.status));
  if (f.marketing) conditions.push(eq(schema.contacts.marketingEmailStatus, f.marketing));
  if (f.source) conditions.push(eq(schema.contacts.source, f.source));
  if (f.q) conditions.push(searchSql(f.q));
  if (f.tagId)
    conditions.push(
      sql`exists (select 1 from contact_tag_assignments ta where ta.contact_id = "contacts"."id" and ta.tag_id = ${f.tagId})`,
    );
  if (f.eventId) conditions.push(eventRelationSql(organizationId, "ordered", [f.eventId]));
  if (f.segmentId)
    conditions.push(
      sql`exists (select 1 from segment_members sm where sm.contact_id = "contacts"."id" and sm.segment_id = ${f.segmentId})`,
    );
  const where = and(...conditions);
  const order =
    f.sort === "name"
      ? [asc(schema.contacts.lastName), asc(schema.contacts.firstName), asc(schema.contacts.primaryEmail)]
      : f.sort === "created"
        ? [desc(schema.contacts.firstSeenAt)]
        : [
            desc(sql`coalesce("contacts"."last_activity_at", "contacts"."first_seen_at")`),
            asc(schema.contacts.primaryEmail),
          ];
  const rows = await db
    .select()
    .from(schema.contacts)
    .where(where)
    .orderBy(...order)
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const count = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contacts).where(where);
  const tags = await tagsFor(
    db,
    rows.map((r) => r.id),
  );
  return {
    contacts: rows.map((r) => toListItem(r, tags.get(r.id) ?? [])),
    total: count[0]?.n ?? 0,
    page: f.page,
    pageSize: f.pageSize,
    stats: await contactStats(db, organizationId),
  };
}

export async function contactStats(db: DbExecutor, organizationId: string): Promise<ContactStats> {
  const r = await db.execute<{
    total: string;
    opted_in: string;
    customer_only: string;
    suppressed: string;
    new30: string;
    with_account: string;
  }>(sql`
    select count(*)::text as total,
      count(*) filter (where marketing_email_status = 'opted_in')::text as opted_in,
      count(*) filter (where marketing_email_status = 'customer_only')::text as customer_only,
      count(*) filter (where marketing_email_status = 'suppressed')::text as suppressed,
      count(*) filter (where first_seen_at >= now() - interval '30 days')::text as new30,
      count(*) filter (where user_id is not null)::text as with_account
    from contacts where organization_id = ${organizationId} and status = 'active'
  `);
  const s = r.rows[0];
  return {
    total: Number(s?.total ?? 0),
    optedIn: Number(s?.opted_in ?? 0),
    customerOnly: Number(s?.customer_only ?? 0),
    suppressed: Number(s?.suppressed ?? 0),
    newLast30Days: Number(s?.new30 ?? 0),
    withAccount: Number(s?.with_account ?? 0),
  };
}

export async function getContact(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
): Promise<ContactDetail> {
  await authorize(db, actor, organizationId, "contacts.read");
  const c = await loadContact(db, organizationId, contactId);
  const emails = await emailsOf(db, c);
  const [identities, consents, notes, suppressions, merges, tags] = await Promise.all([
    db
      .select()
      .from(schema.contactIdentities)
      .where(eq(schema.contactIdentities.contactId, c.id))
      .orderBy(
        desc(schema.contactIdentities.isPrimary),
        asc(schema.contactIdentities.kind),
        asc(schema.contactIdentities.value),
      ),
    db
      .select({ r: schema.consentRecords, by: schema.users.name })
      .from(schema.consentRecords)
      .leftJoin(schema.users, eq(schema.users.id, schema.consentRecords.recordedBy))
      .where(eq(schema.consentRecords.contactId, c.id))
      .orderBy(desc(schema.consentRecords.occurredAt)),
    db
      .select({ n: schema.contactNotes, author: schema.users.name })
      .from(schema.contactNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.contactNotes.authorId))
      .where(eq(schema.contactNotes.contactId, c.id))
      .orderBy(desc(schema.contactNotes.pinned), desc(schema.contactNotes.createdAt)),
    db
      .select()
      .from(schema.contactSuppressions)
      .where(
        and(
          eq(schema.contactSuppressions.organizationId, organizationId),
          inArray(schema.contactSuppressions.email, emails),
          isNull(schema.contactSuppressions.liftedAt),
        ),
      )
      .limit(1),
    db
      .select({ m: schema.contactMergeRecords, email: schema.contacts.primaryEmail })
      .from(schema.contactMergeRecords)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactMergeRecords.mergedContactId))
      .where(eq(schema.contactMergeRecords.survivingContactId, c.id))
      .orderBy(desc(schema.contactMergeRecords.createdAt)),
    tagsFor(db, [c.id]),
  ]);
  const orders = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      status: schema.orders.status,
      eventId: schema.orders.eventId,
      eventTitle: schema.events.title,
      totalMinor: schema.orders.totalMinor,
      currency: schema.orders.currency,
      paidAt: schema.orders.paidAt,
      ticketsCount: sql<number>`(select count(*)::int from tickets tk where tk.order_id = "orders"."id" and tk.status in ('valid','used'))`,
    })
    .from(schema.orders)
    .innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId))
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        inArray(schema.orders.buyerEmail, emails),
        inArray(schema.orders.status, ["paid", "partially_refunded", "refunded"]),
      ),
    )
    .orderBy(desc(schema.orders.paidAt));
  const memberships = await db
    .select({
      id: schema.memberships.id,
      number: schema.memberships.number,
      status: schema.memberships.status,
      planName: schema.membershipPlans.name,
      validFrom: schema.memberships.validFrom,
      validUntil: schema.memberships.validUntil,
      activatedAt: schema.memberships.activatedAt,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.memberships.planId))
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        inArray(schema.memberships.memberEmail, emails),
        inArray(schema.memberships.status, ["active", "suspended", "expired", "cancelled"]),
      ),
    )
    .orderBy(desc(schema.memberships.createdAt));
  const applications = await db
    .select({
      id: schema.volunteerApplications.id,
      number: schema.volunteerApplications.number,
      status: schema.volunteerApplications.status,
      eventId: schema.volunteerApplications.eventId,
      eventTitle: schema.events.title,
      createdAt: schema.volunteerApplications.createdAt,
    })
    .from(schema.volunteerApplications)
    .innerJoin(schema.events, eq(schema.events.id, schema.volunteerApplications.eventId))
    .where(
      and(
        eq(schema.volunteerApplications.organizationId, organizationId),
        inArray(schema.volunteerApplications.email, emails),
      ),
    )
    .orderBy(desc(schema.volunteerApplications.createdAt));
  const missions = await db
    .select({
      assignmentId: schema.activeVolunteerCommitments.assignmentId,
      eventTitle: schema.events.title,
      startsAt: schema.activeVolunteerCommitments.startsAt,
      endsAt: schema.activeVolunteerCommitments.endsAt,
      confirmationStatus: schema.activeVolunteerCommitments.confirmationStatus,
    })
    .from(schema.activeVolunteerCommitments)
    .innerJoin(schema.events, eq(schema.events.id, schema.activeVolunteerCommitments.eventId))
    .where(
      and(
        eq(schema.activeVolunteerCommitments.organizationId, organizationId),
        inArray(schema.activeVolunteerCommitments.email, emails),
      ),
    )
    .orderBy(desc(schema.activeVolunteerCommitments.startsAt));

  const timeline: ContactTimelineEntry[] = [
    ...orders.map((o) => ({
      key: `order-${o.id}`,
      at: o.paidAt ?? new Date(0),
      kind: "order" as const,
      title: `Commande ${o.number} · ${o.eventTitle}`,
      detail: `${o.ticketsCount} billet(s) · ${(o.totalMinor / 100).toFixed(2).replace(".", ",")} ${o.currency}${o.status === "refunded" ? " · remboursée" : o.status === "partially_refunded" ? " · partiellement remboursée" : ""}`,
      href: `commandes/${o.id}`,
    })),
    ...memberships.map((m) => ({
      key: `membership-${m.id}`,
      at: m.activatedAt ?? m.createdAt,
      kind: "membership" as const,
      title: `Adhésion ${m.number} · ${m.planName}`,
      detail: m.status,
      href: `adhesions/${m.id}`,
    })),
    ...applications.map((a) => ({
      key: `application-${a.id}`,
      at: a.createdAt,
      kind: "application" as const,
      title: `Candidature ${a.number} · ${a.eventTitle}`,
      detail: a.status,
      href: `benevoles/candidatures/${a.id}`,
    })),
    ...missions.map((m) => ({
      key: `mission-${m.assignmentId}`,
      at: m.startsAt,
      kind: "mission" as const,
      title: `Mission · ${m.eventTitle}`,
      detail: m.confirmationStatus,
      href: null,
    })),
    ...consents.map(({ r }) => ({
      key: `consent-${r.id}`,
      at: r.occurredAt,
      kind: "consent" as const,
      title: r.status === "granted" ? "Consentement e-mail enregistré" : "Consentement e-mail retiré",
      detail: r.evidence,
      href: null,
    })),
    ...merges.map(({ m, email }) => ({
      key: `merge-${m.id}`,
      at: m.createdAt,
      kind: "merge" as const,
      title: `Fusion : ${email} rattaché·e à cette fiche`,
      detail: m.reason,
      href: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const sup = suppressions[0];
  return {
    ...toListItem(c, tags.get(c.id) ?? []),
    phone: c.phone,
    userId: c.userId,
    mergedIntoContactId: c.mergedIntoContactId,
    identities: identities.map((i) => ({
      id: i.id,
      kind: i.kind,
      value: i.value,
      verified: i.verified,
      isPrimary: i.isPrimary,
    })),
    consents: consents.map(({ r, by }) => ({
      id: r.id,
      status: r.status,
      basis: r.basis,
      source: r.source,
      evidence: r.evidence,
      occurredAt: r.occurredAt,
      recordedBy: by ?? null,
    })),
    suppression: sup ? { id: sup.id, reason: sup.reason, note: sup.note, createdAt: sup.createdAt } : null,
    notes: notes.map(({ n, author }) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      author: author ?? null,
      createdAt: n.createdAt,
    })),
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      eventId: o.eventId,
      eventTitle: o.eventTitle,
      totalMinor: o.totalMinor,
      currency: o.currency,
      ticketsCount: o.ticketsCount,
      paidAt: o.paidAt,
    })),
    memberships: memberships.map((m) => ({
      id: m.id,
      number: m.number,
      status: m.status,
      planName: m.planName,
      validFrom: m.validFrom,
      validUntil: m.validUntil,
    })),
    applications,
    missions,
    merges: merges.map(({ m, email }) => ({
      id: m.id,
      mergedContactId: m.mergedContactId,
      mergedEmail: email,
      reason: m.reason,
      createdAt: m.createdAt,
    })),
    timeline,
    version: c.version,
  };
}

/* ------------------------------------------------------------------------- */
/* manual contact management                                                   */
/* ------------------------------------------------------------------------- */

export async function createContact(db: Database, actor: Actor, organizationId: string, input: ContactInput) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = contactInputSchema.parse(input);
  const email = normalizeEmail(v.email);
  return db.transaction(async (tx) => {
    const existing = await resolveContactByIdentity(tx, organizationId, "email", email);
    if (existing && existing.status !== "archived")
      throw new ConflictError("Un contact existe déjà avec cette adresse.", { contactId: existing.id });
    const phone = v.phone ?? null;
    let contact: ContactRow;
    if (existing) {
      const updated = await tx
        .update(schema.contacts)
        .set({
          status: "active",
          archivedAt: null,
          firstName: v.firstName ?? existing.firstName,
          lastName: v.lastName ?? existing.lastName,
          phone: phone ?? existing.phone,
          city: v.city ?? existing.city,
        })
        .where(eq(schema.contacts.id, existing.id))
        .returning();
      contact = updated[0] as ContactRow;
    } else {
      const inserted = await tx
        .insert(schema.contacts)
        .values({
          organizationId,
          primaryEmail: email,
          firstName: v.firstName ?? null,
          lastName: v.lastName ?? null,
          phone,
          city: v.city ?? null,
          source: "staff",
        })
        .returning();
      contact = inserted[0] as ContactRow;
      await ensureIdentity(tx, contact, "email", email, { isPrimary: true, source: "staff" });
    }
    const np = normalizePhone(phone);
    if (np) await ensureIdentity(tx, contact, "phone", np, { source: "staff" });
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.created",
      targetType: "contact",
      targetId: contact.id,
      metadata: { email },
    });
    const refreshed = await refreshContact(tx, organizationId, contact.id);
    return toListItem(refreshed, []);
  });
}

export async function updateContact(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
  input: ContactUpdateInput,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = contactUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, organizationId, contactId);
    if (c.status === "merged") throw new PreconditionFailedError("Fiche fusionnée : modifiez la fiche survivante.");
    if (v.version !== undefined && v.version !== c.version)
      throw new ConflictError("La fiche a été modifiée entre-temps ; rechargez.", { code: "stale_version" });
    const patch: Partial<ContactRow> = { version: c.version + 1 };
    if (v.firstName !== undefined) patch.firstName = v.firstName ?? null;
    if (v.lastName !== undefined) patch.lastName = v.lastName ?? null;
    if (v.phone !== undefined) patch.phone = v.phone ?? null;
    if (v.city !== undefined) patch.city = v.city ?? null;
    if (v.email !== undefined) {
      const email = normalizeEmail(v.email);
      if (email !== c.primaryEmail) {
        const other = await resolveContactByIdentity(tx, organizationId, "email", email);
        if (other && other.id !== c.id)
          throw new ConflictError("Cette adresse appartient déjà à un autre contact (fusionnez-les).", {
            contactId: other.id,
          });
        patch.primaryEmail = email;
        await tx
          .update(schema.contactIdentities)
          .set({ isPrimary: false })
          .where(and(eq(schema.contactIdentities.contactId, c.id), eq(schema.contactIdentities.kind, "email")));
        await ensureIdentity(tx, c, "email", email, { isPrimary: true, source: "staff" });
        await tx
          .update(schema.contactIdentities)
          .set({ isPrimary: true })
          .where(
            and(
              eq(schema.contactIdentities.contactId, c.id),
              eq(schema.contactIdentities.kind, "email"),
              eq(schema.contactIdentities.value, email),
            ),
          );
      }
    }
    await tx.update(schema.contacts).set(patch).where(eq(schema.contacts.id, c.id));
    if (v.phone) {
      const np = normalizePhone(v.phone);
      if (np) await ensureIdentity(tx, c, "phone", np, { source: "staff" });
    }
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.updated",
      targetType: "contact",
      targetId: c.id,
      metadata: { fields: Object.keys(v).filter((k) => k !== "version") },
    });
    const refreshed = await refreshContact(tx, organizationId, c.id);
    return toListItem(refreshed, []);
  });
}

export async function setContactArchived(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
  archived: boolean,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, organizationId, contactId);
    if (c.status === "merged") throw new PreconditionFailedError("Fiche fusionnée.");
    if (archived && c.status === "archived") return;
    if (!archived && c.status === "active") return;
    await tx
      .update(schema.contacts)
      .set(archived ? { status: "archived", archivedAt: new Date() } : { status: "active", archivedAt: null })
      .where(eq(schema.contacts.id, c.id));
    await recordAudit(tx, actor, {
      organizationId,
      action: archived ? "contact.archived" : "contact.restored",
      targetType: "contact",
      targetId: c.id,
    });
  });
}

/* notes */

export async function addNote(db: Database, actor: Actor, organizationId: string, contactId: string, input: NoteInput) {
  await authorize(db, actor, organizationId, "contacts.manage");
  if (actor.kind !== "user") throw new ForbiddenError("contacts.manage");
  const v = noteSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, organizationId, contactId);
    const inserted = await tx
      .insert(schema.contactNotes)
      .values({ organizationId, contactId: c.id, authorId: actor.userId, body: v.body, pinned: v.pinned })
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.note_added",
      targetType: "contact",
      targetId: c.id,
      metadata: { noteId: inserted[0]?.id },
    });
    return first(inserted, "contact_notes");
  });
}

export async function deleteNote(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
  noteId: string,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.contactNotes)
      .where(
        and(
          eq(schema.contactNotes.id, noteId),
          eq(schema.contactNotes.contactId, contactId),
          eq(schema.contactNotes.organizationId, organizationId),
        ),
      )
      .returning({ id: schema.contactNotes.id });
    if (deleted.length === 0) throw new NotFoundError("note", noteId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.note_deleted",
      targetType: "contact",
      targetId: contactId,
      metadata: { noteId },
    });
  });
}

/* tags */

export async function listTags(db: DbExecutor, actor: Actor, organizationId: string) {
  await authorize(db, actor, organizationId, "contacts.read");
  return db
    .select({
      id: schema.contactTags.id,
      name: schema.contactTags.name,
      slug: schema.contactTags.slug,
      color: schema.contactTags.color,
      count: sql<number>`(select count(*)::int from contact_tag_assignments ta join contacts c on c.id = ta.contact_id where ta.tag_id = "contact_tags"."id" and c.status = 'active')`,
    })
    .from(schema.contactTags)
    .where(eq(schema.contactTags.organizationId, organizationId))
    .orderBy(asc(schema.contactTags.name));
}

export async function createTag(db: Database, actor: Actor, organizationId: string, input: TagInput) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = tagSchema.parse(input);
  const slug = v.slug ?? slugify(v.name);
  if (!slug) throw new ValidationError({ name: ["Nom invalide."] });
  return db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: schema.contactTags.id })
      .from(schema.contactTags)
      .where(and(eq(schema.contactTags.organizationId, organizationId), eq(schema.contactTags.slug, slug)))
      .limit(1);
    if (dup.length > 0) throw new ConflictError("Une étiquette porte déjà ce nom.");
    const inserted = await tx
      .insert(schema.contactTags)
      .values({ organizationId, name: v.name, slug, color: v.color })
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact_tag.created",
      targetType: "contact_tag",
      targetId: inserted[0]?.id ?? null,
      metadata: { name: v.name },
    });
    return first(inserted, "contact_tags");
  });
}

export async function updateTag(
  db: Database,
  actor: Actor,
  organizationId: string,
  tagId: string,
  input: Partial<TagInput>,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = tagSchema.partial().parse(input);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contactTags)
      .where(and(eq(schema.contactTags.id, tagId), eq(schema.contactTags.organizationId, organizationId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("contact_tag", tagId);
    const updated = await tx
      .update(schema.contactTags)
      .set({ ...(v.name ? { name: v.name } : {}), ...(v.color ? { color: v.color } : {}) })
      .where(eq(schema.contactTags.id, tagId))
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact_tag.updated",
      targetType: "contact_tag",
      targetId: tagId,
    });
    return first(updated, "contact_tags");
  });
}

export async function deleteTag(db: Database, actor: Actor, organizationId: string, tagId: string) {
  await authorize(db, actor, organizationId, "contacts.manage");
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.contactTags)
      .where(and(eq(schema.contactTags.id, tagId), eq(schema.contactTags.organizationId, organizationId)))
      .returning({ id: schema.contactTags.id });
    if (deleted.length === 0) throw new NotFoundError("contact_tag", tagId);
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact_tag.deleted",
      targetType: "contact_tag",
      targetId: tagId,
    });
  });
}

export async function setContactTags(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
  input: { tagIds: string[] },
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = setTagsSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, organizationId, contactId);
    const known = v.tagIds.length
      ? await tx
          .select({ id: schema.contactTags.id })
          .from(schema.contactTags)
          .where(and(eq(schema.contactTags.organizationId, organizationId), inArray(schema.contactTags.id, v.tagIds)))
      : [];
    if (known.length !== new Set(v.tagIds).size) throw new NotFoundError("contact_tag");
    await tx.delete(schema.contactTagAssignments).where(eq(schema.contactTagAssignments.contactId, c.id));
    if (known.length > 0)
      await tx.insert(schema.contactTagAssignments).values(
        known.map((k) => ({
          organizationId,
          contactId: c.id,
          tagId: k.id,
          assignedBy: actor.kind === "user" ? actor.userId : null,
        })),
      );
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.tags_set",
      targetType: "contact",
      targetId: c.id,
      metadata: { tagIds: known.map((k) => k.id) },
    });
    const tags = await tagsFor(tx, [c.id]);
    return tags.get(c.id) ?? [];
  });
}

/* consent (manual) */

export async function recordManualConsent(
  db: Database,
  actor: Actor,
  organizationId: string,
  contactId: string,
  input: ManualConsentInput,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = manualConsentSchema.parse(input);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, organizationId, contactId);
    if (c.status === "merged") throw new PreconditionFailedError("Fiche fusionnée.");
    const inserted = await tx
      .insert(schema.consentRecords)
      .values({
        organizationId,
        contactId: c.id,
        channel: "email",
        status: v.status,
        basis: "manual",
        source: "staff",
        sourceId: null,
        evidence: v.evidence,
        occurredAt: v.occurredAt ?? new Date(),
        recordedBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning();
    await recordAudit(tx, actor, {
      organizationId,
      action: v.status === "granted" ? "consent.granted" : "consent.withdrawn",
      targetType: "contact",
      targetId: c.id,
      reason: v.evidence,
      metadata: { consentId: inserted[0]?.id, basis: "manual" },
    });
    const refreshed = await refreshContact(tx, organizationId, c.id);
    return { consent: first(inserted, "consent_records"), marketingEmailStatus: refreshed.marketingEmailStatus };
  });
}

/* suppressions */

export async function listSuppressions(
  db: Database,
  actor: Actor,
  organizationId: string,
  scope: "active" | "all" = "active",
) {
  await authorize(db, actor, organizationId, "contacts.read");
  const conditions = [eq(schema.contactSuppressions.organizationId, organizationId)];
  if (scope === "active") conditions.push(isNull(schema.contactSuppressions.liftedAt));
  const rows = await db
    .select({ s: schema.contactSuppressions, by: schema.users.name })
    .from(schema.contactSuppressions)
    .leftJoin(schema.users, eq(schema.users.id, schema.contactSuppressions.createdBy))
    .where(and(...conditions))
    .orderBy(desc(schema.contactSuppressions.createdAt))
    .limit(500);
  return rows.map(({ s, by }) => ({
    id: s.id,
    email: s.email,
    reason: s.reason,
    source: s.source,
    note: s.note,
    createdBy: by ?? null,
    createdAt: s.createdAt,
    liftedAt: s.liftedAt,
    liftReason: s.liftReason,
  }));
}

/** Add an e-mail to the suppression list. Used by staff (manual) and, in phase 8, by unsubscribe links and bounces. */
export async function suppressEmail(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  input: SuppressionInput & { source?: CrmSource },
): Promise<{ id: string; created: boolean }> {
  if (actor.kind === "user") await authorize(db, actor, organizationId, "contacts.manage");
  const v = suppressionSchema.parse(input);
  const email = normalizeEmail(v.email);
  const existing = await db
    .select({ id: schema.contactSuppressions.id })
    .from(schema.contactSuppressions)
    .where(
      and(
        eq(schema.contactSuppressions.organizationId, organizationId),
        eq(schema.contactSuppressions.email, email),
        isNull(schema.contactSuppressions.liftedAt),
      ),
    )
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  const inserted = await db
    .insert(schema.contactSuppressions)
    .values({
      organizationId,
      email,
      reason: v.reason,
      source: input.source ?? "staff",
      note: v.note ?? null,
      createdBy: actor.kind === "user" ? actor.userId : null,
    })
    .returning({ id: schema.contactSuppressions.id });
  await recordAudit(db, actor, {
    organizationId,
    action: "contact.suppressed",
    targetType: "contact_suppression",
    targetId: inserted[0]?.id ?? null,
    reason: v.note ?? null,
    metadata: { email, reason: v.reason },
  });
  const contact = await resolveContactByIdentity(db, organizationId, "email", email);
  if (contact) await refreshContact(db, organizationId, contact.id);
  return { id: inserted[0]?.id ?? "", created: true };
}

export async function liftSuppression(
  db: Database,
  actor: Actor,
  organizationId: string,
  suppressionId: string,
  input: { reason: string },
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = liftSuppressionSchema.parse(input);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contactSuppressions)
      .where(
        and(
          eq(schema.contactSuppressions.id, suppressionId),
          eq(schema.contactSuppressions.organizationId, organizationId),
        ),
      )
      .limit(1);
    const s = rows[0];
    if (!s) throw new NotFoundError("contact_suppression", suppressionId);
    if (s.liftedAt) throw new PreconditionFailedError("Exclusion déjà levée.");
    await tx
      .update(schema.contactSuppressions)
      .set({ liftedAt: new Date(), liftedBy: actor.kind === "user" ? actor.userId : null, liftReason: v.reason })
      .where(eq(schema.contactSuppressions.id, s.id));
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.suppression_lifted",
      targetType: "contact_suppression",
      targetId: s.id,
      reason: v.reason,
      metadata: { email: s.email },
    });
    const contact = await resolveContactByIdentity(tx, organizationId, "email", s.email);
    if (contact) await refreshContact(tx, organizationId, contact.id);
  });
}

/* duplicates & merge */

export async function findDuplicates(db: Database, actor: Actor, organizationId: string) {
  await authorize(db, actor, organizationId, "contacts.read");
  const rows = await db.execute<{ key: string; kind: string; ids: string[] }>(sql`
    select kind, key, array_agg(id order by first_seen_at) as ids from (
      select 'phone' as kind, ci.value as key, c.id, c.first_seen_at
      from contact_identities ci join contacts c on c.id = ci.contact_id
      where ci.organization_id = ${organizationId} and ci.kind = 'phone' and c.status = 'active'
      union all
      select 'name' as kind, lower(c.first_name) || ' ' || lower(c.last_name) as key, c.id, c.first_seen_at
      from contacts c
      where c.organization_id = ${organizationId} and c.status = 'active'
        and c.first_name is not null and c.last_name is not null
    ) x group by kind, key having count(*) > 1 order by kind, key limit 100
  `);
  const ids = [...new Set(rows.rows.flatMap((r) => r.ids))];
  const contacts = ids.length ? await db.select().from(schema.contacts).where(inArray(schema.contacts.id, ids)) : [];
  const byId = new Map(contacts.map((c) => [c.id, toListItem(c, [])]));
  return rows.rows.map((r) => ({
    kind: r.kind as "phone" | "name",
    key: r.key,
    contacts: r.ids.map((id) => byId.get(id)).filter((c): c is ContactListItem => Boolean(c)),
  }));
}

export async function mergeContacts(
  db: Database,
  actor: Actor,
  organizationId: string,
  survivingContactId: string,
  input: MergeInput,
) {
  await authorize(db, actor, organizationId, "contacts.manage");
  const v = mergeSchema.parse(input);
  if (v.mergedContactId === survivingContactId)
    throw new ValidationError({ mergedContactId: ["Choisissez un autre contact."] });
  return db.transaction(async (tx) => {
    // Lock both rows in a stable order to avoid deadlocks between concurrent merges.
    const ids = [survivingContactId, v.mergedContactId].sort();
    await tx.execute(
      sql`select id from contacts where organization_id = ${organizationId} and id in ${sqlList(ids)} order by id for update`,
    );
    const s = await loadContact(tx, organizationId, survivingContactId);
    const m = await loadContact(tx, organizationId, v.mergedContactId);
    if (s.status !== "active") throw new PreconditionFailedError("La fiche survivante doit être active.");
    if (m.status !== "active") throw new PreconditionFailedError("La fiche à fusionner doit être active.");
    const snapshot = {
      contact: m,
      identities: await tx.select().from(schema.contactIdentities).where(eq(schema.contactIdentities.contactId, m.id)),
      tags: await tx
        .select()
        .from(schema.contactTagAssignments)
        .where(eq(schema.contactTagAssignments.contactId, m.id)),
      notes: await tx.select().from(schema.contactNotes).where(eq(schema.contactNotes.contactId, m.id)),
      consents: await tx.select().from(schema.consentRecords).where(eq(schema.consentRecords.contactId, m.id)),
    };
    // Identities: move what the survivor lacks, drop the rest (unique per organization).
    for (const i of snapshot.identities) {
      const clash = await tx
        .select({ id: schema.contactIdentities.id })
        .from(schema.contactIdentities)
        .where(
          and(
            eq(schema.contactIdentities.contactId, s.id),
            eq(schema.contactIdentities.kind, i.kind),
            eq(schema.contactIdentities.value, i.value),
          ),
        )
        .limit(1);
      if (clash.length > 0) await tx.delete(schema.contactIdentities).where(eq(schema.contactIdentities.id, i.id));
      else
        await tx
          .update(schema.contactIdentities)
          .set({ contactId: s.id, isPrimary: false })
          .where(eq(schema.contactIdentities.id, i.id));
    }
    // Tags, notes, consents, segment memberships, previous merges.
    for (const t of snapshot.tags) {
      await tx
        .insert(schema.contactTagAssignments)
        .values({ organizationId, contactId: s.id, tagId: t.tagId, assignedBy: t.assignedBy })
        .onConflictDoNothing();
    }
    await tx.delete(schema.contactTagAssignments).where(eq(schema.contactTagAssignments.contactId, m.id));
    await tx.update(schema.contactNotes).set({ contactId: s.id }).where(eq(schema.contactNotes.contactId, m.id));
    await tx.update(schema.consentRecords).set({ contactId: s.id }).where(eq(schema.consentRecords.contactId, m.id));
    const members = await tx.select().from(schema.segmentMembers).where(eq(schema.segmentMembers.contactId, m.id));
    for (const sm of members) {
      await tx
        .insert(schema.segmentMembers)
        .values({ organizationId, segmentId: sm.segmentId, contactId: s.id, addedBy: sm.addedBy })
        .onConflictDoNothing();
    }
    await tx.delete(schema.segmentMembers).where(eq(schema.segmentMembers.contactId, m.id));
    await tx
      .update(schema.contactMergeRecords)
      .set({ survivingContactId: s.id })
      .where(eq(schema.contactMergeRecords.survivingContactId, m.id));
    await tx
      .update(schema.contacts)
      .set({ mergedIntoContactId: s.id })
      .where(and(eq(schema.contacts.mergedIntoContactId, m.id), eq(schema.contacts.organizationId, organizationId)));
    // Survivor: fill blanks only; never overwrite what the survivor already holds.
    await tx
      .update(schema.contacts)
      .set({
        firstName: s.firstName ?? m.firstName,
        lastName: s.lastName ?? m.lastName,
        phone: s.phone ?? m.phone,
        city: s.city ?? m.city,
        userId: s.userId ?? m.userId,
        firstSeenAt: new Date(Math.min(s.firstSeenAt.getTime(), m.firstSeenAt.getTime())),
        version: s.version + 1,
      })
      .where(eq(schema.contacts.id, s.id));
    await tx
      .update(schema.contacts)
      .set({ status: "merged", mergedIntoContactId: s.id, userId: null, version: m.version + 1 })
      .where(eq(schema.contacts.id, m.id));
    const rec = await tx
      .insert(schema.contactMergeRecords)
      .values({
        organizationId,
        survivingContactId: s.id,
        mergedContactId: m.id,
        snapshot,
        reason: v.reason ?? null,
        mergedBy: actor.kind === "user" ? actor.userId : null,
      })
      .returning({ id: schema.contactMergeRecords.id });
    await recordAudit(tx, actor, {
      organizationId,
      action: "contact.merged",
      targetType: "contact",
      targetId: s.id,
      reason: v.reason ?? null,
      metadata: { mergedContactId: m.id, mergedEmail: m.primaryEmail, mergeRecordId: rec[0]?.id },
    });
    const refreshed = await refreshContact(tx, organizationId, s.id);
    return { survivor: toListItem(refreshed, []), mergeRecordId: rec[0]?.id ?? "" };
  });
}

/* export */

export async function exportContactsCsv(
  db: Database,
  actor: Actor,
  organizationId: string,
  input: ListContactsInput = {},
): Promise<{ filename: string; csv: string; count: number }> {
  await authorize(db, actor, organizationId, "contacts.export");
  const f = listContactsSchema.parse({ ...input, page: 1, pageSize: 100 });
  const all: ContactListItem[] = [];
  let page = 1;
  for (;;) {
    const res = await listContacts(db, actor, organizationId, { ...f, page, pageSize: 100 });
    all.push(...res.contacts);
    if (res.contacts.length < 100 || all.length >= 50_000) break;
    page += 1;
  }
  const header = [
    "email",
    "prenom",
    "nom",
    "ville",
    "statut_marketing",
    "etiquettes",
    "commandes",
    "billets",
    "adhesions",
    "candidatures",
    "missions",
    "compte",
    "derniere_activite",
    "premier_contact",
  ];
  const lines = all.map((c) =>
    [
      c.email,
      c.firstName,
      c.lastName,
      c.city,
      MARKETING_EMAIL_STATUS_LABELS[c.marketingEmailStatus],
      c.tags.map((t) => t.name).join(", "),
      c.ordersCount,
      c.ticketsCount,
      c.membershipsCount,
      c.applicationsCount,
      c.missionsCount,
      c.hasAccount ? "oui" : "non",
      c.lastActivityAt?.toISOString() ?? "",
      c.firstSeenAt.toISOString(),
    ]
      .map(csvEscape)
      .join(";"),
  );
  const csv = `﻿${header.join(";")}\n${lines.join("\n")}\n`;
  await db.transaction(async (tx) => {
    await recordAudit(tx, actor, {
      organizationId,
      action: "contacts.exported",
      targetType: "organization",
      targetId: organizationId,
      metadata: { count: all.length, filters: { ...f, page: undefined, pageSize: undefined } },
    });
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `contacts-${stamp}.csv`, csv, count: all.length };
}
