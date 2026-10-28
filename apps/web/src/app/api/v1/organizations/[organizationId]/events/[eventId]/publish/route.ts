import { publishEvent } from "@kroov/domain/events";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

/** POST — events.publish; body { version }. 412 publication_blocked with the failing checklist keys. */
export const POST = apiRoute<{ organizationId: string; eventId: string }>(
  { auth: "required" },
  async (ctx, { organizationId, eventId }) => {
    const { version } = await parseBody(ctx.request, z.object({ version: z.coerce.number().int().min(1) }));
    return ok(
      await publishEvent(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(eventId), version),
    );
  },
);
