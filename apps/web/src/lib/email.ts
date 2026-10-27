import "server-only";
import { createEmailPort, type EmailPort } from "@kroov/notifications";
import { env } from "./env";

const globalForEmail = globalThis as unknown as { __kroovEmail?: EmailPort };

export function email(): EmailPort {
  if (!globalForEmail.__kroovEmail) {
    const e = env();
    globalForEmail.__kroovEmail = createEmailPort({
      provider: e.EMAIL_PROVIDER,
      from: e.EMAIL_FROM,
      smtpUrl: e.SMTP_URL,
      filePath: e.EMAIL_FILE_PATH,
      resendApiKey: e.RESEND_API_KEY,
      appEnv: e.APP_ENV,
    });
  }
  return globalForEmail.__kroovEmail;
}

/** Context object expected by domain commands that send mail. */
export function invitationContext() {
  const e = env();
  return { email: email(), appName: e.APP_NAME, appUrl: e.APP_URL };
}
