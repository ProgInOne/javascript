/**
 * Keyboard shortcut hint (`⌘` `Enter`). Hidden from assistive tech: the shortcut is announced
 * through `aria-keyshortcuts` on the control instead, so the button name stays short.
 */
export function Kbd({ keys }: { keys: readonly string[] }) {
  return (
    <span className="pi-ex-kbd" aria-hidden="true">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}
