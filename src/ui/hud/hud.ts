// In-game HUD orchestrator: builds all HUD widgets, wires game events and throttles updates (~10 Hz).
import { h, setText, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import type { GameContext } from '../../core/types';
import type { PanelId, UIHost } from '../core/host';
import { keyLabel } from '../format';
import { ensureNotificationsTracked, unseenNotifications } from '../game';
import { TopBar } from './topBar';
import { Minimap } from './minimap';
import { Hotbar } from './hotbar';
import { ObjectivesTracker } from './objectives';
import { AlertBanner, ModeStrip, ScanCard, TargetInfo } from './overlays';

interface DockItem { panel: PanelId; icon: IconName; label: string; bind?: string }
const DOCK: DockItem[] = [
  { panel: 'build', icon: 'build', label: 'Build', bind: 'build' },
  { panel: 'inventory', icon: 'inventory', label: 'Inventory', bind: 'inventory' },
  { panel: 'map', icon: 'map', label: 'Map', bind: 'map' },
  { panel: 'wells', icon: 'wells', label: 'Wells', bind: 'wells' },
  { panel: 'research', icon: 'flask', label: 'Research', bind: 'research' },
  { panel: 'market', icon: 'chart', label: 'Market', bind: 'market' },
  { panel: 'contracts', icon: 'contract', label: 'Contracts', bind: 'contracts' },
  { panel: 'workforce', icon: 'users', label: 'Workforce', bind: 'workforce' },
  { panel: 'finance', icon: 'bank', label: 'Finance', bind: 'finance' },
  { panel: 'environment', icon: 'leaf', label: 'Environment' },
  { panel: 'objectives', icon: 'trophy', label: 'Objectives', bind: 'objectives' },
  { panel: 'notifications', icon: 'bell', label: 'Messages' },
];

export class Hud {
  readonly el: HTMLElement;
  readonly top: TopBar;
  private minimap: Minimap;
  private hotbar: Hotbar;
  private objectives: ObjectivesTracker;
  private target: TargetInfo;
  private modes: ModeStrip;
  private scan: ScanCard;
  private alert: AlertBanner;
  private dockBtns = new Map<PanelId, HTMLButtonElement>();
  private unread: HTMLElement;
  private acc = 0;
  private slowAcc = 0;
  private hidden = false;

  constructor(private ui: UIHost, private ctx: GameContext) {
    this.top = new TopBar(ui, ctx);
    this.minimap = new Minimap(ui, ctx);
    this.hotbar = new Hotbar(ui, ctx);
    this.objectives = new ObjectivesTracker(ui, ctx);
    this.target = new TargetInfo(ui, ctx);
    this.modes = new ModeStrip(ui, ctx);
    this.scan = new ScanCard();
    this.alert = new AlertBanner(ui, ctx);
    this.unread = h('span.dk-badge.mono');
    const dock = h('div.pc-dock.glass.flat');
    for (const d of DOCK) {
      const key = d.bind ? keyLabel(ui.app.settings.keybinds[d.bind]) : '';
      const b = h<HTMLButtonElement>('button.dk-btn', { type: 'button' }, icon(d.icon), key ? h('span.dk-key', key) : null, d.panel === 'notifications' ? this.unread : null);
      b.addEventListener('click', () => {
        ui.sound('click');
        ui.toggle(d.panel);
      });
      b.addEventListener('mouseenter', () => ui.sound('hover'));
      ui.tooltip.attach(b, () => h('div', h('div.tt-title', d.label), key ? h('div.tt-sub', `Hotkey ${key}`) : null));
      this.dockBtns.set(d.panel, b);
      dock.appendChild(b);
    }
    ensureNotificationsTracked(ctx.state);
    this.el = h('div.pc-hud',
      this.top.el,
      this.alert.el,
      h('div.hud-left', this.objectives.el),
      h('div.hud-right', this.minimap.el),
      this.target.el,
      this.modes.el,
      this.scan.el,
      this.hotbar.el,
      dock);

    ui.listen('money:changed', (p) => this.top.onMoney(p.amount));
    ui.listen('player:target', (p) => this.target.set(p));
    ui.listen('player:scan', (p) => {
      if (p.tool === 'build' || p.tool === 'pipe') this.modes.setStatus(p);
      else this.scan.show(p);
    });
    ui.listen('ui:buildMode', (p) => this.modes.setBuild(p.type));
    ui.listen('ui:pipeMode', (p) => this.modes.setPipe(p.block));
    ui.listen('ui:overlay', (p) => this.modes.setOverlay(p.overlay));
    this.update(0);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    toggleClass(this.el, 'hud-hidden', this.hidden);
  }

  /** Called every frame. */
  frame(dt: number, openPanels: PanelId[]) {
    this.top.frame(dt);
    this.scan.update(dt);
    this.acc += dt;
    this.slowAcc += dt;
    if (this.acc >= 0.1) {
      this.update(this.acc);
      this.acc = 0;
    }
    if (this.slowAcc >= 0.5) {
      this.slowAcc = 0;
      this.alert.update();
      for (const [p, b] of this.dockBtns) toggleClass(b, 'on', openPanels.includes(p));
      const u = unseenNotifications(this.ctx.state);
      setText(this.unread, u > 0 ? (u > 99 ? '99+' : String(u)) : '');
    }
  }

  update(dt: number) {
    this.top.update();
    this.minimap.update(dt);
    this.hotbar.update(dt);
    this.objectives.update();
    this.target.update();
    toggleClass(this.el, 'panel-open', this.ui.app.uiCapturing);
  }
}
