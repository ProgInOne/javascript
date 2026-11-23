import { FileText } from 'lucide-react';

export interface PreviewTabBarProps {
  /**
   * The preview document's title as the runner reported it (`document.title`, D-082). `null`,
   * `undefined` or blank shows "제목 없음". Learner code controls this string: it is only ever
   * rendered as text.
   */
  title?: string | null | undefined;
  className?: string;
}

/**
 * A browser-tab look-alike above a preview (D-082). The preview is an iframe without a browser
 * tab of its own, so exercises about `<title>` and `document.title` had nothing to look at.
 *
 * Not a live region: a title that changes often (a clock in `document.title`) would otherwise be
 * announced again and again. Screen reader users read it like any other text.
 */
export function PreviewTabBar({ title, className }: PreviewTabBarProps) {
  const text = title?.trim() ?? '';
  return (
    <div
      role="group"
      aria-label="미리보기 탭 제목"
      className={className ? `pi-ex-preview-tab ${className}` : 'pi-ex-preview-tab'}
    >
      <span className="pi-ex-preview-tab__tab" {...(text === '' ? {} : { title: text })}>
        <FileText size={14} aria-hidden="true" className="pi-ex-preview-tab__icon" />
        {text === '' ? (
          <span className="pi-ex-preview-tab__text" data-empty="">
            제목 없음
          </span>
        ) : (
          // `dir="auto"` isolates the learner's text, so bidi control characters in a title cannot
          // reorder what is around it.
          <span className="pi-ex-preview-tab__text" dir="auto">
            {text}
          </span>
        )}
      </span>
    </div>
  );
}
