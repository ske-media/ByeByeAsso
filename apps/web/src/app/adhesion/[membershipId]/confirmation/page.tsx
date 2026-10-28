import { NotFoundError } from "@kroov/domain/kernel";
import { getMembershipForMember } from "@kroov/domain/memberships";
import { Button } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketingContext } from "@/lib/ticketing";
import { MembershipStatusPoller } from "./status-poller";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmation", robots: { index: false } };

/** Retour du paiement : on attend l'activation (webhook) puis on renvoie vers la carte. */
export default async function MembershipConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ membershipId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { membershipId } = await params;
  const sp = await searchParams;
  const session = await currentSession();
  let m: Awaited<ReturnType<typeof getMembershipForMember>>;
  try {
    m = await getMembershipForMember(db(), ticketingContext(), membershipId, {
      accessToken: sp.k ?? null,
      actor: session?.actor,
      email: session?.user.emailVerified ? session.user.email : undefined,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (m.status !== "awaiting_payment") redirect(`/adhesion/${m.id}?k=${encodeURIComponent(m.accessToken)}&nouveau=1`);
  return (
    <AppPublicShell back={{ href: `/${m.organizationSlug}`, label: m.organizationName }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{m.organizationName}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">Merci.</h1>
        <div className="mt-4">
          <MembershipStatusPoller membershipId={m.id} accessToken={m.accessToken} status={m.status} />
        </div>
        <div className="mt-4">
          <Button asChild variant="secondary">
            <Link href={`/adhesion/${m.id}?k=${encodeURIComponent(m.accessToken)}`}>Voir mon adhésion</Link>
          </Button>
        </div>
      </div>
    </AppPublicShell>
  );
}
