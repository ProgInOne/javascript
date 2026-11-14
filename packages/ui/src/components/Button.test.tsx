import { screen } from '@testing-library/react';
import { Plus, Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe.ts';
import { renderUi } from '../test/render.tsx';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    renderUi(<Button>저장</Button>);
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('type', 'button');
  });

  it('keeps label and focus while loading, sets aria-busy, and ignores clicks', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(
      <Button variant="primary" loading onClick={onClick}>
        제출
      </Button>,
    );
    const button = screen.getByRole('button', { name: '제출' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);

    await user.click(button);
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when idle', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(<Button onClick={onClick}>실행</Button>);
    await user.click(screen.getByRole('button', { name: '실행' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('has no axe violations across variants', async () => {
    const { container } = renderUi(
      <div>
        <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
          추가
        </Button>
        <Button variant="secondary">취소</Button>
        <Button variant="ghost">더 보기</Button>
        <Button variant="danger">삭제</Button>
        <Button variant="link">자세히</Button>
        <Button disabled>비활성</Button>
        <Button loading>저장 중</Button>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('IconButton', () => {
  it('uses the label as its accessible name and shows it as a tooltip on focus', async () => {
    const { user } = renderUi(
      <IconButton label="설정" shortcut="⌘," icon={<Settings size={18} />} />,
    );
    const button = screen.getByRole('button', { name: '설정' });
    await user.tab();
    expect(document.activeElement).toBe(button);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('설정');
    expect(tooltip.textContent).toContain('⌘,');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides the icon from assistive tech', async () => {
    const { container } = renderUi(<IconButton label="닫기" icon={<Settings size={18} />} />);
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
