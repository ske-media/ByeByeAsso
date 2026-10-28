import { completeTask, reopenTask } from "@kroov/domain/tasks";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiError, apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; taskId: string; action: string };

/** POST complete | reopen — tasks.manage; optional { version }. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, taskId, action }) => {
  const orgId = uuidSchema.parse(organizationId);
  const id = uuidSchema.parse(taskId);
  const body = await parseBody(ctx.request, z.object({ version: z.number().int().min(1).optional() }).default({}));
  switch (action) {
    case "complete":
      return ok(await completeTask(db(), ctx.actor, orgId, id, body.version));
    case "reopen":
      return ok(await reopenTask(db(), ctx.actor, orgId, id, body.version));
    default:
      return apiError(404, "not_found", "Action inconnue.");
  }
});
