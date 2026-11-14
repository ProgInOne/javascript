/** Logo option 1, "맞물린 꺾쇠" (D-024): code brackets interlocking around the learner dot. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="app-logo">
      <rect width="32" height="32" rx="8" fill="var(--color-action-primary)" />
      <path
        d="M13.2 9.5 7.6 16l5.6 6.5M18.8 9.5 24.4 16l-5.6 6.5"
        fill="none"
        stroke="var(--color-text-on-action)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="var(--color-text-on-action)" />
    </svg>
  );
}
