"use client";

import { Button } from "@kroov/ui";

/** Attestation : la carte elle-même, imprimée (pas de PDF généré — rien de factice). */
export function PrintButton() {
  return (
    <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
      Imprimer l'attestation
    </Button>
  );
}
