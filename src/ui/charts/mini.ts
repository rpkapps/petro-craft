// Small SVG visualisations: sparklines, arc gauges, progress rings. Patched in place on update.
import { s, setAttr, setText } from '../dom';

export interface SparkCtl { el: SVGSVGElement; set(data: readonly number[], color?: string): void }

export function sparkline(w = 88, hgt = 24, color = '#ff8a1f', fill = true): SparkCtl {
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;
  const stop0 = s('stop', { offset: '0', 'stop-color': color, 'stop-opacity': '0.35' });
  const stop1 = s('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' });
  const area = s('path', { fill: `url(#${gid})`, stroke: 'none' });
  const line = s('path', { fill: 'none', stroke: color, 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  const dot = s('circle', { r: '2', fill: color });
  const el = s<SVGSVGElement>('svg', { class: 'spark', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, preserveAspectRatio: 'none' },
    s('defs', s('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' }, stop0, stop1)),
    fill ? area : null, line, dot);
  let sig = '';
  let curColor = color;
  return {
    el,
    set(data, c) {
      if (c && c !== curColor) {
        curColor = c;
        setAttr(line, 'stroke', c);
        setAttr(dot, 'fill', c);
        setAttr(stop0, 'stop-color', c);
        setAttr(stop1, 'stop-color', c);
      }
      const k = `${data.length}:${data[0]}:${data[data.length - 1]}:${data[data.length >> 1]}`;
      if (k === sig) return;
      sig = k;
      if (data.length < 2) {
        setAttr(line, 'd', '');
        setAttr(area, 'd', '');
        setAttr(dot, 'cx', -10);
        return;
      }
      let min = Infinity;
      let max = -Infinity;
      for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
      if (max - min < 1e-9) { max += 1; min -= 1; }
      const pad = 2.5;
      const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - pad * 2) + pad, hgt - pad - ((v - min) / (max - min)) * (hgt - pad * 2)] as const);
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
      setAttr(line, 'd', d);
      setAttr(area, 'd', `${d}L${pts[pts.length - 1][0].toFixed(1)} ${hgt}L${pts[0][0].toFixed(1)} ${hgt}Z`);
      setAttr(dot, 'cx', pts[pts.length - 1][0].toFixed(1));
      setAttr(dot, 'cy', pts[pts.length - 1][1].toFixed(1));
    },
  };
}

/** Semi-circular gauge 0..1 with coloured value arc and needle. */
export interface GaugeCtl { el: SVGSVGElement; set(frac: number, label: string, color: string): void }
export function gauge(size = 120, thickness = 10): GaugeCtl {
  const r = size / 2 - thickness;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const A0 = Math.PI * 0.8;
  const A1 = Math.PI * 2.2;
  const track = s('path', { d: arc(A0, A1), stroke: 'rgba(255,255,255,0.1)', 'stroke-width': thickness, fill: 'none', 'stroke-linecap': 'round' });
  const val = s('path', { d: arc(A0, A0 + 0.01), stroke: '#3ddc84', 'stroke-width': thickness, fill: 'none', 'stroke-linecap': 'round', style: 'filter: drop-shadow(0 0 5px currentColor)' });
  const txt = s('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'g-val' }, '0');
  const ticks = s('g', { stroke: 'rgba(255,255,255,0.25)', 'stroke-width': '1.2' });
  for (let i = 0; i <= 10; i++) {
    const a = A0 + ((A1 - A0) * i) / 10;
    const r0 = r + thickness / 2 + 3;
    const r1 = r0 + (i % 5 === 0 ? 5 : 3);
    ticks.appendChild(s('line', { x1: cx + Math.cos(a) * r0, y1: cy + Math.sin(a) * r0, x2: cx + Math.cos(a) * r1, y2: cy + Math.sin(a) * r1 }));
  }
  const el = s<SVGSVGElement>('svg', { class: 'gauge', viewBox: `-6 -6 ${size + 12} ${size * 0.86 + 12}`, width: size, height: size * 0.86 }, ticks, track, val, txt);
  let last = -1;
  return {
    el,
    set(frac, label, color) {
      const f = Math.max(0, Math.min(1, frac));
      if (Math.abs(f - last) > 0.001) {
        last = f;
        setAttr(val, 'd', arc(A0, A0 + Math.max(0.01, (A1 - A0) * f)));
      }
      setAttr(val, 'stroke', color);
      (val as SVGElement).style.color = color;
      setText(txt, label);
    },
  };
}

/** Circular progress ring. */
export interface RingCtl { el: SVGSVGElement; set(frac: number, color?: string): void }
export function ring(size = 28, thickness = 3, color = '#ff8a1f'): RingCtl {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const bg = s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': thickness });
  const fg = s('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': thickness, 'stroke-linecap': 'round',
    'stroke-dasharray': `${c} ${c}`, 'stroke-dashoffset': c, transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  const el = s<SVGSVGElement>('svg', { class: 'ring', viewBox: `0 0 ${size} ${size}`, width: size, height: size }, bg, fg);
  return {
    el,
    set(frac, col) {
      setAttr(fg, 'stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, frac)))).toFixed(2));
      if (col) setAttr(fg, 'stroke', col);
    },
  };
}
