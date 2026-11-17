/**
 * Step view of a lesson (D-077): the standard `<Section kind>`s are shown as five steps on screen.
 * The content files stay as they are; this only groups the top-level nodes of the lesson tree.
 */

export type StepKey = 'why' | 'principle' | 'try' | 'caution' | 'check';

export interface StepDef {
  key: StepKey;
  /** Chip text (ui-ux.md 학습 화면: 읽기 모드). */
  label: string;
  kinds: readonly string[];
}

export const STEP_DEFS: readonly StepDef[] = [
  { key: 'why', label: '왜 배울까', kinds: ['objectives', 'prerequisites', 'intro'] },
  { key: 'principle', label: '원리', kinds: ['principle'] },
  { key: 'try', label: '직접 해 보기', kinds: ['examples', 'walkthrough'] },
  { key: 'caution', label: '주의', kinds: ['pitfalls', 'in-practice'] },
  { key: 'check', label: '확인', kinds: ['check', 'practice', 'summary', 'next'] },
];

const STEP_OF_KIND = new Map(
  STEP_DEFS.flatMap((def, i) => def.kinds.map((kind) => [kind, i] as const)),
);

export interface LessonStep {
  key: StepKey;
  label: string;
  /** DOM id of the step card: `step-<key>`. */
  id: string;
  /** IDs of the sections in this step, in reading order. */
  sectionIds: string[];
  /** Top-level nodes of the lesson tree that belong to this step. */
  nodes: unknown[];
}

type Node = Record<string, unknown>;

function sectionOf(node: unknown): { kind: string; id: string } | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Node;
  if (n['type'] !== 'component' || n['name'] !== 'Section') return null;
  const props = (n['props'] && typeof n['props'] === 'object' ? n['props'] : {}) as Node;
  const kind = typeof props['kind'] === 'string' ? props['kind'] : '';
  const id = typeof props['id'] === 'string' ? props['id'] : kind;
  return { kind, id };
}

/**
 * Groups the top-level nodes into steps without ever reordering the content: a section whose
 * step comes before the current one (an unusual order in the MDX) stays in the current step, and
 * nodes that are not standard sections join the step they follow. Steps without any section are
 * left out, so "단계 n / 전체" counts only the steps the lesson has. Returns an empty list when the
 * body has no standard section (the reader then shows the plain flow).
 */
export function groupSteps(body: readonly unknown[]): LessonStep[] {
  const steps: LessonStep[] = [];
  let current = -1;
  for (const node of body) {
    const section = sectionOf(node);
    const index = section ? STEP_OF_KIND.get(section.kind) : undefined;
    if (index !== undefined && index > current) {
      current = index;
      const def = STEP_DEFS[index];
      if (def)
        steps.push({
          key: def.key,
          label: def.label,
          id: `step-${def.key}`,
          sectionIds: [],
          nodes: [],
        });
    }
    let step = steps.at(-1);
    if (!step) {
      // Content before the first standard section opens the first step.
      current = 0;
      const def = STEP_DEFS[0];
      if (!def) continue;
      step = { key: def.key, label: def.label, id: `step-${def.key}`, sectionIds: [], nodes: [] };
      steps.push(step);
    }
    step.nodes.push(node);
    if (section) step.sectionIds.push(section.id);
  }
  return steps.some((s) => s.sectionIds.length > 0) ? steps : [];
}

/** Index of the step that holds `sectionId`, or -1. */
export function stepIndexOf(steps: readonly LessonStep[], sectionId: string | null | undefined) {
  if (!sectionId) return -1;
  return steps.findIndex((s) => s.sectionIds.includes(sectionId));
}
