import type { MisconceptionChange, Remediation, SetAdaptation } from '@proginone/shared';
import { Badge, Button } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { BookOpen, Coffee, MessageCircle } from 'lucide-react';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';

/** Reasons of items the engine adds while a set is in progress (learning-engine.md 진행 중 적응). */
export const REMEDIAL_REASONS = new Set([
  'remedial_prereq',
  'remedial_worked_example',
  'remedial_easier',
]);

/** Badge text of an item added by the engine, or null for planned items. */
export function addedItemLabel(reason: string): string | null {
  switch (reason) {
    case 'remedial_prereq':
      return '선수 개념 확인';
    case 'remedial_worked_example':
      return '풀이 예제';
    case 'remedial_easier':
      return '쉬운 문제 · 힌트 1단계';
    case 'solution_followup':
      return '비슷한 문제';
    case 'skip_followup':
      return '건너뛴 문제 대신';
    default:
      return null;
  }
}

/** What the engine changed in the set, said once under the feedback ("세트 끝에 추가됐어요"). */
export function adaptationNote(adaptations: readonly SetAdaptation[]): string | null {
  const appended = adaptations.filter((a) => a.kind === 'append');
  const replaced = adaptations.filter((a) => a.kind === 'replace');
  const parts: string[] = [];
  if (appended.some((a) => a.reason === 'solution_followup')) {
    parts.push('정답을 봤으니 비슷한 문제로 다시 나와요.');
  } else if (appended.length > 0 && appended.every((a) => !REMEDIAL_REASONS.has(a.reason))) {
    parts.push(`문제 ${String(appended.length)}개가 세트 끝에 추가됐어요.`);
  }
  if (replaced.some((a) => a.reason === 'difficulty_step_up')) {
    parts.push('잘 풀고 있어서 남은 문제를 한 단계 어렵게 바꿨어요.');
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Why the suggestion appears, without blaming the learner ("막힐 수 있는 부분이에요"). */
export function remediationWhy(r: Remediation): string {
  return r.trigger === 'set_consecutive_failures'
    ? `‘${r.concept.title}’ 문제를 연속으로 2번 틀렸어요. 막힐 수 있는 부분이에요.`
    : `최근 ‘${r.concept.title}’ 문제를 여러 번 연속으로 틀렸어요. 어려운 부분이에요.`;
}

function minutesOf(items: number): number {
  return Math.max(1, Math.round(items * 1.2));
}

/**
 * 재학습 유도 (ui-ux.md 학습 인터랙션 설계): a non-modal card above the problem after repeated
 * failure. Every choice is an equal button and "계속 풀기" is respected; the wording never blames
 * the learner. The suggested items are already at the end of the set (D-033).
 */
export function RemediationCard({
  remediation,
  onGo,
  onDismiss,
  showTutorBadge = true,
}: {
  remediation: Remediation;
  /** `tutor.proactiveSuggestions` (설정 > 학습 방식): off hides the tutor suggestion. */
  showTutorBadge?: boolean;
  /** Moves to the first suggested item. */
  onGo: () => void;
  onDismiss: () => void;
}) {
  const r = remediation;
  const why = remediationWhy(r);
  let ask: string;
  let go: string | null;
  switch (r.kind) {
    case 'prerequisite_check':
      ask = `먼저 ‘${r.prerequisite?.title ?? '선수 개념'}’을(를) ${String(r.check?.items ?? r.itemIds.length)}문제로 짧게 확인해볼까요?`;
      go = `선수 개념 확인하기 (약 ${String(minutesOf(r.check?.items ?? r.itemIds.length))}분)`;
      break;
    case 'worked_example':
      ask = '완성된 풀이부터 단계별로 보면서 다시 익혀볼까요?';
      go = '풀이 예제 보기';
      break;
    case 'easier_with_hint':
      ask = '조금 쉬운 문제를 힌트와 함께 먼저 풀어볼까요?';
      go = '쉬운 문제 풀기';
      break;
    case 'reread_lesson':
      ask = r.lesson
        ? `‘${r.lesson.title}’ 레슨을 다시 읽어보면 도움이 될 거예요.`
        : '관련 레슨을 다시 읽어보면 도움이 될 거예요.';
      go = null;
      break;
  }
  const checked = r.prerequisitesChecked;
  return (
    <section className="remediation" aria-labelledby={`remediation-${r.id}`}>
      <h3 id={`remediation-${r.id}`} className="remediation__title">
        <Coffee size={18} aria-hidden="true" />
        잠깐 쉬어가요
      </h3>
      <p>{why}</p>
      <p>{ask}</p>
      {checked.length > 0 && (
        <details className="remediation__why">
          <summary>왜 이걸 권하나요?</summary>
          <ul>
            {checked.map((p) => (
              <li key={p.conceptId}>
                <MasteryIcon stage={p.stage} decorative />
                {p.title} · {STAGE_NAMES[p.stage]} · 숙련도 {Math.round(p.effective)}
                {p.weak && ' · 다시 확인이 필요해요'}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="remediation__actions">
        {go && r.itemIds.length > 0 && <Button onClick={onGo}>{go}</Button>}
        {r.kind === 'reread_lesson' && r.lesson && (
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: r.lesson.id }}
            className="pi-button pi-button--secondary pi-button--md no-underline"
          >
            <BookOpen size={16} aria-hidden="true" />
            레슨 다시 읽기
          </Link>
        )}
        <Button onClick={onDismiss}>계속 풀기</Button>
      </div>
      {r.tutorBadge && showTutorBadge && (
        <p className="remediation__tutor">
          <Badge variant="ai" icon={<MessageCircle size={14} />}>
            AI 튜터
          </Badge>
          막히는 부분을 튜터에게 물어볼 수도 있어요. 오른쪽 위 ‘튜터’ 버튼을 누르세요.
        </p>
      )}
    </section>
  );
}

/** One misconception change as a sentence ("‘X’ 해소 중(1/2)", D-033). */
export function misconceptionChangeText(c: MisconceptionChange): string | null {
  const t = c.transitions;
  const progress = `(${String(c.resolution.done)}/${String(c.resolution.required)})`;
  if (c.statusAfter === 'resolved') return `‘${c.title}’ 오개념을 해소했어요.`;
  if (c.statusAfter === 'dismissed') return null;
  if (t.includes('relapsed') || t.includes('reopened')) {
    return `‘${c.title}’ 오개념이 다시 보였어요. 관련 문제로 한 번 더 확인할게요.`;
  }
  if (t.includes('confirmed')) {
    return `‘${c.title}’ 오개념이 확인됐어요. 관련 문제를 두 번 맞히면 해소돼요.`;
  }
  if (t.includes('resolution_progress') && c.statusAfter === 'confirmed') {
    return `‘${c.title}’ 해소 중${progress}`;
  }
  if (t.includes('observed')) return `‘${c.title}’ 오개념일 수 있어요(의심).`;
  if (t.includes('evidence_added')) return `‘${c.title}’ 오개념이 한 번 더 보였어요.`;
  return null;
}

/** Misconception progress under the feedback (ui-ux.md 재학습 유도, MisconceptionNote). */
export function MisconceptionProgress({ changes }: { changes: readonly MisconceptionChange[] }) {
  const lines = changes
    .map((c) => ({ id: c.misconceptionId, text: misconceptionChangeText(c) }))
    .filter((l): l is { id: string; text: string } => l.text !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="misconception-progress" aria-label="오개념 변화">
      {lines.map((l) => (
        <li key={l.id}>{l.text}</li>
      ))}
    </ul>
  );
}
