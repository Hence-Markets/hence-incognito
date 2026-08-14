/* The team gate, asked of the server rather than shipped to the browser.

   The cohort list used to live in this file as a literal. That was wrong twice over: it put
   four wallet addresses in a public repo, and — because anything a Vite client can read is
   compiled into the bundle — a VITE_ env var would have shipped them just the same. The list
   now lives ONLY in the service's environment, and the client learns a single boolean about
   itself.

   Fail closed: any error, or being signed out, means no access. */
export async function checkAccess(address?: string | null): Promise<boolean> {
  if (!address) return false;
  try {
    const r = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.allowed;
  } catch {
    return false;
  }
}
