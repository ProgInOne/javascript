import { LoaderCircle } from 'lucide-react';

/** Decorative loading spinner; the owner announces the busy state (e.g. `aria-busy`). */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <LoaderCircle
      className="pi-spinner"
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  );
}
