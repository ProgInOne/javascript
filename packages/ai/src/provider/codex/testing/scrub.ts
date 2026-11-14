// Scrubbing of recorded Codex exchanges before they are committed
// (docs/design/ai-system.md#codex-프로토콜-계약-테스트). A recording comes from a real, logged-in
// tutor home, so it can carry the account email, local paths, login URLs with OAuth state, and
// identifiers. Everything that could identify the learner or the machine is replaced with stable
// placeholders; protocol shapes stay as recorded. `findLeaks` is the last check before writing.

export interface RawLine {
  dir: 'c2s' | 's2c';
  line: string;
}

export interface FixtureEntry {
  dir: 'c2s' | 's2c';
  msg: Record<string, unknown>;
}

export interface ScrubOptions {
  /**
   * Temporary data dir of the recording in every spelling Codex may report (as given and its
   * realpath): `<dataDir>/codex-home` and `<dataDir>/codex-workspace` become placeholders.
   */
  dataDirs: string[];
  /** Other absolute prefixes to hide (home directory, its realpath variants). */
  hidePaths: string[];
  /** Words to hide wherever they appear (user name, host name). */
  hideWords?: string[];
}

/** Fixed epoch seconds for scrubbed timestamps (2026-01-01T00:00:00Z). */
export const SCRUBBED_EPOCH = 1_767_225_600;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Provider-side item IDs (`msg_…`, `rs_…`): opaque but unique to the account's requests. */
const ITEM_ID = /\b(msg|rs|resp|fc|call)_[0-9a-f]{16,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g;
const TIME_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'lastUpdatedAt',
  'timestamp',
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Placeholders replacing absolute paths; the replay server substitutes the real ones back. */
export const PATH_TOKENS = {
  home: '$CODEX_HOME',
  workspace: '$WORKSPACE',
  dataDir: '$DATA_DIR',
  hidden: '$PRIVATE',
} as const;

export function scrubRecording(raw: readonly RawLine[], opts: ScrubOptions): FixtureEntry[] {
  const ids = new Map<string, string>();
  const idFor = (uuid: string) => {
    const key = uuid.toLowerCase();
    let out = ids.get(key);
    if (!out) {
      out = `00000000-0000-7000-8000-${String(ids.size + 1).padStart(12, '0')}`;
      ids.set(key, out);
    }
    return out;
  };
  const itemIds = new Map<string, string>();
  const itemIdFor = (prefix: string, id: string) => {
    let out = itemIds.get(id);
    if (!out) {
      out = `${prefix}_scrubbed${String(itemIds.size + 1).padStart(4, '0')}`;
      itemIds.set(id, out);
    }
    return out;
  };
  const resetTimes = new Map<number, number>();
  const resetFor = (value: number) => {
    let out = resetTimes.get(value);
    if (out === undefined) {
      out = SCRUBBED_EPOCH + (resetTimes.size + 1) * 3_600;
      resetTimes.set(value, out);
    }
    return out;
  };
  const prefixes = [
    ...opts.dataDirs.flatMap((d) => [
      [`${d}/codex-home`, PATH_TOKENS.home] as const,
      [`${d}/codex-workspace`, PATH_TOKENS.workspace] as const,
      [d, PATH_TOKENS.dataDir] as const,
    ]),
    ...opts.hidePaths.map((p) => [p, PATH_TOKENS.hidden] as const),
  ]
    .filter(([p]) => p.length > 1)
    .sort((a, b) => b[0].length - a[0].length);

  const scrubString = (key: string | null, value: string): string => {
    if (key === 'authUrl' || key === 'verificationUrl') {
      const url = value.split('?')[0] ?? value;
      return `${url}?scrubbed`;
    }
    if (key === 'userAgent') {
      // `<client>/<version> (<OS, arch, terminal>) …`: keep the product token only.
      return `${value.split(' ')[0] ?? 'codex'} (scrubbed)`;
    }
    if (key === 'email') return 'learner@example.invalid';
    if (key === 'serverName' || key === 'hostname') return 'localhost';
    let out = value;
    for (const [prefix, token] of prefixes)
      out = out.replace(new RegExp(escapeRe(prefix), 'g'), token);
    for (const word of opts.hideWords ?? []) {
      if (word.length >= 3) out = out.replace(new RegExp(escapeRe(word), 'gi'), PATH_TOKENS.hidden);
    }
    return out
      .replace(EMAIL, 'learner@example.invalid')
      .replace(JWT, '$TOKEN')
      .replace(UUID, (m) => idFor(m))
      .replace(ITEM_ID, (m: string, prefix: string) => itemIdFor(prefix, m));
  };

  const walk = (key: string | null, value: unknown, parent: string | null): unknown => {
    if (typeof value === 'string') return scrubString(key, value);
    if (typeof value === 'number') {
      if (key === 'resetsAt') return resetFor(value);
      if (key !== null && TIME_KEYS.has(key)) return SCRUBBED_EPOCH;
      if (key?.endsWith('AtMs')) return SCRUBBED_EPOCH * 1000;
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(null, v, key));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        // Credit balances are account data; the adapter does not read them.
        if (parent === 'credits' || k === 'balance') {
          out[k] = typeof v === 'string' ? '0' : v === null ? null : walk(k, v, key);
          continue;
        }
        out[k] = walk(k, v, key);
      }
      return out;
    }
    return value;
  };

  return raw.map(({ dir, line }) => {
    const msg = JSON.parse(line) as Record<string, unknown>;
    return { dir, msg: walk(null, msg, null) as Record<string, unknown> };
  });
}

/** Strings that must never appear in a committed fixture. Returns what was found. */
export function findLeaks(text: string, opts: { forbidden: string[] }): string[] {
  const leaks: string[] = [];
  const emails = (text.match(EMAIL) ?? []).filter((e) => e !== 'learner@example.invalid');
  if (emails.length > 0) leaks.push(`email(${emails.length})`);
  if (JWT.test(text)) leaks.push('jwt');
  JWT.lastIndex = 0;
  if (/\/Users\/|\/home\/|\/private\/var\/|\/var\/folders\//.test(text)) leaks.push('path');
  if (/"(access|refresh|id)_?[Tt]oken"\s*:\s*"[^"$]/.test(text)) leaks.push('token');
  for (const word of opts.forbidden) {
    if (word.length >= 3 && text.toLowerCase().includes(word.toLowerCase()))
      leaks.push(`"${word}"`);
  }
  return leaks;
}
