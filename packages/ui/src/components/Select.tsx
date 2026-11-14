import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { Field } from './Field.tsx';
import { defined } from './cx.ts';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectProps {
  label: ReactNode;
  options: readonly SelectOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
}

/** Single-choice select (Radix): keyboard typeahead, arrow keys, Esc to close. */
export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  id,
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
}: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      {({ id: controlId, describedBy, invalid }) => (
        <SelectPrimitive.Root {...defined({ value, defaultValue, onValueChange, disabled, name })}>
          <SelectPrimitive.Trigger
            id={controlId}
            className="pi-select"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
            <SelectPrimitive.Value {...defined({ placeholder })} />
            <SelectPrimitive.Icon className="pi-select__icon">
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              className="pi-select__content"
              position="popper"
              sideOffset={4}
            >
              <SelectPrimitive.Viewport>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    {...defined({ disabled: option.disabled })}
                    className="pi-select__item"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="pi-select__check">
                      <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      )}
    </Field>
  );
}
