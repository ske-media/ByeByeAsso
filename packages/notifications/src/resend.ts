import type { EmailMessage, EmailPort, EmailSendResult } from "./index";

/**
 * Resend adapter (HTTP API, no SDK dependency). Campaign volumes go through here in production.
 * External verification is pending: this environment has no outbound network, so the adapter is
 * covered by a unit test on the request it builds and by the provider's documented contract.
 */
export class ResendEmailAdapter implements EmailPort {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = "https://api.resend.com/emails",
  ) {}

  buildRequest(message: EmailMessage): { url: string; init: RequestInit } {
    const headers: Record<string, string> = {};
    if (message.listUnsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${message.listUnsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const body = {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(message.deliveryId ? { tags: [{ name: "delivery_id", value: message.deliveryId }] } : {}),
    };
    return {
      url: this.endpoint,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          ...(message.deliveryId ? { "idempotency-key": message.deliveryId } : {}),
        },
        body: JSON.stringify(body),
      },
    };
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { url, init } = this.buildRequest(message);
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error("Resend: réponse sans identifiant de message.");
    return { providerMessageId: data.id, acceptedAt: new Date() };
  }
}
