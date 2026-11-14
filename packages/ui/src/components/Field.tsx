import { CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  /** Help text below the control, linked with aria-describedby. */
  hint?: ReactNode | undefined;
  /** Error message. When set the control is `aria-invalid` and the message is linked. */
  error?: ReactNode | undefined;
  /** Caller-provided id for the control; generated when omitted. */
  id?: string | undefined;
  /** Renders the control with the ids it must wire up. */
  children: (control: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

/**
 * Label + control + hint + error layout shared by form controls (WCAG 3.3.1).
 * The error shows an icon and text, never color alone.
 */
export function Field({ label, hint, error, id, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `${autoId}-control`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const invalid = error !== undefined && error !== null && error !== false;
  const describedBy =
    [hint ? hintId : undefined, invalid ? errorId : undefined].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="pi-field" data-invalid={invalid || undefined}>
      <label className="pi-field__label" htmlFor={controlId}>
        {label}
      </label>
      {children({ id: controlId, describedBy, invalid })}
      {hint && (
        <p className="pi-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {invalid && (
        <p className="pi-field__error" id={errorId}>
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
