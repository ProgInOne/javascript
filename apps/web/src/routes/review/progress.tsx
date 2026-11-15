import { createFileRoute } from '@tanstack/react-router';
import { MasteryChangesView } from '../../features/review/MasteryChangesView.tsx';
import { ReviewHub } from '../../features/review/ReviewHub.tsx';

export const Route = createFileRoute('/review/progress')({
  component: ProgressPage,
});

/** 숙련도 변화 (FR-DASH-04, D-046: the fourth review section). */
function ProgressPage() {
  return (
    <ReviewHub>
      <MasteryChangesView />
    </ReviewHub>
  );
}
