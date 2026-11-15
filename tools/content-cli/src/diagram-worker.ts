// Child process for diagram.ts: reads a JSON array of Mermaid sources on stdin and writes a JSON
// array with `null` (parses) or the first line of the parse error for each source.
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
// Mermaid's DOMPurify needs a window at import time.
Object.assign(globalThis, { window, document: window.document });

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const sources = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];

const { default: mermaid } = await import('mermaid');
// Same locked settings as the web app (apps/web/src/features/lesson-reader/diagram.ts).
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false });

const results: (string | null)[] = [];
for (const source of sources) {
  try {
    await mermaid.parse(source);
    results.push(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push(message.split('\n').slice(0, 2).join(' ').trim() || '알 수 없는 구문 오류');
  }
}
process.stdout.write(JSON.stringify(results));
process.exit(0);
