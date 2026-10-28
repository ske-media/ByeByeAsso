import { unassignVolunteer } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string; assignmentId: string };

/** DELETE — volunteers.schedule: remove an assignment from an editable version. */
export const DELETE = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId, assignmentId }) =>
  ok(
    await unassignVolunteer(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(versionId),
      uuidSchema.parse(assignmentId),
    ),
  ),
);
