import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EmailMessage, EmailPort, EmailSendResult } from "./index";

/**
 * Test adapter: appends each message as one JSON line to a file so end-to-end tests
 * can read verification / reset / invitation links. Refused in production and staging.
 */
export class FileEmailAdapter implements EmailPort {
  readonly name = "file";
  private counter = 0;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.counter += 1;
    const record = { ...message, sentAt: new Date().toISOString(), id: `file-${process.pid}-${this.counter}` };
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    return { providerMessageId: record.id, acceptedAt: new Date() };
  }
}
