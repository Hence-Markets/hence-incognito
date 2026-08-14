// Hence brand mark — three dots in a triangle, matching the canonical hence-app
// Logo.tsx / favicon.svg (top-center + two below). Uses currentColor so it adapts to context.
export function HenceLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <circle cx="16" cy="10.3" r="2.5" fill="currentColor" />
      <circle cx="11" cy="18.8" r="2.5" fill="currentColor" />
      <circle cx="21" cy="18.8" r="2.5" fill="currentColor" />
    </svg>
  );
}

// String form for places that build markup as HTML (dangerouslySetInnerHTML).
export const henceMarkSvg = (size = 20) =>
  `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><circle cx="16" cy="10.3" r="2.5" fill="currentColor"/><circle cx="11" cy="18.8" r="2.5" fill="currentColor"/><circle cx="21" cy="18.8" r="2.5" fill="currentColor"/></svg>`;
