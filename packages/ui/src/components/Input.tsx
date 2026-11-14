import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Field } from './Field.tsx';
import { cx } from './cx.ts';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'children'> {
  /** Visible label (required: placeholders are not labels). */
  label: ReactNode;
  hint?: ReactNode | undefined;
  /** Error message; sets aria-invalid and links the message via aria-describedby. */
  error?: ReactNode | undefined;
}

/** 36px text input with label, hint, and error states. */
export function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      {({ id: controlId, describedBy, invalid }) => (
        <input
          {...rest}
          id={controlId}
          className={cx('pi-input', className)}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [describedBy, rest['aria-describedby']].filter(Boolean).join(' ') || undefined
          }
        />
      )}
    </Field>
  );
}
