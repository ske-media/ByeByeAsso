# Tests de sécurité

Deux familles :

1. **Statique** (`no-leaked-secrets.test.ts`) — aucune dépendance externe.
2. **Par API directe** (`tenant-isolation.test.ts`) — attaque chaque route avec des identifiants forgés depuis un compte d'une autre organisation. Nécessite un serveur lancé avec :

```bash
APP_ENV=test EMAIL_PROVIDER=file EMAIL_FILE_PATH=.tmp/outbox.jsonl pnpm --filter @kroov/web start
E2E_BASE_URL=http://localhost:3000 pnpm test:security
```

Le fichier `EMAIL_FILE_PATH` sert de boîte de réception : les tests y lisent les liens de vérification et d'invitation. `APP_ENV=test` désactive le rate limiting d'authentification (sinon les enchaînements d'inscriptions seraient bloqués) ; tout le reste (origine, sessions, RBAC) est identique à la production.
