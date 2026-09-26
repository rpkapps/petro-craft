// Settings: graphics, audio, controls (with key remapping) and gameplay options. Applied immediately.
import { h, clear, setText, toggleClass } from '../dom';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, segmented, slider, toggle, type SegCtl } from '../core/components';
import { DEFAULT_KEYBINDS, DEFAULT_SETTINGS } from '../../core/settings';
import type { Settings } from '../../core/types';
import { keyLabel } from '../format';
import type { IconName } from '../icons';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'graphics', label: 'Graphics', icon: 'monitor' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'controls', label: 'Controls', icon: 'keyboard' },
  { id: 'gameplay', label: 'Gameplay', icon: 'gamepad' },
];

const BIND_LABELS: Record<string, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / fly up', sneak: 'Sneak / fly down',
  sprint: 'Sprint', inventory: 'Inventory', build: 'Build menu', research: 'Research', market: 'Market', map: 'Map', wells: 'Wells',
  workforce: 'Workforce', contracts: 'Contracts', finance: 'Finance', objectives: 'Objectives', xray: 'X-ray view', drone: 'Drone camera',
  fly: 'Toggle fly', rotate: 'Rotate building', pause: 'Pause / close', help: 'Help', screenshot: 'Screenshot', hideHud: 'Hide HUD',
  quickSave: 'Quick save', quickLoad: 'Quick load', pipeMode: 'Pipe mode', speedUp: 'Speed up', speedDown: 'Slow down',
  togglePause: 'Pause time', drop: 'Drop item', inspect: 'Inspect',
};
const BIND_GROUPS: [string, string[]][] = [
  ['Movement', ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint', 'fly', 'drone']],
  ['Interaction', ['rotate', 'pipeMode', 'xray', 'drop', 'inspect']],
  ['Panels', ['inventory', 'build', 'research', 'market', 'map', 'wells', 'workforce', 'contracts', 'finance', 'objectives', 'help']],
  ['System', ['pause', 'togglePause', 'speedDown', 'speedUp', 'quickSave', 'quickLoad', 'hideHud', 'screenshot']],
];

export class SettingsPanel extends Panel {
  readonly id = 'settings' as const;
  private tab: Tab = 'graphics';
  private content!: HTMLElement;
  private tabBar!: SegCtl<Tab>;
  private capturing: string | null = null;
  private bindBtns = new Map<string, HTMLButtonElement>();

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Settings', 'settings', 'md');
    if (typeof args.tab === 'string') this.tab = args.tab as Tab;
  }

  private get s(): Settings {
    return this.ui.app.settings;
  }

  private apply(p: Partial<Settings>) {
    this.ui.app.applySettings(p);
  }

  protected build() {
    this.tabBar = segmented(TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon })), this.tab, (v) => {
      this.ui.sound('click');
      this.tab = v;
      this.renderTab();
    }, 'tabs-seg');
    this.tabsEl.appendChild(this.tabBar.el);
    this.content = h('div.st-content');
    this.body.appendChild(this.content);
    this.renderTab();
  }

  private row(label: string, control: HTMLElement, hint?: string) {
    return h('div.st-row', h('div.st-l', h('div', label), hint ? h('div.tiny.dim', hint) : null), h('div.st-c', control));
  }

  private renderTab() {
    clear(this.content);
    this.bindBtns.clear();
    this.capturing = null;
    const s = this.s;
    const c = this.content;
    if (this.tab === 'graphics') {
      c.append(
        h('div.section-title', 'Display'),
        this.row('Render distance', slider({ min: 3, max: 16, step: 1, value: s.renderDistance, format: (v) => `${v} chunks`, onChange: (v) => this.apply({ renderDistance: v }) }).el, 'Higher values show more terrain but cost performance'),
        this.row('Field of view', slider({ min: 55, max: 110, step: 1, value: s.fov, format: (v) => `${v}°`, onInput: (v) => this.apply({ fov: v }) }).el),
        this.row('Show FPS counter', toggle(null, s.showFps, (v) => this.apply({ showFps: v })).el),
        h('div.section-title', 'Lighting & effects'),
        this.row('Shadows', toggle(null, s.shadows, (v) => this.apply({ shadows: v })).el),
        this.row('Shadow quality', segmented([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], s.shadowQuality, (v) => this.apply({ shadowQuality: v })).el),
        this.row('Bloom', toggle(null, s.bloom, (v) => this.apply({ bloom: v })).el, 'Glow on flares, lights and fire'),
        this.row('Ambient occlusion (SSAO)', toggle(null, s.ssao, (v) => this.apply({ ssao: v })).el, 'Soft contact shadows — expensive'),
        this.row('Volumetric clouds', toggle(null, s.clouds, (v) => this.apply({ clouds: v })).el),
        this.row('Particles', segmented([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], s.particles, (v) => this.apply({ particles: v })).el),
        this.resetRow(['renderDistance', 'fov', 'showFps', 'shadows', 'shadowQuality', 'bloom', 'ssao', 'clouds', 'particles']));
    } else if (this.tab === 'audio') {
      const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
      c.append(
        h('div.section-title', 'Volume'),
        this.row('Master', slider({ min: 0, max: 1, step: 0.01, value: s.masterVolume, format: pctFmt, onInput: (v) => this.apply({ masterVolume: v }), onChange: () => this.ui.sound('click') }).el),
        this.row('Music', slider({ min: 0, max: 1, step: 0.01, value: s.musicVolume, format: pctFmt, onInput: (v) => this.apply({ musicVolume: v }) }).el),
        this.row('Effects', slider({ min: 0, max: 1, step: 0.01, value: s.sfxVolume, format: pctFmt, onInput: (v) => this.apply({ sfxVolume: v }), onChange: () => this.ui.sound('click') }).el),
        this.resetRow(['masterVolume', 'musicVolume', 'sfxVolume']));
    } else if (this.tab === 'controls') {
      c.append(
        h('div.section-title', 'Mouse'),
        this.row('Mouse sensitivity', slider({ min: 0.2, max: 3, step: 0.05, value: s.mouseSensitivity, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => this.apply({ mouseSensitivity: v }) }).el),
        this.row('Invert Y axis', toggle(null, s.invertY, (v) => this.apply({ invertY: v })).el));
      for (const [group, keys] of BIND_GROUPS) {
        c.appendChild(h('div.section-title', group));
        const grid = h('div.st-binds');
        for (const k of keys) {
          const b = h<HTMLButtonElement>('button.st-key', { type: 'button' }, keyLabel(s.keybinds[k]));
          b.addEventListener('click', () => {
            this.ui.sound('click');
            this.startCapture(k);
          });
          this.bindBtns.set(k, b);
          grid.appendChild(h('div.st-bind', h('span', BIND_LABELS[k] ?? k), b));
        }
        c.appendChild(grid);
      }
      c.appendChild(h('div.st-foot', button('Reset key bindings', { icon: 'refresh', size: 'sm', onClick: () => {
        this.ui.sound('click');
        this.apply({ keybinds: { ...DEFAULT_KEYBINDS } });
        this.renderTab();
      } })));
      this.paintConflicts();
    } else {
      c.append(
        h('div.section-title', 'Interface'),
        this.row('UI scale', slider({ min: 0.75, max: 1.5, step: 0.05, value: s.uiScale, format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => this.apply({ uiScale: v }) }).el),
        this.row('Units', segmented([{ value: 'imperial', label: 'Imperial (ft, bbl)' }, { value: 'metric', label: 'Metric (m, m³)' }], s.units, (v) => this.apply({ units: v })).el),
        h('div.section-title', 'Saving'),
        this.row('Autosave interval', slider({ min: 0, max: 30, step: 1, value: s.autosaveMinutes, format: (v) => (v === 0 ? 'Off' : `${v} min`), onChange: (v) => this.apply({ autosaveMinutes: v }) }).el),
        this.resetRow(['uiScale', 'units', 'autosaveMinutes']));
    }
  }

  private resetRow(keys: (keyof Settings)[]) {
    return h('div.st-foot', button('Restore defaults', { icon: 'refresh', size: 'sm', onClick: () => {
      this.ui.sound('click');
      const p: Partial<Settings> = {};
      for (const k of keys) (p as Record<string, unknown>)[k] = structuredClone(DEFAULT_SETTINGS[k]);
      this.apply(p);
      this.renderTab();
    } }));
  }

  private startCapture(action: string) {
    this.capturing = action;
    for (const [k, b] of this.bindBtns) {
      toggleClass(b, 'capturing', k === action);
      if (k === action) setText(b, 'Press a key…');
      else setText(b, keyLabel(this.s.keybinds[k]));
    }
  }

  private paintConflicts() {
    const used = new Map<string, number>();
    for (const v of Object.values(this.s.keybinds)) used.set(v, (used.get(v) ?? 0) + 1);
    for (const [k, b] of this.bindBtns) toggleClass(b, 'conflict', (used.get(this.s.keybinds[k]) ?? 0) > 1);
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.capturing) return false;
    e.preventDefault();
    e.stopPropagation();
    const action = this.capturing;
    this.capturing = null;
    const b = this.bindBtns.get(action);
    b?.classList.remove('capturing');
    if (e.code !== 'Escape' || action === 'pause') {
      this.apply({ keybinds: { ...this.s.keybinds, [action]: e.code } });
      this.ui.sound('success');
    }
    if (b) setText(b, keyLabel(this.s.keybinds[action]));
    this.paintConflicts();
    return true;
  }
}

