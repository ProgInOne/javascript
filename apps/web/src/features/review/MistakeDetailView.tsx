import { CONFIDENCE_LABELS } from '@proginone/exercise-ui';
import type { AttemptContext, MistakeAttempt, MistakeDetail } from '@proginone/shared';
import { Badge } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Check, Lock, X } from 'lucide-react';
import { mistakeQuery } from '../../api/queries.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { TYPE_LABELS } from '../practice/model.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { ExerciseCode, SolutionContent } from '../practice/parts.tsx';
import { dateLabel } from './format.ts';
import { RetryButtons } from './MistakeNotes.tsx';

const CONTEXT_LABELS: Readonly<Record<AttemptContext, string>> = {
  lesson: '단원 연습',
  review: '복습',
  weakness: '약점 집중',
  assessment: '단원 평가',
  remedial: '재학습',
  extra: '다시 풀기',
  custom: '자유 연습',
  diagnostic: '진단',
  inline: '본문 확인 문제',
};

/** Back to the list, keeping nothing but the section (filters live in the list's address). */
export function BackToNotes() {
  return (
    <Link to="/review/mistakes" className="mb-4 inline-flex items-center gap-1 type-small">
      <ArrowLeft size={14} aria-hidden="true" />
      오답 노트 목록
    </Link>
  );
}

/**
 * One mistake note (ui-ux.md 오답 노트): the exercise, the learner's wrong answers with what the
 * feedback said, the explanation, and the reference answer only if the learner has already seen
 * it (D-044). "다시 풀기" opens the exercise in a new set.
 */
export function MistakeDetailView({ exerciseId }: { exerciseId: string }) {
  const query = useQuery(mistakeQuery(exerciseId));
  return (
    <QueryState query={query} notFoundTitle="오답 노트에 없는 문제예요">
      {(detail) => <DetailBody detail={detail} />}
    </QueryState>
  );
}

function DetailBody({ detail }: { detail: MistakeDetail }) {
  const { note } = detail;
  const start = useStartSet();
  const resolved = note.status === 'resolved';
  const [latest, ...older] = detail.attempts;
  return (
    <article className="mistake-detail" aria-labelledby="mistake-detail-title">
      <header className="grid gap-2">
        <h2 id="mistake-detail-title" className="type-h2 text-heading">
          {TYPE_LABELS[note.type] ?? '보관된 문제'} · L{note.difficulty}
          {note.concept && ` · ${note.concept.title}`}
        </h2>
        <p className="mistake-item__meta">
          {resolved ? (
            <Badge variant="success" icon={<Check size={12} />}>
              다시 맞힘{note.resolvedAt !== null && ` · ${dateLabel(note.resolvedAt)}`}
            </Badge>
          ) : (
            <Badge variant="error" icon={<X size={12} />}>
              아직 못 맞힘
            </Badge>
          )}
          {note.course && (
            <span>
              {note.course.title}
              {note.module && ` › ${note.module.title}`}
            </span>
          )}
          {note.archived && <Badge variant="neutral">보관된 문제</Badge>}
        </p>
      </header>

      <section className="mistake-detail__block" aria-labelledby="mistake-problem">
        <h3 id="mistake-problem" className="mistake-detail__label">
          문제
        </h3>
        {note.prompt ? (
          <Markdown text={note.prompt} />
        ) : (
          <p className="text-fg-secondary">이 문제는 지금 콘텐츠에서 빠졌어요.</p>
        )}
        <ExerciseCode view={{ code: detail.code, codeLanguage: detail.codeLanguage }} />
      </section>

      {latest && (
        <section className="mistake-detail__block" aria-labelledby="mistake-answer">
          <h3 id="mistake-answer" className="mistake-detail__label">
            내 답 ({dateLabel(latest.submittedAt)})
          </h3>
          <AttemptBody attempt={latest} />
        </section>
      )}

      {older.length > 0 && (
        <details className="assessment-item">
          <summary>이전에 틀린 답 {older.length}개</summary>
          <ol className="mistake-detail__older">
            {older.map((a) => (
              <li key={a.id}>
                <p className="mistake-detail__label">{dateLabel(a.submittedAt)}</p>
                <AttemptBody attempt={a} />
              </li>
            ))}
          </ol>
        </details>
      )}

      <section className="mistake-detail__block" aria-labelledby="mistake-explanation">
        <h3 id="mistake-explanation" className="mistake-detail__label">
          해설
        </h3>
        {detail.explanation ? (
          <Markdown text={detail.explanation} />
        ) : (
          <p className="text-fg-secondary">해설이 없어요.</p>
        )}
      </section>

      <section className="mistake-detail__block" aria-labelledby="mistake-solution">
        <h3 id="mistake-solution" className="mistake-detail__label">
          정답
        </h3>
        {detail.solution ? (
          <>
            <SolutionContent solution={detail.solution} />
            <p className="text-fg-tertiary type-small">
              {detail.solutionSource === 'assessment'
                ? '단원 평가 결과에서 확인한 정답이에요.'
                : '정답 보기로 확인한 정답이에요.'}
            </p>
          </>
        ) : (
          <p className="mistake-detail__locked">
            <Lock size={16} aria-hidden="true" />
            정답은 다시 풀면서 확인해요. 힌트를 끝까지 열면 정답을 볼 수 있어요.
          </p>
        )}
      </section>

      {start.error && (
        <p role="alert" className="practice-error">
          {start.error.message}
        </p>
      )}
      <div className="assessment-result__actions">
        {note.concept && (
          <Link
            to="/concepts/$conceptId"
            params={{ conceptId: note.concept.id }}
            className="pi-button pi-button--secondary pi-button--md no-underline"
          >
            개념 자세히 보기
          </Link>
        )}
        <RetryButtons note={note} start={start} primary />
      </div>
    </article>
  );
}

function AttemptBody({ attempt }: { attempt: MistakeAttempt }) {
  return (
    <div className="grid gap-2">
      <p className="mistake-item__meta">
        <Badge variant={attempt.outcome === 'partial' ? 'warning' : 'error'} icon={<X size={12} />}>
          {attempt.outcome === 'partial' ? '부분 정답' : '오답'}
        </Badge>
        <span>{CONTEXT_LABELS[attempt.context]}</span>
        {attempt.confidence && (
          <span>
            · {CONFIDENCE_LABELS[attempt.confidence]}
            {attempt.confidence === 'sure' && (
              <AlertTriangle
                size={14}
                className="mistake-detail__sure"
                aria-label="확신했는데 틀림"
              />
            )}
          </span>
        )}
        {attempt.hintLevelMax > 0 && <span>· 힌트 {attempt.hintLevelMax}단계</span>}
      </p>
      {attempt.answer.kind === 'none' ? (
        <p className="text-fg-secondary">이 답은 지금 화면에서 보여 줄 수 없어요.</p>
      ) : (
        <div className="mistake-detail__answer">
          <SolutionContent solution={attempt.answer} />
        </div>
      )}
      {attempt.misconceptions.length > 0 && (
        <p className="mistake-item__misconception">
          고른 답이 가리키는 오개념: {attempt.misconceptions.map((m) => m.title).join(', ')}
        </p>
      )}
      {attempt.feedback.length > 0 && (
        <ul className="mistake-detail__feedback" aria-label="채점 피드백">
          {attempt.feedback.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
