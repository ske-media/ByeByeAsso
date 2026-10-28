import {
  checkAudience,
  previewCampaign,
  scheduleCampaign,
  scheduleSchema,
  sendTestEmail,
  unscheduleCampaign,
} from "@kroov/domain/marketing";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { marketingContext } from "@/lib/marketing";

type Params = { organizationId: string; campaignId: string; action: string };

/** GET preview · POST test | check { includeCustomerException? } | schedule { sendAt?, includeCustomerException?, legalNote?, version? } | unschedule. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId, action }) => {
  if (action !== "preview") return apiError(404, "not_found", "Action inconnue.");
  return ok(
    await previewCampaign(
      db(),
      marketingContext(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(campaignId),
    ),
  );
});
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, campaignId, action }) => {
  const orgId = uuidSchema.parse(organizationId);
  const id = uuidSchema.parse(campaignId);
  switch (action) {
    case "test":
      return ok(await sendTestEmail(db(), marketingContext(), ctx.actor, orgId, id));
    case "check": {
      const body = await parseBody(ctx.request, z.object({ includeCustomerException: z.boolean().optional() }));
      return ok(await checkAudience(db(), ctx.actor, orgId, id, body.includeCustomerException));
    }
    case "schedule": {
      const body = await parseBody(ctx.request, scheduleSchema);
      return ok(await scheduleCampaign(db(), ctx.actor, orgId, id, body));
    }
    case "unschedule":
      return ok(await unscheduleCampaign(db(), ctx.actor, orgId, id));
    default:
      return apiError(404, "not_found", "Action inconnue.");
  }
});
