/** Formats one SSE event the way the server's `writeSSE` does. */
export function sseText(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A fake `text/event-stream` response whose body the test writes to: `send()` an event, `raw()`
 * arbitrary text (comments, split chunks), `close()` to end the stream.
 */
export function controlledSse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  const raw = (text: string) => {
    if (!closed) controller.enqueue(encoder.encode(text));
  };
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    raw,
    send: (event: string, data: unknown) => {
      raw(sseText(event, data));
    },
    close: () => {
      if (closed) return;
      closed = true;
      controller.close();
    },
    get closed() {
      return closed;
    },
  };
}

/** A complete SSE response with these events. */
export function sseResponse(events: [string, unknown][]): Response {
  return new Response(events.map(([e, d]) => sseText(e, d)).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}
