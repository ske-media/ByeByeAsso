import { exportEventReportCsv } from "@kroov/domain/analytics";
import { uuidSchema } from "@kroov/validation";
import { apiRoute } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string };

/** GET — analytics.read (or event-scoped events.read): event report as CSV; audited. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, eventId }) => {
  const out = await exportEventReportCsv(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId));
  return new Response(out.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${out.filename}"`,
      "x-row-count": String(out.count),
    },
  });
});
