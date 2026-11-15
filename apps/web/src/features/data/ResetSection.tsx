import { RESET_CONFIRM_TEXT } from '@proginone/shared';
import { Button, Input, useToast } from '@proginone/ui';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useResetLearningData } from '../../api/queries.ts';
import { cardClass } from '../../app/layout.ts';

/**
 * 학습 데이터 초기화 (ui-ux.md#설정, FR-SET-07, D-045): a danger button that only works after
 * typing "초기화". The server backs up first, wipes learning records and keeps settings; the
 * learner starts over at onboarding.
 */
export function ResetSection() {
  const reset = useResetLearningData();
  const toast = useToast();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const confirmed = typed === RESET_CONFIRM_TEXT;

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!confirmed) return;
    reset.mutate(undefined, {
      onSuccess: () => {
        setTyped('');
        toast({
          title: '학습 데이터를 초기화했어요',
          description: '초기화 직전 상태는 "초기화 전" 백업으로 남겨 두었어요.',
          variant: 'success',
        });
        void navigate({ to: '/' }); // the dashboard sends a fresh learner to onboarding
      },
      onError: (err) => {
        toast({ title: '초기화하지 못했어요', description: err.message, variant: 'error' });
      },
    });
  };

  return (
    <section aria-labelledby="reset-title" className={`${cardClass} mt-6`}>
      <h2 id="reset-title" className="type-h3 text-heading">
        학습 데이터 초기화
      </h2>
      <p className="mt-2 text-fg-secondary">
        진도, 문제 풀이 기록, 숙련도와 복습 일정, 오개념, 튜터 대화, 학습 목표를 모두 지우고
        처음부터 시작해요. 화면·학습 방식 설정과 백업은 그대로 두고, 지우기 직전 상태를 먼저
        백업해요.
      </p>
      <form className="mt-4 grid max-w-[420px] gap-3" onSubmit={submit}>
        <Input
          label={`계속하려면 "${RESET_CONFIRM_TEXT}"를 입력하세요`}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <div>
          <Button
            type="submit"
            variant="danger"
            icon={<Trash2 size={16} />}
            disabled={!confirmed}
            loading={reset.isPending}
          >
            학습 데이터 초기화
          </Button>
        </div>
      </form>
    </section>
  );
}
