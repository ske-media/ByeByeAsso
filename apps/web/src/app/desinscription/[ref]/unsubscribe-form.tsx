"use client";

import { Alert, Button } from "@kroov/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unsubscribeAction } from "@/actions/marketing";

export function UnsubscribeForm({ refToken }: { refToken: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="primary"
        loading={pending}
        loadingLabel="Désinscription"
        onClick={() =>
          start(async () => {
            const r = await unsubscribeAction(refToken);
            if (r.status === "error") setError(r.message ?? "Impossible pour l'instant.");
            else router.refresh();
          })
        }
      >
        Me désinscrire
      </Button>
    </div>
  );
}
