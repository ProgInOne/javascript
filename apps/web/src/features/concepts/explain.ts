import type { ConceptDetail, MasteryEvidenceView, MisconceptionStatus } from '@proginone/shared';
import { TYPE_LABELS } from '../practice/model.ts';
import { STAGE_NAMES } from '../mastery/MasteryIcon.tsx';

type Shortfall = NonNullable<ConceptDetail['nextStage']>['missing'][number];

const more = (s: Shortfall) => Math.max(1, Math.ceil(s.required - s.actual));

/**
 * A missing gate condition in the learner's words ("숙련까지: 다른 유형 1개 더 · L3 이상 정답 1개",
 * ui-ux.md 개념 상세 시트). Codes are the engine's `GateShortfall.gate`.
 */
export function shortfallText(s: Shortfall): string {
  switch (s.gate) {
    case 'evidence_weight_sum':
      return '문제를 조금 더 풀어 근거 쌓기';
    case 'effective':
      return `숙련도 ${String(Math.ceil(s.required))}점 이상(지금 ${String(Math.round(s.actual))}점)`;
    case 'distinct_types':
      return `다른 유형 ${String(more(s))}개 더`;
    case 'distinct_variant_groups':
      return `서로 다른 문제 ${String(more(s))}개 더`;
    case 'level3_correct':
      return `L3 이상 정답 ${String(more(s))}개`;
    case 'spaced_reviews':
      return `며칠 간격을 둔 복습 ${String(more(s))}번 더`;
    case 'independent_application':
      return `도움 없이 직접 써 보기 ${String(more(s))}번`;
    case 'recent_again':
      return '최근 복습에서 잊지 않고 떠올리기';
    default:
      return s.gate;
  }
}

export const MISCONCEPTION_STATUS_LABELS: Readonly<Record<MisconceptionStatus, string>> = {
  suspected: '의심',
  confirmed: '확정',
  resolved: '해소',
  dismissed: '기각',
};

/** "의심", "확정 · 해소 중(1/2)", "해소" (D-033: progress instead of an extra status). */
export function misconceptionStatusText(m: {
  status: MisconceptionStatus;
  resolution: { done: number; required: number };
}): string {
  const label = MISCONCEPTION_STATUS_LABELS[m.status];
  if ((m.status === 'confirmed' || m.status === 'suspected') && m.resolution.done > 0) {
    const what = m.status === 'confirmed' ? '해소 중' : '기각 중';
    return `${label} · ${what}(${String(m.resolution.done)}/${String(m.resolution.required)})`;
  }
  return label;
}

const OUTCOME_TEXT = {
  correct: '정답',
  partial: '부분 정답',
  incorrect: '오답',
  error: '실행 오류',
} as const;

const CONFIDENCE_TEXT: Readonly<Record<string, string>> = {
  sure: '확실',
  unsure: '애매',
  guess: '찍었어요',
};

/** Why-codes of an attempt's weight factors as short phrases ("힌트 1단계 · 확실"). */
function factorPhrases(factors: NonNullable<MasteryEvidenceView['factors']>): string[] {
  const out: string[] = [];
  const tryWhy = factors['try']?.why ?? '';
  const n = Number(/attempt (\d+)/.exec(tryWhy)?.[1] ?? 1);
  out.push(n > 1 ? `${String(n)}번째 시도` : '첫 시도');
  const hint = factors['hint']?.why ?? '';
  if (hint.startsWith('solution viewed')) out.push('정답 본 뒤');
  else if (hint.startsWith('hint ')) out.push(`힌트 ${hint.slice(5, 6)}단계`);
  else if (hint.startsWith('no hint')) out.push('힌트 없음');
  if (hint.includes('+tutor')) out.push('튜터 도움');
  const confidence = CONFIDENCE_TEXT[factors['confidence']?.why ?? ''];
  if (confidence) out.push(confidence);
  if ((factors['time']?.why ?? '').startsWith('over 3x estimate')) out.push('오래 걸림');
  const k = Number(/k=(\d+)/.exec(factors['repetition']?.why ?? '')?.[1] ?? 0);
  if (k > 0) out.push('같은 문제 반복');
  if (factors['concept']?.why === 'secondary') out.push('보조 개념');
  return out;
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  promoted: '단계가 올랐어요',
  demoted_effective: '숙련도가 떨어져 단계가 내려갔어요',
  demoted_again: '복습에서 잊어 단계가 내려갔어요',
  introduced_by_reading: '레슨을 읽어 입문했어요',
};

/** One evidence row as a title and details ("L2 실행 결과 예측 ✓" / "첫 시도 · 힌트 없음 · 확실"). */
export function evidenceText(e: MasteryEvidenceView): {
  title: string;
  details: string;
  outcome: keyof typeof OUTCOME_TEXT | null;
} {
  if (e.kind === 'attempt') {
    const type = e.exercise ? (TYPE_LABELS[e.exercise.type] ?? e.exercise.type) : '삭제된 문제';
    const level = e.exercise ? `L${String(e.exercise.difficulty)} ` : '';
    const outcome = e.observation?.outcome ?? null;
    return {
      title: `${level}${type}`,
      details: [
        outcome ? OUTCOME_TEXT[outcome] : null,
        ...(e.factors ? factorPhrases(e.factors) : []),
      ]
        .filter(Boolean)
        .join(' · '),
      outcome,
    };
  }
  if (e.kind === 'stage_gate') {
    return {
      title: REASON_TEXT[e.reason ?? ''] ?? '단계가 바뀌었어요',
      details: `${STAGE_NAMES[e.stageBefore]} → ${STAGE_NAMES[e.stageAfter]}`,
      outcome: null,
    };
  }
  return {
    title: e.kind === 'diagnostic_seed' ? '진단 평가' : '규칙 변경으로 다시 계산',
    details: `${STAGE_NAMES[e.stageBefore]} → ${STAGE_NAMES[e.stageAfter]}`,
    outcome: null,
  };
}

/** "+8", "−3", "±0" (score points, rounded). */
export function scoreDelta(e: MasteryEvidenceView): string {
  const d = Math.round(e.scoreAfter - e.scoreBefore);
  if (d > 0) return `+${String(d)}`;
  if (d < 0) return `−${String(-d)}`;
  return '±0';
}
