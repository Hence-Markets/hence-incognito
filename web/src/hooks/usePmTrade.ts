import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getConfig } from '../lib/config';
import * as pm from '../lib/polymarket-trade';

// Is real Polymarket trading enabled? Production requires an explicit build-time
// deployment flag; browser storage is accepted only in local development. A public
// user must not be able to unlock a real-funds execution path from DevTools.
export function pmTradeEnabled(): boolean {
  if (!import.meta.env.DEV) return import.meta.env.VITE_ENABLE_PM_TRADING === '1';
  try { return localStorage.getItem('hence.pmtrade') === '1'; } catch { return false; }
}

// Drives the real-trading onboarding + order flow for the Predict screen.
// Owns readiness state, the per-step actions, L2 auth, and placeOrder — so the
// screen stays declarative. Clears cached L2 creds on logout.
export function usePmTrade() {
  const auth = useAuth();
  const address = auth.address;
  const wallet: any = auth.wallet;
  const signedIn = !!(auth.authenticated && wallet && address);

  const [readiness, setReadiness] = useState<pm.Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyStep, setBusyStep] = useState<pm.ReadinessStep | null>(null);
  const [builderCode, setBuilderCode] = useState('');
  const [builderFeeBps, setBuilderFeeBps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Pull the builder code/fee from /api/config once (defensive: absent = none).
  useEffect(() => {
    let alive = true;
    getConfig().then((c) => { if (alive) { setBuilderCode(c.pmBuilderCode || ''); setBuilderFeeBps(c.pmBuilderFeeBps || 0); } }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Clear the per-user L2 creds when the user signs out.
  useEffect(() => {
    if (!auth.authenticated) pm.clearCreds();
  }, [auth.authenticated]);

  const refresh = useCallback(async () => {
    if (!signedIn || !address) { setReadiness(null); return; }
    setChecking(true); setError(null);
    try {
      const r = await pm.readiness(wallet, address);
      setReadiness(r);
    } catch (e: any) {
      setError(e?.message || 'Could not read your Polygon account.');
    } finally {
      setChecking(false);
    }
  }, [signedIn, address, wallet]);

  // Run one onboarding step (chain switch / wrap / an approval), then re-check.
  const doStep = useCallback(async (step: pm.ReadinessStep, wrapAmount = 0) => {
    if (!signedIn || !address) return;
    setBusyStep(step); setError(null);
    try {
      await pm.runStep(wallet, address, step, wrapAmount);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Step failed.');
    } finally {
      setBusyStep(null);
    }
  }, [signedIn, address, wallet, refresh]);

  // Ensure L2 creds (one signature if not cached) and place a real BUY. A `limitPrice`
  // (0–1) routes to a resting GTC limit order; omit it for an immediate FOK market buy.
  const place = useCallback(async (tokenID: string, amountUsd: number, limitPrice?: number): Promise<pm.PlaceResult> => {
    if (!signedIn || !address) return { ok: false, error: 'Sign in first.', code: 'NO_WALLET' };
    setError(null);
    try {
      const creds = await pm.ensureAuth(wallet, address);
      return limitPrice != null
        ? await pm.placeLimitOrder(wallet, address, creds, tokenID, limitPrice, amountUsd, builderCode || undefined)
        : await pm.placeOrder(wallet, address, creds, tokenID, amountUsd, builderCode || undefined);
    } catch (e: any) {
      const code = (e?.code || 'CLOB_ERROR') as pm.PmErrorCode;
      return { ok: false, error: e?.message || 'Order failed.', code };
    }
  }, [signedIn, address, wallet, builderCode]);

  return {
    signedIn, address, checking, busyStep, readiness, error,
    builderCode, builderFeeBps,
    refresh, doStep, place,
    login: auth.login,
  };
}
