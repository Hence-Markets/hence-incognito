/* Minimal API. Node's own http server — no framework, nothing to keep patched. */
import { createServer } from 'node:http';
import { isAllowed, cohortSize } from './access.js';

const PORT = Number(process.env.PORT ?? 4400);

const json = (res: any, code: number, body: unknown) => {
  const b = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
};

export function startApi() {
  createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/access') {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 2048) req.destroy();   // an address is 42 chars; nothing here is big
      });
      req.on('end', () => {
        let address: string | undefined;
        try { address = JSON.parse(raw)?.address; } catch { /* fall through to false */ }
        // one boolean about the caller's own address — never the list
        json(res, 200, { allowed: isAllowed(address) });
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      return json(res, 200, { ok: true, cohort: cohortSize() });
    }
    json(res, 404, { error: 'not found' });
  }).listen(PORT, () => console.log(`[api] :${PORT} · cohort=${cohortSize()}`));
}
