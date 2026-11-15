import { Button, Spinner } from '@proginone/ui';
import { Info, MonitorPlay, RefreshCw } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PreviewFrameProps {
  /**
   * Where packages/runner mounts its sandboxed preview iframe (opaque origin, dedicated CSP).
   * This component never creates or runs anything itself; it only reserves and labels the space.
   */
  mountRef?: Ref<HTMLDivElement>;
  /** Alternatively, the runner-provided iframe element. */
  children?: ReactNode;
  /** `idle` before the first run (empty state), `loading` while rendering, `error` when it failed. */
  status?: PreviewStatus;
  /** Message for the `error` state (from `RunResult`, e.g. "실행 환경 오류 — 다시 실행해 주세요"). */
  errorMessage?: string;
  /**
   * Short notice about the shown document, announced politely (e.g. "미리보기에서는 링크 이동과
   * 폼 제출이 실제로 일어나지 않아요."). Cleared by the caller on the next run.
   */
  notice?: string;
  /** Re-renders the preview (새로 고침). Hidden when omitted. */
  onRefresh?: () => void;
  /** Accessible name of the region. Default "미리보기". */
  label?: string;
}

/**
 * HTML/CSS single-document preview container (PreviewFrame in ui-ux.md). Toolbar with refresh;
 * viewport switching (375/768/1280) and the element inspector are P1.
 */
export function PreviewFrame({
  mountRef,
  children,
  status = 'idle',
  errorMessage,
  notice,
  onRefresh,
  label = '미리보기',
}: PreviewFrameProps) {
  const labelId = useId();
  return (
    <section
      className="pi-ex-preview"
      aria-labelledby={labelId}
      aria-busy={status === 'loading' || undefined}
    >
      <header className="pi-ex-preview__toolbar">
        <h3 id={labelId} className="pi-ex-preview__title">
          {label}
        </h3>
        {status === 'loading' && (
          <span className="pi-ex-preview__status">
            <Spinner />
            그리는 중
          </span>
        )}
        {onRefresh && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            className="pi-ex-preview__refresh"
            onClick={onRefresh}
          >
            새로 고침
          </Button>
        )}
      </header>
      {/* Always rendered: a live region must exist before its content changes. */}
      <div role="status" className="pi-ex-preview__notices">
        {notice && (
          <p className="pi-ex-preview__notice">
            <Info size={14} aria-hidden="true" />
            {notice}
          </p>
        )}
      </div>
      <div className="pi-ex-preview__stage">
        <div ref={mountRef} className="pi-ex-preview__mount" data-status={status}>
          {children}
        </div>
        {status === 'idle' && (
          <div className="pi-ex-preview__empty">
            <MonitorPlay size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>실행하면 결과 화면이 여기에 나와요.</p>
          </div>
        )}
        {status === 'error' && (
          <div className="pi-ex-preview__empty" role="alert">
            <p>{errorMessage ?? '미리보기를 그리지 못했어요. 다시 실행해 주세요.'}</p>
          </div>
        )}
      </div>
    </section>
  );
}
