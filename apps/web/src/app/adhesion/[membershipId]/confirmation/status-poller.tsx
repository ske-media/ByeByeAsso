"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** La redirection ne prouve rien : on attend le webhook (active) avant d'afficher la carte. */
export function MembershipStatusPoller({
  membershipId,
  accessToken,
  status,
}: {
  membershipId: string;
  accessToken: string;
  status: string;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== "awaiting_payment") return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/public/memberships/${membershipId}?k=${encodeURIComponent(accessToken)}`, {
          headers: { "x-requested-with": "kroov" },
          cache: "no-store",
        });
        if (res.ok) {
          const { data } = (await res.json()) as { data: { status: string } };
          if (data.status !== status) {
            router.refresh();
            return;
          }
        }
      } catch {
        /* retry on next tick */
      }
      if (active) {
        setElapsed((e) => e + 2);
        setTimeout(tick, 2000);
      }
    };
    const id = setTimeout(tick, 1500);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [membershipId, accessToken, status, router]);
  return (
    <p className="rounded-[9px] bg-lavender px-3 py-2 text-[13px]" aria-live="polite">
      Confirmation du paiement en cours…{" "}
      {elapsed > 20
        ? "Cela prend plus de temps que prévu : votre carte vous sera envoyée par e-mail dès confirmation."
        : "Quelques secondes."}
    </p>
  );
}
