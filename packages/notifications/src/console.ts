import type { EmailMessage, EmailPort, EmailSendResult } from "./index";

/**
 * Development adapter: logs the message and records it in memory so tests can assert on it.
 * Refused in production by the factory.
 */
export class ConsoleEmailAdapter implements EmailPort {
  readonly name = "console";
  readonly sent: EmailMessage[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    // Links are printed so a developer can follow verification / reset / invitation flows.
    const links = [...message.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
    this.log(`[email:console] → ${message.to} | ${message.subject}${links.length ? `\n  ${links.join("\n  ")}` : ""}`);
    return { providerMessageId: `console-${this.sent.length}`, acceptedAt: new Date() };
  }

  /** Test helper: last message sent to an address. */
  lastTo(address: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === address);
  }
}
