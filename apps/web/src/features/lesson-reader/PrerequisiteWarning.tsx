import type { LessonPrerequisites } from '@proginone/shared';
import { Button } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';

/** Names spelled out in the title; the rest are counted ("외 n개"). */
const NAMED = 2;

/**
 * Non-blocking prerequisite warning when a lesson opens (FR-CUR-05, ui-ux.md 과정 상세 "먼저 ‘…’을
 * 공부하면 더 쉬워요"): the weak `required` prerequisites with their stage and three ways back —
 * the concept detail, the lesson that introduces it, and weakness practice (only for concepts the
 * learner has practised: a weakness set ranks only those). Nothing is locked; the lesson reads as usual below it.
 */
export function PrerequisiteWarning({ data }: { data: LessonPrerequisites }) {
  const start = useStartSet();
  const weak = data.warnings.flatMap((id) => data.prerequisites.filter((p) => p.concept.id === id));
  if (weak.length === 0) return null;
  const named = weak
    .slice(0, NAMED)
    .map((p) => `‘${p.concept.title}’`)
    .join(', ');
  const rest = weak.length > NAMED ? ` 외 ${String(weak.length - NAMED)}개` : '';
  return (
    <section className="lesson-prereq-warning" aria-labelledby="prereq-warning-title">
      <CircleAlert size={18} aria-hidden="true" className="lesson-prereq-warning__icon" />
      <div className="grid gap-3">
        <div>
          <h2 id="prereq-warning-title" className="lesson-prereq-warning__title">
            먼저 {named}
            {rest}부터 확인하면 더 쉬워요
          </h2>
          <p className="m-0">
            이 단원은 아래 선수 개념을 바탕으로 해요. 아직 익숙하지 않아 보이지만, 그대로 읽어도
            괜찮아요.
          </p>
        </div>
        <ul className="lesson-prereq-warning__list">
          {weak.map((p) => (
            <li key={p.concept.id} className="lesson-prereq-warning__item">
              <span className="inline-flex items-center gap-2">
                <MasteryIcon stage={p.stage} decorative />
                <strong>{p.concept.title}</strong>
                <span className="text-fg-secondary">
                  {STAGE_NAMES[p.stage]}
                  {p.practiced ? ` · 숙련도 ${String(Math.round(p.effective))}` : ''}
                </span>
              </span>
              <span className="lesson-prereq-warning__actions">
                <Link
                  to="/concepts/$conceptId"
                  params={{ conceptId: p.concept.id }}
                  className="lesson-link"
                  aria-label={`${p.concept.title} 개념 보기`}
                >
                  개념 보기
                </Link>
                {p.lesson && (
                  <Link
                    to="/learn/$lessonId"
                    params={{ lessonId: p.lesson.id }}
                    search={{}}
                    className="lesson-link"
                  >
                    ‘{p.lesson.title}’ 단원 보기
                  </Link>
                )}
                {p.practiced && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={start.pending === p.concept.id}
                    disabled={start.pending !== null && start.pending !== p.concept.id}
                    aria-label={`${p.concept.title} 약점 연습`}
                    onClick={() => {
                      void start.start(p.concept.id, {
                        kind: 'weakness',
                        conceptIds: [p.concept.id],
                      });
                    }}
                  >
                    약점 연습
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {start.error && (
          <p role="alert" className="practice-error m-0">
            {start.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
