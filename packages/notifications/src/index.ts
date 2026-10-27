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

export { ConsoleEmailAdapter } from "./console";
export { createEmailPort, type EmailPortConfig } from "./factory";
export { FileEmailAdapter } from "./file";
export { SmtpEmailAdapter } from "./smtp";
export * from "./templates/layout";
