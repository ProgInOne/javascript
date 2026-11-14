import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const WAIT_MS = 5000;

/**
 * After a client-side navigation has rendered, moves focus to the new page's h1 and announces its
 * title (docs/design/ui-ux.md#포커스-관리). Pages that load data render their h1 later, so this
 * waits (up to 5s) for it to appear. The initial page load keeps the browser's default focus.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancel: () => void = () => undefined;
    const unsubscribe = router.subscribe('onRendered', (event) => {
      if (!event.fromLocation || event.fromLocation.pathname === event.toLocation.pathname) return;
      cancel();
      const main = document.querySelector('main');
      if (!main) return;
      const focusHeading = () => {
        const h1 = main.querySelector<HTMLElement>('h1');
        if (!h1) return false;
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        h1.focus();
        const title = h1.textContent;
        setMessage(title);
        document.title = `${title} · ProgInOne`;
        return true;
      };
      if (focusHeading()) return;
      const observer = new MutationObserver(() => {
        if (focusHeading()) cancel();
      });
      observer.observe(main, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        cancel();
      }, WAIT_MS);
      cancel = () => {
        observer.disconnect();
        clearTimeout(timer);
      };
    });
    return () => {
      cancel();
      unsubscribe();
    };
  }, [router]);

  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}
