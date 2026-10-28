# Phase 5 — Bénévoles : cadrage

Date : 28 octobre 2026. Précède l'implémentation (§22 du prompt maître).

## 1. Périmètre

Recrutement et qualification des bénévoles, par événement : catalogue de compétences de l'organisation (avec vérification facultative), équipes et postes types (compétences obligatoires / souhaitées), postes activés sur un événement avec **créneaux** (début, fin, effectif requis et maximum), questions personnalisées (formulaires de la phase 2, `purpose = volunteer_application`), candidature publique sans compte (identité, contact, motivation, expérience, compétences déclarées, **vœux de postes ordonnés**, **plages disponibles et indisponibles**, **binôme par invitation réciproque**, contraintes, consentement facultatif), accusé de réception, suivi par lien signé (statut, modification des vœux / disponibilités / binôme tant que non affecté, retrait), revue par l'équipe (candidature, correspondance compétences ↔ vœux, disponibilités projetées sur les créneaux, vérification des compétences, notes internes **jamais visibles du candidat**, décisions : à l'étude, acceptée, liste d'attente, non retenue avec motif, retour à « acceptée »), traitement en lot avec validation par enregistrement, **matrice de disponibilité** (bénévoles acceptés × créneaux), filtres (statut, événement, poste, compétence), « Mes candidatures ». Écrans : 11, 12, 13, 37, 38, 39, « Mes candidatures ».

Hors périmètre (phase 6) : versions de planning, génération automatique, affectations, confirmation de mission, présence (`schedule_versions`, `volunteer_assignments`, `schedule_generation_runs`, `volunteer_assignment_requests`, `volunteer_attendance`, `active_volunteer_commitments`). Les statuts `assigned` et `confirmed` de la machine à états sont déclarés et gardés, mais aucune transition ne les atteint avant la phase 6. Hors MVP : import de bénévoles, documents (pièce d'identité), mineurs avec autorisation parentale, défraiement.

## 2. Existant réutilisé

RBAC (`volunteers.review`, `volunteers.schedule` : propriétaire, administrateur, responsable événement, responsable bénévoles), événements et lieux, formulaires dynamiques (`form_definitions`, `form_fields`, `form_submissions`, `form_answers`), e-mails transactionnels, audit, outbox, jetons dérivés HMAC (`deriveToken`), coques UI, `PublicShell`, `/moi`, utilitaires de temps (fuseau de l'événement).

## 3. Changements de base (migration `0005_volunteers`)

| Table                            | Rôle                                                                                                                                                                                                                                                                                                    | Contraintes clés                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skills`                         | catalogue de l'organisation : slug, nom, description, `requires_verification`, statut                                                                                                                                                                                                                   | `UNIQUE (organization_id, slug)`, `UNIQUE (organization_id, id)`                                                                                                                     |
| `volunteer_teams`                | équipes (bar, accueil, sécurité…) : slug, nom, description, couleur, position, statut                                                                                                                                                                                                                   | `UNIQUE (organization_id, slug)`, `UNIQUE (organization_id, id)`                                                                                                                     |
| `volunteer_positions`            | postes types de l'organisation : équipe, slug, nom, description, consignes, `min_age`, position, statut                                                                                                                                                                                                 | FK composite équipe, `UNIQUE (organization_id, slug)`                                                                                                                                |
| `position_required_skills`       | compétences d'un poste type : `mandatory` (dure) ou souhaitée (souple)                                                                                                                                                                                                                                  | FK composites poste et compétence, `UNIQUE (position_id, skill_id)`                                                                                                                  |
| `event_volunteer_positions`      | poste activé sur un événement : poste type, briefing spécifique, statut                                                                                                                                                                                                                                 | FK composites événement et poste, `UNIQUE (event_id, position_id)`                                                                                                                   |
| `volunteer_shifts`               | créneau d'un poste d'événement : `starts_at`, `ends_at`, `required_count`, `max_count`, libellé, notes, statut                                                                                                                                                                                          | `CHECK ends_at > starts_at`, `CHECK 0 ≤ required_count ≤ max_count`                                                                                                                  |
| `volunteer_applications`         | candidature **par événement** : e-mail normalisé, prénom, nom, téléphone, `user_id`, motivation, expérience, contraintes, consentement, statut (machine §4), motif de décision, **`internal_notes`** (jamais exposées), revue par/le, jeton d'accès haché + `secret_version`, `withdrawn_at`, `version` | FK composite événement, **`UNIQUE (event_id, email) WHERE status NOT IN ('rejected','withdrawn')`** (une candidature vivante par adresse et événement), `CHECK email = lower(email)` |
| `volunteer_position_preferences` | vœux ordonnés : poste type, rang                                                                                                                                                                                                                                                                        | `UNIQUE (application_id, position_id)`, `UNIQUE (application_id, rank)`, `CHECK rank ≥ 1`                                                                                            |
| `volunteer_availabilities`       | plages `available` / `unavailable` (`starts_at`, `ends_at`)                                                                                                                                                                                                                                             | `CHECK ends_at > starts_at` ; validation domaine : dans la fenêtre de l'événement ± 1 jour, plages disponibles sans chevauchement                                                    |
| `volunteer_skills`               | compétences déclarées : niveau facultatif, **`verified`** + par/le (compétence `requires_verification`)                                                                                                                                                                                                 | `UNIQUE (application_id, skill_id)`                                                                                                                                                  |
| `volunteer_social_preferences`   | binôme souhaité : e-mail cible normalisé, `target_application_id` (résolu quand la personne candidate au même événement), `reciprocal` calculé                                                                                                                                                          | `UNIQUE (application_id, target_email)`, `CHECK target_email <> email du candidat` (domaine)                                                                                         |
| `events` (modification)          | `volunteer_recruitment_status` (`closed` \| `open`), `volunteer_target_count`, `volunteer_max_hours` (par jour), `volunteer_min_rest_minutes` — réglages lus par la phase 6                                                                                                                             | `CHECK` valeurs ≥ 0                                                                                                                                                                  |

Consolidation documentée : les questions personnalisées n'ajoutent aucune table (formulaires existants, `purpose = volunteer_application`, `subject_type = 'volunteer_application'`). `active_volunteer_commitments` est une **vue** de la phase 6 (affectations publiées), pas une table de cette phase.

## 4. Machine à états

```
VOLUNTEER APPLICATION
submitted → under_review | approved | waitlisted | rejected | withdrawn
under_review → approved | waitlisted | rejected | withdrawn
approved → waitlisted | rejected | assigned (phase 6) | withdrawn
waitlisted → approved | rejected | withdrawn
assigned → confirmed | approved (désaffectée) | withdrawn
confirmed → assigned (mission modifiée) | withdrawn
rejected, withdrawn : terminaux
```

`rejected` exige un motif (transmis au candidat) ; `withdrawn` vient du candidat (lien signé ou compte) — si des missions existent (phase 6), l'impact est expliqué et confirmé. Chaque transition : audit (acteur, motif) dans la même transaction. Aucune transition par `PATCH` générique.

## 5. API et UI

| Méthode            | URL                                                                                                                     | Permission / accès                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET / POST         | `/organizations/{id}/skills`, `…/volunteer-teams`, `…/volunteer-positions`                                              | `volunteers.review`                                   |
| PATCH / DELETE     | `…/skills/{skillId}`, `…/volunteer-teams/{teamId}`, `…/volunteer-positions/{positionId}` (DELETE = archivage)           | `volunteers.review`                                   |
| GET / PATCH        | `/organizations/{id}/events/{eventId}/volunteering` (réglages, questions, postes activés, créneaux)                     | GET `volunteers.review` · PATCH `volunteers.schedule` |
| POST / PATCH / DEL | `…/events/{eventId}/volunteer-positions` et `…/volunteer-positions/{eventPositionId}/shifts[/{shiftId}]`                | `volunteers.schedule`                                 |
| GET                | `/organizations/{id}/volunteer-applications?eventId&status&positionId&skillId&q` (+ stats)                              | `volunteers.review` (périmètre événement respecté)    |
| GET / PATCH        | `…/volunteer-applications/{applicationId}` (PATCH = coordonnées, vœux, disponibilités, compétences, notes internes)     | `volunteers.review`                                   |
| POST               | `…/volunteer-applications/{applicationId}/{review\|approve\|waitlist\|reject}`                                          | `volunteers.review` ; motif requis pour `reject`      |
| POST               | `…/volunteer-applications/{applicationId}/skills/{skillId}/verify` (+ `unverify`)                                       | `volunteers.review`                                   |
| POST               | `…/volunteer-applications/bulk` `{ ids, action, reason? }` → résultat par enregistrement                                | `volunteers.review`                                   |
| GET                | `…/events/{eventId}/volunteer-availability-matrix`                                                                      | `volunteers.review`                                   |
| GET                | `/public/organizations/{slug}/events/{eventSlug}/volunteering` (postes, créneaux, questions, compétences)               | anonyme (recrutement ouvert et événement publié)      |
| POST               | `/public/organizations/{slug}/events/{eventSlug}/volunteer-applications`                                                | anonyme ou connecté ; renvoie `accessToken` une fois  |
| GET / PATCH        | `/public/volunteer-applications/{applicationId}` (`?k=` / connecté) ; PATCH = vœux, disponibilités, binôme, contraintes | candidat ; 404 uniforme                               |
| POST               | `/public/volunteer-applications/{applicationId}/withdraw`                                                               | candidat                                              |

UI organisateur : `/o/[slug]/benevoles` (11 : acceptés / objectif, à examiner, liste d'attente ; onglets candidatures, équipes & postes, compétences ; filtres ; sélection + actions en lot), `/o/[slug]/benevoles/candidatures/[applicationId]` (12 : fiche, correspondance vœux ↔ compétences requises, disponibilités projetées sur les créneaux, vérification des compétences, binôme, notes internes, décisions, modification), `/o/[slug]/evenements/[eventSlug]/benevoles` (13 : recrutement ouvert/fermé, objectif, questions, postes activés et créneaux, **matrice de disponibilité**), nav « Bénévoles ». Public : `/[orgSlug]/[eventSlug]/benevoles` (37 + 38, deux étapes), `/candidature/[applicationId]` (39 : statut, modification, retrait), `/moi/candidatures`. CTA « Devenir bénévole » sur la page événement quand le recrutement est ouvert.

E-mails : candidature reçue (lien de suivi), acceptée, liste d'attente, non retenue (motif), retrait confirmé, invitation binôme (« X souhaite être en binôme avec vous », lien vers le formulaire — n'indique rien d'autre).

## 6. Sécurité

- Tenant : FK composites ; B ne voit ni compétences, ni postes, ni candidatures de A (403/404) ; manager limité à un événement ne voit que ses candidatures.
- Notes internes et motifs de décision interne jamais renvoyés par les routes `/public/*` ; les réponses publiques n'exposent ni `organizationId` ni hash.
- **Aucune exposition d'un autre bénévole** : la déclaration d'un binôme ne révèle pas si la cible a candidaté ; la réciprocité n'est montrée qu'aux deux personnes concernées et à l'équipe ; la liste publique ne cite personne.
- Jeton candidat dérivé et haché, renvoyé une fois, 404 uniforme ; `status` non modifiable par le candidat (retrait uniquement via route dédiée).
- Disponibilités validées côté serveur (fenêtre, chevauchement, bornes), vœux validés contre les postes activés de l'événement, compétences contre le catalogue de l'organisation.
- Traitement en lot : chaque enregistrement est validé et audité séparément ; un échec n'annule pas les autres (résultat détaillé).
- Tests négatifs : outsider 403/404 ; B sur A 404 ; jeton forgé 404 ; `status`/`internalNotes` ignorés en PATCH public ; binôme non révélateur (même réponse que la cible ait candidaté ou non) ; double candidature 409 ; disponibilité hors fenêtre 422 ; créneau requis > max 422.

## 7. Tests attendus

Unit : machine à états, fusion disponible − indisponible, validation des plages. Intégration : catalogue (compétences, équipes, postes, compétences requises) ; réglages et créneaux d'un événement ; candidature complète (vœux ordonnés, plages, compétences, binôme, réponses aux questions) ; double candidature refusée ; revue → acceptée / liste d'attente / non retenue (motif) ; retrait ; vérification de compétence ; binôme réciproque résolu à la seconde candidature ; matrice de disponibilité ; traitement en lot avec un échec ; isolation tenant ; questions obligatoires manquantes 422. Sécurité (API directe) : liste §6. E2E : organisation → compétences/poste/créneaux → recrutement ouvert → Maya candidate (deux étapes, binôme) → suivi → Nora examine, vérifie une compétence, accepte → Maya voit « acceptée » → seconde candidature (binôme réciproque) → liste d'attente → retrait.

## 8. Hypothèses (décidées)

1. Une candidature vise un événement (les disponibilités n'ont de sens que pour ses dates) ; le « vivier » inter-événements viendra du CRM (phase 7).
2. `volunteers.review` couvre lecture et décisions ; `volunteers.schedule` couvre postes activés, créneaux et réglages de recrutement.
3. Fenêtre de disponibilité acceptée : du début de l'événement − 24 h à la fin + 24 h (montage, démontage) ; les plages indisponibles sont soustraites.
4. Le binôme est une préférence souple : il ne bloque jamais une décision.
5. Base hébergée (Supabase) : bundle `0005` régénéré ; application dès que le projet est joignable, état consigné dans le rapport.
