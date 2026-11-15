import type mermaidApi from 'mermaid';
import type { MermaidConfig } from 'mermaid';

/**
 * Lesson `<Diagram>` rendering (D-050): Mermaid runs in the browser, loaded on first use so it is
 * not part of the main bundle. Content is treated as untrusted even though it is authored:
 * `securityLevel: 'strict'` (labels encoded, no click callbacks), SVG text labels only (no HTML
 * labels / foreignObject), configuration keys that content could otherwise change through
 * directives are locked, and the SVG is sanitized again with DOMPurify before it is attached.
 * content-cli rejects directives and interactions at build time and checks the syntax.
 */

type Mermaid = typeof mermaidApi;

let mermaidLoader: Promise<Mermaid> | null = null;
const loadMermaid = () =>
  (mermaidLoader ??= import('mermaid').then((m) => m.default)).catch((error: unknown) => {
    mermaidLoader = null; // let a later diagram retry a failed chunk load
    throw error;
  });

/** Keys a `%%{init}%%` directive or front matter must not change (Mermaid strips them). */
const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'htmlLabels',
  'flowchart',
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'fontFamily',
  'altFontFamily',
  'look',
];

export const LOCKED_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  secure: SECURE_KEYS,
} satisfies MermaidConfig;

export interface DiagramTheme {
  dark: boolean;
  fontFamily: string;
  /** Mermaid `base` theme variables as sRGB colors (Mermaid cannot read oklch or var()). */
  variables: Record<string, string>;
}

let canvasContext: CanvasRenderingContext2D | null | undefined;

/** Any CSS color the browser understands (oklch, light-dark results) → `rgb(r, g, b)`. */
function toRgb(color: string): string | null {
  if (/^(#|rgba?\()/i.test(color)) return color;
  if (canvasContext === undefined) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      canvasContext = canvas.getContext('2d', { willReadFrequently: true });
    } catch {
      canvasContext = null;
    }
  }
  const ctx = canvasContext;
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

const luminance = (rgb: string) => {
  const [r = 255, g = 255, b = 255] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Mermaid theme variable → design token (ui-ux.md 디자인 토큰). */
const TOKEN_MAP: Record<string, string> = {
  background: '--color-bg-surface',
  primaryColor: '--color-bg-selected',
  primaryBorderColor: '--color-action-primary',
  primaryTextColor: '--color-text-primary',
  secondaryColor: '--color-info-bg',
  secondaryBorderColor: '--color-info-border',
  secondaryTextColor: '--color-text-primary',
  tertiaryColor: '--color-bg-subtle',
  tertiaryBorderColor: '--color-border-strong',
  tertiaryTextColor: '--color-text-primary',
  mainBkg: '--color-bg-selected',
  nodeBorder: '--color-action-primary',
  nodeTextColor: '--color-text-primary',
  textColor: '--color-text-primary',
  titleColor: '--color-text-heading',
  lineColor: '--color-text-secondary',
  clusterBkg: '--color-bg-subtle',
  clusterBorder: '--color-border-strong',
  edgeLabelBackground: '--color-bg-surface',
  noteBkgColor: '--color-warning-bg',
  noteBorderColor: '--color-warning-border',
  noteTextColor: '--color-text-primary',
  actorBkg: '--color-bg-selected',
  actorBorder: '--color-action-primary',
  actorTextColor: '--color-text-primary',
  actorLineColor: '--color-border-strong',
  signalColor: '--color-text-secondary',
  signalTextColor: '--color-text-primary',
  labelBoxBkgColor: '--color-bg-subtle',
  labelBoxBorderColor: '--color-border-strong',
  labelTextColor: '--color-text-primary',
  loopTextColor: '--color-text-primary',
  activationBkgColor: '--color-bg-muted',
  activationBorderColor: '--color-border-strong',
  sequenceNumberColor: '--color-text-on-action',
  labelColor: '--color-text-primary',
  stateLabelColor: '--color-text-primary',
  altBackground: '--color-bg-subtle',
  compositeBackground: '--color-bg-surface',
  compositeTitleBackground: '--color-bg-subtle',
  specialStateColor: '--color-text-secondary',
  errorBkgColor: '--color-feedback-incorrect-bg',
  errorTextColor: '--color-feedback-incorrect-fg',
};

/**
 * Reads the design tokens as they resolve at `el` (so the light/dark theme and a `.workbench`
 * remap both apply) and turns them into Mermaid theme variables.
 */
export function readDiagramTheme(el: HTMLElement): DiagramTheme {
  const probe = document.createElement('span');
  probe.hidden = true;
  el.appendChild(probe);
  const variables: Record<string, string> = {};
  try {
    for (const [name, token] of Object.entries(TOKEN_MAP)) {
      probe.style.color = `var(${token})`;
      const rgb = toRgb(getComputedStyle(probe).color);
      if (rgb) variables[name] = rgb;
    }
  } finally {
    probe.remove();
  }
  const fontFamily = getComputedStyle(el).fontFamily;
  const background = variables['background'];
  return {
    dark: background !== undefined && luminance(background) < 0.5,
    fontFamily,
    variables: { ...variables, fontFamily },
  };
}

let renderCount = 0;

/**
 * Renders Mermaid source to a sanitized `<svg>` element. Throws when the source does not parse
 * or Mermaid cannot be loaded; the caller shows the source instead.
 */
export async function renderDiagram(source: string, theme: DiagramTheme): Promise<SVGSVGElement> {
  const [mermaid, { default: DOMPurify }] = await Promise.all([loadMermaid(), import('dompurify')]);
  mermaid.initialize({
    ...LOCKED_CONFIG,
    theme: 'base',
    darkMode: theme.dark,
    fontFamily: theme.fontFamily,
    themeVariables: theme.variables,
  });
  const id = `pi-diagram-${++renderCount}`;
  let svg: string;
  try {
    ({ svg } = await mermaid.render(id, source));
  } finally {
    // Mermaid measures in a temporary element; make sure none is left behind on failure.
    document.getElementById(`d${id}`)?.remove();
  }
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });
  const element = fragment.firstElementChild;
  if (!(element instanceof SVGSVGElement)) throw new Error('Mermaid did not return an <svg>');
  return element;
}
