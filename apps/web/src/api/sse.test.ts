import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { controlledSse } from '../test/sse.ts';
import { createStreamClient, parseStreamEvent, TOKEN_HEADER } from './client.ts';
import { readSse, type SseEvent } from './sse.ts';

function bodyOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks)
        c.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      c.close();
    },
  });
}

async function collect(chunks: (string | Uint8Array)[]): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of readSse(bodyOf(chunks))) out.push(e);
  return out;
}

describe('readSse', () => {
  it('parses events, multi-line data and comments', async () => {
    expect(
      await collect([
        ': keep-alive\n\n',
        'event: delta\ndata: {"text":"a"}\n\n',
        'data: line 1\ndata: line 2\n\n',
        'event:status\ndata:x\n\n',
      ]),
    ).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'message', data: 'line 1\nline 2' },
      { event: 'status', data: 'x' },
    ]);
  });

  it('handles chunks that split lines, CRLF pairs and multi-byte characters', async () => {
    const bytes = new TextEncoder().encode('event: delta\r\ndata: 한글\r\n\r\n');
    const chunks = Array.from(bytes, (b) => new Uint8Array([b]));
    expect(await collect(chunks)).toEqual([{ event: 'delta', data: '한글' }]);
  });

  it('drops an event that never got its closing blank line', async () => {
    expect(await collect(['event: done\ndata: {}\n\nevent: delta\ndata: cut'])).toEqual([
      { event: 'done', data: '{}' },
    ]);
  });
});

describe('stream client', () => {
  it('sends the token, delivers events as they arrive and resolves at the end', async () => {
    const sse = controlledSse();
    const fetchImpl = vi.fn(() => Promise.resolve(sse.response));
    const events: SseEvent[] = [];
    const done = createStreamClient({ token: () => 't1', fetchImpl })('/ai/events', {
      onEvent: (e) => events.push(e),
    });
    sse.send('status', { a: 1 });
    await vi.waitFor(() => {
      expect(events).toEqual([{ event: 'status', data: '{"a":1}' }]);
    });
    sse.close();
    await done;
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/ai/events');
    expect((init.headers as Record<string, string>)[TOKEN_HEADER]).toBe('t1');
    expect((init.headers as Record<string, string>)['accept']).toBe('text/event-stream');
  });

  it('throws the API error when the server refuses before streaming', async () => {
    const body = { error: { code: 'AI_NOT_CONNECTED', message: '연결 안 됨', retryable: false } };
    const run = createStreamClient({
      token: () => '',
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify(body), { status: 409 })),
    });
    await expect(
      run('/x', { method: 'POST', body: {}, onEvent: () => undefined }),
    ).rejects.toMatchObject({
      code: 'AI_NOT_CONNECTED',
      status: 409,
    });
  });
});

describe('parseStreamEvent', () => {
  const schemas = { delta: z.object({ text: z.string() }) };
  it('validates payloads per event name', () => {
    expect(parseStreamEvent(schemas, { event: 'delta', data: '{"text":"a"}' })).toEqual({
      name: 'delta',
      data: { text: 'a' },
    });
    expect(parseStreamEvent(schemas, { event: 'delta', data: '{"text":1}' })).toBeNull();
    expect(parseStreamEvent(schemas, { event: 'delta', data: 'not json' })).toBeNull();
    expect(parseStreamEvent(schemas, { event: 'toString', data: '{}' })).toBeNull();
  });
});
