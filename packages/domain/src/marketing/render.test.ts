import { describe, expect, it } from "vitest";
import { extractLinks, parseBlocks, personalize, renderCampaign, withSourceParams } from "./render";

const base = {
  subject: "Bonjour {{prenom}}, Les Nuits reviennent",
  preheader: "Billets en vente",
  organizationName: "Le Collectif des Nuits",
  unsubscribeUrl: "https://kroov.local/desinscription/tok",
  vars: { prenom: "Lou", nom: "Martin", email: "lou@example.fr" },
};

describe("campaign rendering", () => {
  it("personalises placeholders and escapes everything else (no raw HTML)", () => {
    expect(personalize("Salut {{ prenom }} {{inconnu}}!", { prenom: "Lou" })).toBe("Salut Lou !");
    const out = renderCampaign({ ...base, body: "# Hé <script>alert(1)</script>\n\n**{{prenom}}** & co" });
    expect(out.subject).toBe("Bonjour Lou, Les Nuits reviennent");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("<strong>Lou</strong> &amp; co");
    expect(out.text).toContain("HÉ <SCRIPT>ALERT(1)</SCRIPT>");
    expect(out.text).toContain("Se désinscrire : https://kroov.local/desinscription/tok");
    expect(out.html).toContain('href="https://kroov.local/desinscription/tok"');
  });

  it("parses headings, lists, paragraphs and buttons; rewrites links through the tracker", () => {
    const body = [
      "## Au programme",
      "- Trois scènes",
      "- Un espace calme",
      "",
      "Réservez vos [billets](https://kroov.local/collectif/nuits) dès maintenant.",
      "",
      "> [Je réserve](https://kroov.local/collectif/nuits/billets)",
      "> [Lien douteux](javascript:alert(1))",
    ].join("\n");
    expect(parseBlocks(body).map((b) => b.kind)).toEqual(["h2", "ul", "p", "button", "p"]);
    expect(extractLinks(body)).toEqual([
      "https://kroov.local/collectif/nuits",
      "https://kroov.local/collectif/nuits/billets",
    ]);
    const out = renderCampaign({ ...base, body, rewriteUrl: (u) => `https://kroov.local/l/${encodeURIComponent(u)}` });
    expect(out.html).toContain('href="https://kroov.local/l/https%3A%2F%2Fkroov.local%2Fcollectif%2Fnuits"');
    expect(out.html).toContain("Je réserve</a>");
    expect(out.html).not.toContain('href="javascript');
    expect(out.text).toContain("billets (https://kroov.local/l/https%3A%2F%2Fkroov.local%2Fcollectif%2Fnuits)");
    expect(out.text).toContain("- Trois scènes");
  });

  it("adds utm parameters without overriding existing query keys", () => {
    expect(
      withSourceParams("https://x.test/p?utm_source=keep&a=1", { utm_source: "kroov", utm_campaign: "nuits" }),
    ).toBe("https://x.test/p?utm_source=keep&a=1&utm_campaign=nuits");
    expect(withSourceParams("not a url", { kc: "x" })).toBe("not a url");
  });
});
