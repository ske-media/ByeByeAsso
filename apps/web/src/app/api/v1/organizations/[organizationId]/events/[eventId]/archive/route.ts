import { archiveEvent } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/** POST — events.update; body { version }. Draft, completed or cancelled → archived (terminal). */
export const POST = apiRoute<{ organizationId: string; eventId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, eventId }) => {
    const { version } = await parseBody(ctx.request, z.object({ version: z.coerce.number().int().min(1) }));
    return ok(
      await archiveEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), version),
    );
  },
);
