import type { ServerEnv } from "@kroov/config/env";
import type { Database } from "@kroov/database";
import { expireOverdueOrders, reconcilePendingPayments, type TicketingContext } from "@kroov/domain/ticketing";
import { createEmailPort } from "@kroov/notifications";
import { createPaymentProvider } from "@kroov/payments";
import type { Logger } from "pino";
import { DEFAULT_QUEUE_OPTIONS, QUEUES, type Queue } from "../queue";

export function buildTicketingContext(env: ServerEnv): TicketingContext {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET est requis par le worker (identifiants de billets).");
  return {
    provider: createPaymentProvider({
      provider: env.PAYMENT_PROVIDER,
      appEnv: env.APP_ENV,
      appUrl: env.APP_URL,
      stripeSecretKey: env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
      fakeWebhookSecret: env.FAKE_PAYMENT_WEBHOOK_SECRET,
    }),
    email: createEmailPort({
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      smtpUrl: env.SMTP_URL,
      filePath: env.EMAIL_FILE_PATH,
      resendApiKey: env.RESEND_API_KEY,
      appEnv: env.APP_ENV,
    }),
    appName: env.APP_NAME,
    appUrl: env.APP_URL,
    credentialSecret: env.AUTH_SECRET,
    fees: { bps: env.PLATFORM_FEE_BPS, fixedMinor: env.PLATFORM_FEE_FIXED_MINOR },
  };
}

/**
 * - `orders.expire-holds` (every minute): overdue reservations → expired, seats released.
 * - `payments.reconcile` (every 10 min): payments pending for > 15 min are re-checked at the
 *   provider (lost webhook / outage) and processed as if their webhook had arrived.
 * The fake provider keeps sessions in the web process: reconciliation then reports `pending`
 * and leaves the order to the expiry job — documented limitation of the simulated provider.
 */
export async function registerTicketingJobs(ctx: {
  queue: Queue;
  db: Database;
  env: ServerEnv;
  logger: Logger;
}): Promise<void> {
  const ticketing = buildTicketingContext(ctx.env);
  await ctx.queue.createQueue(QUEUES.ordersExpire, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.ordersExpire, async () => {
    const count = await expireOverdueOrders(ctx.db, { kind: "system", job: QUEUES.ordersExpire });
    if (count > 0) ctx.logger.info({ count }, "overdue reservations expired");
  });
  await ctx.queue.schedule(QUEUES.ordersExpire, "* * * * *", undefined, { tz: "UTC" });

  await ctx.queue.createQueue(QUEUES.paymentsReconcile, DEFAULT_QUEUE_OPTIONS);
  await ctx.queue.work(QUEUES.paymentsReconcile, async () => {
    const count = await reconcilePendingPayments(ctx.db, ticketing, { kind: "system", job: QUEUES.paymentsReconcile });
    if (count > 0) ctx.logger.info({ count }, "pending payments reconciled");
  });
  await ctx.queue.schedule(QUEUES.paymentsReconcile, "*/10 * * * *", undefined, { tz: "UTC" });
}
