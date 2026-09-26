// Painters for man-made materials: concrete, asphalt, steel, brick, glass, planks, containers, pipes,
// hazard stripes, lamps, fire, oil spills and block-breaking crack overlays.
import { TEX, Pixmap, pick, rgb, shade, mixc, WHITE, BLACK, type RGB } from './Pixmap';
import type { Painter } from './paintNatural';
import { paintGravel } from './paintNatural';

export const paintConcrete: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.95), pal[1], pal[0], pal[2]];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.55 + p.h(x, y, 2) * 0.45)));
  p.speckle(shade(pal[1], 0.78), 0.035, 3);
  p.speckle(mixc(pal[2], WHITE, 0.25), 0.025, 4);
  // panel seam + formwork tie holes
  for (let i = 0; i < TEX; i++) {
    p.mul(i, 0, 0.9);
    p.mul(0, i, 0.9);
    p.mul(i, 15, 1.04);
    p.mul(15, i, 1.04);
  }
  for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]] as const) {
    p.set(x, y, shade(pal[1], 0.62));
    p.blend(x + 1, y + 1, pal[2], 0.6);
  }
};

export const paintConcretePad: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.95), pal[1], pal[0], shade(pal[0], 1.06)];
  p.forEach((x, y) => {
    p.set(x, y, pick(r, p.f(x, y, 8, 2, 1) * 0.5 + p.h(x, y, 2) * 0.5));
    const stain = p.f(x, y, 8, 2, 6);
    if (stain > 0.66) p.blend(x, y, shade(pal[1], 0.75), 0.35);
  });
  p.speckle(shade(pal[1], 0.7), 0.03, 3);
  const joint = shade(pal[1], 0.62);
  for (let i = 0; i < TEX; i++) {
    p.set(i, 0, joint);
    p.set(0, i, joint);
    p.blend(i, 1, WHITE, 0.08);
    p.blend(1, i, WHITE, 0.08);
  }
};

export const paintAsphalt: Painter = (p, pal) => {
  const r = [shade(pal[1], 0.85), pal[1], pal[0], shade(pal[0], 1.15)];
  p.forEach((x, y) => p.set(x, y, pick(r, p.f(x, y, 4, 2, 1) * 0.3 + p.h(x, y, 2) * 0.7)));
  p.speckle(rgb(0x6a6a6c), 0.05, 5);
  p.speckle(rgb(0x8c8a86), 0.015, 6);
  p.crack(5, shade(pal[1], 0.65), null);
};

export const paintGravelPad: Painter = (p, pal) => paintGravel(p, pal, 16);

export const paintSteelPlate: Painter = (p, pal) => {
  const base = pal[0];
  p.forEach((x, y) => {
    const brushed = p.n(x * 0.25, y, 4, 1) * 0.1 + p.h(x >> 2, y, 2) * 0.06;
    p.set(x, y, shade(base, 0.94 + brushed));
  });
  // diamond tread bumps
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const x = i * 4 + (j % 2) * 2 + 1;
      const y = j * 4 + 1;
      const dir = (i + j) % 2 === 0;
      p.set(x, y + (dir ? 0 : 1), shade(pal[2], 1.12));
      p.set(x + 1, y + (dir ? 1 : 0), shade(pal[1], 0.82));
    }
  for (let i = 0; i < TEX; i++) {
    p.blend(i, 0, pal[2], 0.6);
    p.blend(0, i, pal[2], 0.5);
    p.blend(i, 15, shade(pal[1], 0.7), 0.7);
    p.blend(15, i, shade(pal[1], 0.7), 0.6);
  }
};

export const paintSteelGrate: Painter = (p, pal) => {
  p.clear();
  const bar = pal[0];
  const dark = pal[1];
  p.forEach((x, y) => {
    const onX = x % 4 === 0;
    const onY = y % 4 === 0;
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) p.set(x, y, x === 15 || y === 15 ? dark : shade(bar, 1.15), 1);
    else if (onX || onY) p.set(x, y, onX && onY ? shade(bar, 1.1) : onY ? bar : shade(bar, 0.85), 1);
  });
};

export const paintBrick: Painter = (p, pal) => {
  const mortar = pal[2];
  p.forEach((x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 === 0 ? 0 : 4;
    const bx = Math.floor((x + off) / 8);
    const lx = (x + off) % 8;
    const ly = y % 4;
    if (ly === 3 || lx === 7) {
      p.set(x, y, shade(mortar, 0.92 + p.h(x, y, 1) * 0.1));
      return;
    }
    const k = p.h(bx, row, 2);
    const b = mixc(pal[0], pal[1], k * 0.8);
    let c = shade(b, 0.94 + p.h(x, y, 3) * 0.12);
    if (ly === 0) c = shade(c, 1.1);
    if (ly === 2) c = shade(c, 0.9);
    if (lx === 0) c = shade(c, 1.05);
    p.set(x, y, c);
  });
};

export const paintGlass: Painter = (p, pal) => {
  const tint = pal[0];
  p.forEach((x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) p.set(x, y, x === 15 || y === 15 ? shade(tint, 0.7) : mixc(tint, WHITE, 0.4), 0.95);
    else p.set(x, y, tint, 0.14);
  });
  // glare streaks
  for (let i = 0; i < TEX; i++) {
    const a = 3 + i;
    const b = 10 + i;
    if (i > 0 && i < 15) {
      if (a > 0 && a < 15) p.set(a, 15 - i, WHITE, 0.4);
      if (a + 1 > 0 && a + 1 < 15) p.set(a + 1, 15 - i, WHITE, 0.28);
      if (b > 0 && b < 15) p.set(b, 15 - i, WHITE, 0.32);
    }
  }
  p.set(1, 1, WHITE, 0.9);
  p.set(2, 1, WHITE, 0.6);
  p.set(1, 2, WHITE, 0.6);
};

export const paintPlanks: Painter = (p, pal) => {
  for (let board = 0; board < 4; board++) {
    const k = 0.9 + p.h(board, 0, 1) * 0.2;
    const joint = p.ri(TEX);
    for (let ly = 0; ly < 4; ly++) {
      const y = board * 4 + ly;
      for (let x = 0; x < TEX; x++) {
        const grain = Math.sin((x + p.n(x, y, 8, board) * 6) * 0.9 + ly * 1.7) * 0.5 + 0.5;
        const col = grain > 0.75 ? pal[2] : grain < 0.25 ? pal[1] : pal[0];
        let c = shade(col, k * (0.97 + p.h(x, y, 2) * 0.06));
        if (ly === 3) c = shade(pal[1], 0.72);
        if (ly === 0) c = shade(c, 1.06);
        if (x === joint) c = shade(pal[1], 0.7);
        p.set(x, y, c);
      }
      if (ly === 1) {
        p.set(joint + 1, y, rgb(0x4a4a4a));
        p.set(joint - 1, y, rgb(0x4a4a4a));
      }
    }
  }
};

export const paintHazard: Painter = (p, pal) => {
  const yel = pal[0];
  const blk = pal[1];
  p.forEach((x, y) => {
    const s = (((x + y) % 8) + 8) % 8 < 4;
    const base = s ? yel : blk;
    p.set(x, y, shade(base, 0.95 + p.h(x, y, 1) * 0.08));
  });
  // wear: scratches and grime
  for (let i = 0; i < 4; i++) {
    const x = p.ri(TEX);
    const y = p.ri(TEX);
    for (let k = 0; k < 3; k++) p.blend(x + k, y, rgb(0x8a8680), 0.6);
  }
  p.forEach((x, y) => {
    if (p.f(x, y, 8, 2, 4) > 0.68) p.blend(x, y, rgb(0x3a3024), 0.3);
  });
};

export const paintLamp: Painter = (p, pal) => {
  const frame = pal[2];
  p.forEach((x, y) => {
    const e = Math.min(x, y, 15 - x, 15 - y);
    if (e < 2) {
      let c = frame;
      if (e === 0) c = x === 15 || y === 15 ? shade(frame, 0.65) : shade(frame, 1.25);
      p.set(x, y, c);
      return;
    }
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy) / 7;
    p.set(x, y, mixc(mixc(pal[0], WHITE, 0.45), pal[1], Math.min(1, d * 1.1)));
  });
  // protective cage
  const cage = shade(frame, 0.55);
  for (let i = 2; i < 14; i++) {
    p.set(5, i, cage);
    p.set(10, i, cage);
    p.set(i, 7, cage);
  }
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]] as const) p.set(x, y, shade(frame, 1.4));
};

export function paintContainerSide(p: Pixmap, pal: RGB[]) {
  const base = pal[0];
  p.forEach((x, y) => {
    const rib = x % 4;
    let c = rib === 0 ? shade(base, 0.72) : rib === 1 ? shade(base, 1.14) : shade(base, 0.98);
    c = shade(c, 0.97 + p.h(x, y, 1) * 0.06);
    if (y < 2 || y > 13) c = shade(pal[1], y === 0 || y === 15 ? 0.7 : 0.95);
    p.set(x, y, c);
  });
  // rust streaks
  const rust = rgb(0x7a4a28);
  for (let i = 0; i < 4; i++) {
    const x = p.ri(TEX);
    const y = 2 + p.ri(4);
    const len = 2 + p.ri(5);
    for (let k = 0; k < len; k++) p.blend(x, y + k, rust, 0.45 - k * 0.05);
  }
}

export const paintContainerTop: Painter = (p, pal) => {
  const g = pal[2];
  p.forEach((x, y) => {
    const rib = y % 4;
    let c = rib === 0 ? shade(g, 0.78) : rib === 1 ? shade(g, 1.12) : g;
    if (x === 0 || x === 15) c = shade(g, 0.7);
    p.set(x, y, shade(c, 0.96 + p.h(x, y, 1) * 0.08));
  });
  p.speckle(rgb(0x7a4a28), 0.03, 5, 0.6);
};

/**
 * Pipe skin. u (x) runs along the pipe, v (y) around the circumference. Fake specular band near the
 * top of v, a colour-coded identification band with flow chevrons, and weld seams at both ends.
 */
export function paintPipe(p: Pixmap, body: RGB, band: RGB, chevron: RGB, gloss = 1) {
  p.forEach((x, y) => {
    const around = Math.cos(((y + 0.5) / TEX) * Math.PI * 2 - 0.9) * 0.5 + 0.5;
    let c = shade(body, 0.8 + around * 0.3 * gloss);
    c = shade(c, 0.97 + p.h(x, y, 1) * 0.06);
    if (y === 3 || y === 4) c = mixc(c, WHITE, 0.14 * gloss);
    if (x >= 6 && x <= 9) c = shade(band, 0.86 + around * 0.26);
    if (x === 0 || x === 15) c = shade(c, 0.7);
    if (x === 1) c = shade(c, 1.08);
    p.set(x, y, c);
  });
  // flow chevrons on the band
  for (const yy of [2, 10]) {
    p.set(7, yy, chevron);
    p.set(8, yy + 1, chevron);
    p.set(7, yy + 2, chevron);
  }
}

export const paintPipeOil: Painter = (p, pal) => paintPipe(p, pal[0], pal[2], BLACK, 0.8);
export const paintPipeGas: Painter = (p, pal) => paintPipe(p, pal[0], pal[2], pal[0], 1);
export const paintPipeWater: Painter = (p, pal) => paintPipe(p, pal[0], pal[2], pal[1], 1);
export const paintPipeProduct: Painter = (p, pal) => paintPipe(p, pal[0], pal[2], pal[1], 1);

export const paintCasing: Painter = (p, pal) => {
  p.forEach((x, y) => {
    const around = Math.cos(((y + 0.5) / TEX) * Math.PI * 2 - 0.9) * 0.5 + 0.5;
    let c = shade(pal[0], 0.78 + around * 0.32);
    if (x <= 2) c = shade(pal[1], 0.9 + around * 0.3);
    if (x === 3) c = shade(pal[1], 0.7);
    p.set(x, y, shade(c, 0.97 + p.h(x, y, 1) * 0.06));
  });
  p.speckle(rgb(0x7a5a38), 0.02, 3, 0.5);
};

export const paintOilPool: Painter = (p, pal) => {
  p.forEach((x, y) => {
    const t = p.f(x, y, 8, 2, 1);
    let c = mixc(pal[0], pal[1], t * 0.8);
    const sheen = p.f(x, y, 4, 2, 5);
    if (sheen > 0.62) {
      const hue = (sheen - 0.62) * 8;
      const irid: RGB = [90 + 60 * Math.sin(hue * 6.28), 70 + 60 * Math.sin(hue * 6.28 + 2.1), 90 + 60 * Math.sin(hue * 6.28 + 4.2)];
      c = mixc(c, irid, 0.35);
    }
    p.set(x, y, c, 0.94);
  });
};

export const paintFire: Painter = (p, pal) => {
  p.clear();
  const core = mixc(pal[2], WHITE, 0.3);
  for (let x = 0; x < TEX; x++) {
    const edge = 1 - Math.abs(x - 7.5) / 8;
    const h = 5 + edge * 9 + p.n(x, 0, 2, 1) * 5;
    for (let yb = 0; yb < h; yb++) {
      const t = 1 - yb / h;
      const hole = p.f(x, yb, 4, 2, 3) + (1 - t) * 0.5;
      if (hole > 0.95) continue;
      const c = t > 0.72 && edge > 0.45 ? core : t > 0.5 ? pal[2] : t > 0.28 ? pal[0] : pal[1];
      p.set(x, TEX - 1 - yb, c, 1);
    }
  }
};

export const paintMissing: Painter = (p) => {
  p.forEach((x, y) => p.set(x, y, shade(rgb(0x808080), 0.9 + p.h(x, y, 1) * 0.2)));
};

/** Crack overlay stage 0..9 (dark lines on transparent; multiplied over the block in the shader). */
export function paintCrack(p: Pixmap, stage: number) {
  p.clear();
  const total = 150;
  const draw = Math.floor(((stage + 1) / 10) * total);
  // fixed branching crack skeleton from the centre (same seed for every stage so it "grows")
  let drawn = 0;
  const walk = (x: number, y: number, dx: number, dy: number, len: number, depth: number, salt: number) => {
    let cx = x;
    let cy = y;
    for (let k = 0; k < len && drawn < draw; k++) {
      const hh = p.h(k, depth, salt);
      if (hh < 0.33) cx += dx;
      else if (hh < 0.66) cy += dy;
      else {
        cx += dx;
        cy += dy;
      }
      if (cx < 0 || cy < 0 || cx > 15 || cy > 15) return;
      p.set(cx, cy, [40, 34, 30], 1);
      drawn++;
      if (depth < 3 && p.h(k, depth, salt + 1) < 0.18) walk(cx, cy, p.h(k, 3, salt) < 0.5 ? dx : -dx, p.h(k, 4, salt) < 0.5 ? dy : -dy, len - k, depth + 1, salt + 7);
    }
  };
  const dirs: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let round = 0; round < 3 && drawn < draw; round++)
    dirs.forEach(([dx, dy], i) => walk(7 + (i % 2), 7 + ((i >> 1) % 2), dx, dy, 5 + round * 3, 0, i * 13 + round * 101));
}
