// PetroCraft icon set: consistent 24×24 stroke icons (1.8px, round caps) drawn as inline SVG.
// Usage: icon('oil') → <svg class="ic">…</svg>. Elements with fill="currentColor" are solid accents.
import type { BuildingCategory } from '../content/buildings';
import type { WeatherKind } from '../core/types';

function gear(): string {
  const teeth = 8;
  const rO = 9.6;
  const rI = 7.4;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const w = (Math.PI * 2) / teeth;
    const seq = [
      [rI, a0 - w * 0.5],
      [rI, a0 - w * 0.28],
      [rO, a0 - w * 0.17],
      [rO, a0 + w * 0.17],
      [rI, a0 + w * 0.28],
    ];
    for (const [r, a] of seq) pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z"/><circle cx="12" cy="12" r="3.2"/>`;
}

function sun(r = 4, x = 12, y = 12, rays = 8, r0 = 6.5, r1 = 9): string {
  let d = '';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    d += `M${(x + Math.cos(a) * r0).toFixed(2)} ${(y + Math.sin(a) * r0).toFixed(2)}L${(x + Math.cos(a) * r1).toFixed(2)} ${(y + Math.sin(a) * r1).toFixed(2)}`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}"/><path d="${d}"/>`;
}

function star(fill: boolean): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 9.2 : 3.9;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12.6 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z"${fill ? ' fill="currentColor"' : ''}/>`;
}

const CLOUD = 'M7 18.5h10.2a4.3 4.3 0 0 0 .5-8.56A5.9 5.9 0 0 0 6.4 8.6 5 5 0 0 0 7 18.5z';
const CLOUD_UP = 'M7 14.5h10.2a4.1 4.1 0 0 0 .5-8.16A5.7 5.7 0 0 0 6.5 5.1 4.7 4.7 0 0 0 7 14.5z';

const ICONS = {
  // ---- economy ----
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.9-1.5-1.5-2.7-1.5-1.5 0-2.6.8-2.6 2 0 1.3 1.1 1.7 2.7 2.1s2.8.9 2.8 2.2c0 1.2-1.2 2.1-2.8 2.1-1.2 0-2.3-.6-2.8-1.5M12 6.3v1.5M12 16.2v1.5"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5z"/><path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3 21h18M4 18h16"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="m7 15 4-4.5 3 3 5.5-6.5"/><path d="M15.5 7h4v4"/>',
  'trend-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  'trend-down': '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  contract: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 11.5h7M8.5 14.5h4.5"/><path d="M8.6 18.2c.9-.8 1.5-.8 2.2 0s1.4.8 2.4-.3"/>',
  handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2.8 2.8 0 0 0-4 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.9 3.9 0 0 1 4.9-.5l.5.3a3.5 3.5 0 0 0 2.4.5L21 6"/><path d="m21 5 1 9h-2M3 5 2 14l6.5 6.5a1.4 1.4 0 0 0 2-2M3 6h8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3z"/>',
  // ---- fluids & commodities ----
  oil: '<path d="M12 2.8c3.6 4.4 6.2 7.8 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.2 2.6-6.6 6.2-11z"/><path d="M9 14.2a3 3 0 0 0 2.8 2.8"/>',
  gas: '<path d="M12 21.2c-3.7 0-6.6-2.7-6.6-6.3 0-3.4 2.4-5 3.5-8 .9 1.2 1.4 2.5 1.5 3.7 1.5-1.4 2.6-3.7 2.4-7 3.3 2.3 5.8 6.4 5.8 10.8 0 4-3 6.8-6.6 6.8z"/><path d="M12 21.2c-1.5 0-2.6-1.1-2.6-2.6 0-1.8 1.5-2.6 2.1-4.3 1.8 1.1 3.1 2.6 3.1 4.3 0 1.5-1.1 2.6-2.6 2.6z"/>',
  water: '<path d="M12 2.8c2.1 2.5 3.5 4.4 3.5 6.3a3.5 3.5 0 0 1-7 0c0-1.9 1.4-3.8 3.5-6.3z"/><path d="M3 16c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0"/><path d="M3 20c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0"/>',
  barrel: '<path d="M6.5 3.5h11c.9 2.6 1.4 5.4 1.4 8.5s-.5 5.9-1.4 8.5h-11C5.6 17.9 5.1 15.1 5.1 12s.5-5.9 1.4-8.5z"/><path d="M5.5 8h13M5.5 16h13"/>',
  spill: '<path d="M12 2.8c2 2.6 3.4 4.5 3.4 6.4a3.4 3.4 0 0 1-6.8 0c0-1.9 1.4-3.8 3.4-6.4z"/><path d="M3 18.5c0-1.6 3-2.5 6.5-2.5 1.5 0 2.5.5 4 .5 3.5 0 7.5.4 7.5 2s-3.6 2.5-9 2.5-9-.9-9-2.5z"/>',
  co2: `<path d="${CLOUD}"/><path d="M10.4 12.3a1.6 1.6 0 1 0 0 2.4M13.9 11.8a1.5 1.7 0 1 0 .01 0z"/>`,
  cube: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  // ---- facilities ----
  rig: '<path d="M8.5 21 11 3h2l2.5 18"/><path d="M4.5 21h15"/><path d="M10.3 8.5h3.4M9.6 13.5h4.8M9 18h6"/><path d="m10.3 8.5 4.1 5M13.7 8.5l-4.1 5M9.6 13.5l5.2 4.5M14.4 13.5 9.2 18"/><path d="M12 3V1.5"/>',
  pumpjack: '<path d="M2.5 21h19"/><path d="M8.5 21 11 8.5l2.5 12.5"/><path d="M4 7.2 19.5 5.2"/><path d="M4 7.2c-1.5.9-1.6 3.3-.1 4.4"/><path d="M3.9 11.6V21"/><circle cx="17.5" cy="16.5" r="2.6"/><path d="M18.6 5.4l-1.1 11.1"/><circle cx="11" cy="6.3" r=".9" fill="currentColor"/>',
  wellhead: '<path d="M8.5 21h7M12 21V6"/><path d="M8 10h8M8.5 15h7"/><rect x="10" y="3" width="4" height="3" rx=".6"/><circle cx="6.5" cy="10" r="1.5"/><circle cx="17.5" cy="15" r="1.5"/>',
  wells: '<path d="M2.5 6h19"/><path d="M8 6v6.5c0 3.6 2.4 5.9 6.5 5.9H21"/><path d="M13.5 18.4v.01M16.5 18.4v.01M19.5 18.4v.01"/><path d="M5.5 3.5 8 6l2.5-2.5"/>',
  tank: '<ellipse cx="12" cy="6" rx="8" ry="2.6"/><path d="M4 6v12c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6V6"/><path d="M4 12c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6"/>',
  sphere: '<circle cx="12" cy="10.5" r="7"/><path d="M5 10.5h14"/><path d="M7.5 16 6 21.5M16.5 16l1.5 5.5M4.5 21.5h15"/>',
  pipe: '<path d="M2.5 8.5H9a7 7 0 0 1 7 7v6"/><path d="M2.5 14.5H7a3 3 0 0 1 3 3v4"/><path d="M5.5 6.5v10M8 19.5h10"/>',
  valve: '<path d="M3 8v8l9-4zM21 8v8l-9-4z"/><path d="M12 12V5.5M8.5 5.5h7"/>',
  factory: '<path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17.5h2M11.5 17.5h2M16 17.5h1.5"/>',
  refinery: '<path d="M4.5 21V8.5h3.5V21M10 21V3.5h3.5V21M15.5 21v-7.5h5V21"/><path d="M2.5 21h19M10 8h3.5M10 12.5h3.5M4.5 13h3.5"/>',
  flare: '<path d="M11 21V10.5h2V21"/><path d="M8 21h8"/><path d="M12 8.6c-1.8 0-3-1.2-3-2.8 0-1.5 1.2-2.2 1.6-3.7.9.7 1.4 1.4 1.5 2.2.6-.5 1-1.1 1.2-1.9 1 .9 1.7 2.1 1.7 3.4 0 1.6-1.2 2.8-3 2.8z"/>',
  platform: '<path d="M2.5 9.5h19"/><path d="M5 9.5 6.2 21M19 9.5 17.8 21M9.2 9.5 8.8 21M14.8 9.5l.4 11.5M6.5 14.5h11"/><path d="M6 9.5V6h5v3.5M13 9.5V3.5h3.5v6"/><path d="M1.5 18c1.4 1 2.8 1 4.2 0M18.3 18c1.4 1 2.8 1 4.2 0"/>',
  ship: '<path d="M3 15.5 5.2 20h13.6l2.2-4.5z"/><path d="M6 15.5V10h12v5.5M9 10V6.5h6V10M12 6.5V3.5"/>',
  truck: '<path d="M2 6.5h11v10H2zM13 10h4.5l3.5 3.5v3h-8"/><circle cx="6" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  rail: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8 19.5 6 21.5M16 19.5l2 2M9 13.2v.01M15 13.2v.01"/>',
  house: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  building: '<rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 9h5a1 1 0 0 1 1 1v11M2.5 21h19M7.5 7h3M7.5 11h3M7.5 15h3"/>',
  turbine: '<path d="M12 10v11M8.5 21h7"/><circle cx="12" cy="8.5" r="1.4"/><path d="M11.8 7.1 11 1.8M13.2 9.3l4.9 2.4M10.8 9.3 6.2 12"/>',
  solar: '<path d="M4 15.5 6.5 6h11l2.5 9.5z"/><path d="M5.3 10.7h13.4M10 6l-.7 9.5M14 6l.7 9.5M12 15.5V20M8 20.5h8"/>',
  power: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" fill="currentColor" stroke="none"/>',
  // ---- actions ----
  build: '<path d="M5 21V4.5L8 3v18"/><path d="M3 21h8"/><path d="M8 4.5h13M8 8.5l4-4M17.5 4.5V9"/><path d="M16 9h3v2.8h-3z"/>',
  hammer: '<path d="m13.5 10.5-8.8 8.8a1.6 1.6 0 1 1-2.3-2.3l8.8-8.8"/><path d="m11.5 5.5 3-3 2.4 1.2 4.6 4.6-2.1 2.1-1.9-1.4-2.7 2.7-3.8-3.8z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  trash: '<path d="M4 6.5h16M9 6.5V4h6v2.5M6 6.5l1 13.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13.5"/><path d="M10 10.5v6.5M14 10.5v6.5"/>',
  'power-off': '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.8-6.1"/><path d="M20.5 3.5v5h-5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><rect x="7" y="13" width="10" height="8"/>',
  load: '<path d="M3 19V5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V9.5"/><path d="M3 19l3-8.5h16L19 19z"/>',
  upload: '<path d="M12 15.5V3.5M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3.5v12M7 10.5l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  ff: '<path d="M3 5.8v12.4L11.3 12zM12.5 5.8v12.4L20.8 12z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-up': '<path d="m5 15 7-7 7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  'arrow-right': '<path d="M4 12h16M14 6l6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H4M10 6l-6 6 6 6"/>',
  'tri-up': '<path d="M12 6.5 19 17H5z" fill="currentColor" stroke="none"/>',
  'tri-down': '<path d="M12 17.5 5 7h14z" fill="currentColor" stroke="none"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  filter: '<path d="M3 4.5h18l-7 8.5v6l-4 2v-8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5M8 11h6"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.3" cy="8.3" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.7" cy="8.3" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15.7" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15.7" r="1.25" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  // ---- navigation / panels ----
  inventory: '<path d="M6 8.5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M9.5 5.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6 12.5h12M10 12.5V15h4v-2.5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.3 15h9.4"/>',
  map: '<path d="m3 6 6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 3.5V18M15 6v14.5"/>',
  seismic: '<path d="M2 12h3.2l2-6.5 3 13 3-9.5 2 6 1.8-3H22"/>',
  worker: '<path d="M5.8 11.2a6.2 6.2 0 0 1 12.4 0"/><path d="M4.2 11.2h15.6"/><path d="M12 5v3.2"/><path d="M8 12a4 4 0 0 0 8 0"/><path d="M4.8 21a7.2 7.2 0 0 1 14.4 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  trophy: '<path d="M8 3.5h8V9a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5A3 3 0 0 0 8 10M16 5.5h3.5A3 3 0 0 1 16 10"/><path d="M12 13v3.5M8.5 20.5h7M9.5 20.5l.5-4h4l.5 4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  flag: '<path d="M5 21V3.5M5 4h11.5l-2 4 2 4H5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.8"/><path d="M12 17.2v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3M8 7h8M8 10.5h5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  settings: gear(),
  layers: '<path d="m12 3 9.5 5-9.5 5-9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 16.5 9.5 5 9.5-5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  xray: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M12 7v10M8.5 9.5h7M9 12h6M8.5 14.5h7"/>',
  ruler: '<path d="m3 16.5 13.5-13.5 4.5 4.5L7.5 21z"/><path d="m7.5 12.5 2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2"/>',
  drone: '<circle cx="5.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M7.3 7.3l2.2 2.2M16.7 7.3l-2.2 2.2M7.3 16.7l2.2-2.2M16.7 16.7l-2.2-2.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9M17 3c0 5-5 5-5 9s5 4 5 9"/>',
  cone: '<path d="M9.8 3.5h4.4l4.3 15.5h-13z"/><path d="M7.9 11h8.2M6.8 15h10.4M3 19h18"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.3"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>',
  star: star(false),
  'star-fill': star(true),
  heart: '<path d="M12 20.5s-8-4.6-8-10.7A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8 2.6c0 6.1-8 10.7-8 10.7z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  sparkle: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/><path d="M19 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3z"/>',
  gauge: '<path d="M3.5 17.5a8.5 8.5 0 1 1 17 0"/><path d="m12 17.5 4.2-5.2"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  mountain: '<path d="m2.5 20 7-12 4 6.5 2.5-3.5 5.5 9z"/><path d="m7.5 11.5 2 1.5 1.5-1.5"/>',
  depth: '<path d="M3 4.5h18"/><path d="M12 7.5v12M8 15.5l4 4 4-4"/><path d="M4 9h2.5M4 13h2.5M4 17h2.5"/>',
  bit: '<path d="M9 3h6v5.5l-3 12.5-3-12.5z"/><path d="M9 8.5h6M10 12.5h4"/>',
  core: '<rect x="8" y="2.5" width="8" height="19" rx="4"/><path d="M8 7.5h8M8 12h8M8 16.5h8"/>',
  // ---- tools ----
  pickaxe: '<path d="M14.5 9.5 4 20"/><path d="M8.2 4.1C12 2.6 16.9 3.7 20 7c.7.7-.3 1.8-1 1.1-2.6-2.3-6.5-3.2-9.6-2.1-.9.3-1.7-1.5-1.2-1.9z"/><path d="M19.9 15.8c1.5-3.8.4-8.7-2.9-11.8"/>',
  shovel: '<path d="m11 13 7.5-7.5"/><path d="m16 3.5 4.5 4.5"/><path d="M12.8 14.8 9.2 11.2 3.8 16.6a2.6 2.6 0 0 0 0 3.6 2.6 2.6 0 0 0 3.6 0z"/>',
  axe: '<path d="M13.5 10.5 4 20"/><path d="M12.2 5.4c2.9-2.7 6.4-3 8.6-1.9 1.1 2.2.8 5.7-1.9 8.6l-2.8-1.3-2.6-2.6z"/>',
  extinguisher: '<rect x="8" y="8.5" width="8" height="13" rx="2.5"/><path d="M12 8.5V5.5"/><path d="M9.5 5.5h6l2.8-1.7"/><path d="M10 5.5C7.5 5.5 5.5 7 5 9.5"/><path d="M8 13h8"/>',
  scanner: '<rect x="7" y="9.5" width="10" height="11.5" rx="2"/><path d="M9.5 13.5h5M9.5 17h5"/><path d="M8.6 6.4a4.8 4.8 0 0 1 6.8 0M6.2 3.9a8.2 8.2 0 0 1 11.6 0"/>',
  detector: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 11.5a4 4 0 0 1 8 0"/><path d="m12 11.5 2.2-2.7"/><path d="M9 16h6"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M11 18.5h2M8 7h8M8 10.5h5"/>',
  // ---- weather ----
  sun: sun(),
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  sunrise: '<path d="M4 18a8 8 0 0 1 16 0"/><path d="M2 21h20M12 3v4M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M9 5.5l3-2.5 3 2.5"/>',
  cloud: `<path d="${CLOUD}"/>`,
  'cloud-sun': `<path d="M8.5 5.2a4 4 0 0 1 6.2 2.1"/><path d="M5 9.8H3M6.8 5.3 5.5 4M11 3.2V1.8"/><path d="M8.6 20h9a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.4-1.1A4.2 4.2 0 0 0 8.6 20z"/>`,
  overcast: `<path d="${CLOUD}"/><path d="M4.5 21.5h15"/>`,
  rain: `<path d="${CLOUD_UP}"/><path d="m8 17.5-1 3M12 17.5l-1 3M16 17.5l-1 3"/>`,
  storm: `<path d="${CLOUD_UP}"/><path d="m12.5 15-2 3.5h3l-2 3.5" />`,
  snow: `<path d="${CLOUD_UP}"/><path d="M8 18v.01M12 17.5v.01M16 18v.01M10 21v.01M14 21v.01"/>`,
  fog: '<path d="M3 8h14M6 12h15M3 16h12M8 20h11"/>',
  wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/>',
  thermometer: '<path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/><path d="M12 9.5v7"/>',
  heat: '<path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/><path d="M12 9.5v7M17.5 4.5h3M17.5 8h3"/>',
  hurricane: '<circle cx="12" cy="12" r="2.4"/><path d="M14.4 12c0-5-3.2-8.3-8.4-8.3 3.2 1.4 4.8 3.4 5.3 5.8"/><path d="M9.6 12c0 5 3.2 8.3 8.4 8.3-3.2-1.4-4.8-3.4-5.3-5.8"/>',
  // ---- status ----
  warning: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17.2v.01"/>',
  danger: '<path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9z"/><path d="M12 7.5V13M12 16.5v.01"/>',
  fire: '<path d="M12 21.8c4 0 7-2.8 7-6.8 0-3.5-2.2-5.6-3.5-7.7-.4 1.8-1.2 3-2.4 3.8.2-3.3-1-6.2-4.1-8.3.3 3.2-1.6 5.3-3.1 7.3C4.8 11.8 5 13.5 5 15c0 4 3 6.8 7 6.8z"/><path d="M12 21.8a2.8 2.8 0 0 1-2.8-2.8c0-1.8 1.6-2.6 2.2-4.2 1.9 1 3.4 2.5 3.4 4.2a2.8 2.8 0 0 1-2.8 2.8z"/>',
  leaf: '<path d="M5 19.5c0-8.2 5-14.2 15.5-15.5C19.5 14.3 13.5 19.5 5 19.5z"/><path d="M4 20.5 13 11.5"/>',
  explosion: '<path d="m12 2.5 1.8 5.3 5-2.6-2.1 5.3 5.3 1.5-5 2.7 2.8 4.8-5.3-1.2-.7 5.2-2.8-4.5-3.9 3.6.3-5.4-5.3-.2 4.1-3.5-4-3.6 5.4-.3-.5-5.4 4 3.7z"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><path d="M10.5 21v-2.5M13.5 21v-2.5"/>',
  // ---- settings categories ----
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8.5 21h7M12 17v4"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12.5" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14.5h6"/>',
  gamepad: '<path d="M6.5 7h11a4.5 4.5 0 0 1 4.3 5.7l-1.2 4.5a2.5 2.5 0 0 1-4.3 1L14 16h-4l-2.3 2.2a2.5 2.5 0 0 1-4.3-1l-1.2-4.5A4.5 4.5 0 0 1 6.5 7z"/><path d="M7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13h.01"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6"/>',
  'mouse-left': '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M6 9h12"/><path d="M12 3.3v5.7H6.3A5.9 5.9 0 0 1 12 3.3z" fill="currentColor" stroke="none"/>',
  'mouse-right': '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M6 9h12"/><path d="M12 3.3v5.7h5.7A5.9 5.9 0 0 0 12 3.3z" fill="currentColor" stroke="none"/>',
  camera: '<path d="M4 7.5h3l1.5-2.5h7L17 7.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5z"/><circle cx="12" cy="13.5" r="3.5"/>',
  north: '<path d="M12 2.5 18 20l-6-3.8L6 20z" fill="currentColor"/>',
  nav: '<path d="M12 3 19 20l-7-4-7 4z" fill="currentColor"/>',
  medkit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4.5h6V7M12 10.5v6M9 13.5h6"/>',
  lift: '<path d="M12 21V9M8 13l4-4 4 4"/><path d="M5 4h14"/><path d="M5 21h14"/>',
  choke: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 16.5 7.5"/><path d="M12 3.5v2M3.5 12h2M20.5 12h-2M6 6l1.4 1.4"/>',
  inject: '<path d="M3 4.5h18"/><path d="M12 7v13M8 16l4 4 4-4"/><path d="M8 8.5h8"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5M6 7.5h12v3a6 6 0 0 1-12 0z"/><path d="M12 16.5v5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  frac: '<path d="M3 4.5h18M12 4.5V14"/><path d="M12 14 7 11.5M12 14l5-2.5M12 14l-4 5M12 14l4 5M12 14v6.5"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 10.5h8M4.5 13a7.5 7.5 0 0 0 15 0"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/>',
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const templates = new Map<string, SVGSVGElement>();

/** Create an SVG icon element (cloned from a cached template). */
export function icon(name: IconName | string, cls = ''): SVGSVGElement {
  const key = `${name}|${cls}`;
  let tpl = templates.get(key);
  if (!tpl) {
    const body = (ICONS as Record<string, string>)[name] ?? ICONS.dot;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
    tpl = wrap.firstChild as SVGSVGElement;
    templates.set(key, tpl);
  }
  return tpl.cloneNode(true) as SVGSVGElement;
}

/** SVG markup string (for innerHTML templates and data URIs). */
export function iconMarkup(name: IconName | string, color = 'currentColor', stroke = 1.8): string {
  const body = (ICONS as Record<string, string>)[name] ?? ICONS.dot;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${body}</svg>`;
}

/** Load an icon as an Image for canvas drawing (cached). */
const imgCache = new Map<string, HTMLImageElement>();
export function iconImage(name: IconName | string, color: string, stroke = 2): HTMLImageElement {
  const key = `${name}|${color}|${stroke}`;
  let img = imgCache.get(key);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(name, color, stroke))}`;
    imgCache.set(key, img);
  }
  return img;
}

// ---- semantic icon lookups ---------------------------------------------------------------------

export const CATEGORY_ICON: Record<BuildingCategory, IconName> = {
  exploration: 'seismic', drilling: 'rig', production: 'pumpjack', storage: 'tank', midstream: 'pipe', processing: 'refinery',
  petrochem: 'flask', power: 'power', logistics: 'truck', offshore: 'platform', support: 'building', environment: 'leaf',
};

const BUILDING_ICON: Record<string, IconName> = {
  field_office: 'building', worker_camp: 'house', warehouse: 'cube', research_lab: 'flask', maintenance_depot: 'wrench',
  fire_station: 'fire', scada_center: 'monitor', weather_station: 'wind', helipad: 'target', drilling_rig_land: 'rig',
  drilling_rig_heavy: 'rig', frac_spread: 'frac', wellhead: 'wellhead', flare_stack: 'flare', water_pit: 'water',
  disposal_well: 'inject', water_treatment: 'water', oil_tank_small: 'tank', oil_tank_large: 'tank', gas_sphere: 'sphere',
  pump_station: 'valve', compressor_station: 'gauge', gas_sales_meter: 'gauge', truck_terminal: 'truck', rail_terminal: 'rail',
  export_terminal: 'ship', gas_plant: 'factory', refinery: 'refinery', fcc_unit: 'refinery', lube_plant: 'factory',
  lng_plant: 'factory', steam_cracker: 'factory', polymer_plant: 'flask', ammonia_plant: 'flask', diesel_generator: 'power',
  gas_turbine_power: 'turbine', solar_farm: 'solar', wind_turbine: 'turbine', ccs_unit: 'co2', spill_response: 'spill',
  jackup_rig: 'rig', semi_sub_rig: 'rig', production_platform: 'platform', fpso: 'ship',
};
export function buildingIcon(type: string): IconName {
  return BUILDING_ICON[type] ?? 'building';
}

export const WEATHER_ICON: Record<WeatherKind, IconName> = {
  clear: 'sun', cloudy: 'cloud-sun', overcast: 'overcast', rain: 'rain', storm: 'storm', snow: 'snow', blizzard: 'snow',
  fog: 'fog', heatwave: 'heat', hurricane: 'hurricane',
};

const ITEM_ICON: Record<string, IconName> = {
  crude_oil: 'oil', condensate: 'oil', natural_gas: 'gas', produced_water: 'water', fresh_water: 'water', co2: 'co2',
  dry_gas: 'gas', ngl: 'barrel', lpg: 'gas', gasoline: 'barrel', diesel: 'barrel', jet_fuel: 'barrel', asphalt: 'cube',
  lubricants: 'barrel', sulfur: 'cube', ethylene: 'flask', propylene: 'flask', polyethylene: 'cube', polypropylene: 'cube',
  ammonia: 'flask', methanol: 'flask', lng: 'sphere', drill_pipe: 'pipe', casing: 'pipe', cement: 'cube',
  drilling_mud: 'barrel', barite: 'cube', drill_bit: 'bit', proppant: 'cube', chemicals: 'flask', spare_parts: 'wrench',
  steel: 'cube', 'tool:pickaxe': 'pickaxe', 'tool:shovel': 'shovel', 'tool:axe': 'axe', 'tool:wrench': 'wrench',
  'tool:extinguisher': 'extinguisher', 'tool:scanner': 'scanner', 'tool:detector': 'detector', 'tool:tablet': 'tablet',
};
export function itemIcon(id: string): IconName {
  return ITEM_ICON[id] ?? 'cube';
}
