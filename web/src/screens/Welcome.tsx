import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/welcome.css';
import { Icon } from '../components/Icon';
import { HenceLogo } from '../components/HenceLogo';
import { icon as iconStr, toast } from '../lib/ui.js';
import { getTicker } from '../lib/data.js';
import { useAuth } from '../hooks/useAuth';
import { useMe } from '../hooks/useMe';
import { INTEREST_GROUPS, keyOf } from '../lib/interests.js';
import * as stash from '../lib/stash';
import * as me from '../lib/me.js';
import { optionalAuthApiFetch } from '../lib/auth-transport';
import { addWatch, hasWatch, watchList } from '../lib/watch';
import { PERSONA_KEY } from '../lib/persona';
import { openCommandPalette } from './command.js';

const DEMO_EMAIL = 'samlee.mobbin@gmail.com';
// real email once signed in, else the demo persona for the preview flow
function useDisplayEmail() {
  const auth = useAuth();
  if (!auth.authenticated) return DEMO_EMAIL;                       // logged-out preview only
  return auth.email || (auth.xHandle ? '@' + auth.xHandle : '') || auth.shortAddr || 'wallet';
}

/* ---- Hence brand mark (tri-dot) ---- */
function HenceMark({ size = 30 }: { size?: number }) {
  return <HenceLogo size={size} />;
}

/* ---- close X (top-left) → back to dashboard ---- */
function CloseX({ href = '#/' }: { href?: string }) {
  return (
    <a className="welcome-close" href={href} aria-label="Close">
      <Icon name="close" size={16} />
    </a>
  );
}

/* ---- top-left "Sign out (email)" ---- */
function Signout() {
  const email = useDisplayEmail();
  return (
    <a className="welcome-signout" href="#/login">
      <Icon name="signout" size={14} /> Sign out{' '}
      <span className="welcome-signout__em">({email})</span>
    </a>
  );
}

/* ---- google glyph ---- */
function GGlyph() {
  return (
    <svg className="welcome-g" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.5 12.2c0-.8-.07-1.4-.2-2.1H12v3.9h6c-.12 1-.78 2.5-2.24 3.5l-.02.14 3.25 2.5.22.02c2.07-1.9 3.27-4.7 3.27-7.96z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.96 0 5.45-.97 7.26-2.65l-3.46-2.66c-.92.64-2.16 1.09-3.8 1.09-2.9 0-5.36-1.9-6.24-4.55l-.13.01-3.38 2.6-.04.12C3.85 20.4 7.64 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.76 14.23c-.23-.68-.36-1.4-.36-2.15s.13-1.47.35-2.15l-.006-.14-3.42-2.64-.11.05A10.9 10.9 0 001 12.08c0 1.77.43 3.45 1.18 4.93l3.58-2.78z"
      />
      <path
        fill="#EB4335"
        d="M12 5.4c2.06 0 3.45.88 4.24 1.62l3.1-3C17.45 2.2 14.96 1.16 12 1.16 7.64 1.16 3.85 3.76 2.18 7.55l3.57 2.78C6.64 7.68 9.1 5.4 12 5.4z"
      />
    </svg>
  );
}

/* ---- icon with custom stroke width (Icon component fixes sw=1.7) ---- */
function IconSw({ name, size, sw }: { name: string; size: number; sw: number }) {
  return (
    <span
      style={{ display: 'inline-flex', flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: iconStr(name, size, sw) }}
    />
  );
}

/* ---- ticker chip ---- */
function LogoChip({ sym, size = 18 }: { sym: string; size?: number }) {
  const t: any = getTicker(sym);
  const c = t ? t.color : '#3f3f46';
  return (
    <span
      className="welcome-chip"
      style={{
        ['--lc' as any]: c,
        width: size + 'px',
        height: size + 'px',
        fontSize: Math.round(size * 0.46) + 'px',
      }}
    >
      {sym[0]}
    </span>
  );
}

/* ===================== STEP 1 — Access pass ===================== */
function PassStep({ goStep }: { goStep: (s: string) => void }) {
  return (
    <>
      <CloseX href="#/" />
      <div className="welcome-pass">
        <div className="welcome-lanyard" />
        <div className="welcome-card3d">
          <div className="welcome-card3d__mark">
            <HenceMark size={40} />
          </div>
          <div className="welcome-card3d__title">Hence VIP Access</div>
          <div className="welcome-card3d__foot">Access pass</div>
        </div>
        <button className="welcome-pass__hit" aria-label="Continue" onClick={() => goStep('signup')} />
      </div>
    </>
  );
}

/* ===================== YOUR pass — post-onboarding reveal (@name + constellation) ===================== */

// canvas share card: everything is drawn (no external assets) so toBlob never taints.
// 840×1160 = a 2x-scale portrait card; literal colors mirror the app's :root vars.
function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

const PASS_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function drawPassPNG(handle: string, chips: string[]): Promise<Blob | null> {
  const W = 840, H = 1160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  if (!x) return Promise.resolve(null);

  x.fillStyle = '#0a0a0b';
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 330, 60, W / 2, 330, 560);
  glow.addColorStop(0, 'rgba(244,170,110,0.10)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  const cw = 560, ch = 800, cx = (W - cw) / 2, cy = 160;
  roundRect(x, cx, cy, cw, ch, 36);
  const lg = x.createLinearGradient(cx, cy, cx + cw, cy + ch);
  lg.addColorStop(0, '#1c1d22');
  lg.addColorStop(0.65, '#0d0e11');
  x.fillStyle = lg;
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.11)';
  x.lineWidth = 2;
  x.stroke();

  // lanyard slot
  roundRect(x, W / 2 - 45, cy + 34, 90, 20, 12);
  x.fillStyle = '#050506';
  x.fill();

  // tri-dot mark (HenceLogo geometry: 32-box, dots (16,10.3)(11,18.8)(21,18.8) r2.5)
  const s = 120 / 32, ox = W / 2 - 60, oy = cy + 96;
  x.fillStyle = '#2c2d33';
  ([[16, 10.3], [11, 18.8], [21, 18.8]] as [number, number][]).forEach(([dx, dy]) => {
    x.beginPath();
    x.arc(ox + dx * s, oy + dy * s, 2.5 * s, 0, Math.PI * 2);
    x.fill();
  });

  x.textAlign = 'center';
  const grad = x.createLinearGradient(W / 2 - 180, 0, W / 2 + 180, 0);
  grad.addColorStop(0, '#f0a868');
  grad.addColorStop(0.5, '#f6cba2');
  grad.addColorStop(1, '#f6e7d6');
  x.fillStyle = grad;
  x.font = `700 54px ${PASS_FONT}`;
  x.fillText('@' + handle, W / 2, cy + 330, cw - 48);   // clamp: long handles condense, never spill
  x.fillStyle = '#c8835a';
  x.font = `600 21px ${PASS_FONT}`;
  x.fillText('H E N C E   A C C E S S', W / 2, cy + 372);

  // constellation chips — greedy centered rows
  x.font = `500 22px ${PASS_FONT}`;
  const pillH = 46, gap = 14, maxW = cw - 80;
  let rows: { label: string; w: number }[][] = [[]], rw = 0;
  chips.slice(0, 6).forEach((label) => {
    const w = Math.min(x.measureText(label).width + 44, maxW);
    if (rw + w + (rows[rows.length - 1].length ? gap : 0) > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
    rows[rows.length - 1].push({ label, w });
    rw += w + gap;
  });
  let py = cy + 440;
  rows.forEach((row) => {
    const total = row.reduce((a, b) => a + b.w, 0) + gap * (row.length - 1);
    let px = W / 2 - total / 2;
    row.forEach(({ label, w }) => {
      roundRect(x, px, py, w, pillH, pillH / 2);
      x.fillStyle = 'rgba(255,255,255,0.045)';
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.11)';
      x.lineWidth = 1.5;
      x.stroke();
      x.fillStyle = '#9a9aa2';
      x.fillText(label, px + w / 2, py + pillH / 2 + 8, w - 24);
      px += w + gap;
    });
    py += pillH + gap;
  });

  x.fillStyle = '#6a6a72';
  x.font = `500 19px ${PASS_FONT}`;
  x.fillText('beliefs → trades · hence.markets', W / 2, cy + ch - 44);

  return new Promise((res) => c.toBlob(res, 'image/png'));
}

function YourPassStep({ goStep }: { goStep: (s: string) => void }) {
  const auth = useAuth();
  const { me: profile } = useMe();
  const persona = useMemo(() => derivePersona(profile), [profile]);
  const [busy, setBusy] = useState(false);
  // cap at the server's 20-char handle limit — the email-localpart fallback is unbounded
  // and long names overflow both the DOM card and the drawn PNG. A claim stashed by the
  // onboarding step (server hiccup) still names the card: PendingHandleRunner re-claims
  // it in the background, so show it optimistically instead of "trader".
  const pendingHandle = (() => { try { return localStorage.getItem('hence.pendingHandle') || ''; } catch { return ''; } })();
  const handle = ((profile?.handle || pendingHandle || auth.xHandle || (auth.email ? auth.email.split('@')[0] : '') || 'trader')
    .toLowerCase().replace(/[^a-z0-9_]/g, '') || 'trader').slice(0, 20);
  const chips = [...persona.keys].map((k) => CHIP_LABEL[k]).filter(Boolean).slice(0, 6) as string[];
  const month = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();

  // space also continues (tour rhythm) — but never steal Enter/space from a focused
  // button/link/input, or keyboard users could never activate Download/Share
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('button, a, input, textarea, select, [role="dialog"]')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); goStep('command'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goStep]);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await drawPassPNG(handle, chips);
      if (!blob) { toast('Could not draw the card'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hence-pass-${handle}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally { setBusy(false); }
  };
  // opens X's compose window prefilled — nothing posts until the user hits Post there
  const onShare = () => {
    const text = `Claimed @${handle} on Hence — beliefs → trades.`;
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text + ' hence.markets'), '_blank', 'noopener');
  };

  return (
    <>
      <div className="welcome-glow" />
      <div className="welcome-mypass">
        <h1 className="welcome-h">Your <span className="welcome-grad">pass</span></h1>
        <p className="welcome-sub">One name, one universe. Take the card, then a quick look at how to get around.</p>
        <div className="welcome-card3d welcome-card3d--mine">
          <div className="welcome-card3d__mark"><HenceMark size={40} /></div>
          <div className="welcome-card3d__title">@{handle}</div>
          <div className="welcome-mypass__sub">HENCE ACCESS · {month}</div>
          {chips.length ? (
            <div className="welcome-mypass__chips">
              {chips.slice(0, 4).map((c) => <span key={c}>{c}</span>)}
            </div>
          ) : null}
          <div className="welcome-card3d__foot">beliefs → trades</div>
        </div>
        <div className="welcome-mypass__actions">
          <button type="button" className="welcome-ftbtn" onClick={onDownload} disabled={busy}>
            <IconSw name="download" size={13} sw={1.8} /> {busy ? 'Drawing…' : 'Download card'}
          </button>
          <button type="button" className="welcome-ftbtn" onClick={onShare}>Share on 𝕏</button>
          <button type="button" className="welcome-setup" onClick={() => goStep('command')}>Continue</button>
        </div>
        <p className="welcome-setupnote">PNG is drawn locally — nothing is posted unless you post it.</p>
      </div>
    </>
  );
}

/* ===================== STEP 2/3/4 — Signup ===================== */
function SignupStep({ goStep }: { goStep: (s: string) => void }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setTimeout(() => {
      goStep('inbox');
    }, 1100);
  };

  return (
    <>
      <CloseX href="#/" />
      <div className="welcome-glow" />
      <div className="welcome-signup">
        <h1 className="welcome-h">
          Welcome to <span className="welcome-grad">Hence</span>
        </h1>
        <p className="welcome-sub">
          Thank you for signing up. To start enjoying the<br />
          benefits, let's set up your account.
        </p>
        <form className="welcome-emailrow" data-form onSubmit={onSubmit}>
          <input
            className="welcome-email"
            type="email"
            placeholder="account email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={loading}
          />
          <button
            className="welcome-arrow"
            type="submit"
            aria-label="Submit"
            {...(loading ? { 'data-loading': true } : {})}
          >
            {loading ? <span className="welcome-spin" /> : <IconSw name="arrowUp" size={16} sw={1.7} />}
          </button>
        </form>
        <button className="welcome-google" onClick={() => goStep('inbox')}>
          Signup with Email
        </button>
      </div>
      <p className="welcome-tos">
        By signing up, you agree to our <b><a href="#/legal/terms" style={{ color: 'inherit' }}>Terms of Service</a></b>.
      </p>
    </>
  );
}

/* ===================== STEP 5 — Check your inbox ===================== */
function InboxStep({ goStep }: { goStep: (s: string) => void }) {
  const email = useDisplayEmail();
  return (
    <>
      <CloseX href="#/" />
      <div className="welcome-glow" />
      <div className="welcome-signup">
        <h1 className="welcome-h">
          Check your <span className="welcome-grad">inbox</span>
        </h1>
        <p className="welcome-sub">
          We have sent you a secure login link. Please click<br />
          the link to authenticate your account.
        </p>
        <div className="welcome-emailrow is-done">
          <span className="welcome-email welcome-email--done">{email}</span>
          <span className="welcome-check">
            <IconSw name="check" size={14} sw={2} />
          </span>
        </div>
        <button className="welcome-back" onClick={() => goStep('signup')}>
          Back to Signup
        </button>
      </div>
      <p className="welcome-tos">
        By signing up, you agree to our <b><a href="#/legal/terms" style={{ color: 'inherit' }}>Terms of Service</a></b>.
      </p>
    </>
  );
}

/* ===================== STEP 6 — Splash ===================== */
function SplashStep({ goStep }: { goStep: (s: string) => void }) {
  return (
    <div className="welcome-splash">
      <button className="welcome-splash__mark" aria-label="Continue" onClick={() => goStep('testimonials')}>
        <HenceMark size={46} />
      </button>
    </div>
  );
}

/* ===================== STEP 7 — Testimonials ===================== */
const TESTIMONIALS = [
  {
    name: 'Sahil Lavingia',
    verified: true,
    role: 'CEO of Gumroad',
    quote:
      'Hence lets me see and manage my whole portfolio across complex charts I never knew I needed, creating a workflow you can know better than any other.',
    color: '#7c6cf0',
    glyph: 'S',
  },
  {
    name: 'Lachy Groom',
    verified: true,
    role: 'Investor, Co-founder of Physical Intelligence',
    quote:
      'The team at Hence truly masters the details. Their products are both beautiful and incredibly functional, showing just how much they care about getting everything right.',
    color: '#e8a06a',
    glyph: 'L',
  },
  {
    name: 'Guillermo Rauch',
    verified: true,
    role: 'CEO of Vercel',
    quote:
      'Hence is one of my favorite design and product teams out there. I love how they always share how the sausage is made.',
    color: '#5fcf91',
    glyph: 'G',
  },
  {
    name: 'Stammy',
    verified: true,
    role: 'Founder & Investor',
    quote:
      "I love Hence so much! Such a well crafted investment/stocks research tool I use if you don't trade frequently it's worth checking out for the polish alone.",
    color: '#5b6cf0',
    glyph: 'P',
  },
];

function Avatar({ t }: { t: (typeof TESTIMONIALS)[number] }) {
  return (
    <span className="welcome-av" style={{ ['--av' as any]: t.color }}>
      {t.glyph}
    </span>
  );
}

function TestimonialsStep({ goStep }: { goStep: (s: string) => void }) {
  return (
    <>
      <Signout />
      <div className="welcome-glow welcome-glow--low" />
      <div className="welcome-test">
        <h1 className="welcome-h">
          Among the brightest <span className="welcome-grad">minds</span>
        </h1>
        <p className="welcome-sub">
          From casual users to pros, you inspire us. That's why so many<br />
          choose Hence, and we're excited to have you on board.
        </p>
        <div className="welcome-cards">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className={`welcome-tcard ${i === 0 ? 'is-edge' : ''} ${
                i === TESTIMONIALS.length - 1 ? 'is-edge' : ''
              }`}
            >
              <div className="welcome-tcard__head">
                <Avatar t={t} />
                <div className="welcome-tcard__id">
                  <div className="welcome-tcard__name">
                    {t.name}
                    {t.verified ? (
                      <span className="welcome-vf">
                        <IconSw name="check" size={9} sw={2.4} />
                      </span>
                    ) : null}
                  </div>
                  <div className="welcome-tcard__role">{t.role}</div>
                </div>
              </div>
              <p className="welcome-tcard__q">{t.quote}</p>
            </div>
          ))}
        </div>
        <button className="welcome-setup" onClick={() => goStep('command')}>
          Show me around
        </button>
        <p className="welcome-setupnote">The tour takes about 30 seconds</p>
      </div>
    </>
  );
}

/* ===================== keyboard illustration ===================== */
function Keyboard({ lit }: { lit?: boolean }) {
  const rows: number[][] = [
    // function row
    Array(16).fill(1),
    // number row
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6, 1, 1, 1, 1, 1, 1, 1],
    // qwerty row
    [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    // asdf row
    [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6, 1, 1, 1, 1, 1, 1],
    // zxcv row
    [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2, 1, 1, 1, 1, 1, 1],
    // space row
    [1.2, 1.2, 1.2, 1.4, 6.4, 1.4, 1.2, 1, 1, 1, 1, 1],
  ];
  return (
    <div className="welcome-kbd">
      {rows.map((row, r) => (
        <div className="welcome-krow" key={r}>
          {row.map((w, c) => {
            let cls = 'welcome-key';
            let label = '';
            // highlight K (row index 3 — asdf, position 8 ≈ k)
            if (r === 3 && c === 8 && lit) {
              cls += ' is-lit-blue';
              label = 'K';
            }
            // highlight command (row 5 space row, c===1)
            if (r === 5 && c === 1 && lit) {
              cls += ' is-lit-blue welcome-key--cmd';
              label = '⌘ command';
            }
            return (
              <span className={cls} style={{ ['--kw' as any]: w }} key={c}>
                {label}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ===================== STEP 8 — Command (keyboard + palette) ===================== */
// The onboarding finale — the single "you're in" moment both the tuning and skip paths land on.
// Pressing ⌘K (or the pill) opens the REAL command palette, so there's no throwaway centered mock
// to learn twice; they try the actual thing and pick Home to enter.
function CommandStep({ goStep }: { goStep: (s: string) => void }) {
  const openPal = () => openCommandPalette({ search: true });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); openPal(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="welcome-cmd welcome-cmd--hub">
      <h1 className="welcome-h">
        One shortcut, <span className="welcome-grad">the whole app</span>
      </h1>
      <p className="welcome-sub">
        <span className="welcome-kbhint">
          Press <kbd className="welcome-kc">⌘</kbd> <kbd className="welcome-kc">K</kbd> anywhere in Hence to search any
          market, jump to any screen, or ask a question.
        </span>
        <span className="welcome-touchhint">
          Tap the bar below to search any market, jump to any screen, or ask a question.
        </span>
        <br />
        Give it a try — then pick <b>Home</b> to jump in.
      </p>
      <button className="welcome-cmd__pill" onClick={openPal}>
        <Icon name="search" size={15} /> Search markets, screens or commands…
      </button>
      <Keyboard lit />
      <div className="welcome-cmd__cta">
        <button className="welcome-setup" onClick={() => { location.hash = '#/'; }}>Enter Hence</button>
        <button className="welcome-ftbtn" onClick={() => goStep('tutorial')}>Take the 60-second tour</button>
      </div>
      <p className="welcome-setupnote">
        Stuck later? The <span className="welcome-q">?</span> in the bottom-right corner has a quick tour of
        everything, anytime.
      </p>
    </div>
  );
}

/* ===================== Tutorial sub-views ===================== */
function TutHands() {
  const rows: [string, string][] = [
    ['AAPL', 'Apple Inc.'],
    ['TSLA', 'Tesla Inc'],
    ['MSFT', 'Microsoft Corporation'],
    ['DIS', 'Walt Disney Co'],
    ['GOOGL', 'Alphabet Inc'],
  ];
  const cmds: [string, string][] = [
    ['Analyze AAPL', 'X'],
    ['Analyst estimates', 'A'],
    ['Financials', 'F'],
    ['Go to Insiders', 'I'],
    ['Earnings', 'E'],
  ];
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        It's in your <span className="welcome-grad">hands</span>
      </h1>
      <p className="welcome-sub">
        Commands are accessible at any time, but you can<br />
        navigate even faster by knowing their shortcuts.
      </p>
      <p className="welcome-act">
        For now, press <kbd className="welcome-kc">space</kbd> to continue
      </p>
      <div className="welcome-demo">
        <div className="welcome-demo__list">
          {rows.map((r, i) => (
            <div className={`welcome-dl__row ${i === 0 ? 'is-sel' : ''}`} key={i}>
              <LogoChip sym={r[0]} />
              <b>{r[0]}</b>
              <span>{r[1]}</span>
            </div>
          ))}
        </div>
        <div className="welcome-demo__pal">
          <div className="welcome-demo__crumb">
            <LogoChip sym="AAPL" size={14} /> AAPL
          </div>
          <div className="welcome-demo__cap">Execute</div>
          {cmds.map((c, i) => (
            <div className="welcome-demo__cmd" key={i}>
              <span className="welcome-demo__ci">
                <Icon name="doc" size={12} />
              </span>
              <span>{c[0]}</span>
              <kbd className="welcome-kc welcome-kc--blue">{c[1]}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TutSeek({ setTut }: { setTut: (s: string) => void }) {
  const POP: [string, string, string][] = [
    ['NVDA', 'NVIDIA Corporation', 'Nasdaq'],
    ['PLTR', 'Palantir Technologies Inc.', 'Nasdaq'],
    ['LCID', 'Lucid Group Inc.', 'Nasdaq'],
    ['NU', 'Nu Holdings Ltd.', 'NYSE'],
    ['INTC', 'Intel Corporation', 'Nasdaq'],
    ['SMCI', 'Super Micro Computer Inc.', 'Nasdaq'],
  ];
  return (
    <>
      <a className="welcome-intl" href="#/welcome/tutorial">
        <Icon name="compass" size={13} /> Using an international keyboard? <u>Click here</u>
      </a>
      <div className="welcome-tut welcome-tut--dim">
        <h1 className="welcome-h">
          Find what you <span className="welcome-grad">seek</span>
        </h1>
        <p className="welcome-sub">
          Our instant search command allows you to find any<br />
          asset in seconds. Simply hit <kbd className="welcome-kc">/</kbd> to start searching.
        </p>
      </div>
      <div className="welcome-pal welcome-pal--seek" data-pal>
        <div className="welcome-pal__top">
          <span className="welcome-pal__crumb">
            <Icon name="back" size={12} /> Onboarding
          </span>
          <span className="welcome-pal__hint">
            Search any stock and hit <kbd className="welcome-kc">return</kbd>
          </span>
        </div>
        <div className="welcome-pal__group">Popular</div>
        {POP.map((p, i) => (
          <button
            className={`welcome-pal__srow ${i === 0 ? 'is-on' : ''}`}
            key={i}
            onClick={() => setTut('cursor')}
          >
            <LogoChip sym={p[0]} size={16} />
            <b>{p[0]}</b>
            <span className="welcome-pal__nm">{p[1]}</span>
            <span className="welcome-pal__ex">{p[2]}</span>
          </button>
        ))}
        <div className="welcome-pal__search">
          <input placeholder="Search" />
        </div>
      </div>
    </>
  );
}

function TutCursor({ setTut }: { setTut: (s: string) => void }) {
  const dockIcons = ['home', 'compass', 'card', 'bookmark', 'download', 'send', 'settings'];
  return (
    <>
      <div className="welcome-toast-fixed">
        <LogoChip sym="NVDA" size={16} /> NVDA was added to your list. <Icon name="close" size={12} />
      </div>
      <div className="welcome-tut">
        <h1 className="welcome-h">
          Clues at your <span className="welcome-grad">cursor</span>
        </h1>
        <p className="welcome-sub">
          If you prefer using your mouse, we've got you covered!<br />
          Every function is cursor-accessible with helpful hints.
        </p>
        <p className="welcome-act">
          Press <kbd className="welcome-kc">space</kbd> or{' '}
          <button className="welcome-link" onClick={() => setTut('calib')}>
            click here
          </button>{' '}
          to continue
        </p>
        <div className="welcome-dockwrap">
          <div className="welcome-dock">
            {dockIcons.map((ic, i) => (
              <span className={`welcome-dock__i ${i === 0 ? 'is-on' : ''}`} key={i}>
                <Icon name={ic} size={16} />
              </span>
            ))}
          </div>
          <div className="welcome-dock__search">
            <span className="welcome-dock__stip">
              Search securities <kbd className="welcome-kc">/</kbd>
            </span>
            <button className="welcome-dock__sbtn" onClick={() => setTut('calib')}>
              <Icon name="search" size={17} />
            </button>
            <span className="welcome-cursor">
              <Icon name="send" size={14} />
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== persona — the tour personalizes off the picks =====================
   Sources, in order: the signed-in profile's interests; the onboarding picks mirror
   (PERSONA_KEY, written by InterestsStep so anon/demo runs personalize too — cleared on
   logout by AuthBridge); otherwise sensible defaults. */
const VOICE_META: Record<string, { label: string; color: string; call: string; ret: string; up: boolean }> = {
  'arthur-hayes':     { label: 'Arthur Hayes',     color: '#e8a06a', call: 'Long BTC @ 96k',          ret: '+18.4%', up: true },
  'ignas':            { label: 'Ignas',            color: '#5fcf91', call: 'Long stETH loops',        ret: '+7.9%',  up: true },
  'the-defi-investor':{ label: 'The DeFi Investor',color: '#7c6cf0', call: 'Long AAVE @ 172',         ret: '+12.2%', up: true },
  'the-defi-edge':    { label: 'The DeFi Edge',    color: '#f4c39a', call: 'Rotate into RWAs',        ret: '+4.8%',  up: true },
  'phyrex':           { label: 'Phyrex',           color: '#5ad1c9', call: 'BTC stays range-bound',   ret: '+2.1%',  up: true },
  'empire':           { label: 'Empire',           color: '#7c6cf0', call: 'Long SOL @ 142',          ret: '+6.1%',  up: true },
  'bankless':         { label: 'Bankless',         color: '#5b6cf0', call: 'Short ETH @ 3.4k',        ret: '−9.7%',  up: false },
  'forward-guidance': { label: 'Forward Guidance', color: '#e8a06a', call: 'Long duration into cuts', ret: '+3.3%',  up: true },
};

type Persona = {
  keys: Set<string>;
  tickers: string[];          // 3 recap/calibration symbols
  perp: string;               // the venue-slide ticket market
  voices: string[];           // up to 3 VOICE_META topics
  cryptoish: boolean;
  predictions: boolean;
};

function derivePersona(profile: any): Persona {
  const keys = new Set<string>();
  const ints = profile?.interests;
  if (Array.isArray(ints) && ints.length) {
    ints.forEach((i: any) => { if (i && i.kind && i.topic) keys.add(keyOf(i.kind, i.topic)); });
  } else {
    try {
      const raw = JSON.parse(localStorage.getItem(PERSONA_KEY) || 'null');
      if (raw && Array.isArray(raw.keys)) raw.keys.forEach((k: any) => { if (typeof k === 'string') keys.add(k); });
    } catch { /* fresh browser */ }
  }
  const has = (k: string, t: string) => keys.has(keyOf(k, t));
  const cryptoish = has('asset_class', 'crypto') || has('asset_class', 'perps');
  const stocks = has('asset_class', 'stocks');
  const semis = has('sector', 'semis') || has('sector', 'tech');
  const defi = has('sector', 'defi') || has('theme', 'onchain-yield');

  const tickers: string[] = [];
  const push = (s: string) => { if (tickers.length < 3 && !tickers.includes(s)) tickers.push(s); };
  if (semis || (stocks && !cryptoish)) push('NVDA');
  if (cryptoish) push('BTC');
  if (defi) push('SOL');
  if (stocks) push('TSLA');
  ['NVDA', 'BTC', 'SOL', 'TSLA', 'ETH'].forEach(push);

  const picked = (INTEREST_GROUPS[4].items as any[]).map((it) => it.topic).filter((t) => has('source', t) && VOICE_META[t]);
  const voices = [...picked];
  ['arthur-hayes', 'empire', 'bankless'].forEach((t) => { if (voices.length < 3 && !voices.includes(t)) voices.push(t); });

  return {
    keys, tickers,
    perp: cryptoish ? (defi ? 'SOL' : 'BTC') : 'NVDA',
    voices: voices.slice(0, 3),
    cryptoish,
    predictions: has('asset_class', 'predictions'),
  };
}

// interest labels for the pass card constellation
const CHIP_LABEL: Record<string, string> = {};
INTEREST_GROUPS.forEach((g: any) => g.items.forEach((it: any) => { CHIP_LABEL[keyOf(g.kind, it.topic)] = it.label; }));

const fmtPx = (px: any) => {
  const n = Number(px);
  if (!isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
  if (n >= 10) return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
};

/* live ticker chip — real price change once market:changes lands */
function TickChip({ sym }: { sym: string }) {
  const t: any = getTicker(sym);
  const pct = typeof t?.chgPct === 'number' ? t.chgPct : 0;
  const up = pct >= 0;
  return (
    <span className="welcome-fttick">
      <LogoChip sym={sym} size={14} />{sym}{' '}
      <b className={up ? 'welcome-ftup' : 'welcome-ftdn'}>{up ? '+' : ''}{pct.toFixed(1)}%</b>
    </span>
  );
}

// re-render when live 24h changes land (the tour mounts after App kicked market.init)
function useLiveChanges() {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('market:changes', on);
    window.addEventListener('market:ready', on);
    return () => { window.removeEventListener('market:changes', on); window.removeEventListener('market:ready', on); };
  }, []);
}

/* ---- feature slide: home AI recap (live prices from YOUR universe) ---- */
function TutPulse({ persona }: { persona: Persona }) {
  useLiveChanges();
  const [a, b, c] = persona.tickers;
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        Your day, already <span className="welcome-grad">read</span>
      </h1>
      <p className="welcome-sub">
        Home opens with an AI recap woven around your universe —<br />
        every claim linked back to the source it came from.
      </p>
      <p className="welcome-act">
        Press <kbd className="welcome-kc">space</kbd> to continue
      </p>
      <div className="welcome-ft">
        <div className="welcome-ftcard">
          <div className="welcome-ftcap"><span className="welcome-ftdot" /> Morning recap · tuned to you</div>
          <div className="welcome-ftbody">
            Right now in your universe: <TickChip sym={a} /> and <TickChip sym={b} /> — live, not a mockup.
            Tomorrow morning this is a woven three-sentence recap of <b>why</b> they moved,
            with <TickChip sym={c} /> on deck and every claim traceable to its source.
          </div>
          <div className="welcome-ftfoot">12 sources · every sentence traceable</div>
        </div>
        <div className="welcome-ftcard welcome-ftcard--dim">
          <div className="welcome-ftkv"><b>Nvidia clears $5T as hyperscaler capex guides higher</b><span>Reuters</span></div>
          <div className="welcome-ftkv"><b>Spot BTC ETFs see first outflow week since May</b><span>The Block</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---- feature slide: belief spine (react → thesis → setup) ---- */
function TutBeliefs() {
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        React — Hence <span className="welcome-grad">remembers</span>
      </h1>
      <p className="welcome-sub">
        Save or judge any idea as you read. Overnight, AI clusters your<br />
        reactions into theses — and turns them into Today's Setups.
      </p>
      <p className="welcome-act">
        Press <kbd className="welcome-kc">space</kbd> to continue
      </p>
      <div className="welcome-ft">
        <div className="welcome-ftcard">
          <div className="welcome-ftcap">You, this morning</div>
          <div className="welcome-ftbody"><b>TSMC beats; guides AI revenue up 40%</b> — capex supercycle intact, per management.</div>
          <div className="welcome-ftrail">
            <span className="welcome-ftbtn">Trade</span>
            <span className="welcome-ftbtn">Watch</span>
            <span className="welcome-ftbtn is-hot">✓ Saved</span>
          </div>
        </div>
        <div className="welcome-ftvia">∴ overnight, your saves become</div>
        <div className="welcome-ftcard">
          <div className="welcome-ftcap"><span className="welcome-ftdot" /> Thesis · Today's Setups</div>
          <div className="welcome-ftbody"><b>AI capex runs hot into 2027</b> — 4 pieces of evidence this week.</div>
          <div className="welcome-ftrail">
            <span className="welcome-ftbtn is-hot">Long NVDA-PERP · setup ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- feature slide: venues (terminal + predict), ticket priced off YOUR market ---- */
function TutVenues({ persona }: { persona: Persona }) {
  useLiveChanges();
  const sym = persona.perp;
  const t: any = getTicker(sym);
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        Belief to venue, one <span className="welcome-grad">tap</span>
      </h1>
      <p className="welcome-sub">
        Perps on the terminal, event odds on predict — the right ticket<br />
        is never more than a keystroke away.
      </p>
      <p className="welcome-act">
        Press <kbd className="welcome-kc">space</kbd> to continue
      </p>
      <div className="welcome-ft">
        <div className="welcome-ftrow">
          <div className="welcome-ftcard welcome-ftcard--half">
            <div className="welcome-ftcap">Terminal · perps</div>
            <div className="welcome-ftkv"><span>Market</span><b>{sym}-PERP</b></div>
            <div className="welcome-ftkv"><span>Mark</span><b>{fmtPx(t?.price)}</b></div>
            <div className="welcome-ftkv"><span>Side</span><b className="welcome-ftup">Long · 5×</b></div>
            <div className="welcome-ftkv"><span>Size</span><b>$500</b></div>
            <span className="welcome-ftcta">Confirm long</span>
          </div>
          <div className="welcome-ftcard welcome-ftcard--half">
            <div className="welcome-ftcap">{persona.predictions ? 'Predict · your event markets' : 'Predict · event markets'}</div>
            <div className="welcome-ftbody"><b>Fed cuts rates in September?</b></div>
            <div className="welcome-ftodds">
              <span className="welcome-ftodd welcome-ftodd--yes">YES 72¢</span>
              <span className="welcome-ftodd welcome-ftodd--no">NO 28¢</span>
            </div>
            <div className="welcome-ftfoot">Live Polymarket &amp; Kalshi odds</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- feature slide: podcast signals scoreboard (the voices YOU picked) ---- */
function TutRadar({ persona }: { persona: Persona }) {
  const rows = persona.voices.map((t) => VOICE_META[t]).filter(Boolean);
  const followed = persona.voices.some((t) => persona.keys.has(keyOf('source', t)));
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        Every call, kept <span className="welcome-grad">honest</span>
      </h1>
      <p className="welcome-sub">
        {followed
          ? <>You picked these voices — Hence transcribes them, extracts their<br />trade calls and scores the returns. Your tracker is already running.</>
          : <>Hence transcribes the voices you follow, extracts their trade calls<br />and scores the returns — so you know who's actually good.</>}
      </p>
      <p className="welcome-act">
        Press <kbd className="welcome-kc">space</kbd> to continue
      </p>
      <div className="welcome-ft">
        <div className="welcome-ftcard">
          <div className="welcome-ftcap"><span className="welcome-ftdot" /> Signals · {followed ? 'your voices' : '30-day scoreboard'}</div>
          {rows.map((r) => (
            <div className="welcome-ftsig" key={r.label}>
              <span className="welcome-av" style={{ ['--av' as any]: r.color }}>{r.label[0]}</span>
              <b>{r.label}</b>
              <span>{r.call}</span>
              <span className={'welcome-ftret ' + (r.up ? 'welcome-ftret--up' : 'welcome-ftret--dn')}>{r.ret}</span>
            </div>
          ))}
          <div className="welcome-ftfoot">Ranked on realized returns — not vibes.</div>
        </div>
      </div>
    </div>
  );
}

/* ---- interactive slide: calibration mini-game (3 real 30-day paper calls) ---- */
function TutCalib({ persona, setTut }: { persona: Persona; setTut: (s: string) => void }) {
  useLiveChanges();
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const advRef = useRef<number | undefined>(undefined);
  // the auto-advance must die with the slide — a stale timer would yank a user who
  // spaced ahead back to 'setup' and re-fire its /api/setups POST
  useEffect(() => () => window.clearTimeout(advRef.current), []);
  const syms = persona.tickers;
  const sym = syms[Math.min(idx, syms.length - 1)];
  const t: any = getTicker(sym);
  const px = t?.price;
  // never record a call against data.js stub prices — wait for the live feed (useLiveChanges
  // re-renders on market:ready/market:changes, so the buttons enable themselves)
  const live = !!t?.real && Number(px) > 0;

  const answer = (dir: 'higher' | 'lower') => {
    if (done || !live) return;
    stash.record({
      kind: 'paper_call', subject_type: 'asset', symbol: sym, symbols: [sym],
      // per-day key → each day's call is its own scored record on the server (same-day
      // re-answers refresh that day's row instead of clobbering an older call's clock)
      key: `${sym}:${new Date().toISOString().slice(0, 10)}`,
      title: `${sym} ${dir} than ${fmtPx(px)} in 30 days`,
      stance: dir === 'higher' ? 'long' : 'short',
      evidence: { strike_price: Number(px) || null, horizon_days: 30, source: 'calibration' },
    });
    if (idx + 1 >= syms.length) {
      setDone(true);
      advRef.current = window.setTimeout(() => setTut('setup'), 1200);
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        Prove your <span className="welcome-grad">read</span>
      </h1>
      <p className="welcome-sub">
        Three quick calls at today's real prices, 30-day horizon.<br />
        Hence scores them as they age — your calibration starts now.
      </p>
      <p className="welcome-act">
        {done ? <>Calls logged — scoring has started</> : <>No stakes — or press <kbd className="welcome-kc">space</kbd> to skip</>}
      </p>
      <div className="welcome-ft">
        <div className="welcome-ftcard welcome-calib">
          <div className="welcome-ftcap"><span className="welcome-ftdot" /> Calibration · {done ? 'seeded' : `${idx + 1} of ${syms.length}`}</div>
          {done ? (
            <div className="welcome-calib__done">
              <IconSw name="check" size={16} sw={2} /> {syms.length} paper calls in your stash. We check them against real prices — no stakes, just your track record forming.
            </div>
          ) : (
            <>
              <div className="welcome-calib__row">
                <LogoChip sym={sym} size={26} />
                <b className="welcome-calib__sym">{sym}</b>
                <span className="welcome-calib__px">{fmtPx(px)}</span>
              </div>
              <div className="welcome-calib__q">{live ? '30 days from now — higher or lower?' : 'Syncing live prices…'}</div>
              <div className="welcome-ftodds">
                <button type="button" className="welcome-ftodd welcome-ftodd--yes welcome-calib__btn" disabled={!live} onClick={() => answer('higher')}>Higher</button>
                <button type="button" className="welcome-ftodd welcome-ftodd--no welcome-calib__btn" disabled={!live} onClick={() => answer('lower')}>Lower</button>
              </div>
              <div className="welcome-calib__dots">
                {syms.map((s, i) => <span key={s} className={'welcome-calib__dot' + (i < idx ? ' is-done' : i === idx ? ' is-cur' : '')} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- interactive slide: your first setup (real /api/setups, personalized) ---- */
function TutSetup({ persona }: { persona: Persona }) {
  const [setup, setSetup] = useState<any>(null);
  const [starter, setStarter] = useState(false);   // true = client fallback, labeled honestly
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    let alive = true;
    const world = persona.cryptoish ? 'crypto' : 'markets';
    // movers payload from live tickers — same fields the home recap feeds /api/setups.
    // Only real (t.real) prices qualify: stub values would ground the generation in fiction.
    const cand = [...new Set([...persona.tickers, 'BTC', 'ETH', 'SOL', 'NVDA', 'TSLA', 'HYPE', 'DOGE', 'AVAX', 'LINK'])];
    const movers = cand
      .map((s) => ({ t: getTicker(s) as any, s }))
      .filter(({ t }) => t && t.real && typeof t.chgPct === 'number' && t.price > 0)
      .map(({ t, s }) => ({ symbol: s, change: t.chgPct, price: t.price }))
      .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
      .slice(0, 8);
    const fallback = () => {
      if (!alive) return;
      const sym = persona.perp;
      const t: any = getTicker(sym);
      const px = t?.real ? Number(t.price) || 0 : 0;   // stub price → 'set your own line'
      setStarter(true);
      setSetup({
        id: 'starter-' + sym, symbol: sym, direction: 'long',
        catalyst: `${sym} sits at the center of your universe — a starter idea to watch, not advice`,
        horizon: '2 weeks', invalidation: px ? `invalid below ${fmtPx(px * 0.92)}` : 'set your own line',
        action: { route: (persona.cryptoish ? '#/terminal/' : '#/stock/') + sym },
        source_tag: 'starter',
      });
    };
    optionalAuthApiFetch('/api/setups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world, data: { movers, watchlist: watchList().slice(0, 12) } }),
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((res: any) => {
        if (!alive) return;
        const list = res && res.available && Array.isArray(res.setups) ? res.setups : [];
        if (!list.length) { fallback(); return; }
        const mine = list.find((s: any) => persona.tickers.includes(s.symbol)) || list[0];
        setSetup(mine);
      })
      .catch(fallback);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWatch = () => {
    if (!setup || watched) return;
    const already = hasWatch(setup.symbol);
    addWatch(setup.symbol);           // idempotent — never un-watches like toggle would
    stash.record({
      kind: 'save', subject_type: 'setup', key: String(setup.id || 'starter-' + setup.symbol),
      symbol: setup.symbol, symbols: setup.symbol ? [setup.symbol] : [], title: setup.catalyst,
    });
    setWatched(true);
    toast(already
      ? `${setup.symbol} was already on your watchlist — the setup is in your stash`
      : `${setup.symbol} added to your watchlist — the setup is in your stash`);
  };

  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        Leave with something <span className="welcome-grad">live</span>
      </h1>
      <p className="welcome-sub">
        {starter
          ? <>A starter idea from your universe — watch it and Hence starts<br />tracking the story for you. Real setups generate as markets move.</>
          : <>Generated from live market data{persona.cryptoish ? ' in your crypto universe' : ''} just now —<br />watch it and your home feed starts working for you.</>}
      </p>
      <p className="welcome-act">
        Press <kbd className="welcome-kc">space</kbd> to finish the tour
      </p>
      <div className="welcome-ft">
        {setup ? (
          <div className="welcome-ftcard">
            <div className="welcome-ftcap">
              <span className="welcome-ftdot" /> {starter ? 'Starter idea' : "Today's Setups · yours"}
            </div>
            <div className="welcome-ftkv">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><LogoChip sym={setup.symbol} size={18} /><b>{setup.symbol}</b></span>
              <b className={setup.direction === 'short' ? 'welcome-ftdn' : 'welcome-ftup'}>{(setup.direction || 'long').toUpperCase()}</b>
            </div>
            <div className="welcome-ftbody" style={{ marginTop: 8 }}>{setup.catalyst}</div>
            <div className="welcome-ftfoot">{[setup.horizon, setup.invalidation].filter(Boolean).join(' · ')}</div>
            <div className="welcome-ftrail" style={{ marginTop: 14 }}>
              <button type="button" className={'welcome-ftbtn welcome-setupbtn' + (watched ? ' is-hot' : '')} onClick={onWatch}>
                {watched || hasWatch(setup.symbol) ? '✓ Watching' : 'Watch it'}
              </button>
              <button type="button" className="welcome-ftbtn welcome-setupbtn" onClick={() => { location.hash = setup.action?.route || '#/'; }}>
                Open {persona.cryptoish ? 'terminal' : 'chart'}
              </button>
            </div>
          </div>
        ) : (
          <div className="welcome-ftcard welcome-ftcard--dim">
            <div className="welcome-ftcap">Today's Setups</div>
            <div className="welcome-ftbody">Reading your universe&hellip;</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TutReady() {
  return (
    <div className="welcome-tut">
      <h1 className="welcome-h">
        You're <span className="welcome-grad">all set</span>
      </h1>
      <p className="welcome-sub">
        That's the tour. Press <kbd className="welcome-kc">⌘</kbd> <kbd className="welcome-kc">K</kbd> anytime to get
        anywhere, and the <span className="welcome-q">?</span> in the bottom-right is always there if you want a refresher.
      </p>
      <button className="welcome-setup" onClick={() => { location.hash = '#/'; }}>Go to Home</button>
      <p className="welcome-act">
        or press <kbd className="welcome-kc">space</kbd> to jump in
      </p>
    </div>
  );
}

// what Hence is (personalized) → how to drive it (shortcuts) → prove your read → leave live
const TUT_ORDER = ['pulse', 'beliefs', 'venues', 'radar', 'hands', 'seek', 'cursor', 'calib', 'setup', 'ready'];

/* ===================== Tutorial step (sub-view flow) ===================== */
function TutorialStep() {
  const [tut, setTut] = useState(TUT_ORDER[0]);
  const { me: profile } = useMe();
  const persona = useMemo(() => derivePersona(profile), [profile]);

  // space advances sub-views (skips the interactive ones); past the end → ready route
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const idx = TUT_ORDER.indexOf(tut);
        const next = TUT_ORDER[idx + 1];
        if (next) setTut(next);
        else {
          location.hash = '#/welcome/ready';
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tut]);

  if (tut === 'beliefs') return <TutBeliefs />;
  if (tut === 'venues') return <TutVenues persona={persona} />;
  if (tut === 'radar') return <TutRadar persona={persona} />;
  if (tut === 'hands') return <TutHands />;
  if (tut === 'seek') return <TutSeek setTut={setTut} />;
  if (tut === 'cursor') return <TutCursor setTut={setTut} />;
  if (tut === 'calib') return <TutCalib persona={persona} setTut={setTut} />;
  if (tut === 'setup') return <TutSetup persona={persona} />;
  if (tut === 'ready') return <TutReady />;
  return <TutPulse persona={persona} />;
}

/* ===================== ROUTER ===================== */
export default function Welcome() {
  const { step: routeStep } = useParams();
  const step = routeStep || 'pass';

  const goStep = (s: string) => {
    if (s === 'done') {
      location.hash = '#/';
      return;
    }
    location.hash = `#/welcome/${s}`;
  };

  // auto-advance splash after a beat (still clickable)
  useEffect(() => {
    if (step !== 'splash') return;
    const id = setTimeout(() => {
      if (location.hash.includes('/welcome/splash')) goStep('testimonials');
    }, 1600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ready step: space/enter → home (the tour is over; the real app begins)
  useEffect(() => {
    if (step !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        location.hash = '#/';
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step]);

  let body: React.ReactNode;
  if (step === 'pass') body = <PassStep goStep={goStep} />;
  else if (step === 'yourpass') body = <YourPassStep goStep={goStep} />;
  else if (step === 'signup') body = <SignupStep goStep={goStep} />;
  else if (step === 'inbox') body = <InboxStep goStep={goStep} />;
  else if (step === 'splash') body = <SplashStep goStep={goStep} />;
  else if (step === 'testimonials') body = <TestimonialsStep goStep={goStep} />;
  else if (step === 'command') body = <CommandStep goStep={goStep} />;
  else if (step === 'tutorial') body = <TutorialStep />;
  else if (step === 'ready') body = <TutReady />;
  else body = <PassStep goStep={goStep} />;

  return (
    <div className="welcome" key={step}>
      {body}
    </div>
  );
}
