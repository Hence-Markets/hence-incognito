// React port of ui.js segmented() — a toggle group.
export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (o: string) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

// Renders the section-tab buttons (mobile column-splitter). Section toggling is handled
// by a document-delegated listener in App.tsx (mirrors the vanilla global handler).
export function SectionTabs({ tabs }: { tabs: { key: string; label: string }[] }) {
  return (
    <div className="sectiontabs" role="tablist">
      {tabs.map((t, i) => (
        <button key={t.key} className={`sectiontabs__t ${i === 0 ? 'on' : ''}`} role="tab" data-sectab={t.key}>{t.label}</button>
      ))}
    </div>
  );
}
