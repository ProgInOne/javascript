import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { defined } from './cx.ts';

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode | undefined;
  checked?: boolean | 'indeterminate' | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean | 'indeterminate') => void) | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
}

/** Checkbox (Radix). Clicking the label text toggles it; the description is linked. */
export function Checkbox({ label, description, id, ...state }: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const descId = `${controlId}-desc`;
  const props = defined(state);
  return (
    <div className="pi-choice">
      <CheckboxPrimitive.Root
        {...props}
        id={controlId}
        className="pi-checkbox"
        aria-describedby={description ? descId : undefined}
      >
        <CheckboxPrimitive.Indicator className="pi-checkbox__indicator">
          {state.checked === 'indeterminate' ? (
            <Minus size={14} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="pi-choice__text">
        <label className="pi-choice__label" htmlFor={controlId}>
          {label}
        </label>
        {description && (
          <span className="pi-choice__description" id={descId}>
            {description}
          </span>
        )}
      </span>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  /** Group label, announced as the radiogroup name. */
  legend: ReactNode;
  options: readonly RadioOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  orientation?: 'horizontal' | 'vertical' | undefined;
}

/** Radio group (Radix): one tab stop, arrow keys move and select. */
export function RadioGroup({
  legend,
  options,
  orientation = 'vertical',
  ...state
}: RadioGroupProps) {
  const id = useId();
  const props = defined(state);
  return (
    <div className="pi-radio-group">
      <span className="pi-radio-group__legend" id={`${id}-legend`}>
        {legend}
      </span>
      <RadioPrimitive.Root
        {...props}
        orientation={orientation}
        aria-labelledby={`${id}-legend`}
        className="pi-radio-group__items"
        data-orientation={orientation}
      >
        {options.map((option) => {
          const itemId = `${id}-${option.value}`;
          return (
            <div key={option.value} className="pi-choice">
              <RadioPrimitive.Item
                id={itemId}
                value={option.value}
                className="pi-radio"
                {...defined({ disabled: option.disabled })}
                aria-describedby={option.description ? `${itemId}-desc` : undefined}
              >
                <RadioPrimitive.Indicator className="pi-radio__indicator" />
              </RadioPrimitive.Item>
              <span className="pi-choice__text">
                <label className="pi-choice__label" htmlFor={itemId}>
                  {option.label}
                </label>
                {option.description && (
                  <span className="pi-choice__description" id={`${itemId}-desc`}>
                    {option.description}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </RadioPrimitive.Root>
    </div>
  );
}
