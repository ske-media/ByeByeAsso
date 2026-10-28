import { markRead, markReadSchema } from "@kroov/domain/notifications";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** POST { ids } | { all: true } — marks the caller's own notifications as read. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, markReadSchema);
  return ok(await markRead(db(), ctx.actor, uuidSchema.parse(organizationId), body));
});
