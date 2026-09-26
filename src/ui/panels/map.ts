// Map (N): pan/zoom world map with terrain, lease parcels (quotes & purchase), known reservoirs, wells,
// buildings, pipelines, surveys, hazards and the player. Tools: 2D seismic line, 3D seismic area, rig skid.
import { h, clear, setText, toggleClass, fitCanvas, bar } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, emptyState, stars, toggle, statusInfo, type ToggleCtl } from '../core/components';
import { BUILDINGS } from '../../content/buildings';
import { BLOCKS, isPipeBlock } from '../../core/blocks';
import { PARCEL_SIZE, SEA_LEVEL } from '../../core/constants';
import type { BuildingState, SurveyState, Vec2 } from '../../core/types';
import { terrainFor, type TerrainMap } from '../render/terrain';
import { CATEGORY_COLOR, WELL_COLOR, headingAngle } from '../hud/minimap';
import { buildingName, isRig, localPlayer } from '../game';
import { lengthBlocks, money, pct, titleCase } from '../format';
import { tipBody } from '../core/tooltip';

type Layer = 'leases' | 'reservoirs' | 'wells' | 'buildings' | 'pipes' | 'surveys' | 'hazards';
type Tool = 'none' | 'seismic2d' | 'seismic3d' | 'skid';

const LAYERS: { id: Layer; label: string; icon: IconName }[] = [
  { id: 'leases', label: 'Lease parcels', icon: 'grid' }, { id: 'reservoirs', label: 'Known reservoirs', icon: 'layers' },
  { id: 'wells', label: 'Wells', icon: 'wellhead' }, { id: 'buildings', label: 'Facilities', icon: 'factory' },
  { id: 'pipes', label: 'Pipelines & roads', icon: 'pipe' }, { id: 'surveys', label: 'Seismic surveys', icon: 'seismic' },
  { id: 'hazards', label: 'Fires & spills', icon: 'fire' },
];
const layerState: Record<Layer, boolean> = { leases: false, reservoirs: true, wells: true, buildings: true, pipes: true, surveys: true, hazards: true };
const PIPE_RGB: Record<string, [number, number, number]> = { oil: [242, 163, 30], gas: [232, 210, 58], water: [47, 121, 201], product: [62, 158, 90], road: [60, 62, 66] };
const FLUID_RGB: Record<string, [number, number, number]> = { oil: [61, 220, 132], condensate: [255, 194, 51], gas: [255, 90, 90] };

/** Offscreen 1-px-per-block raster of pipe & road blocks from world edits (cached per world). */
class PipeRaster {
  canvas = document.createElement('canvas');
  dirty = true;
  constructor(private ui: UIHost) {
    const w = ui.game.world;
    this.canvas.width = w.sizeX;
    this.canvas.height = w.sizeZ;
  }
  rebuild() {
    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(this.canvas.width, this.canvas.height);
    const d = img.data;
    const W = this.canvas.width;
    const roadId = BLOCKS.findIndex((b) => b.key === 'asphalt_road');
    this.ui.game.world.forEachEdit((x, _y, z, id) => {
      if (x < 0 || z < 0 || x >= W || z >= this.canvas.height) return;
      let rgb: [number, number, number] | undefined;
      if (id === roadId) rgb = PIPE_RGB.road;
      else if (isPipeBlock(id)) {
        const cat = BLOCKS[id].pipe;
        if (cat && cat !== 'casing') rgb = PIPE_RGB[cat];
      }
      if (!rgb) return;
      const i = (z * W + x) * 4;
      if (d[i + 3] && rgb === PIPE_RGB.road) return;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    });
    g.putImageData(img, 0, 0);
    this.dirty = false;
  }
}
const pipeCache = new WeakMap<object, PipeRaster>();

export class MapPanel extends Panel {
  readonly id = 'map' as const;
  private canvas!: HTMLCanvasElement;
  private terrain!: TerrainMap;
  private pipes!: PipeRaster;
  private cx = 0;
  private cz = 0;
  private scale = 1;
  private fitScale = 1;
  private dirty = true;
  private lastTerrainVersion = -1;
  private t = 0;
  private redrawTimer = 0;
  private tool: Tool = 'none';
  private rigId: string | null = null;
  private drag: { sx: number; sy: number; cx: number; cz: number; moved: boolean } | null = null;
  private toolStart: Vec2 | null = null;
  private toolEnd: Vec2 | null = null;
  private hover: Vec2 | null = null;
  private pending: { kind: '2d' | '3d'; x0: number; z0: number; x1: number; z1: number } | null = null;
  private skidTarget: Vec2 | null = null;
  private selectedParcel: { px: number; pz: number } | null = null;
  private side!: HTMLElement;
  private toolCard!: HTMLElement;
  private infoCard!: HTMLElement;
  private cursorEl!: HTMLElement;
  private surveyList!: HTMLElement;
  private surveySig = '';
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private layerToggles = new Map<Layer, ToggleCtl>();
  private scaleBar!: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Field Map', 'map', 'full');
    this.fixedBody = true;
    if (args.layer === 'leases') layerState.leases = true;
    if (typeof args.tool === 'string') this.tool = args.tool as Tool;
    if (typeof args.rigId === 'string') {
      this.rigId = args.rigId;
      if (!args.tool) this.tool = 'skid';
    }
  }

  private get st() {
    return this.ui.game.state;
  }

  protected build() {
    const ctx = this.ui.game;
    this.terrain = terrainFor(ctx.geology);
    let pr = pipeCache.get(ctx.world);
    if (!pr) {
      pr = new PipeRaster(this.ui);
      pipeCache.set(ctx.world, pr);
    }
    this.pipes = pr;
    const offBlock = ctx.bus.on('world:blockChanged', (e) => {
      if (isPipeBlock(e.id) || isPipeBlock(e.prev) || BLOCKS[e.id]?.key === 'asphalt_road' || BLOCKS[e.prev]?.key === 'asphalt_road') {
        this.pipes.dirty = true;
        this.dirty = true;
      }
    });
    this.cleanup.push(offBlock);
    this.setSubtitle(`${ctx.geology.sizeX} × ${ctx.geology.sizeZ} blocks · 1 block = 40 m`);

    this.canvas = h<HTMLCanvasElement>('canvas.map-canvas');
    this.cursorEl = h('div.map-cursor.mono');
    this.scaleBar = h('div.map-scale', h('i'), h('span.mono'));
    const zoomIn = button(null, { icon: 'plus', size: 'sm', title: 'Zoom in', onClick: () => this.zoomBy(1.4) });
    const zoomOut = button(null, { icon: 'minus', size: 'sm', title: 'Zoom out', onClick: () => this.zoomBy(1 / 1.4) });
    const home = button(null, { icon: 'crosshair', size: 'sm', title: 'Center on player', onClick: () => this.centerOnPlayer() });
    const fit = button(null, { icon: 'expand', size: 'sm', title: 'Fit world', onClick: () => this.fitWorld() });
    const legend = h('div.map-legend',
      ...(['producing', 'drilling', 'kick', 'shut_in', 'plugged'] as const).map((s) => h('span', h('i.dot', { style: { background: WELL_COLOR[s] } }), statusInfo('well', s).label)),
      h('span', h('i.sq', { style: { background: 'rgba(255,138,31,.35)', borderColor: '#ff8a1f' } }), 'Your lease'),
      h('span', h('i.sq', { style: { background: 'rgba(61,220,132,.25)', borderColor: '#3ddc84' } }), 'Oil'),
      h('span', h('i.sq', { style: { background: 'rgba(255,90,90,.25)', borderColor: '#ff5a5a' } }), 'Gas'));
    const view = h('div.map-view', this.canvas, h('div.map-vignette'), h('div.map-ctrls', zoomIn, zoomOut, home, fit), this.cursorEl, this.scaleBar, legend);

    // sidebar
    const tools = h('div.map-tools');
    const mkTool = (t: Tool, ic: IconName, label: string, sub: string, techId?: string) => {
      const locked = techId ? !ctx.hasTech(techId) : false;
      const b = h<HTMLButtonElement>(`button.map-tool${locked ? '.locked' : ''}`, { type: 'button', disabled: locked }, icon(ic), h('div.col', { style: 'gap:0;min-width:0' }, h('b', label), h('span.tiny.dim', locked ? 'Research required' : sub)));
      b.addEventListener('click', () => { this.ui.sound('click'); this.setTool(this.tool === t ? 'none' : t); });
      this.toolBtns.set(t, b);
      tools.appendChild(b);
    };
    mkTool('seismic2d', 'seismic', '2D Seismic Line', 'Drag a line across a prospect', 'seismic_2d');
    mkTool('seismic3d', 'grid', '3D Seismic Area', 'Drag a rectangle', 'seismic_3d');
    if (this.rigId) mkTool('skid', 'rig', 'Skid rig here', 'Click a new drilling location');
    this.toolCard = h('div.map-toolcard');
    const layers = h('div.map-layers');
    for (const l of LAYERS) {
      const t = toggle(h('span.row', { style: 'gap:.45rem' }, icon(l.icon), l.label), layerState[l.id], (v) => {
        layerState[l.id] = v;
        this.dirty = true;
        this.ui.sound('click');
        if (l.id === 'leases' && v) this.ui.notifyView('leases', {});
      });
      this.layerToggles.set(l.id, t);
      layers.appendChild(t.el);
    }
    this.infoCard = h('div.map-info');
    this.surveyList = h('div.map-surveys');
    this.side = h('div.map-side.scroll',
      h('div.card', h('div.section-title', icon('build'), 'Tools'), tools, this.toolCard),
      this.infoCard,
      h('div.card', h('div.section-title', icon('layers'), 'Layers'), layers),
      h('div.card', h('div.section-title', icon('seismic'), 'Surveys'), this.surveyList));
    this.body.appendChild(h('div.map-layout', view, this.side));
    this.bindInput();
    window.setTimeout(() => {
      const at = this.args.at as Vec2 | undefined;
      this.fitWorld();
      if (at) {
        this.cx = at.x;
        this.cz = at.z;
        this.scale = Math.max(this.fitScale * 3, 3);
      } else if (this.rigId && this.st.buildings[this.rigId]) {
        const b = this.st.buildings[this.rigId];
        this.cx = b.x + b.size[0] / 2;
        this.cz = b.z + b.size[1] / 2;
        this.scale = Math.max(this.fitScale * 3, 3);
      } else this.centerOnPlayer(false);
      this.dirty = true;
    }, 0);
    this.setTool(this.tool);
    this.ui.notifyView('map', {});
    if (layerState.leases) this.ui.notifyView('leases', {});
  }

  // ---- view control ---------------------------------------------------------------------------
  private viewSize() {
    const r = this.canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top };
  }
  private fitWorld() {
    const { w, h: hh } = this.viewSize();
    const g = this.ui.game.geology;
    this.fitScale = Math.min(w / g.sizeX, hh / g.sizeZ) * 0.96;
    this.scale = this.fitScale;
    this.cx = g.sizeX / 2;
    this.cz = g.sizeZ / 2;
    this.dirty = true;
  }
  private centerOnPlayer(zoom = true) {
    const p = localPlayer(this.ui.game);
    if (!p) return;
    this.cx = p.position.x;
    this.cz = p.position.z;
    if (zoom) this.scale = Math.max(this.scale, this.fitScale * 3);
    else this.scale = Math.max(this.fitScale * 2.2, this.fitScale);
    this.dirty = true;
  }
  private zoomBy(f: number, sx?: number, sy?: number) {
    const { w, h: hh } = this.viewSize();
    const px = sx ?? w / 2;
    const py = sy ?? hh / 2;
    const before = this.toWorld(px, py);
    this.scale = Math.max(this.fitScale * 0.7, Math.min(24, this.scale * f));
    const after = this.toWorld(px, py);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.dirty = true;
  }
  private toWorld(sx: number, sy: number): Vec2 {
    const { w, h: hh } = this.viewSize();
    return { x: this.cx + (sx - w / 2) / this.scale, z: this.cz + (sy - hh / 2) / this.scale };
  }
  private toScreen(x: number, z: number): [number, number] {
    const { w, h: hh } = this.viewSize();
    return [(x - this.cx) * this.scale + w / 2, (z - this.cz) * this.scale + hh / 2];
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.toolStart = this.toolEnd = null;
    this.pending = null;
    this.skidTarget = null;
    for (const [k, b] of this.toolBtns) toggleClass(b, 'on', k === t);
    this.canvas.style.cursor = t === 'none' ? 'grab' : 'crosshair';
    this.renderToolCard();
    this.dirty = true;
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('mousedown', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (e.button === 2) return;
      if (this.tool === 'seismic2d' || this.tool === 'seismic3d') {
        const wpt = this.clampWorld(this.toWorld(sx, sy));
        this.toolStart = wpt;
        this.toolEnd = wpt;
        this.pending = null;
        this.renderToolCard();
        this.dirty = true;
        return;
      }
      this.drag = { sx: e.clientX, sy: e.clientY, cx: this.cx, cz: this.cz, moved: false };
      c.style.cursor = this.tool === 'none' ? 'grabbing' : 'crosshair';
    });
    const move = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (this.drag) {
        const dx = e.clientX - this.drag.sx;
        const dy = e.clientY - this.drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        this.cx = this.drag.cx - dx / this.scale;
        this.cz = this.drag.cz - dy / this.scale;
        this.dirty = true;
      }
      if (this.toolStart && (this.tool === 'seismic2d' || this.tool === 'seismic3d')) {
        this.toolEnd = this.clampWorld(this.toWorld(sx, sy));
        this.dirty = true;
      }
      if (sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height) {
        this.hover = this.toWorld(sx, sy);
        this.updateCursor();
        if (this.tool === 'skid') this.dirty = true;
      }
    };
    const up = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (this.toolStart && this.toolEnd && (this.tool === 'seismic2d' || this.tool === 'seismic3d')) {
        this.finishSurveyDrag();
        return;
      }
      if (this.drag) {
        const moved = this.drag.moved;
        this.drag = null;
        c.style.cursor = this.tool === 'none' ? 'grab' : 'crosshair';
        if (!moved && e.target === c) this.click(sx, sy);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    c.addEventListener('mouseleave', () => { this.hover = null; this.updateCursor(); });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.tool !== 'none') this.setTool('none'); });
    this.cleanup.push(() => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); });
  }

  private clampWorld(p: Vec2): Vec2 {
    const g = this.ui.game.geology;
    return { x: Math.round(Math.max(0, Math.min(g.sizeX - 1, p.x))), z: Math.round(Math.max(0, Math.min(g.sizeZ - 1, p.z))) };
  }

  private finishSurveyDrag() {
    const a = this.toolStart!;
    const b = this.toolEnd!;
    this.toolStart = null;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if ((this.tool === 'seismic2d' && len < 8) || (this.tool === 'seismic3d' && (Math.abs(b.x - a.x) < 8 || Math.abs(b.z - a.z) < 8))) {
      this.toolEnd = null;
      this.ui.toast('info', 'Drag further', this.tool === 'seismic2d' ? 'Survey lines must be at least 8 blocks long.' : 'Survey areas must be at least 8 × 8 blocks.', { ttl: 3 });
      this.dirty = true;
      return;
    }
    const kind = this.tool === 'seismic2d' ? '2d' : '3d';
    this.pending = kind === '2d' ? { kind, x0: a.x, z0: a.z, x1: b.x, z1: b.z } : { kind, x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
    this.toolEnd = null;
    this.ui.sound('click');
    this.renderToolCard();
    this.dirty = true;
  }

  private renderToolCard() {
    clear(this.toolCard);
    const ctx = this.ui.game;
    if (this.tool === 'none') return;
    if (this.pending) {
      const p = this.pending;
      const q = ctx.services.seismic.quote(p.kind, p.x0, p.z0, p.x1, p.z1);
      const size = p.kind === '2d' ? lengthBlocks(Math.hypot(p.x1 - p.x0, p.z1 - p.z0), this.ui.units) : `${lengthBlocks(p.x1 - p.x0, this.ui.units)} × ${lengthBlocks(p.z1 - p.z0, this.ui.units)}`;
      const afford = this.st.company.money >= q.cost || this.st.meta.rules.creative;
      this.toolCard.append(h('div.map-quote',
        h('div.row', icon('seismic'), h('b', p.kind === '2d' ? '2D seismic line' : '3D seismic survey')),
        h('div.kv', h('span', 'Coverage'), h('span', size), h('span', 'Cost'), h(`span.${afford ? 'accent' : 'danger'}`, money(q.cost)), h('span', 'Acquisition'), h('span', `${q.days} days`)),
        h('div.row', button('Cancel', { size: 'sm', variant: 'ghost', onClick: () => { this.pending = null; this.renderToolCard(); this.dirty = true; } }), h('span.sp'),
          button('Shoot survey', { icon: 'check', size: 'sm', variant: 'primary', disabled: !afford, onClick: () => {
            const r = this.ui.dispatch({ type: 'survey/start', kind: p.kind, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 }, { successSound: 'success' });
            if (r.ok) {
              this.ui.toast('success', 'Seismic crew mobilised', `${p.kind.toUpperCase()} survey · ${q.days} days`, { icon: 'seismic' });
              this.setTool('none');
              this.surveySig = '';
            }
          } }))));
      return;
    }
    if (this.tool === 'skid') {
      const rig = this.rigId ? this.st.buildings[this.rigId] : undefined;
      if (!rig) {
        this.toolCard.append(h('div.dim.small', 'The rig is no longer available.'));
        return;
      }
      if (this.skidTarget) {
        const t = this.skidTarget;
        const dist = Math.hypot(t.x - (rig.x + rig.size[0] / 2), t.z - (rig.z + rig.size[1] / 2));
        this.toolCard.append(h('div.map-quote',
          h('div.row', icon('rig'), h('b', `Skid ${buildingName(this.st, rig)}`)),
          h('div.kv', h('span', 'Target'), h('span', `${t.x}, ${t.z}`), h('span', 'Distance'), h('span', lengthBlocks(dist, this.ui.units))),
          h('div.row', button('Cancel', { size: 'sm', variant: 'ghost', onClick: () => { this.skidTarget = null; this.renderToolCard(); this.dirty = true; } }), h('span.sp'),
            button('Skid rig', { icon: 'check', size: 'sm', variant: 'primary', onClick: () => {
              const r = this.ui.dispatch({ type: 'rig/skid', rigId: rig.id, x: t.x, z: t.z }, { successSound: 'success' });
              if (r.ok) {
                const nid = (r.data as { newRigId?: string } | undefined)?.newRigId;
                if (nid) this.rigId = nid;
                this.ui.toast('success', 'Rig move scheduled', `${buildingName(this.st, rig)} → ${t.x}, ${t.z}`, { icon: 'rig' });
                this.setTool('none');
              }
            } }))));
      } else this.toolCard.append(h('div.map-hint', icon('info'), h('span', 'Click the map to choose the new well location. The rig footprint is previewed under the cursor.')));
      return;
    }
    this.toolCard.append(h('div.map-hint', icon('info'), h('span', this.tool === 'seismic2d' ? 'Press and drag across the structure you want to image. Longer lines cost more.' : 'Press and drag a rectangle over the prospect. 3D surveys reveal reservoir outlines.')));
  }

  private click(sx: number, sy: number) {
    const w = this.toWorld(sx, sy);
    const st = this.st;
    if (this.tool === 'skid') {
      this.skidTarget = this.clampWorld(w);
      this.ui.sound('click');
      this.renderToolCard();
      this.dirty = true;
      return;
    }
    // wells
    if (layerState.wells) {
      let best: string | null = null;
      let bd = 10;
      for (const wl of Object.values(st.wells)) {
        const [x, y] = this.toScreen(wl.x, wl.z);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = wl.id; }
      }
      if (best) {
        this.ui.sound('click');
        this.ui.open('well', { wellId: best }, { stack: true });
        return;
      }
    }
    if (layerState.buildings) {
      const b = Object.values(st.buildings).filter((x) => w.x >= x.x && w.x < x.x + x.size[0] && w.z >= x.z && w.z < x.z + x.size[1]).sort((a, c) => a.size[0] * a.size[1] - c.size[0] * c.size[1])[0];
      if (b) {
        this.ui.sound('click');
        this.ui.open('inspector', { buildingId: b.id }, { stack: true });
        return;
      }
    }
    if (layerState.leases) {
      this.selectedParcel = { px: Math.floor(w.x / PARCEL_SIZE), pz: Math.floor(w.z / PARCEL_SIZE) };
      this.ui.sound('click');
      this.renderInfo();
      this.dirty = true;
    }
  }

  private renderInfo() {
    clear(this.infoCard);
    const p = this.selectedParcel;
    if (!p) {
      this.infoCard.className = 'map-info';
      return;
    }
    this.infoCard.className = 'map-info card';
    const key = `${p.px},${p.pz}`;
    const lease = this.st.leases[key];
    const q = this.ui.game.services.economy.leaseQuote(p.px, p.pz);
    const owned = lease && lease.owner === this.ui.game.localPlayerId;
    const cx = p.px * PARCEL_SIZE + PARCEL_SIZE / 2;
    const cz = p.pz * PARCEL_SIZE + PARCEL_SIZE / 2;
    const g = this.ui.game.geology;
    const offshore = g.isOffshore(Math.min(g.sizeX - 1, cx), Math.min(g.sizeZ - 1, cz));
    const wellsHere = Object.values(this.st.wells).filter((w) => Math.floor(w.x / PARCEL_SIZE) === p.px && Math.floor(w.z / PARCEL_SIZE) === p.pz).length;
    this.infoCard.append(
      h('div.section-title', icon('grid'), `Parcel ${key}`),
      h('div.row', owned ? chip('Your lease', 'accent') : lease ? chip('Leased by rival', 'danger') : chip('Available', 'ok'), offshore ? chip('Offshore', 'info', true) : null),
      h('div.kv', { style: 'margin-top:.5rem' },
        h('span', 'Prospectivity'), h('span', stars(q.prospectivity * 5)),
        h('span', 'Royalty'), h('span', pct(lease?.royalty ?? q.royalty, 1)),
        h('span', owned ? 'Paid' : 'Price'), h('span.accent', money(lease?.price ?? q.price)),
        h('span', 'Wells'), h('span', String(wellsHere)),
        lease ? h('span', 'Acquired') : null, lease ? h('span', `Day ${lease.acquiredDay}`) : null),
      !lease ? button(`Buy lease · ${money(q.price)}`, { icon: 'check', variant: 'primary', size: 'sm', block: true, onClick: () => {
        const r = this.ui.dispatch({ type: 'lease/buy', px: p.px, pz: p.pz }, { successSound: 'cash' });
        if (r.ok) this.ui.toast('success', `Parcel ${key} leased`, `${money(q.price)} · royalty ${pct(q.royalty, 1)}`, { icon: 'grid' });
        this.renderInfo();
        this.dirty = true;
      } }) : '');
  }

  private updateCursor() {
    const hv = this.hover;
    if (!hv) {
      setText(this.cursorEl, '');
      return;
    }
    const g = this.ui.game.geology;
    const x = Math.floor(hv.x);
    const z = Math.floor(hv.z);
    if (x < 0 || z < 0 || x >= g.sizeX || z >= g.sizeZ) {
      setText(this.cursorEl, '');
      return;
    }
    let txt = `X ${x}  Z ${z}`;
    try {
      const wd = g.waterDepth(x, z);
      const hgt = g.surfaceHeight(x, z);
      txt += wd > 0 ? `  ·  water ${lengthBlocks(wd, this.ui.units)}` : `  ·  elev ${lengthBlocks(hgt - SEA_LEVEL, this.ui.units)}`;
      txt += `  ·  ${titleCase(g.biomeAt(x, z))}`;
    } catch {
      /* geology unavailable */
    }
    txt += `  ·  parcel ${Math.floor(x / PARCEL_SIZE)},${Math.floor(z / PARCEL_SIZE)}`;
    setText(this.cursorEl, txt);
  }

  private renderSurveys() {
    const list = Object.values(this.st.surveys).sort((a, b) => b.startedDay - a.startedDay);
    const sig = list.map((s) => `${s.id}:${s.status}:${Math.round(s.progress * 100)}`).join('|');
    if (sig === this.surveySig) return;
    this.surveySig = sig;
    clear(this.surveyList);
    if (!list.length) {
      this.surveyList.appendChild(emptyState('seismic', 'No surveys yet', 'Use the 2D tool to shoot your first line.'));
      return;
    }
    for (const s of list) {
      const done = s.status === 'complete';
      const row = h('div.map-survey',
        h('div.row', h('span.map-sk', s.kind.toUpperCase()), h('b.grow.ellipsis', s.name), done ? chip('Ready', 'ok') : chip(s.status === 'processing' ? 'Processing' : `${Math.round(s.progress * 100)}%`, 'teal')),
        !done ? bar(s.progress, 'teal', 'thin') : null,
        h('div.row', h('span.tiny.dim', `Day ${s.startedDay} · ${money(s.cost)}`), h('span.sp'),
          button('Locate', { size: 'xs', icon: 'crosshair', onClick: () => this.focusSurvey(s) }),
          button('View', { size: 'xs', icon: 'eye', variant: 'teal', disabled: s.progress <= 0.02, onClick: () => { this.ui.sound('open'); this.ui.open('seismic', { surveyId: s.id }, { stack: true }); } })));
      this.ui.tooltip.attach(row, () => tipBody(s.name, `${s.kind.toUpperCase()} · quality ×${s.quality.toFixed(1)}${s.fluidIndicators ? ' · fluid indicators' : ''}`));
      this.surveyList.appendChild(row);
    }
  }

  private focusSurvey(s: SurveyState) {
    this.cx = (s.x0 + s.x1) / 2;
    this.cz = (s.z0 + s.z1) / 2;
    const span = Math.max(Math.abs(s.x1 - s.x0), Math.abs(s.z1 - s.z0), 32);
    const { w, h: hh } = this.viewSize();
    this.scale = Math.min(w, hh) / (span * 1.6);
    this.dirty = true;
    this.ui.sound('click');
  }

  // ---- drawing ---------------------------------------------------------------------------------
  frame(dt: number) {
    this.t += dt;
    this.redrawTimer += dt;
    if (this.terrain.version !== this.lastTerrainVersion) {
      this.lastTerrainVersion = this.terrain.version;
      this.dirty = true;
    }
    const animated = layerState.hazards && this.st.hazards.fires.length > 0;
    if (this.dirty || (animated && this.redrawTimer > 0.12) || this.redrawTimer > 1) {
      this.redrawTimer = 0;
      this.dirty = false;
      this.draw();
    }
  }

  update() {
    this.renderSurveys();
    this.dirty = true;
  }

  private draw() {
    if (!this.canvas.isConnected) return;
    const { w, h: hh, ctx: g } = fitCanvas(this.canvas);
    const st = this.st;
    const S = this.scale;
    g.fillStyle = '#060a0f';
    g.fillRect(0, 0, w, hh);
    const [ox, oz] = this.toScreen(0, 0);
    const geo = this.ui.game.geology;
    // terrain
    const T = this.terrain;
    g.imageSmoothingEnabled = S * T.scale < 2.5;
    g.drawImage(T.canvas, 0, 0, T.res, T.res, ox, oz, T.res * T.scale * S, T.res * T.scale * S);
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1;
    g.strokeRect(ox, oz, geo.sizeX * S, geo.sizeZ * S);
    // pipelines
    if (layerState.pipes) {
      if (this.pipes.dirty) this.pipes.rebuild();
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 0.95;
      g.drawImage(this.pipes.canvas, ox, oz, geo.sizeX * S, geo.sizeZ * S);
      if (S < 2) g.drawImage(this.pipes.canvas, ox + 0.6, oz, geo.sizeX * S, geo.sizeZ * S);
      g.globalAlpha = 1;
    }
    // reservoirs
    if (layerState.reservoirs) {
      for (const r of geo.reservoirs) {
        const rs = st.reservoirs[r.id];
        if (!rs || (!rs.discovered && rs.knowledge < 0.05)) continue;
        const [x, y] = this.toScreen(r.center.x, r.center.z);
        const rgb = FLUID_RGB[r.fluid] ?? FLUID_RGB.oil;
        const k = Math.max(0.25, Math.min(1, rs.knowledge));
        const grd = g.createRadialGradient(x, y, 0, x, y, Math.max(r.radiusX, r.radiusZ) * S);
        grd.addColorStop(0, `rgba(${rgb.join(',')},${0.38 * k})`);
        grd.addColorStop(1, `rgba(${rgb.join(',')},${0.08 * k})`);
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y, r.radiusX * S, r.radiusZ * S, 0, 0, Math.PI * 2);
        g.fill();
        g.setLineDash(k < 0.6 ? [6, 5] : []);
        g.strokeStyle = `rgba(${rgb.join(',')},${0.5 + 0.5 * k})`;
        g.lineWidth = 1.5;
        g.stroke();
        g.setLineDash([]);
        if (S * r.radiusX > 30) {
          g.font = '600 12px Rajdhani, "Liberation Sans", sans-serif';
          g.textAlign = 'center';
          g.fillStyle = `rgba(${rgb.join(',')},1)`;
          g.shadowColor = '#000';
          g.shadowBlur = 4;
          g.fillText(rs.discovered ? r.name.toUpperCase() : 'PROSPECT', x, y - r.radiusZ * S - 6);
          g.shadowBlur = 0;
        }
      }
    }
    // leases
    if (layerState.leases) this.drawLeases(g, w, hh);
    // surveys
    if (layerState.surveys) {
      for (const s of Object.values(st.surveys)) {
        const [x0, y0] = this.toScreen(s.x0, s.z0);
        const [x1, y1] = this.toScreen(s.x1, s.z1);
        const done = s.status === 'complete';
        if (s.kind === '2d') {
          g.strokeStyle = 'rgba(42,208,224,0.35)';
          g.lineWidth = 4;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          g.strokeStyle = done ? '#2ad0e0' : '#7ff3ff';
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * s.progress, y0 + (y1 - y0) * s.progress); g.stroke();
          for (const [px, py] of [[x0, y0], [x1, y1]]) { g.fillStyle = '#2ad0e0'; g.fillRect(px - 2.5, py - 2.5, 5, 5); }
        } else {
          g.fillStyle = `rgba(42,208,224,${done ? 0.08 : 0.04})`;
          g.fillRect(x0, y0, x1 - x0, y1 - y0);
          g.strokeStyle = 'rgba(42,208,224,0.8)';
          g.setLineDash([5, 4]);
          g.lineWidth = 1.5;
          g.strokeRect(x0, y0, x1 - x0, y1 - y0);
          g.setLineDash([]);
          if (!done) { g.fillStyle = 'rgba(42,208,224,0.14)'; g.fillRect(x0, y0, (x1 - x0) * s.progress, y1 - y0); }
        }
        if (S > 0.9) {
          g.font = '600 11px Inter, system-ui, sans-serif';
          g.textAlign = 'left';
          g.fillStyle = '#bff6fb';
          g.shadowColor = '#000';
          g.shadowBlur = 3;
          g.fillText(s.name, Math.min(x0, x1) + 4, Math.min(y0, y1) - 5);
          g.shadowBlur = 0;
        }
      }
    }
    // buildings
    if (layerState.buildings) {
      for (const b of Object.values(st.buildings)) {
        const [x, y] = this.toScreen(b.x, b.z);
        const bw = Math.max(2, b.size[0] * S);
        const bd = Math.max(2, b.size[1] * S);
        if (x > w || y > hh || x + bw < 0 || y + bd < 0) continue;
        const col = CATEGORY_COLOR[BUILDINGS[b.type]?.category ?? 'support'] ?? '#ccc';
        g.globalAlpha = b.constructionProgress < 1 ? 0.45 : 0.92;
        g.fillStyle = col;
        g.fillRect(x, y, bw, bd);
        g.globalAlpha = 1;
        g.strokeStyle = b.status === 'fire' ? '#ff4d4f' : 'rgba(0,0,0,0.7)';
        g.lineWidth = b.status === 'fire' ? 2 : 1;
        g.strokeRect(x + 0.5, y + 0.5, bw - 1, bd - 1);
        if (bw > 70 && b.type !== 'wellhead') {
          g.font = '600 10.5px Inter, system-ui, sans-serif';
          g.textAlign = 'center';
          g.fillStyle = '#fff';
          g.shadowColor = '#000';
          g.shadowBlur = 3;
          g.fillText(buildingName(st, b), x + bw / 2, y + bd + 12);
          g.shadowBlur = 0;
        }
      }
    }
    // hazards
    if (layerState.hazards) {
      for (const sp of st.environment.spills) {
        if (sp.cleaned >= sp.volume) continue;
        const [x, y] = this.toScreen(sp.x, sp.z);
        const r = Math.max(4, Math.sqrt(sp.volume - sp.cleaned) * 0.15 * S + 3);
        g.fillStyle = sp.kind === 'oil' ? 'rgba(10,8,6,0.8)' : 'rgba(80,140,200,0.5)';
        g.strokeStyle = sp.kind === 'oil' ? 'rgba(255,138,31,0.8)' : 'rgba(120,180,255,0.8)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      const blink = Math.sin(this.t * 7) > -0.3;
      for (const f of st.hazards.fires) {
        const [x, y] = this.toScreen(f.x, f.z);
        const r = (6 + f.intensity * 8) * (blink ? 1.15 : 0.9);
        const grd = g.createRadialGradient(x, y, 0, x, y, r * 2);
        grd.addColorStop(0, 'rgba(255,220,120,1)');
        grd.addColorStop(0.35, 'rgba(255,110,30,0.8)');
        grd.addColorStop(1, 'rgba(255,60,20,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r * 2, 0, Math.PI * 2); g.fill();
      }
    }
    // wells
    if (layerState.wells) {
      for (const wl of Object.values(st.wells)) {
        const [x, y] = this.toScreen(wl.x, wl.z);
        if (x < -20 || y < -20 || x > w + 20 || y > hh + 20) continue;
        const col = WELL_COLOR[wl.status] ?? '#ccc';
        if (S > 1.5 && wl.trajectory.length > 1 && wl.plan.kind !== 'vertical') {
          g.strokeStyle = col;
          g.globalAlpha = 0.7;
          g.lineWidth = 1.5;
          g.beginPath();
          wl.trajectory.forEach((p, i) => { const [tx, ty] = this.toScreen(p.x, p.z); if (i) g.lineTo(tx, ty); else g.moveTo(tx, ty); });
          g.stroke();
          g.globalAlpha = 1;
        }
        const r = S > 3 ? 5 : 4;
        g.fillStyle = '#05080b';
        g.beginPath(); g.arc(x, y, r + 1.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        if (['dry_hole', 'plugged'].includes(wl.status)) {
          g.strokeStyle = '#05080b';
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
        }
        if (S > 2.2) {
          g.font = '600 11px Inter, system-ui, sans-serif';
          g.textAlign = 'left';
          g.fillStyle = '#fff';
          g.shadowColor = '#000';
          g.shadowBlur = 3;
          g.fillText(wl.name, x + 8, y + 4);
          g.shadowBlur = 0;
        }
      }
    }
    // player
    const p = localPlayer(this.ui.game);
    if (p) {
      const [x, y] = this.toScreen(p.position.x, p.position.z);
      g.save();
      g.translate(x, y);
      g.rotate(headingAngle(p.yaw) + Math.PI / 2);
      g.shadowColor = 'rgba(255,138,31,0.9)';
      g.shadowBlur = 10;
      g.fillStyle = '#ff8a1f';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 7); g.lineTo(0, 3.5); g.lineTo(-7, 7); g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.stroke();
      g.restore();
    }
    this.drawTools(g);
    // scale bar
    const targetPx = 110;
    const blocks = targetPx / S;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((n) => n >= blocks * 0.6) ?? 1000;
    const sb = this.scaleBar.firstElementChild as HTMLElement;
    sb.style.width = `${nice * S}px`;
    setText(this.scaleBar.lastElementChild, lengthBlocks(nice, this.ui.units));
    if (!T.complete) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, hh - 3, w, 3);
      g.fillStyle = '#2ad0e0';
      g.fillRect(0, hh - 3, w * T.progress, 3);
    }
  }

  private drawLeases(g: CanvasRenderingContext2D, w: number, hh: number) {
    const st = this.st;
    const geo = this.ui.game.geology;
    const P = PARCEL_SIZE;
    const nx = Math.ceil(geo.sizeX / P);
    const nz = Math.ceil(geo.sizeZ / P);
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= nx; i++) { const [x] = this.toScreen(i * P, 0); g.moveTo(Math.round(x) + 0.5, this.toScreen(0, 0)[1]); g.lineTo(Math.round(x) + 0.5, this.toScreen(0, geo.sizeZ)[1]); }
    for (let j = 0; j <= nz; j++) { const [, y] = this.toScreen(0, j * P); g.moveTo(this.toScreen(0, 0)[0], Math.round(y) + 0.5); g.lineTo(this.toScreen(geo.sizeX, 0)[0], Math.round(y) + 0.5); }
    g.stroke();
    for (const l of Object.values(st.leases)) {
      const [x, y] = this.toScreen(l.px * P, l.pz * P);
      const mine = l.owner === this.ui.game.localPlayerId;
      g.fillStyle = mine ? 'rgba(255,138,31,0.2)' : 'rgba(255,77,79,0.18)';
      g.fillRect(x, y, P * this.scale, P * this.scale);
      g.strokeStyle = mine ? 'rgba(255,138,31,0.85)' : 'rgba(255,77,79,0.8)';
      g.lineWidth = 1.5;
      g.strokeRect(x + 1, y + 1, P * this.scale - 2, P * this.scale - 2);
    }
    const hv = this.hover;
    const sel = this.selectedParcel;
    for (const [c, colr] of [[hv ? { px: Math.floor(hv.x / P), pz: Math.floor(hv.z / P) } : null, 'rgba(255,255,255,0.7)'], [sel, '#ffffff']] as const) {
      if (!c) continue;
      const [x, y] = this.toScreen(c.px * P, c.pz * P);
      g.strokeStyle = colr;
      g.lineWidth = c === sel ? 2.5 : 1.5;
      g.strokeRect(x, y, P * this.scale, P * this.scale);
    }
    if (P * this.scale > 44) {
      g.font = '600 10px "JetBrains Mono", monospace';
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const [x, y] = this.toScreen(i * P, j * P);
        if (x < -50 || y < -20 || x > w || y > hh) continue;
        g.fillText(`${i},${j}`, x + 4, y + 12);
      }
    }
  }

  private drawTools(g: CanvasRenderingContext2D) {
    const a = this.toolStart;
    const b = this.toolEnd;
    const pend = this.pending;
    const drawLine = (x0: number, z0: number, x1: number, z1: number) => {
      const [sx0, sy0] = this.toScreen(x0, z0);
      const [sx1, sy1] = this.toScreen(x1, z1);
      g.strokeStyle = '#ff8a1f';
      g.lineWidth = 3;
      g.setLineDash([8, 5]);
      g.shadowColor = 'rgba(255,138,31,0.8)';
      g.shadowBlur = 8;
      g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx1, sy1); g.stroke();
      g.setLineDash([]);
      g.shadowBlur = 0;
      g.fillStyle = '#ff8a1f';
      for (const [x, y] of [[sx0, sy0], [sx1, sy1]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
      this.labelAt(g, (sx0 + sx1) / 2, (sy0 + sy1) / 2 - 10, lengthBlocks(Math.hypot(x1 - x0, z1 - z0), this.ui.units));
    };
    const drawRect = (x0: number, z0: number, x1: number, z1: number) => {
      const [sx0, sy0] = this.toScreen(Math.min(x0, x1), Math.min(z0, z1));
      const [sx1, sy1] = this.toScreen(Math.max(x0, x1), Math.max(z0, z1));
      g.fillStyle = 'rgba(255,138,31,0.12)';
      g.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      g.strokeStyle = '#ff8a1f';
      g.lineWidth = 2;
      g.setLineDash([8, 5]);
      g.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      g.setLineDash([]);
      this.labelAt(g, (sx0 + sx1) / 2, sy0 - 10, `${lengthBlocks(Math.abs(x1 - x0), this.ui.units)} × ${lengthBlocks(Math.abs(z1 - z0), this.ui.units)}`);
    };
    if (a && b) (this.tool === 'seismic2d' ? drawLine : drawRect)(a.x, a.z, b.x, b.z);
    if (pend) (pend.kind === '2d' ? drawLine : drawRect)(pend.x0, pend.z0, pend.x1, pend.z1);
    if (this.tool === 'skid' && this.rigId) {
      const rig = this.st.buildings[this.rigId];
      const at = this.skidTarget ?? (this.hover ? this.clampWorld(this.hover) : null);
      if (rig && at) this.drawRigGhost(g, rig, at);
    }
  }

  private drawRigGhost(g: CanvasRenderingContext2D, rig: BuildingState, at: Vec2) {
    const [x, y] = this.toScreen(at.x - rig.size[0] / 2, at.z - rig.size[1] / 2);
    g.fillStyle = 'rgba(255,138,31,0.3)';
    g.fillRect(x, y, rig.size[0] * this.scale, rig.size[1] * this.scale);
    g.strokeStyle = '#ff8a1f';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.strokeRect(x, y, rig.size[0] * this.scale, rig.size[1] * this.scale);
    g.setLineDash([]);
    const [cx, cy] = this.toScreen(rig.x + rig.size[0] / 2, rig.z + rig.size[1] / 2);
    const [tx, ty] = this.toScreen(at.x, at.z);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
    if (!isRig(rig.type)) return;
    this.labelAt(g, tx, y - 10, `${at.x}, ${at.z}`);
  }

  private labelAt(g: CanvasRenderingContext2D, x: number, y: number, text: string) {
    g.font = '600 11px "JetBrains Mono", monospace';
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(8,11,15,0.9)';
    g.fillRect(x - tw / 2 - 6, y - 12, tw + 12, 18);
    g.strokeStyle = 'rgba(255,138,31,0.8)';
    g.lineWidth = 1;
    g.strokeRect(x - tw / 2 - 6 + 0.5, y - 12 + 0.5, tw + 12, 18);
    g.fillStyle = '#ffd29a';
    g.textAlign = 'center';
    g.fillText(text, x, y + 1);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' && (this.pending || this.toolStart || this.tool !== 'none')) {
      e.preventDefault();
      this.setTool('none');
      return true;
    }
    return false;
  }

  destroy() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}

