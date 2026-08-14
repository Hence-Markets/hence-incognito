import { useEffect, useRef, useState } from 'react';
import '../styles/login-error.css';
import { useAuth } from '../hooks/useAuth';

const ArrowSVG = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9.2" />
    <path d="M9.5 12h6M12.5 9l3 3-3 3" />
  </svg>
);

const CheckSVG = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9.2" />
    <path d="M8.5 12.2l2.4 2.4 4.4-4.8" />
  </svg>
);

const CloseSVG = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);


// same glyph as the accounts-drawer wallet icon (lib/ui.js `wallet`), kept
// currentColor so it inherits .lx-wallet's text/hover color like the arrow icon
const WalletSVG = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <path d="M16 12h4v-2a1 1 0 00-1-1h-3a1.5 1.5 0 000 3z" />
  </svg>
);

export default function Login() {
  const [view, setView] = useState<'form' | 'sent'>('form');
  const [email, setEmail] = useState('');
  const [focus, setFocus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ready, authenticated, login } = useAuth();

  // once Privy reports the user is authenticated, drop them into the app — back onto
  // the route the AuthGate interrupted, when there is one (deep links survive login)
  useEffect(() => {
    if (!ready || !authenticated) return;
    let next = '';
    try {
      next = sessionStorage.getItem('hence.afterLogin') || '';
      sessionStorage.removeItem('hence.afterLogin');
    } catch { /* storage off */ }
    location.hash = next.startsWith('/') && !next.startsWith('//') ? '#' + next : '#/';
  }, [ready, authenticated]);

  // shared wiring present in both views. Signing up IS logging in with Privy (it creates
  // the account); the OnboardingGate then routes brand-new users into /onboarding/username.
  // The app behind this screen is signed-in-only, so closing means leaving — back to the
  // landing page rather than an app shell that would immediately bounce here again.
  const onClose = () => { window.location.href = 'https://hence.markets'; };
  const onSignup = () => login();
  // each button scopes Privy's modal to just its own method — one click goes
  // straight to that provider instead of a method-picker screen
  const onWallet = () => login({ loginMethods: ['wallet'] });

  // autofocus the email input when (re)showing the form
  useEffect(() => {
    if (view === 'form') {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [view]);

  // open Privy scoped to email OTP, prefilling what was typed; brief spinner first
  const doSubmit = () => {
    setSubmitting(true);
    const trimmed = email.trim();
    login({ loginMethods: ['email'], ...(trimmed ? { prefill: { type: 'email', value: trimmed } } : {}) });
    window.setTimeout(() => setSubmitting(false), 900);
  };

  if (view === 'sent') {
    return (
      <div className="lx-screen lx-fade">
        <button className="lx-close" onClick={onClose} aria-label="Close"><CloseSVG /></button>
        <div className="lx-glow"></div>
        <div className="lx-inner">
          <h1 className="lx-title">Check your inbox</h1>
          <p className="lx-sub">We have sent you a secure login link. Please click the link to authenticate your account.</p>
          <div className="lx-field is-done">
            <input value={email} readOnly />
            <span className="lx-check"><CheckSVG /></span>
          </div>
          <button className="lx-back" onClick={() => setView('form')}>Back to Login</button>
        </div>
        <div className="lx-foot">
          <span>Don't have an account yet? <a onClick={onSignup}>Sign up</a>.</span>
          <span className="lx-foot-legal">By continuing you agree to the <a href="#/legal/terms">Terms of Use</a> and <a href="#/legal/privacy">Privacy Policy</a>.</span>
        </div>
      </div>
    );
  }

  const typed = email.trim().length > 0;
  const fieldCls = 'lx-field' + (focus ? ' is-focus' : '') + (typed || submitting ? ' is-typed' : '');

  return (
    <div className="lx-screen">
      <button className="lx-close" onClick={onClose} aria-label="Close"><CloseSVG /></button>
      <div className="lx-glow"></div>
      <div className="lx-inner">
        <h1 className="lx-title">Login to Hence</h1>
        <p className="lx-sub">Trade the beliefs you already hold.</p>
        <div className={fieldCls}>
          <input
            ref={inputRef}
            placeholder="account email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly={submitting}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSubmit(); }}
          />
          <button className="lx-submit" onClick={doSubmit} disabled={submitting} aria-label="Continue">
            {submitting ? <span className="lx-spinner"></span> : <ArrowSVG />}
          </button>
        </div>
        <span className="lx-or">or</span>
        <div className="lx-oauth-row lx-oauth-row--single">
          <button className="lx-wallet" onClick={onWallet}><WalletSVG /><span>Connect Wallet</span></button>
        </div>
      </div>
      <div className="lx-foot">
        <span>Don't have an account yet? <a onClick={onSignup}>Sign up</a>.</span>
        <span className="lx-foot-legal">By continuing you agree to the <a href="#/legal/terms">Terms of Use</a> and <a href="#/legal/privacy">Privacy Policy</a>.</span>
      </div>
    </div>
  );
}
