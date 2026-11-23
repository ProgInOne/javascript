import type { ConsoleEntry, SerializedValue } from './run-protocol.ts';

/**
 * ProgInOne console format: the text the console panel shows and the canonical form of expected
 * output in `predict_output` / `console` checks (docs/design/code-execution-sandbox.md
 * #표시-형식과-정답-비교-형식).
 *
 * Rules: close to Node's `util.inspect`, but always one line per entry. Top-level strings print
 * raw; nested strings use double quotes. Arrays print as `[1, "a"]`, objects as `{ a: 1 }`.
 * Pure and DOM-free, so the runner's console UI and the server grader share it.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Levels that count as program output for console comparisons. */
export const OUTPUT_LEVELS: ReadonlySet<ConsoleEntry['level']> = new Set([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'dir',
  'table',
]);

/** Formats one console call: top-level arguments joined by a single space. */
export function formatConsoleArgs(args: readonly SerializedValue[]): string {
  return args.map(formatTopLevel).join(' ');
}

/**
 * Turns console entries into output lines (an entry whose text contains newlines yields several
 * lines). Only {@link OUTPUT_LEVELS} are included.
 */
export function consoleEntriesToLines(entries: readonly ConsoleEntry[]): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (!OUTPUT_LEVELS.has(entry.level)) continue;
    lines.push(...formatConsoleArgs(entry.args).split('\n'));
  }
  return lines;
}

/** Formats a value as it appears as a top-level console argument. */
export function formatTopLevel(value: SerializedValue): string {
  if (value.t === 'string') return value.v;
  if (value.t === 'error') return `${value.name}: ${value.message}`;
  return formatValue(value);
}

/** Formats a value as it appears nested inside a collection. */
export function formatValue(value: SerializedValue): string {
  switch (value.t) {
    case 'undefined':
    case 'null':
      return value.t;
    case 'boolean':
      return String(value.v);
    case 'number':
      return String(value.v);
    case 'bigint':
      return `${value.v}n`;
    case 'string':
      return JSON.stringify(value.v) + (value.truncated ? '...' : '');
    case 'symbol':
      return `Symbol(${value.description ?? ''})`;
    case 'function':
      return formatFunction(value.name, value.kind);
    case 'array': {
      const items = value.items.map(formatValue);
      const extra = value.length - value.items.length;
      if (value.truncated && extra > 0) items.push(`... ${extra} more item${extra > 1 ? 's' : ''}`);
      return `${refPrefix(value.refId)}[${items.join(', ')}]`;
    }
    case 'object': {
      const prefix =
        value.className === null
          ? '[Object: null prototype] '
          : value.className === 'Object'
            ? ''
            : `${value.className} `;
      if (value.collapsed) return `[${value.className ?? 'Object'}]`;
      const parts = value.entries.map(([key, v]) => `${formatKey(key)}: ${formatValue(v)}`);
      if (value.truncated) parts.push('...');
      const body = parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
      return `${refPrefix(value.refId)}${prefix}${body}`;
    }
    case 'map': {
      const parts = value.entries.map(([k, v]) => `${formatValue(k)} => ${formatValue(v)}`);
      if (value.truncated) parts.push('...');
      const size = value.size ?? value.entries.length;
      return `${refPrefix(value.refId)}Map(${size}) ${parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`}`;
    }
    case 'set': {
      const parts = value.items.map(formatValue);
      if (value.truncated) parts.push('...');
      const size = value.size ?? value.items.length;
      return `${refPrefix(value.refId)}Set(${size}) ${parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`}`;
    }
    case 'date':
      return value.iso;
    case 'regexp':
      return `/${value.source}/${value.flags}`;
    case 'error':
      return `[${value.name}: ${value.message}]`;
    case 'promise':
      return 'Promise {}';
    case 'getter':
      return '[Getter]';
    case 'dom':
      return value.preview;
    case 'circular':
      return `[Circular *${value.refId}]`;
    case 'unserializable':
      return `[Unserializable: ${value.reason}]`;
  }
}

function formatFunction(name: string, kind: string): string {
  const label = name === '' ? ' (anonymous)' : `: ${name}`;
  switch (kind) {
    case 'class':
      return name === '' ? '[class (anonymous)]' : `[class ${name}]`;
    case 'async':
      return `[AsyncFunction${label}]`;
    case 'generator':
      return `[GeneratorFunction${label}]`;
    default:
      return `[Function${label}]`;
  }
}

function formatKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function refPrefix(refId: number | undefined): string {
  return refId === undefined ? '' : `<ref *${refId}> `;
}
