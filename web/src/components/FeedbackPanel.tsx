import { useEffect, useRef } from 'react';
import { useFeedback, closeFeedback, addCurrentScreen, removeScreen, setText, submitFeedback } from '../lib/feedback';
import { Icon } from './Icon';
import { HenceLogo } from './HenceLogo';
import { HenceSpinner } from './Loading';
import '../styles/feedback.css';

/* =========================================================================
   FeedbackPanel — the Fey-style "Send feedback" composer. Bottom-anchored (grows
   from the dock), PERSISTS across navigation so the user can attach several
   screens. Each attached screen is a context chip (thumbnail + label + symbol).
   Mounted globally in Shell; opened by the "Send feedback" dock command.
   ========================================================================= */
export function FeedbackPanel() {
  const { open, text, screens, sending, done } = useFeedback();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => taRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.cmdk-overlay, .sc-overlay, .modal, .acct-ov')) return;   // a higher overlay owns it
      e.preventDefault(); closeFeedback();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [open]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    // don't submit on the Enter that COMMITS an IME composition candidate (CJK input on Safari
    // fires key==='Enter' with isComposing=true) — only a real newline-Enter submits
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault(); if (text.trim()) submitFeedback();
    }
  };

  return (
    <div className="fb-wrap fb-panel" role="dialog" aria-label="Send feedback">
      <div className="fb">
        {done ? (
          <div className="fb__thanks">
            <span className="fb__thanks-ic"><Icon name="mail" size={24} /></span>
            <div className="fb__thanks-t">Thank you!</div>
            <div className="fb__thanks-s">We’ve received your feedback — the Hence team reads every note.</div>
          </div>
        ) : (
          <>
            <header className="fb__head">
              <span className="fb__chip"><HenceLogo size={13} /> Feedback</span>
              <button className="fb__x" onClick={closeFeedback} aria-label="Close"><Icon name="close" size={15} /></button>
            </header>

            <textarea
              ref={taRef} className="fb__ta" value={text} onKeyDown={onKey}
              onChange={(e) => setText(e.target.value)}
              placeholder="Any bugs, suggestions or simply hello?" rows={3}
            />

            {screens.length > 0 && (
              <div className="fb__chips">
                {screens.map((s, i) => (
                  <span className="fb__ctx" key={s.path + i} title={`${s.screen} · ${s.path}`}>
                    {s.shot
                      ? <img className="fb__ctx-shot" src={s.shot} alt="" />
                      : <span className="fb__ctx-shot fb__ctx-shot--ph"><Icon name="image" size={12} /></span>}
                    <span className="fb__ctx-lbl">{s.screen}</span>
                    <button className="fb__ctx-x" onClick={() => removeScreen(i)} aria-label="Remove screen"><Icon name="close" size={11} /></button>
                  </span>
                ))}
              </div>
            )}

            <div className="fb__foot">
              <button className="fb__attach" onClick={addCurrentScreen} title="Attach the current screen">
                <Icon name="link" size={13} /> Add this screen
              </button>
              <span className="fb__hint">We also read every note at hey@hence.markets</span>
              <button className="fb__submit" onClick={() => text.trim() && submitFeedback()} disabled={sending || !text.trim()}>
                {sending ? <HenceSpinner size={14} /> : <>Submit <Icon name="send" size={13} /></>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
