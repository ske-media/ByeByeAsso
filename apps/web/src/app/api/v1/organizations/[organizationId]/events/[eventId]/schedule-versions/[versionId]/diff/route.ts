import { diffVersions } from "@kroov/domain/scheduling";
import { uuidSchema } from "@kroov/validation";
import { apiRoute, ok } from "@/lib/api";
import { db } from "@/lib/db";

type Params = { organizationId: string; eventId: string; versionId: string };

/** GET — volunteers.review: ?against={versionId} → added / removed assignments. */
export const GET = apiRoute<Params>({ auth: "required" }, async (ctx, { organizationId, versionId }) => {
  const against = new URL(ctx.request.url).searchParams.get("against");
  return ok(
    await diffVersions(
      db(),
      ctx.actor,
      uuidSchema.parse(organizationId),
      uuidSchema.parse(versionId),
      against ? uuidSchema.parse(against) : null,
    ),
  );
});
