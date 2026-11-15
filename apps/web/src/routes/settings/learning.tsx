import {
  HINT_POLICIES,
  PREDICT_FIRST_MODES,
  type HintPolicy,
  type Settings,
} from '@proginone/shared';
import { Checkbox, ErrorState, RadioGroup, Skeleton } from '@proginone/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { useSettings } from '../../api/queries.ts';
import { cardClass, pageTitleClass } from '../../app/layout.ts';
import { useSaveSetting } from '../../features/settings/useSaveSetting.ts';

export const Route = createFileRoute('/settings/learning')({
  component: LearningSettings,
});

const HINT_LABELS: Record<HintPolicy, { label: string; description: string }> = {
  standard: {
    label: '기본',
    description: '언제든 힌트를 한 단계씩 열 수 있어요. 정답은 힌트 3단계를 본 뒤에 볼 수 있어요.',
  },
  'after-attempt': {
    label: '먼저 풀어 보기',
    description:
      '한 번 답을 제출해 본 뒤에 힌트가 열려요. 스스로 떠올려 본 시도가 기억에 더 오래 남아요.',
  },
};

const PREDICT_LABELS: Record<
  Settings['lesson.predictFirst'],
  { label: string; description: string }
> = {
  recommended: {
    label: '권장',
    description: '실행 전에 결과를 예측해 보도록 안내하고, "예측 건너뛰기"도 보여 줘요.',
  },
  required: {
    label: '필수',
    description: '예상한 출력을 적어야 예제를 실행할 수 있어요.',
  },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`${cardClass} grid gap-4`} aria-labelledby={id}>
      <h2 id={id} className="type-h3 text-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * 설정 > 학습 방식 (ui-ux.md#설정, FR-SET-02, D-047). Each change is saved at once and used by the
 * feature it controls: practice and inline checks (confidence, hints), the code editor
 * (autocomplete), lesson examples (predict first) and the relearning card (tutor suggestion).
 */
function LearningSettings() {
  const settings = useSettings();
  const { save, pending } = useSaveSetting();

  return (
    <section aria-labelledby="learning-title" className="max-w-[760px]">
      <h1 id="learning-title" className={pageTitleClass}>
        학습 방식
      </h1>
      {settings.isPending ? (
        <Skeleton height={320} />
      ) : settings.isError ? (
        <ErrorState
          variant="inline"
          title="설정을 불러오지 못했어요"
          description={settings.error.message}
        />
      ) : (
        <div className="grid gap-6">
          <Group title="문제 풀이">
            <Checkbox
              label="답을 낼 때 확신도 묻기"
              description="제출 버튼이 확실해요·애매해요·찍었어요로 나뉘어요. 확신했는데 틀린 문제를 골라 더 자세히 알려 줘요. 끄면 '제출' 하나만 보이고 확신도는 기록하지 않아요."
              checked={settings.data['practice.askConfidence']}
              disabled={pending}
              onCheckedChange={(checked) => {
                save({ 'practice.askConfidence': checked === true }, '확신도');
              }}
            />
            <RadioGroup
              legend="힌트 정책"
              value={settings.data['hints.policy']}
              disabled={pending}
              options={HINT_POLICIES.map((p) => ({ value: p, ...HINT_LABELS[p] }))}
              onValueChange={(value) => {
                save({ 'hints.policy': value as HintPolicy }, '힌트 정책');
              }}
            />
          </Group>

          <Group title="코드 에디터">
            <Checkbox
              label="자동 완성"
              description="입력하는 동안 이름과 키워드를 제안해요. 처음 배울 때는 직접 끝까지 써 보는 편이 문법을 익히는 데 도움이 돼서 기본으로 꺼 두었어요."
              checked={settings.data['editor.autocomplete']}
              disabled={pending}
              onCheckedChange={(checked) => {
                save({ 'editor.autocomplete': checked === true }, '자동 완성');
              }}
            />
          </Group>

          <Group title="레슨 예제">
            <RadioGroup
              legend="예측 후 실행"
              value={settings.data['lesson.predictFirst']}
              disabled={pending}
              options={PREDICT_FIRST_MODES.map((m) => ({ value: m, ...PREDICT_LABELS[m] }))}
              onValueChange={(value) => {
                save(
                  { 'lesson.predictFirst': value as Settings['lesson.predictFirst'] },
                  '예측 후 실행',
                );
              }}
            />
          </Group>

          <Group title="AI 튜터">
            <Checkbox
              label="튜터 선제 제안"
              description="같은 개념에서 계속 막히면 '튜터에게 물어볼 수도 있어요' 안내를 보여 줘요. 튜터 창을 저절로 열지는 않아요."
              checked={settings.data['tutor.proactiveSuggestions']}
              disabled={pending}
              onCheckedChange={(checked) => {
                save({ 'tutor.proactiveSuggestions': checked === true }, '튜터 선제 제안');
              }}
            />
          </Group>
        </div>
      )}
    </section>
  );
}
