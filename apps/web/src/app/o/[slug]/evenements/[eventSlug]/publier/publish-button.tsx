"use client";

import { Alert, Button } from "@kroov/ui";
import { useState, useTransition } from "react";
import { publishEventAction } from "@/actions/events";
import { type ActionState, idleState } from "@/lib/action-state";

export function PublishButton({
  organizationId,
  slug,
  eventId,
  eventSlug,
  version,
  disabled,
}: {
  organizationId: string;
  slug: string;
  eventId: string;
  eventSlug: string;
  version: number;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(idleState);
  return (
    <>
      <Button
        variant="primary"
        disabled={disabled}
        disabledReason="Complétez la check-list avant de publier."
        loading={isPending}
        loadingLabel="Publication en cours"
        onClick={() =>
          startTransition(async () =>
            setResult(await publishEventAction(organizationId, slug, eventId, eventSlug, version)),
          )
        }
      >
        Publier l'événement →
      </Button>
      {result.status === "error" ? (
        <Alert tone="error" className="w-full">
          {result.message}
        </Alert>
      ) : null}
    </>
  );
}
