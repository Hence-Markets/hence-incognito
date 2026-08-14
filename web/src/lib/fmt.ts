import * as market from './market.js';

export const fmtPx = (v: number) => market.fmtPrice(v);
export const fmtUsd = (v: number) => market.fmtUsd(v);
export const pairLabel = (sym: string) => `${sym}:PERP-USDC`;

export const compact = (v: number) => {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return '' + (+v).toFixed(2);
};

export const fmtBookPx = (v: number) => (v == null || isNaN(v) ? '—' : fmtPx(v).replace('$', ''));
export const fmtSz = (v: number) => (v >= 1000 ? compact(v) : v >= 1 ? v.toFixed(2) : v.toFixed(v < 0.01 ? 5 : 3));
export const fmtPct = (p: number) => `${(p || 0) >= 0 ? '+' : ''}${(p || 0).toFixed(2)}%`;

export type Level = { px: number; sz: number };
export type Book = { bids: Level[]; asks: Level[] };
