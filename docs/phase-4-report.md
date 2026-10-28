# Rapport de phase 4 — Adhésions

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-4-plan.md`.

## 1. Périmètre livré

Formules d'adhésion rattachées à l'organisation (gratuites ou payantes, période fixe « saison » ou durée glissante N mois, avantages, quota, visibilité, revue facultative des demandes), demande publique sans compte (prénom, nom, e-mail, consentement facultatif aux actualités), revue (approbation / refus motivé), paiement de la cotisation via le port prestataire de la phase 3 (**activation uniquement par webhook signé**), carte d'adhérent par lien signé (numéro `M-0001`, validité, attestation imprimable), suspension / réactivation / annulation motivée / prolongation motivée avec **historique de validité immuable**, renvoi du lien (rotation du jeton), expiration automatique, rappel J-30 unique, renouvellement manuel (nouvelle adhésion liée, validité enchaînée), liste des adhérents avec indicateurs, recherche et filtres, **tarifs réservés aux adhérents** (`members_only`) vérifiés côté serveur à la réservation, au changement de coordonnées et au paiement, « Mes adhésions ». Écrans : 17, 18, 35, 36, 47, « Mes adhésions », complément de 28 (badge + e-mail adhérent).

Hors périmètre, comme cadré : renouvellement automatique, PDF généré (la carte s'imprime), carte Wallet, paliers / dons libres, adhésions familiales.

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database` | `schema/memberships.ts` (6 tables), `ticketing.ts` : `payments.order_id` nullable + `membership_id` + `CHECK payments_target_exclusive`, `ticket_types.members_only` ; migration `0004_memberships.sql`                                                                                                                                                                                                                                                       |
| `packages/domain`   | `memberships/` : `schemas`, `state-machine` (+ test unitaire), `plans`, `memberships` (candidature, approbation, checkout, activation par webhook, renouvellement, décisions, lectures, jobs), `emails`, `index` — 1 875 lignes ; `ticketing/orders.ts` (éligibilité adhérent à 3 points), `ticketing/payments.ts` (routage webhook commande / adhésion), `ticket-types.ts` + `schemas.ts` (`membersOnly`)                                                    |
| `packages/config`   | slugs réservés `adhesion`, `adhesions`, `adherer`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web`          | `actions/memberships.ts`, 9 routes `/api/v1/*`, pages organisateur `/o/[slug]/adhesions` (17), `…/formules/nouvelle` et `…/formules/[planId]` (18, aperçu public vivant, archivage), `…/adhesions/[membershipId]` (fiche + décisions + prolongation), nav « Adhésions » (`memberships.manage`) ; public `/[orgSlug]/adherer` (35), `/adhesion/[membershipId]` (36 + 47), `…/confirmation` (attente webhook), `/moi/adhesions` ; page 28 + formulaire de tarif |
| `apps/worker`       | `jobs/memberships.ts` : `memberships.expire` (03:10 UTC), `memberships.remind` (08:40 UTC)                                                                                                                                                                                                                                                                                                                                                                    |
| `tests`             | intégration `memberships/memberships.test.ts` (8 cas), unit `memberships/state-machine.test.ts` (5), sécurité S6 (5 cas), E2E `memberships.e2e.ts` (4 parcours × 2 viewports) ; régression billetterie : cas « plafond de code promo » ajouté                                                                                                                                                                                                                 |
| `docs`              | `phase-4-plan.md`, `openapi.yaml` (54 chemins, 41 schémas), `er-diagram.md`, `architecture.md` (§7quinquies), captures `phase4-*`, `.env.example` (exemple Supabase sans secret)                                                                                                                                                                                                                                                                              |

## 3. Migrations

`0004_memberships.sql` : 6 tables, 5 enums, 12 index (uniques partiels `memberships_active_email_uq` et `memberships_active_user_uq`), 16 `CHECK` (période de formule cohérente, adhésion active toujours datée, motif obligatoire au refus / à l'annulation, e-mails en minuscules, exclusivité commande / adhésion sur `payments`), 16 FK dont les composites tenant-safe (`renewed_from` reste dans l'organisation). Appliquée sur base vierge (`db:reset` : 56 tables), `db:check` cohérent ; bundle Supabase régénéré (`scripts/supabase-bundle.mjs`) et rejoué sur une base neuve : 56 tables, 5 lignes de journal, `db:migrate` ensuite sans effet.

## 4. API livrée

| Méthode              | URL                                                                                           | Permission / accès                                                    |
| -------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET / POST           | `/organizations/{id}/membership-plans`                                                        | `memberships.manage`                                                  |
| GET / PATCH / DELETE | `/organizations/{id}/membership-plans/{planId}`                                               | `memberships.manage` (DELETE = archivage, validités conservées)       |
| GET                  | `/organizations/{id}/memberships?status&planId&q` → `{ memberships, stats }`                  | `memberships.manage` (`to_renew` = expirent sous 30 j)                |
| GET                  | `/organizations/{id}/memberships/{membershipId}`                                              | `memberships.manage`                                                  |
| POST                 | `…/memberships/{membershipId}/{approve\|reject\|suspend\|reactivate\|cancel\|extend\|resend}` | `memberships.manage` ; motif requis (reject, suspend, cancel, extend) |
| GET                  | `/public/organizations/{slug}/membership-plans`                                               | anonyme                                                               |
| POST                 | `/public/organizations/{slug}/membership-applications`                                        | anonyme ou connecté ; `accessToken` renvoyé une fois                  |
| GET                  | `/public/memberships/{membershipId}`                                                          | jeton `?k=` / Bearer, ou compte propriétaire ; 404 uniforme           |
| POST                 | `/public/memberships/{membershipId}/checkout`                                                 | jeton ; `awaiting_payment` seulement                                  |
| POST                 | `/public/memberships/{membershipId}/renew`                                                    | jeton ; `{ planId }` parmi `renewalPlans`                             |
| POST                 | `/payments/webhooks/{provider}` (existant)                                                    | route `payment.succeeded/failed` vers la commande **ou** l'adhésion   |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/adhesions` (indicateurs : actifs, à renouveler, demandes, cotisations encaissées ; onglets adhérents / formules / renouvellements ; recherche, filtres formule et statut), `/o/[slug]/adhesions/formules/nouvelle`, `/o/[slug]/adhesions/formules/[planId]`, `/o/[slug]/adhesions/[membershipId]`. Public : `/[orgSlug]/adherer`, `/adhesion/[membershipId]` (`?k=`), `/adhesion/[membershipId]/confirmation`, `/moi/adhesions` (+ lien depuis `/moi`). Billetterie : badge « Réservé aux adhérents » et champ e-mail adhérent sur `/[orgSlug]/[eventSlug]/billets` ; case « Réservé aux adhérents » dans le formulaire de tarif.

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 367 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0004, 56 tables)
$ pnpm test:unit                         → exit 0   8 fichiers · 38 tests (+5 : machine à états et calcul de validité)
$ pnpm test:integration                  → exit 0   7 fichiers · 78 tests (70 phases 0–3 + 8 adhésions)
$ pnpm test:security (statique)          → exit 0   1 test, 26 ignorés sans serveur (voulu)
$ node scripts/scan-secrets.mjs          → exit 0   382 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 100 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file, PAYMENT_PROVIDER=fake)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 27 tests (22 phases 1–3 + 5 phase 4)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   44 passed (22 desktop-1440 + 22 mobile-390)
$ timeout 25 pnpm --filter @kroov/worker dev → "worker started" ; files : memberships.expire, memberships.remind + 7 existantes
$ node scripts/supabase-bundle.mjs + rejeu sur base neuve → 56 tables, 5 migrations journalisées, db:migrate no-op
```

Cas d'intégration notables (réellement exécutés) : formule gratuite sans revue → active immédiatement, seconde demande sur le même e-mail → 409 ; formule payante avec revue → `pending` → approbation → `awaiting_payment` → **redirection sans effet** → webhook signé → `active` avec validité et droit `member_ticket_eligibility` ; refus motivé ; quota de formule (412 `plan_full`) ; suspension / réactivation / prolongation (ligne d'historique + audit) / annulation ; renvoi = l'ancien lien meurt ; tarif `members_only` refusé sans e-mail (412 `membership_email_required`), sans adhésion (412 `membership_required`), accepté avec, refusé si l'e-mail change aux coordonnées, refusé au checkout après suspension ; expiration par job, rappel J-30 envoyé une seule fois, renouvellement lié avec validité enchaînée et ancienne adhésion expirée.

Captures `docs/captures/phase4-*-{1440,390}.png` : adhésions (17), formules, formule (18), fiche adhésion, adhérer (35), carte d'adhérent (36), billets avec tarif adhérent (28).

## 7. Décisions prises pendant la phase

- **Activation payante uniquement par webhook** : `startMembershipCheckout` crée le paiement (`membership_id`) et redirige ; `processProviderEvent` reconnaît la cible et appelle `activateMembershipFromPayment` sous verrou. La page de confirmation attend le changement d'état (sondage) et ne conclut rien de la redirection.
- **`payments` polymorphe** (`order_id` ou `membership_id`, `CHECK` exclusif) plutôt qu'une table séparée : idempotence, réconciliation et ledger restent uniques.
- **Frais de service** sur les cotisations : mêmes `PLATFORM_FEE_*` que les billets, à la charge de l'adhérent, **affichés** sur la page d'adhésion, la carte et le bouton de paiement (20,00 € + 0,80 €). L'E2E a attrapé l'écart initial entre le montant annoncé et le montant débité.
- **Pas de route `/adhesion/[id]/paiement`** : le checkout renvoie directement l'URL hébergée du prestataire (comme les commandes).
- **Attestation** = la carte elle-même imprimée (`window.print()`), pas de PDF.
- **Validation après autorisation** sur `POST membership-plans` ? Non : comme pour les autres routes, le corps est validé avant l'appel domaine (422 possible pour un outsider sur un corps invalide) ; le test de sécurité envoie un corps valide et vérifie le 403. À homogénéiser globalement en phase 10 si souhaité (autorisation d'abord).
- `listMemberships` et `getMembership` exigent `memberships.manage` (pas de lecture séparée) ; les responsables billetterie l'ont déjà (hypothèse 1 du cadrage).

## 8. Limites connues

- **Base hébergée (Supabase) non synchronisée** : le connecteur Supabase disponible est lié au projet `tgckmrkzwkjuhqaqjgvz` (et non `qckogywkyxlgpwrdouiu` fourni) et répond « Database is possibly not accessible at the moment » à chaque appel ; `api.supabase.com` et `*.supabase.co` sont bloqués par le proxy de sortie. Les 5 fichiers de `.tmp/supabase/` (régénérables) sont prêts à être rejoués dans l'ordre (SQL Editor ou `psql` sur la chaîne « Transaction pooler ») ; ils sont idempotents sur le journal `drizzle_migrations`.
- Stripe toujours **non vérifié en conditions réelles** (phase 3).
- Rappel J-30 et expiration tournent dans le worker : non exercés par l'E2E (couverts en intégration avec horloge injectée).
- Quota de formule : compte `active + pending + awaiting_payment + suspended` ; une demande refusée libère la place.
- Pas de retrait de candidature côté adhérent (`withdrawn` existe en base, non exposé).
- `membership_entitlements` est alimenté (`member_ticket_eligibility`) mais l'éligibilité est calculée depuis `memberships.status` ; la table servira aux avantages typés (phase 7/8).

## 9. Sécurité

Livré : une adhésion active par personne et organisation (index uniques partiels, insensibles à la casse de l'e-mail) ; jamais d'activation sur redirection ; jeton adhérent dérivé HMAC, jamais stocké, renvoyé une fois, 404 uniforme, rotation au renvoi ; éligibilité adhérent vérifiée côté serveur à trois points et retirée immédiatement à la suspension ; `status` non modifiable par la demande publique ; FK composites et scope organisation sur toutes les routes (B sur A → 404, outsider → 403, manager d'événement sans `memberships.manage` → 403) ; historique de validité append-only + audit dans la même transaction ; aucun hash ni `secretVersion` dans les réponses publiques. Tests négatifs : 5 par API directe (S6) + 8 en intégration.

## 10. Dépendances pour la phase 5 (bénévoles)

- `organization_members` + rôles custom restent la base des équipes ; les adhérents (`memberships`) sont distincts des membres de l'équipe, un rapprochement par e-mail est possible pour proposer des missions aux adhérents.
- E-mails transactionnels, outbox (`membership.activated` à émettre si le CRM en a besoin en phase 7) et jobs quotidiens sont en place.
- Le shell public (`PublicShell`), les jetons dérivés et les pages « Mes … » sont réutilisables pour l'espace bénévole.

## 11. Definition of Done — phase 4

| Critère                                                  | État                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 100 routes                                                                                                                     |
| Typecheck                                                | ✅ 14/14                                                                                                                          |
| Lint                                                     | ✅                                                                                                                                |
| Migrations sur base vierge                               | ✅ 0000 → 0004, 56 tables, `db:check` ; bundle Supabase rejoué sur base neuve                                                     |
| Tests unitaires                                          | ✅ 38/38                                                                                                                          |
| Tests d'intégration                                      | ✅ 78/78                                                                                                                          |
| Tests E2E requis                                         | ✅ 44/44 : formules → demande sans compte → approbation → paiement simulé → carte active → tarif adhérent → suspension → gratuite |
| Tests d'autorisation                                     | ✅ 27/27 par API directe ; outsider, autre organisation, manager limité, webhook forgé, doublon 409, `members_only` 412           |
| Une adhésion active par personne et organisation         | ✅ index uniques partiels + 409 `membership_exists`                                                                               |
| Pas d'activation payante sans paiement confirmé          | ✅ redirection seule sans effet ; webhook forgé 400 ; rejeu = `duplicate`                                                         |
| Historique de validité immuable                          | ✅ append-only, acteur et motif, prolongation motivée                                                                             |
| Machines à états typées                                  | ✅ adhésion (+ tests unitaires)                                                                                                   |
| Base hébergée à jour                                     | ⏳ migrations 0000–0004 prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (voir §8)              |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                |
