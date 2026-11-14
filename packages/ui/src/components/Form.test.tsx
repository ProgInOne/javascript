import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe.ts';
import { renderUi } from '../test/render.tsx';
import { Checkbox, RadioGroup } from './Checkbox.tsx';
import { Input } from './Input.tsx';
import { Select } from './Select.tsx';

describe('Input', () => {
  it('links label, hint, and error; marks invalid only when there is an error', async () => {
    const { container, rerender } = renderUi(<Input label="목표 시간" hint="분 단위로 입력해요" />);
    const input = screen.getByRole('textbox', { name: '목표 시간' });
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText('분 단위로 입력해요').id).toBe(input.getAttribute('aria-describedby'));

    rerender(<Input label="목표 시간" hint="분 단위로 입력해요" error="1 이상이어야 해요" />);
    const invalid = screen.getByRole('textbox', { name: '목표 시간' });
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    const describedBy = (invalid.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy).toHaveLength(2);
    expect(describedBy).toContain(screen.getByText('1 이상이어야 해요').id);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Select', () => {
  const options = [
    { value: 'light', label: '라이트' },
    { value: 'dark', label: '다크' },
  ];

  it('is a labelled combobox that opens and selects with the keyboard', async () => {
    const onValueChange = vi.fn();
    const { user, container } = renderUi(
      <Select label="테마" options={options} placeholder="선택" onValueChange={onValueChange} />,
    );
    const trigger = screen.getByRole('combobox', { name: '테마' });
    expect(await axeViolations(container)).toEqual([]);

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('listbox')).toBeDefined();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });
});

describe('Checkbox', () => {
  it('toggles from its label and links the description', async () => {
    const onCheckedChange = vi.fn();
    const { user, container } = renderUi(
      <Checkbox label="자동 백업" description="매일 한 번" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole('checkbox', { name: '자동 백업' });
    expect(box.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByText('자동 백업'));
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    await user.keyboard(' ');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('RadioGroup', () => {
  it('is one tab stop and arrow keys move the selection', async () => {
    const { user, container } = renderUi(
      <RadioGroup
        legend="확신도"
        defaultValue="sure"
        options={[
          { value: 'sure', label: '확실해요' },
          { value: 'unsure', label: '애매해요' },
          { value: 'guess', label: '찍었어요' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: '확신도' })).toBeDefined();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '확실해요' }));

    // Hold the key: Radix selects on focus only while an arrow key is down.
    await user.keyboard('{ArrowDown>}');
    await user.keyboard('{/ArrowDown}');
    const unsure = screen.getByRole('radio', { name: '애매해요' });
    expect(document.activeElement).toBe(unsure);
    expect(unsure.getAttribute('aria-checked')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });
});
