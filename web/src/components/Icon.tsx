import { icon as iconStr } from '../lib/ui.js';

// Reuses the existing icon SVG set from ui.js (returns an <svg> string).
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      style={{ display: 'inline-flex', flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: iconStr(name, size) }}
    />
  );
}
