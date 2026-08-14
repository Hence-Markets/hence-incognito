/* =========================================================================
   shortcuts — the "?" cheat-sheet overlay (Fey's "Search shortcuts" panel).
   Imperative like the command palette so it can be summoned from anywhere.
   ========================================================================= */

const GROUPS: { title: string; rows: [string, string[]][] }[] = [
  { title: 'General', rows: [
    ['Ask Hence', ['⌘', 'J']],
    ['Command palette', ['⌘', 'K']],
    ['Search securities', ['/']],
    ['Watchlist', ['W']],
    ['Shortcuts', ['?']],
    ['Toggle the dock', ['Q']],
  ] },
  { title: 'Go to (press G, then…)', rows: [
    ['Home', ['G', 'H']],
    ['Trade terminal', ['G', 'T']],
    ['Markets', ['G', 'M']],
    ['Analysis', ['G', 'A']],
    ['Discover / economy', ['G', 'E']],
    ['Calendar', ['G', 'C']],
    ['Signals', ['G', 'S']],
    ['Settings', ['G', 'P']],
  ] },
  { title: 'In context', rows: [
    ['Cycle timeframes', ['[ ]']],
    ['Analysis of current asset', ['A']],
    ['Dismiss / close', ['esc']],
  ] },
];

function keysHtml(keys: string[]) {
  return keys.map((k) => `<kbd class="sc-kbd">${k}</kbd>`).join('<i class="sc-then">then</i>');
}

let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function closeShortcuts() {
  document.querySelector('.sc-overlay')?.remove();
  document.body.classList.remove('sc-open');
  if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
}

export function openShortcuts() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (document.querySelector('.sc-overlay')) { closeShortcuts(); return; }   // toggle
  const el = document.createElement('div');
  el.className = 'sc-overlay';
  el.innerHTML = `<div class="sc-backdrop" data-close></div>
    <div class="sc-panel" role="dialog" aria-label="Keyboard shortcuts">
      <div class="sc-head">Keyboard shortcuts <kbd class="sc-kbd">?</kbd></div>
      <div class="sc-body">${GROUPS.map((g) => `<div class="sc-grp">${g.title}</div>` +
        g.rows.map(([label, keys]) => `<div class="sc-row"><span class="sc-lb">${label}</span><span class="sc-keys">${keysHtml(keys)}</span></div>`).join('')).join('')}
      </div>
    </div>`;
  root.appendChild(el);
  void el.offsetWidth;                 // force reflow so the entrance transition runs (rAF pauses on hidden tabs)
  el.classList.add('in');
  el.querySelector('.sc-backdrop')?.addEventListener('click', closeShortcuts);
  document.body.classList.add('sc-open');
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); closeShortcuts(); }
  };
  document.addEventListener('keydown', escHandler, true);
}
