import { createTask, listTasks, listTasksSchema } from "@kroov/domain/tasks";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, created, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string };

/** GET — organization.read: ?status=open|todo|doing|done|all&mine&eventId&overdue&page&pageSize. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const url = new URL(ctx.request.url);
  const input = listTasksSchema.parse(Object.fromEntries(url.searchParams.entries()));
  return ok(await listTasks(db(), ctx.actor, uuidSchema.parse(organizationId), input));
});

/** POST — tasks.manage. */
export const POST = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId }) => {
  const body = await parseBody(ctx.request, z.record(z.string(), z.unknown()));
  const orgId = uuidSchema.parse(organizationId);
  const task = await createTask(db(), ctx.actor, orgId, body);
  return created(task, `/organizations/${orgId}/tasks/${task.id}`);
});
