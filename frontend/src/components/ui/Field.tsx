'use client';

import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react';

// Design-system spec §6 "Form system" — "Do not rely on placeholder text
// as the only label" and §19 accessibility contract — "programmatic
// labels for forms... error messages are associated with their controls."
// Field is the shared label+control+hint/error wrapper both Input and
// Textarea build on, so that association is correct by construction
// rather than re-derived per screen.

interface FieldChromeProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

function fieldIds(id: string) {
  return { hintId: `${id}-hint`, errorId: `${id}-error` };
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const { hintId, errorId } = fieldIds(id);
  const ids = [error ? errorId : null, hint ? hintId : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function FieldChrome({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FieldChromeProps & { id: string; children: React.ReactNode }) {
  const { hintId, errorId } = fieldIds(id);
  return (
    // A wrapping <div>, not <label> — the label element itself only wraps
    // the label text (via htmlFor/id association below). Nesting the
    // hint/error text inside <label> too would fold it into the label's
    // computed accessible name (e.g. getByLabelText('Email') failing
    // because the real name became "Email Enter a valid email address"),
    // which the component test suite caught.
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--asoju-danger)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <span id={hintId} className="muted" style={{ fontWeight: 400 }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export type InputProps = FieldChromeProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { id?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldChrome id={fieldId} label={label} hint={hint} error={error} required={required}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={className}
        {...rest}
      />
    </FieldChrome>
  );
});

export type TextareaProps = FieldChromeProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { id?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldChrome id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={className}
        {...rest}
      />
    </FieldChrome>
  );
});
