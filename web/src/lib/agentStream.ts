import { optionalAuthApiFetch } from './auth-transport';

/* Fetch-reader SSE client for POST /api/agent (EventSource can't POST).
   Parses "event: X\ndata: {json}\n\n" frames from the streamed body and dispatches
   them to the caller. Resolves when the stream ends; throws on transport failure
   BEFORE any answer arrived (so the caller can fall back to /api/navigate). */

export type AgentEvent =
  | { type: 'phase'; label: string }
  | { type: 'tool'; name: string; label: string; status: 'run' | 'ok' | 'err'; ms?: number }
  | { type: 'plan'; plan: any; trace_id?: number | null }
  | { type: 'backtest'; result: any }
  | { type: 'answer'; text: string; actions?: { label: string; route: string }[]; links?: { label: string; url: string }[]; widget?: string; followups?: { label: string; query: string }[]; symbols?: string[]; research?: string[]; fallback?: boolean; reason?: string }
  | { type: 'error'; message: string; fallback?: boolean }
  | { type: 'done' };

export async function agentStream(
  body: { query: string; context?: any; history?: { q: string; a: string }[]; social?: boolean },
  onEvent: (e: AgentEvent) => void,
  opts?: { signal?: AbortSignal; headers?: Record<string, string> },
): Promise<{ gotAnswer: boolean }> {
  // optionalAuthApiFetch, NOT bare fetch: the agent personalizes get_user_context off the
  // bearer token, and this call was the one authenticated surface still sending none — so a
  // signed-in user asking "hedge my portfolio" was told to sign in, while looking at their
  // own positions. Auth stays optional by design: signed-out asks still work, just anonymous.
  const res = await optionalAuthApiFetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok || !res.body) throw new Error('agent unavailable (' + res.status + ')');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let gotAnswer = false;

  const dispatch = (frame: string) => {
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
      // lines starting with ':' are comments/heartbeats — ignored
    }
    if (!data) return;
    let payload: any;
    try { payload = JSON.parse(data); } catch { return; }
    if (event === 'answer') gotAnswer = true;
    onEvent({ type: event, ...payload } as AgentEvent);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let ix: number;
    while ((ix = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, ix);
      buf = buf.slice(ix + 2);
      if (frame.trim()) dispatch(frame);
    }
  }
  return { gotAnswer };
}
