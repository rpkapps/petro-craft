// Cinematic animated oilfield-at-dusk backdrop for the main menu and loading screens.
// Parallax silhouette layers (mountains, refinery, derricks, foreground pumpjacks) are pre-rendered
// to offscreen canvases; per frame we add twinkling stars & lights, flickering flares with glow,
// nodding pumpjacks, drifting haze, rising embers and a slow camera drift.

interface Light { x: number; y: number; r: number; color: string; phase: number; speed: number; blink?: boolean; layer: number }
interface Flare { x: number; y: number; size: number; layer: number; phase: number }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }
interface Pumpjack { x: number; base: number; scale: number; phase: number; speed: number; layer: number }

const PARALLAX = [0.08, 0.2, 0.42, 0.7];

function rand(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MenuBackground {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: HTMLCanvasElement[] = [];
  private sky: HTMLCanvasElement | null = null;
  private W = 0;
  private H = 0;
  private margin = 0;
  private stars: { x: number; y: number; r: number; p: number; s: number }[] = [];
  private lights: Light[] = [];
  private flares: Flare[] = [];
  private embers: Ember[] = [];
  private jacks: Pumpjack[] = [];
  private t = Math.random() * 100;
  private running = false;
  private raf = 0;
  private last = 0;
  dim = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mn-bg';
    this.ctx = this.canvas.getContext('2d')!;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.margin = Math.round(W * 0.08);
    this.build();
  }

  private build() {
    const { W, H } = this;
    const R = rand(1337);
    const horizon = H * 0.66;
    this.lights = [];
    this.flares = [];
    this.jacks = [];
    // sky
    const sky = document.createElement('canvas');
    sky.width = W;
    sky.height = H;
    const sg = sky.getContext('2d')!;
    const grad = sg.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, '#05070f');
    grad.addColorStop(0.35, '#0e1030');
    grad.addColorStop(0.62, '#2a1740');
    grad.addColorStop(0.8, '#6b2a3a');
    grad.addColorStop(0.92, '#c2522a');
    grad.addColorStop(1, '#f08a32');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, W, H);
    const sun = sg.createRadialGradient(W * 0.7, horizon, 0, W * 0.7, horizon, W * 0.55);
    sun.addColorStop(0, 'rgba(255,190,110,0.85)');
    sun.addColorStop(0.12, 'rgba(255,130,50,0.45)');
    sun.addColorStop(0.4, 'rgba(180,60,60,0.12)');
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = sun;
    sg.fillRect(0, 0, W, H);
    // thin cloud streaks
    for (let i = 0; i < 9; i++) {
      const y = horizon * (0.45 + R() * 0.45);
      const x = R() * W;
      const len = W * (0.15 + R() * 0.35);
      const cg = sg.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
      const a = 0.05 + R() * 0.12;
      cg.addColorStop(0, 'rgba(255,150,110,0)');
      cg.addColorStop(0.5, `rgba(255,${120 + R() * 60},${90 + R() * 40},${a})`);
      cg.addColorStop(1, 'rgba(255,150,110,0)');
      sg.fillStyle = cg;
      sg.fillRect(x - len / 2, y, len, H * (0.004 + R() * 0.008));
    }
    this.sky = sky;
    // stars
    this.stars = [];
    for (let i = 0; i < 260; i++) this.stars.push({ x: R() * W, y: Math.pow(R(), 1.6) * horizon * 0.75, r: 0.4 + R() * 1.3, p: R() * 6.28, s: 0.5 + R() * 2.5 });

    const LW = W + this.margin * 2;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = LW;
      c.height = H;
      return c;
    };
    // layer 0: far mountains
    const l0 = mk();
    {
      const g = l0.getContext('2d')!;
      const mg = g.createLinearGradient(0, horizon - H * 0.16, 0, horizon + H * 0.05);
      mg.addColorStop(0, '#2a1a36');
      mg.addColorStop(1, '#1a1226');
      g.fillStyle = mg;
      g.beginPath();
      g.moveTo(0, H);
      let y = horizon - H * 0.05;
      for (let x = 0; x <= LW; x += LW / 90) {
        y += (R() - 0.5) * H * 0.02;
        const ridge = Math.sin(x / LW * 7.3) * H * 0.035 + Math.sin(x / LW * 17.1 + 1) * H * 0.015;
        g.lineTo(x, Math.min(horizon, Math.max(horizon - H * 0.16, y + ridge)));
      }
      g.lineTo(LW, H);
      g.fill();
      const haze = g.createLinearGradient(0, horizon - H * 0.08, 0, horizon + H * 0.02);
      haze.addColorStop(0, 'rgba(240,120,70,0)');
      haze.addColorStop(1, 'rgba(240,120,70,0.28)');
      g.fillStyle = haze;
      g.fillRect(0, horizon - H * 0.08, LW, H * 0.1);
    }
    // layer 1: refinery complex (right) + distant derricks
    const l1 = mk();
    {
      const g = l1.getContext('2d')!;
      const base = horizon + H * 0.02;
      g.fillStyle = '#120d1c';
      g.fillRect(0, base, LW, H - base);
      const col = '#130e1d';
      const x0 = LW * 0.56;
      const span = LW * 0.4;
      const unit = H * 0.01;
      g.fillStyle = col;
      // distillation towers
      const towers = [[0.06, 22, 2.2], [0.1, 30, 2.8], [0.15, 18, 2], [0.36, 26, 2.4], [0.4, 34, 3.2], [0.62, 20, 2.2], [0.8, 28, 2.6], [0.86, 16, 1.8]];
      for (const [fx, hgt, wd] of towers) {
        const x = x0 + span * fx;
        const hh = unit * hgt;
        const ww = unit * wd;
        g.fillRect(x - ww / 2, base - hh, ww, hh);
        g.beginPath();
        g.ellipse(x, base - hh, ww / 2, ww / 3, 0, Math.PI, 0);
        g.fill();
        // platforms / rings
        for (let k = 1; k < hgt / 6; k++) g.fillRect(x - ww * 0.8, base - hh + k * unit * 6, ww * 1.6, unit * 0.35);
        this.lights.push({ x: x + this.margin * 0 - this.margin, y: base - hh - unit * 0.6, r: unit * 0.35, color: '#ff3b30', phase: R() * 6, speed: 1.2 + R(), blink: true, layer: 1 });
        for (let k = 0; k < 4; k++) this.lights.push({ x: x - this.margin + (R() - 0.5) * ww * 1.4, y: base - hh * R() * 0.9, r: unit * (0.12 + R() * 0.16), color: R() > 0.4 ? '#ffd28a' : '#fff4dc', phase: R() * 6, speed: 0.5 + R() * 2, layer: 1 });
      }
      // spheres & tanks
      for (const fx of [0.22, 0.27, 0.5]) {
        const x = x0 + span * fx;
        const r = unit * 3.6;
        g.beginPath();
        g.arc(x, base - r * 1.5, r, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x - r * 0.7, base - r * 0.8, unit * 0.5, r * 0.8);
        g.fillRect(x + r * 0.6, base - r * 0.8, unit * 0.5, r * 0.8);
      }
      for (const [fx, w, hh] of [[0.68, 7, 4], [0.74, 6, 3.5], [0.94, 8, 4.5], [0.45, 5, 3]]) {
        const x = x0 + span * fx;
        g.fillRect(x - (unit * w) / 2, base - unit * hh, unit * w, unit * hh);
        g.beginPath();
        g.ellipse(x, base - unit * hh, (unit * w) / 2, unit * 0.8, 0, Math.PI, 0);
        g.fill();
      }
      // pipe racks
      g.fillRect(x0 - span * 0.05, base - unit * 5, span * 1.05, unit * 0.45);
      g.fillRect(x0 - span * 0.05, base - unit * 3.2, span * 1.05, unit * 0.3);
      for (let x = x0 - span * 0.05; x < x0 + span; x += unit * 3) g.fillRect(x, base - unit * 5, unit * 0.3, unit * 5);
      // chimneys
      for (const fx of [0.3, 0.56]) {
        const x = x0 + span * fx;
        g.fillRect(x - unit * 0.7, base - unit * 42, unit * 1.4, unit * 42);
        this.lights.push({ x: x - this.margin, y: base - unit * 42.5, r: unit * 0.45, color: '#ff3b30', phase: R() * 6, speed: 1.6, blink: true, layer: 1 });
      }
      // flare stack
      const fxp = x0 + span * 0.99;
      g.fillRect(fxp - unit * 0.5, base - unit * 36, unit * 1, unit * 36);
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.moveTo(fxp - unit * 0.5, base - k * unit * 6);
        g.lineTo(fxp - unit * 3 - k * unit * 0.2, base);
        g.lineWidth = unit * 0.15;
        g.strokeStyle = col;
        g.stroke();
      }
      this.flares.push({ x: fxp - this.margin, y: base - unit * 36, size: unit * 3.2, layer: 1, phase: R() * 10 });
      // distant derricks on the left
      for (const [fx, hgt] of [[0.08, 16], [0.2, 12], [0.3, 14]]) this.derrick(g, LW * fx, base, unit * hgt, col, 1, R);
      // general window lights along the base
      for (let i = 0; i < 70; i++) this.lights.push({ x: x0 - this.margin + R() * span, y: base - R() * unit * 8, r: unit * (0.08 + R() * 0.12), color: R() > 0.5 ? '#ffc070' : '#ffe8c0', phase: R() * 6, speed: 0.3 + R() * 3, layer: 1 });
    }
    // layer 2: mid derricks, rig with lights, pipeline
    const l2 = mk();
    {
      const g = l2.getContext('2d')!;
      const base = horizon + H * 0.07;
      const col = '#0b0911';
      const grd = g.createLinearGradient(0, base - H * 0.02, 0, H);
      grd.addColorStop(0, '#0d0a14');
      grd.addColorStop(1, '#07060b');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= LW; x += LW / 60) g.lineTo(x, base + Math.sin(x / LW * 9) * H * 0.008 + (R() - 0.5) * H * 0.004);
      g.lineTo(LW, H);
      g.fill();
      for (const [fx, hgt] of [[0.1, 0.3], [0.33, 0.24], [0.5, 0.2]]) {
        this.derrick(g, LW * fx, base, H * hgt, col, 2, R);
      }
      // drilling rig floor with lights
      const rx = LW * 0.33;
      for (let i = 0; i < 16; i++) this.lights.push({ x: rx - this.margin + (R() - 0.5) * H * 0.06, y: base - H * (0.02 + R() * 0.2), r: H * 0.0016, color: '#fff1c8', phase: R() * 6, speed: 0.4 + R(), layer: 2 });
      // small flare on the left
      g.fillStyle = col;
      g.fillRect(LW * 0.035, base - H * 0.12, H * 0.006, H * 0.12);
      this.flares.push({ x: LW * 0.035 + H * 0.003 - this.margin, y: base - H * 0.12, size: H * 0.02, layer: 2, phase: R() * 10 });
    }
    // layer 3: foreground ground + pipeline + pumpjack posts
    const l3 = mk();
    {
      const g = l3.getContext('2d')!;
      const base = H * 0.86;
      const grd = g.createLinearGradient(0, base, 0, H);
      grd.addColorStop(0, '#060508');
      grd.addColorStop(1, '#020203');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= LW; x += LW / 80) g.lineTo(x, base + Math.sin(x / LW * 5 + 2) * H * 0.02 + (R() - 0.5) * H * 0.006);
      g.lineTo(LW, H);
      g.fill();
      // grass tufts
      g.strokeStyle = '#050407';
      g.lineWidth = Math.max(1, H * 0.0015);
      for (let i = 0; i < 260; i++) {
        const x = R() * LW;
        const y = base + Math.sin(x / LW * 5 + 2) * H * 0.02 + H * 0.004;
        const hgt = H * (0.006 + R() * 0.014);
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + (R() - 0.5) * hgt, y - hgt * 0.6, x + (R() - 0.5) * hgt * 1.2, y - hgt);
        g.stroke();
      }
      // pipeline on supports
      const py = base - H * 0.012;
      g.fillStyle = '#060508';
      g.fillRect(0, py - H * 0.006, LW, H * 0.009);
      for (let x = 0; x < LW; x += H * 0.08) g.fillRect(x, py, H * 0.004, H * 0.03);
      // fence
      for (let x = LW * 0.55; x < LW * 0.95; x += H * 0.03) g.fillRect(x, base - H * 0.03, H * 0.0025, H * 0.035);
      g.fillRect(LW * 0.55, base - H * 0.027, LW * 0.4, H * 0.0015);
      g.fillRect(LW * 0.55, base - H * 0.015, LW * 0.4, H * 0.0015);
    }
    this.layers = [l0, l1, l2, l3];
    // pumpjacks (animated)
    this.jacks.push({ x: W * 0.2, base: H * 0.865, scale: H * 0.2, phase: 0, speed: 1.2, layer: 3 });
    this.jacks.push({ x: W * 0.74, base: H * 0.88, scale: H * 0.13, phase: 1.7, speed: 1.35, layer: 3 });
    this.jacks.push({ x: W * 0.58, base: horizon + H * 0.072, scale: H * 0.06, phase: 0.6, speed: 1.1, layer: 2 });
    this.jacks.push({ x: W * 0.06, base: horizon + H * 0.072, scale: H * 0.05, phase: 2.6, speed: 1.3, layer: 2 });
  }

  private derrick(g: CanvasRenderingContext2D, x: number, base: number, hgt: number, col: string, layer: number, R: () => number) {
    const wBase = hgt * 0.34;
    const wTop = hgt * 0.06;
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = Math.max(1, hgt * 0.012);
    g.beginPath();
    g.moveTo(x - wBase / 2, base);
    g.lineTo(x - wTop / 2, base - hgt);
    g.lineTo(x + wTop / 2, base - hgt);
    g.lineTo(x + wBase / 2, base);
    g.stroke();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const y0 = base - hgt * t0;
      const y1 = base - hgt * t1;
      const w0 = wBase + (wTop - wBase) * t0;
      const w1 = wBase + (wTop - wBase) * t1;
      g.lineWidth = Math.max(0.8, hgt * 0.006);
      g.beginPath();
      g.moveTo(x - w0 / 2, y0);
      g.lineTo(x + w1 / 2, y1);
      g.moveTo(x + w0 / 2, y0);
      g.lineTo(x - w1 / 2, y1);
      g.moveTo(x - w1 / 2, y1);
      g.lineTo(x + w1 / 2, y1);
      g.stroke();
    }
    // crown & drill floor
    g.fillRect(x - wTop, base - hgt - hgt * 0.03, wTop * 2, hgt * 0.03);
    g.fillRect(x - wBase * 0.8, base - hgt * 0.12, wBase * 1.6, hgt * 0.025);
    g.fillRect(x + wBase * 0.4, base - hgt * 0.1, wBase * 0.9, hgt * 0.1);
    this.lights.push({ x: x - this.margin, y: base - hgt - hgt * 0.04, r: Math.max(1.2, hgt * 0.012), color: '#ff3b30', phase: R() * 6, speed: 1.5, blink: true, layer });
    for (let i = 0; i < 5; i++) this.lights.push({ x: x - this.margin + (R() - 0.5) * wBase * 0.6, y: base - hgt * (0.1 + R() * 0.75), r: Math.max(0.8, hgt * 0.006), color: '#fff0c0', phase: R() * 6, speed: 0.3 + R() * 1.5, layer });
  }

  private frame(dt: number) {
    this.resize();
    this.t += dt;
    const { W, H, ctx: g } = this;
    const t = this.t;
    const drift = Math.sin(t * 0.045) * this.margin * 0.9 + Math.sin(t * 0.11) * this.margin * 0.08;
    const lift = Math.sin(t * 0.07) * H * 0.004;
    if (this.sky) g.drawImage(this.sky, 0, 0);
    // stars
    for (const s of this.stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
      g.globalAlpha = a * (1 - s.y / (H * 0.55)) * 0.9;
      g.fillStyle = '#fff';
      g.fillRect(s.x - drift * 0.02, s.y, s.r, s.r);
    }
    g.globalAlpha = 1;
    // layers with parallax
    const offs = PARALLAX.map((p) => -this.margin + drift * p);
    for (let i = 0; i < this.layers.length; i++) {
      g.drawImage(this.layers[i], offs[i], lift * PARALLAX[i] * 3);
      if (i === 0) this.haze(g, H * 0.6, 0.06, t * 0.01);
      if (i === 1) {
        this.drawLights(1, offs[1], lift);
        this.drawFlares(1, offs[1], lift, dt);
        this.haze(g, H * 0.68, 0.1, t * 0.018);
      }
      if (i === 2) {
        this.drawJacks(2, offs[2]);
        this.drawLights(2, offs[2], lift);
        this.drawFlares(2, offs[2], lift, dt);
        this.haze(g, H * 0.76, 0.08, t * 0.025);
      }
      if (i === 3) this.drawJacks(3, offs[3]);
    }
    this.drawEmbers(dt, offs);
    if (this.dim > 0) {
      g.fillStyle = `rgba(3,4,8,${this.dim})`;
      g.fillRect(0, 0, W, H);
    }
  }

  private haze(g: CanvasRenderingContext2D, y: number, a: number, phase: number) {
    const { W, H } = this;
    const band = H * 0.12;
    const grd = g.createLinearGradient(0, y - band, 0, y + band);
    grd.addColorStop(0, 'rgba(160,80,90,0)');
    grd.addColorStop(0.5, `rgba(190,95,85,${a * (0.8 + 0.2 * Math.sin(phase * 6))})`);
    grd.addColorStop(1, 'rgba(160,80,90,0)');
    g.fillStyle = grd;
    g.fillRect(0, y - band, W, band * 2);
  }

  private drawLights(layer: number, off: number, lift: number) {
    const g = this.ctx;
    const t = this.t;
    g.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      if (l.layer !== layer) continue;
      const x = l.x + off + this.margin;
      if (x < -10 || x > this.W + 10) continue;
      const y = l.y + lift * PARALLAX[layer] * 3;
      let a: number;
      if (l.blink) a = Math.sin(t * l.speed * 2 + l.phase) > 0.55 ? 1 : 0.1;
      else a = 0.6 + 0.4 * Math.sin(t * l.speed + l.phase);
      const r = l.r * (l.blink ? 5 : 4);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, l.color);
      grd.addColorStop(0.25, hexToRgba(l.color, 0.45 * a));
      grd.addColorStop(1, hexToRgba(l.color, 0));
      g.globalAlpha = a;
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawFlares(layer: number, off: number, lift: number, dt: number) {
    const g = this.ctx;
    const t = this.t;
    for (const f of this.flares) {
      if (f.layer !== layer) continue;
      const x = f.x + off + this.margin;
      const y = f.y + lift * PARALLAX[layer] * 3;
      const flick = 0.75 + 0.25 * Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2) + 0.1 * Math.sin(t * 31 + f.phase);
      const s = f.size * flick;
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(x, y - s, 0, x, y - s, s * 9);
      glow.addColorStop(0, 'rgba(255,170,70,0.55)');
      glow.addColorStop(0.2, 'rgba(255,110,30,0.2)');
      glow.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = glow;
      g.fillRect(x - s * 9, y - s * 10, s * 18, s * 18);
      // flame tongues
      const sway = Math.sin(t * 2.1 + f.phase) * s * 0.25;
      for (let k = 0; k < 3; k++) {
        const kk = 1 - k * 0.28;
        const fg = g.createLinearGradient(x, y, x, y - s * 3 * kk);
        fg.addColorStop(0, k === 2 ? 'rgba(255,250,220,0.95)' : 'rgba(255,200,90,0.9)');
        fg.addColorStop(0.5, k === 0 ? 'rgba(255,110,30,0.75)' : 'rgba(255,170,60,0.8)');
        fg.addColorStop(1, 'rgba(255,60,20,0)');
        g.fillStyle = fg;
        g.beginPath();
        g.moveTo(x - s * 0.45 * kk, y);
        g.quadraticCurveTo(x - s * 0.6 * kk + sway * 0.4, y - s * 1.6 * kk, x + sway, y - s * 3.2 * kk * (0.9 + 0.1 * Math.sin(t * 17 + k)));
        g.quadraticCurveTo(x + s * 0.6 * kk + sway * 0.4, y - s * 1.4 * kk, x + s * 0.45 * kk, y);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      // spawn embers
      if (Math.random() < dt * (layer === 1 ? 9 : 5)) {
        this.embers.push({ x: f.x + this.margin + Math.random() * s * 0.4 - s * 0.2, y: y - s * 2.5, vx: (Math.random() - 0.3) * s * 0.6, vy: -s * (1.2 + Math.random() * 1.5), life: 0, max: 2.5 + Math.random() * 3, size: Math.max(1, s * (0.05 + Math.random() * 0.07)) });
      }
    }
  }

  private drawEmbers(dt: number, offs: number[]) {
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    const wind = this.H * 0.012;
    for (const e of this.embers) {
      e.life += dt;
      e.x += (e.vx + wind) * dt;
      e.y += e.vy * dt;
      e.vy *= 0.995;
      const a = Math.max(0, 1 - e.life / e.max);
      const x = e.x + offs[1];
      g.fillStyle = `rgba(255,${150 + 80 * a | 0},70,${a * 0.9})`;
      g.beginPath();
      g.arc(x, e.y, e.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    this.embers = this.embers.filter((e) => e.life < e.max && e.y > -20);
    if (this.embers.length > 220) this.embers.splice(0, this.embers.length - 220);
  }

  private drawJacks(layer: number, off: number) {
    const g = this.ctx;
    for (const j of this.jacks) {
      if (j.layer !== layer) continue;
      const x = j.x + off + this.margin;
      if (x < -j.scale * 2 || x > this.W + j.scale * 2) continue;
      drawPumpjack(g, x, j.base, j.scale, this.t * j.speed + j.phase, layer === 3 ? '#040306' : '#0b0911', layer === 3);
    }
  }
}

/** Draw a nodding pumpjack silhouette. `s` = overall height in px. */
function drawPumpjack(g: CanvasRenderingContext2D, x: number, base: number, s: number, phase: number, col: string, detailed: boolean) {
  const ang = Math.sin(phase) * 0.22;
  const pivotY = base - s * 0.72;
  const beamL = s * 1.05;
  g.fillStyle = col;
  g.strokeStyle = col;
  // skid
  g.fillRect(x - s * 0.75, base - s * 0.05, s * 1.5, s * 0.05);
  // samson post (A-frame)
  g.lineWidth = s * 0.045;
  g.beginPath();
  g.moveTo(x - s * 0.2, base - s * 0.04);
  g.lineTo(x, pivotY);
  g.lineTo(x + s * 0.18, base - s * 0.04);
  g.stroke();
  // gearbox & crank
  const cx = x + s * 0.48;
  const cy = base - s * 0.24;
  g.fillRect(cx - s * 0.1, cy - s * 0.02, s * 0.2, s * 0.22);
  const crankA = phase;
  const crx = cx + Math.cos(crankA) * s * 0.13;
  const cry = cy + Math.sin(crankA) * s * 0.13;
  g.save();
  g.translate(cx, cy);
  g.rotate(crankA);
  g.fillRect(-s * 0.2, -s * 0.05, s * 0.4, s * 0.1);
  g.beginPath();
  g.arc(s * 0.2, 0, s * 0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // walking beam
  g.save();
  g.translate(x, pivotY);
  g.rotate(ang);
  g.fillRect(-beamL * 0.55, -s * 0.035, beamL, s * 0.07);
  // horsehead
  g.beginPath();
  g.moveTo(-beamL * 0.55, -s * 0.08);
  g.quadraticCurveTo(-beamL * 0.72, s * 0.04, -beamL * 0.58, s * 0.2);
  g.lineTo(-beamL * 0.5, s * 0.12);
  g.lineTo(-beamL * 0.5, -s * 0.05);
  g.closePath();
  g.fill();
  const tailX = beamL * 0.45;
  g.restore();
  // pitman arm from beam tail to crank pin
  const tx = x + Math.cos(ang) * tailX;
  const ty = pivotY + Math.sin(ang) * tailX;
  g.lineWidth = s * 0.03;
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(crx, cry);
  g.stroke();
  // polished rod / bridle
  const hx = x - Math.cos(ang) * beamL * 0.6;
  const hy = pivotY - Math.sin(ang) * beamL * 0.6 + s * 0.16;
  g.lineWidth = Math.max(1, s * 0.012);
  g.beginPath();
  g.moveTo(hx, hy);
  g.lineTo(hx, base - s * 0.08);
  g.stroke();
  // wellhead
  g.fillRect(hx - s * 0.04, base - s * 0.12, s * 0.08, s * 0.08);
  if (detailed) {
    g.fillRect(x - s * 0.02, pivotY - s * 0.02, s * 0.04, s * 0.04);
  }
}

function hexToRgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const gg = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${a})`;
}
