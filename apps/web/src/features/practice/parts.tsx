import type { CheckResult, FeedbackItem } from '@proginone/exercise-kit';
import type { FeedbackResult } from '@proginone/exercise-kit-ui';
import { CodeBlock, InlineText } from '@proginone/exercise-kit-ui';
import {
  REPORT_REASONS,
  type AttemptResponse,
  type ExerciseView,
  type MasteryChange,
  type SolutionView,
} from '@proginone/shared';
import { Button, Dialog, Select, useToast } from '@proginone/ui';
import { ArrowRight, Flag } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { reportExercise } from '../../api/queries.ts';
import { STAGE_LABELS } from './model.ts';

/** The grading part of an attempt response, in the shape FeedbackBanner takes. */
export function feedbackResultOf(res: {
  attempt: Pick<AttemptResponse['attempt'], 'outcome' | 'score'>;
  grade: AttemptResponse['grade'];
}): FeedbackResult {
  return {
    outcome: res.attempt.outcome,
    score: res.attempt.score,
    feedback: res.grade.feedback as FeedbackItem[],
    ...(res.grade.checkResults ? { checkResults: res.grade.checkResults as CheckResult[] } : {}),
    ...(res.grade.failedRequirements ? { failedRequirements: res.grade.failedRequirements } : {}),
    ...(res.grade.milestones ? { milestones: res.grade.milestones } : {}),
  };
}

/**
 * The read-only snippet an exercise prompt refers to (`ExerciseView.code`), labelled with the
 * course language. HTML course snippets without markup (folder trees) are plain "코드".
 */
export function ExerciseCode({ view }: { view: Pick<ExerciseView, 'code' | 'codeLanguage'> }) {
  if (view.code === null) return null;
  const language = codeLanguageKey(view.codeLanguage, view.code);
  return (
    <CodeBlock
      code={view.code}
      lineNumbers={language !== null}
      {...(language ? { language } : {})}
    />
  );
}

function codeLanguageKey(course: ExerciseView['codeLanguage'], code: string): string | null {
  switch (course) {
    case 'javascript':
      return 'js';
    case 'css':
      return 'css';
    case 'html':
      return /<[a-z!/]/i.test(code) ? 'html' : null;
    default:
      // Any other course language (the API leaves it open, D-092) or none: no highlighting.
      return null;
  }
}

/** Stage changes of this attempt ("개념 변화"). Score-only changes are not shown (ui-ux.md). */
export function MasteryChangeList({ changes }: { changes: readonly MasteryChange[] }) {
  const moved = changes.filter((c) => c.stageBefore !== c.stageAfter);
  if (moved.length === 0) return null;
  return (
    <div className="practice-mastery">
      <p className="practice-mastery__title">개념 변화</p>
      <ul>
        {moved.map((c) => (
          <li key={c.conceptId}>
            <span>{c.title}</span>{' '}
            <span className="practice-mastery__stage">
              {STAGE_LABELS[c.stageBefore]}
              <ArrowRight size={14} aria-label="에서" />
              {STAGE_LABELS[c.stageAfter]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The reference answer shown after "정답 보기". */
export function SolutionContent({ solution }: { solution: SolutionView }) {
  switch (solution.kind) {
    case 'choice':
      return (
        <p>
          <InlineText text={solution.text} />
        </p>
      );
    case 'choices':
      return (
        <ul>
          {solution.choices.map((c) => (
            <li key={c.id}>
              <InlineText text={c.text} />
            </li>
          ))}
        </ul>
      );
    case 'text':
      return (
        <p>
          <InlineText text={solution.text} />
        </p>
      );
    case 'blanks':
      return (
        <ul>
          {solution.blanks.map((b, i) => (
            <li key={b.id}>
              빈칸 {i + 1}: <code className="pi-ex-inline-code">{b.answer ?? '—'}</code>
            </li>
          ))}
        </ul>
      );
    case 'console':
      return <CodeBlock code={solution.lines.join('\n')} language="출력" lineNumbers={false} />;
    case 'value':
      return <code className="pi-ex-inline-code">{solution.text}</code>;
    case 'error':
      return (
        <p>{solution.thrown ? `오류가 나요: ${solution.name ?? '오류'}` : '오류가 나지 않아요.'}</p>
      );
    case 'files':
      return (
        <>
          {solution.files.map((f) => (
            <CodeBlock key={f.path} code={f.content} language={f.path.split('.').pop() ?? 'js'} />
          ))}
        </>
      );
    case 'none':
      return null;
  }
}

const REPORT_REASON_LABELS: Readonly<Record<(typeof REPORT_REASONS)[number], string>> = {
  wrong_answer: '정답이 틀렸어요',
  unclear: '문제를 이해하기 어려워요',
  wrong_hint_or_explanation: '힌트나 해설이 틀렸어요',
  difficulty_mismatch: '난이도가 맞지 않아요',
  other: '기타',
};

/** "문제 신고" (content-and-exercises.md#문제-신고-처리): the exercise stops being served. */
export function ReportButton({ exerciseId }: { exerciseId: string }) {
  const toast = useToast();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('wrong_answer');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await reportExercise(exerciseId, {
        reason,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setOpen(false);
      setDone(true);
      toast({
        variant: 'success',
        title: '신고해 주셔서 고마워요. 이 문제는 다시 나오지 않아요.',
      });
    } catch (e) {
      toast({
        variant: 'error',
        title: '신고를 보내지 못했어요',
        description: e instanceof ApiRequestError ? e.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="이 문제를 신고할까요?"
      description="신고한 문제는 앞으로 연습에 나오지 않아요."
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={<Flag size={14} aria-hidden="true" />}
          disabled={done}
        >
          {done ? '신고함' : '문제 신고'}
        </Button>
      }
      footer={
        <>
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            취소
          </Button>
          <Button variant="primary" loading={sending} onClick={() => void send()}>
            신고하기
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select
          label="이유"
          value={reason}
          onValueChange={(v) => {
            setReason(v as (typeof REPORT_REASONS)[number]);
          }}
          options={REPORT_REASONS.map((r) => ({ value: r, label: REPORT_REASON_LABELS[r] }))}
        />
        <div className="grid gap-1">
          <label htmlFor={noteId} className="font-medium type-small">
            자세한 내용 (선택)
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className="rounded-md border border-(--color-border-input) bg-surface px-3 py-2 text-fg"
          />
        </div>
      </div>
    </Dialog>
  );
}
