import "server-only";
import { loadServerEnv, type ServerEnv } from "@kroov/config/env";

let cached: ServerEnv | undefined;

/** Validated server environment for the web app (memoised per process). */
export function env(): ServerEnv {
  if (!cached) cached = loadServerEnv();
  return cached;
}
