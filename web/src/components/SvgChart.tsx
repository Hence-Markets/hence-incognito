import { useEffect, useRef } from 'react';
import { initCharts } from '../lib/charts.js';

// Renders an SVG string produced by charts.js (priceChart/areaChart/barChart/…)
// and wires the crosshair via initCharts. Lets every screen reuse charts.js as-is.
export function SvgChart({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) { try { initCharts(ref.current); } catch { /* noop */ } }
  }, [html]);
  return <div className={className} ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
