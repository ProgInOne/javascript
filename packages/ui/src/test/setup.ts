import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom gaps that Radix primitives touch.
class ResizeObserverStub {
  observe(): void {
    /* no layout in jsdom */
  }
  unobserve(): void {
    /* no layout in jsdom */
  }
  disconnect(): void {
    /* no layout in jsdom */
  }
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent in jsdom despite DOM lib types
globalThis.ResizeObserver ??= ResizeObserverStub;

const proto = Element.prototype as Partial<Element>;
proto.scrollIntoView ??= () => undefined;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;
