"use client";

import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth (same origin: /api/auth). */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

/** French messages for Better Auth error codes shown in forms. */
export function authErrorMessage(code: string | undefined, fallback = "Une erreur s'est produite. Réessayez."): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
      return "Adresse e-mail ou mot de passe incorrect. Votre saisie est conservée.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirmez d'abord votre adresse e-mail : un nouveau lien vient de vous être envoyé.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.";
    case "PASSWORD_TOO_SHORT":
      return "Le mot de passe doit contenir au moins 10 caractères.";
    case "PASSWORD_TOO_LONG":
      return "Le mot de passe est trop long (128 caractères maximum).";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "Ce lien n'est plus valide. Demandez-en un nouveau.";
    case "INVALID_EMAIL":
      return "Saisissez une adresse e-mail valide.";
    case "TOO_MANY_REQUESTS":
      return "Trop de tentatives. Patientez une minute avant de réessayer.";
    default:
      return fallback;
  }
}
