# Rapport de phase 7 — CRM et consentements

Date : 28 octobre 2026 · Cadrage préalable : `docs/phase-7-plan.md`.

## 1. Périmètre livré

Base de contacts **par organisation, jamais partagée** (même adresse ou même compte ailleurs = autre contact), nourrie automatiquement **dans la transaction** des commandes payées, adhésions activées, candidatures bénévoles déposées / décidées et plannings publiés ; création et édition manuelles ; identités (e-mails, téléphone normalisé, compte vérifié rattaché) ; **fiche 360°** (historique chronologique commandes / billets / adhésions / candidatures / missions, compteurs, identités, étiquettes, notes internes, journal de consentement, fusions) ; **journal de consentement append-only** avec base légale et preuve (case cochée → opt-in explicite ; achat ou adhésion payante sans case → exception client `customer_only`, **jamais** `opted_in` ; candidature → rien ; saisie manuelle avec preuve obligatoire ; retrait final jusqu'à nouveau consentement explicite) ; **liste d'exclusion par adresse** (désinscription, rebond, plainte, manuelle, effacement) qui prime sur tout consentement, consultable sans réinscrire personne, levée uniquement avec motif tracé ; étiquettes ; **doublons** proposés (téléphone, nom) et **fusion humaine** avec instantané ; **segments** dynamiques (règles combinables évaluées en SQL, aperçu en direct, recalcul à chaque usage) et statiques ; **export CSV** sous `contacts.export`, audité, sans notes internes ; reconstruction idempotente depuis l'historique ; indicateurs (actifs, consentis, client·es sans consentement, exclu·es, nouveaux 30 j, avec compte). Écrans : contacts (liste, étiquettes, doublons), fiche contact, segments (liste, constructeur avec aperçu, écran 19 partie audience), exclusions ; nav « Contacts ».

Hors périmètre, comme cadré : campagnes et envois, lien public de désinscription, rebonds (phase 8 — ils écrivent dans les exclusions et le journal via les commandes de ce module) ; effacement RGPD complet et export de portabilité (phase 10) ; enrichissement externe ; dédoublonnage automatique.

## 2. Fichiers créés ou modifiés

| Zone                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database` | `schema/crm.ts` (10 tables, 9 enums), migration `0007_crm.sql` (+ permission `contacts.manage` et ses attributions de rôles)                                                                                                                                                                                                                                                                                                          |
| `packages/auth`     | catalogue : `contacts.manage` (owner, admin, responsable événement, marketing, billetterie)                                                                                                                                                                                                                                                                                                                                           |
| `packages/domain`   | `crm/` : `identities` (pur), `schemas`, `contacts` (points de contact, reconstruction, liste, fiche, édition, notes, étiquettes, consentement, exclusions, doublons, fusion, export), `segments`, `index` — 2 555 lignes ; appels `recordTouchpoint` dans `ticketing/orders.ts` (commande payée), `memberships/memberships.ts` (activation), `volunteers/applications.ts` (dépôt, décision), `scheduling/scheduling.ts` (publication) |
| `packages/config`   | slugs réservés `contact(s)`, `segments`                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web`          | `actions/crm.ts`, 19 routes `/api/v1/*`, pages `/o/[slug]/contacts` (liste, filtres, étiquettes, doublons, export, reconstruction, nouveau contact), `…/contacts/[contactId]` (fiche 360°), `…/contacts/segments` (+ `nouveau`, `[segmentId]` : constructeur de règles avec aperçu en direct, membres statiques), `…/contacts/exclusions` ; nav « Contacts » ; libellés côté client `labels.ts`                                       |
| `tests`             | unitaires `crm/identities.test.ts` (8 cas), intégration `crm/crm.test.ts` (13 cas), sécurité S9 (4 cas), E2E `crm.e2e.ts` (3 parcours × 2 viewports)                                                                                                                                                                                                                                                                                  |
| `docs`              | `phase-7-plan.md`, `openapi.yaml` (0.7.0 : 110 chemins, 85 schémas), `er-diagram.md`, `architecture.md` (§7octies), captures `phase7-*`                                                                                                                                                                                                                                                                                               |

## 3. Migrations

`0007_crm.sql` : 10 tables (`contacts`, `contact_identities`, `contact_tags`, `contact_tag_assignments`, `contact_notes`, `consent_records`, `contact_suppressions`, `contact_merge_records`, `segments`, `segment_members`), 9 enums, 9 index uniques (dont les partiels `contacts_org_email_active_uq` — **un contact actif par adresse et organisation** —, `contact_identities_org_kind_value_uq WHERE kind <> 'phone'`, `contact_suppressions_active_uq`, `consent_records_source_uq` — un enregistrement par source), 11 index, 18 `CHECK` (adresses en minuscules et formatées, `merged ⇔ merged_into`, `archived ⇔ archived_at`, compteurs ≥ 0, preuve 1–1000, levée motivée, fusion de deux fiches distinctes, slugs), 23 FK dont les composites tenant-safe (contact, étiquette, segment, fusion, lignée `merged_into`). Permission `contacts.manage` insérée et attribuée à 5 rôles système. Appliquée sur base vierge (`db:reset` : 83 tables), `db:check` cohérent ; bundle Supabase régénéré (`.tmp/supabase/0000…0007`) et rejoué sur une base neuve : 83 tables, 8 lignes de journal, 5 attributions de `contacts.manage`.

Consolidation : aucune colonne nouvelle sur les tables des autres modules ; `marketing_opt_in` existant (commandes, adhésions, candidatures) devient la source des enregistrements de consentement.

## 4. API livrée

| Méthode                     | URL                                                                                        | Permission / accès                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| GET / POST                  | `/organizations/{id}/contacts?q&status&marketing&tagId&source&eventId&segmentId&sort&page` | GET `contacts.read` (+ `stats`) · POST `contacts.manage` (409 si adresse vivante)          |
| GET                         | `…/contacts/duplicates`                                                                    | `contacts.read` ; jamais de fusion automatique                                             |
| GET                         | `…/contacts/export` (CSV, BOM, `;`, `X-Row-Count`)                                         | `contacts.export` ; audité                                                                 |
| GET / PATCH                 | `…/contacts/{contactId}`                                                                   | `contacts.read` / `contacts.manage` ; statut, compteurs, consentement jamais patchables    |
| POST                        | `…/contacts/{contactId}/{archive\|restore}`                                                | `contacts.manage`                                                                          |
| POST · DELETE               | `…/contacts/{contactId}/notes` · `…/notes/{noteId}`                                        | `contacts.manage` ; notes absentes de toute route publique                                 |
| PUT                         | `…/contacts/{contactId}/tags`                                                              | `contacts.manage` ; étiquettes de l'organisation seulement (404)                           |
| POST                        | `…/contacts/{contactId}/consents` `{ status, evidence }`                                   | `contacts.manage` ; preuve obligatoire (422) ; append-only                                 |
| POST                        | `…/contacts/{contactId}/merge` `{ mergedContactId, reason? }`                              | `contacts.manage` ; deux fiches actives de l'organisation (404 / 412)                      |
| GET / POST · PATCH / DELETE | `…/contact-tags` · `…/contact-tags/{tagId}`                                                | `contacts.read` / `contacts.manage`                                                        |
| GET / POST                  | `…/suppressions?scope=active\|all` · POST `{ email, reason, note? }`                       | `contacts.read` / `contacts.manage` ; idempotent                                           |
| POST                        | `…/suppressions/{id}/lift` `{ reason }`                                                    | `contacts.manage` ; motif ≥ 3 caractères (422), déjà levée 412                             |
| GET / POST                  | `…/segments` · POST `…/segments/preview` (définition → nombre, consentis, échantillon)     | `contacts.read` (aperçu) / `contacts.manage` (création) ; références hors organisation 422 |
| GET / PATCH / DELETE        | `…/segments/{segmentId}` (+ évaluation)                                                    | `contacts.read` / `contacts.manage` (`version` = jeton, 409)                               |
| POST                        | `…/segments/{segmentId}/{evaluate\|members}`                                               | `contacts.read` / `contacts.manage` ; membres sur segment dynamique 412                    |
| POST                        | `…/crm/rebuild`                                                                            | `contacts.manage` ; idempotent, audité                                                     |

## 5. Routes UI livrées

Organisateur : `/o/[slug]/contacts` (indicateurs ; recherche ; filtres consentement / étiquette / origine / événement / état ; tableau avec statut de consentement, étiquettes, historique résumé ; pagination ; « Nouveau contact », « Exporter CSV (n) » si `contacts.export`, « Reconstruire » ; onglets Étiquettes et Doublons ; liens Segments et Exclusions), `/o/[slug]/contacts/[contactId]` (consentement avec journal et enregistrement manuel, historique chronologique avec liens vers commandes / adhésions / candidatures, notes internes, identités, étiquettes, fusion d'un doublon par recherche, archiver / modifier avec jeton de version), `/o/[slug]/contacts/segments` (+ `nouveau`, `[segmentId]` : règles — consentement, étiquette, événement avec relation, adhésion, commandes, activité, origine, recherche — combinées en ET / OU, aperçu en direct avec nombre de consentis, membres statiques par recherche, archivage), `/o/[slug]/contacts/exclusions` (actives / historique, exclure, lever avec motif).

## 6. Commandes exécutées et résultats réels

```
$ pnpm lint                              → exit 0   Checked 490 files. No fixes applied.
$ pnpm typecheck                         → exit 0   Tasks: 14 successful, 14 total
$ pnpm db:check                          → exit 0   Everything's fine
$ DATABASE_URL=…kroov_test pnpm db:reset → exit 0   Base réinitialisée et migrée. (0000 → 0007, 83 tables)
$ pnpm test:unit                         → exit 0   10 fichiers · 55 tests (47 phases 0–6 + 8 identités / consentement)
$ pnpm test:integration                  → exit 0   10 fichiers · 112 tests (99 phases 0–6 + 13 CRM)
$ pnpm test:security (statique)          → exit 0   1 test, 38 ignorés sans serveur (voulu)
$ node scripts/scan-secrets.mjs          → exit 0   511 fichiers, 0 finding
$ pnpm build                             → exit 0   Next.js compilé, 168 routes ; worker OK
$ scripts/test-server.sh start           → server up (APP_ENV=test, EMAIL_PROVIDER=file, PAYMENT_PROVIDER=fake)
$ E2E_BASE_URL=… pnpm test:security      → exit 0   2 fichiers · 39 tests (35 phases 1–6 + 4 phase 7)
$ E2E_BASE_URL=… pnpm test:e2e           → exit 0   64 passed (32 desktop-1440 + 32 mobile-390)
$ timeout 25 pnpm --filter @kroov/worker dev → "worker started" (aucune file nouvelle : alimentation synchrone)
$ node scripts/supabase-bundle.mjs + rejeu sur base neuve → 83 tables, 8 migrations journalisées
$ Supabase MCP list_tables               → "Database is possibly not accessible at the moment" (inchangé)
```

Cas unitaires (réellement exécutés) : normalisation e-mail (casse, espaces), téléphone E.164 (FR / CH, 00 / +, rejet des numéros implausibles), slugs, échappement CSV et neutralisation des formules ; dérivation du statut marketing : aucun enregistrement → `none` ; exclusion prime ; achat sans case → `customer_only` jamais `opted_in` ; opt-in explicite prime sur l'exception client quel que soit l'ordre ; retrait final, un achat ultérieur ne re-consent pas, un nouvel opt-in explicite oui.

Cas d'intégration notables : commande payée avec case cochée → `opted_in`, sans case → `customer_only` avec preuve « exception client » ; adhésion gratuite et candidature bénévole nourrissent la même fiche, la candidature ne crée aucune relation client (téléphone normalisé en identité) ; **même adresse dans l'organisation B = contact distinct**, qui ignore l'opt-in donné à A ; autre organisation 403 / 404 ; reconstruction idempotente (mêmes contacts, mêmes statuts, un seul consentement par source) ; lecteur (`contacts.read`) sans écriture ni export (403) ; étiquettes avec effectifs, notes avec auteur ; consentement manuel : preuve trop courte 422, accord → `opted_in`, retrait → `withdrawn`, **achat ultérieur ne re-consent pas** ; exclusion insensible à la casse, idempotente, prime sur l'opt-in, levée refusée sans motif puis levée tracée (liste active vide, historique conservé) ; archivage puis restauration automatique à l'achat ; création manuelle refusée sur adresse vivante ; version périmée 409 ; changement d'adresse vers une adresse d'un autre contact refusé ; doublons par téléphone ; fusion (identités, notes, consentements, historique rattachés ; fiche fusionnée en lecture seule ; nouvel achat sur l'adresse fusionnée → survivante) ; segments : consentis ayant commandé = 1, acheteurs = 2 dont 1 consenti, bénévoles acceptés, adhésion active ; référence de B refusée ; création calculée ; mise à jour avec jeton ; segment statique avec membres ; export CSV filtré, audité, sans notes.

Captures `docs/captures/phase7-*-{1440,390}.png` : contacts, fiche contact, segment avec aperçu, exclusions (historique).

## 7. Décisions prises pendant la phase

- **Alimentation synchrone dans la transaction source** (règle n° 3) plutôt que par consommateur d'outbox : cohérence immédiate pour l'organisateur, pas de file nouvelle, pas de latence dans les tests ; `recordTouchpoint` n'échoue jamais pour une adresse invalide (un paiement ne doit pas échouer à cause du CRM) et `rebuildContacts` couvre toute reprise.
- **`contacts.manage`** ajouté au catalogue : deny-by-default et minimisation interdisent de confondre lecture et écriture de la base de contacts ; `contacts.read` et `contacts.export` restent tels que prescrits.
- **Exception client enregistrée mais jamais consentante** : base légale conservée (art. L.34-5 CPCE) avec preuve, statut `customer_only` distinct, exclu des audiences consenties ; la phase 8 décidera campagne par campagne, avec lien de désinscription systématique.
- **Téléphone non unique** par organisation (foyers), unique par contact ; jamais de rapprochement automatique par téléphone ou nom — seulement des doublons proposés.
- **Fusion irréversible avec instantané** plutôt qu'un « défusionner » fragile : le journal d'audit et `contact_merge_records.snapshot` permettent de reconstituer la fiche à la main.
- **Statut marketing dénormalisé** sur la fiche, recalculé par le domaine après chaque événement : les listes, filtres et segments restent de simples requêtes SQL.
- Paramètres de listes SQL : Drizzle sérialise les tableaux JS en JSON dans les fragments `sql` ; helper `sqlList` (liste paramétrée `in (…)`) plutôt que `= any(…)`.
- Libellés côté client dupliqués (`labels.ts`) : les composants client ne peuvent pas importer `@kroov/domain/*`.

## 8. Limites connues

- **Base hébergée (Supabase) toujours non synchronisée** : même état qu'en phases 3–6. Bundle `0000…0007` prêt et vérifié localement.
- Pas d'effacement / anonymisation RGPD ni d'export de portabilité par contact (phase 10) ; la fiche expose déjà tout l'historique nécessaire.
- Les engagements et commandes sont rapprochés **par adresse e-mail** (identités du contact) ; une commande passée sous une adresse jamais rattachée reste invisible jusqu'à ce qu'un point de contact ou une édition manuelle l'ajoute comme identité.
- Export CSV borné à 50 000 lignes par appel ; pas d'export asynchrone.
- Pas de fusion « inverse » ni de défusion ; pas d'import de contacts (phase 8 ou 9 selon besoin).
- Les segments sont recalculés à chaque affichage (requêtes bornées au tenant) ; aucun cache partagé.

## 9. Sécurité

Livré : FK composites et `organization_id` sur toutes les tables ; une identité commune à deux organisations donne deux contacts indépendants ; aucune route ne liste ni ne recherche hors de l'organisation (autre organisation 404, outsider 403, responsable limité à un événement 403 sur la base organisation) ; lecture / écriture / export séparés ; statut, compteurs et consentement jamais patchables (test S9 : PATCH ignoré) ; consentement manuel toujours évidencié ; journal append-only ; exclusions levées seulement avec motif, jamais réinscrites automatiquement ; références de segment vérifiées dans l'organisation (422 sur étiquette ou événement étranger, y compris dans l'aperçu) ; notes internes absentes de l'export ; export audité ; cellules CSV échappées contre l'injection de formule. Tests négatifs : 4 par API directe (S9) + cas 403 / 404 / 409 / 412 / 422 en intégration.

## 10. Dépendances pour la phase 8 (marketing)

- Audience d'une campagne = `resolveDefinition` / `evaluateDefinition` d'un segment, filtrée sur `marketing_email_status = 'opted_in'` et sur l'absence d'exclusion active, **recalculée au lancement**.
- Désinscription publique → `suppressEmail(db, actor système, orgId, { email, reason: "unsubscribed", source: "system" })` ; rebonds → `reason: "bounced"` ; les deux rafraîchissent le statut du contact.
- `consent_records` accueille les opt-ins issus d'un formulaire public (`source: public_form`) ; `contact_suppressions` est vérifiée avant chaque envoi (règle du prompt maître).
- Tables `campaigns`, `campaign_recipients`, `tracking_links` à créer ; relais outbox pour l'envoi asynchrone.

## 11. Definition of Done — phase 7

| Critère                                                  | État                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le code se construit                                     | ✅ 168 routes                                                                                                                                                                                  |
| Typecheck                                                | ✅ 14/14                                                                                                                                                                                       |
| Lint                                                     | ✅                                                                                                                                                                                             |
| Migrations sur base vierge                               | ✅ 0000 → 0007, 83 tables, `db:check` ; bundle Supabase rejoué sur base neuve                                                                                                                  |
| Tests unitaires                                          | ✅ 55/55 (8 CRM)                                                                                                                                                                               |
| Tests d'intégration                                      | ✅ 112/112 (13 CRM)                                                                                                                                                                            |
| Tests E2E requis                                         | ✅ 64/64 : formule → adhésions avec / sans case → contacts aux statuts distincts → fiche, étiquette, note → consentement manuel → segment avec aperçu → exclusion et levée → fusion → export   |
| Tests d'autorisation                                     | ✅ 39/39 par API directe ; outsider, responsable limité, autre organisation (404), lecteur sans écriture ni export, PATCH de statut ignoré, preuve obligatoire, références étrangères refusées |
| Unified organizational contact views                     | ✅ fiche 360° par organisation, jamais partagée                                                                                                                                                |
| Identity linking                                         | ✅ e-mails, téléphone, compte vérifié ; fusion humaine avec instantané                                                                                                                         |
| Consent history                                          | ✅ journal append-only, base légale, preuve ; un achat ne vaut jamais consentement ; exclusions motivées                                                                                       |
| Segments                                                 | ✅ dynamiques (règles, aperçu, recalcul) et statiques ; références bornées au tenant                                                                                                           |
| Export subject to authorization                          | ✅ `contacts.export`, audité, sans notes internes                                                                                                                                              |
| Base hébergée à jour                                     | ⏳ migrations prêtes et vérifiées localement ; **Supabase injoignable depuis cet environnement** (§8)                                                                                          |
| Documentation (plan, OpenAPI, ER, architecture, rapport) | ✅                                                                                                                                                                                             |
