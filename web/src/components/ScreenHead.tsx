/* =========================================================
   ScreenHead — a minimal, quiet header row: back chevron +
   title + optional dim context. Typography matches the Stock
   topbar (.topbar__tk / .topbar__nm). Additive; screens can
   drop it in without restructuring.
   ========================================================= */
import { Icon } from './Icon';

export function ScreenHead({ title, context }: { title: string; context?: string }) {
  return (
    <header className="screenhead">
      <button className="icon-btn" aria-label="Back" onClick={() => history.back()}><Icon name="back" size={18} /></button>
      <span className="screenhead__title">{title}</span>
      {context ? <span className="screenhead__ctx">{context}</span> : null}
    </header>
  );
}
