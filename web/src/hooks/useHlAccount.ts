import { useCallback, useEffect, useRef, useState } from 'react';
import { info } from '../lib/hydromancer.js';
import { spotUsdcState, accountAbstraction, isUnifiedMode, type HlAbstractionMode } from '../lib/hyperliquid-exchange';

export type HlPosition = {
  coin: string; side: 'Long' | 'Short'; sz: number; entryPx: number;
  positionValue: number; uPnl: number; roe: number; leverage: number; liqPx: number | null; marginUsed: number;
};
export type HlOrder = { coin: string; side: 'Buy' | 'Sell'; sz: number; limitPx: number; oid: number };
export type HlTrigger = { coin: string; oid: number; side: 'Buy' | 'Sell'; sz: number; triggerPx: number; tpsl: 'tp' | 'sl'; orderType: string };

// Live Hyperliquid account state (balances/positions/open orders) for an address.
// Polls every 8s for the signed-in user, 45s for a read-only view. Reads via our /api/info
// proxy (clearinghouseState + openOrders).
/* `readOnly` marks a view of an account that is NOT the signed-in user's — someone else's
   public profile. It changes the economics, not the data: reads go through the server's
   long-TTL cache (?cached=1) and poll slowly, so N strangers looking at one address collapse
   to roughly one upstream read per window instead of 6 every 8 seconds each. Live-trading
   surfaces (terminal, own portfolio) leave it off and keep tick-level freshness. */
export function useHlAccount(address?: string, opts: { readOnly?: boolean } = {}) {
  const readOnly = !!opts.readOnly;
  const pollMs = readOnly ? 45_000 : 8_000;
  const [raw, setRaw] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [trigRows, setTrigRows] = useState<any[]>([]);
  const [spot, setSpot] = useState<{ total: number; hold: number; available: number } | null>(null);
  const [mode, setMode] = useState<HlAbstractionMode | null>(null);
  const [loadedAddress, setLoadedAddress] = useState<string | null>(null);
  const [failedAddress, setFailedAddress] = useState<string | null>(null);
  const currentAddress = useRef(address);
  currentAddress.current = address;
  const loadedRef = useRef<string | null>(null);   // closure-safe mirror of loadedAddress

  const refresh = useCallback(async () => {
    if (!address) {
      setRaw(null); setOrders([]); setTrigRows([]); setSpot(null); setMode(null); setLoadedAddress(null); setFailedAddress(null);
      loadedRef.current = null;
      return;
    }
    const requestedAddress = address;
    // clearinghouse + openOrders via the /api/info proxy; spot + abstraction mode are keyless
    // direct HL reads (not in the proxy allowlist). Under unified/portfolio-margin accounts the
    // tradeable USDC lives in the spot state, so we need all four to paint a correct balance.
    // HIP-3 (trade.xyz) positions/orders live on a PER-DEX clearinghouse — query it too and
    // merge, or xyz fills are invisible (found live: a GOLD position showed on HL, not here).
    const [s, sx, oo, oox, sp, md, fo, fox] = await Promise.all([
      info({ type: 'clearinghouseState', user: address }, { cached: readOnly }).catch(() => null),
      info({ type: 'clearinghouseState', user: address, dex: 'xyz' }, { cached: readOnly }).catch(() => null),
      info({ type: 'openOrders', user: address }, { cached: readOnly }).catch(() => null),
      info({ type: 'openOrders', user: address, dex: 'xyz' }, { cached: readOnly }).catch(() => null),
      spotUsdcState(address).catch(() => null),
      accountAbstraction(address).catch(() => null),
      // TP/SL triggers only surface via frontendOpenOrders — best-effort, never
      // allowed to regress the plain openOrders path if the proxy/mirror lacks it
      info({ type: 'frontendOpenOrders', user: address }, { cached: readOnly }).catch(() => null),
      info({ type: 'frontendOpenOrders', user: address, dex: 'xyz' }, { cached: readOnly }).catch(() => null),
    ]);
    // A response from wallet A must never paint after logout or after wallet B
    // becomes active. The render-time address check below also prevents a one-frame
    // flash of A's data before this async request for B completes.
    if (currentAddress.current !== requestedAddress) return;
    const stateOk = !!(s && typeof s === 'object' && !Array.isArray(s) && s.marginSummary);
    if (!stateOk) {
      // Stale-while-retrying: a single failed read (network blip, brief 429) must not
      // blank a panel we already painted — keep the last good snapshot for this address
      // and let the 8s poll self-heal. Only a never-loaded address shows the error state.
      setFailedAddress(requestedAddress);
      if (loadedRef.current !== requestedAddress) {
        setRaw(null); setOrders([]); setTrigRows([]); setSpot(null); setMode(null); setLoadedAddress(null);
      }
      return;
    }
    // merge the xyz dex's positions into the native snapshot (best-effort — a missing xyz
    // response must never fail the whole account read)
    const merged = { ...s, assetPositions: [...(s.assetPositions || [])] };
    if (sx && typeof sx === 'object' && Array.isArray(sx.assetPositions)) {
      merged.assetPositions.push(...sx.assetPositions);
    }
    setRaw(merged);
    setOrders([...(Array.isArray(oo) ? oo : []), ...(Array.isArray(oox) ? oox : [])]);
    setTrigRows([...(Array.isArray(fo) ? fo : []), ...(Array.isArray(fox) ? fox : [])].filter((o: any) => o && o.isTrigger));
    setSpot(sp);
    setMode(md);
    setLoadedAddress(requestedAddress);
    loadedRef.current = requestedAddress;
    setFailedAddress(null);
  }, [address, readOnly]);

  useEffect(() => {
    refresh();
    if (!address) return;
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, address, pollMs]);

  const isCurrent = !!address && loadedAddress === address;
  const currentRaw = isCurrent ? raw : null;
  const currentOrders = isCurrent ? orders : [];
  const currentSpot = isCurrent ? spot : null;
  const currentMode = isCurrent ? mode : null;
  const unified = isUnifiedMode(currentMode);

  const positions: HlPosition[] = (currentRaw?.assetPositions || []).map((ap: any) => {
    const p = ap.position; const szi = +p.szi;
    return {
      coin: p.coin, side: szi >= 0 ? 'Long' : 'Short', sz: Math.abs(szi),
      entryPx: +p.entryPx, positionValue: +p.positionValue, uPnl: +p.unrealizedPnl,
      roe: p.returnOnEquity != null ? +p.returnOnEquity : 0, leverage: p.leverage?.value || 0,
      liqPx: p.liquidationPx != null ? +p.liquidationPx : null, marginUsed: +p.marginUsed,
    };
  });

  const parsedOrders: HlOrder[] = currentOrders.map((o: any) => ({
    coin: o.coin, side: o.side === 'B' ? 'Buy' : 'Sell', sz: +o.sz, limitPx: +o.limitPx, oid: o.oid,
  }));

  // TP/SL trigger orders (frontendOpenOrders rows with isTrigger). sz 0 = full-position
  // (positionTpsl grouping keeps it pegged to the position size on HL's side).
  const triggers: HlTrigger[] = (isCurrent ? trigRows : []).map((o: any) => ({
    coin: o.coin, oid: o.oid, side: o.side === 'B' ? 'Buy' : 'Sell', sz: +o.sz,
    triggerPx: +o.triggerPx, orderType: String(o.orderType || ''),
    tpsl: /take ?profit/i.test(String(o.orderType || '')) ? 'tp' : 'sl',
  }));

  // Balance model, mode-aware. Standard accounts keep separate perp collateral (read from the
  // perp marginSummary). Unified / portfolio-margin accounts collateralize perps with the spot
  // USDC balance — the perp marginSummary reads all-zero — so buying power, equity and
  // withdrawable all come from the spot state (+ open-position uPnL for equity).
  const ms = currentRaw?.marginSummary;
  let accountValue: number, marginUsed: number, totalNtlPos: number, available: number, withdrawable: number;
  if (unified && currentSpot) {
    const uPnl = positions.reduce((a, p) => a + p.uPnl, 0);
    const posMargin = positions.reduce((a, p) => a + p.marginUsed, 0);
    totalNtlPos = positions.reduce((a, p) => a + p.positionValue, 0);
    marginUsed = currentSpot.hold || posMargin;
    accountValue = currentSpot.total + uPnl;      // equity = unified USDC + unrealized PnL
    available = currentSpot.available;            // free collateral after maintenance margin
    withdrawable = currentSpot.available;         // withdraw pulls from the unified balance
  } else {
    accountValue = ms ? +ms.accountValue : 0;
    marginUsed = ms ? +ms.totalMarginUsed : 0;
    totalNtlPos = ms ? +ms.totalNtlPos : 0;
    available = Math.max(0, accountValue - marginUsed);
    withdrawable = currentRaw ? +currentRaw.withdrawable : 0;
  }

  return {
    connected: !!address,
    loaded: isCurrent,
    // "unavailable" = nothing to paint (never loaded AND the read failed). While stale
    // data is held during a transient failure, loaded stays true and this stays false.
    unavailable: !!address && failedAddress === address && !isCurrent,
    mode: currentMode, unified,
    accountValue, marginUsed, totalNtlPos, available, withdrawable,
    positions, orders: parsedOrders, triggers, refresh,
  };
}
