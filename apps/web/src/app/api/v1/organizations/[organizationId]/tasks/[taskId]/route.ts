import { deleteTask, getTask, updateTask } from "@kroov/domain/tasks";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; taskId: string };

/** GET — organization.read. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, taskId }) => {
  return ok(await getTask(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(taskId)));
});

/** PATCH — tasks.manage (optimistic `version`; 409 stale_version). */
export const PATCH = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, taskId }) => {
  const body = await parseBody(ctx.request, z.record(z.string(), z.unknown()));
  return ok(await updateTask(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(taskId), body));
});

/** DELETE — tasks.manage. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, taskId }) => {
  await deleteTask(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(taskId));
  return noContent();
});
