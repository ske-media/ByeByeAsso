import { resolve } from "node:path";
import { config } from "dotenv";

// Load repo-root .env (then .env.test overrides) so DATABASE_URL_TEST is available.
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.test"), override: true });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    "DATABASE_URL_TEST est requis pour les tests d'intégration (ex. postgres://kroov:kroov@localhost:5432/kroov_test).",
  );
}

if (/kroov(?:_prod|_production)\b/.test(process.env.DATABASE_URL_TEST)) {
  throw new Error("Refus : DATABASE_URL_TEST semble désigner une base de production.");
}
