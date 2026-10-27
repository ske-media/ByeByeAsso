/**
 * Kroov design tokens — the TypeScript mirror of styles.css `@theme`.
 * Source: UX kit `tokens.json` (livraison 1.0, 27 octobre 2026).
 *
 * These are *proposal* tokens: the official vector logo and a final brand palette may
 * replace them later. Every component reads tokens through CSS variables, so a swap
 * is a one-file change.
 */
export const colors = {
  canvas: "#FAF7EE",
  ink: "#181914",
  surface: "#FFFEF9",
  sidebar: "#F0EEE5",
  lime: "#DFFF00",
  pink: "#F6AED5",
  orange: "#FFAB66",
  lavender: "#DCD0FA",
  border: "#DEDDD3",
  borderStrong: "#C6C8BC",
  textMuted: "#63665B",
  neutral: "#ECECE4",
  errorBg: "#FAE4DF",
  errorText: "#85272E",
  danger: "#A32D34",
} as const;

export const space = [4, 8, 12, 16, 20, 24, 32, 48, 64] as const;

export const radius = { control: 8, panel: 14, pill: 999 } as const;

export const layout = {
  desktopReference: 1440,
  mobileReference: 390,
  sidebar: 214,
  topbar: 76,
  desktopGutter: 32,
  mobileGutter: 20,
  contentMax: 1280,
} as const;

export const interaction = {
  minTouchTarget: 44,
  mobileInputFontSize: 16,
  durationMs: 150,
} as const;

/** Editorial colour semantics (not status codes — status always carries a label). */
export const accentMeaning = {
  lime: "Action principale, sélection, succès accompagné de texte",
  pink: "Bénévoles, communauté, affiche",
  orange: "Attention, échéances, organisation pratique",
  lavender: "Adhésions, planning, aide à la décision",
} as const;
