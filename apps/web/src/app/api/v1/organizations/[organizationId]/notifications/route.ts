import { listNotifications, listNotificationsSchema } from "@kroov/domain/notifications";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — any active member: the caller's own notifications (?unread=true&limit). */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listNotificationsSchema.parse(Object.fromEntries(url.searchParams.entries()));
  return ok(await listNotifications(db(), ctx.actor, uuidSchema.parse(organizationId), input));
});
