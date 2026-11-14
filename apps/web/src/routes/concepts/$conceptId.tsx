import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { masteryQuery } from '../../api/queries.ts';
import { pageClass } from '../../app/layout.ts';
import { ConceptDetailBody } from '../../features/concepts/ConceptDetailView.tsx';

export const Route = createFileRoute('/concepts/$conceptId')({
  component: ConceptPage,
});

/**
 * 개념 상세, full page (ui-ux.md 사이트맵 `/concepts/:conceptId`: a direct URL shows the page;
 * from the dashboard and the concept map it opens as a sheet).
 */
function ConceptPage() {
  const { conceptId } = Route.useParams();
  // Only for "내일" in the next review line; the page works without it.
  const today = useQuery(masteryQuery).data?.date ?? null;
  return (
    <div className={`${pageClass} max-w-[880px]`}>
      <Link to="/" className="mb-6 inline-flex items-center gap-1 type-small">
        <ArrowLeft size={14} aria-hidden="true" />
        대시보드
      </Link>
      <div className="concept-page">
        <ConceptDetailBody key={conceptId} conceptId={conceptId} headingLevel={1} today={today} />
      </div>
    </div>
  );
}
