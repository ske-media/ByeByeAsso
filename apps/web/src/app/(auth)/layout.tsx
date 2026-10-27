import { Wordmark } from "@kroov/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Auth shell (écran 01) : panneau éditorial lime à gauche, formulaire calme à droite.
 * Sous 1024 px, le panneau devient un bandeau court au-dessus du formulaire.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside
        className="flex flex-col justify-between bg-lime px-gutter-mobile py-8 lg:px-12 lg:py-10"
        aria-label="Présentation"
      >
        <Link href="/" className="inline-flex rounded-control">
          <Wordmark size={40} />
        </Link>
        <div className="my-8 lg:my-0">
          <p className="text-[40px] font-black leading-[0.98] tracking-[-2px] lg:text-[64px] lg:tracking-[-3.5px]">
            Les gens.
            <br />
            Les nuits.
            <br />
            Les liens.
          </p>
          <p
            aria-hidden="true"
            className="mt-8 inline-block -rotate-3 border border-ink bg-pink px-5 py-3 text-[18px] font-black tracking-[-0.5px] shadow-sticker lg:text-[22px]"
          >
            On fait ça ensemble ↗
          </p>
        </div>
        <p className="hidden text-[14px] leading-[1.45] lg:block">
          Billetterie, adhésions et équipes.
          <br />
          Toute votre organisation, au même endroit.
        </p>
      </aside>
      <main className="flex items-center px-gutter-mobile py-10 lg:px-16">
        <div className="mx-auto w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}
