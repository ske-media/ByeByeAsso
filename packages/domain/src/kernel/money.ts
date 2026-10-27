import { CURRENCY_MINOR_UNITS, type SupportedCurrency } from "@kroov/config/constants";

/**
 * Money is always an integer amount of minor units (centimes) plus an ISO 4217 code.
 * Floats are never used for money. Arithmetic is explicit and checked.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function assertInteger(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError(`Montant non entier ou hors limites : ${amountMinor}`);
  }
}

export function money(amountMinor: number, currency: SupportedCurrency = "EUR"): Money {
  assertInteger(amountMinor);
  if (amountMinor < 0) {
    throw new MoneyError(`Montant négatif interdit : ${amountMinor}`);
  }
  return Object.freeze({ amountMinor, currency });
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Devises différentes : ${a.currency} et ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const result = a.amountMinor - b.amountMinor;
  if (result < 0) {
    throw new MoneyError("Le résultat serait négatif.");
  }
  return money(result, a.currency);
}

export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantité invalide : ${quantity}`);
  }
  return money(a.amountMinor * quantity, a.currency);
}

/**
 * Percentage in basis points (1 bp = 0.01 %). Rounds half away from zero to the nearest minor unit.
 * Example: 2 % of 15 840,00 € → applyBasisPoints(money(1_584_000), 200) = 31 680 → 316,80 €.
 */
export function applyBasisPoints(a: Money, basisPoints: number): Money {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`Points de base invalides : ${basisPoints}`);
  }
  const raw = (a.amountMinor * basisPoints) / 10_000;
  return money(Math.round(raw), a.currency);
}

export function sumMoney(items: readonly Money[], currency: SupportedCurrency = "EUR"): Money {
  return items.reduce<Money>((acc, item) => addMoney(acc, item), money(0, currency));
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/**
 * French display: "15 840,00 €". Uses Intl so grouping and symbol placement follow fr-FR.
 */
export function formatMoney(a: Money, locale = "fr-FR"): string {
  const fractionDigits = CURRENCY_MINOR_UNITS[a.currency];
  const major = a.amountMinor / 10 ** fractionDigits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: a.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}
