/**
 * audit module — public API.
 *
 * Phase 0: boundary declared, no behaviour yet. Implementation phase is documented in
 * docs/architecture.md (§ Domain modules). Other modules must import ONLY from this file,
 * never from internal files of this directory, and never touch this module's tables directly.
 */
export const MODULE_NAME = "audit" as const;
