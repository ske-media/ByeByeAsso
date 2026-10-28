import "server-only";
import type { MarketingContext } from "@kroov/domain/marketing";
import { email } from "./email";
import { env } from "./env";

export function marketingContext(): MarketingContext {
  const e = env();
  if (!e.AUTH_SECRET) throw new Error("AUTH_SECRET est requis pour dériver les jetons de campagne.");
  return {
    email: email(),
    appName: e.APP_NAME,
    appUrl: e.APP_URL,
    credentialSecret: e.AUTH_SECRET,
    batchSize: e.CAMPAIGN_BATCH_SIZE,
  };
}
