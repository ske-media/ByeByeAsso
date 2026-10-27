import "server-only";
import pino from "pino";

/**
 * Structured JSON logger. Redacts anything that could carry a secret or a QR credential.
 * Never log payment secrets, QR credentials or unnecessary personal data.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.secret",
      "*.token",
      "*.qrCredential",
      "*.cardNumber",
    ],
    censor: "[redacted]",
  },
  base: { app: "kroov-web" },
});
