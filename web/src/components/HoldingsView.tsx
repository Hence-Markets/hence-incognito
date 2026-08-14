/* =========================================================
   HoldingsView — the REAL per-user holdings tab, shared by the watchlist drawer
   AND the Portfolio screen. Renders live Hyperliquid positions for the signed-in
   wallet (via useHlAccount, keyed only off useAuth().address). No wallet → a connect empty state that
   dispatches `hence:accounts` (same affordance the Terminal uses), NOT a fake
   Plaid modal.
   ========================================================= */
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Skeleton } from './Loading';
import { useAuth } from '../hooks/useAuth';
import { useHlAccount } from '../hooks/useHlAccount';
import { getTicker } from '../lib/data.js';
import { fmtPrice, fmtUsd } from '../lib/market.js';

function connectAccounts() {
  try { window.dispatchEvent(new CustomEvent('hence:accounts')); } catch { /* noop */ }
}

export function HoldingsView({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  // Never substitute a locally supplied address for the authenticated wallet.
  const addr = auth.address || undefined;
  const hl = useHlAccount(addr);

  // no wallet / not signed in → connect empty state
  if (!hl.connected) {
    return (
      <div className={'hv-empty' + (compact ? ' hv-empty--compact' : '')}>
        <span className="hv-empty-ic"><Icon name="wallet" size={compact ? 22 : 28} /></span>
        <h3>Connect your portfolio</h3>
        <p>Link your Hyperliquid wallet to see your live positions, balances and PnL here.</p>
        <button className="hv-connect" onClick={connectAccounts}>Connect</button>
      </div>
    );
  }

  if (hl.unavailable) {
    return (
      <div className={'hv-empty' + (compact ? ' hv-empty--compact' : '')}>
        <span className="hv-empty-ic"><Icon name="alert" size={compact ? 22 : 28} /></span>
        <h3>Portfolio data unavailable</h3>
        <p>Hence could not verify your current Hyperliquid account snapshot. Please retry shortly.</p>
      </div>
    );
  }

  const upnl = hl.positions.reduce((s, p) => s + (p.uPnl || 0), 0);
  const upnlUp = upnl >= 0;

  return (
    <div className={'hv' + (compact ? ' hv--compact' : '')}>
      <div className="hv-summary">
        <div className="hv-sum-main">
          <span className="hv-sum-cap">Account value</span>
          <b className="hv-sum-val">{hl.loaded ? fmtUsd(hl.accountValue) : <Skeleton w={120} h={compact ? 20 : 26} r={6} />}</b>
        </div>
        <div className="hv-sum-side">
          <span className="hv-sum-cap">Unrealized PnL</span>
          <b className={'hv-sum-pnl ' + (upnlUp ? 'up' : 'down')}>{hl.loaded ? `${upnlUp ? '+' : ''}${fmtUsd(upnl)}` : <Skeleton w={70} h={14} r={5} />}</b>
        </div>
      </div>

      {!hl.loaded ? (
        <div className="hv-rows">
          {!compact && <div className="hv-head"><span>Market</span><span>Side · Size</span><span>Value</span><span>uPnL</span></div>}
          {Array.from({ length: 3 }, (_, i) => (
            <div className="hv-row" key={i} style={{ pointerEvents: 'none' }}>
              <span className="hv-mkt"><Skeleton w={compact ? 22 : 24} h={compact ? 22 : 24} r={7} /><span className="hv-mkt-t"><Skeleton w={46} h={12} /></span></span>
              <span className="hv-side"><Skeleton w={80} h={12} /></span>
              <span className="hv-val"><Skeleton w={54} h={12} /></span>
              <span className="hv-pnl"><Skeleton w={54} h={12} /></span>
            </div>
          ))}
        </div>
      ) : hl.loaded && !hl.positions.length ? (
        <div className={'hv-empty' + (compact ? ' hv-empty--compact' : '')}>
          <span className="hv-empty-ic"><Icon name="candles" size={compact ? 22 : 26} /></span>
          <h3>No open positions</h3>
          <p>Your Hyperliquid perp positions will appear here once you open a trade.</p>
        </div>
      ) : (
        <div className="hv-rows">
          {!compact && (
            <div className="hv-head"><span>Market</span><span>Side · Size</span><span>Value</span><span>uPnL</span></div>
          )}
          {hl.positions.map((p) => {
            // positionValue comes from the same live clearinghouse snapshot; deriving
            // mark from it avoids ever substituting a bundled ticker seed here.
            const mk = p.sz > 0 && p.positionValue > 0 ? p.positionValue / p.sz : p.entryPx;
            const up = p.uPnl >= 0;
            return (
              <a className="hv-row" href={`#/terminal/${p.coin}`} key={p.coin}>
                <span className="hv-mkt"><Logo sym={p.coin} size={compact ? 22 : 24} /><span className="hv-mkt-t"><b>{p.coin}</b>{!compact && <small>{fmtPrice(mk)}</small>}</span></span>
                <span className={'hv-side ' + (p.side === 'Long' ? 'up' : 'down')}>{p.side} · {p.sz}{p.leverage ? ` · ${p.leverage}×` : ''}</span>
                <span className="hv-val">{fmtUsd(p.positionValue)}</span>
                <span className={'hv-pnl ' + (up ? 'up' : 'down')}>{up ? '+' : ''}{fmtUsd(p.uPnl)}{!compact ? <small>{(p.roe * 100).toFixed(1)}%</small> : null}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
