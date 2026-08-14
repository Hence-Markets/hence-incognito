/* =========================================================
   Hence — Accounts modal (authenticated Privy wallet + connections)
   Funding addresses are rendered only from a verified, signed-in
   Privy EVM wallet. Planned external integrations remain visibly
   unavailable until their real connection handshakes are wired.
   ========================================================= */
import { icon, toast, hideToast, copyText } from '../lib/ui.js';
import * as accounts from '../lib/accounts.js';
import { FUND_CHAINS, chainById, qrDataUrl } from '../lib/funding.ts';
import { escapeHtml, stripHtml } from '../lib/safe-html.js';
import { authenticatedApiFetch } from '../lib/auth-transport.ts';
import { loadSnapshot, loadActivity, walletBalances } from '../lib/venueBalances.ts';

let overlay = null, view = 'wallet';

// Earn (the Morpho-vaults scaffold) is HIDDEN for now — the yield engine isn't switched
// on server-side and a visible-but-inert tab confused users (user call 2026-07-20).
// Flip to true to restore the rail item + view; all earn code below is kept intact.
const EARN_ENABLED = false;

/* ---- live venue balances (loaded per open + on auth change) ---- */
let snap = null, snapAddr = null, snapLoading = false;
let uwTab = 'Balances';
let activity = null, activityLoading = false;
let extBals = {};                       // external wallet address → {total, assets} | 'loading' | null

function loadSnap(force) {
  const addr = accounts.walletAddress();
  if (!addr) { snap = null; snapAddr = null; return; }
  if (snapLoading || (!force && snapAddr === addr && snap)) return;
  snapLoading = true; snapAddr = addr;
  loadSnapshot(addr).then((s) => {
    if (snapAddr === addr) snap = s;    // stale-address guard (logout / wallet switch mid-flight)
  }).catch(() => {}).finally(() => {
    snapLoading = false;
    if (overlay && view === 'wallet') render();
  });
}

function loadActivityRows() {
  const addr = accounts.walletAddress();
  if (!addr || activityLoading) return;
  activityLoading = true;
  loadActivity(addr).then((rows) => { activity = rows; }).catch(() => { activity = null; })
    .finally(() => { activityLoading = false; if (overlay && view === 'wallet') render(); });
}

const agoShort = (t) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
};
// linked external wallets (anything that isn't the Privy embedded wallet)
function externalWallets() {
  const ha = (typeof window !== 'undefined' && window.henceAuth) || null;
  if (!ha || !ha.authenticated || !Array.isArray(ha.wallets)) return [];
  return ha.wallets.filter(w => w && w.address && !String(w.type || '').startsWith('privy'));
}
function loadExtBal(addr) {
  if (extBals[addr] !== undefined) return;
  extBals[addr] = 'loading';
  walletBalances(addr).then((b) => { extBals[addr] = b; }).catch(() => { extBals[addr] = null; })
    .finally(() => { if (overlay && (view === 'all' || view === 'wallet')) render(); });   // wallet view's grand total needs it too
}

const fund = () => (typeof window !== 'undefined' && window.henceFund) || null;

const usdShort = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeColor = (value) => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : '#64748b';
const dot = (name, color, size = 20) =>
  `<span class="acct-dot" style="--c:${safeColor(color)};width:${Number(size) || 20}px;height:${Number(size) || 20}px;font-size:${Math.round((Number(size) || 20) * 0.46)}px">${escapeHtml((String(name || '?')[0] || '?').toUpperCase())}</span>`;
const trunc = (s, head = 8, tail = 8) => (s && s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '');

/* ---------------- rail ---------------- */
function railHTML() {
  const n = externalWallets().length;
  return `<aside class="acct-rail">
    <div class="acct-rail__h">Accounts</div>
    <div class="acct-rail__list">
      <button class="acct-rail__item ${view === 'wallet' ? 'on' : ''}" data-view="wallet">
        ${dot('Hence', '#f4c39a', 18)} Hence Wallet</button>
      ${EARN_ENABLED ? `<button class="acct-rail__item ${view === 'earn' ? 'on' : ''}" data-view="earn">
        ${icon('bolt', 15)} Earn</button>` : ''}
      <div class="acct-rail__cap">External accounts</div>
      <button class="acct-rail__item ${view === 'all' ? 'on' : ''}" data-view="all">
        ${icon('grid', 15)} All Accounts ${n ? `<span class="acct-rail__count">${n}</span>` : ''}</button>
    </div>
    <div class="acct-rail__foot">
      <button class="acct-connect-btn acct-connect-btn--primary" data-connect>${icon('plus', 13)} Planned connections</button>
      <button class="acct-rail__signout" data-signout>${icon('signout', 13)} Sign out</button>
    </div>
  </aside>`;
}

/* ---------------- wallet view ---------------- */
function emptyWalletHTML() {
  return `<div class="acct-empty">
    <div class="acct-empty__ic">${icon('card', 30)}</div>
    <h3>Sign in to activate your wallet</h3>
    <p>Hence only shows a funding address after Privy verifies your authenticated EVM wallet. This browser will never generate or store a deposit address for you.</p>
    <button class="acct-cta" data-sign-in>Sign in securely</button>
  </div>`;
}

const balCell = (b) => b != null ? usdShort(b) : (snapLoading ? '<span class="acct-row__pending">Syncing…</span>' : '—');

function balancesTabHTML() {
  const rows = [];
  if (snap && snap.wallet) for (const a of snap.wallet.assets) {
    rows.push({ name: a.symbol, sub: a.chain, amt: a.symbol === 'ETH' ? a.amount.toFixed(a.amount < 0.01 ? 6 : 4) + ' ETH' : null, usd: a.usd });
  }
  if (snap && snap.hyperliquid && snap.hyperliquid.total >= 0.01) {
    const h = snap.hyperliquid;
    rows.push({ name: 'USDC', sub: 'Hyperliquid' + (h.positions ? ` · ${h.positions} position${h.positions === 1 ? '' : 's'}` : ''), amt: null, usd: h.total });
  }
  if (snap && snap.polymarket) {
    for (const a of snap.polymarket.assets) rows.push({ name: a.symbol, sub: a.chain + ' · Polymarket collateral', amt: null, usd: a.usd });
    if (snap.polymarket.positionsUsd >= 0.01) rows.push({ name: 'Positions', sub: 'Polymarket', amt: null, usd: snap.polymarket.positionsUsd });
  }
  if (!rows.length) {
    return `<div class="acct-uw__empty">
      <p>${snapLoading ? 'Syncing balances across your venues…' : 'No funds yet. Add cash with a card, or receive crypto to your verified address.'}</p>
      <div class="acct-uw__emptyrow">
        <button class="acct-cta acct-cta--sm" data-wact="AddCash">Buy with card</button>
        <button class="acct-cta acct-cta--sm acct-cta--ghost" data-wact="Receive">Receive crypto</button>
      </div>
    </div>`;
  }
  rows.sort((a, b) => b.usd - a.usd);
  return `<div class="acct-uw__assets">
    ${rows.map(r => `<div class="acct-uw__asset">
      <span class="acct-uw__aid"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.sub)}</small></span>
      ${r.amt ? `<span class="acct-uw__aamt">${escapeHtml(r.amt)}</span>` : ''}
      <span class="acct-uw__ausd">${usdShort(r.usd)}</span>
    </div>`).join('')}
  </div>`;
}

function activityTabHTML() {
  if (activity == null) {
    if (!activityLoading) loadActivityRows();
    return `<div class="acct-uw__empty"><p>${activityLoading || activity === null ? 'Loading activity…' : ''}</p></div>`;
  }
  if (!activity.length) return `<div class="acct-uw__empty"><p>No activity yet — fills, deposits and withdrawals on Hyperliquid will appear here.</p></div>`;
  return `<div class="acct-uw__assets">
    ${activity.map(r => `<div class="acct-uw__asset">
      <span class="acct-uw__aid"><b>${escapeHtml(r.kind)}</b><small>${escapeHtml(r.detail)}</small></span>
      <span class="acct-uw__aamt muted">${agoShort(r.t)}</span>
      ${r.usd != null ? `<span class="acct-uw__ausd">${usdShort(Math.abs(r.usd))}</span>` : ''}
    </div>`).join('')}
  </div>`;
}

function walletViewHTML() {
  // The authenticated Privy address is the only wallet source. There is deliberately no
  // anonymous/local fallback: an unverified address must never receive funds.
  const ethAddr = accounts.walletAddress();
  if (!ethAddr) return emptyWalletHTML();
  if (!snap && !snapLoading) loadSnap();
  const hl = snap && snap.hyperliquid, pm = snap && snap.polymarket, w = snap && snap.wallet;
  const accountRow = (id, name, color, sub, bal) => `
    <button class="acct-row" data-venue="${id}">
      ${dot(name, color, 26)}
      <span class="acct-row__id"><b>${name}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      <span class="acct-row__bal">${bal}</span>
    </button>`;
  // grand total = the unified wallet's venues + every linked external wallet's on-chain
  // balance, so this row always agrees with the WalletChip / home-hero number
  const exts = externalWallets();
  exts.forEach((x) => loadExtBal(x.address));
  const extLoaded = exts.filter((x) => extBals[x.address] && extBals[x.address] !== 'loading');
  const extPending = exts.some((x) => extBals[x.address] === undefined || extBals[x.address] === 'loading');
  const extSum = extLoaded.reduce((s, x) => s + (extBals[x.address].total || 0), 0);
  const totalNote = snap && snap.partial ? ' (some venues unavailable)' : extPending ? ' (syncing linked wallets)' : exts.length ? ' · all wallets' : '';
  const list = `
    <div class="acct-list">
      ${accountRow('hence', 'Hence Wallet', '#f4c39a', 'Ethereum · Arbitrum · Base', balCell(w ? w.total : null))}
      ${accountRow('hyperliquid', 'Hyperliquid', '#50d2c1',
        hl && hl.positions ? `Perp DEX · ${hl.positions} open position${hl.positions === 1 ? '' : 's'}` : 'Perp DEX',
        balCell(hl ? hl.total : null))}
      ${accountRow('polymarket', 'Polymarket', '#1A53F0', 'Prediction market', balCell(pm ? pm.total : null))}
      <div class="acct-list__total"><span>Total${totalNote}</span><b>${snap ? usdShort(snap.total + extSum) : '—'}</b></div>
    </div>`;
  const panel = `
    <div class="acct-uw">
      <div class="acct-uw__h">${dot('Hence', '#f4c39a', 22)} <b>Hence Unified Wallet</b>
        <button class="acct-uw__menu" data-refresh-bal title="Refresh balances">${icon('refresh', 15)}</button></div>
      <div class="acct-uw__addr">
        <span class="acct-uw__chain">${icon('coin', 13)} Ethereum</span>
        <button class="acct-uw__copy" data-copy="${ethAddr}">${trunc(ethAddr, 10, 8)} ${icon('doc', 12)}</button>
      </div>
      <div class="acct-uw__bal">${snap ? usdShort(snap.total) : '—'}${snapLoading ? '<small class="muted" style="font-size:11px;margin-left:8px">Syncing…</small>' : ''}</div>
      <div class="acct-uw__actions">
        <button data-wact="Receive">${icon('download', 16)}<span>Receive</span></button>
        <button data-wact="AddCash">${icon('card', 16)}<span>Add cash</span></button>
        <button data-wact="Send">${icon('arrowUp', 16)}<span>Send</span></button>
      </div>
      <div class="acct-uw__tabs">
        <button class="${uwTab === 'Balances' ? 'on' : ''}" data-uwtab="Balances">Balances</button>
        <button class="${uwTab === 'Activity' ? 'on' : ''}" data-uwtab="Activity">Activity</button>
      </div>
      ${uwTab === 'Activity' ? activityTabHTML() : balancesTabHTML()}
    </div>`;
  return `<div class="acct-cols">${list}${panel}</div>`;
}

/* ---------------- all (external) accounts view ---------------- */
function allAccountsHTML() {
  const ext = externalWallets();
  if (!ext.length) {
    return `<div class="acct-empty">
      <div class="acct-empty__ic">${icon('wallet', 30)}</div>
      <h3>No external wallets linked</h3>
      <p>Link a wallet you already use (MetaMask, Rabby, WalletConnect…) and its on-chain balances appear here alongside your Hence Wallet. Brokerage and exchange connections are still planned.</p>
      <button class="acct-cta" data-link-wallet>Link an external wallet</button>
    </div>`;
  }
  for (const w of ext) loadExtBal(w.address);
  let total = 0, anyPending = false;
  const rows = ext.map((w) => {
    const b = extBals[w.address];
    let bal;
    if (b === 'loading' || b === undefined) { bal = '<span class="acct-row__pending">Syncing…</span>'; anyPending = true; }
    else if (b == null) { bal = '—'; }
    else { bal = usdShort(b.total); total += b.total; }
    const label = String(w.type || 'wallet').replace(/_/g, ' ');
    return `<div class="acct-row acct-row--ext">
      ${dot(label, '#f6851b', 26)}
      <span class="acct-row__id"><b>${escapeHtml(label)}</b><small>${trunc(escapeHtml(w.address), 8, 6)} · Ethereum · Arbitrum · Base</small></span>
      <span class="acct-row__bal">${bal}</span>
    </div>`;
  }).join('');
  return `<div class="acct-cols acct-cols--single">
    <div class="acct-list acct-list--ext">
      <div class="acct-list__cap">Linked wallets</div>
      ${rows}
      <div class="acct-list__total"><span>Total${anyPending ? ' (syncing)' : ''}</span><b>${usdShort(total)}</b></div>
      <button class="acct-cta acct-cta--sm acct-cta--ghost" data-link-wallet style="margin-top:10px">${icon('plus', 12)} Link another wallet</button>
    </div>
  </div>`;
}

/* ---------------- earn view ---------------- */
let earnData = null, earnLoading = false, earnErr = false;
function loadEarn() {
  if (earnLoading) return;                 // collapse concurrent fetches (render can fire repeatedly)
  earnLoading = true; earnErr = false;
  fetch('/api/earn').then(r => r.ok ? r.json() : null).then((d) => {
    if (d) earnData = d; else earnErr = true;
  }).catch(() => { earnErr = true; }).finally(() => {
    earnLoading = false;
    if (overlay && view === 'earn') render();
  });
}

function earnViewHTML() {
  if (earnErr && !earnData) return `<div class="acct-earn__load">Couldn’t load earn options. <button class="acct-link" data-earn-retry>Retry</button></div>`;
  if (!earnData) { loadEarn(); return `<div class="acct-earn__load">Loading earn options…</div>`; }
  const vaults = earnData.vaults || [];
  const live = !!earnData.available;       // execution-ready (not just catalog present)
  const cards = vaults.map(v => `
    <div class="acct-earn__card">
      <div class="acct-earn__top">
        <span class="acct-earn__id"><b>${escapeHtml(v.name)}</b><small>${escapeHtml(v.asset)} on ${escapeHtml(v.chain)} · ${escapeHtml(v.protocol)} · by ${escapeHtml(v.curator)}</small></span>
        <span class="acct-earn__apy">~${(Number(v.apy) || 0).toFixed(1)}%<small>Est. APY</small></span>
      </div>
      <p class="acct-earn__blurb">${escapeHtml(stripHtml(v.blurb))}</p>
      <button class="acct-cta acct-cta--sm ${live ? '' : 'acct-cta--ghost'}" data-earn="${escapeHtml(v.id)}">${live ? 'Deposit USDC' : 'Notify me'}</button>
    </div>`).join('');
  const banner = live ? '' :
    `<div class="acct-earn__banner">${icon('info', 13)} Earn activates once the wallet's yield engine is switched on. You'll be able to earn on idle USDC and withdraw anytime.</div>`;
  return `<div class="acct-earn">
    <div class="acct-earn__hd"><b>Put idle USDC to work</b><span>Auto-earn on your balance through audited, risk-managed vaults. Non-custodial — withdraw whenever.</span></div>
    ${banner}
    ${cards}
    <div class="acct-earn__foot">Rates shown are indicative; live vault APY varies and is not guaranteed. Vaults are third-party DeFi protocols; your funds stay in your wallet's control.</div>
  </div>`;
}

/* ---------------- shell ---------------- */
function render() {
  if (!overlay) return;
  const title = view === 'all' ? 'All Accounts' : view === 'earn' ? 'Earn' : 'Hence Wallet';
  const body = view === 'all' ? allAccountsHTML() : view === 'earn' ? earnViewHTML() : walletViewHTML();
  overlay.querySelector('.acct-modal').innerHTML = `
    ${railHTML()}
    <section class="acct-stage">
      <div class="acct-stage__h"><b>${title}</b><button class="acct-x" data-close-acct aria-label="Close">${icon('close', 18)}</button></div>
      <div class="acct-stage__body">${body}</div>
      <div class="acct-stage__foot">
        <span class="acct-foot__note">Deposit addresses come only from your authenticated Privy wallet. Hence never creates browser-only wallet addresses.</span>
      </div>
    </section>`;
}

/* ---------------- connect dialog ---------------- */
const viaTag = (via) => `<span class="acct-dlg__via ${via === 'snaptrade' ? 'acct-dlg__via--st' : ''}">Coming soon</span>`;

function openConnectDialog() {
  const groups = accounts.connectableGroups();
  const dlg = document.createElement('div');
  dlg.className = 'acct-dlg';
  dlg.innerHTML = `<div class="acct-dlg__backdrop" data-dlg-close></div>
    <div class="acct-dlg__panel">
      <div class="acct-dlg__h"><b>Planned connections</b><button data-dlg-close aria-label="Close">${icon('close', 16)}</button></div>
      <div class="acct-dlg__list">
        ${groups.map(g => `<div class="acct-dlg__grp">${g.title}</div>` +
          g.items.map(p => `<button class="acct-dlg__item" data-pick="${p.id}">${dot(p.name, p.color, 24)}
            <span class="acct-dlg__itx"><b>${p.name}</b><small>${p.kind}</small></span>${viaTag(p.via)}${icon('chevR', 14)}</button>`).join('')
        ).join('')}
      </div>
      <div class="acct-dlg__note">These provider connections are not enabled yet. Selecting one will not create an account or mark it connected. Your authenticated Privy wallet already powers supported funding and trading flows.</div>
    </div>`;
  overlay.appendChild(dlg);
  requestAnimationFrame(() => dlg.classList.add('in'));
  const close = () => { dlg.classList.remove('in'); setTimeout(() => dlg.remove(), 160); };
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-dlg-close]')) { close(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const p = accounts.providerInfo(pick.dataset.pick);
      const acct = accounts.connect(pick.dataset.pick);
      close();
      if (acct.status === 'unavailable')
        toast(`${p.name} connection isn’t enabled yet — nothing was connected`, { icon: 'info', duration: 3600 });
    }
  });
}

/* ---------------- receive (universal deposit address) sheet ---------------- */
let recvChain = 'base';

function walletAddr() {
  return accounts.walletAddress() || '';
}

function receiveSheetHTML() {
  const addr = walletAddr();
  const c = chainById(recvChain);
  const chainTabs = FUND_CHAINS.map(ch =>
    `<button class="acct-recv__chip ${ch.id === recvChain ? 'on' : ''}" data-recv-chain="${ch.id}">${ch.label}</button>`).join('');
  return `<div class="acct-dlg__backdrop" data-dlg-close></div>
    <div class="acct-dlg__panel acct-recv">
      <div class="acct-dlg__h"><b>Receive crypto</b><button data-dlg-close aria-label="Close">${icon('close', 16)}</button></div>
      <div class="acct-recv__chains">${chainTabs}</div>
      <div class="acct-recv__qr"><img alt="Deposit address QR" data-recv-qr /></div>
      <div class="acct-recv__net">Network: <b>${c.label}</b> · ${c.feeds}</div>
      <button class="acct-recv__addr" data-copy="${addr}">${trunc(addr, 12, 10)} ${icon('doc', 13)}</button>
      <div class="acct-recv__warn">${icon('info', 12)} Send only <b>${c.tokenLabel}</b> on <b>${c.label}</b> to this address. Other assets or networks may be lost.</div>
      <button class="acct-recv__bridge" data-bridge="${c.id}">${icon('send', 14)} Auto-bridge from any chain</button>
      <div class="acct-recv__sub">Sending from another network or asset? Privy bridges &amp; swaps it into ${c.tokenLabel} on ${c.label} automatically.</div>
      ${c.id === 'arbitrum' ? `<a class="acct-recv__next" href="#/terminal">${icon('candles', 12)} Funding trading? Once USDC lands here, the terminal's Deposit moves it into Hyperliquid in one tap.</a>` : ''}
      ${c.id === 'polygon' ? `<div class="acct-recv__next">${icon('coin', 12)} ${c.tokenLabel} here is Polymarket collateral — prediction trades draw from it directly.</div>` : ''}
    </div>`;
}

function paintRecvQr() {
  const img = overlay && overlay.querySelector('[data-recv-qr]');
  if (!img) return;
  const a = walletAddr();
  if (!a) return;                           // never paint a QR for an empty address
  qrDataUrl(a, 172).then((d) => { if (d && img) img.src = d; });
}

function openReceiveSheet(chainId) {
  if (!walletAddr()) { toast('Sign in with Privy to get a verified deposit address', { icon: 'info' }); return; }
  recvChain = chainById(chainId).id;        // fresh each open (default 'base', or a caller intent)
  const dlg = document.createElement('div');
  dlg.className = 'acct-dlg acct-dlg--recv';
  dlg.innerHTML = receiveSheetHTML();
  overlay.appendChild(dlg);
  requestAnimationFrame(() => dlg.classList.add('in'));
  paintRecvQr();
  // the address can change under an open sheet (embedded wallet finishes provisioning, or a
  // logout) — re-sync the QR + copy target, or dismiss if the wallet is gone.
  const onAddr = () => {
    if (!walletAddr()) { close(); toast('Your verified wallet is no longer available — sign in again before receiving funds', { icon: 'info' }); return; }
    dlg.innerHTML = receiveSheetHTML(); paintRecvQr();
  };
  const close = () => {
    window.removeEventListener('hence:auth', onAddr);
    window.removeEventListener('hence:fund', onAddr);
    dlg.classList.remove('in'); setTimeout(() => dlg.remove(), 160);
  };
  window.addEventListener('hence:auth', onAddr);
  window.addEventListener('hence:fund', onAddr);
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-dlg-close]')) { close(); return; }
    const ch = e.target.closest('[data-recv-chain]');
    if (ch) {
      if (!walletAddr()) { toast('Sign in with Privy to get a verified deposit address', { icon: 'info' }); close(); return; }
      recvChain = ch.dataset.recvChain; dlg.innerHTML = receiveSheetHTML(); paintRecvQr(); return;
    }
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy, { label: 'Address copied' }); return; }
    const br = e.target.closest('[data-bridge]'); if (br) { startBridge(br.dataset.bridge); return; }
  });
}

// universal deposit modal (Privy). Gracefully explains the dashboard-gated state.
function startBridge(chainId) {
  const f = fund();
  const c = chainById(chainId);
  if (!f || !f.ready) { toast('Sign in to bridge funds in', { icon: 'info' }); return; }
  toast('Opening deposit…', { spinner: true, sticky: true });
  Promise.resolve(f.deposit(c.caip2, c.token))
    .then(() => toast(`Deposit to ${c.label} complete`, { icon: 'check' }))
    .catch((err) => {
      const code = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
      if (code.includes('DEPOSIT_ADDRESSES_NOT_ENABLED'))
        toast('Auto-bridge isn’t enabled for this app yet — use the address above', { icon: 'info', duration: 3600 });
      else if (code.includes('USER_EXITED') || code.includes('cancel'))
        hideToast();
      else
        toast('Could not start the bridge — use the address above', { icon: 'info', duration: 3200 });
    });
}

// fiat onramp (Privy). Defaults to USDC on Base.
function startAddCash() {
  const f = fund();
  const c = chainById('base');
  if (!f || !f.ready) { toast('Sign in to add cash', { icon: 'info' }); return; }
  toast('Opening add cash…', { spinner: true, sticky: true });
  Promise.resolve(f.addCash(c.caip2, c.token))
    .then((r) => {
      const s = r && r.status;
      toast(s === 'confirmed' ? 'Funds on the way' : 'Purchase started — funds arrive shortly', { icon: 'check' });
    })
    .catch((err) => {
      const code = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
      if (code.includes('USER_EXITED') || code.includes('cancel') || code.includes('exit')) hideToast();
      else toast('Add cash isn’t available in your region yet', { icon: 'info', duration: 3200 });
    });
}

// earn deposit — gated server-side; today this surfaces the go-live reason cleanly.
async function startEarnDeposit(vaultId) {
  const ha = (typeof window !== 'undefined' && window.henceAuth) || null;
  if (!ha || !ha.authenticated) { toast('Sign in to start earning', { icon: 'info' }); return; }
  try {
    const r = await authenticatedApiFetch('/api/earn/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: vaultId }) });
    const d = await r.json().catch(() => ({}));
    if (d && d.ok) toast('Deposit started', { icon: 'check' });
    else toast(d && d.reason ? d.reason : 'Earn isn’t available yet', { icon: 'info', duration: 3600 });
  } catch { toast('Earn isn’t available yet', { icon: 'info' }); }
}

/* ---------------- open ---------------- */
// opts.fund (a FUND_CHAINS id, e.g. 'arbitrum') opens straight to the Receive sheet on that
// chain — e.g. the Terminal's Deposit routes Hyperliquid funding to Arbitrum.
export function openAccounts(opts) {
  if (overlay) return;
  view = 'wallet';
  const root = document.getElementById('modal-root') || document.body;
  overlay = document.createElement('div');
  overlay.className = 'acct-ov';
  overlay.innerHTML = `<div class="acct-ov__backdrop" data-close-acct></div><div class="acct-modal"></div>`;
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  uwTab = 'Balances'; snap = null; activity = null; extBals = {};
  loadSnap(true);
  render();
  requestAnimationFrame(() => overlay.classList.add('in'));
  if (opts && opts.fund) requestAnimationFrame(() => openReceiveSheet(opts.fund));

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-acct]')) { closeAccounts(); return; }
    const t = e.target.closest('[data-toast]'); if (t) { toast(t.dataset.toast, { icon: 'info' }); return; }
    const v = e.target.closest('[data-view]'); if (v) { view = (v.dataset.view === 'earn' && !EARN_ENABLED) ? 'wallet' : v.dataset.view; render(); return; }
    if (e.target.closest('[data-connect]')) { openConnectDialog(); return; }
    if (e.target.closest('[data-sign-in]')) {
      const ha = (typeof window !== 'undefined' && window.henceAuth) || null;
      if (ha && typeof ha.login === 'function') ha.login();
      else toast('Secure sign-in is still loading — please try again', { icon: 'info' });
      return;
    }
    if (e.target.closest('[data-signout]')) {
      // mirror Settings' sign-out: Privy logout then the login screen (AuthGate owns the rest)
      const ha = (typeof window !== 'undefined' && window.henceAuth) || null;
      closeAccounts();
      if (ha && typeof ha.logout === 'function') ha.logout();
      location.hash = '#/login';
      return;
    }
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy, { label: 'Address copied' }); return; }
    const dis = e.target.closest('[data-disconnect]'); if (dis) { e.stopPropagation(); accounts.disconnect(dis.dataset.disconnect); render(); toast('Account disconnected', { icon: 'close' }); return; }
    const wa = e.target.closest('[data-wact]');
    if (wa) {
      const act = wa.dataset.wact;
      if (act === 'Receive' || act === 'Deposit') openReceiveSheet();
      else if (act === 'AddCash') startAddCash();
      else toast('Sending from the Hence Wallet is coming soon — Receive or Add cash to fund it', { icon: 'info', duration: 3200 });
      return;
    }
    const ut = e.target.closest('[data-uwtab]'); if (ut) { uwTab = ut.dataset.uwtab; render(); return; }
    if (e.target.closest('[data-refresh-bal]')) { snap = null; activity = null; loadSnap(true); render(); return; }
    if (e.target.closest('[data-link-wallet]')) {
      const ha = (typeof window !== 'undefined' && window.henceAuth) || null;
      if (ha && typeof ha.linkWallet === 'function') { extBals = {}; ha.linkWallet(); }
      else toast('Sign in first to link a wallet', { icon: 'info' });
      return;
    }
    const en = e.target.closest('[data-earn]'); if (en) { startEarnDeposit(en.dataset.earn); return; }
    if (e.target.closest('[data-earn-retry]')) { loadEarn(); return; }
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hence:auth', onAuthChange);
  window.addEventListener('hence:me', render);     // server-backed connections loaded/changed
}
function onKey(e) { if (e.key === 'Escape' && overlay) { e.preventDefault(); closeAccounts(); } }
function onAuthChange() {
  // address appeared/changed (login, wallet link) → re-pull everything for the new identity
  if (snapAddr !== accounts.walletAddress()) { snap = null; activity = null; extBals = {}; loadSnap(true); }
  render();
}
export function closeAccounts() {
  if (!overlay) return;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('hence:auth', onAuthChange);
  window.removeEventListener('hence:me', render);
  overlay.classList.remove('in');
  const o = overlay; overlay = null;
  setTimeout(() => { o.remove(); if (!document.querySelector('#modal-root > *')) document.body.style.overflow = ''; }, 180);
}
