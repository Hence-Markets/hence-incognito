/* =========================================================
   AI client — talks to the local /api/ai proxy (DeepSeek),
   which injects the key server-side and caches by request.
   Every function passes REAL data in and is instructed to use
   only that data — the model writes prose, never invents facts.
   ========================================================= */
const SYS = 'You are Hence, a precise financial-markets writer embedded in an investing app. '
  + 'Rules: use ONLY the data provided in the user message; never invent prices, figures, ratings, '
  + 'dates, names, or facts; if a detail is missing, omit it rather than guessing; stay neutral and '
  + 'concise; output no preamble, disclaimers, or markdown headers unless asked.';

async function chat(messages, { temperature = 0.4, max_tokens = 400, json = false, endpoint = '/api/ai' } = {}) {
  const body = { messages, temperature, max_tokens };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j || j.error) throw new Error(j && j.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : 'ai error');
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}
const sys = { role: 'system', content: SYS };
const u = (s) => ({ role: 'user', content: s });

/* daily market recap — an editorial "what's happening & why" brief (Fey-style), NOT a price
   readout. News/events are the substance; price is light context woven in. */
export const recap = (world, data) =>
  chat([sys, u(`Write a flowing 2-3 sentence ${world === 'crypto' ? 'crypto market' : 'markets'} brief for someone opening the app — an intelligent, pleasurable read that explains WHAT IS HAPPENING AND WHY, the way a sharp market journalist would. `
    + `LEAD with the day's most important developments and themes from the news (catalysts, deals, launches, flows, regulation, macro, on-chain shifts), cover the 2-4 that matter, and connect them with a through-line so the reader actually understands the day. `
    + `Treat price/breadth as light CONTEXT only — weave in at most one or two figures, and never open with "X is up/down Y%". `
    + `Specific and grounded ONLY in this data; calm and readable, no hype, no preamble.\n`
    + `Data — the "news" array is the substance; sentiment/breadth/movers are context:\n${JSON.stringify(data)}`)], { max_tokens: 230, temperature: 0.5 });

/* Server-side best-of-3 recap: /api/recap generates 3 candidates, a judge picks the best, and it's
   SHARED-cached (~20 min) so every user/reload gets the same one instantly. Falls back to the
   single-shot client recap() if the endpoint is unavailable. */
export async function recapBest(world, data) {
  try {
    const social = (() => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } })();
    const r = await fetch('/api/recap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world, data, social }) });
    if (r.ok) { const j = await r.json(); if (j && j.recap) return j.recap; }
  } catch (e) { /* fall through to client single-shot */ }
  return recap(world, data);
}

/* Home news feed — turn real articles into Fey-style one-line analyst insights with the
   single most relevant ticker. One batched call → [{i, ticker, line}] keyed by article index. */
export async function feedDigest(world, articles) {
  const items = (articles || []).slice(0, 12).map((a, i) => ({
    i, sym: String(a.symbol || '').replace(/USD$/i, ''),
    title: a.title, text: String(a.text || '').slice(0, 280),
  }));
  if (!items.length) return [];
  const out = await chat([
    { role: 'system', content: SYS + ' You are a sharp markets editor curating a desk feed. You favor substance over noise.' },
    u(`For EACH article below: write ONE neutral sentence (14-26 words) stating the single most important fact and its driver — not a vague restatement of the headline. `
      + `Give the most relevant TICKER (uppercase company/coin symbol, e.g. NVDA, BTC, TSLA) or "" if purely macro. `
      + `Set "skip": true for LOW-SIGNAL noise we should drop — pure price-target/technical-analysis prediction ("X could hit $Y", "RSI/Elliott-wave says…"), horoscope-style speculation, thin promo/affiliate, or rehashed sentiment with no new fact. Set skip=false for SUBSTANTIVE news: deals, launches, products, regulation, earnings, on-chain flows, partnerships, hacks, listings, real catalysts. `
      + `Return JSON {"items":[{"i":number,"ticker":string,"line":string,"skip":boolean}]} preserving each article's i. Ground strictly in the title/text; never invent figures.\n`
      + `Articles:\n${JSON.stringify(items)}`)],
    { max_tokens: 1200, json: true, temperature: 0.45 });
  try { const r = JSON.parse(out); return Array.isArray(r.items) ? r.items : []; } catch (e) { return []; }
}

/* expanded "Read more" daily brief — a narrative, theme-organized read. When `recap` is passed,
   the brief EXPANDS that exact recap (same lead stories, same through-line) so preview and
   Read more never tell different editions. */
export async function dailyBrief(world, data, recap = '') {
  const anchor = recap
    ? `The reader has just seen this short recap and tapped "Read more". EXPAND EXACTLY THIS RECAP — same lead stories, same through-line, deepened with the what/why/impact from the data; introduce NO new lead story it does not mention.\nTHE RECAP:\n${recap}\n\n`
    : '';
  return chat([sys, u(anchor + `Write a ${world === 'crypto' ? 'crypto' : 'markets'} daily brief in 3-4 short flowing paragraphs — a pleasurable, intelligent read that helps the reader UNDERSTAND the day, not a price report. No headers, no preamble.\n`
    + `Organize it around the day's biggest STORIES & THEMES from the headlines: for each, explain what happened, why it matters, and who/what it touches (companies, sectors, tokens) — weaving the relevant price moves in as supporting context, never as the focus. Draw connections between related developments so it reads as a coherent narrative. Close the final paragraph with what to watch next. `
    + `Be specific and grounded ONLY in this data; calm, clear, analytical, no hype.\n`
    + `Data — the "news" array is the substance; sentiment/breadth/movers are context:\n${JSON.stringify(data)}`)], { max_tokens: 720, temperature: 0.5 });
}

/* SHARED best-of-3 "Read more" brief. Pass the on-screen recap: the server generates the brief as
   an EXPANSION of it and caches by the recap's hash — identical for everyone looking at that recap,
   and never a different edition from the preview. Preloaded in the background on the home so opening
   "Read more" is instant. Falls back to a single client-side dailyBrief if the endpoint is down. */
export async function briefBest(world, data, recap = '') {
  try {
    const social = (() => { try { return localStorage.getItem('hence.elfaSocial') === '1'; } catch { return false; } })();
    const r = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world, data, recap, social }) });
    if (r.ok) { const j = await r.json(); if (j && j.brief) return j.brief; }
  } catch (e) { /* fall through to client single-shot */ }
  return dailyBrief(world, data, recap);
}

/* one-line "what you need to know today" headline */
export const whatToKnow = (world, data) =>
  chat([sys, u(`In one headline sentence (max 22 words), state the single most important thing for a ${world} investor now, using only this data.\n${JSON.stringify(data)}`)], { max_tokens: 60, temperature: 0.5 });

/* 2-sentence per-asset market summary */
export const assetSummary = (data) =>
  chat([sys, u(`Write a 2-sentence summary for ${data.name || data.sym}: price action plus the most notable provided metric. Grounded only in this data.\n${JSON.stringify(data)}`)], { max_tokens: 130 });

/* condense real news headlines into a 1-2 sentence digest (string, back-compat) */
export const newsDigest = (name, headlines) =>
  chat([sys, u(`Summarize the key takeaway across these ${name} headlines in 1-2 sentences; add no facts beyond them.\n${JSON.stringify(headlines)}`)], { max_tokens: 130 });

/* Rich news digest — ONE DeepSeek call returns both the AI summary AND per-article
   sentiment, so the News card, the takeover lead, "Other headlines" badges and the
   provenance chip are all served without a second LLM round-trip.
   Input: articles [{ title, text?, site? }]. Output:
     { summary, sentiment:'Positive|Negative|Neutral', items:[{ i, sentiment }],
       generated_at (ISO), sources (distinct source-name count) }
   The caller caches the whole object alongside the fetched articles. */
export async function newsDigestFull(name, articles) {
  const list = (articles || []).slice(0, 12).map((a, i) => ({
    i, title: a.title, text: String(a.text || '').slice(0, 220),
  }));
  const sourcesSet = new Set((articles || []).map((a) => a.site || a.publisher).filter(Boolean));
  const generated_at = new Date().toISOString();
  if (!list.length) return { summary: '', sentiment: 'Neutral', items: [], generated_at, sources: sourcesSet.size };
  const out = await chat([sys, u(
    `For ${name}: (1) write a 2-4 sentence neutral summary of the key takeaway ACROSS these headlines, adding no facts beyond them; `
    + `(2) classify the OVERALL sentiment of the coverage; (3) classify EACH article's sentiment. `
    + `Sentiment is one of "Positive", "Negative", "Neutral" (market impact for ${name}). `
    + `Return JSON {"summary":string,"sentiment":"Positive|Negative|Neutral","items":[{"i":number,"sentiment":"Positive|Negative|Neutral"}]} preserving each article's i.\n`
    + `Articles:\n${JSON.stringify(list)}`)],
    { max_tokens: 700, json: true, temperature: 0.4 });
  try {
    const r = JSON.parse(out);
    return {
      summary: (r.summary || '').trim(),
      sentiment: r.sentiment || 'Neutral',
      items: Array.isArray(r.items) ? r.items : [],
      generated_at,
      sources: sourcesSet.size,
    };
  } catch (e) {
    return { summary: (out || '').trim(), sentiment: 'Neutral', items: [], generated_at, sources: sourcesSet.size };
  }
}

/* structured multi-section analysis → { sections:[{title,body}], verdict }.
   Prompt + sections adapt to the asset type — an equity research note, a crypto perp
   brief, or a commodity/index/fx macro brief — because "revenue/EPS/P/E" is meaningless
   for a token or for gold. */
function equityPrompt(data) {
  return `You are writing an institutional-grade equity research note on ${data.name || data.sym} that a real analyst would read. `
    + `Return a JSON object {"sections":[{"title":string,"body":string}],"verdict":string}. Write these sections IN ORDER, each a `
    + `dense, specific paragraph of 4-6 sentences that cites the ACTUAL figures from the data:\n`
    + `- "Business": what the company does, its segments, how it makes money, and its scale.\n`
    + `- "Financial health": revenue, gross/operating/net margins and profitability, PLUS balance-sheet strength from balanceSheet (cash vs total/net debt, equity) and cash generation from cashFlow (operating cash flow, free cash flow).\n`
    + `- "Growth & earnings": the multi-year revenue/EPS trajectory from incomeTrend, the latest beat/miss vs estimates (use epsSurprisePct), the forward-estimate direction, and catalysts visible in recentNews.\n`
    + `- "Valuation": P/E, EV/EBITDA, earnings yield, and where the stock trades versus the consensus price target and its high/low — quantify the implied upside/downside and premium/discount; reference the peers list if provided.\n`
    + `- "Strengths": the durable competitive advantages and what is concretely working (margins, free cash flow, buybacks).\n`
    + `- "Risks & challenges": the genuine headwinds and what could go wrong.\n`
    + `Rules: ground EVERY claim strictly in the provided data; cite numbers; NEVER invent figures; OMIT any section/point whose data is missing rather than padding. Balanced, not promotional. `
    + `"verdict" = two neutral sentences on the investment case + the single key watch-item.\nData:\n${JSON.stringify(data)}`;
}
function cryptoPrompt(data) {
  const nm = (data.profile && data.profile.displayName) || data.name || data.sym;
  return `You are writing a sharp crypto-asset brief on ${nm} (${data.sym}) for an active perp trader. `
    + `Return a JSON object {"sections":[{"title":string,"body":string}],"verdict":string}. Each section a dense 3-5 sentence paragraph grounded in the data:\n`
    + `- "Overview": what this asset/protocol is and the sector it belongs to — use the profile (category, description, keywords).\n`
    + `- "Fundamentals & tokenomics": from "fundamentals" — market-cap rank, market cap vs fully-diluted valuation (a large FDV/mcap gap = future dilution/unlock overhang), circulating vs total supply (pctCirculating), how far price sits below its all-time high (athDrawdownPct), and the sector (categories). Cite only figures present in the data.\n`
    + `- "Market structure": read the live data — mark price, 24h volume, open interest and funding APR. Explain what they imply about leverage and positioning (high positive funding = crowded longs paying to hold; rising OI with price = real demand; deep negative funding = crowded shorts). If 24h volume and open interest are small in absolute terms, say so and treat the funding/positioning read as weak signal, not conviction.\n`
    + `- "Momentum & price action": the 24h move plus the 7d/30d/1y changes from "change" if present (use change.y1 for the year — never the daily move), and what the trend suggests.\n`
    + `- "Narrative & catalysts": the narrative/sector it's tied to and any specific catalysts visible in recentNews.\n`
    + `- "Risks": volatility, funding/liquidation risk on leverage, dilution/unlock overhang, liquidity/OI concentration, and narrative-driven downside.\n`
    + `Ground all figures strictly in the data; you may use general knowledge of WHAT the asset/category is, but never invent prices, funding, supply, or volume numbers. OMIT any section/point whose data is missing rather than padding. `
    + `"verdict" = two neutral sentences on the setup + the key thing to watch.\nData:\n${JSON.stringify(data)}`;
}
function macroPrompt(data) {
  const kind = data.assetClass === 'commodity' ? 'commodity' : data.assetClass === 'fx' ? 'currency / FX rate' : 'market index';
  const nm = (data.profile && data.profile.displayName) || data.name || data.sym;
  return `You are writing a concise markets brief on ${nm} (${data.sym}), a ${kind}. `
    + `Return a JSON object {"sections":[{"title":string,"body":string}],"verdict":string}. Each section a dense 3-5 sentence paragraph:\n`
    + `- "Overview": what this ${kind} is and what it represents or tracks${data.assetClass === 'index' ? ' — for an index, its notable constituents/weightings and what a move signals' : ''} — use the profile plus general knowledge.\n`
    + `- "Level & positioning": the live price and 24h move, and — using "quote" — where the current level sits within its 52-week range (yearHigh/yearLow) and versus its 50- and 200-day moving averages (priceAvg50/priceAvg200) when present. It also trades as a perp: mention open interest and funding, BUT if the perp's OI/volume are small, treat them as venue color, not a meaningful positioning signal.\n`
    + `- "Drivers": the macro forces that move this ${kind} (rates, the US dollar, supply/demand, inflation, risk sentiment) — specific to this asset and anchored to any dated catalysts in recentNews.\n`
    + `- "Risks": the key risks to the current setup.\n`
    + `Ground all FIGURES strictly in the provided data; use general knowledge for what the asset is and its typical drivers, but never invent specific prices or numbers. OMIT any point whose data is missing. `
    + `"verdict" = two neutral sentences.\nData:\n${JSON.stringify(data)}`;
}
export async function analyze(data) {
  const cls = data.assetClass || 'equity';
  const prompt = cls === 'equity' ? equityPrompt(data) : cls === 'crypto' ? cryptoPrompt(data) : macroPrompt(data);
  const out = await chat([sys, u(prompt)],
    // shared per-symbol/day cache so one user's report is served to everyone (amortizes the deeper call)
    { max_tokens: 2200, json: true, endpoint: '/api/analysis?symbol=' + encodeURIComponent(data.sym || data.name || '') });
  try { return JSON.parse(out); } catch (e) { return { sections: [{ title: 'Analysis', body: out }], verdict: '' }; }
}

/* Peer-comparison take — a grounded read of where a stock sits versus its peer group.
   Fed the real peer table (P/E, EV/sales, FCF/share, LTM revenue, market cap); writes a
   skeptical relative-valuation paragraph. Share-cached per symbol/day like analyze(). */
export async function peerAnalysis({ sym, name, sector, rows, medians }) {
  const subject = (rows || []).find((r) => r && r.isSubject);
  const peers = (rows || []).filter((r) => r && !r.isSubject);
  if (!subject || !peers.length) return null;
  const n = (v, d = 1) => (v == null || isNaN(v)) ? 'n/a' : (+v).toFixed(d);
  const usd = (v) => {
    if (v == null || isNaN(v)) return 'n/a';
    const a = Math.abs(v);
    if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    return '$' + n(v, 0);
  };
  const line = (r) => `${r.sym} (P/E ${n(r.pe)}, EV/sales ${n(r.evSales, 2)}, FCF/share ${n(r.fcfPerShare, 2)}, LTM revenue ${usd(r.ltmRevenue)}, market cap ${usd(r.mktCap)})`;
  const medLine = medians
    ? `Peer MEDIANS (use these exact figures — do not recompute): P/E ${n(medians.pe)}, EV/sales ${n(medians.evSales, 2)}, FCF/share ${n(medians.fcfPerShare, 2)}, LTM revenue ${usd(medians.ltmRevenue)}, market cap ${usd(medians.mktCap)}.`
    : '';
  const out = await chat([sys, u(
    `${name || sym} (${sym}) versus its peer group${sector ? ' in ' + sector : ''}. Return JSON {"take":string}. `
    + `In "take" (3-4 sentences) assess ${sym}'s RELATIVE positioning: whether it is cheap or expensive vs the peer median on P/E and EV/sales, how its scale (market cap, LTM revenue) and cash generation (FCF/share) stack up against the group, and what the valuation gap implies — a growth premium, a distress discount, or fair value. Cite specific multiples and the peer median. Be concrete and skeptical, no hype; ground every figure strictly in the data, and use the provided peer MEDIANS verbatim.\n`
    + `${medLine}\nSubject — ${line(subject)}.\nPeers — ${peers.map(line).join('; ')}.`)],
    { max_tokens: 380, json: true, endpoint: '/api/analysis?symbol=' + encodeURIComponent(sym + '-peers') });
  try { const r = JSON.parse(out); return { take: r.take || '' }; } catch (e) { return { take: out }; }
}

/* Live trade copilot — a grounded directional read of one perp market for the terminal.
   ctx carries real microstructure (mark, book imbalance/spread/depth, funding, volatility,
   momentum) + the user's current position. The model reasons from order-flow; it must derive
   any price level from the numbers given and never invent figures. Returns structured JSON. */
const COPILOT_SYS = SYS
  + ' You are acting as a disciplined perp-trading copilot inside a live terminal. Reason strictly from '
  + 'the supplied microstructure: order-book imbalance and spread, funding, realized volatility, 24h momentum, '
  + 'and the user\'s open position. Derive entry/stop/target levels from the given mark and volatility — never '
  + 'output a number not computable from the data. Be decisive but never promise outcomes; always frame risk.';
export async function tradeCopilot(ctx) {
  const out = await chat([
    { role: 'system', content: COPILOT_SYS },
    u(`Return a JSON object {"bias":"Long|Short|Neutral","conviction":"low|medium|high","entry":string,`
      + `"stop":string,"target":string,"rationale":string,"risk":string,"position":string} for the ${ctx.sym} perp.\n`
      + `"entry"/"stop"/"target": concrete USD price levels (or a tight range) computed from the provided mark, `
      + `book levels and volatility — no invented numbers. "rationale": 2-3 sentences citing the book imbalance, `
      + `spread, funding and momentum specifically. "risk": one sentence on the dominant risk to this idea. `
      + `"position": one sentence of concrete advice on the user's current position, or "" if they are flat. `
      + `Use ONLY this data:\n${JSON.stringify(ctx)}`)],
    { max_tokens: 520, json: true, temperature: 0.5 });
  try {
    const r = JSON.parse(out);
    return {
      bias: r.bias || 'Neutral', conviction: r.conviction || 'low',
      entry: r.entry || '', stop: r.stop || '', target: r.target || '',
      rationale: r.rationale || '', risk: r.risk || '', position: r.position || '',
    };
  } catch (e) {
    return { bias: 'Neutral', conviction: 'low', entry: '', stop: '', target: '', rationale: out, risk: '', position: '' };
  }
}

/* summarize one earnings report → { headline, strengths[], challenges[], summary } */
export async function earningsSummary(data) {
  const out = await chat([sys, u(
    `Return JSON {"headline":string,"strengths":[string],"challenges":[string],"summary":string} for `
    + `${data.name || data.sym}'s earnings, grounded only in this data (EPS/revenue actual vs estimate, surprise).\n`
    + `${JSON.stringify(data)}`)], { max_tokens: 500, json: true });
  try { return JSON.parse(out); } catch (e) { return { headline: out, strengths: [], challenges: [], summary: '' }; }
}
