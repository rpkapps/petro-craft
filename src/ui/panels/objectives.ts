// Objectives (O): campaign chapters with objectives & rewards, the current tutorial step, achievements.
import { h, clear, setText, bar, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, tabs, type TabsCtl } from '../core/components';
import { CHAPTERS, TUTORIAL_STEPS, ACHIEVEMENTS } from '../../sim/economy';
import type { Objective } from '../../core/types';
import { compact, keyLabel, money, roman, titleCase } from '../format';

type Tab = 'campaign' | 'achievements';
const ACH_ICON: Record<string, IconName> = {
  barrel: 'barrel', truck: 'truck', flame: 'gas', handshake: 'handshake', money: 'money', drill: 'rig', fountain: 'oil', rig: 'rig', oil: 'oil',
  gas: 'gas', fire: 'fire', leaf: 'leaf', shield: 'shield', flask: 'flask', ship: 'ship', factory: 'factory', pipe: 'pipe', star: 'star',
  trophy: 'trophy', users: 'users', map: 'map', seismic: 'seismic', coin: 'coin', bank: 'bank', globe: 'globe', platform: 'platform',
};

export class ObjectivesPanel extends Panel {
  readonly id = 'objectives' as const;
  private tab: Tab = 'campaign';
  private tabCtl!: TabsCtl<Tab>;
  private chapter = 1;
  private content!: HTMLElement;
  private sig = '';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Objectives', 'trophy', 'lg');
    this.fixedBody = true;
    this.chapter = ui.game.state.objectives.chapter;
    if (args.tab === 'achievements') this.tab = 'achievements';
  }

  protected build() {
    this.tabCtl = tabs<Tab>([{ value: 'campaign', label: 'Campaign', icon: 'flag' }, { value: 'achievements', label: 'Achievements', icon: 'trophy' }], this.tab, (v) => {
      this.ui.sound('click');
      this.tab = v;
      this.sig = '';
      this.update();
    });
    this.tabsEl.appendChild(this.tabCtl.el);
    this.content = h('div.ob-panel');
    this.body.appendChild(this.content);
  }

  private chapterInfo(id: number) {
    return CHAPTERS.find((c) => c.id === id);
  }

  private renderCampaign() {
    const st = this.ui.game.state;
    const o = st.objectives;
    clear(this.content);
    const nav = h('nav.obp-nav.scroll');
    const chapters = CHAPTERS.length ? CHAPTERS.map((c) => c.id) : [...new Set(o.list.map((x) => x.chapter))].sort();
    for (const id of chapters) {
      const info = this.chapterInfo(id);
      const list = o.list.filter((x) => x.chapter === id);
      const done = list.filter((x) => x.done).length;
      const locked = id > o.chapter;
      const b = h(`button.obp-ch${id === this.chapter ? '.on' : ''}${locked ? '.locked' : ''}${id < o.chapter ? '.complete' : ''}`, { type: 'button' },
        h('span.obp-num', roman(id)),
        h('div.col.grow', { style: 'gap:.1rem;min-width:0' }, h('b.ellipsis', info?.title ?? `Chapter ${roman(id)}`), h('span.tiny.dim.ellipsis', locked ? 'Locked' : info?.subtitle ?? `${done}/${list.length} complete`), !locked ? bar(list.length ? done / list.length : 0, id < o.chapter ? 'ok' : '', 'thin') : null),
        locked ? icon('lock') : id < o.chapter ? icon('check') : null);
      b.addEventListener('click', () => { this.ui.sound('click'); this.chapter = id; this.sig = ''; this.update(); });
      nav.appendChild(b);
    }
    const info = this.chapterInfo(this.chapter);
    const main = h('div.obp-main.scroll');
    main.appendChild(h('div.obp-hero', h('div.obp-heronum', roman(this.chapter)), h('div.col', { style: 'gap:.2rem' }, h('div.label', `Chapter ${roman(this.chapter)}`), h('h3.obp-title', info?.title ?? 'Objectives'), info?.subtitle ? h('div.dim', info.subtitle) : null)));
    if (info?.description) main.appendChild(h('p.obp-desc', info.description));
    const step = !o.tutorialDone ? TUTORIAL_STEPS[o.tutorialStep] : undefined;
    if (step && this.chapter === o.chapter) {
      const k = step.key ? this.ui.app.settings.keybinds[step.key] : undefined;
      main.appendChild(h('div.obp-tut',
        h('div.row', icon('bulb'), h('b', `Tutorial · ${step.title}`), h('span.sp'), k ? h('span.kbd', keyLabel(k)) : null),
        h('p', step.text),
        step.panel ? button(`Open ${titleCase(step.panel === 'wellPlanner' ? 'wells' : step.panel === 'leases' ? 'map' : step.panel)}`, { icon: 'arrow-right', size: 'sm', variant: 'teal', onClick: () => this.ui.game.bus.emit('ui:open', { panel: step.panel!, args: {} }) }) : null));
    }
    const list = h('div.obp-list');
    for (const ob of o.list.filter((x) => x.chapter === this.chapter)) list.appendChild(this.objectiveCard(ob, this.chapter > o.chapter));
    if (!list.childElementCount) list.appendChild(h('div.empty', icon('lock'), h('div', 'Complete the current chapter to unlock these objectives.')));
    main.appendChild(list);
    this.content.appendChild(h('div.obp-layout', nav, main));
  }

  private objectiveCard(ob: Objective, locked: boolean): HTMLElement {
    const frac = ob.target > 0 ? Math.min(1, ob.progress / ob.target) : ob.done ? 1 : 0;
    const pb = bar(frac, ob.done ? 'ok' : '');
    const claim = ob.done && !ob.claimed && ob.reward > 0 ? button(`Claim ${money(ob.reward)}`, { icon: 'coin', size: 'sm', variant: 'primary', onClick: () => {
      const r = this.ui.dispatch({ type: 'objective/claim', objectiveId: ob.id }, { successSound: 'cash' });
      if (r.ok) {
        this.ui.toast('success', 'Reward claimed', `${ob.title} · ${money(ob.reward)}`, { icon: 'trophy' });
        this.sig = '';
      }
    } }) : null;
    return h(`div.card.obp-card${ob.done ? '.done' : ''}${locked ? '.locked' : ''}`,
      h('div.obp-check', icon(ob.done ? 'check' : locked ? 'lock' : 'target')),
      h('div.col.grow', { style: 'gap:.3rem;min-width:0' },
        h('div.row', h('b.grow', ob.title), ob.claimed ? chip('Claimed', 'ok', true) : ob.reward ? h('span.mono.small.accent', money(ob.reward)) : null),
        h('div.small.dim', ob.description),
        h('div.row', h('div.grow', pb), h('span.mono.small', ob.done ? 'Complete' : `${compact(Math.min(ob.progress, ob.target))} / ${compact(ob.target)}`))),
      claim);
  }

  private renderAchievements() {
    const st = this.ui.game.state;
    const got = new Set(st.objectives.achievements);
    clear(this.content);
    const grid = h('div.ach-grid.scroll');
    const defs = ACHIEVEMENTS.length ? ACHIEVEMENTS : st.objectives.achievements.map((id) => ({ id, title: titleCase(id), description: '', icon: 'trophy', secret: false }));
    for (const a of defs) {
      const on = got.has(a.id);
      const hidden = !on && a.secret;
      grid.appendChild(h(`div.ach${on ? '.on' : ''}`,
        h('div.ach-ic', icon(hidden ? 'help' : ACH_ICON[a.icon] ?? 'trophy')),
        h('div.col', { style: 'gap:.15rem;min-width:0' }, h('b', hidden ? 'Secret achievement' : a.title), h('span.tiny.dim', hidden ? 'Keep playing to discover it.' : a.description))));
    }
    this.content.append(h('div.ach-head', h('b.pl-qbig', `${got.size} / ${defs.length}`), h('span.dim', 'achievements unlocked')), grid);
  }

  update() {
    const o = this.ui.game.state.objectives;
    const claimable = o.list.filter((x) => x.done && !x.claimed && x.reward > 0).length;
    this.tabCtl.setBadge('campaign', claimable ? String(claimable) : '');
    const sig = `${this.tab}|${this.chapter}|${o.chapter}|${o.tutorialStep}|${o.tutorialDone}|${o.achievements.length}|${o.list.map((x) => `${x.id}:${Math.round(x.progress * 100) / 100}:${x.done}:${x.claimed}`).join(',')}`;
    if (sig === this.sig) return;
    const scroll = this.content.querySelector('.obp-main')?.scrollTop ?? 0;
    this.sig = sig;
    if (this.tab === 'campaign') this.renderCampaign();
    else this.renderAchievements();
    const m = this.content.querySelector('.obp-main');
    if (m) m.scrollTop = scroll;
    toggleClass(this.el, 'claimable', claimable > 0);
    setText(this.subEl, `Chapter ${roman(o.chapter)} · ${o.list.filter((x) => x.done).length}/${o.list.length} objectives complete`);
  }
}
