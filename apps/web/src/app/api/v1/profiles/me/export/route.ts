import { exportPersonalData } from "@kroov/domain/privacy";
import { apiRoute } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/profiles/me/export — the signed-in person's data as a downloadable JSON document; audited. */
export const GET = apiRoute({ auth: "required" }, async (ctx) => {
  const data = await exportPersonalData(db(), ctx.actor);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="kroov-mes-donnees-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
