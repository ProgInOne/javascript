/** One dispatched Server-Sent Event. `data` is the raw (untrusted) payload text. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parses a `text/event-stream` body (WHATWG HTML "event stream interpretation"): `event:` and
 * `data:` fields, multi-line data, comments (`: keep-alive`), any line ending, and chunks that
 * split lines or multi-byte characters. `id:` and `retry:` are ignored (callers reconnect
 * themselves). An event without its closing blank line is incomplete and dropped, as specified.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const field = (text: string) => {
    if (text.startsWith(':')) return; // comment (keep-alive)
    const colon = text.indexOf(':');
    const name = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'event') event = value;
    else if (name === 'data') data.push(value);
  };

  function* lines(final: boolean): Generator<SseEvent> {
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) return;
      // A CR at the very end may be the first half of a CRLF split across chunks.
      if (!final && match[0] === '\r' && match.index === buffer.length - 1) return;
      const text = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (text !== '') {
        field(text);
        continue;
      }
      if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
      event = '';
      data = [];
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* lines(false);
    }
    buffer += decoder.decode();
    yield* lines(true);
  } finally {
    reader.releaseLock();
  }
}
