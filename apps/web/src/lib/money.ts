import { formatMoney } from "@kroov/domain/kernel";

/** Client-safe money formatting from minor units (EUR/CHF). */
export function fmtMinor(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency: currency === "CHF" ? "CHF" : "EUR" });
}

/** "24,00" style editable value from minor units. */
export function majorString(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2).replace(".", ",");
}
