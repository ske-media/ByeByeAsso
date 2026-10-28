import { ConsoleEmailAdapter } from "./console";
import { FileEmailAdapter } from "./file";
import type { EmailPort } from "./index";
import { ResendEmailAdapter } from "./resend";
import { SmtpEmailAdapter } from "./smtp";

export interface EmailPortConfig {
  provider: "console" | "file" | "smtp" | "resend";
  from: string;
  /** Path for the file adapter (tests). */
  filePath?: string | undefined;
  smtpUrl?: string | undefined;
  resendApiKey?: string | undefined;
  /** Policy environment (APP_ENV), not NODE_ENV. */
  appEnv: "development" | "test" | "staging" | "production";
}

/**
 * Build the e-mail port from configuration. Fails loudly instead of silently
 * swallowing mail: production never gets the console adapter, and a provider
 * without its credentials is a configuration error.
 */
export function createEmailPort(config: EmailPortConfig): EmailPort {
  switch (config.provider) {
    case "console":
      if (config.appEnv === "production" || config.appEnv === "staging") {
        throw new Error("EMAIL_PROVIDER=console est interdit en production et en préproduction (APP_ENV).");
      }
      return new ConsoleEmailAdapter();
    case "file":
      if (config.appEnv === "production" || config.appEnv === "staging") {
        throw new Error("EMAIL_PROVIDER=file est interdit en production et en préproduction (APP_ENV).");
      }
      if (!config.filePath) throw new Error("EMAIL_FILE_PATH est requis avec EMAIL_PROVIDER=file.");
      return new FileEmailAdapter(config.filePath);
    case "smtp":
      if (!config.smtpUrl) throw new Error("SMTP_URL est requis avec EMAIL_PROVIDER=smtp.");
      return new SmtpEmailAdapter(config.smtpUrl, config.from);
    case "resend":
      if (!config.resendApiKey) throw new Error("RESEND_API_KEY est requis avec EMAIL_PROVIDER=resend.");
      return new ResendEmailAdapter(config.resendApiKey, config.from);
  }
}
