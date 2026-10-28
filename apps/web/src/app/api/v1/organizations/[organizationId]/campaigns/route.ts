import { campaignInputSchema, createCampaign, listCampaigns, listCampaignsSchema } from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — campaigns.manage: ?status. POST — create a draft (segment and template must belong to the organization). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const { status } = listCampaignsSchema.parse({
    status: new URL(ctx.request.url).searchParams.get("status") ?? undefined,
  });
  return ok({ campaigns: await listCampaigns(db(), ctx.actor, uuidSchema.parse(organizationId), status) });
});
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, campaignInputSchema);
  return created(await createCampaign(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
