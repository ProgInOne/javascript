import type { WeakConcept, WeakConcepts } from '@proginone/shared';
import { Button, Checkbox, EmptyState } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Crosshair, Target } from 'lucide-react';
import { useState } from 'react';
import { weakConceptsQuery } from '../../api/queries.ts';
import { cardClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';

/** `POST /practice-sets {kind:'weakness'}` takes at most 5 concepts. */
const PICK_MAX = 5;

/**
 * 약점 집중 (ui-ux.md 약점 집중): up to 10 weak concepts, each with "왜 약점인가요?" (recent
 * failures, misconceptions, prerequisite states), and a weakness set for the ones picked. The
 * engine's suggestion is preselected; a weak prerequisite is offered first (재학습 경로).
 */
export function WeakFocus() {
  const query = useQuery(weakConceptsQuery);
  return (
    <QueryState query={query} notFoundTitle="약점 개념을 찾을 수 없어요">
      {(weak) => <WeakFocusBody weak={weak} />}
    </QueryState>
  );
}

function WeakFocusBody({ weak }: { weak: WeakConcepts }) {
  const start = useStartSet();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(weak.suggested.slice(0, PICK_MAX));
  if (weak.concepts.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="아직 약점이 없어요"
        description="연습한 개념 중 숙련도가 낮거나 오개념이 보이는 개념이 여기에 모여요."
        action={
          <Link
            to="/review/mistakes"
            className="pi-button pi-button--secondary pi-button--md no-underline"
          >
            오답 노트 보기
          </Link>
        }
      />
    );
  }
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const full = selected.size >= PICK_MAX;
  return (
    <section className={`${cardClass} grid gap-4`} aria-labelledby="weak-focus-title">
      <div>
        <h2 id="weak-focus-title" className="type-h3 text-heading">
          연습할 약점 개념을 골라요
        </h2>
        <p className="m-0 text-fg-secondary type-small">
          최대 {PICK_MAX}개까지 고를 수 있어요. 추천한 개념을 미리 골라 두었어요.
        </p>
      </div>
      <ul className="weak-list">
        {weak.concepts.map((w) => (
          <WeakRow
            key={w.concept.id}
            weak={w}
            checked={selected.has(w.concept.id)}
            disabled={full && !selected.has(w.concept.id)}
            onChange={(on) => {
              toggle(w.concept.id, on);
            }}
          />
        ))}
      </ul>
      {start.error && (
        <p role="alert" className="practice-error">
          {start.error.message}
        </p>
      )}
      <div>
        <Button
          variant="primary"
          icon={<Crosshair size={16} aria-hidden="true" />}
          disabled={selected.size === 0}
          loading={start.pending === 'weakness'}
          onClick={() =>
            void start.start('weakness', {
              kind: 'weakness',
              conceptIds: weak.concepts
                .map((w) => w.concept.id)
                .filter((id) => selected.has(id))
                .slice(0, PICK_MAX),
            })
          }
        >
          약점 집중 시작{selected.size > 0 ? ` (${String(selected.size)}개 개념)` : ''}
        </Button>
      </div>
    </section>
  );
}

function WeakRow({
  weak: w,
  checked,
  disabled,
  onChange,
}: {
  weak: WeakConcept;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const weakPrereq = w.prerequisites.find((p) => p.weak);
  const confirmed = w.misconceptions.some((m) => m.status === 'confirmed');
  return (
    <li className="weak-row">
      <Checkbox
        label={
          <span className="inline-flex items-center gap-2">
            <MasteryIcon stage={w.stage} weak={confirmed} />
            {w.concept.title}
          </span>
        }
        description={`${STAGE_NAMES[w.stage]} · 숙련도 ${String(Math.round(w.effective))}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => {
          onChange(value === true);
        }}
      />
      {weakPrereq && (
        <p className="weak-row__prereq">
          선수 개념 ‘{weakPrereq.concept.title}’부터 확인해요.{' '}
          <Link to="/concepts/$conceptId" params={{ conceptId: weakPrereq.concept.id }}>
            선수 개념 보기
          </Link>
        </p>
      )}
      <details className="weak-row__why">
        <summary>왜 약점인가요?</summary>
        <ul>
          <li>
            지금 숙련도 {Math.round(w.effective)}점이에요(단계: {STAGE_NAMES[w.stage]}).
          </li>
          {w.consecutiveFailures >= 2 && <li>최근 {w.consecutiveFailures}번 연속으로 틀렸어요.</li>}
          {w.misconceptions.map((m) => (
            <li key={m.id}>
              오개념 ‘{m.title}’이 {m.status === 'confirmed' ? '확인됐어요' : '의심돼요'}.
            </li>
          ))}
          {w.prerequisites.map((p) => (
            <li key={p.concept.id}>
              선수 개념 ‘{p.concept.title}’: {STAGE_NAMES[p.stage]}, 숙련도{' '}
              {Math.round(p.effective)}
              {p.weak ? ' (먼저 확인하면 좋아요)' : ''}
            </li>
          ))}
        </ul>
        <Link to="/review/mistakes" search={{ concept: w.concept.id }} className="type-small">
          이 개념의 오답 보기
        </Link>
      </details>
    </li>
  );
}
