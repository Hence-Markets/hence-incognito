/* =========================================================
   Hence webapp — tiny hash router
   ========================================================= */
const routes = [];

export function route(pattern, handler) {
  // segment-based compile so optional params consume their own slash
  const names = [];
  const segs = pattern.split('/').filter((s, i) => !(i === 0 && s === '')); // drop leading ''
  let rx = '^';
  for (const seg of segs) {
    if (seg.startsWith(':')) {
      const optional = seg.endsWith('?');
      names.push(seg.slice(1, optional ? -1 : undefined));
      rx += optional ? '(?:/([^/]+))?' : '/([^/]+)';
    } else if (seg === '') {
      // pattern was just '/'
    } else {
      rx += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (rx === '^') rx += '/?'; // root
  rx += '/?$';
  routes.push({ rx: new RegExp(rx), names, handler });
}

function parse() {
  let h = location.hash.replace(/^#/, '') || '/';
  if (!h.startsWith('/')) h = '/' + h;
  return h.split('?')[0];
}

export async function render() {
  const path = parse();
  const app = document.getElementById('app');
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.names.forEach((n, i) => { params[n] = m[i + 1]; });
      const out = await r.handler(params);
      app.innerHTML = '';
      if (typeof out === 'string') app.innerHTML = out;
      else if (out instanceof Node) app.appendChild(out);
      app.dispatchEvent(new CustomEvent('mounted', { detail: { path, params } }));
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = `<div class="notfound"><h1>404</h1><a href="#/">Back to Hence</a></div>`;
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
