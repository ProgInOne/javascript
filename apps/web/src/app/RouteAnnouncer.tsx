import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/**
 * After a client-side navigation has rendered (lazy route chunks included), moves focus to the
 * new page's h1 and announces its title (docs/design/ui-ux.md#포커스-관리). The initial page
 * load keeps the browser's default focus.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const [message, setMessage] = useState('');

  useEffect(
    () =>
      router.subscribe('onRendered', (event) => {
        if (!event.fromLocation || event.fromLocation.pathname === event.toLocation.pathname)
          return;
        const h1 = document.querySelector<HTMLElement>('main h1');
        if (!h1) return;
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        h1.focus();
        const title = h1.textContent;
        setMessage(title);
        document.title = `${title} · ProgInOne`;
      }),
    [router],
  );

  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}
