import { NotFoundError } from "@kroov/domain/kernel";
import { getInvitationByToken } from "@kroov/domain/organizations";
import { Alert, Button, Panel, PanelTitle } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcceptInvitation, SwitchAccount } from "./accept";

export const metadata: Metadata = { title: "Invitation" };

/** Écran 48 — Invitation équipe. */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invitation: Awaited<ReturnType<typeof getInvitationByToken>>;
  try {
    invitation = await getInvitationByToken(db(), token);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const session = await currentSession();
  const nextPath = `/invitation/${token}`;
  const sameEmail = session ? session.user.email.toLowerCase() === invitation.email : false;

  return (
    <AppPublicShell>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">Invitation</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          {invitation.invitedByName} vous invite à rejoindre {invitation.organizationName}
        </h1>
        <Panel className="mt-6">
          <PanelTitle>Détails</PanelTitle>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted">Organisation</dt>
            <dd className="m-0 font-bold">{invitation.organizationName}</dd>
            <dt className="text-muted">Rôle</dt>
            <dd className="m-0 font-bold">{invitation.roleName}</dd>
            <dt className="text-muted">Compte attendu</dt>
            <dd className="m-0 font-bold">{invitation.emailHint}</dd>
            <dt className="text-muted">Valable jusqu'au</dt>
            <dd className="m-0 font-bold">
              {invitation.expiresAt.toLocaleDateString("fr-FR", {
                timeZone: "Europe/Paris",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </dd>
          </dl>
        </Panel>

        {invitation.status === "expired" ? (
          <Alert tone="warning" heading="Invitation expirée" className="mt-4">
            Les invitations sont valables 7 jours. Demandez à {invitation.invitedByName} ou à une personne
            administratrice de {invitation.organizationName} de vous la renvoyer : vous recevrez un nouveau lien.
          </Alert>
        ) : invitation.status === "revoked" ? (
          <Alert tone="error" heading="Invitation annulée" className="mt-4">
            Cette invitation a été annulée par l'organisation. Contactez-la si vous pensez qu'il s'agit d'une erreur.
          </Alert>
        ) : invitation.status === "accepted" ? (
          <Alert tone="success" heading="Invitation déjà acceptée" className="mt-4">
            Cette invitation a déjà servi.{" "}
            <Link href="/organisations" className="font-bold underline">
              Accéder à mes organisations
            </Link>
          </Alert>
        ) : !session ? (
          <div className="mt-6 space-y-3">
            <p className="text-muted">Connectez-vous ou créez un compte avec l'adresse invitée pour accepter.</p>
            <Button asChild variant="primary" fullWidth>
              <Link href={`/connexion?next=${encodeURIComponent(nextPath)}`}>Se connecter</Link>
            </Button>
            <Button asChild variant="secondary" fullWidth>
              <Link href={`/inscription?next=${encodeURIComponent(nextPath)}`}>Créer un compte</Link>
            </Button>
          </div>
        ) : !session.user.emailVerified ? (
          <div className="mt-6 space-y-3">
            <Alert tone="warning" heading="Adresse à confirmer">
              Confirmez votre adresse e-mail avant d'accepter l'invitation.
            </Alert>
            <Button asChild variant="primary" fullWidth>
              <Link
                href={`/verifier-email?email=${encodeURIComponent(session.user.email)}&next=${encodeURIComponent(nextPath)}`}
              >
                Confirmer mon adresse
              </Link>
            </Button>
          </div>
        ) : !sameEmail ? (
          <div className="mt-6 space-y-3">
            <Alert tone="warning" heading="Ce n'est pas le bon compte">
              Vous êtes connecté·e avec {session.user.email}, mais l'invitation est destinée à {invitation.emailHint}.
              Changez de compte pour l'accepter.
            </Alert>
            <SwitchAccount next={nextPath} />
          </div>
        ) : (
          <div className="mt-6">
            <AcceptInvitation token={token} organizationName={invitation.organizationName} />
          </div>
        )}
      </div>
    </AppPublicShell>
  );
}
