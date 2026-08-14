import { useEffect } from 'react';
import '../styles/login-error.css';

// Error / Exception screen — #/error
// Fullscreen flow screen (NO appShell / dock). Matches "Hence exception".
// Press Return / click the chip to reload back into the app.

export default function ErrorScreen() {
  const reload = () => { location.hash = '#/'; };
  const reach = (e: React.MouseEvent) => { e.preventDefault(); location.href = 'mailto:hey@hence.com'; };

  // global Return-to-refresh while this screen is mounted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') reload(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="lx-err">
      <div className="lx-err-bg"></div>
      <div className="lx-err-inner">
        <div className="lx-err-glyph">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6a4 4 0 0 1 8 0" />
            <rect x="6.5" y="7.5" width="11" height="11" rx="5.5" />
            <path d="M12 11v6M3.5 11h3M17.5 11h3M3.5 16h3M17.5 16h3M5 7l2 2M19 7l-2 2" />
          </svg>
        </div>
        <h1 className="lx-err-title">Hence exception</h1>
        <p className="lx-err-msg">Looks like you've found a short in Hence. We're on it, but feel free to <a data-reach onClick={reach}>reach out</a> directly. We usually reply within a few minutes.</p>
        <div className="lx-chip" data-chip role="button" tabIndex={0} aria-label="Refresh"
          onClick={reload}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') reload(); }}>
          <span className="lx-chip-label">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M13.5 2 6 13h4.5L9 22l8-12h-4.6L13.5 2z" /></svg> Sync Engine
          </span>
        </div>
        <div className="lx-err-foot">Press <span className="lx-keycap">return</span> to refresh
          <div className="lx-err-foot-sub">or reach out to <a className="lx-link" data-reach onClick={reach}>hey@hence.com</a></div>
        </div>
      </div>
    </div>
  );
}
