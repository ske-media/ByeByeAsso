import { attendanceSchema, recordAttendance } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, noContent, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; assignmentId: string };

/** PUT — volunteers.schedule or checkins.scan: { status: present|absent|late|excused, note? } on a published assignment. */
export const PUT = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, assignmentId }) => {
  const input = await parseBody(ctx.request, attendanceSchema);
  await recordAttendance(db(), ctx.actor, uuidSchema.parse(organizationId), uuidSchema.parse(assignmentId), input);
  return noContent();
});
