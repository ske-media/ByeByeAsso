# ADR-003 — Traitement asynchrone durable : pg-boss + outbox transactionnel

Statut : accepté · 27 octobre 2026

## Contexte

Le produit a besoin de traitements différés fiables (e-mails de confirmation, relances, génération de planning, envois de campagnes, réconciliation de paiements). Le cahier des charges exige un traitement durable, des reprises et de l'idempotence, sans microservices prématurés.

## Décision

- **pg-boss 12** comme file de jobs, stockée dans PostgreSQL (schéma `pgboss`). Un seul datastore à sauvegarder, transactions possibles avec les écritures métier, reprises avec backoff, planification cron.
- **Outbox transactionnel** : un module écrit ses événements dans `outbox_events` dans la transaction de la modification d'état. Le worker relaie (`FOR UPDATE SKIP LOCKED`, lots de 100) vers des files `event.<type>`. Un événement n'est donc jamais perdu entre le commit et la mise en file.
- **Idempotence** : `idempotency_records (scope, key)` conserve la réponse d'une commande ; un rejeu avec un corps différent est un conflit. Les webhooks fournisseur utilisent `scope = "webhook:<provider>"`, `key = <event id>`.
- **Traçabilité** : `job_executions` conserve l'historique consultable des exécutions (90 jours) indépendamment de la rétention pg-boss (7 jours).

## Alternatives écartées

- Redis + BullMQ : second datastore à opérer et sauvegarder, aucune transaction commune avec PostgreSQL.
- Cron système : pas de reprise, pas de visibilité.

## Conséquences

- Le relais cron de sûreté tourne chaque minute ; pour une latence faible, les producteurs enverront un job `outbox.relay` immédiatement après commit (phase 1).
- Le worker doit rester sans état et supporter plusieurs instances.
