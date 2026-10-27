# ADR-001 — Monorepo, stack et outillage

Statut : accepté · 27 octobre 2026

## Contexte

Le cahier des charges V0.2 impose Next.js App Router, TypeScript strict, PostgreSQL, Drizzle, Zod, Tailwind, composants shadcn/ui, Vitest, Playwright, Docker Compose, et un monolithe modulaire. Les versions stables au moment de l'initialisation ont été vérifiées sur le registre npm.

## Décision

- **pnpm 10 workspaces + Turborepo 2** : les packages internes sont consommés en source TypeScript (`exports` → `./src/*.ts`, `transpilePackages` côté Next, `tsx` côté worker). Pas d'étape de build intermédiaire, pas de `dist/` à synchroniser.
- **Versions épinglées** (`save-exact`) et `pnpm-lock.yaml` commité : Next 16.4.3, React 19.3.1, TypeScript 5.9.3, Drizzle ORM 0.45.4 / drizzle-kit 0.31.11, Zod 4.6.7, Tailwind 4.3.3, Better Auth 1.7.14 (phase 1), pg-boss 12.38.0, Vitest 4.1.12, Playwright 1.63.0, Biome 2.6.3.
- **TypeScript 5.9 plutôt que 7.0** : la ligne 7 (compilateur natif) est récente et son support par Next/Drizzle/Vitest n'est pas encore établi ; 5.9 est la ligne compatible avec toute la chaîne. Options strictes activées (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- **Biome** pour lint + format (un binaire, règles a11y incluses) plutôt qu'ESLint + Prettier.
- **Vitest 4** (pas 5, trop récent) avec trois projets : `unit`, `integration` (PostgreSQL réel), `security`.
- **Playwright 1.63** épinglé sur la version du navigateur préinstallé dans l'environnement de validation ; deux projets (desktop 1440 px, mobile 390 px) alignés sur les largeurs de référence du kit UX.

## Conséquences

- Un `pnpm install` + `pnpm db:migrate` suffit pour démarrer ; aucune compilation de packages.
- Les erreurs de type traversent les frontières de packages immédiatement (pas de `.d.ts` périmés).
- Le worker ne doit jamais importer de code Next ; le web ne doit jamais importer le runner de migrations (séparation `@kroov/database` / `@kroov/database/migrate`).
