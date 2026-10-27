# Kroov — Guide de design et contrat UX pour IA développeuse

Version de livraison : 1.0 · 27 octobre 2026 · Langue : français · Marché initial : France.

## 1. Lire ce livrable correctement

Ce dossier contient 48 maquettes d’interface distinctes, en PNG HD, leurs sources HTML/CSS statiques, un catalogue local, des tokens et un prompt de réalisation. Les interfaces sont des spécifications visuelles, pas une application fonctionnelle. Les champs HTML de rendu sont volontairement statiques : ils doivent devenir de vrais contrôles sémantiques au développement. Les paiements, les notifications, le QR et les données sont simulés.

La référence fournie a été inspectée : fond crème, logo noir massif terminé par un point lime, affichage éditorial, aplats rose/orange/lavande et énergie collective. Les rendus utilisent une affiche événementielle typographique originale, construite en CSS. Ils ne reproduisent pas les photos ni le lettrage exact de l’image source. Le mot-symbole est une approximation typographique de travail, à remplacer par le logo vectoriel officiel lorsqu’il sera fourni.

**Limite de reprise du cahier des charges :** le texte complet des réponses précédentes V0.2 n’était pas accessible : les réponses étaient remplacées par des références de contenu. L’image et les messages utilisateur ont pu être récupérés. La couverture ci-dessous est donc exhaustive pour le périmètre explicite récupérable, et constitue une proposition de détail UX. Elle ne peut pas garantir une correspondance avec les sections invisibles du document précédent. À réception de V0.2, faire une comparaison écran par écran avant de figer les règles métier.

### Arbitrages explicitement validés dans la conversation

- France d’abord ; associations et organisateurs commerciaux.
- Billetterie native Kroov dès le MVP.
- Adhésions attachées à l’organisation, indépendantes des événements.
- Gestion des bénévoles avec disponibilités, préférences de postes et de collègues.
- Proposition automatique du planning, suivie d’une validation humaine.
- Marketing événementiel.
- Modèle envisagé : abonnement SaaS et frais transactionnels, à tester.

### Hypothèses proposées, à ne pas transformer en décisions acquises

Tarifs de démo, frais acheteur et organisateur ; règles de remboursement ; prestataire de paiement ; abonnement à 29 € HT ; durée de réservation de dix minutes ; achat sans compte ; rôles ci-dessous ; planning maximum de six heures avec trente minutes de pause ; contrôle d’accès uniquement en ligne ; adhésion annuelle à renouvellement manuel ; marketing par e-mail et liens de suivi. Ces choix rendent les parcours concrets. Ils sont paramétrables et doivent être confirmés lors du cadrage produit. La durée d’une mission ne constitue pas une recommandation juridique.

## 2. Direction artistique

**Principe : une marque expressive autour d’une interface calme.** Les grands titres, affiches et messages de succès portent l’énergie pop. Les formulaires, listes, données financières et alertes privilégient la clarté. Une page ne doit pas devenir une affiche sans hiérarchie.

Le fond crème reste majoritaire. Le noir structure le texte et les cadres. Le lime attire vers l’action principale. Rose pour les personnes et la communauté ; lavande pour les adhésions et l’aide à la décision ; orange pour l’attention ou l’organisation pratique. Ces associations sont éditoriales, pas des codes de permission ou de statut suffisants.

Éviter : dégradés décoratifs, verre translucide, ombres floues systématiques, boutons multicolores concurrents, capitales dans les paragraphes, éléments de marque derrière les champs, faux graphiques sans unité, écrans constitués seulement de grandes cartes d’inspiration.

L’astérisque, l’anneau et le sticker incliné sont réservés aux zones éditoriales. Aucun décor ne doit masquer un titre, une date ou un montant. Les tableaux restent alignés et sans rotation.

### Couleurs

| Token             | Valeur    | Usage                                                |
| ----------------- | --------- | ---------------------------------------------------- |
| `color.canvas`    | `#FAF7EE` | Fond principal crème                                 |
| `color.ink`       | `#181914` | Texte et contours forts                              |
| `color.surface`   | `#FFFEF9` | Panneaux, formulaires et listes                      |
| `color.sidebar`   | `#F0EEE5` | Navigation organisateur                              |
| `color.lime`      | `#DFFF00` | CTA principal, sélection, succès accompagné de texte |
| `color.pink`      | `#F6AED5` | Bénévoles, communauté, affiche                       |
| `color.orange`    | `#FFAB66` | Attention, échéances                                 |
| `color.lavender`  | `#DCD0FA` | Adhésions, planning, explications                    |
| `color.border`    | `#DEDDD3` | Séparations non interactives                         |
| `color.textMuted` | `#63665B` | Texte secondaire                                     |
| `color.errorBg`   | `#FAE4DF` | Fond d’erreur                                        |
| `color.errorText` | `#85272E` | Erreur et texte associé                              |
| `color.danger`    | `#A32D34` | Action destructive confirmée                         |

Texte noir sur les aplats vifs ; jamais de blanc sur lime. Les couleurs d’état sont toujours accompagnées d’un libellé et, si utile, d’une icône. Les contours des contrôles doivent être plus contrastés que les séparateurs de cartes. Tester les contrastes de chaque combinaison réelle : les tokens seuls ne constituent pas une certification d’accessibilité.

### Typographie

Le rendu utilise Arial pour l’interface et Arial Black pour le mot-symbole, avec secours sans-serif. Aucune police distante n’est requise. Le logo est un élément de marque distinct : ne pas appliquer son interlettrage extrême aux données.

| Style                | Ordinateur     | Mobile         | Règle                                                                      |
| -------------------- | -------------- | -------------- | -------------------------------------------------------------------------- |
| Titre de page        | 43 px / 1,07   | 36 px / 1,04   | Graisse forte, interlettrage légèrement négatif                            |
| Titre de section     | 27 px / 1,15   | 23 px / 1,15   | Court, descriptif                                                          |
| Titre de panneau     | 17 px          | 14 px          | Gras                                                                       |
| Texte courant        | 14 px / 1,45   | 14 px / 1,5    | Jamais tout en capitales                                                   |
| Valeur de formulaire | 13 px de rendu | 15 px de rendu | Utiliser 16 px sur les vrais champs mobiles pour éviter le zoom navigateur |
| Libellé              | 12 px          | 12 px          | Toujours visible au-dessus du champ                                        |
| Métadonnée           | 11–12 px       | 11–12 px       | Ne pas y placer une information essentielle isolée                         |
| Gros indicateur      | 37 px          | 32–48 px       | Unité explicite, chiffres tabulaires en production                         |

Les petits cartouches décoratifs des affiches et identifiants de planches ne sont pas une référence pour le texte applicatif. En production, permettre le zoom à 200 %, l’agrandissement des polices système et la traduction sans troncature des actions.

### Espacement et forme

Base : 4 px. Échelle : 4, 8, 12, 16, 20, 24, 32, 48, 64. Colonnes desktop espacées de 22–24 px. Panneaux à 24 px de padding ; mobile 18–20 px. Coins de 7–9 px pour les champs et boutons, 12–14 px pour les panneaux. Trait standard 1 px, sélection 2 px. Ombre dure 4 px réservée à la carte d’adhérent ou à un sticker ; aucune ombre de décor sur les tableaux.

Cibles tactiles de 44 px minimum, 46–48 px recommandés. L’icône peut être plus petite, son bouton ne l’est pas. Le focus utilise un double anneau noir/crème décalé, visible sur fond lime comme sur fond crème.

## 3. Architecture et adaptation aux écrans

### Organisateur

Navigation gauche : Vue d’ensemble, Événements, Billetterie, Bénévoles, Planning, Adhésions, Marketing, Finances, Équipe & accès, Paramètres. Le sélecteur d’organisation est permanent. En contexte événementiel, afficher aussi l’événement actif dans le titre ou un sélecteur. Ne pas mélanger les données de deux organisations dans une même vue.

Largeur de référence : 1440 px ; navigation 214 px, bandeau supérieur 76 px, marge du contenu 32 px. Deux colonnes à ratio environ 1,65 / 1 pour un formulaire et son résumé. Les statistiques utilisent trois ou quatre colonnes selon le contexte. Une seule action principale par étape ; les actions secondaires restent discrètes.

### Public, adhérent et bénévole

Largeur de référence : 390 px. Marge latérale 20 px. Lecture verticale. Navigation principale : Découvrir, Mes billets, Collectif, Mon compte. Les flux d’achat et de candidature réduisent cette navigation pour limiter les sorties accidentelles. Les barres de statut des PNG illustrent un téléphone ; ne pas les coder dans le site web.

Le contrôle d’accès est un mode professionnel séparé : Scanner, Rechercher, Journal. Ne pas y afficher la navigation publique. Le rôle du contrôleur et l’événement attribué restent identifiables.

### Breakpoints à implémenter

- ≥ 1200 px : composition desktop des PNG ; largeur de contenu plafonnée pour éviter les lignes trop longues sur grand écran.
- 768–1199 px : navigation repliable, panneaux secondaires sous le contenu principal si nécessaire ; deux indicateurs par ligne.
- < 768 px : une colonne, navigation mobile/drawer, listes transformées en fiches, boutons d’action confortables.
- 320 px minimum : aucun débordement de page ; noms et montants longs testés. Les tables peuvent défiler dans un conteneur identifié, jamais toute la page.
- Planning : défilement temporel explicite avec légende ; proposer une vue liste sur mobile et une alternative accessible à tout glisser-déposer.

Les 48 PNG ne sont pas 48 pages fixes à placer dans un canvas. Ils définissent un système adaptable. Les sources statiques ne contiennent pas cette adaptation complète : elle fait partie du travail de l’IA développeuse.

## 4. Composants à construire

`OrganizationShell`, `PublicShell`, `CheckInShell`, `PageHeader`, `OrganizationSwitcher`, `EventSwitcher`, `Stat`, `EventPoster`, `EventCard`, `DataTable`, `StatusBadge`, `FormField`, `DateTimeRange`, `MoneyInput`, `QuantityStepper`, `OrderSummary`, `ConfirmAction`, `VolunteerPreferencePicker`, `AvailabilityEditor`, `ScheduleGrid`, `AssignmentInspector`, `PublicationReview`, `TicketCard`, `MemberCard`, `ScanResult`, `EmptyState`, `ErrorState`, `Toast`, `LoadingState`.

**Bouton** : primaire lime, secondaire contour noir, danger bordeaux uniquement pour une décision destructive. Chargement conserve sa largeur et annonce l’opération. Désactivé possède une raison visible. Ne pas utiliser la couleur seule pour distinguer les actions.

**Champ** : label permanent, indication obligatoire explicite, aide sous le champ, erreur sous le champ avec `aria-describedby`. La valeur saisie survit à une erreur serveur. L’e-mail invalide est signalé après sortie du champ ou soumission, pas à chaque caractère. Mot de passe avec bouton Afficher/Masquer. Champs de paiement hébergés par le prestataire.

**Table** : en-têtes sémantiques, tri explicite, pagination réelle, sélection groupée annoncée, recherche avec remise à zéro. Statuts accompagnés de texte. Actions de ligne accessibles au clavier ; un lien de détail n’intercepte pas les actions secondaires.

**Badge** : `brouillon`, `publié`, `payé`, `en attente`, `expiré`, `remboursé`, `actif`, `à examiner`, etc. Un badge ne ressemble pas à un bouton sauf s’il est réellement interactif.

**Résumé financier** : afficher prix unitaire, quantité, frais, total et devise. Stocker les montants en unités mineures, jamais en flottants. Ne jamais présenter un revenu brut comme un solde disponible. Un montant remboursé et un montant versé sont des métriques distinctes.

**Modale de confirmation** : intitulé concret, conséquence, montant/périmètre, action d’annulation, focus piégé puis rendu au déclencheur. Aucun clic hors modale ne déclenche l’action.

**Chargement** : skeleton dimensionnel sur les listes et indicateurs ; spinner local sur l’action. Ne jamais montrer temporairement « 0 ventes » quand la valeur est inconnue. Erreur de chargement avec Réessayer.

**Toast** : succès bref, non essentiel à la compréhension ; les conséquences irréversibles sont aussi visibles dans l’état principal. Les erreurs bloquantes persistent tant qu’elles ne sont pas résolues.

## 5. Données de démonstration et chronologie

Organisation : Le Collectif des Nuits, association fictive. Propriétaire : Camille Durand. Administrateur : Alex Garnier. Responsable bénévoles : Nora Diallo. Contrôleur : Yanis Roux. Acheteuse et adhérente : Lou Martin. Deuxième participant : Sam Moreau. Candidate : Maya Bernard.

Événement : Les Nuits en Commun, Le Sucre, Lyon, samedi 12 juin 2027 à 18 h jusqu’au dimanche 13 juin à 2 h, fuseau Europe/Paris. L’événement est fictif ; le lieu sert de repère de démonstration. Capacité 900. Première vague : 480 billets à 24 €. Standard : quota 420, dont 144 vendus à 30 €. Total vendu : 624. Restant : 276. Brut : 480 × 24 + 144 × 30 = 15 840 €. Les quotas de billets sont distincts des besoins bénévoles.

Commande KR-1048 : Lou Martin, deux billets standard pour Lou et Sam, 60 € de billets + 2,40 € de frais acheteur = 62,40 €. Cette commande est incluse dans les 624 billets du tableau de bord, pas ajoutée une seconde fois. Les écrans d’achat illustrent son parcours juste avant cet état. L’écran remboursement montre un formulaire non confirmé : ne pas réduire les métriques tant que le remboursement n’est pas effectif.

Adhésions : 128 actives à 20 € pour 2027, soit 2 560 €. Elles ne font pas partie du brut billetterie de 15 840 €. Lou est déjà adhérente dans le scénario principal ; le formulaire d’adhésion illustre une acquisition antérieure ou un nouveau membre fictif. Une nouvelle adhésion ne doit pas créer un doublon actif pour Lou.

Bénévoles : 32 personnes acceptées sur un objectif de 36 ; 6 candidatures à examiner ; 44 affectations, dont 40 proposées. V3 : quatre affectations manquantes. V4 : quatre personnes supplémentaires acceptées, 36 personnes au total, 44 affectations couvertes. Une personne peut faire plusieurs missions compatibles. Les exemples V4 sont postérieurs au dashboard V3 ; ne pas afficher 32 et 36 comme deux vérités simultanées.

Marketing : 412 contacts dans le segment sélectionné avant vérification finale, 18 désinscriptions et 3 invalides exclus lors du contrôle, soit 391 destinataires. Recalculer au moment de l’envoi : le segment peut évoluer depuis sa constitution. Les métriques historiques « envois » et « clics » n’impliquent pas de suivi d’ouverture.

Finances illustratives : 2 % du brut = 316,80 € de frais organisateur, net 15 523,20 €. Versement effectué 10 000 € ; versement futur 5 523,20 €. Les frais acheteur restent hors du brut affiché. La qualification fiscale, la TVA sur les frais et les échéances sont à définir avec le prestataire ; ne pas implémenter les maquettes comme un calcul comptable validé.

Le contrôle d’accès se déroule le 12 juin et le renouvellement en décembre 2027. Les états d’erreur sont des branches alternatives, pas des événements successifs obligatoires. Les données de contact sont synthétiques et ne doivent jamais être utilisées pour envoyer de vrais messages.

## 6. Parcours et règles de comportement

### Connexion, création d’organisation et invitation

Écrans 01, 02, 46, 48. Connexion, retour vers la destination demandée, récupération de compte sans révéler si une adresse existe. Création d’organisation : association ou entreprise, nom, slug unique, pays, fuseau. Inviter une personne avec rôle et périmètre. Une invitation expirée propose un renvoi par un administrateur ; ne pas accepter un jeton expiré. L’adresse invitée doit être vérifiée. Un utilisateur déjà connecté avec une autre adresse doit pouvoir changer de compte.

### Événement

Écrans 03–08. Création en brouillon, informations, tarifs, configuration de l’équipe (réutiliser 11–13), puis vérification de publication. Sauvegarde explicite et retour avec données conservées. Validation de date de fin après date de début ; traversée de minuit explicite. Somme des quotas limitée à la capacité ; exceptions éventuelles uniquement si spécifiées plus tard. La suppression d’un brouillon et l’annulation d’un événement vendu sont deux actions différentes.

États proposés : `draft → published → ended → archived` ; `published → cancelled` par action dédiée avec revue des billets et remboursements. La fin des ventes n’annule pas l’événement. Modification d’une date ou d’un lieu après vente : demander confirmation et proposer une notification des participants. Les PNG ne définissent pas de politique contractuelle d’annulation.

### Achat et billet

Écrans 26–34. Découvrir → page événement → quantité → coordonnées → paiement → confirmation → billets. Tarifs épuisés conservés mais non sélectionnables. Prix total visible avant toute autorisation de paiement. Achat sans compte proposé ; rattachement ultérieur par adresse vérifiée. Consentement marketing facultatif, séparé des conditions de vente.

États de commande : `pending_payment → paid`, `pending_payment → expired`, `paid → refund_pending → refunded`. Une tentative de paiement peut échouer sans fermer la réservation. Une authentification bancaire complémentaire affiche « Validation bancaire en cours » et permet le retour. En cas de résultat incertain, afficher « Paiement en cours de vérification », pas un faux succès ou un nouvel encaissement.

La réservation est calculée côté serveur ; un compteur côté navigateur ne fait qu’afficher l’échéance. Réservation atomique pour éviter le surbooking ; libération idempotente. Les billets sont émis après confirmation fiable du prestataire, et non sur simple arrivée sur l’URL de succès. Un rafraîchissement, double clic ou webhook répété ne génère pas de nouveau billet ni une deuxième charge.

Billet : valide, utilisé, annulé. QR opaque vérifié côté serveur ; aucune donnée de carte ou donnée personnelle nécessaire dans le QR. Le motif décoratif des PNG est volontairement non scannable. Billet téléchargeable pour disponibilité au téléphone ; le contrôle lui-même reste en ligne dans cette proposition MVP.

### Gestion des ventes et remboursement

Écrans 09–10. Rechercher commande ou participant, filtrer, consulter, renvoyer, exporter. Un export est limité au périmètre autorisé et tracé. Remboursement avec montant et conséquence, confirmation, état en cours, résultat puis actualisation des billets. En cas d’échec, conserver la commande et proposer une reprise sûre. Le retour de quota dépend de la politique de vente et ne doit pas permettre la réutilisation d’un billet annulé.

Le scénario représente un remboursement intégral frais inclus ; le remboursement partiel, les frais non remboursables et la transférabilité ne sont pas arbitrés. Ne pas les ajouter implicitement.

### Adhésions

Écrans 17–18, 35–36, 47. Organisation → formule → coordonnées → paiement mutualisé → confirmation et carte. Écran 30 réutilisé avec résumé d’adhésion, sans billet ni quota événementiel ; écran 31 adapté au libellé « Adhésion confirmée », puis 36. Vérifier l’existence d’une adhésion active avant l’encaissement. Renouvellement manuel de la saison suivante, sans modifier la date de fin actuelle.

États : en attente de paiement, active, expirée, annulée ; un renouvellement est une nouvelle période reliée à l’adhésion précédente. Aucun rattachement obligatoire à un événement. Un rôle interne dans l’équipe ne s’obtient pas en payant une adhésion. Les avantages ne créent pas automatiquement un droit d’entrée.

### Bénévolat

Écrans 11–12, 37–40. Formulaire, préférences ordonnées, plages de disponibilité incluant les changements de date, binôme facultatif, envoi, suivi et décision. État : soumise, acceptée, non retenue, retirée. Accepter ne publie pas de mission. Les notes internes ne sont jamais visibles par le candidat. La recherche d’un binôme ne doit pas exposer toute la base de contacts : invitations et recherches limitées au contexte autorisé.

Après publication du planning, le bénévole peut accuser réception et signaler une indisponibilité. Ce signalement ne supprime pas silencieusement une affectation ; il crée un besoin d’arbitrage pour le responsable. Retrait d’une candidature acceptée avec missions : expliquer l’impact et demander confirmation.

### Planning intelligent

Écrans 13–16, puis 40. Définir postes, créneaux et besoins ; générer une proposition ; inspecter les conflits et manques ; modifier manuellement ; valider ; publier. Les règles du moteur doivent être affichables et auditables. Les disponibilités, chevauchements, compétences obligatoires et limites de durée sont des contraintes dures. Les préférences de poste et de binôme sont souples.

Aucune proposition ne devient publiée automatiquement. Interdire la publication en présence de conflits bloquants. Dans le scénario V4, l’intégralité des besoins est couverte ; un éventuel mode de publication avec postes vacants requiert un arbitrage produit séparé. Toute modification après publication crée une version de travail et un différentiel visible. Une notification doit identifier seulement les missions modifiées et la version qui fait foi.

Proposer une affectation par formulaire en plus du glisser-déposer. Afficher les dates de chaque extrémité si la mission passe minuit. Les libellés « personnes acceptées » et « affectations couvertes » ne sont jamais interchangeables. Une préférence impossible doit être expliquée, pas inventée comme satisfaite.

### Marketing

Écrans 19–21. Campagnes brouillon, audience, objet, message, aperçu, test, revue du nombre final, confirmation, envoi ou programmation. État : brouillon, programmée, envoi en cours, envoyée, partiellement échouée, échouée. Une campagne lancée n’est pas « annulable » rétroactivement.

Les consentements sont vérifiés au dernier moment ; un achat ou une adhésion ne vaut pas inscription marketing. Le lien de désinscription est systématique et fonctionne sans connexion. La liste des contacts exclus est consultable sans les réinscrire automatiquement. Limiter les doublons, gérer les rebonds et les reprises d’envoi sans doublonner les destinataires déjà servis.

### Contrôle d’accès

Écrans 41–44. Sélection de l’événement attribué, permission caméra, scan ou saisie manuelle. Permission refusée : expliquer comment autoriser la caméra et offrir la saisie manuelle. Succès : entrée enregistrée, identité, référence, heure. Double scan : alerte explicite et heure du premier passage. Ajouter les variantes du même composant : billet annulé, QR inconnu, mauvais événement. Chacune doit dire « Entrée non validée » avec une raison lisible.

Deux contrôleurs scannant le même billet doivent produire une seule entrée valide par écriture atomique. Une coupure réseau n’autorise pas l’entrée et n’affiche pas de succès local. Le contrôleur peut contacter le responsable. Un mode hors ligne futur exigerait un protocole spécifique de synchronisation et d’arbitrage ; il n’est pas simulé comme fonctionnel ici.

## 7. Matrice de permissions proposée

Les rôles sont une proposition UX. Toutes les permissions doivent être appliquées au serveur avec l’organisation et, si nécessaire, l’événement. Masquer un bouton ne protège pas une opération.

| Action                            | Propriétaire | Admin                 | Resp. événement    | Resp. bénévoles    | Marketing             | Finance               | Contrôle             |
| --------------------------------- | ------------ | --------------------- | ------------------ | ------------------ | --------------------- | --------------------- | -------------------- |
| Organisation, abonnement, banque  | Oui          | Non banque/abonnement | Non                | Non                | Non                   | Lecture financière    | Non                  |
| Inviter et gérer les rôles        | Oui          | Oui sauf propriétaire | Non                | Non                | Non                   | Non                   | Non                  |
| Créer/modifier/publier événement  | Oui          | Oui                   | Événement attribué | Lecture attribuée  | Lecture attribuée     | Lecture financière    | Lecture minimale     |
| Lire commandes et participants    | Oui          | Oui                   | Événement attribué | Non                | Non                   | Données nécessaires   | Identité au contrôle |
| Rembourser                        | Oui          | Oui                   | Non                | Non                | Non                   | Oui                   | Non                  |
| Gérer bénévoles                   | Oui          | Oui                   | Événement attribué | Événement attribué | Non                   | Non                   | Non                  |
| Proposer/valider/publier planning | Oui          | Oui                   | Événement attribué | Événement attribué | Non                   | Non                   | Non                  |
| Adhésions                         | Oui          | Oui                   | Non                | Non                | Segment consenti seul | Écritures de paiement | Non                  |
| Envoyer campagne                  | Oui          | Oui                   | Événement attribué | Non                | Périmètre attribué    | Non                   | Non                  |
| Voir finances/exporter            | Oui          | Oui                   | Synthèse événement | Non                | Non                   | Oui                   | Non                  |
| Scanner un billet                 | Oui          | Oui                   | Événement attribué | Non                | Non                   | Non                   | Événement attribué   |

Un participant, adhérent ou bénévole accède seulement à ses propres objets. Un même compte peut cumuler des rôles dans des organisations différentes sans héritage transversal. La transmission de propriété est un parcours dédié, distinct d’une invitation ordinaire. Une personne ne peut pas retirer le dernier propriétaire par erreur.

## 8. Contenus, confiance et accessibilité

Ton chaleureux mais concret. Titres éditoriaux courts, suivis d’un libellé métier explicite. Boutons : verbe + objet ou résultat. Préférer « Publier le planning V4 » à « C’est parti ». Erreur : ce qui s’est passé, ce qui est conservé, comment continuer. Pas de culpabilisation du candidat, de compte à rebours artificiel ou d’inscription marketing précochée.

Formats : français de France, 24 h, montants avec virgule et espace avant €, dates sans ambiguïté. Stockage des instants avec fuseau ou UTC, affichage Europe/Paris pour l’événement. Les changements d’heure et les missions après minuit font partie des tests. Les délais affichés doivent correspondre au serveur.

Développement accessible : un `h1` par page, régions `nav/main/header`, ordre de tabulation naturel, labels associés, erreurs annoncées, focus visible, messages de statut `aria-live`, boutons de scan de grande taille, alternative textuelle aux graphiques. Les graphiques ne sont jamais la seule source d’un montant. Icônes décoratives masquées aux lecteurs d’écran ; icônes interactives nommées.

Pour le planning, une table ou liste structurée des missions complète la grille. Le lecteur d’écran doit pouvoir connaître personne, poste, début, fin, conflit et statut sans lire les couleurs. Motion brève 120–180 ms et respect de `prefers-reduced-motion` ; aucune animation nécessaire pour comprendre une transition.

Vie privée : minimisation des données, aucune liste publique de bénévoles ou participants, contrôleur sans accès financier global, consentements marketing historisés, exports tracés. La mise en conformité juridique finale relève d’une validation dédiée ; le guide ne prétend pas fixer les délais légaux de conservation, le statut fiscal ou les obligations contractuelles.

## 9. États à implémenter même sans PNG distinct

Les 48 rendus séparent les parcours principaux et plusieurs états critiques. Les variantes suivantes se construisent avec les mêmes composants, et ne constituent pas chacune une nouvelle direction graphique : chargement, recherche vide, pagination, erreur champ par champ, invitation expirée, e-mail à vérifier, étape d’authentification bancaire, paiement en vérification, remboursement en cours/échoué, campagne partiellement échouée, bénévole non retenu ou retiré, événement annulé, billet annulé ou d’un autre événement, permission caméra refusée, renouvellement réussi, enregistrement concurrent refusé.

Pour chaque route livrée en développement : couvrir au minimum succès, attente, vide, erreur et accès interdit lorsqu’ils s’appliquent. Ne pas interpréter l’absence d’un PNG de variante comme une autorisation de ne pas gérer l’état.

## 10. Critères de réception

1. Les écrans utilisent les mêmes tokens, composants et noms de données que le présent dossier.
2. L’interface ne présente aucun montant contradictoire et ne confond pas billetterie et adhésions.
3. Les dates de fin après minuit sont explicites partout où une ambiguïté est possible.
4. La publication d’événement et de planning nécessite l’action autorisée prévue.
5. Les préférences bénévoles restent distinctes des contraintes dures.
6. Tous les CTA aboutissent à une action réelle ou un état d’attente explicite ; aucun faux succès.
7. Un double clic ou un webhook répété ne double pas l’effet financier.
8. Les validations de rôle et de périmètre sont testées côté serveur, y compris par accès direct.
9. Le scan simultané ne valide qu’une entrée et une coupure réseau n’accorde pas l’accès.
10. À 390 px et 1440 px, les vues correspondent aux intentions des PNG ; à 320 px et à zoom 200 %, l’information essentielle reste accessible.
11. Les formulaires sont utilisables au clavier et avec les aides techniques ; une erreur ne supprime pas la saisie.
12. Les données fictives et mentions de maquette ne contaminent pas la production.

## 11. Organisation des fichiers

- `PNG/` : 48 images séparées. Ordinateur : 2880 px de large. Mobile : 1170 px de large. La hauteur varie avec le contenu pour éviter les coupes.
- `sources/` : un HTML statique par écran et la feuille commune `style.css`.
- `index.html` : catalogue local avec aperçu, recherche et liens vers les PNG et sources.
- `manifest.json` : index machine des écrans et notes de scénario.
- `tokens.json` : tokens principaux à reprendre dans le code.
- `PROMPT-MAITRE.md` : consignes de réalisation par étapes testables.
- `MATRICE-ECRANS.md` : correspondance des écrans avec les parcours.
- `CONTROLE-QUALITE.md` : portée de la vérification effectuée sur les rendus.

Les fichiers s’ouvrent localement, sans service externe ni hébergement. Les sources HTML sont fournies pour la précision des mesures et la reproductibilité, pas comme une base backend prête à déployer.
