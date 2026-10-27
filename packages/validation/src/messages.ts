import { z } from "zod";

/**
 * French error map for Zod. Installed once per process (see `installFrenchErrorMap`).
 * Messages are user-readable: they describe what is wrong and what is expected,
 * never a stack trace or an internal path.
 */
export const frenchErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined || issue.input === null) {
        return "Ce champ est obligatoire.";
      }
      return "La valeur saisie n'a pas le format attendu.";
    case "too_small": {
      const min = String(issue.minimum);
      if (issue.origin === "string") {
        return issue.minimum === 1 ? "Ce champ est obligatoire." : `Saisissez au moins ${min} caractères.`;
      }
      if (issue.origin === "number" || issue.origin === "int") {
        return issue.inclusive ? `La valeur doit être au moins ${min}.` : `La valeur doit être supérieure à ${min}.`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return `Sélectionnez au moins ${min} élément(s).`;
      }
      return "La valeur est trop petite.";
    }
    case "too_big": {
      const max = String(issue.maximum);
      if (issue.origin === "string") {
        return `Saisissez au plus ${max} caractères.`;
      }
      if (issue.origin === "number" || issue.origin === "int") {
        return issue.inclusive ? `La valeur doit être au plus ${max}.` : `La valeur doit être inférieure à ${max}.`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return `Sélectionnez au plus ${max} élément(s).`;
      }
      return "La valeur est trop grande.";
    }
    case "invalid_format":
      if (issue.format === "email") return "Saisissez une adresse e-mail valide.";
      if (issue.format === "url") return "Saisissez une adresse web valide.";
      if (issue.format === "uuid") return "Identifiant invalide.";
      if (issue.format === "datetime") return "Saisissez une date et une heure valides.";
      if (issue.format === "date") return "Saisissez une date valide.";
      if (issue.format === "regex") return "Le format saisi n'est pas accepté.";
      return "Le format saisi n'est pas accepté.";
    case "invalid_value":
      return "Choisissez une valeur proposée.";
    case "unrecognized_keys":
      return "Des champs inattendus ont été envoyés.";
    case "not_multiple_of":
      return `La valeur doit être un multiple de ${String(issue.divisor)}.`;
    case "custom":
      return issue.message ?? "La valeur saisie n'est pas valide.";
    default:
      return "La valeur saisie n'est pas valide.";
  }
};

let installed = false;

/** Install the French error map globally (idempotent). */
export function installFrenchErrorMap(): void {
  if (installed) return;
  z.config({ customError: frenchErrorMap });
  installed = true;
}

export type FieldErrors = Record<string, string[]>;

/** Flatten a ZodError into field → messages, suitable for forms (aria-describedby). */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_form" : issue.path.map(String).join(".");
    const bucket = out[key] ?? [];
    bucket.push(issue.message);
    out[key] = bucket;
  }
  return out;
}
