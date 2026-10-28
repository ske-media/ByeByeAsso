import { listTickets } from "@kroov/domain/ticketing";
import { errorResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { loadOrgPage } from "@/lib/org-context";

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** GET — orders.read: participants export, one ticket per line (UTF-8 BOM, ; separator for Excel FR). */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  try {
    const ctx = await loadOrgPage(slug, `/o/${slug}/billetterie`);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("evenement") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const tickets = (await listTickets(db(), ctx.session.actor, ctx.organization.id, { eventId, q })).filter((t) =>
      ctx.can("orders.read", t.eventId),
    );
    const header = [
      "billet",
      "participant",
      "tarif",
      "etat",
      "commande",
      "email_acheteur",
      "evenement",
      "prix",
      "devise",
      "entree_le",
    ];
    const lines = tickets.map((t) =>
      [
        t.number,
        t.attendeeName,
        t.typeLabel,
        t.status,
        t.orderNumber,
        t.buyerEmail,
        t.eventTitle,
        (t.priceMinor / 100).toFixed(2),
        t.currency,
        t.usedAt?.toISOString() ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
    const body = `﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`;
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="participants-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
