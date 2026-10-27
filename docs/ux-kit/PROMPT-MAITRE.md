# Prompt maître — Développer le MVP Kroov à partir des rendus

Tu es une IA développeuse responsable d’une application événementielle cohérente. Lis `GUIDE-DESIGN-IA.md`, `MATRICE-ECRANS.md`, `tokens.json` et les PNG concernés avant d’écrire le code. Les HTML sont des sources de rendu statiques, pas des composants applicatifs à copier sans adaptation. Respecte les arbitrages confirmés, conserve les hypothèses comme configuration explicite, et n’invente pas le contenu absent du précédent cahier des charges V0.2.

Objectif : France d’abord ; associations et entreprises ; billetterie native ; adhésions à l’organisation ; bénévoles et planning proposé automatiquement puis validé humainement ; marketing ; abonnement SaaS et frais à paramétrer. Produis des interfaces fonctionnelles correspondant à l’intention des 48 écrans, avec états de chargement, vide, erreur, succès et accès interdit.

## Méthode obligatoire

Inspecte le projet existant, ses conventions et ses tests. Réutilise sa stack et son système d’authentification lorsque cela est approprié. N’introduis pas un nouveau fournisseur, une nouvelle infrastructure ou une tarification implicite pour reproduire les maquettes. Si aucun projet n’existe, propose et documente une architecture minimale avant la réalisation des intégrations externes. Le choix du fournisseur de paiement est à confirmer ; une interface d’adaptation et un mode sandbox peuvent être construits indépendamment.

Travaille par tranches verticales. À chaque étape : explique le comportement livré, les routes, les composants partagés, les autorisations, les états gérés et les tests pertinents. Ne considère pas une page finie uniquement parce qu’elle ressemble au PNG. Ne considère pas une maquette comme une autorisation d’envoyer des campagnes réelles ou de débiter une carte réelle.

## Étape 1 — Fondation et design system

Construis les tokens, typographies, champs sémantiques, boutons, badges, tables, panneaux, résumés, états système et trois shells. Reproduis les écrans 03, 25, 27 et 42 comme tranche visuelle de référence. Utilise des données fixes cohérentes à ce stade.

Réception : captures 1440 px et 390 px, navigation au clavier, vérification à 320 px, texte long, focus, erreurs accessibles. Les décorations ne masquent aucun contenu. Le logo reste remplaçable par un SVG officiel.

## Étape 2 — Identité et organisations

Implémente inscription/connexion, récupération, vérification d’adresse, organisations, sélection de contexte, invitations et rôles à périmètre organisation/événement. Écrans 01, 02, 23, 45, 46, 48. Ne révèle pas l’existence d’un compte via la récupération. Une invitation expirée ne fonctionne pas.

Réception : isolation entre deux organisations ; accès direct refusé hors périmètre ; propriétaire conservé ; rôles limités ; jetons à usage et durée bornés. Test de changement de compte et de retour à la route initiale.

## Étape 3 — Événements

Implémente brouillon, informations, dates avec fuseau, lieu, capacité, affiche, tarifs, quotas, publication et liste. Écrans 03–08. Les besoins bénévoles sont liés à l’événement, les adhésions ne le sont pas.

Réception : fin le lendemain validée, fin antérieure refusée, quotas cohérents, publication impossible si champs requis manquants, sauvegarde conservée après erreur. Vérifie modification concurrente et contrôle de rôle serveur.

## Étape 4 — Billetterie et paiement sandbox

Implémente page publique, sélection, réservation serveur, coordonnées, récapitulatif total, champs de paiement du prestataire, confirmation fiable, billets, téléchargement et rattachement au compte. Écrans 26–34. Crée un adaptateur de paiement et une configuration de frais remplaçable ; ne code pas les tarifs de démo comme politique universelle.

Réception : dernier billet demandé simultanément, réservation expirée, paiement refusé, authentification supplémentaire, retour incertain, double clic, webhook dupliqué, rafraîchissement. Aucun billet avant paiement confirmé, pas de double encaissement. Le QR de production est opaque ; le QR du PNG n’est jamais réutilisé.

## Étape 5 — Opérations de vente et finances

Écrans 09, 10, 22, 24. Commandes, participants, export autorisé, renvoi, remboursement sandbox, recettes, frais, versements et factures. Affiche des états réels provenant de l’intégration et distingue brut/net/versé/disponible.

Réception : montant en centimes, intégrité des totaux, remboursement idempotent, échec récupérable, tickets annulés après confirmation, exports limités au rôle. Tant que la politique de frais et de TVA n’est pas validée, indique le mode simulation et n’en déduis pas une comptabilité de production.

## Étape 6 — Adhésions

Écrans 17, 18, 35, 36, 47. Formules d’organisation, paiement mutualisé avec résumé adapté, période de validité, carte/attestation, expiration et renouvellement manuel. Une adhésion ne donne pas un rôle interne et ne remplace pas un billet.

Réception : pas de doublon actif accidentel, indépendance des événements, nouvelle période de renouvellement, ancienne période conservée, paiement incertain traité comme en billetterie.

## Étape 7 — Candidatures et disponibilités

Écrans 11, 12, 37–39. Postes préférés ordonnés, plages de disponibilité datées, souhait de binôme, candidatures, décisions, notes internes et retrait. Protège les contacts dans la recherche de binôme.

Réception : pas de doublon de candidature au même événement, disponibilités après minuit, notes non exposées au bénévole, acceptation sans affectation implicite, retrait avec conséquences affichées.

## Étape 8 — Proposition et publication du planning

Écrans 13–16 et 40. Modèle postes/créneaux/besoins, règles dures et souples, proposition versionnée, détail des conflits, affectation manuelle, arbitrages, validation humaine, publication et prise de connaissance.

Le moteur de proposition peut être déterministe ou optimisé par contraintes ; ne lui substitue pas un LLM qui invente des disponibilités. Expose les raisons des refus et les préférences non satisfaites. Sauvegarde le jeu d’entrées ayant produit une version. Vérifie à nouveau les contraintes à la publication si les disponibilités ont changé.

Réception : chevauchement bloqué ; trente minutes de pause configurées respectées ; créneau hors disponibilité impossible ; préférences jamais traitées comme promesses ; aucune publication automatique ; modification après publication versionnée. Une vue liste accessible remplace le besoin de glisser-déposer.

## Étape 9 — Marketing responsable

Écrans 19–21. Segments, consentement, campagne, aperçu, test, programmation, déduplication, désinscription, journal et résultat partiel. Recalcule l’audience au lancement.

Réception : contact désinscrit après la préparation exclu avant envoi ; achat sans consentement absent du segment ; retry sans doublon ; lien de désinscription fonctionnel sans authentification ; état partiellement échoué visible. Utilise des boîtes sandbox jusqu’à autorisation de mise en service.

## Étape 10 — Contrôle d’accès

Écrans 41–44. Périmètre événement, caméra, saisie manuelle, vérification serveur, enregistrement atomique, journal et retours contrastés avec texte. Ajoute variantes billet annulé/inconnu/autre événement et permission caméra refusée.

Réception : deux scanners simultanés → une seule entrée ; double scan identifiable ; réseau coupé → aucune entrée enregistrée ; reprise suivie d’une nouvelle vérification ; contrôleur sans accès aux finances ou à la base globale.

## Étape 11 — Réception transversale

Parcours complet avec les données du guide. Réconcilie les nombres selon les scénarios et versions ; ne mélange pas la préparation du 27 mai, le jour J et le renouvellement de décembre. Vérifie responsive, zoom, clavier, lecteurs d’écran, sécurité de périmètre, erreurs réseau, états financiers et journaux d’audit.

Livre : code, migrations selon la stack retenue, configuration documentée sans secrets, données de démo clairement isolées, commandes de lancement/test, captures comparatives et liste des décisions encore à confirmer. La présente livraison graphique n’est ni le modèle relationnel exhaustif V0.2 ni une preuve de conformité juridique ; ne le prétends pas.
