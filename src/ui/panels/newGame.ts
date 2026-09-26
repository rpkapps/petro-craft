// New Game dialog: company & save names, seed, world size, difficulty and rule toggles.
import { h, toggleClass, setText } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, field, toggle } from '../core/components';
import { DIFFICULTY_SETTINGS, WORLD_SIZES, type Difficulty, type WorldSizeKey } from '../../core/constants';
import type { NewGameOptions } from '../../core/state';
import { money, int } from '../format';

const COMPANY_A = ['Black Mesa', 'Red River', 'Lone Star', 'Silver Basin', 'Iron Ridge', 'Coyote Creek', 'Blue Horizon', 'Granite Peak', 'Prairie Wind', 'Stormcrest', 'Copperline', 'Midland', 'Northstar', 'Eagle Ford'];
const COMPANY_B = ['Petroleum', 'Energy', 'Oil & Gas', 'Resources', 'Exploration', 'Hydrocarbons', 'Drilling Co.'];

const SIZE_INFO: Record<WorldSizeKey, [string, string, IconName]> = {
  small: ['Small', 'A compact basin. Quick to explore, fewer prospects.', 'target'],
  medium: ['Medium', 'Balanced map with onshore plays and a coastline.', 'map'],
  large: ['Large', 'Vast basin, deep offshore frontier. For long campaigns.', 'globe'],
};
const DIFF_INFO: Record<Difficulty, [string, string]> = {
  easy: ['Relaxed', 'Stable prices, forgiving equipment, cheap credit.'],
  normal: ['Standard', 'The intended balance of risk and reward.'],
  hard: ['Wildcatter', 'Volatile markets, frequent failures, expensive loans.'],
  sandbox: ['Sandbox', 'Near-unlimited funds. Build freely and experiment.'],
};

export function randomCompany(): string {
  return `${COMPANY_A[Math.floor(Math.random() * COMPANY_A.length)]} ${COMPANY_B[Math.floor(Math.random() * COMPANY_B.length)]}`;
}

/** Numeric seed from free text (numbers are used verbatim). */
export function seedFromText(s: string): number {
  const t = s.trim();
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let hsh = 2166136261;
  for (let i = 0; i < t.length; i++) {
    hsh ^= t.charCodeAt(i);
    hsh = Math.imul(hsh, 16777619);
  }
  return hsh | 0;
}

export class NewGamePanel extends Panel {
  readonly id = 'newgame' as const;
  private opts: NewGameOptions;
  private seedText: string;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'New Game', 'plus', 'lg');
    const company = randomCompany();
    this.seedText = String(Math.floor(Math.random() * 999999));
    this.opts = { saveName: company, companyName: company, seed: 0, worldSize: 'medium', difficulty: 'normal', tutorial: true, hazards: true, creative: false };
    this.setSubtitle('Found your company and choose the basin you will explore');
  }

  protected build() {
    const o = this.opts;
    const companyIn = h<HTMLInputElement>('input.input', { value: o.companyName, maxLength: 32, placeholder: 'Company name' });
    const saveIn = h<HTMLInputElement>('input.input', { value: o.saveName, maxLength: 40, placeholder: 'Save name' });
    let saveTouched = false;
    companyIn.addEventListener('input', () => {
      o.companyName = companyIn.value;
      if (!saveTouched) {
        saveIn.value = companyIn.value;
        o.saveName = companyIn.value;
      }
    });
    saveIn.addEventListener('input', () => {
      saveTouched = true;
      o.saveName = saveIn.value;
    });
    const seedIn = h<HTMLInputElement>('input.input', { value: this.seedText, maxLength: 24 });
    seedIn.addEventListener('input', () => (this.seedText = seedIn.value));
    const dice = button(null, { icon: 'dice', title: 'Random seed', onClick: () => {
      this.ui.sound('click');
      this.seedText = String(Math.floor(Math.random() * 999999));
      seedIn.value = this.seedText;
      dice.classList.remove('spin');
      void dice.offsetWidth;
      dice.classList.add('spin');
    } });
    const rndCo = button(null, { icon: 'refresh', title: 'Random company name', onClick: () => {
      this.ui.sound('click');
      companyIn.value = randomCompany();
      companyIn.dispatchEvent(new Event('input'));
    } });

    const sizeCards = h('div.ng-cards.c3');
    const sizeBtns = new Map<WorldSizeKey, HTMLElement>();
    for (const k of Object.keys(WORLD_SIZES) as WorldSizeKey[]) {
      const [name, desc, ic] = SIZE_INFO[k];
      const b = h('button.opt-card', { type: 'button' }, h('span.oc-ic', icon(ic)), h('span.oc-t', name), h('span.oc-v', `${WORLD_SIZES[k]} × ${WORLD_SIZES[k]} blocks`), h('span.oc-d', desc));
      b.addEventListener('click', () => { this.ui.sound('click'); o.worldSize = k; paint(); });
      sizeBtns.set(k, b);
      sizeCards.appendChild(b);
    }
    const diffCards = h('div.ng-cards.c4');
    const diffBtns = new Map<Difficulty, HTMLElement>();
    for (const k of Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]) {
      const [name, desc] = DIFF_INFO[k];
      const d = DIFFICULTY_SETTINGS[k];
      const b = h('button.opt-card', { type: 'button' }, h('span.oc-t', name), h('span.oc-v', `${money(d.startMoney, 0)} start`), h('span.oc-d', desc), h('span.oc-d.mono', `Loans ${int(d.loanRate * 100)}% · volatility ×${d.priceVolatility}`));
      b.addEventListener('click', () => {
        this.ui.sound('click');
        o.difficulty = k;
        if (k === 'sandbox') { o.creative = true; creative.set(true); }
        paint();
      });
      diffBtns.set(k, b);
      diffCards.appendChild(b);
    }
    const tutorial = toggle('Tutorial', o.tutorial, (v) => (o.tutorial = v), 'Guided objectives');
    const hazards = toggle('Hazards', o.hazards, (v) => (o.hazards = v), 'Fires, blowouts, storms');
    const creative = toggle('Creative', o.creative, (v) => (o.creative = v), 'Build without cost limits');
    const paint = () => {
      for (const [k, b] of sizeBtns) toggleClass(b, 'on', k === o.worldSize);
      for (const [k, b] of diffBtns) toggleClass(b, 'on', k === o.difficulty);
      setText(summary, `${SIZE_INFO[o.worldSize][0]} world · ${DIFF_INFO[o.difficulty][0]} · ${money(DIFFICULTY_SETTINGS[o.difficulty].startMoney, 0)}`);
    };
    const summary = h('span.dim.small');
    this.body.append(
      h('div.col', { style: 'gap:1.1rem' },
        h('div.ng-grid',
          field('Company name', h('div.ng-seed', companyIn, rndCo)),
          field('Save name', saveIn),
          field('World seed', h('div.ng-seed', seedIn, dice), 'Same seed + size = same geology'),
          h('div')),
        h('div.col', { style: 'gap:.5rem' }, h('div.label', 'World size'), sizeCards),
        h('div.col', { style: 'gap:.5rem' }, h('div.label', 'Difficulty'), diffCards),
        h('div.col', { style: 'gap:.5rem' }, h('div.label', 'Rules'), h('div.ng-toggles', h('div.card', tutorial.el), h('div.card', hazards.el), h('div.card', creative.el)))));
    const start = button('Start Game', { icon: 'play', variant: 'primary', size: 'lg', onClick: () => void this.start() });
    this.el.appendChild(h('footer.ng-foot', summary, h('span.sp'), button('Cancel', { variant: 'ghost', onClick: () => { this.ui.sound('close'); this.ui.close(); } }), start));
    paint();
  }

  private async start() {
    const o = this.opts;
    o.companyName = o.companyName.trim() || 'Wildcat Petroleum';
    o.saveName = o.saveName.trim() || o.companyName;
    o.seed = seedFromText(this.seedText || '1');
    this.ui.sound('success');
    this.ui.closeAll();
    try {
      await this.ui.app.newGame({ ...o });
    } catch (err) {
      console.error(err);
      this.ui.toast('danger', 'Could not start the game', String((err as Error)?.message ?? err));
      try { await this.ui.app.quitToMenu(); } catch { /* ignore */ }
    }
  }
}
