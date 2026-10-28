/**
 * Product-wide constants. Anything that is a *policy* (fees, hold durations, rest rules)
 * is NOT hard-coded here: those live in organization/event settings so they can be
 * configured and audited. The values below are structural.
 */

export const PRODUCT_NAME = "Kroov" as const;

/** Default locale and timezone for France-first launch. Stored per organization later. */
export const DEFAULT_LOCALE = "fr-FR" as const;
export const DEFAULT_TIMEZONE = "Europe/Paris" as const;
export const DEFAULT_CURRENCY = "EUR" as const;

/** API versioning prefix. */
export const API_PREFIX = "/api/v1" as const;

/** Supported ISO 4217 currencies for the MVP. Amounts are always integer minor units. */
export const SUPPORTED_CURRENCIES = ["EUR", "CHF"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Minor units per major unit for supported currencies. */
export const CURRENCY_MINOR_UNITS: Record<SupportedCurrency, number> = {
  EUR: 2,
  CHF: 2,
};

/** Inventory hold duration for a checkout (kit: « réservation de dix minutes »). */
export const CHECKOUT_HOLD_MINUTES = 10 as const;

/** Hard bound on tickets per order; the organizer sets a lower value per event. */
export const MAX_TICKETS_PER_ORDER_LIMIT = 50 as const;

/** Reserved organization slugs (routes that must never be shadowed by a tenant). */
export const RESERVED_SLUGS = new Set([
  "api",
  "app",
  "admin",
  "auth",
  "login",
  "logout",
  "signup",
  "connexion",
  "inscription",
  "organisations",
  "evenements",
  "events",
  "billets",
  "billet",
  "commande",
  "commandes",
  "paiement",
  "invitation",
  "o",
  "tickets",
  "scanner",
  "scan",
  "moi",
  "me",
  "aide",
  "help",
  "static",
  "_next",
  "kroov",
  "design-system",
  "sante",
  "health",
]);

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
