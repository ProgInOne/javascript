import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/**
 * On route change, moves focus to the new page's h1 and announces its title
 * (docs/design/ui-ux.md#포커스-관리). The first render keeps the browser's default focus.
 */
export function RouteAnnouncer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [message, setMessage] = useState('');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const h1 = document.querySelector<HTMLElement>('main h1');
      if (!h1) return;
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.focus();
      setMessage(h1.textContent);
      document.title = `${h1.textContent} · ProgInOne`;
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {message}
    </div>
  );
}
