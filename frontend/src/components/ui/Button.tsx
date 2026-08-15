'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

// Design-system spec §5 "Button system" — one shared primitive so variants
// stay visually consistent instead of six pages hand-rolling className
// strings. Wraps the existing .btn/.btn--secondary/.btn--ghost classes
// (frontend/src/app/globals.css) rather than inventing a new visual
// language, per that spec's own "use existing token system" rule.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonOwnProps {
  variant?: ButtonVariant;
  /** Preserves button dimensions while loading — spec §5 "Loading state
   * must preserve button dimensions." Also sets aria-busy and disables
   * the button so a slow request can't be double-submitted. */
  loading?: boolean;
  fullWidth?: boolean;
}

export type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn',
  secondary: 'btn btn--secondary',
  ghost: 'btn btn--ghost',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, fullWidth = false, disabled, className, children, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={[VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={fullWidth ? { width: '100%', ...style } : style}
      {...rest}
    >
      {loading && (
        <span className="btn__spinner" aria-hidden="true">
          <span className="btn__spinner-dot" />
        </span>
      )}
      <span style={loading ? { visibility: 'hidden' } : undefined}>{children}</span>
    </button>
  );
});
