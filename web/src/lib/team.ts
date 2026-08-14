/* The team test cohort — one source of truth for the wallet gate. Public addresses
   (nothing secret in a bundle); UI gates rendering, the server gates the data. */
export const TEAM_WALLETS = new Set([
  '0xc6b45831511cd908f85765c0003a96d4f1adec93',
  '0x3919be84e2a75c03aa6ef2e82dda9419572c9464',
  '0x9cc6c5d8318c69b602b866f644628e61d98f55ed',
  '0x4be573b29944e2676da8cddeab7677b1519eb272',
]);
// hence.devTeam: dev-server-only escape hatch (same family as hence.devNoGate) so the
// cohort UI can be exercised without one of the four wallets. Compiled out of prod builds.
const devTeam = () => {
  try { return import.meta.env.DEV && sessionStorage.getItem('hence.devTeam') === '1'; } catch { return false; }
};
export const isTeamWallet = (addr?: string | null) =>
  (!!addr && TEAM_WALLETS.has(String(addr).toLowerCase())) || devTeam();
