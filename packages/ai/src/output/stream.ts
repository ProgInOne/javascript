import type { OutputGuard } from './validate.ts';

const META_OPEN = '<meta>';

/** Length of the longest suffix of `text` that is a proper prefix of `marker` (case-insensitive). */
function partialMarkerSuffix(text: string, marker: string): number {
  const lower = text.slice(-marker.length).toLowerCase();
  for (let n = Math.min(marker.length - 1, lower.length); n > 0; n--) {
    if (marker.startsWith(lower.slice(lower.length - n))) return n;
  }
  return 0;
}

/** Index of the `<meta>` block in `text`, or -1. */
export function metaStart(text: string): number {
  return text.toLowerCase().indexOf(META_OPEN);
}

export interface StreamGateOptions {
  /** Hide the trailing `<meta>…</meta>` block (tutor.reply). */
  stripMeta: boolean;
  guard: OutputGuard | undefined;
  emit: (text: string) => void;
  /** Called once when the guard finds a violation; nothing more is emitted afterwards. */
  onViolation: (violations: string[]) => void;
}

/**
 * Sits between provider deltas and the learner's screen (docs/design/ai-system.md#sse-이벤트-형식):
 * filters the `<meta>` block out of the visible text and holds back the tail the output guard
 * still needs, so leaked answer text is caught before it is shown.
 */
export class StreamGate {
  readonly #opts: StreamGateOptions;
  #raw = '';
  #emitted = 0;
  #violated = false;

  constructor(opts: StreamGateOptions) {
    this.#opts = opts;
  }

  get violated(): boolean {
    return this.#violated;
  }

  /** Text forwarded to the screen so far. */
  get emittedText(): string {
    return this.#raw.slice(0, this.#emitted);
  }

  push(delta: string): void {
    if (this.#violated || delta === '') return;
    this.#raw += delta;
    this.#advance(false);
  }

  /** Final visible text (meta removed) once the turn is complete. */
  visibleText(): string {
    return this.#raw.slice(0, this.#visibleEnd(true)).trimEnd();
  }

  /**
   * Turn complete: re-checks the whole visible text and emits the held-back tail.
   * Returns false when the guard found a violation.
   */
  finish(): boolean {
    if (this.#violated) return false;
    this.#advance(true);
    return !this.#violated;
  }

  #visibleEnd(final: boolean): number {
    if (!this.#opts.stripMeta) return this.#raw.length;
    const at = metaStart(this.#raw);
    if (at >= 0) return at;
    return final ? this.#raw.length : this.#raw.length - partialMarkerSuffix(this.#raw, META_OPEN);
  }

  #advance(final: boolean): void {
    const end = this.#visibleEnd(final);
    const visible = this.#raw.slice(0, end);
    const guard = this.#opts.guard;
    if (guard) {
      const violations = guard.findViolations(visible);
      if (violations.length > 0) {
        this.#violated = true;
        this.#opts.onViolation(violations);
        return;
      }
    }
    const safeEnd = guard && !final ? Math.max(this.#emitted, end - guard.holdback) : end;
    const text = final
      ? this.#raw.slice(this.#emitted, end).trimEnd()
      : this.#raw.slice(this.#emitted, safeEnd);
    if (text.length > 0) {
      this.#opts.emit(text);
    }
    this.#emitted = final ? this.#emitted + text.length : safeEnd;
  }
}
