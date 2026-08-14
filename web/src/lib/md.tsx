/* Markdown-lite → React elements, chat-grade. Covers what a modern AI chat needs:
   **bold**, *italic*, `code`, [label](https://…) links, #/##/### headings, - bullets,
   1. ordered lists, --- rules, and pipe TABLES (rendered scrollable). Everything renders
   to elements — never innerHTML — so model/tool text can't smuggle markup; links are
   https-only and open in a new tab.

   Inline ASSET CHIPS: pass opts.symbols (the assets the copilot actually researched) and
   every whole-word mention in the text renders as a live chip — venue assets open the
   Trade/Watch/Save popover (ChipMenu), research-only ones jump to their research page. */
import React from 'react';
import { Logo } from '../components/Logo';
import { openChipMenu } from '../components/ChipMenu';
// @ts-ignore — JS modules
import { getTicker } from './data.js';
// @ts-ignore — JS module
import * as market from './market.js';
// @ts-ignore — JS module
import { fmtPct } from './ui.js';

const HTTPS_RE = /^https:\/\/[\w.\-]+(?:\/[^\s]*)?$/;

export type MdOpts = { symbols?: string[]; researchSyms?: string[] };

/* one researched asset, inline in a sentence. Venue assets get the quiet Trade/Watch/Save
   popover; research-only ones go to their research page. */
function AssetChip({ sym, research }: { sym: string; research?: boolean }) {
  const t: any = getTicker(sym) || {};
  // research-only mentions NEVER borrow venue data: tickers collide across asset classes
  // (ALT the biotech vs ALT the crypto), so a research chip shows no price and always
  // routes to the research page — even when a same-ticker crypto perp exists.
  const live = !research && !!t.real && t.price > 0;
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!research && (market.isTradeable(sym) || live)) { openChipMenu(sym, e.currentTarget.getBoundingClientRect()); return; }
    // COLLIDED research symbol (a venue asset owns the bare ticker, e.g. ALT): the /stock
    // page belongs to the venue asset — route to the equity-native analysis page instead.
    location.hash = (research && market.isTradeable(sym) ? '#/analysis/' : '#/stock/') + sym;
  };
  return (
    <button className="md-tk" onClick={onClick} title={!research && t.name && t.name !== sym ? t.name : undefined}>
      <Logo sym={sym} size={13} kind={research ? 'equity' : undefined} />
      <b>{sym}</b>
      {live && t.chgPct != null ? <em className={(t.chgPct || 0) >= 0 ? 'up' : 'down'}>{fmtPct(t.chgPct || 0)}</em> : null}
    </button>
  );
}

/* plain-text segment → text + inline asset chips for whole-word symbol mentions */
let RESEARCH_SET = new Set<string>();
function chipify(text: string, symbols: Set<string>, keyBase: string): React.ReactNode[] {
  if (!symbols.size || !text) return text ? [text] : [];
  const out: React.ReactNode[] = [];
  const re = /[A-Z][A-Z0-9.\-]{1,11}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (!symbols.has(m[0])) continue;
    // word boundaries: the char before/after must not be alphanumeric
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    if ((before && /[A-Za-z0-9$#/]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<AssetChip key={keyBase + '-tk' + k++} sym={m[0]} research={RESEARCH_SET.has(m[0])} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* inline spans: **bold**, *italic*, `code`, [label](https://url) — then chipify plain runs */
function inline(text: string, keyBase: string, symbols: Set<string>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  const RE = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]{1,80})\]\((https:\/\/[^\s)]+)\)/;
  for (;;) {
    const m = rest.match(RE);
    if (!m || m.index === undefined) { out.push(...chipify(rest, symbols, keyBase + '-e')); break; }
    if (m.index > 0) out.push(...chipify(rest.slice(0, m.index), symbols, keyBase + '-' + k));
    const key = keyBase + '-' + k++;
    if (m[1] !== undefined) out.push(<strong key={key}>{chipify(m[1], symbols, key)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key} className="md-i">{m[2]}</em>);
    else if (m[3] !== undefined) out.push(<code key={key}>{m[3]}</code>);
    else if (m[4] !== undefined && HTTPS_RE.test(m[5])) {
      out.push(<a key={key} href={m[5]} target="_blank" rel="noopener noreferrer">{m[4]}</a>);
    } else out.push(m[0]);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const isTableRow = (t: string) => /^\|.*\|$/.test(t) || (t.includes('|') && t.split('|').length > 2);
const isTableSep = (t: string) => /^[\s|:-]+$/.test(t) && t.includes('-');
const splitRow = (t: string) => t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function md(text: string, opts?: MdOpts): React.ReactNode {
  if (!text) return null;
  const symbols = new Set((opts?.symbols || []).map((s) => String(s).toUpperCase()));
  RESEARCH_SET = new Set((opts?.researchSyms || []).map((s) => String(s).toUpperCase()));
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let para: string[] = [];
  let list: string[] = [];
  let olist: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={'p' + k++} className="md-p">{inline(para.join(' '), 'p' + k, symbols)}</p>);
    para = [];
  };
  const flushLists = () => {
    if (list.length) {
      blocks.push(<ul key={'u' + k++} className="md-ul">{list.map((li, i) => <li key={i}>{inline(li, 'l' + k + '-' + i, symbols)}</li>)}</ul>);
      list = [];
    }
    if (olist.length) {
      blocks.push(<ol key={'o' + k++} className="md-ol">{olist.map((li, i) => <li key={i}>{inline(li, 'ol' + k + '-' + i, symbols)}</li>)}</ol>);
      olist = [];
    }
  };
  const flushAll = () => { flushPara(); flushLists(); };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { flushAll(); continue; }
    // pipe table: header row + separator row → consume the whole block
    if (isTableRow(t) && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
      flushAll();
      const header = splitRow(t);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j].trim())) { rows.push(splitRow(lines[j].trim())); j++; }
      const tk = 't' + k++;
      blocks.push(
        <div key={tk} className="md-tablewrap">
          <table className="md-table">
            <thead><tr>{header.map((h, hi) => <th key={hi}>{inline(h, tk + '-h' + hi, symbols)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, tk + '-' + ri + '-' + ci, symbols)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      i = j - 1;
      continue;
    }
    if (/^-{3,}$/.test(t) || /^_{3,}$/.test(t) || /^\*{3,}$/.test(t)) { flushAll(); blocks.push(<hr key={'hr' + k++} className="md-hr" />); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushAll();
      blocks.push(<p key={'h' + k++} className={'md-h md-h' + h[1].length}>{inline(h[2], 'h' + k, symbols)}</p>);
      continue;
    }
    if (t.startsWith('- ') || t.startsWith('* ')) { flushPara(); if (olist.length) flushLists(); list.push(t.slice(2)); continue; }
    const on = t.match(/^(\d{1,2})[.)]\s+(.*)$/);
    if (on) { flushPara(); if (list.length) flushLists(); olist.push(on[2]); continue; }
    if (list.length || olist.length) flushLists();
    para.push(t);
  }
  flushAll();
  return <>{blocks}</>;
}
