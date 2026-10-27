"use client";

import * as React from "react";
import { cn } from "../lib/cn";

/**
 * FormField — label permanent au-dessus, mention « obligatoire » explicite, aide sous le
 * champ, erreur sous le champ reliée par aria-describedby. La valeur saisie survit à une
 * erreur serveur (contrôles non contrôlés par défaut : le formulaire garde ses valeurs).
 *
 * Usage :
 *   <FormField label="Adresse e-mail" required hint="…" error={errors.email}>
 *     <Input name="email" type="email" />
 *   </FormField>
 *
 * The control reads ids and aria attributes from FieldContext, so server components can
 * compose fields without render props.
 */
interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Attributes a control should spread; empty outside a FormField. */
export function useFieldControl(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
} {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  return {
    id: ctx.id,
    ...(ctx.describedBy ? { "aria-describedby": ctx.describedBy } : {}),
    ...(ctx.invalid ? { "aria-invalid": true as const } : {}),
    ...(ctx.required ? { "aria-required": true as const } : {}),
  };
}

export interface FormFieldProps {
  label: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string | string[] | undefined;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, required = false, hint, error, children, className }: FormFieldProps) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const errors = Array.isArray(error) ? error : error ? [error] : [];
  const hasError = errors.length > 0;
  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  const value = React.useMemo<FieldContextValue>(
    () => ({ id, describedBy, invalid: hasError, required }),
    [id, describedBy, hasError, required],
  );

  return (
    <div className={cn("mb-4 block", className)}>
      <label htmlFor={id} className="mb-[7px] block text-[12px] font-bold">
        {label}
        {required ? <span className="ml-1 font-normal text-muted">(obligatoire)</span> : null}
      </label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {hint ? (
        <small id={hintId} className="mt-[5px] block text-[11px] leading-[1.5] text-muted">
          {hint}
        </small>
      ) : null}
      {hasError ? (
        <small id={errorId} role="alert" className="mt-[5px] block text-[11px] font-bold leading-[1.5] text-error-text">
          {errors.join(" ")}
        </small>
      ) : null}
    </div>
  );
}

const controlClass =
  "w-full min-h-touch rounded-[7px] border border-border-strong bg-[#fffefb] px-[13px] py-3 text-[13px] text-ink placeholder:text-muted/70 " +
  "aria-invalid:border-error-text aria-invalid:bg-error-bg/40 disabled:bg-disabled-bg disabled:text-disabled-text";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const field = useFieldControl();
    return <input ref={ref} className={cn(controlClass, className)} {...field} {...props} />;
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    const field = useFieldControl();
    return (
      <textarea
        ref={ref}
        className={cn(controlClass, "min-h-[95px] leading-[1.65]", className)}
        {...field}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => {
    const field = useFieldControl();
    return <select ref={ref} className={cn(controlClass, className)} {...field} {...props} />;
  },
);
Select.displayName = "Select";

/** Password input with a visible Afficher/Masquer toggle. */
export const PasswordInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const field = useFieldControl();
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(controlClass, "pr-24", className)}
          autoComplete={props.autoComplete ?? "current-password"}
          {...field}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="absolute top-1/2 right-2 min-h-9 -translate-y-1/2 rounded-[6px] px-2 text-[12px] font-bold text-ink hover:bg-ink/5"
        >
          {visible ? "Masquer" : "Afficher"}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
