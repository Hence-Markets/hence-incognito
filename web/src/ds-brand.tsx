/* design-sync BRAND showcase — reference cards for the Hence theme, built from the
   live var(--*) tokens so they can never drift from the app. Sync-only (unused by the
   app itself); surfaced in Claude Design under the "Brand" group. */

const mono = 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

function Swatch({ token, hex, label, ring }: { token: string; hex?: string; label?: string; ring?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{
        height: 56, borderRadius: 10, background: `var(${token})`,
        border: ring ? '1px solid var(--line-2)' : '1px solid rgba(255,255,255,0.05)',
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>{label || token}</span>
        <span style={{ fontSize: 10.5, color: 'var(--dimmer)', fontFamily: mono }}>{token}{hex ? ` · ${hex}` : ''}</span>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: any }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--dimmer)', fontWeight: 650 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 14 }}>{children}</div>
    </section>
  );
}

/** The Hence colour system — surfaces, text ramp, accent, semantic, hairlines. */
export function BrandColors() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
      <Group title="Surfaces">
        <Swatch token="--bg" hex="#0a0a0b" label="Background" ring />
        <Swatch token="--panel" hex="#0e0f12" label="Panel" ring />
        <Swatch token="--panel-2" hex="#141519" label="Panel 2" ring />
        <Swatch token="--elevated" hex="#1a1b20" label="Elevated" ring />
        <Swatch token="--hover" hex="#1e1f25" label="Hover" ring />
      </Group>
      <Group title="Text ramp">
        <Swatch token="--text" hex="#f3f3f4" label="Text" />
        <Swatch token="--dim" hex="#9a9aa2" label="Dim" />
        <Swatch token="--dimmer" hex="#6a6a72" label="Dimmer" />
        <Swatch token="--dimmest" hex="#46464d" label="Dimmest" />
      </Group>
      <Group title="Accent & semantic">
        <Swatch token="--peach" hex="#f4c39a" label="Peach · accent" />
        <Swatch token="--up" hex="#5fcf91" label="Up · gains" />
        <Swatch token="--down" hex="#f08d83" label="Down · losses" />
        <Swatch token="--gold" hex="#e6c84f" label="Gold · review" />
        <Swatch token="--blue" hex="#5b6cf0" label="Blue" />
      </Group>
      <Group title="Hairlines">
        <Swatch token="--line" label="Line" ring />
        <Swatch token="--line-2" label="Line 2" ring />
        <Swatch token="--line-3" label="Line 3" ring />
      </Group>
    </div>
  );
}

/** The Hence type system — Inter across the scale the app uses. */
export function BrandType() {
  const rows: [string, any][] = [
    ['Display · 44/700', <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--text)' }}>Turn a conviction into a trade</span>],
    ['Heading · 20/650', <span style={{ fontSize: 20, fontWeight: 650, color: 'var(--text)' }}>European defense spending supercycle</span>],
    ['Body · 14/450', <span style={{ fontSize: 14, fontWeight: 450, color: 'var(--dim)', lineHeight: 1.55 }}>NATO members are lifting budgets past 3% of GDP. Prime contractors with backlog visibility benefit first.</span>],
    ['Label · 11/650 · uppercase', <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--dimmer)' }}>Invalidation</span>],
    ['Numeric · 15/600 · tabular', <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--up)' }}>$65,431.50 · +2.30%</span>],
    ['Mono · 12', <span style={{ fontSize: 12, fontFamily: mono, color: 'var(--dim)' }}>0x879f…2aee</span>],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--dimmer)', fontWeight: 650 }}>Inter · the app typeface</div>
      {rows.map(([label, el], i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 16 : 0 }}>
          <span style={{ fontSize: 10.5, color: 'var(--dimmer)', fontFamily: mono }}>{label}</span>
          {el}
        </div>
      ))}
    </div>
  );
}

/** Radii, spacing rhythm, and motion — the geometry tokens. */
export function BrandTokens() {
  const radii: [string, string, number][] = [['--radius', '14px', 14], ['--radius-sm', '9px', 9], ['999px', 'pill', 999]];
  const space = [4, 6, 8, 10, 14, 18, 22, 26];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 640 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--dimmer)', fontWeight: 650 }}>Radii</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {radii.map(([tok, hint, r]) => (
            <div key={tok} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: r, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }} />
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{tok}</span>
              <span style={{ fontSize: 10.5, color: 'var(--dimmer)', fontFamily: mono }}>{hint}</span>
            </div>
          ))}
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--dimmer)', fontWeight: 650 }}>Spacing rhythm (px)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          {space.map((s) => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ width: s, height: s, background: 'var(--peach)', borderRadius: 3 }} />
              <span style={{ fontSize: 10, color: 'var(--dimmer)', fontFamily: mono }}>{s}</span>
            </div>
          ))}
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--dimmer)', fontWeight: 650 }}>Motion</div>
        <span style={{ fontSize: 12.5, color: 'var(--dim)', fontFamily: mono }}>--ease · cubic-bezier(.4, 0, .2, 1)</span>
        <span style={{ fontSize: 12.5, color: 'var(--dim)', fontFamily: mono }}>--maxw · 1180px content width</span>
      </section>
    </div>
  );
}
