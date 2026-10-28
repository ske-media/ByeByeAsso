import { exportTasksCsv } from "@kroov/domain/tasks";
import { uuidSchema } from "@kroov/validation";
import { apiRoute } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — organization.read: all tasks as CSV; audited. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const csv = await exportTasksCsv(db(), ctx.actor, uuidSchema.parse(organizationId));
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="taches-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
