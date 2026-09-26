// Painters for bedrock, stone and the sedimentary / igneous strata (incl. hydrocarbon-bearing rocks).
import { TEX, Pixmap, ramp, pick, rgb, shade, mixc, WHITE, type RGB } from './Pixmap';
import type { Painter } from './paintNatural';

const r4 = (pal: RGB[]): RGB[] => [shade(pal[1], 0.84), pal[1], pal[0], pal[2] ?? shade(pal[0], 1.12)];

export function paintStoneBase(p: Pixmap, pal: RGB[], cracks = 3) {
  const r = ramp(pal[0], pal[1], pal[2]);
  p.forEach((x, y) => {
    const t = p.f(x, y, 8, 3, 1) * 0.7 + p.h(x, y, 2) * 0.3;
    p.set(x, y, pick(r.slice(0, 4), t));
  });
  for (let i = 0; i < cracks; i++) p.crack(4 + p.ri(4), shade(pal[1], 0.72), shade(pal[2], 1.05));
  p.speckle(shade(pal[2], 1.08), 0.03, 7);
}

export const paintStone: Painter = (p, pal) => paintStoneBase(p, pal, 3);

export const paintBedrock: Painter = (p, pal) => {
  const r = [pal[2], shade(pal[0], 0.9), pal[0], pal[1], shade(pal[1], 1.15)];
  p.forEach((x, y) => {
    const t = p.f(x, y, 4, 2, 1) * 0.6 + p.h(x, y, 2) * 0.4;
    p.set(x, y, pick(r, (t - 0.5) * 1.6 + 0.5));
  });
};

/** Layered sedimentary rock: wavy bands + grain + occasional lamination lines. */
function paintBedded(p: Pixmap, pal: RGB[], freq: number, waviness: number, grain: number) {
  const r = r4(pal);
  p.forEach((x, y) => {
    const band = y + p.n(x, y, 8, 1) * waviness;
    const t = (Math.sin(band * freq) * 0.5 + 0.5) * (1 - grain) + p.h(x, y, 2) * grain;
    p.set(x, y, pick(r, t));
  });
}

export const paintSandstone: Painter = (p, pal) => {
  paintBedded(p, pal, 1.2, 2.2, 0.45);
  for (let y = 2; y < TEX; y += 5) for (let x = 0; x < TEX; x++) if (p.h(x, y, 5) < 0.55) p.blend(x, y + Math.round(p.n(x, y, 8, 6) * 1.5), shade(pal[1], 0.82), 0.6);
  p.speckle(mixc(pal[2], WHITE, 0.3), 0.03, 9);
};

function laminae(p: Pixmap, dark: RGB, light: RGB, count: number) {
  for (let i = 0; i < count; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const len = 3 + p.ri(5);
    for (let k = 0; k < len; k++) {
      p.set(x + k, y, dark);
      p.blend(x + k, y - 1, light, 0.45);
    }
  }
}

export const paintShale: Painter = (p, pal) => {
  paintBedded(p, pal, 2.3, 1.2, 0.3);
  laminae(p, shade(pal[1], 0.7), pal[2], 6);
};

export const paintLimestone: Painter = (p, pal) => {
  const r = r4(pal);
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.6 + p.h(x, y, 2) * 0.4)));
  // fossil shells (small C-shaped arcs)
  for (let i = 0; i < 2; i++) {
    const cx = 2 + p.ri(12);
    const cy = 2 + p.ri(12);
    const d = shade(pal[1], 0.78);
    p.set(cx, cy - 1, d);
    p.set(cx - 1, cy, d);
    p.set(cx, cy + 1, d);
    p.set(cx + 1, cy + 1, d);
    p.set(cx + 1, cy - 1, shade(pal[2], 1.05));
  }
  p.speckle(shade(pal[1], 0.7), 0.025, 7);
};

export const paintDolomite: Painter = (p, pal) => {
  const r = r4(pal);
  const tri = (v: number) => Math.abs(((v % 1) + 1) % 1 - 0.5) * 2;
  p.forEach((x, y) => {
    const t = 0.25 * (tri((x + y) / 5) + tri((x - y) / 5)) + p.h(x, y, 1) * 0.5;
    p.set(x, y, pick(r, t));
  });
  p.speckle(mixc(pal[2], WHITE, 0.4), 0.05, 4);
};

export const paintSalt: Painter = (p, pal) => {
  const v = p.voronoi(5, 2);
  p.forEach((x, y) => {
    const i = y * TEX + x;
    const c = v.cell[i];
    const base = c % 3 === 0 ? pal[1] : c % 3 === 1 ? pal[0] : pal[2];
    const [cx, cy] = v.pts[c];
    const g = ((x - cx) + (y - cy)) * -0.012;
    let col = shade(base, 1 + g);
    if (v.edge[i] < 0.8) col = mixc(base, WHITE, 0.55);
    p.set(x, y, col);
  });
  p.speckle(WHITE, 0.03, 3);
};

export const paintGranite: Painter = (p, pal) => {
  const mica = shade(pal[1], 0.4);
  const quartz = mixc(pal[2], WHITE, 0.55);
  p.forEach((x, y) => {
    const cluster = p.h(x >> 1, y >> 1, 1);
    const hh = p.h(x, y, 2) * 0.35 + cluster * 0.65;
    const col = hh < 0.18 ? mica : hh < 0.36 ? pal[1] : hh < 0.72 ? pal[0] : hh < 0.88 ? pal[2] : quartz;
    p.set(x, y, col);
  });
};

export const paintBasalt: Painter = (p, pal) => {
  const r = r4(pal);
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.5 + p.h(x, y, 2) * 0.5)));
  // columnar joints
  const joint = shade(pal[1], 0.65);
  for (let y = 0; y < TEX; y++) {
    const off = Math.floor(y / 8) % 2 === 0 ? 0 : 4;
    p.set(off, y, joint);
    p.set(off + 8, y, joint);
    p.blend(off + 1, y, pal[2], 0.5);
    p.blend(off + 9, y, pal[2], 0.5);
  }
  for (let x = 0; x < TEX; x++) if ((x + 2) % 8 < 4) p.set(x, 7, joint);
  // vesicles
  for (let i = 0; i < 5; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, shade(pal[1], 0.45));
    p.blend(x, y + 1, pal[2], 0.6);
  }
};

export const paintChalk: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.92), pal[1], pal[0], mixc(pal[0], WHITE, 0.4)];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.5 + p.h(x, y, 2) * 0.5)));
  // flint nodules
  for (let i = 0; i < 2; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const f = rgb(0x4a4c54);
    p.set(x, y, f);
    p.set(x + 1, y, shade(f, 0.8));
    p.set(x, y + 1, shade(f, 0.9));
    p.set(x + 1, y + 1, shade(f, 0.7));
    p.set(x, y - 1, rgb(0x8a8c94));
  }
};

export const paintCoal: Painter = (p, pal) => {
  paintBedded(p, pal, 1.6, 1.5, 0.5);
  // vitreous glints
  for (let i = 0; i < 8; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, rgb(0x8a8a90));
    p.set(x + 1, y, rgb(0x55555a));
  }
};

export const paintMudstone: Painter = (p, pal) => {
  const r = r4(pal);
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 4, 2, 1) * 0.6 + p.h(x, y, 2) * 0.4)));
  const d = shade(pal[1], 0.7);
  for (let i = 0; i < 3; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    for (let k = 0; k < 4; k++) p.set(x + k, y, d);
    for (let k = 0; k < 3; k++) p.set(x + 3, y + k, d);
  }
};

export const paintOilSandstone: Painter = (p, pal) => {
  paintBedded(p, pal, 1.2, 2.2, 0.5);
  // oil-saturated streaks and amber glints
  p.forEach((x, y) => {
    if (p.f(x, y, 8, 2, 7) > 0.62) p.blend(x, y, rgb(0x120d08), 0.55);
  });
  p.speckle(rgb(0xd08a2a), 0.035, 11);
  p.speckle(rgb(0xf6c060), 0.012, 12);
};

export const paintOilLimestone: Painter = (p, pal) => {
  const r = [shade(pal[0], 0.85), pal[0], pal[2], shade(pal[2], 1.1)];
  p.forEach((x, y) => {
    const t = p.f(x, y, 8, 2, 1) * 0.6 + p.h(x, y, 2) * 0.4;
    p.set(x, y, pick(r, t));
    const stain = p.f(x, y, 4, 2, 3);
    if (stain > 0.55) p.blend(x, y, pal[1], Math.min(1, (stain - 0.55) * 4));
  });
  p.speckle(rgb(0x100c08), 0.05, 5);
  p.speckle(rgb(0xc8902e), 0.02, 6);
};

export const paintGasSandstone: Painter = (p, pal) => {
  paintBedded(p, [pal[0], shade(pal[0], 0.85), pal[2]], 1.2, 2.2, 0.45);
  // gas-filled pores: pale blue-grey dots with a bright rim
  for (let i = 0; i < 10; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, pal[1]);
    p.blend(x, y - 1, mixc(pal[1], WHITE, 0.5), 0.5);
  }
};

export const paintGasShale: Painter = (p, pal) => {
  paintBedded(p, pal, 2.3, 1.2, 0.3);
  laminae(p, shade(pal[1], 0.7), pal[2], 4);
  for (let i = 0; i < 4; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    for (let k = 0; k < 5; k++) p.set(x + k, y, mixc(pal[2], rgb(0x8fb4d8), 0.4));
  }
};

export const paintTightOilShale: Painter = (p, pal) => {
  paintBedded(p, pal, 2.4, 1, 0.3);
  laminae(p, shade(pal[1], 0.6), pal[2], 5);
  for (let i = 0; i < 6; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, rgb(0x6e5020));
    p.set(x + 1, y, rgb(0x9a7030));
  }
};

export const paintBrineSandstone: Painter = (p, pal) => {
  paintBedded(p, pal, 1.2, 2.2, 0.45);
  p.forEach((x, y) => {
    if (p.f(x, y, 8, 2, 5) > 0.6) p.blend(x, y, shade(pal[1], 0.8), 0.45);
  });
  p.speckle(mixc(pal[2], rgb(0xbfe6f0), 0.5), 0.03, 7);
};

export const paintCaprock: Painter = (p, pal) => {
  const v = p.voronoi(10, 4);
  const mesh = shade(pal[1], 0.72);
  p.forEach((x, y) => {
    const i = y * TEX + x;
    const nod = v.cell[i] % 2 === 0 ? pal[0] : pal[2];
    p.set(x, y, v.edge[i] < 0.7 ? mesh : shade(nod, 0.97 + p.h(x, y, 1) * 0.06));
  });
};

export const paintOre = (p: Pixmap, pal: RGB[], ore: RGB[]) => {
  paintStoneBase(p, [pal[0], shade(pal[0], 0.85), pal[2] ?? shade(pal[0], 1.1)], 1);
  for (let i = 0; i < 5; i++) {
    const cx = p.ri(TEX);
    const cy = p.ri(TEX);
    const c = ore[i % ore.length];
    const blob: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
    const n = 3 + p.ri(3);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = blob[k];
      p.set(cx + dx, cy + dy, shade(c, 0.92 + p.h(cx + dx, cy + dy, 9) * 0.2));
    }
    p.set(cx, cy, mixc(c, WHITE, 0.4));
    p.blend(cx + 1, cy + 2, shade(pal[0], 0.5), 0.7);
  }
};

export const paintMossyStone: Painter = (p, pal) => {
  paintStoneBase(p, [pal[2], shade(pal[2], 0.82), shade(pal[2], 1.12)], 2);
  const moss = [shade(pal[1], 0.85), pal[1], pal[0], mixc(pal[0], rgb(0xc8d890), 0.25)];
  p.forEach((x, y) => {
    const m = p.f(x, y, 8, 2, 4) + (y < 5 ? 0.12 : 0);
    if (m > 0.55) p.set(x, y, pick(moss, (m - 0.55) * 2 + p.h(x, y, 5) * 0.4));
  });
};

export const paintTerracotta: Painter = (p, pal) => {
  const r = r4(pal);
  p.forEach((x, y) => {
    const band = Math.sin(y * 0.7 + p.n(x, y, 8, 1) * 1.2) * 0.5 + 0.5;
    p.set(x, y, pick(r, band * 0.45 + p.h(x, y, 2) * 0.2 + 0.2));
  });
};

export const paintRedSand: Painter = (p, pal) => {
  const r = r4(pal);
  p.forEach((x, y) => {
    const ripple = Math.sin((y + p.n(x, y, 8, 1) * 3.5) * 1.1) * 0.5 + 0.5;
    p.set(x, y, pick(r, ripple * 0.35 + p.h(x, y, 2) * 0.65));
  });
  p.speckle(shade(pal[1], 0.75), 0.05, 5);
};
