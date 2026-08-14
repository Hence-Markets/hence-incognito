/* Same-origin authenticated transport. The Privy bearer token stays inside this
   module closure and is never exposed on `window` or returned to callers. */
type TokenProvider = (() => Promise<string | null>) | null;

let tokenProvider: TokenProvider = null;
let signedIn = false;
let authGeneration = 0;

export function setAuthTokenProvider(provider: TokenProvider, authenticated: boolean) {
  tokenProvider = provider;
  signedIn = authenticated;
  // Invalidates token requests that began under an older login session. Without
  // this guard, a slow getAccessToken() could resolve after logout/account switch
  // and still be attached to a request made by the now-signed-out UI.
  authGeneration += 1;
}

async function accessToken(): Promise<string | null> {
  if (!tokenProvider || !signedIn) return null;
  const provider = tokenProvider;
  const generation = authGeneration;
  let token = await provider().catch(() => null);
  // Privy can mark a new session authenticated a moment before its token is mintable.
  if (!token && signedIn && generation === authGeneration && provider === tokenProvider) {
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    token = await provider().catch(() => null);
  }
  return signedIn && generation === authGeneration && provider === tokenProvider ? token : null;
}

function sameOriginApi(input: string): string {
  const url = new URL(input, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Authenticated transport only permits same-origin /api requests.');
  }
  return url.pathname + url.search;
}

export async function authenticatedApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new Error('AUTH_REQUIRED');
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(sameOriginApi(input), { ...init, headers });
}

export async function optionalAuthApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(sameOriginApi(input), { ...init, headers });
}
