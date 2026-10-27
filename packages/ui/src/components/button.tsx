"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

/**
 * Button — primaire lime, secondaire contour noir, danger bordeaux (décision destructive uniquement).
 * - Chargement : conserve sa largeur, annonce l'opération (aria-busy + texte).
 * - Désactivé : expose une raison visible via `disabledReason` (title + aria-describedby).
 * - Jamais de blanc sur lime : le texte reste encre.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap select-none",
    "min-h-touch rounded-[9px] border-[1.5px] px-[17px] py-3 text-[13px] font-bold leading-none",
    "transition-[background-color,border-color,color,transform] duration-ui ease-ui",
    "disabled:cursor-not-allowed disabled:border-[#d5d6cc] disabled:bg-disabled-bg disabled:text-disabled-text",
    "active:enabled:translate-y-px",
  ],
  {
    variants: {
      variant: {
        primary: "border-ink bg-lime text-ink hover:enabled:bg-[#d2f000]",
        secondary: "border-ink bg-transparent text-ink hover:enabled:bg-ink/5",
        solid: "border-ink bg-ink text-canvas hover:enabled:bg-black",
        danger: "border-danger bg-danger text-white hover:enabled:bg-[#8f262c]",
        ghost: "border-transparent bg-transparent text-ink hover:enabled:bg-ink/5",
      },
      size: {
        md: "min-h-touch px-[17px] py-3 text-[13px]",
        sm: "min-h-9 px-3 py-2 text-[12px]",
        lg: "min-h-12 px-6 py-3.5 text-[14px]",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** When true the button keeps its width, shows a spinner and announces `loadingLabel`. */
  loading?: boolean;
  loadingLabel?: string;
  /** Visible reason when disabled (rendered as tooltip text and for assistive tech). */
  disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      asChild = false,
      loading = false,
      loadingLabel = "Opération en cours",
      disabledReason,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;
    const reasonId = React.useId();

    return (
      <>
        <Comp
          ref={ref}
          type={asChild ? undefined : (type ?? "button")}
          className={cn(buttonVariants({ variant, size, fullWidth }), loading && "relative", className)}
          disabled={isDisabled}
          aria-disabled={isDisabled || undefined}
          aria-busy={loading || undefined}
          aria-describedby={disabled && disabledReason ? reasonId : props["aria-describedby"]}
          title={disabled && disabledReason ? disabledReason : props.title}
          {...props}
        >
          {loading ? (
            <>
              <span className="invisible contents" aria-hidden="true">
                {children}
              </span>
              <span className="absolute inset-0 flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span className="k-sr-only">{loadingLabel}</span>
              </span>
            </>
          ) : (
            children
          )}
        </Comp>
        {disabled && disabledReason ? (
          <span id={reasonId} className="k-sr-only">
            {disabledReason}
          </span>
        ) : null}
      </>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
