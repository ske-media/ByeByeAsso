"use client";

import { ErrorState } from "@kroov/ui";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side report only; server logs carry the full stack via pino.
    console.error("[kroov] unhandled error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-[640px] px-gutter-mobile py-12 md:px-gutter">
      <ErrorState
        title="Une erreur inattendue s'est produite"
        description="Vos données saisies n'ont pas été envoyées. Vous pouvez réessayer ; si le problème persiste, contactez l'assistance en indiquant la référence ci-dessous."
        onRetry={reset}
      />
      {error.digest ? <p className="mt-3 text-meta text-muted">Référence : {error.digest}</p> : null}
    </main>
  );
}
