import { cn } from "../lib/cn";

/**
 * Wordmark — approximation typographique de travail : « KROOV » noir + point lime.
 * À remplacer par le SVG officiel (un seul composant à modifier).
 */
export function Wordmark({ className, size = 35 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("k-wordmark inline-flex items-baseline text-ink", className)}
      style={{ fontSize: size }}
      role="img"
      aria-label="Kroov"
    >
      KROOV
      <span aria-hidden="true" className="text-lime" style={{ fontSize: size * 0.72, letterSpacing: "-0.12em" }}>
        .
      </span>
    </span>
  );
}
