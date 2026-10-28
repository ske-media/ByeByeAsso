import { exportFinanceJournalCsv } from "@kroov/domain/analytics";
import { uuidSchema } from "@kroov/validation";
import { apiRoute } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — analytics.read: financial journal as CSV (UTF-8 BOM, `;`), one line per ledger entry; audited. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const out = await exportFinanceJournalCsv(db(), ctx.actor, uuidSchema.parse(organizationId));
  return new Response(out.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${out.filename}"`,
      "x-row-count": String(out.count),
    },
  });
});
