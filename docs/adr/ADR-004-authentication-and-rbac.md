# ADR-004 — Authentification et contrôle d'accès

Statut : proposé (mise en œuvre phase 1) · 27 octobre 2026

## Décision

- **Better Auth** (1.7) pour l'identité : e-mail + mot de passe, vérification d'adresse, réinitialisation sans révéler l'existence d'un compte, liens magiques pour participants et bénévoles, sessions persistées dans PostgreSQL via l'adaptateur Drizzle, cookies `HttpOnly` / `Secure` / `SameSite=Lax`.
- **RBAC maison** (pas le plugin « organization » de Better Auth) parce que le modèle exigé — rôles multiples, permissions atomiques, périmètre organisation **et** événement, dernier propriétaire protégé, journal d'audit — doit vivre dans nos tables (`roles`, `permissions`, `role_permissions`, `member_role_assignments`) et être testé par accès direct.
- **Deny by default** : `requirePermission(actor, permission, { organizationId, eventId? })` est appelé **dans les services**, pas seulement dans la navigation. Le catalogue (`packages/auth/src/index.ts`) est la seule source des noms de permissions et des attributions par défaut.
- Un même compte peut cumuler des rôles dans plusieurs organisations sans héritage transversal ; un participant, adhérent ou bénévole n'accède qu'à ses propres objets.

## Conséquences

- Phase 1 livre les tests « organisation A tente d'accéder à chaque ressource de B » par appels API directs avec identifiants forgés.
- Les transitions sensibles (publication, remboursement, publication de planning) enregistrent l'acteur et la raison dans `audit_logs`.
