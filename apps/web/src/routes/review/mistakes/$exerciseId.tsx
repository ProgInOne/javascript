import { createFileRoute } from '@tanstack/react-router';
import { BackToNotes, MistakeDetailView } from '../../../features/review/MistakeDetailView.tsx';
import { ReviewHub } from '../../../features/review/ReviewHub.tsx';

export const Route = createFileRoute('/review/mistakes/$exerciseId')({
  component: MistakePage,
});

/** One mistake note (ui-ux.md 오답 노트: "풀이 다시 보기"). */
function MistakePage() {
  const { exerciseId } = Route.useParams();
  return (
    <ReviewHub>
      <BackToNotes />
      <MistakeDetailView key={exerciseId} exerciseId={exerciseId} />
    </ReviewHub>
  );
}
