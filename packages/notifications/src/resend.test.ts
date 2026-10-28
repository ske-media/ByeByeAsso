import { describe, expect, it } from "vitest";
import { ResendEmailAdapter } from "./resend";

describe("ResendEmailAdapter", () => {
  it("builds the documented request: bearer auth, idempotency key, List-Unsubscribe headers, tags", () => {
    const adapter = new ResendEmailAdapter("re_test", "Kroov <no-reply@kroov.local>");
    const { url, init } = adapter.buildRequest({
      to: "lou@example.fr",
      subject: "Les Nuits en Commun",
      text: "Bonjour",
      html: "<p>Bonjour</p>",
      replyTo: "contact@collectif.test",
      listUnsubscribeUrl: "https://kroov.local/desinscription/abc",
      deliveryId: "d1",
    });
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("d1");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.to).toEqual(["lou@example.fr"]);
    expect(body.reply_to).toBe("contact@collectif.test");
    expect((body.headers as Record<string, string>)["List-Unsubscribe"]).toBe(
      "<https://kroov.local/desinscription/abc>",
    );
    expect((body.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.tags).toEqual([{ name: "delivery_id", value: "d1" }]);
  });

  it("returns the provider message id and fails loudly on an error status", async () => {
    const ok = new ResendEmailAdapter(
      "re_test",
      "no-reply@kroov.local",
      async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );
    expect((await ok.send({ to: "a@b.fr", subject: "s", text: "t" })).providerMessageId).toBe("msg_1");
    const ko = new ResendEmailAdapter(
      "re_test",
      "no-reply@kroov.local",
      async () => new Response("rate limited", { status: 429 }),
    );
    await expect(ko.send({ to: "a@b.fr", subject: "s", text: "t" })).rejects.toThrow(/429/);
  });
});
