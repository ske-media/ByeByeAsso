# ADR-002 — Conventions base de données et migrations

Statut : accepté · 27 octobre 2026

## Décision

1. **PostgreSQL 16** est la seule source de vérité. Aucune donnée opérationnelle hors base.
2. **UUID** en clé primaire, générés par PostgreSQL (`gen_random_uuid()`), colonnes `snake_case`, `timestamptz` partout (`mode: "date"` côté Drizzle).
3. **Intégrité en base, pas seulement en application** : FK explicites, index uniques (partiels quand la règle est conditionnelle), `CHECK` pour les invariants simples (montants ≥ 0, formats de clés, bornes de dates).
4. **Migrations SQL versionnées** générées par `drizzle-kit generate` dans `packages/database/migrations/NNNN_nom.sql`, renommées avec un nom parlant, appliquées par le runner `pnpm db:migrate` (table `public.drizzle_migrations`). `drizzle-kit push` est interdit hors prototypage local ; `pnpm db:check` vérifie en CI que le schéma et les migrations sont cohérents.
5. **Argent** : `integer` en unités mineures + `char(3)` ISO 4217 ; jamais de `numeric`/`float` pour un montant transactionnel. Le type `Money` du noyau porte les opérations.
6. **Isolation tenant** : toute table possédée par une organisation porte `organization_id NOT NULL` + FK, et les relations entre entités tenant sont composées pour empêcher les associations croisées (phase 1 : contraintes composites `(organization_id, id)`).
7. **Réinitialisation** : `pnpm db:reset` refuse NODE_ENV=production et toute URL non locale.

## Conséquences

- Les tests d'intégration partent d'une base vide et migrée (`resetSchema` + `runMigrations`) ; ils s'exécutent séquentiellement sur `DATABASE_URL_TEST`.
- Chaque phase livre sa migration et met à jour `docs/er-diagram.md`.
