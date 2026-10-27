import { Eyebrow, Wordmark } from "@kroov/ui";
import Link from "next/link";

/**
 * Phase 0 home page. Deliberately minimal: no fake CTA, no mocked data.
 * Phase 1 replaces this with the connexion / espace organisateur entry points.
 */
export default function HomePage() {
  const showDesignSystem = process.env.NODE_ENV !== "production";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col justify-center px-gutter-mobile py-12 md:px-gutter">
      <Wordmark size={48} />
      <Eyebrow className="mt-10 text-muted">Système d'exploitation événementiel</Eyebrow>
      <h1 className="mt-3 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Organisez vos événements, vendez vos billets, mobilisez vos bénévoles et développez votre communauté depuis un
        seul endroit.
      </h1>
      <p className="mt-5 max-w-prose text-muted">
        Kroov est en cours de construction. La connexion et l'espace organisateur arrivent avec la phase 1 (identité et
        organisations).
      </p>
      <nav aria-label="Liens techniques" className="mt-8 flex flex-wrap gap-4 text-[12px] font-bold">
        <Link href="/api/v1/health" className="underline underline-offset-4">
          État du service
        </Link>
        {showDesignSystem ? (
          <Link href="/design-system" className="underline underline-offset-4">
            Système de design (développement)
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
