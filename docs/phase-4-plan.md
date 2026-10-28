# Phase 4 — Adhésions : cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

Formules d'adhésion rattachées à l'organisation (jamais à un événement) : gratuites ou payantes, à période fixe (saison du … au …) ou à durée glissante (N mois à partir de l'activation), avec avantages listés, quota facultatif et revue facultative des candidatures. Candidature publique (nom, e-mail, consentement facultatif aux actualités), revue (approbation / refus motivé), paiement via le port prestataire de la phase 3, activation, carte adhérent par lien, expiration automatique, rappel de renouvellement, renouvellement manuel (nouvelle adhésion liée à la précédente, validité auditée), liste des adhérents avec recherche et filtres, suspension / réactivation / annulation, prolongation de validité motivée, **éligibilité billets adhérents** (tarifs `members_only` réservés aux adresses porteuses d'une adhésion active). Écrans : 17 (gestion), 18 (formule), 35 (adhérer), 36 (carte et renouvellement), 47 (renouvellement), « Mes adhésions ».

Hors périmètre : renouvellement automatique (interdit par le prompt tant que non entièrement supporté et testé), attestation PDF (page HTML imprimable à la place — pas de bouton factice), carte Wallet, cotisations à paliers / dons libres, adhésions familiales, règles d'éligibilité autres que « adhésion active ».

## 2. Existant réutilisé

RBAC (`memberships.manage` : propriétaire, administrateur, responsable billetterie), port prestataire + `payment_accounts` + `processProviderEvent` + `payment_webhook_events` (phase 3), e-mails transactionnels, audit, outbox, jetons dérivés HMAC (`context.ts`), coques UI, `loadOrgPage`, tunnel public (`PublicShell`), `/moi`.

## 3. Changements de base (migration `0004_memberships`)

| Table / modification          | Rôle                                                                                                                                                                                                                                                                                                                            | Contraintes clés                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `membership_plans`            | formule : nom, slug, description, prix (unités mineures) + devise, `period_kind` (`fixed` \| `rolling`), `valid_from`/`valid_until` (fixe) ou `duration_months` (glissant), `requires_review`, `max_members`, `position`, statut `active`/`archived`, `public`                                                                  | `UNIQUE (organization_id, slug)`, `UNIQUE (organization_id, id)`, `CHECK price >= 0`, `CHECK (fixed ⇒ dates présentes et fin > début) ∧ (rolling ⇒ durée 1–60 mois)`                                                                                                                                                   |
| `membership_plan_benefits`    | avantages affichés (libellé, position)                                                                                                                                                                                                                                                                                          | FK composite plan                                                                                                                                                                                                                                                                                                      |
| `membership_applications`     | candidature : plan, e-mail, prénom, nom, `user_id` facultatif, consentement, statut `submitted` \| `approved` \| `rejected` \| `withdrawn`, motif de refus, revue par/le                                                                                                                                                        | FK composites, `CHECK email = lower(email)`                                                                                                                                                                                                                                                                            |
| `memberships`                 | adhésion : plan, candidature d'origine, membre (e-mail, nom, `user_id`), numéro `M-0001` par organisation, statut (machine ci-dessous), `valid_from`/`valid_until`, `renewed_from`, jeton d'accès haché + `secret_version`, `activated_at`, `expired_at`, `suspended_at`, `cancelled_at` + motif, `reminder_sent_at`, `version` | `UNIQUE (organization_id, number)`, `UNIQUE (access_token_hash)`, **`UNIQUE (organization_id, member_email) WHERE status = 'active'`** et **`UNIQUE (organization_id, user_id) WHERE status = 'active' AND user_id IS NOT NULL`** (une adhésion active par personne et organisation), `CHECK valid_until > valid_from` |
| `membership_entitlements`     | droits dérivés d'une adhésion : `kind` (`member_ticket_eligibility`, `benefit`), `key`, fenêtre de validité                                                                                                                                                                                                                     | FK composite adhésion, `UNIQUE (membership_id, kind, key)`                                                                                                                                                                                                                                                             |
| `membership_validity_changes` | **journal immuable des changements de validité** (activation, prolongation, renouvellement, expiration) : ancien/nouveau `valid_from`/`valid_until`, motif, acteur                                                                                                                                                              | FK composite adhésion ; append-only (aucune mise à jour dans le domaine)                                                                                                                                                                                                                                               |
| `payments` (modification)     | `order_id` devient nullable, ajout `membership_id` (FK composite), `CHECK (order_id IS NOT NULL) <> (membership_id IS NOT NULL)` — un paiement règle soit une commande soit une adhésion                                                                                                                                        | la contrainte garantit l'exclusivité ; les routes webhook routent sur la cible présente                                                                                                                                                                                                                                |
| `ticket_types` (modification) | `members_only boolean default false`                                                                                                                                                                                                                                                                                            | éligibilité vérifiée à la réservation (e-mail requis) **et** au checkout (e-mail définitif)                                                                                                                                                                                                                            |

## 4. Machine à états

```
MEMBERSHIP
pending → awaiting_payment (candidature approuvée ou sans revue, formule payante)
pending → active (approuvée ou sans revue, formule gratuite)
pending → rejected (revue), pending → cancelled (retrait du candidat)
awaiting_payment → active (webhook payment.succeeded ; validité calculée à l'activation)
awaiting_payment → cancelled (abandon / refus définitif), awaiting_payment → rejected
active → suspended ↔ active (organisation), active → expired (job, valid_until dépassé), active → cancelled (motif)
suspended → expired · suspended → cancelled
rejected, expired, cancelled : terminaux
```

Validité : formule fixe → `[valid_from, valid_until]` de la formule (activation tardive = même fin) ; glissante → `[activation, activation + N mois]`. Renouvellement : nouvelle adhésion `pending`/`awaiting_payment` sur la formule choisie, `renewed_from` = adhésion précédente ; à l'activation, `valid_from` = max(activation, fin précédente + 1 j) pour une formule glissante. Chaque changement de validité écrit une ligne `membership_validity_changes` + audit.

## 5. API et UI

| Méthode        | URL                                                                                           | Permission                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET / POST     | `/organizations/{id}/membership-plans`                                                        | `memberships.manage`                                                           |
| PATCH / DELETE | `/organizations/{id}/membership-plans/{planId}`                                               | `memberships.manage` (DELETE = archivage)                                      |
| GET            | `/organizations/{id}/memberships?status&q&planId` (+ stats)                                   | `memberships.manage`                                                           |
| GET            | `/organizations/{id}/memberships/{membershipId}`                                              | `memberships.manage`                                                           |
| POST           | `…/memberships/{membershipId}/{approve\|reject\|suspend\|reactivate\|cancel\|extend\|resend}` | `memberships.manage` ; motif requis pour reject/cancel/extend                  |
| GET            | `/public/organizations/{slug}/membership-plans`                                               | anonyme (formules publiques actives, places restantes)                         |
| POST           | `/public/organizations/{slug}/membership-applications`                                        | anonyme ou connecté : candidature → adhésion `pending` ; renvoie `accessToken` |
| GET            | `/public/memberships/{membershipId}` (`?k=` / connecté)                                       | adhérent : carte, statut, validité, renouvellement possible                    |
| POST           | `/public/memberships/{membershipId}/checkout`                                                 | adhérent : session de paiement (formule payante) — activation **par webhook**  |
| POST           | `/public/memberships/{membershipId}/renew`                                                    | adhérent : nouvelle adhésion liée (plan cible)                                 |
| POST           | `/payments/webhooks/{provider}` (existant)                                                    | route aussi `payment.succeeded`/`failed` vers l'adhésion                       |

UI organisateur : `/o/[slug]/adhesions` (17 : actives, à relancer, cotisations reçues ; onglets adhérents / formules / renouvellements ; recherche, filtre statut), `/o/[slug]/adhesions/formules/nouvelle` et `/o/[slug]/adhesions/formules/[planId]` (18 : formulaire + aperçu public + avantages + revue/quota), `/o/[slug]/adhesions/[membershipId]` (fiche : candidature, validité, historique de validité, actions). Nav « Adhésions ». Public : `/[orgSlug]/adherer` (35 : formules, formulaire), `/adhesion/[membershipId]` (36 : carte adhérent, statut, attestation imprimable, renouvellement 47 quand proposé), `/adhesion/[membershipId]/paiement` → prestataire, `/adhesion/[membershipId]/confirmation` (attente webhook), `/moi/adhesions`. Billetterie : case « Réservé aux adhérents » sur un tarif ; page 28 demande l'e-mail adhérent pour ces tarifs.

E-mails : candidature reçue (revue en cours), approbation (lien de paiement ou carte), refus (motif), activation (carte), rappel 30 jours avant expiration, expiration, renouvellement. Jobs : `memberships.expire` (quotidien 03:10 UTC : `active`/`suspended` échues → `expired`), `memberships.remind` (quotidien : rappel J-30 une seule fois, `reminder_sent_at`).

## 6. Sécurité

- Une adhésion active par personne et organisation : index uniques partiels (e-mail normalisé, et `user_id`).
- Jamais d'activation payante sur redirection : webhook signé uniquement (réutilise la porte d'idempotence).
- Jeton adhérent dérivé/haché, 404 uniforme ; renvoi = rotation.
- Éligibilité adhérent vérifiée côté serveur à la réservation et au checkout (jamais côté client seul) ; l'e-mail d'un tarif `members_only` ne peut pas changer au checkout sans re-vérification.
- Tenant : FK composites partout ; B ne voit ni formules, ni adhérents, ni candidatures de A (403/404).
- Changements de validité immuables et audités (prolongation avec motif obligatoire).
- Tests négatifs : B sur les ressources de A ; webhook forgé ; `status` non patchable ; double adhésion active refusée (409) ; tarif `members_only` refusé sans adhésion active (412 `membership_required`) ; prolongation sans motif 422.

## 7. Tests attendus

Unit : machine à états, calcul de validité (fixe, glissante, renouvellement). Intégration : formule gratuite sans revue → active immédiatement ; payante → awaiting_payment → webhook → active + validité + droit `member_ticket_eligibility` ; revue : approbation / refus ; double adhésion active refusée ; expiration job + rappel J-30 unique ; renouvellement lié + validité enchaînée ; prolongation auditée ; tarif `members_only` : refusé sans adhésion, accepté avec, refusé si l'e-mail change au checkout ; isolation tenant ; quota de formule. Sécurité (API directe) : liste ci-dessus. E2E : créer une formule payante avec revue → candidature publique → approbation → paiement simulé → carte adhérent → tarif adhérent réservé → renouvellement proposé ; formule gratuite sans revue → active immédiatement.

## 8. Hypothèses (décidées)

1. `memberships.manage` couvre lecture et écriture des adhésions (pas de permission de lecture séparée dans le catalogue).
2. Adhésion identifiée par e-mail normalisé (+ `user_id` quand connecté) ; une candidature avec une adhésion active existante sur l'organisation est refusée avec explication et lien vers la carte.
3. Frais plateforme sur les cotisations : mêmes `PLATFORM_FEE_*` que les billets, à la charge de l'adhérent, annoncés avant paiement.
4. Rappel de renouvellement à J-30, une seule fois, uniquement si une formule active (publique) existe pour renouveler.
5. Base hébergée (Supabase) : migration `0004` appliquée et vérifiée dès que le projet est joignable ; état consigné dans le rapport.
