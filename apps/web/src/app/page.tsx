import { Button, Eyebrow, Wordmark } from "@kroov/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";

/** Home: signed-in people go to their organizations; others get the two real entry points. */
export default async function HomePage() {
  const session = await currentSession();
  if (session?.user.emailVerified) redirect("/organisations");
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
        Kroov est en construction. Vous pouvez dès maintenant créer votre compte, votre organisation et inviter votre
        équipe.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="primary">
          <Link href="/inscription">Créer mon compte</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/connexion">Se connecter</Link>
        </Button>
      </div>
      <nav aria-label="Liens techniques" className="mt-10 flex flex-wrap gap-4 text-[12px] font-bold">
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
