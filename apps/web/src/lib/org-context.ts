import "server-only";
import type { Permission } from "@kroov/auth";
import { contextHasPermission, loadMemberContext, type MemberContext } from "@kroov/domain/authorization";
import { NotFoundError } from "@kroov/domain/kernel";
import { getOrganizationForMember, listMyOrganizations, type OrganizationDetail } from "@kroov/domain/organizations";
import { notFound } from "next/navigation";
import { db } from "./db";
import { requireSession } from "./session";

export interface OrgPageContext {
  session: Awaited<ReturnType<typeof requireSession>>;
  organization: OrganizationDetail;
  member: MemberContext;
  can: (permission: Permission, eventId?: string) => boolean;
  myOrganizations: Awaited<ReturnType<typeof listMyOrganizations>>;
}

/**
 * Load everything an organizer page needs, enforcing: signed in + verified, active member
 * of the organization behind `slug` (404 otherwise — existence is not disclosed). Members whose
 * grants are all event-scoped get the shell too; each section then checks its own permission.
 * Permission checks for *actions* still happen in the domain services.
 */
export async function loadOrgPage(slug: string, pathname: string): Promise<OrgPageContext> {
  const session = await requireSession(pathname);
  let organization: OrganizationDetail;
  try {
    organization = await getOrganizationForMember(db(), session.actor, slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const member = await loadMemberContext(db(), session.user.id, organization.id);
  if (!member) notFound();
  const myOrganizations = await listMyOrganizations(db(), session.actor);
  return {
    session,
    organization,
    member,
    can: (permission, eventId) =>
      contextHasPermission(member, permission, { organizationId: organization.id, eventId }),
    myOrganizations,
  };
}
