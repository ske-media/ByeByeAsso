# Runbook — sauvegarde et restauration

## Sauvegarde

```bash
DATABASE_URL=postgres://… scripts/backup.sh /chemin/des/sauvegardes
```

- `pg_dump` format custom compressé, `--no-owner --no-privileges` (restaurable sous n'importe quel rôle), schéma `pgboss` exclu (files transitoires, recréées par le worker).
- Produit `kroov-<UTC>.dump` et son `.sha256`. À copier hors du serveur (stockage objet versionné, autre région). Rétention conseillée : quotidienne 30 j, hebdomadaire 1 an.
- Avec une base managée : activer aussi les sauvegardes automatiques et le PITR du fournisseur ; ce script reste le moyen d'avoir une copie indépendante et de **tester** la restauration.

## Restauration (base neuve)

```bash
createdb -O kroov kroov_restore                      # base VIDE
scripts/restore.sh /chemin/kroov-<UTC>.dump postgres://…/kroov_restore
DATABASE_URL=postgres://…/kroov_restore pnpm db:migrate   # doit ne rien appliquer de nouveau
```

- Le script vérifie l'empreinte, refuse une base non vide, restaure avec `--exit-on-error`, puis affiche relations, migrations, organisations, commandes.
- Basculer l'application : pointer `DATABASE_URL` sur la base restaurée, redémarrer worker puis web ; le worker recrée le schéma `pgboss` et ses files ; l'outbox reprend (lignes `pending`).
- Après bascule : vérifier `/api/v1/health` (`ok`), un parcours de commande en sandbox, les webhooks Stripe en attente (Stripe réémet pendant 3 jours ; `payments.reconcile` réinterroge les paiements `pending`).

## Exercice réel (28 octobre 2026, base de développement)

| Étape                                    | Résultat                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/backup.sh .tmp/backups`         | `kroov-20261028T201412Z.dump` 1,1 Mo, sha256 `85afe0b9…`                                                                                                                                                                                            |
| `scripts/restore.sh … kroov_restore`     | empreinte OK, 94 relations, 11 migrations, 132 organisations, 60 commandes, **1,5 s**                                                                                                                                                               |
| `pnpm db:migrate` sur la base restaurée  | aucune migration nouvelle (11 → 11)                                                                                                                                                                                                                 |
| Comptages source / restaurée (12 tables) | users 250/250, organizations 132/132, events 238/238, orders 60/60, tickets 94/94, memberships 71/71, volunteer_applications 104/104, contacts 262/262, campaigns 30/30, tasks 33/33, ledger_entries 198/198, audit_logs 3095/3095 — **identiques** |

## Perte partielle (une organisation)

Pas de restauration ciblée automatisée : restaurer le dump dans une base de travail, puis extraire les lignes de l'organisation (toutes les tables portent `organization_id`) avec `pg_dump --data-only --table` filtré ou des `INSERT … SELECT` par `dblink`. À outiller si le besoin se présente.
