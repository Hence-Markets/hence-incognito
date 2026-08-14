import type { CSSProperties, ReactNode } from 'react';

/* =========================================================================
   Loading — the app's shared loading vocabulary (styles in styles/loading.css,
   imported globally in main.tsx so the raw classes also work in vanilla markup).

   Pick by scenario:
   • <HenceSpinner/>  — the ∴ brand spinner. First-load / button / inline waits.
   • <PanelLoader/>   — centred spinner + label for a whole empty panel.
   • <Skeleton/> / <SkeletonText/> — shimmer placeholders sized to real content,
     so a fast shell never paints 0 / — before the data lands.
   • <RefreshDot/>    — tiny ∴ beside cached data that's being revalidated.
   ========================================================================= */

// ∴ three-dot "therefore" mark. Centroid is (12,12) so it spins about its centre.
export function HenceSpinner({ size = 22, variant = 'spin', className = '' }:
  { size?: number; variant?: 'spin' | 'pulse'; className?: string }) {
  return (
    <svg className={`hence-load hence-load--${variant} ${className}`} width={size} height={size}
      viewBox="0 0 24 24" role="status" aria-label="Loading" fill="currentColor">
      <g className="hence-load__g">
        <circle cx="12" cy="6" r="2.4" />
        <circle cx="8" cy="15" r="2.4" />
        <circle cx="16" cy="15" r="2.4" />
      </g>
    </svg>
  );
}

// Centred loader for a whole panel/section with no data yet on first load.
export function PanelLoader({ label, size = 30, fill = false, variant = 'spin', className = '' }:
  { label?: ReactNode; size?: number; fill?: boolean; variant?: 'spin' | 'pulse'; className?: string }) {
  return (
    <div className={`hence-panel-load${fill ? ' hence-panel-load--fill' : ''} ${className}`}>
      <HenceSpinner size={size} variant={variant} />
      {label ? <span className="hence-panel-load__l">{label}</span> : null}
    </div>
  );
}

// Shimmer block sized to the content it stands in for.
export function Skeleton({ w = '100%', h = 12, r = 6, className = '', style }:
  { w?: number | string; h?: number | string; r?: number; className?: string; style?: CSSProperties }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// N shimmer text lines (last one short, like a real paragraph tail).
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <span className={`skeleton-text ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton" style={{ height: 11, borderRadius: 5, width: i === lines - 1 ? '62%' : '100%' }} />
      ))}
    </span>
  );
}

// Inline shimmer pill for a single number/label cell (never flash 0 / —).
export function SkeletonValue({ w = 40, className = '' }: { w?: number | string; className?: string }) {
  return <span className={`skeleton skeleton--inline ${className}`} style={{ width: w }} />;
}

// Tiny ∴ spin beside cached data that's being revalidated.
export function RefreshDot({ size = 12, className = '' }: { size?: number; className?: string }) {
  return <HenceSpinner size={size} className={`hence-refresh ${className}`} />;
}
