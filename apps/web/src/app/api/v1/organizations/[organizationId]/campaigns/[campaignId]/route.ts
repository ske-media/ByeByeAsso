import { campaignUpdateSchema, cancelCampaign, getCampaign, updateCampaign } from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";

type Params = { organizationId: string; campaignId: string };

/** GET — detail + report + preview. PATCH — draft only (412 campaign_locked otherwise). DELETE — cancel (before launch only). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId }) => {
  return ok(
    await getCampaign(
      db(),
      marketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(campaignId),
    ),
  );
});
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId }) => {
  const body = await parseBody(ctx.request, campaignUpdateSchema);
  return ok(
    await updateCampaign(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(campaignId), body),
  );
});
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId }) => {
  return ok(await cancelCampaign(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(campaignId)));
});
