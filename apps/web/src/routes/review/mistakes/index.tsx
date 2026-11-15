import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MistakeNotes, type MistakeSearch } from '../../../features/review/MistakeNotes.tsx';
import { ReviewHub } from '../../../features/review/ReviewHub.tsx';

const id = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;

export const Route = createFileRoute('/review/mistakes/')({
  validateSearch: (search: Record<string, unknown>): MistakeSearch => {
    const out: MistakeSearch = {};
    const course = id(search['course']);
    const module = id(search['module']);
    const concept = id(search['concept']);
    if (course) out.course = course;
    if (module) out.module = module;
    if (concept) out.concept = concept;
    if (search['open'] === true || search['open'] === 1 || search['open'] === '1') out.open = true;
    if (search['sort'] === 'confident') out.sort = 'confident';
    return out;
  },
  component: MistakesPage,
});

/** 오답 노트 (ui-ux.md 사이트맵 `/review/mistakes`). Filters live in the address. */
function MistakesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ReviewHub>
      <MistakeNotes
        search={search}
        onSearchChange={(next) => {
          void navigate({ to: '/review/mistakes', search: next, replace: true });
        }}
      />
    </ReviewHub>
  );
}
