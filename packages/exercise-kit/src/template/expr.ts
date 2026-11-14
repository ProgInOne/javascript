import { ExerciseKitError } from '../core/errors.ts';

/**
 * Template expression language (docs/design/content-and-exercises.md#결정론적-생성):
 * arithmetic, comparison, logic, ternary, string concatenation, parameter references, member
 * access and a small whitelist of pure functions. No `eval`, no prototype access, no I/O.
 *
 * Grammar (lowest to highest precedence):
 *   ternary := or ('?' ternary ':' ternary)?
 *   or      := and ('||' and)*
 *   and     := eq ('&&' eq)*
 *   eq      := rel (('===' | '!==') rel)*
 *   rel     := add (('<' | '<=' | '>' | '>=') add)*
 *   add     := mul (('+' | '-') mul)*
 *   mul     := unary (('*' | '/' | '%') unary)*
 *   unary   := ('!' | '-' | '+') unary | postfix
 *   postfix := primary ('.' ident | '[' ternary ']' | '(' args ')')*
 *   primary := number | string | true | false | null | ident | '(' ternary ')' | '[' list ']'
 */

export type TemplateValue =
  number | string | boolean | null | TemplateValue[] | { [key: string]: TemplateValue };

export type Scope = ReadonlyMap<string, TemplateValue>;

export const EXPRESSION_MAX_LENGTH = 500;
const MAX_DEPTH = 40;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type Node =
  | { type: 'lit'; value: TemplateValue }
  | { type: 'ref'; name: string }
  | { type: 'array'; items: Node[] }
  | { type: 'unary'; op: string; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'ternary'; test: Node; then: Node; else: Node }
  | { type: 'member'; object: Node; key: Node }
  | { type: 'call'; name: string; args: Node[] };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: string };

function fail(message: string): never {
  throw new ExerciseKitError('TEMPLATE_EXPRESSION', message);
}

const OPERATORS = [
  '===',
  '!==',
  '<=',
  '>=',
  '&&',
  '||',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '?',
  ':',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
];

function tokenize(src: string): Token[] {
  if (src.length > EXPRESSION_MAX_LENGTH) fail('expression is too long');
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && /[\d.]/.test(ch)) {
      tokens.push({ kind: 'num', value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let out = '';
      i++;
      for (;;) {
        if (i >= src.length) fail('unterminated string');
        const c = src.charAt(i++);
        if (c === ch) break;
        if (c === '\\') {
          const e = src.charAt(i++);
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else out += c;
      }
      tokens.push({ kind: 'str', value: out });
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (id) {
      tokens.push({ kind: 'id', value: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) fail(`unexpected character ${ch}`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private depth = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.ternary();
    if (this.pos < this.tokens.length) fail('unexpected trailing input');
    return node;
  }

  private peekOp(...ops: string[]): string | undefined {
    const t = this.tokens[this.pos];
    return t?.kind === 'op' && ops.includes(t.value) ? t.value : undefined;
  }

  private expectOp(op: string): void {
    if (this.peekOp(op) === undefined) fail(`expected ${op}`);
    this.pos++;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) fail('expression nests too deeply');
  }

  private ternary(): Node {
    this.enter();
    const test = this.binary(0);
    let node = test;
    if (this.peekOp('?')) {
      this.pos++;
      const then = this.ternary();
      this.expectOp(':');
      node = { type: 'ternary', test, then, else: this.ternary() };
    }
    this.depth--;
    return node;
  }

  private static readonly LEVELS = [
    ['||'],
    ['&&'],
    ['===', '!=='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private binary(level: number): Node {
    const ops = Parser.LEVELS[level];
    if (!ops) return this.unary();
    let left = this.binary(level + 1);
    for (let op = this.peekOp(...ops); op !== undefined; op = this.peekOp(...ops)) {
      this.pos++;
      left = { type: 'binary', op, left, right: this.binary(level + 1) };
    }
    return left;
  }

  private unary(): Node {
    const op = this.peekOp('!', '-', '+');
    if (op !== undefined) {
      this.pos++;
      this.enter();
      const node: Node = { type: 'unary', op, arg: this.unary() };
      this.depth--;
      return node;
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      if (this.peekOp('.')) {
        this.pos++;
        const t = this.tokens[this.pos++];
        if (t?.kind !== 'id') fail('expected property name');
        node = { type: 'member', object: node, key: { type: 'lit', value: t.value } };
      } else if (this.peekOp('[')) {
        this.pos++;
        node = { type: 'member', object: node, key: this.ternary() };
        this.expectOp(']');
      } else if (this.peekOp('(')) {
        if (node.type !== 'ref') fail('only built-in functions can be called');
        this.pos++;
        const args = this.list(')');
        node = { type: 'call', name: node.name, args };
      } else return node;
    }
  }

  private list(close: string): Node[] {
    const items: Node[] = [];
    if (this.peekOp(close)) {
      this.pos++;
      return items;
    }
    for (;;) {
      items.push(this.ternary());
      if (this.peekOp(',')) {
        this.pos++;
        continue;
      }
      this.expectOp(close);
      return items;
    }
  }

  private primary(): Node {
    const t = this.tokens[this.pos++];
    if (!t) fail('unexpected end of expression');
    if (t.kind === 'num' || t.kind === 'str') return { type: 'lit', value: t.value };
    if (t.kind === 'id') {
      if (t.value === 'true' || t.value === 'false')
        return { type: 'lit', value: t.value === 'true' };
      if (t.value === 'null') return { type: 'lit', value: null };
      return { type: 'ref', name: t.value };
    }
    if (t.value === '(') {
      const node = this.ternary();
      this.expectOp(')');
      return node;
    }
    if (t.value === '[') return { type: 'array', items: this.list(']') };
    fail(`unexpected ${t.value}`);
  }
}

const CACHE = new Map<string, Node>();

/** Parses an expression (cached). Throws `TEMPLATE_EXPRESSION` on syntax errors. */
export function parseExpression(src: string): Node {
  const cached = CACHE.get(src);
  if (cached) return cached;
  const node = new Parser(tokenize(src)).parse();
  if (CACHE.size > 1_000) CACHE.clear();
  CACHE.set(src, node);
  return node;
}

/** Evaluates an expression against parameter values. */
export function evaluate(src: string, scope: Scope): TemplateValue {
  return evalNode(parseExpression(src), scope);
}

/** Identifiers referenced by an expression (for derived-parameter ordering). */
export function referencedNames(src: string): Set<string> {
  const names = new Set<string>();
  const walk = (node: Node): void => {
    switch (node.type) {
      case 'ref':
        names.add(node.name);
        return;
      case 'array':
        node.items.forEach(walk);
        return;
      case 'unary':
        walk(node.arg);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'ternary':
        walk(node.test);
        walk(node.then);
        walk(node.else);
        return;
      case 'member':
        walk(node.object);
        walk(node.key);
        return;
      case 'call':
        node.args.forEach(walk);
        return;
      case 'lit':
        return;
    }
  };
  walk(parseExpression(src));
  return names;
}

export function truthy(value: TemplateValue): boolean {
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) return true;
  return Boolean(value);
}

function num(value: TemplateValue, op: string): number {
  if (typeof value !== 'number') fail(`${op} needs numbers`);
  return value;
}

function equal(a: TemplateValue, b: TemplateValue): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  return toLiteral(a) === toLiteral(b);
}

function evalNode(node: Node, scope: Scope): TemplateValue {
  switch (node.type) {
    case 'lit':
      return node.value;
    case 'ref': {
      const value = scope.get(node.name);
      if (value === undefined) fail(`unknown parameter ${node.name}`);
      return value;
    }
    case 'array':
      return node.items.map((item) => evalNode(item, scope));
    case 'unary': {
      const v = evalNode(node.arg, scope);
      if (node.op === '!') return !truthy(v);
      return node.op === '-' ? -num(v, '-') : num(v, '+');
    }
    case 'ternary':
      return truthy(evalNode(node.test, scope))
        ? evalNode(node.then, scope)
        : evalNode(node.else, scope);
    case 'binary':
      return evalBinary(node.op, node.left, node.right, scope);
    case 'member':
      return member(evalNode(node.object, scope), evalNode(node.key, scope));
    case 'call': {
      const fn = Object.hasOwn(FUNCTIONS, node.name) ? FUNCTIONS[node.name] : undefined;
      if (!fn) fail(`unknown function ${node.name}`);
      return fn(node.args.map((a) => evalNode(a, scope)));
    }
  }
}

function evalBinary(op: string, l: Node, r: Node, scope: Scope): TemplateValue {
  if (op === '&&') {
    const left = evalNode(l, scope);
    return truthy(left) ? evalNode(r, scope) : left;
  }
  if (op === '||') {
    const left = evalNode(l, scope);
    return truthy(left) ? left : evalNode(r, scope);
  }
  const a = evalNode(l, scope);
  const b = evalNode(r, scope);
  switch (op) {
    case '+':
      if (typeof a === 'string' || typeof b === 'string') {
        if (!isScalar(a) || !isScalar(b)) fail('+ concatenates numbers, strings and booleans only');
        return toText(a) + toText(b);
      }
      return num(a, '+') + num(b, '+');
    case '-':
      return num(a, '-') - num(b, '-');
    case '*':
      return num(a, '*') * num(b, '*');
    case '/':
      return num(a, '/') / num(b, '/');
    case '%':
      return num(a, '%') % num(b, '%');
    case '===':
      return equal(a, b);
    case '!==':
      return !equal(a, b);
    default: {
      if (!(
        (typeof a === 'number' && typeof b === 'number') ||
        (typeof a === 'string' && typeof b === 'string')
      )) {
        fail(`${op} compares two numbers or two strings`);
      }
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      if (op === '>') return a > b;
      return a >= b;
    }
  }
}

function isScalar(v: TemplateValue): v is string | number | boolean | null {
  return v === null || typeof v !== 'object';
}

function member(object: TemplateValue, key: TemplateValue): TemplateValue {
  if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) fail(`property ${key} is not allowed`);
  if (typeof object === 'string' || Array.isArray(object)) {
    if (key === 'length') return object.length;
    if (typeof key !== 'number' || !Number.isInteger(key)) fail('index must be an integer');
    const item = object[key < 0 ? object.length + key : key];
    if (item === undefined) fail('index out of range');
    return item;
  }
  if (object !== null && typeof object === 'object' && typeof key === 'string') {
    if (!Object.hasOwn(object, key)) fail(`no property ${key}`);
    return object[key] ?? null;
  }
  return fail('member access needs a string, array or object');
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** JavaScript literal for a value: strings in double quotes, `[1, 2]`, `{ a: 1 }`. */
export function toLiteral(value: TemplateValue): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(toLiteral).join(', ')}]`;
  const entries = Object.entries(value).map(
    ([k, v]) => `${IDENTIFIER.test(k) ? k : JSON.stringify(k)}: ${toLiteral(v)}`,
  );
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

/** Text inserted by `{{ }}`: strings raw, scalars via String, collections as literals. */
export function toText(value: TemplateValue): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return toLiteral(value);
}

function arr(value: TemplateValue | undefined, fn: string): TemplateValue[] {
  if (!Array.isArray(value)) fail(`${fn} needs an array`);
  return value;
}

function arity(args: TemplateValue[], min: number, max: number, fn: string): void {
  if (args.length < min || args.length > max)
    fail(`${fn} takes ${min === max ? min : `${min}-${max}`} arguments`);
}

const FUNCTIONS: Record<string, (args: TemplateValue[]) => TemplateValue> = {
  len: (args) => {
    arity(args, 1, 1, 'len');
    const [v] = args;
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    return fail('len needs a string or array');
  },
  join: (args) => {
    arity(args, 1, 2, 'join');
    const sep = args[1] ?? ', ';
    if (typeof sep !== 'string') fail('join separator must be a string');
    return arr(args[0], 'join').map(toText).join(sep);
  },
  lit: (args) => {
    arity(args, 1, 1, 'lit');
    return toLiteral(args[0] ?? null);
  },
  str: (args) => {
    arity(args, 1, 1, 'str');
    return toText(args[0] ?? null);
  },
  abs: (args) => (arity(args, 1, 1, 'abs'), Math.abs(num(args[0] ?? null, 'abs'))),
  floor: (args) => (arity(args, 1, 1, 'floor'), Math.floor(num(args[0] ?? null, 'floor'))),
  ceil: (args) => (arity(args, 1, 1, 'ceil'), Math.ceil(num(args[0] ?? null, 'ceil'))),
  round: (args) => {
    arity(args, 1, 2, 'round');
    const digits = args[1] === undefined ? 0 : num(args[1], 'round');
    if (!Number.isInteger(digits) || digits < 0 || digits > 10) fail('round digits must be 0..10');
    const factor = 10 ** digits;
    return Math.round(num(args[0] ?? null, 'round') * factor) / factor;
  },
  min: (args) => {
    if (args.length === 0) fail('min needs arguments');
    return Math.min(...args.map((a) => num(a, 'min')));
  },
  max: (args) => {
    if (args.length === 0) fail('max needs arguments');
    return Math.max(...args.map((a) => num(a, 'max')));
  },
  sum: (args) => (
    arity(args, 1, 1, 'sum'),
    arr(args[0], 'sum').reduce<number>((s, v) => s + num(v, 'sum'), 0)
  ),
  upper: (args) => {
    arity(args, 1, 1, 'upper');
    const [v] = args;
    return typeof v === 'string' ? v.toUpperCase() : fail('upper needs a string');
  },
  lower: (args) => {
    arity(args, 1, 1, 'lower');
    const [v] = args;
    return typeof v === 'string' ? v.toLowerCase() : fail('lower needs a string');
  },
  includes: (args) => {
    arity(args, 2, 2, 'includes');
    const needle = args[1] ?? null;
    return arr(args[0], 'includes').some((v) => equal(v, needle));
  },
  reverse: (args) => (arity(args, 1, 1, 'reverse'), [...arr(args[0], 'reverse')].reverse()),
  sorted: (args) => {
    arity(args, 1, 1, 'sorted');
    const items = arr(args[0], 'sorted');
    if (items.every((v) => typeof v === 'number')) return [...items].sort((x, y) => x - y);
    if (items.every((v) => typeof v === 'string')) {
      return [...items].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    }
    return fail('sorted needs numbers or strings');
  },
};

export const TEMPLATE_FUNCTIONS = Object.keys(FUNCTIONS);
