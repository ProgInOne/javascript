import { createFileRoute } from '@tanstack/react-router';
import { ReviewHub } from '../../features/review/ReviewHub.tsx';
import { WeakFocus } from '../../features/review/WeakFocus.tsx';

export const Route = createFileRoute('/review/weak')({
  component: WeakPage,
});

/** 약점 집중 (ui-ux.md 사이트맵 `/review/weak`). */
function WeakPage() {
  return (
    <ReviewHub>
      <WeakFocus />
    </ReviewHub>
  );
}
