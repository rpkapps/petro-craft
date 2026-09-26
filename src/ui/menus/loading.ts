// Loading screen: animated backdrop, shimmering progress bar, status label and rotating tips.
import { h, setText } from '../dom';
import { icon, type IconName } from '../icons';
import { logoBlock } from './mainMenu';
import type { MenuBackground } from './menuBackground';

const TIPS: [IconName, string, string][] = [
  ['seismic', 'Shoot seismic before you drill', 'Anticlines and bright spots on a seismic section mark where hydrocarbons are trapped. A dry hole costs as much as a good one.'],
  ['gauge', 'Mind the mud-weight window', 'Keep mud weight above pore pressure to prevent kicks — but below the fracture gradient, or you will lose circulation.'],
  ['shield', 'Set surface casing deep', 'Casing below the fresh-water aquifer protects groundwater and your environmental licence.'],
  ['pipe', 'Pipes only carry their own fluid', 'Crude lines carry oil, gas lines carry gas. Connect wellhead outlets to the matching network.'],
  ['flare', 'Never vent gas', 'Without a gas outlet, wellheads flare excess gas. Venting is far worse for your environmental score.'],
  ['pumpjack', 'Artificial lift revives tired wells', 'When reservoir pressure drops, a pumpjack or ESP keeps oil flowing — research Beam Pumps first.'],
  ['chart', 'Store when prices are low', 'Tank farms let you hold crude until the market recovers. Watch market events for opportunities.'],
  ['contract', 'Contracts pay a premium', 'Delivery contracts beat spot prices — but missing a deadline costs you a penalty and reputation.'],
  ['users', 'Crews make the field run', 'Buildings without their required crew run slowly or not at all. Worker camps keep morale up.'],
  ['frac', 'Tight rock needs fracturing', 'Shale reservoirs barely flow on their own. Horizontal wells plus multi-stage fracs unlock them.'],
  ['water', 'Plan for produced water', 'Water cut rises as fields mature. Disposal wells or treatment plants keep production moving.'],
  ['keyboard', 'Hotkeys', 'B build · E inventory · N map · J wells · T research · M market · X x-ray view · V drone camera.'],
  ['fire', 'Blowouts are costly', 'Install BOPs early. A burning well spreads fire to nearby equipment and scars the land.'],
  ['platform', 'Offshore is the big league', 'Jack-ups and platforms unlock huge offshore fields — tie wells back within 24 blocks of a platform.'],
];

export class LoadingScreen {
  readonly el: HTMLElement;
  private barFill: HTMLElement;
  private pctEl: HTMLElement;
  private label: HTMLElement;
  private tipIcon: HTMLElement;
  private tipTitle: HTMLElement;
  private tipText: HTMLElement;
  private tipCard: HTMLElement;
  private tipIdx = Math.floor(Math.random() * TIPS.length);
  private tipTimer = 0;
  private shown = 0;
  private target = 0;
  private bgHost: HTMLElement;
  active = false;

  constructor(private bg: MenuBackground) {
    this.barFill = h('i');
    this.pctEl = h('div.ld-pct.mono');
    this.label = h('div.ld-label');
    this.tipIcon = h('div.ld-tip-ic');
    this.tipTitle = h('div.ld-tip-title');
    this.tipText = h('div.ld-tip-text');
    this.tipCard = h('div.ld-tip.glass.flat', this.tipIcon, h('div.col', { style: 'gap:.2rem' }, h('div.ld-tip-k', 'Field Notes'), this.tipTitle, this.tipText));
    this.bgHost = h('div.mn-bghost');
    this.el = h('div.pc-loading',
      this.bgHost,
      h('div.mn-vignette.strong'),
      h('div.mn-grain'),
      h('div.ld-top', logoBlock(false)),
      h('div.ld-bottom',
        this.tipCard,
        h('div.ld-progress',
          h('div.row.between', this.label, this.pctEl),
          h('div.ld-bar', this.barFill, h('span.ld-shine')))));
    this.showTip();
  }

  private showTip() {
    const [ic, title, text] = TIPS[this.tipIdx % TIPS.length];
    this.tipIcon.replaceChildren(icon(ic));
    setText(this.tipTitle, title);
    setText(this.tipText, text);
    this.tipCard.classList.remove('swap');
    void this.tipCard.offsetWidth;
    this.tipCard.classList.add('swap');
  }

  set(active: boolean, progress: number, label: string) {
    if (active && !this.active) {
      this.shown = 0;
      this.bgHost.appendChild(this.bg.canvas);
      this.bg.dim = 0.35;
      this.bg.start();
      this.el.classList.add('show');
    }
    if (!active && this.active) this.el.classList.remove('show');
    this.active = active;
    this.target = Math.max(0, Math.min(1, progress));
    if (label) setText(this.label, label);
  }

  update(dt: number) {
    if (!this.active) return;
    this.shown += (this.target - this.shown) * Math.min(1, dt * 6);
    this.barFill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    setText(this.pctEl, `${Math.round(this.shown * 100)}%`);
    this.tipTimer += dt;
    if (this.tipTimer > 7) {
      this.tipTimer = 0;
      this.tipIdx++;
      this.showTip();
    }
  }
}
