import type { AIStatus, AIStatusResponse } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { describeAi, planLabel, usageLevel, windowLabel } from './status.ts';

const res = (status: AIStatus, over: Partial<AIStatusResponse> = {}): AIStatusResponse => ({
  provider: 'codex',
  status,
  usage: null,
  pendingLogin: null,
  ...over,
});
const now = new Date(2026, 10, 15, 9, 0);

describe('describeAi', () => {
  it('keeps entry points enabled while the state is unknown or Codex has not started', () => {
    expect(describeAi(undefined)).toMatchObject({ usable: true, reason: null });
    expect(describeAi(res({ state: 'idle' }))).toMatchObject({ label: '대기 중', usable: true });
    expect(describeAi(res({ state: 'starting' }))).toMatchObject({ usable: true });
  });

  it.each([
    [{ state: 'logged_out' } as const, '연결 안 됨', 'AI 연결이 필요해요'],
    [{ state: 'not_installed', hint: 'x' } as const, 'Codex CLI 미설치', /설치/],
    [
      { state: 'unsupported_version', found: '0.1.0', required: '0.155.1' } as const,
      '지원하지 않는 버전',
      /업데이트/,
    ],
    [{ state: 'isolation_failed', problems: [] as string[] } as const, '격리 실패', /안전 설정/],
    [{ state: 'error', code: 'E', message: 'm' } as const, '연결 오류', /다시 연결/],
  ])('disables AI with a reason: %o', (status, label, reason) => {
    const ai = describeAi(res(status));
    expect(ai.label).toBe(label);
    expect(ai.usable).toBe(false);
    expect(ai.reason).toMatch(reason);
  });

  it('tells an expired login apart from never connecting (D-068)', () => {
    expect(describeAi(res({ state: 'logged_out', expired: true }))).toMatchObject({
      label: '로그인 만료',
      tone: 'warn',
      usable: false,
      reason: 'ChatGPT 로그인이 만료됐어요. 다시 로그인해 주세요',
    });
    expect(describeAi(res({ state: 'logged_out', expired: false })).label).toBe('연결 안 됨');
  });

  it('disables AI while the browser is offline, unless a local setup problem says more', () => {
    const offline = { label: '오프라인', usable: false, reason: /인터넷/ };
    expect(describeAi(undefined, now, false)).toMatchObject(offline);
    expect(describeAi(res({ state: 'ready', planType: null }), now, false)).toMatchObject(offline);
    expect(describeAi(res({ state: 'logged_out', expired: true }), now, false)).toMatchObject(
      offline,
    );
    expect(describeAi(res({ state: 'not_installed', hint: 'x' }), now, false).label).toBe(
      'Codex CLI 미설치',
    );
    expect(describeAi(res({ state: 'ready', planType: null }), now, true).usable).toBe(true);
  });

  it('shows usage warnings from the provider values', () => {
    const usage = (p: number) => ({ windows: [], highestUsedPercent: p, updatedAt: 0 });
    const ready = { state: 'ready', planType: 'pro' } as const;
    expect(describeAi(res(ready, { usage: usage(40) }))).toMatchObject({
      label: '연결됨',
      tone: 'ok',
    });
    expect(describeAi(res(ready, { usage: usage(85) }))).toMatchObject({
      label: '사용량 경고',
      tone: 'warn',
    });
    expect(describeAi(res(ready, { usage: usage(100) }))).toMatchObject({
      label: '한도 도달',
      tone: 'error',
    });
  });

  it('blocks until the rate limit resets', () => {
    const later = new Date(2026, 10, 15, 14, 30).toISOString();
    expect(describeAi(res({ state: 'rate_limited', resetsAt: later }), now)).toMatchObject({
      usable: false,
      reason: 'AI 사용량 한도에 도달했어요. 14:30에 다시 쓸 수 있어요.',
    });
    const past = new Date(2026, 10, 15, 8, 0).toISOString();
    expect(describeAi(res({ state: 'rate_limited', resetsAt: past }), now).usable).toBe(true);
  });

  it('reports a login in progress', () => {
    expect(
      describeAi(res({ state: 'logged_out' }, { pendingLogin: { loginId: 'l', startedAt: 1 } })),
    ).toMatchObject({ label: '로그인 진행 중', usable: false });
  });
});

describe('labels', () => {
  it('names usage windows by length', () => {
    const w = (mins: number | null) => ({
      id: 'primary' as const,
      usedPercent: 0,
      windowDurationMins: mins,
      resetsAt: null,
    });
    expect(windowLabel(w(300))).toBe('5시간 한도');
    expect(windowLabel(w(10_080))).toBe('주간 한도');
    expect(windowLabel(w(1_440))).toBe('1일 한도');
    expect(windowLabel(w(null))).toBe('기본 한도');
  });
  it('colors usage from 80% and 100%', () => {
    expect([79, 80, 99, 100].map(usageLevel)).toEqual(['normal', 'warn', 'warn', 'full']);
  });
  it('shows the plan type only', () => {
    expect(planLabel('pro')).toBe('Pro');
    expect(planLabel(null)).toBeNull();
  });
});
