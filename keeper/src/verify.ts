/* Proving who is asking for funding — without a Privy app secret.
 *
 * The problem: /api/fund must only pay wallets belonging to the cohort. But the address being
 * funded is the SHIELDED one, which by definition is not in the cohort. So the caller has to
 * prove control of an IDENTITY wallet that is.
 *
 * The obvious route is verifying a Privy access token, but that only yields a DID — mapping a
 * DID to its linked wallets needs Privy's app SECRET, which this service does not have and
 * should not need. So instead the identity wallet signs a message. Standard EIP-191, verified
 * with viem, no secret anywhere.
 *
 * The message BINDS the shielded address, so a captured signature cannot be replayed to fund a
 * different wallet, and carries a timestamp so an old one expires.
 *
 * PRIVACY NOTE, and it is the uncomfortable part: this request pairs an identity wallet with a
 * shielded one, in the clear, at this server. That pairing is exactly what the product hides
 * from everyone else. It is unavoidable — something must decide eligibility — but it means:
 *   1. never log the pair (see fundShielded: it logs neither address together),
 *   2. keep no record of it beyond the request,
 *   3. say so in the T&C rather than implying the link exists nowhere.
 */
import { recoverMessageAddress, isAddress, type Hex } from 'viem';
import { isAllowed } from './access.js';

/** How long a signed request stays valid. Short, because the only reason to hold one is replay. */
const MAX_AGE_MS = 5 * 60 * 1000;

export type FundRequest = {
  shielded: string;
  identity: string;
  signature: string;
  issuedAt: number;
};

/** The exact text the identity wallet signs. Must match the client byte for byte. */
export function fundMessage(shielded: string, issuedAt: number): string {
  return [
    'Hence Incognito — fund shielded wallet',
    '',
    `shielded: ${shielded.toLowerCase()}`,
    `issued:   ${issuedAt}`,
    '',
    'Signing proves you control this account. It authorises a small gas grant and nothing else.',
  ].join('\n');
}

export type VerifyResult = { ok: true; identity: string } | { ok: false; reason: string };

export async function verifyFundRequest(req: Partial<FundRequest>): Promise<VerifyResult> {
  const { shielded, identity, signature, issuedAt } = req;

  if (!shielded || !isAddress(shielded)) return { ok: false, reason: 'Not eligible for funding' };
  if (!identity || !isAddress(identity)) return { ok: false, reason: 'Not eligible for funding' };
  if (!signature || typeof signature !== 'string') return { ok: false, reason: 'Not eligible for funding' };
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'Not eligible for funding' };
  }

  // Reject both stale AND future-dated requests. A clock skewed forward would otherwise mint a
  // signature that stays valid far longer than intended.
  const age = Date.now() - issuedAt;
  if (age > MAX_AGE_MS || age < -60_000) return { ok: false, reason: 'Request expired — try again' };

  // Cohort first: cheaper than signature recovery, and it is the check that actually gates.
  if (!isAllowed(identity)) return { ok: false, reason: 'Not eligible for funding' };

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: fundMessage(shielded, issuedAt),
      signature: signature as Hex,
    });
  } catch {
    return { ok: false, reason: 'Not eligible for funding' };
  }

  // The signature must recover to the identity that was claimed — otherwise anyone could pair a
  // cohort address with someone else's signature and be funded on their eligibility.
  if (recovered.toLowerCase() !== identity.toLowerCase()) {
    return { ok: false, reason: 'Not eligible for funding' };
  }

  return { ok: true, identity: recovered };
}
