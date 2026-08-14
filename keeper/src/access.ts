/* Who is allowed in.
 *
 * The cohort lives in this process's environment and never reaches a browser. The client
 * POSTs its address and learns one boolean about itself — it cannot enumerate the list.
 *
 * FAIL CLOSED. An empty TEAM_WALLETS means nobody gets in. Note this is the OPPOSITE of the
 * main app's rebate whitelist, where empty means "campaign open to everyone" — that
 * convention is right for a fee waiver and wrong for an access gate, and copying it here
 * would silently open a money-moving prototype to the public.
 *
 * OPENING IT IS A SEPARATE, EXPLICIT SWITCH. `INCOGNITO_OPEN=1` lets any valid address in.
 * It is deliberately not "clear the list" — that would make an empty variable mean two
 * opposite things depending on how it got empty, and a misconfigured deploy would open the
 * gate while looking like a broken one. Someone has to say yes in a way that reads as yes.
 *
 * What opening actually risks is the FUNDER, not the contract: eligibility also gates the gas
 * grant, so an open gate means anyone can draw from the omnibus. That is bounded by
 * FUND_TOTAL_BUDGET_ETH and by the grant being sized to a demo rather than a wallet.
 */
const parse = (raw?: string): Set<string> => {
  const out = new Set<string>();
  for (const tok of String(raw ?? '').replace(/,/g, ' ').split(/\s+/)) {
    const t = tok.trim().toLowerCase();
    // malformed entries are dropped rather than matching nothing or everything
    if (t.startsWith('0x') && t.length === 42) out.add(t);
  }
  return out;
};

const ALLOWED = parse(process.env.TEAM_WALLETS);

/** Open to anyone with a valid address. Explicit, never inferred from an empty list. */
export const OPEN = process.env.INCOGNITO_OPEN === '1';

export const isAllowed = (address?: string | null): boolean => {
  if (!address) return false;
  const a = String(address).toLowerCase();
  // Still requires a well-formed address when open: the funder keys grants off this, and
  // "anyone" should not extend to a typo.
  if (OPEN) return /^0x[0-9a-f]{40}$/.test(a);
  return ALLOWED.has(a);
};

export const cohortSize = () => ALLOWED.size;
export const accessMode = () => (OPEN ? 'open' : 'cohort');
