"use client";

import { Button } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** Top-bar account menu: name → profile, sign out. */
export function UserMenu({ name }: { name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-3 text-[12px]">
      <Link href="/moi" className="flex items-center gap-2 rounded-control" aria-label={`Mon compte : ${name}`}>
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-lavender text-[11px] font-bold"
        >
          {initials}
        </span>
        <span className="hidden font-bold sm:inline">{name}</span>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        loadingLabel="Déconnexion"
        onClick={async () => {
          setPending(true);
          await authClient.signOut();
          router.push("/connexion");
          router.refresh();
        }}
      >
        Se déconnecter
      </Button>
    </div>
  );
}
