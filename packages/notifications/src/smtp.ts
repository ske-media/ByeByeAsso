import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailPort, EmailSendResult } from "./index";

/**
 * SMTP adapter (Mailpit locally, any SMTP relay in production).
 * `smtpUrl` example: smtp://localhost:1025 or smtps://user:pass@smtp.example.com:465
 */
export class SmtpEmailAdapter implements EmailPort {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.listUnsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${message.listUnsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
    return { providerMessageId: String(info.messageId), acceptedAt: new Date() };
  }
}
