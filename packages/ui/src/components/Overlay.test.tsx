import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../test/axe.ts';
import { renderUi } from '../test/render.tsx';
import { Button } from './Button.tsx';
import { Dialog, Drawer } from './Dialog.tsx';

describe('Dialog', () => {
  function renderDialog() {
    return renderUi(
      <Dialog
        title="진도를 초기화할까요?"
        description="되돌릴 수 없어요."
        trigger={<Button>초기화</Button>}
        footer={
          <>
            <Button>취소</Button>
            <Button variant="danger">초기화하기</Button>
          </>
        }
      />,
    );
  }

  it('traps focus, closes on Escape, and returns focus to the trigger', async () => {
    const { user } = renderDialog();
    const trigger = screen.getByRole('button', { name: '초기화' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: '진도를 초기화할까요?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);

    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('has a labelled close button and no axe violations', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: '초기화' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: '닫기' })).toBeDefined();
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('Drawer', () => {
  it('is non-modal: the page stays usable, Escape closes and focus returns', async () => {
    const { user } = renderUi(
      <>
        <Drawer title="AI 튜터" trigger={<Button>튜터 열기</Button>}>
          <Button>질문 보내기</Button>
        </Drawer>
        <Button>배경 버튼</Button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: '튜터 열기' });
    await user.click(trigger);
    const drawer = await screen.findByRole('dialog', { name: 'AI 튜터' });
    expect(drawer.contains(document.activeElement)).toBe(true);

    await user.click(screen.getByRole('button', { name: '배경 버튼' }));
    expect(screen.getByRole('dialog', { name: 'AI 튜터' })).toBeDefined();

    screen.getByRole('button', { name: '질문 보내기' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});
