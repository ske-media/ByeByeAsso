/**
 * Notification port. Transactional e-mail (order confirmation, invitation, schedule
 * publication) and marketing campaigns both go through this interface, but marketing
 * dispatch additionally checks consent and suppression lists before every send.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  /** Required for campaign mail; transactional mail passes none. */
  readonly listUnsubscribeUrl?: string;
  /** Correlation id stored in message_deliveries (Phase 8). */
  readonly deliveryId?: string;
}

export interface EmailSendResult {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}

export interface EmailPort {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Development adapter: logs the message and records it in memory so tests can assert on it.
 * Never used when NODE_ENV=production (guarded in the factory, Phase 1).
 */
export class ConsoleEmailAdapter implements EmailPort {
  readonly name = "console";
  readonly sent: EmailMessage[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    this.log(`[email:console] → ${message.to} | ${message.subject}`);
    return { providerMessageId: `console-${this.sent.length}`, acceptedAt: new Date() };
  }
}
