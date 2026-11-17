/**
 * Logo "말풍선 열기구" (D-079): a hot-air balloon whose envelope is a typing speech bubble, plus the
 * `proginone` wordmark with the i's dot drawn as a bright-green cursor block. Colors follow the theme
 * through the `.app-logo*` rules in shell.css (tile and basket change in dark mode).
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" className="app-logo">
      <rect width="120" height="120" rx="32" className="app-logo__tile" />
      <path
        d="M60 12c22 0 36 15 36 33 0 17-14 29-29 31l-7 9-7-9C38 74 24 62 24 45c0-18 14-33 36-33z"
        fill="#00c471"
      />
      <path
        d="M44 30c4-6 10-9 16-9"
        fill="none"
        stroke="#7fe3b4"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="46" cy="46" r="5" fill="#062e1f" />
      <circle cx="60" cy="46" r="5" fill="#062e1f" />
      <circle cx="74" cy="46" r="5" fill="#062e1f" />
      <path
        d="M50 80l3 15M70 80l-3 15"
        strokeWidth="3"
        strokeLinecap="round"
        className="app-logo__lines"
      />
      <rect x="49" y="94" width="22" height="13" rx="3.5" className="app-logo__basket" />
      <rect x="49" y="98" width="22" height="2.5" fill="#00c471" />
    </svg>
  );
}

/**
 * Mark + wordmark. The visible text is decorative; the image is named `label` ("ProgInOne").
 * Inside a link, name the link through `label` rather than the link's own aria-label: the visible
 * "progınone" (dotless ı) is not in any label, so an aria-label there fails label-in-name (WCAG 2.5.3).
 */
export function Logo({ size = 28, label = 'ProgInOne' }: { size?: number; label?: string }) {
  return (
    <span role="img" aria-label={label} className="app-logo-lockup">
      <LogoMark size={size} />
      <span className="app-logo-wordmark" aria-hidden="true">
        prog
        <span className="app-logo-wordmark__i">
          ı<i />
        </span>
        none
      </span>
    </span>
  );
}
