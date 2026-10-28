import type { DbExecutor } from "@kroov/database";
import { schema } from "@kroov/database";
import { and, eq } from "drizzle-orm";

/**
 * Double-entry ledger per organization. Signed amounts: debit > 0, credit < 0, and every
 * transaction sums to zero (asserted before insert). Accounts are created lazily.
 *
 * order_paid     : D receivable_provider (total) · C revenue_tickets (subtotal − discount) · C platform_fees (fees)
 * order_refunded : D revenue_tickets (ticket part) · D platform_fees (fee part) · C receivable_provider (amount)
 */
type Kind = (typeof schema.ledgerAccounts.$inferSelect)["kind"];

async function accountId(tx: DbExecutor, organizationId: string, kind: Kind, currency: string): Promise<string> {
  const rows = await tx
    .select({ id: schema.ledgerAccounts.id })
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.organizationId, organizationId),
        eq(schema.ledgerAccounts.kind, kind),
        eq(schema.ledgerAccounts.currency, currency),
      ),
    )
    .limit(1);
  if (rows[0]) return rows[0].id;
  const [created] = await tx
    .insert(schema.ledgerAccounts)
    .values({ organizationId, kind, currency })
    .returning({ id: schema.ledgerAccounts.id });
  if (!created) throw new Error("ledger account insert failed");
  return created.id;
}

export async function postLedgerTransaction(
  tx: DbExecutor,
  input: {
    organizationId: string;
    kind: "order_paid" | "order_refunded";
    orderId: string | null;
    reference: string;
    description: string;
    currency: string;
    entries: Array<{ account: Kind; amountMinor: number }>;
  },
): Promise<void> {
  const nonZero = input.entries.filter((e) => e.amountMinor !== 0);
  const sum = nonZero.reduce((a, e) => a + e.amountMinor, 0);
  if (sum !== 0) throw new Error(`Écriture déséquilibrée (${sum}) pour ${input.reference}`);
  if (nonZero.length === 0) return;
  const [t] = await tx
    .insert(schema.ledgerTransactions)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      orderId: input.orderId,
      reference: input.reference,
      description: input.description,
    })
    .returning({ id: schema.ledgerTransactions.id });
  if (!t) throw new Error("ledger transaction insert failed");
  for (const e of nonZero) {
    await tx.insert(schema.ledgerEntries).values({
      organizationId: input.organizationId,
      transactionId: t.id,
      accountId: await accountId(tx, input.organizationId, e.account, input.currency),
      amountMinor: e.amountMinor,
    });
  }
}

export async function recordOrderPaidLedger(tx: DbExecutor, order: typeof schema.orders.$inferSelect): Promise<void> {
  if (order.totalMinor === 0) return;
  await postLedgerTransaction(tx, {
    organizationId: order.organizationId,
    kind: "order_paid",
    orderId: order.id,
    reference: order.number,
    description: `Commande ${order.number} payée`,
    currency: order.currency,
    entries: [
      { account: "receivable_provider", amountMinor: order.totalMinor },
      { account: "revenue_tickets", amountMinor: -(order.subtotalMinor - order.discountMinor) },
      { account: "platform_fees", amountMinor: -order.feesMinor },
    ],
  });
}

export async function recordRefundLedger(
  tx: DbExecutor,
  order: typeof schema.orders.$inferSelect,
  refund: { id: string; amountMinor: number; ticketPartMinor: number; feePartMinor: number },
): Promise<void> {
  await postLedgerTransaction(tx, {
    organizationId: order.organizationId,
    kind: "order_refunded",
    orderId: order.id,
    reference: `${order.number}/R${refund.id.slice(0, 8)}`,
    description: `Remboursement sur ${order.number}`,
    currency: order.currency,
    entries: [
      { account: "revenue_tickets", amountMinor: refund.ticketPartMinor },
      { account: "platform_fees", amountMinor: refund.feePartMinor },
      { account: "receivable_provider", amountMinor: -refund.amountMinor },
    ],
  });
}

/** Balance per account kind (minor units, debit positive). Used by tests and phase 7. */
export async function ledgerBalances(db: DbExecutor, organizationId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ kind: schema.ledgerAccounts.kind, amount: schema.ledgerEntries.amountMinor })
    .from(schema.ledgerEntries)
    .innerJoin(schema.ledgerAccounts, eq(schema.ledgerAccounts.id, schema.ledgerEntries.accountId))
    .where(eq(schema.ledgerEntries.organizationId, organizationId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + r.amount;
  return out;
}
