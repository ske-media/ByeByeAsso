import { setAssignmentLock } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiError, apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string; assignmentId: string; action: string };

/** POST — volunteers.schedule: lock | unlock. */
export const POST = apiRoute<Params>(
  { auth: "required" },
  async (ctx, { organizationId, versionId, assignmentId, action }) => {
    if (action !== "lock" && action !== "unlock") return apiError(404, "not_found", "Action inconnue.");
    return ok(
      await setAssignmentLock(
        db(),
        ctx.actor,
        uuidSchema.parse(organizationId),
        uuidSchema.parse(versionId),
        uuidSchema.parse(assignmentId),
        action === "lock",
      ),
    );
  },
);
