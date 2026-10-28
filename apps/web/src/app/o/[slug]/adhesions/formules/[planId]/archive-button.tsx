"use client";

import { Alert, Button, ConfirmDialog } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archivePlanAction } from "@/actions/memberships";

export function ArchivePlanButton({
  organizationId,
  slug,
  planId,
  activeMembers,
}: {
  organizationId: string;
  slug: string;
  planId: string;
  activeMembers: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ConfirmDialog
        trigger={
          <Button variant="secondary" type="button">
            Archiver la formule
          </Button>
        }
        title="Archiver cette formule ?"
        description={`Elle disparaît de la page publique et n'accepte plus de demandes. ${activeMembers > 0 ? `Les ${activeMembers} adhésion(s) actives conservent leur validité.` : "Aucune adhésion active n'est concernée."}`}
        confirmLabel="Archiver"
        destructive
        pending={pending}
        onConfirm={() =>
          new Promise<void>((resolve) => {
            start(async () => {
              const r = await archivePlanAction(organizationId, slug, planId);
              if (r.status === "error") setError(r.message ?? "Archivage impossible.");
              else router.push(`/o/${slug}/adhesions?onglet=formules`);
              resolve();
            });
          })
        }
      />
    </div>
  );
}
