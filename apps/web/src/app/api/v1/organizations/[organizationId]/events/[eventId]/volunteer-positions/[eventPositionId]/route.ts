import { deactivateEventPosition, updateEventPosition } from "@kroov/domain/volunteers";
import { uuidSchema } from "@kroov/validation";
import { z } from "zod";
import { apiRoute, noContent, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; eventPositionId: string };

/** PATCH — volunteers.schedule: event-specific briefing. */
export const PATCH = apiRoute<Params>(
  { auth: "required" },
  async (ctx, { organizationId, eventId, eventPositionId }) => {
    const input = await parseBody(
      ctx.request,
      z.object({ briefing: z.string().trim().max(4000).nullable().optional() }),
    );
    return ok(
      await updateEventPosition(
        db(),
        ctx.actor,
        uuidSchema.parse(organizationId),
        uuidSchema.parse(eventId),
        uuidSchema.parse(eventPositionId),
        input,
      ),
    );
  },
);

/** DELETE — volunteers.schedule: deactivate on this event (its shifts are cancelled). */
export const DELETE = apiRoute<Params>(
  { auth: "required" },
  async (ctx, { organizationId, eventId, eventPositionId }) => {
    await deactivateEventPosition(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(eventId),
      uuidSchema.parse(eventPositionId),
    );
    return noContent();
  },
);
