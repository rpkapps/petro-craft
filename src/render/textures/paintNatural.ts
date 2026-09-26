// Painters for soils, surface covers, water/ice, wood and foliage.
import { TEX, Pixmap, ramp, pick, rgb, shade, mixc, WHITE, type RGB } from './Pixmap';

export type Painter = (p: Pixmap, pal: RGB[]) => void;

const dirtRamp = (d: RGB) => ramp(d, shade(d, 0.8), shade(d, 1.14));

export function paintDirt(p: Pixmap, d: RGB, dark?: RGB, light?: RGB) {
  const r = ramp(d, dark ?? shade(d, 0.82), light ?? shade(d, 1.15));
  p.forEach((x, y) => {
    const t = p.f(x, y, 4, 2, 1) * 0.55 + p.h(x, y, 2) * 0.45;
    p.set(x, y, pick(r.slice(0, 4), t));
  });
  // pebbles with a dark underside
  for (let i = 0; i < 6; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, shade(r[3], 1.08));
    p.blend(x, y + 1, r[0], 0.8);
  }
  // fine roots
  for (let i = 0; i < 2; i++) {
    let x = p.ri(TEX);
    let y = p.ri(TEX);
    for (let k = 0; k < 3; k++) {
      p.blend(x, y, shade(r[4], 0.95), 0.35);
      x += p.r() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
}

function grassRamp(pal: RGB[]): RGB[] {
  const g = pal[0];
  return [shade(pal[1], 0.78), pal[1], g, mixc(shade(g, 1.12), rgb(0xd8e070), 0.12), mixc(shade(g, 1.2), rgb(0xe8f080), 0.25)];
}

export const paintGrassTop: Painter = (p, pal) => {
  const r = grassRamp(pal);
  p.forEach((x, y) => {
    const t = p.f(x, y, 8, 2, 3) * 0.45 + p.h(x, y, 4) * 0.55;
    p.set(x, y, pick(r.slice(0, 4), t));
  });
  // bright blade tips + dark roots under them
  for (let i = 0; i < 14; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, r[4]);
    p.blend(x, y + 1, r[0], 0.5);
  }
};

/** Side texture: soil with an irregular cover overhang (grass, snow, podzol). */
export function paintOverhang(p: Pixmap, soil: RGB, cover: RGB[], minDepth: number, varDepth: number, shadowK = 0.72) {
  paintDirt(p, soil);
  for (let x = 0; x < TEX; x++) {
    const depth = minDepth + Math.floor(p.h(x, 0, 21) * varDepth + p.n(x, 0, 4, 5) * 1.6);
    for (let y = 0; y < depth; y++) {
      const t = p.h(x, y, 22) * 0.6 + (1 - y / depth) * 0.4;
      p.set(x, y, pick(cover, t));
    }
    p.mul(x, depth, shadowK);
    if (p.h(x, 1, 23) < 0.25) p.mul(x, depth + 1, 0.86);
  }
}

export const paintGrassSide: Painter = (p, pal) => paintOverhang(p, pal[2], grassRamp(pal).slice(0, 4), 2, 3);

export const paintDirtTex: Painter = (p, pal) => paintDirt(p, pal[0], pal[1], pal[2]);

export const paintSand: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.9), pal[1], pal[0], pal[2] ?? shade(pal[0], 1.08)];
  p.forEach((x, y) => {
    const ripple = Math.sin((y + p.n(x, y, 8, 1) * 3.5) * 1.1) * 0.5 + 0.5;
    const t = ripple * 0.35 + p.h(x, y, 2) * 0.5 + p.f(x, y, 8, 2, 3) * 0.15;
    p.set(x, y, pick(r, t));
  });
  p.speckle(shade(pal[1], 0.78), 0.05, 9);
  p.speckle(mixc(pal[0], WHITE, 0.35), 0.03, 10);
};

export const paintGravel = (p: Pixmap, pal: RGB[], cells = 11) => {
  const v = p.voronoi(cells, 3);
  const tones = [pal[1], pal[0], pal[2], shade(pal[0], 0.9), mixc(pal[2], rgb(0xa89880), 0.3)];
  p.forEach((x, y) => {
    const i = y * TEX + x;
    const c = v.cell[i];
    const base = tones[c % tones.length];
    const [cx, cy] = v.pts[c];
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    let col = base;
    if (v.edge[i] < 0.9) col = shade(pal[1], 0.62);
    else if (dx + dy < -1.5) col = shade(base, 1.12);
    else if (dx + dy > 1.8) col = shade(base, 0.86);
    p.set(x, y, shade(col, 0.96 + p.h(x, y, 4) * 0.08));
  });
};

export const paintClay: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.92), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => {
    const band = Math.sin(y * 0.85 + p.f(x, y, 8, 2, 1) * 3) * 0.5 + 0.5;
    p.set(x, y, pick(r, band * 0.7 + p.h(x, y, 2) * 0.3));
  });
  p.speckle(shade(pal[1], 0.8), 0.03, 7);
};

export const paintWater: Painter = (p, pal) => {
  const deep = pal[0];
  const light = pal[1] ?? shade(deep, 1.2);
  p.forEach((x, y) => {
    const w = Math.sin((x * 0.8 + y * 0.4) + p.f(x, y, 8, 2, 1) * 6) * 0.5 + 0.5;
    p.set(x, y, w > 0.8 ? mixc(light, WHITE, 0.2) : w > 0.5 ? light : deep, 0.8);
  });
};

export const paintSnow: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.94), pal[1], pal[0], mixc(pal[0], WHITE, 0.6)];
  p.forEach((x, y) => {
    const t = p.f(x, y, 8, 2, 1) * 0.55 + p.h(x, y, 2) * 0.45;
    p.set(x, y, pick(r, t));
  });
  p.speckle(WHITE, 0.04, 5);
  p.speckle(rgb(0xc6d8ea), 0.04, 6);
};

export const paintSnowSide: Painter = (p, pal) => {
  const cover = [shade(pal[1], 0.95), pal[1], pal[0], mixc(pal[0], WHITE, 0.5)];
  paintOverhang(p, pal[2], cover, 3, 3, 0.7);
};

export const paintIce: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.9), pal[1], pal[0], mixc(pal[0], WHITE, 0.45)];
  p.forEach((x, y) => {
    const streak = ((x + y + Math.floor(p.n(x, y, 8, 1) * 4)) % 7 === 0 ? 0.35 : 0) + p.f(x, y, 8, 2, 2) * 0.5 + p.h(x, y, 3) * 0.15;
    p.set(x, y, pick(r, streak), 0.72);
  });
  p.crack(9, mixc(pal[0], WHITE, 0.75), null, [1, 1]);
  for (let x = 0; x < TEX; x++) {
    p.setAlpha(x, 0, 0.85);
    p.setAlpha(0, x, 0.85);
  }
};

export const paintMud: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.85), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.7 + p.h(x, y, 2) * 0.3)));
  // wet glossy highlights
  for (let i = 0; i < 5; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    p.set(x, y, mixc(pal[2], WHITE, 0.25));
    p.blend(x + 1, y, pal[2], 0.7);
  }
};

export const paintPodzolTop: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.85), pal[1], pal[0], shade(pal[0], 1.15)];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 4, 2, 1) * 0.5 + p.h(x, y, 2) * 0.5)));
  const needle = rgb(0x9a6e3a);
  for (let i = 0; i < 16; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const dx = p.r() < 0.5 ? 1 : -1;
    p.set(x, y, needle);
    p.set(x + dx, y + 1, shade(needle, 0.85));
  }
};

export const paintPodzolSide: Painter = (p, pal) => paintOverhang(p, pal[2], [shade(pal[1], 0.85), pal[1], pal[0], shade(pal[0], 1.12)], 2, 2);

export const paintSilt: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.9), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => {
    const ripple = Math.sin((x * 0.9 + p.n(x, y, 8, 2) * 3)) * 0.5 + 0.5;
    p.set(x, y, pick(r, ripple * 0.35 + p.h(x, y, 1) * 0.65));
  });
  p.speckle(rgb(0xe6e0cc), 0.02, 3);
};

export const paintScorched: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.8), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 4, 2, 1) * 0.6 + p.h(x, y, 2) * 0.4)));
  for (let i = 0; i < 3; i++) p.crack(6, rgb(0x6a625c), null);
  p.speckle(rgb(0xb8461e), 0.018, 8);
};

export const paintAsh: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.9), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 4, 2, 1) * 0.35 + p.h(x, y, 2) * 0.65)));
  p.speckle(rgb(0xc8c8c4), 0.04, 5);
  p.speckle(rgb(0x2a2a2a), 0.03, 6);
};

export const paintPermafrost: Painter = (p, pal) => {
  paintDirt(p, pal[0], shade(pal[2], 0.9), shade(pal[0], 1.12));
  for (let i = 0; i < 5; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const len = 2 + p.ri(4);
    for (let k = 0; k < len; k++) p.set(x + k, y, k === 0 ? mixc(pal[1], WHITE, 0.4) : pal[1]);
  }
};

// ---- wood ---------------------------------------------------------------------------------------

export function paintBark(p: Pixmap, base: RGB, dark: RGB, fissureDepth: number) {
  const r = [shade(dark, 0.78), dark, base, shade(base, 1.12)];
  p.forEach((x, y) => {
    const col = p.h(x, 0, 1) * 0.5 + p.n(x, y, 8, 2) * 0.3 + p.h(x, y, 3) * 0.2;
    p.set(x, y, pick(r, col));
  });
  // vertical fissures
  for (let i = 0; i < 5 + fissureDepth; i++) {
    const x = p.ri(TEX);
    const y0 = p.ri(TEX);
    const len = 3 + p.ri(6);
    for (let k = 0; k < len; k++) {
      p.set(x, y0 + k, r[0]);
      p.blend(x + 1, y0 + k, r[3], 0.35);
    }
  }
}

export function paintRings(p: Pixmap, wood: RGB, bark: RGB, barkDark: RGB) {
  const light = shade(wood, 1.06);
  const dark = shade(wood, 0.82);
  p.forEach((x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy) + p.n(x, y, 4, 1) * 0.8;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    if (edge > 6.6) p.set(x, y, p.h(x, y, 2) < 0.5 ? bark : barkDark);
    else p.set(x, y, Math.floor(d * 0.95) % 2 === 0 ? light : dark);
  });
  p.set(7, 7, shade(wood, 0.65));
  p.set(8, 8, shade(wood, 0.72));
  // radial check crack
  for (let k = 1; k < 5; k++) p.set(8 + k, 7, shade(wood, 0.6));
}

export const paintLogOak: Painter = (p, pal) => paintBark(p, pal[0], pal[1], 2);
export const paintLogOakTop: Painter = (p, pal) => paintRings(p, pal[2], pal[0], pal[1]);
export const paintLogPine: Painter = (p, pal) => paintBark(p, pal[0], pal[1], 5);
export const paintLogPineTop: Painter = (p, pal) => paintRings(p, pal[2], pal[0], pal[1]);

export const paintBirchLog: Painter = (p, pal) => {
  const white = pal[0];
  const r = [shade(white, 0.82), shade(white, 0.9), white, mixc(white, WHITE, 0.4)];
  p.forEach((x, y) => p.set(x, y, pick(r, p.n(x, y, 8, 1) * 0.5 + p.h(x, y, 2) * 0.5)));
  for (let i = 0; i < 7; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const len = 2 + p.ri(4);
    for (let k = 0; k < len; k++) p.set(x + k, y, k === 0 || k === len - 1 ? shade(pal[1], 1.6) : pal[1]);
  }
};
export const paintBirchTop: Painter = (p, pal) => paintRings(p, pal[2], pal[0], shade(pal[0], 0.8));

// ---- foliage (cut-out) --------------------------------------------------------------------------

export function paintLeaves(p: Pixmap, pal: RGB[], holes: number, accents: RGB[] = []) {
  const r = [shade(pal[1], 0.72), pal[1], pal[0], pal[2], mixc(pal[2], rgb(0xf0f0a0), 0.2)];
  p.forEach((x, y) => {
    const clump = p.f(x, y, 4, 2, 1);
    const hsh = p.h(x, y, 2);
    const open = clump * 0.6 + hsh * 0.4 < holes;
    // light from the top-left of each clump
    const lightT = clump * 0.55 + (1 - p.n(x + 1, y + 1, 4, 1)) * 0.2 + hsh * 0.35;
    p.set(x, y, pick(r, lightT), open ? 0 : 1);
  });
  for (const a of accents) p.speckle(a, 0.05, 30 + accents.indexOf(a));
}

export const paintLeavesOak: Painter = (p, pal) => paintLeaves(p, pal, 0.3);
export const paintLeavesBirch: Painter = (p, pal) => paintLeaves(p, pal, 0.32, [rgb(0xb8d870)]);
export const paintLeavesAutumn: Painter = (p, pal) => paintLeaves(p, pal, 0.33, [rgb(0xc23c1c), rgb(0xf2c84a)]);

export const paintLeavesPine: Painter = (p, pal) => {
  p.clear();
  const cols = [shade(pal[1], 0.8), pal[1], pal[0], pal[2]];
  // needle sprays: short diagonal strokes on a mostly-filled dark base
  p.forEach((x, y) => {
    if (p.f(x, y, 4, 2, 3) > 0.28) p.set(x, y, shade(pal[1], 0.75), 1);
  });
  for (let i = 0; i < 46; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    const dir = p.r() < 0.5 ? 1 : -1;
    const c = cols[1 + p.ri(3)];
    for (let k = 0; k < 3; k++) p.set(x + k * dir, y + k, c, 1);
  }
};

function blade(p: Pixmap, x0: number, h: number, lean: number, dark: RGB, light: RGB) {
  for (let k = 0; k < h; k++) {
    const t = k / Math.max(1, h - 1);
    const x = Math.round(x0 + lean * k * k * 0.05);
    p.set(x, TEX - 1 - k, mixc(dark, light, t));
  }
}

export const paintTallGrass: Painter = (p, pal) => {
  p.clear();
  for (let i = 0; i < 11; i++) {
    const x = 1 + p.ri(14);
    const h = 6 + p.ri(9);
    blade(p, x, h, (p.r() - 0.5) * 1.6, shade(pal[1], 0.75), mixc(pal[0], rgb(0xe0f080), 0.25));
  }
};

function stem(p: Pixmap, x: number, top: number, c: RGB) {
  for (let y = top; y < TEX; y++) p.set(x, y, c);
}

export const paintFlowerRed: Painter = (p, pal) => {
  p.clear();
  const g = pal[1];
  stem(p, 8, 6, g);
  p.set(7, 11, g);
  p.set(6, 10, shade(g, 1.2));
  p.set(9, 12, g);
  p.set(10, 11, shade(g, 1.2));
  const red = pal[0];
  const petals: [number, number, number][] = [
    [6, 3, 1], [7, 3, 1.1], [8, 3, 1.1], [9, 3, 1], [5, 4, 0.9], [6, 4, 1.05], [7, 4, 1], [8, 4, 1], [9, 4, 1.05], [10, 4, 0.9],
    [5, 5, 0.85], [6, 5, 0.95], [9, 5, 0.95], [10, 5, 0.85], [6, 6, 0.8], [7, 6, 0.85], [8, 6, 0.85], [9, 6, 0.8], [7, 2, 1.2], [8, 2, 1.15],
  ];
  for (const [x, y, k] of petals) p.set(x, y, shade(red, k));
  p.set(7, 5, rgb(0x1c1414));
  p.set(8, 5, rgb(0x2a1a14));
};

export const paintFlowerYellow: Painter = (p, pal) => {
  p.clear();
  const g = pal[1];
  stem(p, 7, 7, g);
  p.set(6, 12, g);
  p.set(5, 11, shade(g, 1.2));
  p.set(8, 13, g);
  const y0 = pal[0];
  for (let y = 3; y <= 7; y++)
    for (let x = 5; x <= 9; x++) {
      const dx = x - 7;
      const dy = y - 5;
      if (dx * dx + dy * dy <= 5) p.set(x, y, shade(y0, 1.05 - (dx + dy) * 0.05 + (p.h(x, y, 3) - 0.5) * 0.15));
    }
  p.set(7, 5, shade(y0, 0.75));
};

export const paintDeadBush: Painter = (p, pal) => {
  p.clear();
  const c = pal[0];
  const d = pal[1];
  const branch = (x: number, y: number, dx: number, len: number, depth: number) => {
    let cx = x;
    let cy = y;
    for (let k = 0; k < len; k++) {
      cy -= 1;
      if (p.r() < 0.6) cx += dx;
      p.set(cx, cy, k < len / 2 ? d : c);
      if (depth > 0 && p.r() < 0.28) branch(cx, cy, -dx, Math.max(2, len - k - 1), depth - 1);
    }
  };
  branch(8, 16, 1, 9, 2);
  branch(7, 16, -1, 8, 2);
  branch(8, 16, 0, 6, 1);
};

export const paintReeds: Painter = (p, pal) => {
  p.clear();
  const head = rgb(0x5e3e22);
  for (const x of [3, 7, 11, 13]) {
    const h = 11 + p.ri(5);
    blade(p, x, h, (p.r() - 0.5) * 0.6, shade(pal[1], 0.8), pal[0]);
    if (p.r() < 0.7) {
      const top = TEX - h;
      for (let y = top + 1; y < top + 4; y++) {
        p.set(x, y, head);
        p.set(x + 1, y, shade(head, 0.8));
      }
    }
  }
};

export const paintSeagrass: Painter = (p, pal) => {
  p.clear();
  for (let i = 0; i < 7; i++) {
    const x0 = 1 + p.ri(14);
    const h = 8 + p.ri(8);
    const ph = p.r() * 6;
    for (let k = 0; k < h; k++) {
      const x = Math.round(x0 + Math.sin(k * 0.55 + ph) * 1.2);
      p.set(x, TEX - 1 - k, mixc(shade(pal[1], 0.8), shade(pal[0], 1.15), k / h));
    }
  }
};

export const paintKelp: Painter = (p, pal) => {
  p.clear();
  for (let y = 0; y < TEX; y++) {
    const x = Math.round(7.5 + Math.sin(y * 0.4) * 1.5);
    p.set(x, y, pal[1]);
    p.set(x + 1, y, shade(pal[1], 0.85));
    if (y % 4 === 1) {
      const side = (y >> 2) % 2 === 0 ? 1 : -1;
      for (let k = 1; k < 5; k++) p.set(x + (side > 0 ? 1 + k : -k), y + (k >> 1), mixc(pal[0], rgb(0x9ac070), k / 8));
    }
    if (y % 8 === 5) p.set(x + 1, y, rgb(0x8a9a3a));
  }
};

export const paintCactus: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.85), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => {
    const rib = x % 4;
    const t = rib === 1 ? 0.8 : rib === 3 ? 0.1 : 0.45 + p.h(x, y, 1) * 0.2;
    p.set(x, y, pick(r, t));
  });
  const spine = rgb(0xece6b8);
  for (let y = 1; y < TEX; y += 3) for (let x = 1; x < TEX; x += 4) if (p.h(x, y, 4) < 0.7) p.set(x, y + ((x >> 2) % 2), spine);
};

export const paintCactusTop: Painter = (p, pal) => {
  p.forEach((x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const a = Math.atan2(dy, dx);
    const d = Math.sqrt(dx * dx + dy * dy);
    const rib = Math.cos(a * 8) > 0.3;
    let c = rib ? pal[2] : pal[0];
    if (d > 6.5) c = pal[1];
    if (d < 1.5) c = shade(pal[2], 1.15);
    p.set(x, y, shade(c, 0.95 + p.h(x, y, 2) * 0.1));
  });
};

export const paintCoral: Painter = (p, pal) => {
  const v = p.voronoi(9, 5);
  p.forEach((x, y) => {
    const i = y * TEX + x;
    const c = pal[v.cell[i] % pal.length];
    const [cx, cy] = v.pts[v.cell[i]];
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    let col = shade(c, 1.1 - d * 0.08);
    if (v.edge[i] < 0.8) col = shade(c, 0.55);
    if (d < 0.9) col = mixc(c, WHITE, 0.5);
    p.set(x, y, col);
  });
};

export { dirtRamp };
