/* Load .env / .env.local before anything reads process.env.
 *
 * WHY THIS FILE EXISTS. Nothing loaded them. `tsx src/index.ts` does not read a .env, so every
 * module-scope constant in this service was taking its fallback: OMNIBUS_KEY empty, so funding
 * answered "not configured"; INCOGNITO_CONTRACT empty, so the seeder refused to start; and
 * TEAM_WALLETS empty, which — because access.ts fails CLOSED — meant the cohort gate rejected
 * everybody. That last one is the reason this was survivable: a gate that failed open would
 * have admitted the public and looked perfectly healthy while doing it.
 *
 * IMPORT IT FIRST, in every entry point. ES modules evaluate dependencies in import order, and
 * `const CHAIN = process.env.NETWORK === 'mainnet' ? ...` in fund.ts runs the moment that module
 * is imported — after this one, or the value is already wrong and no later assignment fixes it.
 *
 * PRECEDENCE: the real environment always beats a file. A deployment sets variables directly
 * (Docker, systemd, CI), and a stale .env.local sitting in the image must never quietly
 * override what the operator configured — that is how a testnet key ends up on mainnet.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Whatever the process was actually started with. Restored last, so it wins. */
const fromEnvironment = { ...process.env };

// .env first, .env.local second: the local file is the per-developer override.
for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(resolve(ROOT, file));
  } catch {
    // Absent is the normal case for at least one of them, and in production usually both.
  }
}

Object.assign(process.env, fromEnvironment);

/** For a startup line — never prints a value, only whether one arrived. */
export function envReport(keys: string[]): string {
  return keys.map((k) => `${k}=${process.env[k] ? 'set' : 'MISSING'}`).join(' ');
}
