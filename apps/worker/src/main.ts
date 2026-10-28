import { resolve } from "node:path";
import { loadServerEnv } from "@kroov/config/env";
import { createDatabase } from "@kroov/database";
import { config as loadDotenv } from "dotenv";
import pino from "pino";
import { registerEventJobs } from "./jobs/events";
import { registerMaintenanceJobs } from "./jobs/maintenance";
import { registerMembershipJobs } from "./jobs/memberships";
import { registerOutboxRelay } from "./jobs/outbox-relay";
import { registerTicketingJobs } from "./jobs/ticketing";
import { createQueue } from "./queue";

// Repo-root .env; existing process variables win.
loadDotenv({ path: resolve(import.meta.dirname, "../../../.env"), override: false, quiet: true });

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", base: { app: "kroov-worker" } });

async function main(): Promise<void> {
  const env = loadServerEnv();
  const database = createDatabase({
    connectionString: env.DATABASE_URL,
    poolMax: Math.max(2, env.WORKER_CONCURRENCY),
    applicationName: "kroov-worker",
  });

  const queue = await createQueue({ connectionString: env.DATABASE_URL, logger });

  await registerOutboxRelay({ queue, db: database.db, logger });
  await registerMaintenanceJobs({ queue, db: database.db, logger });
  await registerEventJobs({ queue, db: database.db, logger });
  await registerTicketingJobs({ queue, db: database.db, env, logger });
  await registerMembershipJobs({ queue, db: database.db, env, logger });

  logger.info({ concurrency: env.WORKER_CONCURRENCY }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    try {
      await queue.stop({ graceful: true, timeout: 15_000 });
      await database.close();
      logger.info("worker stopped");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ error }, "worker failed to start");
  process.exit(1);
});
