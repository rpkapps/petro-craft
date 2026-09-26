// North-up minimap: cached terrain + buildings (by category), wells (by status), fires and the player.
import { h, fitCanvas, setText } from '../dom';
import { icon } from '../icons';
import { BUILDINGS } from '../../content/buildings';
import type { GameContext } from '../../core/types';
import type { UIHost } from '../core/host';
import { terrainFor, type TerrainMap } from '../render/terrain';
import { localPlayer } from '../game';
import { keyLabel } from '../format';

export const CATEGORY_COLOR: Record<string, string> = {
  exploration: '#2ad0e0', drilling: '#ff8a1f', production: '#ffb35c', storage: '#c9a44a', midstream: '#a78bfa',
  processing: '#ff6a6a', petrochem: '#f472b6', power: '#ffd84a', logistics: '#60a5fa', offshore: '#38bdf8',
  support: '#cbd5e1', environment: '#3ddc84',
};
export const WELL_COLOR: Record<string, string> = {
  planned: '#8b95a3', drilling: '#ff8a1f', tripping: '#ff8a1f', casing: '#4ea8ff', kick: '#ff4d4f', blowout: '#ff4d4f',
  drilled: '#2ad0e0', completing: '#4ea8ff', fracking: '#4ea8ff', producing: '#3ddc84', injecting: '#2ad0e0',
  shut_in: '#ffc233', dry_hole: '#5f6977', plugged: '#5f6977',
};

const ZOOMS = [48, 96, 160, 256, 400];

/** Player facing direction on the map (radians, 0 = +x). Assumes three.js yaw (forward = −sinY, −cosY). */
export function headingAngle(yaw: number): number {
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private coords: HTMLElement;
  private zoomIdx = 2;
  private terrain: TerrainMap;
  private t = 0;

  constructor(private ui: UIHost, private ctx: GameContext) {
    this.terrain = terrainFor(ctx.geology);
    this.canvas = h<HTMLCanvasElement>('canvas.mm-canvas');
    this.coords = h('div.mm-coords.mono');
    const zin = h<HTMLButtonElement>('button.mm-btn', { type: 'button', title: 'Zoom in' }, icon('plus'));
    const zout = h<HTMLButtonElement>('button.mm-btn', { type: 'button', title: 'Zoom out' }, icon('minus'));
    zin.addEventListener('click', (e) => { e.stopPropagation(); this.zoomIdx = Math.max(0, this.zoomIdx - 1); ui.sound('click'); this.draw(); });
    zout.addEventListener('click', (e) => { e.stopPropagation(); this.zoomIdx = Math.min(ZOOMS.length - 1, this.zoomIdx + 1); ui.sound('click'); this.draw(); });
    const north = h('div.mm-north', 'N');
    this.el = h('div.pc-minimap.glass.flat', h('div.mm-frame', this.canvas, h('div.mm-vignette'), north), h('div.mm-bar', this.coords, h('div.sp'), zout, zin));
    this.canvas.addEventListener('click', () => { ui.sound('open'); ui.open('map'); });
    ui.tooltip.attach(this.canvas, `Click to open the map (${keyLabel(ui.app.settings.keybinds.map)})`);
  }

  update(dt: number) {
    this.t += dt;
    this.draw();
  }

  private draw() {
    if (!this.canvas.isConnected) return;
    const { w, h: hh, ctx: g } = fitCanvas(this.canvas);
    const st = this.ctx.state;
    const p = localPlayer(this.ctx);
    const px = p?.position.x ?? this.ctx.geology.sizeX / 2;
    const pz = p?.position.z ?? this.ctx.geology.sizeZ / 2;
    const span = ZOOMS[this.zoomIdx];
    const s = w / span; // px per block
    const ox = w / 2 - px * s;
    const oz = hh / 2 - pz * s;
    g.fillStyle = '#081018';
    g.fillRect(0, 0, w, hh);
    // terrain
    const T = this.terrain;
    g.imageSmoothingEnabled = span > 120;
    g.drawImage(T.canvas, 0, 0, T.res, T.res, ox, oz, T.res * T.scale * s, T.res * T.scale * s);
    // world border
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    g.strokeRect(ox, oz, this.ctx.geology.sizeX * s, this.ctx.geology.sizeZ * s);
    // buildings
    for (const b of Object.values(st.buildings)) {
      const def = BUILDINGS[b.type];
      const x = ox + b.x * s;
      const z = oz + b.z * s;
      const bw = Math.max(2, b.size[0] * s);
      const bd = Math.max(2, b.size[1] * s);
      if (x + bw < 0 || z + bd < 0 || x > w || z > hh) continue;
      const col = CATEGORY_COLOR[def?.category ?? 'support'] ?? '#ccc';
      g.fillStyle = b.constructionProgress < 1 ? 'rgba(255,255,255,0.25)' : col;
      g.globalAlpha = b.type === 'wellhead' ? 0.6 : 0.9;
      g.fillRect(x, z, bw, bd);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.strokeRect(x + 0.5, z + 0.5, bw - 1, bd - 1);
    }
    // wells
    for (const wl of Object.values(st.wells)) {
      const x = ox + wl.x * s;
      const z = oz + wl.z * s;
      if (x < -4 || z < -4 || x > w + 4 || z > hh + 4) continue;
      g.fillStyle = WELL_COLOR[wl.status] ?? '#ccc';
      g.beginPath();
      g.arc(x, z, 2.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#05080b';
      g.lineWidth = 1;
      g.stroke();
    }
    // fires (blinking)
    const blink = Math.sin(this.t * 8) > -0.2;
    for (const f of st.hazards.fires) {
      const x = ox + f.x * s;
      const z = oz + f.z * s;
      if (x < -6 || z < -6 || x > w + 6 || z > hh + 6) continue;
      const r = 3 + f.intensity * 3;
      const grd = g.createRadialGradient(x, z, 0, x, z, r * 2.2);
      grd.addColorStop(0, blink ? 'rgba(255,200,80,1)' : 'rgba(255,120,40,0.8)');
      grd.addColorStop(0.5, 'rgba(255,80,30,0.55)');
      grd.addColorStop(1, 'rgba(255,60,20,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, z, r * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    // player arrow
    if (p) {
      const a = headingAngle(p.yaw);
      g.save();
      g.translate(w / 2, hh / 2);
      g.rotate(a + Math.PI / 2);
      g.shadowColor = 'rgba(255,138,31,0.9)';
      g.shadowBlur = 8;
      g.fillStyle = '#ff8a1f';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(5.5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5.5, 6);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.stroke();
      g.restore();
    }
    if (!T.complete) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, hh - 3, w, 3);
      g.fillStyle = '#2ad0e0';
      g.fillRect(0, hh - 3, w * T.progress, 3);
    }
    setText(this.coords, `X ${Math.floor(px)} · Z ${Math.floor(pz)}`);
  }
}
