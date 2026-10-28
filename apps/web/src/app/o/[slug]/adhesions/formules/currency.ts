import "server-only";
import { type DbExecutor, schema } from "@kroov/database";
import { eq } from "drizzle-orm";

export async function getOrganizationCurrency(db: DbExecutor, organizationId: string): Promise<string> {
  const row = (
    await db
      .select({ c: schema.organizationSettings.currency })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId))
      .limit(1)
  )[0];
  return row?.c ?? "EUR";
}
