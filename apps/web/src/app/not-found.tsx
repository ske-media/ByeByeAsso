import { Button } from "@kroov/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center px-gutter-mobile py-12 md:px-gutter">
      <p className="text-eyebrow font-extrabold uppercase text-muted">Erreur 404</p>
      <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px] md:text-page-title">
        Cette page n'existe pas
      </h1>
      <p className="mt-4 max-w-prose text-muted">
        L'adresse est peut-être erronée, ou la page a été déplacée. Rien n'a été perdu de votre côté.
      </p>
      <div className="mt-6">
        <Button asChild variant="primary">
          <Link href="/">Retour à l'accueil</Link>
        </Button>
      </div>
    </main>
  );
}
