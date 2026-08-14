import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { toast } from '../lib/ui.js';
import { track } from '../lib/analytics';
import { usePmTrade, pmTradeEnabled } from '../hooks/usePmTrade';
import { geoblock, type GeoblockStatus } from '../lib/polymarket-trade';
import type { ReadinessStep } from '../lib/polymarket-trade';

/* =========================================================================
   Real-Polymarket-trading UI (behind the `hence.pmtrade` flag).

   Two surfaces:
   1. Onboarding sheet — the readiness step list with per-step action buttons
      (Switch to Polygon → Wrap USDC.e → Approvals ×4 → Ready).
   2. Confirm modal — side / price / shares / total + the builder-fee disclosure,
      then places the real order.

   Rendered by Predict.tsx only when the flag is ON. The screen passes the
   chosen market token, side, price and amount; this owns the wallet dance.
   ========================================================================= */

const STEP_LABELS: Record<ReadinessStep, { title: string; sub: string; cta: string }> = {
  chain: { title: 'Switch to Polygon', sub: 'Polymarket settles on the Polygon network.', cta: 'Switch network' },
  wrap: { title: 'Wrap USDC.e → pUSD', sub: 'Convert your bridged USDC into Polymarket collateral.', cta: 'Wrap' },
  approve_pusd_exchange: { title: 'Approve pUSD (Exchange)', sub: 'Let the CTF Exchange spend your pUSD collateral.', cta: 'Approve' },
  approve_pusd_negrisk: { title: 'Approve pUSD (Neg-Risk)', sub: 'Same, for neg-risk (multi-outcome) markets.', cta: 'Approve' },
  approve_ctf_exchange: { title: 'Approve outcome tokens (Exchange)', sub: 'Let the Exchange move your position tokens.', cta: 'Approve' },
  approve_ctf_negrisk: { title: 'Approve outcome tokens (Neg-Risk)', sub: 'Same, for neg-risk markets.', cta: 'Approve' },
};

// Base plumbing steps. The `wrap` step (USDC.e → pUSD collateral) is inserted after
// `chain` only when the wallet actually holds unwrapped USDC.e (see `steps` below).
const BASE_STEPS: ReadinessStep[] = [
  'chain', 'approve_pusd_exchange', 'approve_pusd_negrisk', 'approve_ctf_exchange', 'approve_ctf_negrisk',
];
const WRAP_STEPS: ReadinessStep[] = [
  'chain', 'wrap', 'approve_pusd_exchange', 'approve_pusd_negrisk', 'approve_ctf_exchange', 'approve_ctf_negrisk',
];

type Props = {
  open: boolean;
  onClose: () => void;
  market: { tokenYes?: string; tokenNo?: string; question?: string };
  side: 'Yes' | 'No';
  price: number;       // best executable price (0–1) for market, or the limit price
  amountUsd: number;
  limit?: boolean;     // true → resting GTC limit order at `price`; false/undefined → FOK market
};

export function PmTradePanel({ open, onClose, market, side, price, amountUsd, limit }: Props) {
  const pm = usePmTrade();
  const [phase, setPhase] = useState<'onboard' | 'confirm' | 'placing' | 'done' | 'geoblocked'>('onboard');
  const [result, setResult] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoblockStatus | null>(null);

  // Region gate (belt + braces beside the screen's pre-open check): Polymarket's own
  // per-IP verdict, fetched on open. Blocked → an honest notice instead of onboarding.
  useEffect(() => {
    if (!open) return;
    geoblock().then((g) => { if (g) { setGeo(g); if (g.blocked) setPhase('geoblocked'); } }).catch(() => {});
  }, [open]);

  const tokenID = side === 'Yes' ? market.tokenYes : market.tokenNo;

  // On open: check readiness; jump straight to confirm if already set up.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    if (!pm.signedIn) { setPhase('onboard'); return; }
    pm.refresh();
  }, [open, pm.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !pm.readiness) return;
    // Fully plumbed (no outstanding steps, incl. wrap) → straight to confirm; else stay on the list.
    const done = pm.readiness.missing.length === 0;
    setPhase((p) => (p === 'placing' || p === 'done' || p === 'geoblocked') ? p : (done ? 'confirm' : 'onboard'));
  }, [pm.readiness, open]);

  const shares = useMemo(() => {
    const px = Math.min(0.999, Math.max(0.001, price || 0));
    return px > 0 ? amountUsd / px : 0;
  }, [price, amountUsd]);
  const payout = shares;
  const feeUsd = (amountUsd * pm.builderFeeBps) / 10_000;

  if (!open) return null;

  const cents = (p: number) => `${(p * 100).toFixed(1)}¢`;

  // ---- signed-out: prompt sign-in ----
  if (!pm.signedIn) {
    return (
      <div className="pmt-backdrop" onClick={onClose}>
        <div className="pmt-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="pmt-head"><b>Connect to trade</b><button className="pmt-x" onClick={onClose}><Icon name="close" size={16} /></button></div>
          <p className="pmt-lead">Real prediction trading places orders on Polymarket from your own wallet. Sign in to continue.</p>
          <button className="pmt-primary" onClick={() => pm.login()}><Icon name="wallet" size={15} /> Sign in / Connect wallet</button>
          <p className="pmt-fine">Your keys never leave your device. Orders settle on Polygon.</p>
        </div>
      </div>
    );
  }

  // step state helpers
  const missing = new Set(pm.readiness?.missing || []);
  const isDone = (s: ReadinessStep) => pm.readiness ? !missing.has(s) : false;
  // Surface the wrap step only when there's unwrapped USDC.e to convert into collateral.
  const usdce = pm.readiness?.usdceBalance ?? 0;
  const steps = usdce > 0.01 ? WRAP_STEPS : BASE_STEPS;
  // Ready to trade = every outstanding step cleared (wrap included), not just the approvals.
  const fullyReady = !!pm.readiness && pm.readiness.missing.length === 0;

  const runOrder = async () => {
    if (!tokenID) { toast('This market has no tradable token.', { icon: 'alert' }); return; }
    // Collateral floor: never submit an order the wallet can't back with wrapped pUSD — the
    // readiness plumbing (chain + approvals) can be complete while the wallet is unfunded or
    // still holds only unwrapped USDC.e. Clear message beats an opaque CLOB rejection.
    if (pm.readiness && pm.readiness.pusdBalance + 1e-6 < amountUsd) {
      const hint = pm.readiness.usdceBalance > 0.01 ? 'Wrap your USDC.e into pUSD first.' : 'Deposit USDC to fund this order.';
      toast(`Not enough collateral — ${pm.readiness.pusdBalance.toFixed(2)} pUSD for a $${amountUsd.toFixed(2)} order. ${hint}`, { icon: 'card', duration: 4000 });
      return;
    }
    setPhase('placing');
    const r = await pm.place(tokenID, amountUsd, limit ? price : undefined);
    if (r.ok === true) {
      // volume + estimated Hence fee (PM builder fee, bps of notional) for the revenue dash
      track('trade_submitted', {
        coin: market.question?.slice(0, 60), side, status: r.status || 'submitted',
        usd: amountUsd, venue: 'polymarket', market: 'prediction',
        builder_attached: !!r.builderAttributed,
        hence_fee_usd: r.builderAttributed ? amountUsd * (pm.builderFeeBps || 0) / 10000 : 0,
      });
      setResult(`${limit ? 'Limit order resting' : 'Order placed'}${r.builderAttributed ? '' : ' (no builder fee)'} — ${r.status || 'submitted'}.`);
      setPhase('done');
      toast(`${limit ? 'Limit ' : ''}Buy ${side} · ${cents(price)}`, { icon: 'check' });
      return;
    }
    setResult(r.error);
    setPhase('confirm');
    const icon = r.code === 'GEO_BLOCKED' ? 'alert' : r.code === 'NO_GAS' ? 'card' : 'alert';
    toast(r.error, { icon, duration: 4000 });
  };

  return (
    <div className="pmt-backdrop" onClick={onClose}>
      <div className="pmt-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pmt-head">
          <b>{phase === 'geoblocked' ? 'Not available in your region' : phase === 'confirm' || phase === 'done' ? 'Confirm order' : 'Set up real trading'}</b>
          <button className="pmt-x" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        {/* ---------- onboarding step list ---------- */}
        {phase === 'geoblocked' && (
          <>
            <p className="pmt-lead">
              Polymarket's international exchange doesn't accept orders from your current location
              {geo?.country ? <> (<b>{geo.country}</b>)</> : null} — this includes the US and several
              other jurisdictions, and orders from here would be rejected at the venue. Markets,
              books and positions stay fully viewable in Hence.
            </p>
            <button className="pmt-primary" onClick={onClose}>Got it</button>
          </>
        )}
        {phase === 'onboard' && (
          <>
            <p className="pmt-lead">A few one-time approvals let Hence place orders from your wallet on Polymarket. You confirm each in your wallet.</p>
            {pm.checking && !pm.readiness ? <div className="pmt-checking"><span className="spinner" /> Checking your account…</div> : null}
            <ol className="pmt-steps">
              {steps.map((s) => {
                const done = isDone(s);
                const busy = pm.busyStep === s;
                const meta = STEP_LABELS[s];
                // the wrap step converts the whole unwrapped USDC.e balance into pUSD collateral
                const sub = s === 'wrap' && usdce > 0.01 ? `Convert ${usdce.toFixed(2)} USDC.e into pUSD collateral.` : meta.sub;
                return (
                  <li key={s} className={`pmt-step ${done ? 'done' : ''}`}>
                    <span className="pmt-step-dot">{done ? <Icon name="check" size={13} /> : null}</span>
                    <div className="pmt-step-body">
                      <div className="pmt-step-title">{meta.title}</div>
                      <div className="pmt-step-sub">{sub}</div>
                    </div>
                    {done
                      ? <span className="pmt-step-ok">Done</span>
                      : <button className="pmt-step-btn" disabled={!!pm.busyStep} onClick={() => pm.doStep(s, s === 'wrap' ? usdce : 0)}>{busy ? <span className="spinner" /> : meta.cta}</button>}
                  </li>
                );
              })}
            </ol>
            {pm.error ? <p className="pmt-err">{pm.error}</p> : null}
            <button className="pmt-primary" disabled={!fullyReady} onClick={() => setPhase('confirm')}>
              {fullyReady ? 'Continue to order' : 'Complete the steps above'}
            </button>
            <p className="pmt-fine">Balance: {pm.readiness ? `${pm.readiness.pusdBalance.toFixed(2)} pUSD` : '—'}{pm.readiness && pm.readiness.usdceBalance > 0.01 ? ` · ${pm.readiness.usdceBalance.toFixed(2)} USDC.e unwrapped` : ''}</p>
          </>
        )}

        {/* ---------- confirm ---------- */}
        {(phase === 'confirm' || phase === 'placing') && (
          <>
            <div className="pmt-confirm-q">{market.question}</div>
            <div className="pmt-rows">
              <div><span>Side</span><b className={side === 'Yes' ? 'up' : 'down'}>Buy {side}</b></div>
              <div><span>{limit ? 'Limit price' : 'Price'}</span><b>{cents(price)}{limit ? ' · GTC' : ''}</b></div>
              <div><span>Amount</span><b>${amountUsd.toFixed(2)}</b></div>
              <div><span>Est. shares</span><b>{shares.toFixed(2)}</b></div>
              <div><span>Payout if {side}</span><b className="up">${payout.toFixed(2)}</b></div>
            </div>
            {pm.builderFeeBps > 0
              ? <p className="pmt-fee">Total includes a Hence builder fee of {pm.builderFeeBps} bps (≈ ${feeUsd.toFixed(2)}).</p>
              : <p className="pmt-fee">No Hence builder fee on this order.</p>}
            {result && phase === 'confirm' ? <p className="pmt-err">{result}</p> : null}
            <button className="pmt-primary" disabled={phase === 'placing'} onClick={runOrder}>
              {phase === 'placing' ? <><span className="spinner" /> Placing order…</> : <>Place order · ${amountUsd.toFixed(2)}</>}
            </button>
            <button className="pmt-ghost" disabled={phase === 'placing'} onClick={() => setPhase('onboard')}>Back to setup</button>
          </>
        )}

        {/* ---------- done ---------- */}
        {phase === 'done' && (
          <div className="pmt-done">
            <span className="pmt-done-ic"><Icon name="check" size={22} /></span>
            <b>Order submitted</b>
            <p>{result}</p>
            <button className="pmt-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export so Predict can gate its submit path without importing the hook file too.
export { pmTradeEnabled };
