/* Who is allowed in.
 *
 * The cohort lives in this process's environment and never reaches a browser. The client
 * POSTs its address and learns one boolean about itself — it cannot enumerate the list.
 *
 * FAIL CLOSED. An empty TEAM_WALLETS means nobody gets in. Note this is the OPPOSITE of the
 * main app's rebate whitelist, where empty means "campaign open to everyone" — that
 * convention is right for a fee waiver and wrong for an access gate, and copying it here
 * would silently open a money-moving prototype to the public.
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

export const isAllowed = (address?: string | null): boolean =>
  !!address && ALLOWED.has(String(address).toLowerCase());

export const cohortSize = () => ALLOWED.size;
