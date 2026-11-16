import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../test/axe.ts';
import { renderUi } from '../test/render.tsx';
import { PanelSeparator, type PanelSeparatorProps } from './PanelSeparator.tsx';

function Harness(props: Partial<PanelSeparatorProps> & { initial?: number }) {
  const { initial = 400, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <PanelSeparator
      label="패널 폭"
      orientation="vertical"
      min={360}
      max={560}
      value={value}
      onChange={setValue}
      onReset={() => {
        setValue(initial);
      }}
      {...rest}
    />
  );
}

describe('PanelSeparator', () => {
  it('is a focusable separator with its value, moved by arrow keys and Home/End', async () => {
    const { user, container } = renderUi(<Harness />);
    const handle = screen.getByRole('separator', { name: '패널 폭' });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('360');
    expect(handle.getAttribute('aria-valuemax')).toBe('560');
    expect(handle.getAttribute('aria-valuenow')).toBe('400');
    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('410');
    await user.keyboard('{End}{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('560');
    await user.keyboard('{Home}{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('360');
    // Double click restores the default.
    await user.dblClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('400');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('grows the panel after it with ← (a right drawer) and ↑ (a bottom panel)', async () => {
    const { user } = renderUi(
      <>
        <Harness label="오른쪽" panelAfter />
        <Harness label="아래" orientation="horizontal" panelAfter />
      </>,
    );
    const right = screen.getByRole('separator', { name: '오른쪽' });
    right.focus();
    await user.keyboard('{ArrowLeft}');
    expect(right.getAttribute('aria-valuenow')).toBe('410');
    const below = screen.getByRole('separator', { name: '아래' });
    expect(below.getAttribute('aria-orientation')).toBe('horizontal');
    below.focus();
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}');
    expect(below.getAttribute('aria-valuenow')).toBe('410');
  });

  it('converts pointer drags with pixelsPerUnit and keeps one decimal for non-pixel units', () => {
    renderUi(
      <Harness
        label="비율"
        initial={40}
        min={25}
        max={55}
        step={0.9}
        pixelsPerUnit={11}
        valueText="40%"
      />,
    );
    const handle = screen.getByRole('separator', { name: '비율' });
    expect(handle.getAttribute('aria-valuetext')).toBe('40%');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 155, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('45');
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('55');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('55');
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('54.1');
  });
});
