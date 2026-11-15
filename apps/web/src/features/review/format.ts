/** "11/12" in the browser's time zone (the learner's machine). */
export function dateLabel(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

/** First line of a Markdown prompt as plain text, cut to `max` characters. */
export function excerpt(markdown: string, max = 90): string {
  const line =
    markdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('```')) ?? '';
  const plain = line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*|^>\s*|^[-+]\s+/, '')
    .replace(/[`*_~]/g, '')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
