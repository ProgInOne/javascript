import { ListChecks } from 'lucide-react';

/** Inline check exercise. The real renderer comes with packages/exercise-ui. */
export function InlineExerciseSlot({ exerciseId }: { exerciseId: string }) {
  return (
    <div className="lesson-inline-exercise" data-exercise-id={exerciseId}>
      <ListChecks size={18} aria-hidden="true" />
      <span>확인 문제는 실습 기능과 함께 열려요.</span>
    </div>
  );
}
