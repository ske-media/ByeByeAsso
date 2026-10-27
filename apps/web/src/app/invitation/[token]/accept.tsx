"use client";

import { Alert, Button } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptInvitationAction } from "@/actions/identity";
import { type ActionState, idleState } from "@/lib/action-state";
import { authClient } from "@/lib/auth-client";

export function AcceptInvitation({ token, organizationName }: { token: string; organizationName: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(idleState);
  return (
    <div className="space-y-3">
      {result.status === "error" ? <Alert tone="error">{result.message}</Alert> : null}
      <Button
        variant="primary"
        fullWidth
        loading={isPending}
        loadingLabel="Acceptation en cours"
        onClick={() => startTransition(async () => setResult(await acceptInvitationAction(token)))}
      >
        Rejoindre {organizationName} →
      </Button>
      <p className="text-[12px] text-muted">
        Vous obtiendrez exactement le rôle indiqué. Une personne administratrice pourra l'ajuster ensuite.
      </p>
    </div>
  );
}

export function SwitchAccount({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      fullWidth
      loading={pending}
      loadingLabel="Déconnexion"
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push(`/connexion?next=${encodeURIComponent(next)}`);
        router.refresh();
      }}
    >
      Changer de compte
    </Button>
  );
}
