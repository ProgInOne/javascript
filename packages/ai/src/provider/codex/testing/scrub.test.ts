import { describe, expect, it } from 'vitest';
import { findLeaks, scrubRecording, SCRUBBED_EPOCH } from './scrub.ts';

const line = (dir: 'c2s' | 's2c', msg: unknown) => ({ dir, line: JSON.stringify(msg) });

describe('scrubRecording', () => {
  const raw = [
    line('s2c', {
      id: 1,
      result: {
        userAgent: 'proginone/0.155.1 (Mac OS 26.1; arm64) Apple_Terminal',
        codexHome: '/tmp/rec-1/data/codex-home',
      },
    }),
    line('s2c', {
      id: 2,
      result: { account: { type: 'chatgpt', email: 'someone@mail.test', planType: 'pro' } },
    }),
    line('s2c', {
      method: 'remoteControl/status/changed',
      params: { serverName: 'alices-laptop.local' },
      emittedAtMs: 1794684586431,
    }),
    line('s2c', {
      id: 3,
      result: {
        type: 'chatgpt',
        loginId: '0f9e8d7c-1111-4222-8333-944455566677',
        authUrl: 'https://auth.openai.com/oauth/authorize?state=abc&code_challenge=xyz',
      },
    }),
    line('c2s', {
      id: 4,
      method: 'account/login/cancel',
      params: { loginId: '0f9e8d7c-1111-4222-8333-944455566677' },
    }),
    line('s2c', {
      id: 5,
      result: {
        thread: {
          id: '01a1db8a-3691-78b3-8049-ad2f8a7e5ffd',
          path: '/private/tmp/rec-1/data/codex-home/sessions/x.jsonl',
          createdAt: 1794684586,
        },
        cwd: '/tmp/rec-1/data/codex-workspace',
        rateLimits: {
          primary: { usedPercent: 62, resetsAt: 1794700000 },
          credits: { balance: '12.50', hasCredits: true },
        },
        item: { id: 'msg_0f7d683a539fb8e9016af8b6d936e487' },
        note: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig for alice at /Users/alice/x',
      },
    }),
  ];
  const out = scrubRecording(raw, {
    dataDirs: ['/tmp/rec-1/data', '/private/tmp/rec-1/data'],
    hidePaths: ['/Users/alice'],
    hideWords: ['alice'],
  });
  const text = JSON.stringify(out);

  it('replaces paths with placeholders the replay can substitute back', () => {
    expect(out[0]?.msg).toEqual({
      id: 1,
      result: { userAgent: 'proginone/0.155.1 (scrubbed)', codexHome: '$CODEX_HOME' },
    });
    expect(text).toContain('"cwd":"$WORKSPACE"');
    expect(text).toContain('$CODEX_HOME/sessions/x.jsonl');
  });

  it('removes account data, host names, login URL state and tokens', () => {
    expect(text).toContain('learner@example.invalid');
    expect(text).not.toContain('someone@mail.test');
    expect(text).not.toContain('alices-laptop');
    expect(text).toContain('https://auth.openai.com/oauth/authorize?scrubbed');
    expect(text).not.toContain('code_challenge');
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain('12.50');
    expect(text).not.toMatch(/alice/i);
  });

  it('maps identifiers and times to stable placeholders', () => {
    const login = (out[3]?.msg['result'] as { loginId: string }).loginId;
    const cancel = (out[4]?.msg['params'] as { loginId: string }).loginId;
    expect(login).toBe('00000000-0000-7000-8000-000000000001');
    expect(cancel).toBe(login);
    expect(text).toContain('msg_scrubbed0001');
    expect(text).toContain(`"createdAt":${SCRUBBED_EPOCH}`);
    expect(text).toContain(`"emittedAtMs":${SCRUBBED_EPOCH * 1000}`);
    expect(text).toContain(`"resetsAt":${SCRUBBED_EPOCH + 3_600}`);
  });

  it('finds nothing left to leak', () => {
    expect(findLeaks(text, { forbidden: ['alice'] })).toEqual([]);
  });
});

describe('findLeaks', () => {
  it('reports emails, tokens, local paths and forbidden words', () => {
    expect(
      findLeaks('a@b.co eyJabcdefghij.abc /Users/x "access_token":"t" Bob', { forbidden: ['bob'] }),
    ).toEqual(['email(1)', 'jwt', 'path', 'token', '"bob"']);
  });
});
