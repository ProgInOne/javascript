/** zod-free constants, so the harness bundle does not pull in zod. */

/** Bumped on incompatible message changes. The host reloads a shell that reports another version. */
export const PROTOCOL_VERSION = 1;

/** The harness reads its configuration from this global and deletes it before learner code runs. */
export const HARNESS_CONFIG_GLOBAL = '__PG_CFG';

/** Longest preview tab title the runner passes on (D-082). Longer titles are cut. */
export const PREVIEW_TITLE_MAX_LENGTH = 200;

/**
 * Turns what a preview document reported as its title into the text the host may show (D-082).
 * Learner code can post anything, so only strings pass; control characters become spaces,
 * whitespace runs collapse (as `document.title` does), and the result is cut to
 * {@link PREVIEW_TITLE_MAX_LENGTH} characters. Returns `null` for anything that is not a string.
 */
export function normalizePreviewTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- control characters are what this removes
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();
  if (text.length <= PREVIEW_TITLE_MAX_LENGTH) return text;
  // The limit counts UTF-16 code units (as the schema does); never split a surrogate pair.
  let cut = text.slice(0, PREVIEW_TITLE_MAX_LENGTH);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}
