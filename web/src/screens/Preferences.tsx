import type { ReactNode } from 'react';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { openModal } from '../lib/ui.js';

function Row({ ic, title, sub, extra }: { ic: string; title: string; sub?: string; extra?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__l">
        <span className="set-row__ic"><Icon name={ic} size={16} /></span>
        <div>
          <div className="set-row__t">{title}</div>
          {sub ? <div className="set-row__s">{sub}</div> : null}
        </div>
      </div>
      {extra || <span className="set-link"><Icon name="chevR" size={16} /></span>}
    </div>
  );
}

function manageModal() {
  return `<div class="modal-body" style="text-align:center;padding:26px">
        <h2 style="font-size:18px;font-weight:600">Manage subscription</h2>
        <p class="muted" style="font-size:13px;margin:10px auto 18px;max-width:300px">Your trial ends Feb 22, 2024. You can switch plans or cancel anytime.</p>
        <div style="display:flex;gap:10px;justify-content:center"><a class="btn btn--dark" href="#/onboarding/plan" data-close>Switch plan</a><button class="btn btn--light" data-close>Done</button></div></div>`;
}

export default function Preferences() {
  return (
    <Shell dockActive="settings">
      <div className="settings">
        <div className="settings__top">
          <div className="settings__title"><Icon name="back" size={18} /> Preferences</div>
          <a className="btn-ghost" href="#/login">Sign out <Icon name="signout" size={14} /></a>
        </div>
        <div className="muted" style={{ fontSize: '12.5px', margin: '-14px 0 22px' }}>jdoe.mobbin2@gmail.com</div>
        <div className="settings__grid">
          <div className="set-panel" style={{ padding: '8px 18px 14px' }}>
            <div className="grp" style={{ fontSize: '11px', color: 'var(--dimmer)', margin: '14px 0 4px' }}>Your account</div>
            <Row ic="user" title="Jane Doe" sub="jdoe.mobbin2@gmail.com" />
            <Row
              ic="card"
              title="Payment method"
              sub="Visa •••• 0687"
              extra={<b style={{ fontStyle: 'italic', color: 'var(--dim)' }}>VISA</b>}
            />
            <Row ic="mail" title="Communications" sub="Manage your email newsletter, get help, or join our Slack." />
            <Row ic="list" title="Shortcuts" sub="Press ? anytime for a cheat sheet." />
            <Row ic="heart" title="Share feedback" sub="Bugs, suggestions or simply hello?" />
            <div className="set-banner" style={{ margin: '14px 0 4px' }}>
              <span>Download Hence for Mac now, or press <kbd>⌘</kbd> <kbd>K</kbd> and type "download".</span>
              <button className="btn btn--light" data-toast="Downloading Hence for Mac…" style={{ padding: '7px 14px' }}>
                <Icon name="download" size={13} /> Download
              </button>
            </div>
          </div>
          <aside>
            <div className="plan-side">
              <div className="eyebrow" style={{ marginBottom: '14px' }}>Monthly plan</div>
              <div className="plan-side__price">$30</div>
              <div className="muted" style={{ fontSize: '12.5px', marginTop: '14px' }}>Trial ends: Feb 22, 2024</div>
              <div className="muted" style={{ fontSize: '11px', marginTop: '4px', lineHeight: 1.5 }}>For peace of mind, we'll send you an email 24 hours before your trial expires.</div>
              <div className="plan-side__actions" style={{ marginTop: '18px' }}>
                <button className="btn btn--dark" style={{ flex: 1 }} onClick={() => openModal(manageModal())}>Manage subscription</button>
              </div>
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button className="btn-ghost" data-toast="Opening billing history" style={{ border: 'none', background: 'none' }}>View billing history</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
