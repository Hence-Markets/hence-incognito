/* =========================================================
   stock-modals.js — companion modals for the stock screen
   exports: openAllFinancials(sym), openEditPeers(sym)
   Owned styles live in styles/stock-extra.css (.stx- prefix)
   ========================================================= */
import { openModal, icon, logo, toast } from '../lib/ui.js';
import { multiLine, divergingArea, sparkline } from '../lib/charts.js';
import { getTicker as _gt, series } from '../lib/data.js';

/* ---------- deterministic synthetic figures ---------- */
function rnd(key, n, lo, hi) {
  const s = series(key, n, 0, 1);
  const mn = Math.min(...s), mx = Math.max(...s), sp = (mx - mn) || 1;
  return s.map(v => lo + ((v - mn) / sp) * (hi - lo));
}
const fmtB = (v) => {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + 'T';
  if (a >= 1) return v.toFixed(2) + 'B';
  return (v * 1000).toFixed(0) + 'M';
};

const Q_COLS = ['Q3 2023', 'Q4 2023', 'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024'];
const A_COLS = ['2019', '2020', '2021', '2022', '2023', '2024'];

/* statement row definitions: [label, seedKey, lo, hi]  (NR = "Not Reported") */
const NR = '__NR__';
const STATEMENTS = {
  'Key Stats': [
    ['Market Capitalization', 'mc', 600000, 840000],
    ['Cash Assets', 'ca', 20000, 30000],
    ['Total Debt', 'td', 5000, 7000],
    ['Enterprise Value', 'ev', 600000, 820000],
    ['__GAP__'],
    ['Total Revenue', 'rev', 21000, 26000],
    ['Gross Profit', 'gp', 4000, 5000],
    ['Gross Profit Margin', 'gpm', 17, 19, '%'],
    ['EBITDA', 'ebitda', 2000, 4000],
    ['EBITDA Margin', 'ebm', 11, 17, '%'],
    ['Net Income', 'ni', 1000, 2500],
    ['Net Income Margin', 'nim', 6, 9, '%'],
    ['Diluted EPS', 'eps', 0.3, 0.95, '$'],
    ['__GAP__'],
    ['Cash from operations', 'cfo', 2000, 6500],
    ['Capital expenditure', 'capex', -2700, -2200, '', true],
    ['Free Cash Flow', 'fcf', NR],
  ],
  'Income Statement': [
    ['Total Revenue', 'rev', 21000, 26000],
    ['Cost Of Goods Sold', 'cogs', 16000, 21000],
    ['Gross Profit', 'gp', 4000, 5000],
    ['Selling General & Admin Expenses', 'sga', 1100, 1400],
    ['R & D Expenses', 'rnd', 900, 1300],
    ['Operating Income', 'oi', 1100, 2400],
    ['__GAP__'],
    ['Interest Expense', 'iexp', -90, -40, '', true],
    ['Interest Income', 'iinc', 200, 360],
    ['Net Interest Expenses', 'nie', 150, 330],
    ['Pretax Income', 'pti', 1100, 2700],
    ['Income Tax', 'tax', 150, 600],
    ['Net Income', 'ni', 1000, 2500],
  ],
  'Balance Sheet': [
    ['Cash And Equivalents', 'cae', 14000, 19000],
    ['Short Term Investments', 'sti', 10000, 16000],
    ['Trading Asset Securities', 'tas', NR],
    ['Total Cash & Investments', 'tci', 26000, 36000],
    ['__GAP__'],
    ['Accounts Receivable', 'ar', 2300, 3500],
    ['Other Receivable', 'or', 3400, 5800],
    ['Notes Receivable', 'nr', NR],
    ['Total Receivable', 'tr', 2700, 5800],
    ['__GAP__'],
    ['Inventory', 'inv', 12700, 15000],
    ['Loans Held For Sale', 'lhs', NR],
    ['Restricted Cash', 'rc', NR],
    ['Other Current Assets', 'oca', NR],
    ['Total Current Assets', 'tca', 43000, 59000],
    ['__GAP__'],
    ['Gross PP&E', 'ppe', 50000, 65000],
    ['Depreciation', 'dep', -13000, -10000, '', true],
    ['Net PP&E', 'nppe', 40000, 53000],
    ['Long-term Investments', 'lti', NR],
  ],
  'Cash Flow': [
    ['Dep & Amortization', 'da', 2000, 3700],
    ['Amortization of Goodwill and Intangibles', 'agi', NR],
    ['Total Dep & Amortization', 'tda', 2000, 3700],
    ['Net Income', 'ni', 1000, 2500],
    ['__GAP__'],
    ['Other Amortization', 'oa', 40, 90],
    ['(Gain) Loss From Sale Of Assets', 'gls', NR],
    ['(Gain) Loss On Sale Of Invest.', 'gli', NR],
    ['Asset Writedown & Restructuring Costs', 'awr', NR],
    ['Net Decrease/Increase in Loans Orig/Sold', 'nil', NR],
    ['Stock-Based Comp', 'sbc', 460, 700],
    ['Other Operating Activities', 'ooa', -700, 600, '', true],
    ['Change in Inventories', 'cii', -2700, 200, '', true],
    ['Chg A/c Payable', 'cap', 1100, 9000],
    ['Chg Net Open Assets', 'cna', -7500, 4200, '', true],
    ['Cash From Operations', 'cfo', 2000, 6500],
    ['__GAP__'],
    ['Capital Expenditure', 'capex', -2700, -2200, '', true],
    ['Cash Acquisitions', 'cacq', NR],
    ['Sale (Purchase) of Intangible assets', 'spi', NR],
  ],
};

function cellVal(seedKey, lo, hi, n, unit, isNeg) {
  if (lo === NR) return Array(n).fill(NR);
  const vals = rnd(seedKey, n, lo, hi);
  return vals.map(v => {
    if (unit === '%') return v.toFixed(2) + '%';
    if (unit === '$') return v.toFixed(2);
    return fmtB(v);
  });
}

function financialsTable(sym, tab, period, highlightLast, selectedRow) {
  const cols = period === 'Annual' ? A_COLS : Q_COLS;
  const rows = STATEMENTS[tab];
  const lastIdx = cols.length - 1;
  const head = `<tr>
    <th class="stx-fn-currency">Prices in USD</th>
    ${cols.map((c, i) => `<th class="${highlightLast && i === lastIdx ? 'stx-col-hl' : ''}">${c}${highlightLast && i === lastIdx ? '<span class="stx-inc-badge">Income</span>' : ''}</th>`).join('')}
  </tr>`;
  const body = rows.map((r, ri) => {
    if (r[0] === '__GAP__') return `<tr class="stx-fn-gap"><td colspan="${cols.length + 1}" style="height:8px;border:none"></td></tr>`;
    const [label, key, lo, hi, unit, isNeg] = r;
    const vals = cellVal(key + '-' + sym + '-' + period, lo, hi, cols.length, unit, isNeg);
    const sel = selectedRow === ri;
    return `<tr class="${sel ? 'stx-row-sel' : ''}" data-row="${ri}">
      <td class="stx-rowlabel" data-rowlabel="${ri}">${label}</td>
      ${vals.map((v, i) => `<td class="${highlightLast && i === lastIdx ? 'stx-col-hl' : ''} ${isNeg && v !== NR ? 'down' : ''}">${v === NR ? '<span style="color:var(--dimmest)">Not Reported</span>' : v}${sel && i > 0 && v !== NR ? deltaBadge(key + i) : ''}</td>`).join('')}
    </tr>`;
  }).join('');
  return `<table class="stx-fntable"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function deltaBadge(seed) {
  const h = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const up = h % 2 === 0;
  const v = (5 + (h % 60)).toFixed(2);
  return `<span class="stx-delta ${up ? 'up' : 'down'}">${up ? '+' : '-'}${v}%</span>`;
}

/* =========================================================
   openAllFinancials(sym)
   ========================================================= */
export function openAllFinancials(sym) {
  sym = (sym || 'TSLA').toUpperCase();
  const t = _gt(sym);
  const TABS = ['Key Stats', 'Income Statement', 'Balance Sheet', 'Cash Flow'];
  const state = { tab: 'Key Stats', period: 'Quarterly', highlight: true, selRow: null };

  const chgPill = `<span class="pill ${t.chg >= 0 ? 'up' : 'down'}">${t.chg >= 0 ? '+' : ''}${t.chg.toFixed(2)} (${t.chgPct.toFixed(2)}%)</span>`;

  const { el, close } = openModal(`
    <div class="stx-fsmodal">
      <div class="stx-fsbar">
        <span class="stx-fstitle">${logo(sym, 20)} ${sym} Financials ${chgPill}</span>
        <div class="stx-fstabs">${TABS.map(x => `<button class="${x === state.tab ? 'on' : ''}" data-fstab="${x}">${x}</button>`).join('')}</div>
        <button class="icon-btn" data-close>${icon('close', 16)}</button>
      </div>
      <div class="stx-fsbody" data-fsbody></div>
      <div class="stx-fsfoot">
        <div class="segmented" data-period>
          <button class="on" data-per="Quarterly">Quarterly</button>
          <button data-per="Annual">Annual</button>
        </div>
      </div>
    </div>`, { size: 'bare' });

  const body = el.querySelector('[data-fsbody]');
  function renderBody() {
    body.innerHTML = financialsTable(sym, state.tab, state.period, state.highlight, state.selRow);
  }
  renderBody();

  // tab switching
  el.querySelectorAll('[data-fstab]').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('[data-fstab]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.tab = b.dataset.fstab; state.selRow = null;
    renderBody();
  }));
  // period toggle
  el.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('[data-per]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.period = b.dataset.per; state.selRow = null;
    renderBody();
  }));

  // inline row popover: click a row label → Compare / Graph / Cancel
  body.addEventListener('click', (e) => {
    const lbl = e.target.closest('[data-rowlabel]');
    closeRowPop();
    if (!lbl) return;
    const ri = +lbl.dataset.rowlabel;
    state.selRow = ri; renderBody();
    openRowPop(ri, STATEMENTS[state.tab][ri][0]);
  });

  function closeRowPop() { el.querySelector('.stx-rowpop')?.remove(); }
  function openRowPop(ri, label) {
    const tr = body.querySelector(`tr[data-row="${ri}"]`);
    if (!tr) return;
    const pop = document.createElement('div');
    pop.className = 'stx-rowpop';
    pop.innerHTML = `
      <span class="stx-rp-chip on"><span class="checkbox on" style="width:13px;height:13px">${icon('check', 9)}</span>${label.split(' ')[0]}</span>
      <button class="stx-rp-go" data-rp="compare">Compare</button>
      <button class="stx-rp-go" data-rp="graph">Graph</button>
      <button data-rp="cancel">Cancel</button>`;
    const bodyRect = body.getBoundingClientRect();
    const trRect = tr.getBoundingClientRect();
    pop.style.top = (trRect.bottom - bodyRect.top + body.scrollTop + 2) + 'px';
    pop.style.left = (trRect.left - bodyRect.left + 8) + 'px';
    body.appendChild(pop);
    pop.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = b.dataset.rp;
      closeRowPop();
      if (a === 'cancel') { state.selRow = null; renderBody(); }
      else if (a === 'compare') toast(`Comparing ${label}`);
      else if (a === 'graph') toast(`Graphing ${label}`, { icon: 'chart' });
    }));
  }
}

/* =========================================================
   Peer data
   ========================================================= */
const DEFAULT_PEERS = ['F', 'GM', 'RIVN', 'LI', 'MBGYY', 'HMC'];
const PEER_NAMES = {
  F: 'Ford Motor Company', GM: 'General Motors Company', RIVN: 'Rivian Automotive Inc',
  LI: 'Li Auto Inc', MBGYY: 'Mercedes-Benz Group AG', HMC: 'Honda Motor Co., Ltd',
  GOOG: 'Alphabet Inc.', GOOGL: 'Alphabet Inc.', NIO: 'NIO Inc.', TM: 'Toyota Motor Corp',
  STLA: 'Stellantis N.V.', VWAGY: 'Volkswagen AG', BYDDY: 'BYD Company Limited',
};
function peerName(sym) { return PEER_NAMES[sym] || (_gt(sym).name); }

const SEARCH_INDEX = [
  ['google', 'GOOG', 'Alphabet Inc.'], ['google', 'GOOGL', 'Alphabet Inc.'],
  ['ford', 'F', 'Ford Motor Company'], ['nio', 'NIO', 'NIO Inc.'],
  ['toyota', 'TM', 'Toyota Motor Corp'], ['byd', 'BYDDY', 'BYD Company Limited'],
  ['volkswagen', 'VWAGY', 'Volkswagen AG'], ['stellantis', 'STLA', 'Stellantis N.V.'],
];

/* =========================================================
   openEditPeers(sym) — full peer-analysis table + edit editor
   ========================================================= */
export function openEditPeers(sym) {
  sym = (sym || 'TSLA').toUpperCase();
  const t = _gt(sym);
  let view = 'table';                       // 'table' | 'edit'
  let peers = DEFAULT_PEERS.slice();
  const MAX = 6;

  const chgPill = `<span class="pill ${t.chg >= 0 ? 'up' : 'down'}">${t.chg >= 0 ? '+' : ''}${t.chg.toFixed(2)} (${t.chgPct.toFixed(2)}%)</span>`;

  const { el, close } = openModal(`
    <div class="stx-fsmodal">
      <div class="stx-fsbar">
        <span class="stx-fstitle">${logo(sym, 20)} ${sym} Peer analysis ${chgPill}</span>
        <button class="stx-textbtn" data-toggle-view style="margin-left:auto">${icon('sliders', 14)} <span data-tv-label>Edit peers</span></button>
        <button class="icon-btn" data-close>${icon('close', 16)}</button>
      </div>
      <div class="stx-fsbody" data-pebody></div>
    </div>`, { size: 'bare' });

  const body = el.querySelector('[data-pebody]');
  const tvLabel = el.querySelector('[data-tv-label]');

  function render() {
    tvLabel.textContent = view === 'table' ? 'Edit peers' : 'All peers';
    body.innerHTML = view === 'table' ? renderTable() : renderEditor();
    wire();
  }

  /* ---- analysis table + 2 charts ---- */
  function renderTable() {
    const all = [sym, ...peers];
    const head = `<tr><th>Top peers</th><th>FCF/Share</th><th>LTM revenue</th><th>EV/Sales</th><th>Price to earnings</th><th>Mkt Cap</th></tr>`;
    const rows = all.map((s, i) => {
      const tk = _gt(s);
      const isSelf = s === sym;
      const fcf = rnd('fcf-' + s, 1, 0.5, 14)[0].toFixed(2);
      const ltm = fmtB(rnd('ltm-' + s, 1, 8, 180000)[0]);
      const evs = rnd('evs-' + s, 1, 0.2, 11)[0].toFixed(2);
      const spk = series('pe-' + s, 20, isSelf ? 0.2 : -0.1, 1);
      const mc = tk.mktCap;
      const pePill = isSelf ? `<span class="stx-outcome miss">128.7</span>` : '';
      return `<tr>
        <td><span class="stx-pe-name">${logo(s, 20)}<b>${s}</b> <span>${isSelf ? t.name : peerName(s)}</span></span></td>
        <td>${fcf}</td>
        <td><span class="pill ${i % 2 ? 'down' : 'up'}">${ltm}</span></td>
        <td>${evs}</td>
        <td>${sparkline(spk, isSelf).replace('class="spark"', 'class="spark stx-pe-spark"')} ${pePill || (10 + i * 3).toFixed(1)}</td>
        <td>${mc}</td>
      </tr>`;
    }).join('');
    const comp = series('comp-' + sym, 60, 0.1, 1);
    const prem = rnd('prem-' + sym, 60, -28, 36).map(v => v / 100);
    return `
      <table class="stx-petable"><thead>${head}</thead><tbody>${rows}</tbody></table>
      <div class="stx-pe-foot">
        <button class="stx-textbtn" data-edit-peers>${icon('sliders', 13)} Edit peers list</button>
        <button class="stx-textbtn" data-graph-peers>${icon('chart', 13)} Graph peers</button>
        <span class="stx-pe-legend"><span><i style="background:var(--white)"></i>Current</span><span><i style="background:var(--dimmer)"></i>Average</span></span>
      </div>
      <div class="stx-pe-charts">
        <div class="stx-pe-chartcard">
          <div class="stx-pc-head"><div><h4>Comparables average</h4><div class="stx-pc-sub">${sym} 102.43 · Comps avg 32.22</div></div><span class="stx-outcome beat" style="background:var(--elevated);color:var(--dim)">EV</span></div>
          <div class="stx-pc-chart">${multiLine([
            { values: comp, color: 'rgba(255,255,255,0.7)', sw: 1.4 },
            { values: series('comp2-' + sym, 60, -0.05, 1), color: 'var(--dimmer)', dash: '3 3', sw: 1.2 },
          ], { w: 460, h: 130 })}</div>
          <div class="stx-pc-x"><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span></div>
        </div>
        <div class="stx-pe-chartcard">
          <div class="stx-pc-head"><div><h4>Percent premium</h4><div class="stx-pc-sub">${sym} +90.50 · Average +16.20</div></div><span class="stx-outcome beat" style="background:var(--elevated);color:var(--dim)">EV</span></div>
          <div class="stx-pc-chart">${divergingArea(prem, { w: 460, h: 130 })}</div>
          <div class="stx-pc-x"><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span></div>
        </div>
      </div>`;
  }

  /* ---- edit peers editor ---- */
  function renderEditor() {
    const full = peers.length >= MAX;
    const warn = full ? `<span class="stx-peer-warn">${icon('close', 12)} Max of ${MAX} reached</span>` : '';
    const list = peers.map(s => `
      <div class="stx-peer-li" data-peer="${s}">
        ${logo(s, 22)}<b>${s}</b> <span class="stx-peer-nm">${peerName(s)}</span>
        <span class="stx-peer-rm" data-rm="${s}">${icon('close', 14)}</span>
      </div>`).join('');
    return `
      <div class="stx-peer-editor">
        <div class="stx-peer-edhead">${sym}'s peers</div>
        <div class="stx-peer-search">
          <span class="ic">${icon('plus', 16)}</span>
          <input data-peer-input placeholder="Search stocks/peers" ${full ? 'disabled' : ''} />
          ${warn}
          <div class="stx-autocomplete" data-ac hidden></div>
        </div>
        <div class="stx-peer-list">${list}</div>
        <div class="stx-peer-edfoot">
          <span>${peers.length} peers selected ·<span class="stx-restore" data-restore>Restore defaults</span></span>
          <span class="stx-ef-actions">
            <button class="btn-ghost" data-cancel-edit>Cancel</button>
            <button class="btn btn--light" style="padding:7px 16px" data-save>Save selection ${icon('check', 13)}</button>
          </span>
        </div>
      </div>`;
  }

  function wire() {
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      peers = peers.filter(x => x !== b.dataset.rm); render();
    }));
    el.querySelector('[data-restore]')?.addEventListener('click', () => { peers = DEFAULT_PEERS.slice(); render(); });
    el.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { view = 'table'; render(); });
    el.querySelector('[data-save]')?.addEventListener('click', () => { view = 'table'; render(); toast('Peer selection saved'); });
    el.querySelector('[data-edit-peers]')?.addEventListener('click', () => { view = 'edit'; render(); });
    el.querySelector('[data-graph-peers]')?.addEventListener('click', () => toast('Graphing peers', { icon: 'chart' }));

    const input = el.querySelector('[data-peer-input]');
    const ac = el.querySelector('[data-ac]');
    if (input) {
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { ac.hidden = true; ac.innerHTML = ''; return; }
        const hits = SEARCH_INDEX.filter(([kw, tk]) => kw.startsWith(q) || tk.toLowerCase().startsWith(q))
          .filter(([, tk]) => !peers.includes(tk));
        if (!hits.length) { ac.hidden = true; ac.innerHTML = ''; return; }
        ac.hidden = false;
        ac.innerHTML = hits.map(([, tk, nm], i) => `
          <div class="stx-ac-item" data-add="${tk}">
            ${logo(tk, 20)}<b>${tk}</b> <span class="stx-ac-name">${nm}</span>
            ${i === 0 ? '<span class="stx-ac-add">Add peer</span>' : ''}
          </div>`).join('');
        ac.querySelectorAll('[data-add]').forEach(it => it.addEventListener('click', () => {
          const tk = it.dataset.add;
          if (peers.length >= MAX) { toast(`Max of ${MAX} reached`); return; }
          if (!peers.includes(tk)) peers.push(tk);
          render();
        }));
      });
    }
  }

  el.querySelector('[data-toggle-view]').addEventListener('click', () => { view = view === 'table' ? 'edit' : 'table'; render(); });
  render();
}
