import { Drawer } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { Maximize2 } from 'lucide-react';
import { ConceptDetailBody } from './ConceptDetailView.tsx';

/**
 * The concept detail as a right sheet (ui-ux.md 사이트맵: "대시보드·개념 지도에서는 시트로
 * 열림"): non-modal, so the concept map stays usable; Esc closes and focus returns to the tile.
 * A prerequisite opens in the same sheet.
 */
export function ConceptSheet({
  concept,
  today,
  onOpen,
  onClose,
}: {
  /** The open concept, or null when closed. */
  concept: { id: string; title: string } | null;
  today: string | null;
  onOpen: (concept: { id: string; title: string }) => void;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={concept !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={concept ? `개념: ${concept.title}` : '개념'}
      closeLabel="개념 상세 닫기"
      className="concept-sheet"
    >
      {concept && (
        <div className="grid gap-4">
          <Link
            to="/concepts/$conceptId"
            params={{ conceptId: concept.id }}
            className="inline-flex items-center gap-1 justify-self-start type-small"
          >
            <Maximize2 size={14} aria-hidden="true" />
            전체 화면으로 보기
          </Link>
          <ConceptDetailBody
            key={concept.id}
            conceptId={concept.id}
            headingLevel={2}
            inSheet
            today={today}
            onOpenConcept={(id, title) => {
              onOpen({ id, title });
            }}
          />
        </div>
      )}
    </Drawer>
  );
}
