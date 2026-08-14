/* Small, dependency-free guards for the legacy HTML-string renderers. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ');
}

export function safeSymbol(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9._:-]/g, '').slice(0, 32);
}

export function safeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, globalThis.location?.origin || 'https://hence.local');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return raw;
  } catch {
    return '';
  }
}
