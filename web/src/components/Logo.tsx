import { useEffect, useState } from 'react';
import { getTicker } from '../lib/data.js';
import { assetIcon, markIconFailed } from '../lib/asset-icon.js';

// Real asset logo/icon over the colored letter/emoji badge. Walks an ordered,
// same-origin source chain on <img> error (HL CDN by full coin name → FMP / flag /
// CoinGecko fallback); if every source fails the img is dropped, revealing the
// emoji or first-letter badge underneath.
export function Logo({ sym, size = 22, kind }: { sym: string; size?: number; kind?: 'equity' }) {
  const t = getTicker(sym);
  const c = t ? t.color : '#3f3f46';
  const { srcs: base, emoji, cat } = assetIcon(sym, { kind });

  const [srcs, setSrcs] = useState<string[]>(base);
  const [i, setI] = useState(0);

  // re-resolve when the symbol changes, or when the category/coin maps load
  useEffect(() => {
    const apply = () => { const r = assetIcon(sym, { kind }); setSrcs(r.srcs); setI(0); };
    apply();
    window.addEventListener('hence:icons', apply);
    return () => window.removeEventListener('hence:icons', apply);
  }, [sym, kind]);

  const label = emoji || (sym || '?')[0];
  const showImg = i < srcs.length;
  return (
    <span
      className={'logo' + (cat === 'stocks' ? ' logo--eq' : '')}
      style={{ ['--lc' as any]: c, width: size, height: size, fontSize: size * (emoji ? 0.6 : 0.42) }}
    >
      {label}
      {showImg && (
        <img
          className="logo__img"
          src={srcs[i]}
          alt=""
          loading="lazy"
          decoding="async"
          // remember the 404'd URL (and, once the chain is exhausted, the whole symbol) so
          // re-renders / remounts don't re-fetch the same dead sources — caps the retry loop.
          onError={() => { markIconFailed(sym, srcs[i]); setI((n) => n + 1); }}
        />
      )}
    </span>
  );
}
