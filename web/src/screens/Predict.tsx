import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Loading';
// @ts-ignore — JS module
import * as poly from '../lib/polymarket.js';
import '../styles/predict-browse.css';

/* =========================================================================
   Predict — the prediction-markets BROWSE landing (#/predict). Top Polymarket
   markets by 24h volume; click → the prediction terminal (#/terminal/m/:id).
   Gives the AI + nav hub a real destination for "prediction markets".
   ========================================================================= */

const fmtVol = (v: number) => {
  if (!v) return '—';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
};
const pct = (p: number) => (p == null || isNaN(p) ? '—' : Math.round(p * 100) + '%');

export default function Predict() {
  const [mkts, setMkts] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    poly.markets(24).then((m: any[]) => { if (alive) setMkts(m); }).catch(() => { if (alive) setMkts([]); });
    return () => { alive = false; };
  }, []);

  return (
    <Shell dockActive="trade">
      <div className="pdb">
        <header className="pdb__head">
          <a className="icon-btn" aria-label="Back" href="#/"><Icon name="back" size={18} /></a>
          <div>
            <h1>Prediction markets</h1>
            <p>Live event odds via Polymarket — pick a market to trade it in the terminal.</p>
          </div>
        </header>

        {mkts === null ? (
          <div className="pdb__grid" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <div className="pdb__card" key={i}>
                <div className="pdb__card-top"><Skeleton w={30} h={30} r={8} /><Skeleton w={44} h={22} r={11} /></div>
                <Skeleton w="90%" h={13} r={5} /><Skeleton w="65%" h={13} r={5} />
                <div className="pdb__card-foot"><Skeleton w={70} h={11} r={4} /></div>
              </div>
            ))}
          </div>
        ) : mkts.length === 0 ? (
          <div className="pdb__empty">Prediction markets are unreachable right now — try again in a moment.</div>
        ) : (
          <div className="pdb__grid">
            {mkts.map((m: any) => {
              const up = (m.yes ?? 0) >= 0.5;
              return (
                <a className="pdb__card" key={m.id} href={`#/terminal/m/${m.id}`}>
                  <div className="pdb__card-top">
                    {m.icon ? <img className="pdb__ic" src={m.icon} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span className="pdb__ic pdb__ic--ph">◆</span>}
                    <span className={'pdb__yes ' + (up ? 'up' : 'down')}>{pct(m.yes)} yes</span>
                  </div>
                  <div className="pdb__q">{m.question}</div>
                  <div className="pdb__card-foot">
                    <span>{fmtVol(m.volume24hr)} · 24h</span>
                    <span className="pdb__go">Trade <Icon name="arrowRight" size={12} /></span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
