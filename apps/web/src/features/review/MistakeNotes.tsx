import type { MistakeList, MistakeNote } from '@proginone/shared';
import { Badge, Button, Checkbox, EmptyState, Select } from '@proginone/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, Check, NotebookPen, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { mistakesQuery } from '../../api/queries.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { TYPE_LABELS } from '../practice/model.ts';
import { dateLabel, excerpt } from './format.ts';

/** Filters kept in the address (`/review/mistakes?course=…&open=1`). */
export interface MistakeSearch {
  course?: string | undefined;
  module?: string | undefined;
  concept?: string | undefined;
  /** "아직 못 맞힌 것만". */
  open?: boolean | undefined;
  sort?: 'confident' | undefined;
}

const PAGE = 20;
/** `POST /practice-sets {kind:'extra'}` takes at most 10 exercises. */
const RETRY_MAX = 10;
const ALL = 'all';

/**
 * 오답 노트 (ui-ux.md 오답 노트, FR-DASH-04): every exercise answered wrongly, newest first, with
 * filters, "다시 풀기" per note or for the open ones, and a link to the note detail.
 */
export function MistakeNotes({
  search,
  onSearchChange,
}: {
  search: MistakeSearch;
  onSearchChange: (next: MistakeSearch) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const query = useQuery({
    ...mistakesQuery({
      courseId: search.course,
      moduleId: search.module,
      conceptId: search.concept,
      status: search.open ? 'open' : 'all',
      sort: search.sort ?? 'recent',
      limit,
    }),
    // Keep the list on screen while a filter change loads.
    placeholderData: keepPreviousData,
  });
  const change = (next: MistakeSearch) => {
    setLimit(PAGE);
    onSearchChange(next);
  };
  return (
    <QueryState query={query} notFoundTitle="오답 노트를 찾을 수 없어요">
      {(list) => (
        <MistakeListBody
          list={list}
          search={search}
          onSearchChange={change}
          loadingMore={query.isFetching && query.isPlaceholderData}
          onMore={() => {
            setLimit((n) => n + PAGE);
          }}
        />
      )}
    </QueryState>
  );
}

function filtered(search: MistakeSearch) {
  return (
    search.course !== undefined ||
    search.module !== undefined ||
    search.concept !== undefined ||
    search.open === true
  );
}

function MistakeListBody({
  list,
  search,
  onSearchChange,
  loadingMore,
  onMore,
}: {
  list: MistakeList;
  search: MistakeSearch;
  onSearchChange: (next: MistakeSearch) => void;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const start = useStartSet();
  if (list.counts.all === 0 && !filtered(search)) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="아직 틀린 문제가 없어요"
        description="문제를 풀면 여기에 모여요. 틀린 문제는 다시 풀어서 맞히면 ‘다시 맞힘’으로 바뀌어요."
        action={
          <Link to="/courses" className="pi-button pi-button--secondary pi-button--md no-underline">
            연습하러 가기
          </Link>
        }
      />
    );
  }
  const retryable = list.items
    .filter((n) => n.status === 'open' && n.retry.available)
    .slice(0, RETRY_MAX);
  return (
    <div className="grid gap-4">
      <Filters list={list} search={search} onSearchChange={onSearchChange} />
      <div className="review-summary">
        <p className="m-0 text-fg-secondary" aria-live="polite">
          오답 {list.counts.all}개 · 아직 못 맞힌 것 {list.counts.open}개 · 다시 맞힌 것{' '}
          {list.counts.resolved}개
        </p>
        {retryable.length > 1 && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw size={16} aria-hidden="true" />}
            loading={start.pending === 'all'}
            onClick={() =>
              void start.start('all', {
                kind: 'extra',
                exerciseIds: retryable.map((n) => n.exerciseId),
              })
            }
          >
            못 맞힌 문제 {retryable.length}개 다시 풀기
          </Button>
        )}
      </div>
      {start.error && (
        <p role="alert" className="practice-error">
          {start.error.message}
        </p>
      )}
      {list.items.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="조건에 맞는 오답이 없어요"
          description="다른 조건으로 찾아보세요."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                onSearchChange({});
              }}
            >
              필터 지우기
            </Button>
          }
        />
      ) : (
        <ul className="mistake-list" aria-label="오답 목록">
          {list.items.map((note) => (
            <MistakeItem key={note.exerciseId} note={note} start={start} />
          ))}
        </ul>
      )}
      {list.items.length < list.total && (
        <div>
          <Button variant="secondary" loading={loadingMore} onClick={onMore}>
            더 보기 ({list.total - list.items.length}개 남음)
          </Button>
        </div>
      )}
    </div>
  );
}

function Filters({
  list,
  search,
  onSearchChange,
}: {
  list: MistakeList;
  search: MistakeSearch;
  onSearchChange: (next: MistakeSearch) => void;
}) {
  const { courses, modules, concepts } = list.facets;
  const shownModules = modules.filter((m) => !search.course || m.courseId === search.course);
  const moduleIds = new Set(shownModules.map((m) => m.id));
  const shownConcepts = concepts.filter((c) =>
    search.module ? c.moduleId === search.module : c.moduleId === null || moduleIds.has(c.moduleId),
  );
  const pick = (value: string) => (value === ALL ? undefined : value);
  return (
    <div className="mistake-filters" role="group" aria-label="오답 노트 필터">
      <Select
        label="과정"
        value={search.course ?? ALL}
        options={[{ value: ALL, label: '모든 과정' }, ...courses.map(option)]}
        onValueChange={(v) => {
          onSearchChange({ ...search, course: pick(v), module: undefined, concept: undefined });
        }}
      />
      <Select
        label="모듈"
        value={search.module ?? ALL}
        options={[{ value: ALL, label: '모든 모듈' }, ...shownModules.map(option)]}
        onValueChange={(v) => {
          onSearchChange({ ...search, module: pick(v), concept: undefined });
        }}
      />
      <Select
        label="개념"
        value={search.concept ?? ALL}
        options={[{ value: ALL, label: '모든 개념' }, ...shownConcepts.map(option)]}
        onValueChange={(v) => {
          onSearchChange({ ...search, concept: pick(v) });
        }}
      />
      <Select
        label="정렬"
        value={search.sort ?? 'recent'}
        options={[
          { value: 'recent', label: '최근순' },
          { value: 'confident', label: '확신 오답 먼저' },
        ]}
        onValueChange={(v) => {
          onSearchChange({ ...search, sort: v === 'confident' ? 'confident' : undefined });
        }}
      />
      <div className="mistake-filters__check">
        <Checkbox
          label="아직 못 맞힌 것만"
          checked={search.open === true}
          onCheckedChange={(checked) => {
            onSearchChange({ ...search, open: checked === true ? true : undefined });
          }}
        />
      </div>
    </div>
  );
}

const option = (ref: { id: string; title: string }) => ({ value: ref.id, label: ref.title });

/** One note: result marks, where it is from, when, the prompt, the misconception and actions. */
function MistakeItem({
  note,
  start,
}: {
  note: MistakeNote;
  start: ReturnType<typeof useStartSet>;
}) {
  const resolved = note.status === 'resolved';
  const titleId = `mistake-${note.exerciseId}`;
  return (
    <li className="mistake-item" data-status={note.status}>
      <div className="mistake-item__marks" aria-hidden="true">
        <X size={16} className="mistake-item__wrong" />
        {resolved && (
          <>
            <ArrowRight size={14} />
            <Check size={16} className="mistake-item__right" />
          </>
        )}
      </div>
      <div className="mistake-item__body">
        <h2 id={titleId} className="mistake-item__title">
          <span className="sr-only">{resolved ? '다시 맞힌 오답: ' : '아직 못 맞힌 오답: '}</span>
          {TYPE_LABELS[note.type] ?? '보관된 문제'} · L{note.difficulty}
          {note.concept && ` · ${note.concept.title}`}
        </h2>
        <p className="mistake-item__meta">
          <span>
            {dateLabel(note.lastWrongAt)}{' '}
            {note.lastWrongOutcome === 'partial' ? '부분 정답' : '오답'}
            {note.wrongCount > 1 && ` (${String(note.wrongCount)}번 틀림)`}
          </span>
          {resolved && note.resolvedAt !== null && (
            <span>· {dateLabel(note.resolvedAt)} 다시 맞힘</span>
          )}
          {note.lastWrongContext === 'assessment' && <Badge variant="neutral">단원 평가</Badge>}
          {note.confidentWrong && (
            <Badge variant="warning" icon={<AlertTriangle size={12} />}>
              확실했어요
            </Badge>
          )}
        </p>
        {note.prompt && <p className="mistake-item__prompt">{excerpt(note.prompt)}</p>}
        {note.misconceptions.length > 0 && (
          <p className="mistake-item__misconception">
            오개념: {note.misconceptions.map((m) => m.title).join(', ')}
          </p>
        )}
        <div className="mistake-item__actions">
          <Link
            to="/review/mistakes/$exerciseId"
            params={{ exerciseId: note.exerciseId }}
            className="pi-button pi-button--secondary pi-button--sm no-underline"
            aria-describedby={titleId}
          >
            풀이 다시 보기
          </Link>
          <RetryButtons note={note} start={start} describedBy={titleId} />
        </div>
      </div>
    </li>
  );
}

/**
 * "다시 풀기" (the same exercise in an extra set) or, when that is not possible (assessment-only
 * or archived exercises), "비슷한 문제 풀기" (a weakness set for the concept).
 */
export function RetryButtons({
  note,
  start,
  describedBy,
  primary = false,
}: {
  note: MistakeNote;
  start: ReturnType<typeof useStartSet>;
  describedBy?: string;
  primary?: boolean;
}) {
  const busy = start.pending !== null;
  if (note.retry.available) {
    return (
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size={primary ? 'md' : 'sm'}
        icon={<RotateCcw size={16} aria-hidden="true" />}
        loading={start.pending === note.exerciseId}
        disabled={busy && start.pending !== note.exerciseId}
        aria-describedby={describedBy}
        onClick={() =>
          void start.start(note.exerciseId, { kind: 'extra', exerciseIds: [note.exerciseId] })
        }
      >
        다시 풀기
      </Button>
    );
  }
  if (!note.concept) return null;
  const key = `similar:${note.exerciseId}`;
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size={primary ? 'md' : 'sm'}
      loading={start.pending === key}
      disabled={busy && start.pending !== key}
      aria-describedby={describedBy}
      onClick={() =>
        void start.start(key, {
          kind: 'weakness',
          conceptIds: note.concept ? [note.concept.id] : [],
        })
      }
    >
      비슷한 문제 풀기
    </Button>
  );
}
