import { exportContactsCsv, listContactsSchema } from "@kroov/domain/crm";
import { uuidSchema } from "@kroov/validation";
import { apiRoute } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — contacts.export: CSV (UTF-8 BOM, `;`), same filters as the list; audited with the row count. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listContactsSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const out = await exportContactsCsv(db(), ctx.actor, uuidSchema.parse(organizationId), input);
  return new Response(out.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${out.filename}"`,
      "x-row-count": String(out.count),
    },
  });
});
