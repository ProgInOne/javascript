import { act, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe.ts';
import { renderUi } from '../test/render.tsx';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { ProgressBar, ProgressRing } from './Progress.tsx';
import { Skeleton } from './Skeleton.tsx';
import { EmptyState, ErrorState } from './States.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.tsx';
import { useToast, type ToastOptions } from './Toast.tsx';

describe('Tabs', () => {
  it('moves and activates with arrow keys, Home and End', async () => {
    const { user, container } = renderUi(
      <Tabs defaultValue="read">
        <TabsList aria-label="학습 모드">
          <TabsTrigger value="read">읽기</TabsTrigger>
          <TabsTrigger value="practice">실습</TabsTrigger>
          <TabsTrigger value="notes">노트</TabsTrigger>
        </TabsList>
        <TabsContent value="read">레슨</TabsContent>
        <TabsContent value="practice">문제</TabsContent>
        <TabsContent value="notes">메모</TabsContent>
      </Tabs>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '읽기' }));

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '실습' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('문제');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '노트' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '읽기' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function Trigger(props: ToastOptions) {
    const toast = useToast();
    return (
      <Button
        onClick={() => {
          toast(props);
        }}
      >
        알림 띄우기
      </Button>
    );
  }

  it('announces the toast and hides info toasts after 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderUi(<Trigger title="백업했어요" description="방금 저장됨" />);
    await user.click(screen.getByRole('button', { name: '알림 띄우기' }));

    const status = await screen.findAllByRole('status');
    expect(status.some((el) => el.textContent.includes('백업했어요'))).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(screen.queryByText('백업했어요')).toBeNull();
  });

  it('keeps error toasts until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderUi(<Trigger title="백업에 실패했어요" variant="error" />);
    await user.click(screen.getByRole('button', { name: '알림 띄우기' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getAllByText('백업에 실패했어요').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '알림 닫기' }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('button', { name: '알림 닫기' })).toBeNull();
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger title="x" />)).toThrow(/ToastProvider/);
  });
});

describe('Progress', () => {
  it('exposes value, range, and percent text', () => {
    render(
      <>
        <ProgressBar label="단원 진도" value={3} max={4} />
        <ProgressRing label="오늘 목표" value={140} max={100} size={64} />
      </>,
    );
    const bar = screen.getByRole('progressbar', { name: '단원 진도' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuetext')).toBe('75%');

    const ring = screen.getByRole('progressbar', { name: '오늘 목표' });
    expect(ring.getAttribute('aria-valuenow')).toBe('100');
    expect(ring.getAttribute('aria-valuetext')).toBe('100%');
  });
});

describe('Skeleton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reserves space but stays invisible for 300ms, and is hidden from assistive tech', () => {
    vi.useFakeTimers();
    const { container } = render(<Skeleton variant="block" height={40} />);
    const el = container.firstElementChild;
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.getAttribute('data-visible')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(el?.getAttribute('data-visible')).toBe('true');
  });
});

describe('Badge, EmptyState, ErrorState', () => {
  it('render accessible structure', async () => {
    const { container } = render(
      <>
        <Badge variant="ai">AI 생성</Badge>
        <EmptyState
          icon={Inbox}
          title="아직 오답이 없어요"
          description="문제를 풀면 여기에 모여요."
          action={<Button variant="primary">문제 풀기</Button>}
        />
        <ErrorState
          variant="inline"
          title="튜터에 연결하지 못했어요"
          description="Codex 로그인 상태를 확인해 주세요."
          code="AI_UNAVAILABLE"
        />
      </>,
    );
    expect(screen.getByRole('heading', { level: 2, name: '아직 오답이 없어요' })).toBeDefined();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('튜터에 연결하지 못했어요');
    expect(alert.textContent).toContain('AI_UNAVAILABLE');
    expect(await axeViolations(container)).toEqual([]);
  });
});
