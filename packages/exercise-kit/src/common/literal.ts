import type { SerializedValue } from '@proginone/run-contract';

/**
 * Safe parser for JavaScript literals written by learners (and for expected console lines).
 * No `eval`: a small recursive-descent parser with depth, length and item limits.
 *
 * Accepts: numbers (decimal, hex/octal/binary, exponent, `NaN`, `Infinity`, signs), BigInt
 * (`12n`), strings in `'`, `"` or `` ` `` (no `${}`), `true`/`false`/`null`/`undefined`, arrays,
 * objects (identifier/string/number keys, optional class-name prefix as printed by the
 * console: `Point { x: 1 }`), and the console forms `Map(n) { k => v }` / `Set(n) { v }`.
 * Trailing commas are allowed; holes and expressions are not.
 */

export const LITERAL_MAX_LENGTH = 20_000;
const MAX_DEPTH = 32;
const MAX_ITEMS = 10_000;

class LiteralSyntaxError extends Error {}

/** Parses `text` as one literal. Returns null when it is not a (supported) literal. */
export function parseLiteral(text: string): SerializedValue | null {
  if (text.length > LITERAL_MAX_LENGTH) return null;
  const parser = new Parser(text);
  try {
    parser.skipSpace();
    const value = parser.value(0);
    parser.skipSpace();
    if (!parser.atEnd()) return null;
    return value;
  } catch (error) {
    if (error instanceof LiteralSyntaxError) return null;
    throw error;
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const NUMBER =
  /^(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(n?)/;

class Parser {
  private pos = 0;
  private items = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src.charAt(this.pos))) this.pos++;
  }

  value(depth: number): SerializedValue {
    if (depth > MAX_DEPTH) throw new LiteralSyntaxError('too deep');
    if (++this.items > MAX_ITEMS) throw new LiteralSyntaxError('too many items');
    const ch = this.src.charAt(this.pos);
    if (ch === '"' || ch === "'" || ch === '`') return { t: 'string', v: this.string(ch) };
    if (ch === '[') return this.array(depth);
    if (ch === '{') return this.object(depth, 'Object');
    if (ch === '-' || ch === '+' || ch === '.' || /\d/.test(ch)) return this.number();
    if (IDENT_START.test(ch)) return this.word(depth);
    throw new LiteralSyntaxError(`unexpected ${ch}`);
  }

  private expect(ch: string): void {
    this.skipSpace();
    if (this.src.charAt(this.pos) !== ch) throw new LiteralSyntaxError(`expected ${ch}`);
    this.pos++;
  }

  private peekAfterSpace(): string {
    this.skipSpace();
    return this.src.charAt(this.pos);
  }

  private identifier(): string {
    const start = this.pos;
    if (!IDENT_START.test(this.src.charAt(this.pos))) throw new LiteralSyntaxError('identifier');
    this.pos++;
    while (this.pos < this.src.length && IDENT_PART.test(this.src.charAt(this.pos))) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private word(depth: number): SerializedValue {
    const word = this.identifier();
    switch (word) {
      case 'true':
      case 'false':
        return { t: 'boolean', v: word === 'true' };
      case 'null':
        return { t: 'null' };
      case 'undefined':
        return { t: 'undefined' };
      case 'NaN':
        return { t: 'number', v: 'NaN' };
      case 'Infinity':
        return { t: 'number', v: 'Infinity' };
    }
    if (word === 'Map' || word === 'Set') {
      // Console form: Map(2) { ... } / Set(2) { ... }. The size in parentheses is optional.
      if (this.peekAfterSpace() === '(') {
        this.pos++;
        this.skipSpace();
        while (/\d/.test(this.src.charAt(this.pos))) this.pos++;
        this.expect(')');
      }
      if (this.peekAfterSpace() !== '{') throw new LiteralSyntaxError('expected {');
      return word === 'Map' ? this.map(depth) : this.set(depth);
    }
    if (this.peekAfterSpace() === '{') return this.object(depth, word);
    throw new LiteralSyntaxError(`identifier ${word} is not a literal`);
  }

  private number(): SerializedValue {
    let sign = 1;
    const first = this.src.charAt(this.pos);
    if (first === '-' || first === '+') {
      if (first === '-') sign = -1;
      this.pos++;
      this.skipSpace();
    }
    if (this.src.startsWith('Infinity', this.pos)) {
      this.pos += 'Infinity'.length;
      return { t: 'number', v: sign < 0 ? '-Infinity' : 'Infinity' };
    }
    const match = NUMBER.exec(this.src.slice(this.pos, this.pos + 400));
    if (!match) throw new LiteralSyntaxError('number');
    const [raw = '', bigintSuffix] = match;
    this.pos += raw.length;
    const body = bigintSuffix ? raw.slice(0, -1) : raw;
    if (bigintSuffix) {
      if (/[.eE]/.test(body) && !/^0[xX]/.test(body)) throw new LiteralSyntaxError('bigint');
      const big = BigInt(body) * BigInt(sign);
      return { t: 'bigint', v: big.toString() };
    }
    const value = Number(body) * sign;
    if (Number.isNaN(value)) throw new LiteralSyntaxError('number');
    return numberValue(value);
  }

  private string(quote: string): string {
    this.pos++;
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos++);
      if (ch === quote) return out;
      if (quote === '`' && ch === '$' && this.src.charAt(this.pos) === '{') {
        throw new LiteralSyntaxError('template substitution');
      }
      if (ch === '\\') {
        out += this.escape();
        continue;
      }
      if ((ch === '\n' || ch === '\r') && quote !== '`') throw new LiteralSyntaxError('newline');
      out += ch;
    }
    throw new LiteralSyntaxError('unterminated string');
  }

  private escape(): string {
    const ch = this.src.charAt(this.pos++);
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '0':
        return '\0';
      case '\n':
        return '';
      case 'x':
        return this.hexCode(2);
      case 'u':
        if (this.src.charAt(this.pos) === '{') {
          const end = this.src.indexOf('}', this.pos);
          if (end < 0 || end - this.pos > 7) throw new LiteralSyntaxError('escape');
          const code = parseInt(this.src.slice(this.pos + 1, end), 16);
          this.pos = end + 1;
          if (!Number.isInteger(code) || code > 0x10ffff) throw new LiteralSyntaxError('escape');
          return String.fromCodePoint(code);
        }
        return this.hexCode(4);
      case '':
        throw new LiteralSyntaxError('escape at end');
      default:
        return ch;
    }
  }

  private hexCode(length: number): string {
    const hex = this.src.slice(this.pos, this.pos + length);
    if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) throw new LiteralSyntaxError('escape');
    this.pos += length;
    return String.fromCharCode(parseInt(hex, 16));
  }

  /** Parses `[a, b, ...]` or `{ ... }` style lists, calling `item` per element. */
  private list(open: string, close: string, item: () => void): void {
    this.expect(open);
    if (this.peekAfterSpace() === close) {
      this.pos++;
      return;
    }
    for (;;) {
      this.skipSpace();
      item();
      const next = this.peekAfterSpace();
      if (next === ',') {
        this.pos++;
        if (this.peekAfterSpace() === close) {
          this.pos++;
          return;
        }
        continue;
      }
      if (next === close) {
        this.pos++;
        return;
      }
      throw new LiteralSyntaxError(`expected , or ${close}`);
    }
  }

  private array(depth: number): SerializedValue {
    const items: SerializedValue[] = [];
    this.list('[', ']', () => {
      if (this.src.charAt(this.pos) === ',') throw new LiteralSyntaxError('holes');
      items.push(this.value(depth + 1));
    });
    return { t: 'array', items, length: items.length };
  }

  private object(depth: number, className: string): SerializedValue {
    const entries: [string, SerializedValue][] = [];
    this.list('{', '}', () => {
      const key = this.key();
      this.expect(':');
      this.skipSpace();
      entries.push([key, this.value(depth + 1)]);
    });
    return { t: 'object', className, entries };
  }

  private key(): string {
    const ch = this.src.charAt(this.pos);
    if (ch === '"' || ch === "'") return this.string(ch);
    if (/\d/.test(ch)) {
      const value = this.number();
      if (value.t !== 'number') throw new LiteralSyntaxError('key');
      return String(value.v);
    }
    return this.identifier();
  }

  private map(depth: number): SerializedValue {
    const entries: [SerializedValue, SerializedValue][] = [];
    this.list('{', '}', () => {
      const key = this.value(depth + 1);
      this.expect('=');
      if (this.src.charAt(this.pos) !== '>') throw new LiteralSyntaxError('expected =>');
      this.pos++;
      this.skipSpace();
      entries.push([key, this.value(depth + 1)]);
    });
    return { t: 'map', entries, size: entries.length };
  }

  private set(depth: number): SerializedValue {
    const items: SerializedValue[] = [];
    this.list('{', '}', () => {
      items.push(this.value(depth + 1));
    });
    return { t: 'set', items, size: items.length };
  }
}

/** Number → SerializedValue, keeping NaN/±Infinity/-0 as tags. */
export function numberValue(value: number): SerializedValue {
  if (Number.isNaN(value)) return { t: 'number', v: 'NaN' };
  if (value === Infinity) return { t: 'number', v: 'Infinity' };
  if (value === -Infinity) return { t: 'number', v: '-Infinity' };
  if (Object.is(value, -0)) return { t: 'number', v: '-0' };
  return { t: 'number', v: value };
}
