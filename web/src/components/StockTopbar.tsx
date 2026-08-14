import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { getTicker } from '../lib/data.js';
import { toast, fmtPct, cls } from '../lib/ui.js';
import { isAssetSaved, toggleAssetSave } from '../lib/stash';
// @ts-ignore — JS module
import { coinFor } from '../lib/market.js';
// @ts-ignore — JS module
import * as market from '../lib/market.js';

const TABS = ['Chart', 'Statistics', 'Analyst', 'Earnings', 'Insider', 'Financials', 'Peers', 'Signals'];

// React port of ui.js stockTopbar().
// `tabs` gates the in-topbar tab nav: the new single-scroll asset page (no :tab) passes
// tabs={false} so it shows no tabs; the "All X" takeover pages (/stock/:sym/:tab) keep them.
export function StockTopbar({ sym, tab, tabs = true }: { sym: string; tab?: string; tabs?: boolean }) {
  const t = getTicker(sym);
  const active = (tab || 'chart').toLowerCase();
  // the bookmark fills when the asset is saved, and toggles save/unsave (Fey asset chrome)
  const [saved, setSaved] = useState(() => isAssetSaved(sym));
  useEffect(() => {
    setSaved(isAssetSaved(sym));
    const on = () => setSaved(isAssetSaved(sym));
    window.addEventListener('hence:stash', on);
    return () => window.removeEventListener('hence:stash', on);
  }, [sym]);
  const onBookmark = () => {
    const now = toggleAssetSave(sym, t.name || sym);
    setSaved(now);
    toast(now ? `${sym} saved to your list.` : `${sym} removed from your list.`, { ticker: sym });
  };
  return (
    <header className="topbar">
      <div className="topbar__l">
        <a className="icon-btn" href="#/"><Icon name="back" size={18} /></a>
        <Logo sym={sym} size={26} />
        {/* collision aliases ('ALT.US' = Altimmune) show the bare ticker + exchange ("ALT · NASDAQ")
            so the hero never leaks the internal .US disambiguator */}
        <div className="topbar__id">
          <span className="topbar__tk">{market.isCollisionAlias(sym) && (t as any).exchange ? `${market.displaySym(sym)} · ${(t as any).exchange}` : market.displaySym(sym)}</span>
          <span className="topbar__nm">{t.name}</span>
        </div>
        {/* only a REAL live quote — synthetic stubs (non-universe symbols) must not render a
            fabricated price as if it were live */}
        {t.price != null && (t as any).real ? (
          <span className="topbar__quote">
            <b>{market.fmtPrice(t.price)}</b>
            <span className={cls(t.chgPct)}>{fmtPct(t.chgPct)}</span>
          </span>
        ) : null}
      </div>
      {tabs && (
        <nav className="topbar__tabs">
          {TABS.map((x) => <a key={x} className={x.toLowerCase() === active ? 'on' : ''} href={`#/stock/${sym}/${x.toLowerCase()}`}>{x}</a>)}
        </nav>
      )}
      <div className="topbar__r">
        {(() => {
          // obvious trade CTA — only when the asset actually has a venue (native or xyz perp)
          const coin = coinFor(sym);
          const tradeable = (coin && coin !== sym) || t.world === 'crypto';
          return tradeable ? <a className="btn-trade" href={`#/terminal/${sym}`}><Icon name="candles" size={14} /> Trade</a> : null;
        })()}
        <a className="btn-ghost" href={`#/analysis/${sym}`}><Icon name="analyze" size={15} /> Analyze</a>
        <button className={'icon-btn' + (saved ? ' on' : '')} onClick={onBookmark} aria-pressed={saved} title={saved ? 'Saved' : 'Save'}><Icon name={saved ? 'bookmarkFill' : 'bookmark'} size={16} /></button>
      </div>
    </header>
  );
}
