// Colour maps for seismic amplitude images (256-entry RGB lookup tables).
export type ColormapName = 'seismic' | 'gray' | 'rainbow';

function build(stops: [number, [number, number, number]][]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * f);
  }
  return lut;
}

export const COLORMAPS: Record<ColormapName, Uint8Array> = {
  // Classic red–white–blue: negative (troughs) blue, positive (peaks) red.
  seismic: build([
    [0, [8, 24, 110]],
    [0.25, [40, 90, 210]],
    [0.47, [235, 240, 248]],
    [0.53, [248, 238, 232]],
    [0.75, [215, 50, 40]],
    [1, [110, 8, 12]],
  ]),
  gray: build([
    [0, [10, 10, 12]],
    [0.5, [128, 128, 130]],
    [1, [245, 245, 245]],
  ]),
  rainbow: build([
    [0, [48, 18, 59]],
    [0.15, [70, 110, 230]],
    [0.3, [30, 190, 220]],
    [0.45, [60, 230, 120]],
    [0.6, [200, 240, 40]],
    [0.75, [250, 180, 30]],
    [0.9, [230, 70, 20]],
    [1, [122, 4, 3]],
  ]),
};

export const FLUID_COLORS: Record<number, [number, number, number]> = {
  1: [60, 140, 255], // brine
  2: [40, 220, 90], // oil
  3: [255, 60, 60], // gas
};

/** Build a CSS linear-gradient string for a colormap legend. */
export function colormapCss(name: ColormapName): string {
  const lut = COLORMAPS[name];
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = Math.round((i / 8) * 255) * 3;
    stops.push(`rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]}) ${(i / 8) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}
