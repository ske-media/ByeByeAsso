import { listRecipients } from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; campaignId: string };

/** GET — campaigns.manage: ?status=pending|sent|failed|skipped|bounced|unsubscribed&page&pageSize. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId }) => {
  const sp = new URL(ctx.request.url).searchParams;
  return ok(
    await listRecipients(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(campaignId), {
      ...(sp.get("status") ? { status: sp.get("status") as string } : {}),
      page: Number(sp.get("page") ?? "1"),
      pageSize: Number(sp.get("pageSize") ?? "50"),
    }),
  );
});
