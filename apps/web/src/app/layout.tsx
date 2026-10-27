import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Kroov",
    template: "%s · Kroov",
  },
  description:
    "Organisez vos événements, vendez vos billets, mobilisez vos bénévoles et développez votre communauté depuis un seul endroit.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom must stay available (accessibilité : zoom 200 %).
  maximumScale: 5,
  themeColor: "#FAF7EE",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
