/* Browser shims for the Node globals the Inco SDK expects.
 *
 * @inco/lightning-js reaches for `Buffer` — it is written for Node first — and Vite does not
 * polyfill Node globals. In the browser that surfaces as `Buffer is not defined`, thrown from
 * inside the SDK, at the two moments that matter most:
 *
 *   · zap.encrypt(...)        — every order placement
 *   · zap.attestedReveal(...) — reading the published aggregate
 *
 * Neither is reachable by a typecheck or a build, so this stayed invisible until an order was
 * actually placed and a book actually netted. Both failed identically, which is what pointed at
 * a shared cause rather than two bugs.
 *
 * Imported for its side effect, FIRST, before anything that might touch the SDK.
 */
import { Buffer } from 'buffer';

const g = globalThis as any;

if (!g.Buffer) g.Buffer = Buffer;
// Some Node-targeted bundles probe `global` rather than `globalThis`.
if (!g.global) g.global = globalThis;
// A minimal `process` — libraries commonly branch on process.env.NODE_ENV and crash on an
// undefined `process` long before they reach anything that needs a real one.
if (!g.process) g.process = { env: {} };

export {};
