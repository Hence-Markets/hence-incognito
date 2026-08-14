/* Minimal API. Node's own http server — no framework, nothing to keep patched. */
import { createServer } from 'node:http';
import { isAllowed, cohortSize } from './access.js';
import { fundShielded, funderStatus } from './fund.js';

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
    if (req.method === 'POST' && req.url === '/api/fund') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 2048) req.destroy(); });
      req.on('end', async () => {
        let address: string | undefined;
        try { address = JSON.parse(raw)?.address; } catch { /* falls through to a refusal */ }
        try {
          const r = await fundShielded(String(address || ''));
          // 200 either way: "not eligible" is an answer, not a server fault, and the client
          // treats every non-ok the same — it does not get to distinguish reasons and probe.
          json(res, 200, r);
        } catch (e: any) {
          json(res, 200, { ok: false, reason: e?.message ?? 'Funding failed' });
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      // Reports whether a funder is configured and what it holds — never the key.
      funderStatus()
        .then((f) => json(res, 200, { ok: true, cohort: cohortSize(), funder: f }))
        .catch(() => json(res, 200, { ok: true, cohort: cohortSize() }));
      return;
    }
    json(res, 404, { error: 'not found' });
  }).listen(PORT, () => console.log(`[api] :${PORT} · cohort=${cohortSize()}`));
}
