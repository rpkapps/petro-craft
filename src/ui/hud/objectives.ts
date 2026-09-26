// Left-side objectives tracker: current chapter's objectives with progress bars and claim buttons.
import { h, setText, toggleClass, setBar, bar, KeyedList } from '../dom';
import { icon } from '../icons';
import type { GameContext, Objective } from '../../core/types';
import type { UIHost } from '../core/host';
import { money, roman, compact, keyLabel } from '../format';
import { TUTORIAL_STEPS } from '../../sim/economy';

export class ObjectivesTracker {
  readonly el: HTMLElement;
  private list: KeyedList<Objective>;
  private chapter: HTMLElement;
  private tutorial: HTMLElement;
  private collapsed = false;
  private count: HTMLElement;
  private tutKey = '~';

  constructor(private ui: UIHost, private ctx: GameContext) {
    try {
      this.collapsed = localStorage.getItem('petrocraft.ui.objCollapsed') === '1';
    } catch {
      /* storage unavailable */
    }
    this.chapter = h('div.ob-chapter');
    this.count = h('span.ob-count.mono');
    const toggleBtn = h<HTMLButtonElement>('button.ob-toggle', { type: 'button', title: 'Collapse / expand' }, icon('chevron-up'));
    const head = h('div.ob-head', icon('target'), h('div.col.grow', { style: 'gap:0' }, h('div.ob-lbl', 'Objectives', this.count), this.chapter), toggleBtn);
    head.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.ob-toggle')) {
        this.collapsed = !this.collapsed;
        try { localStorage.setItem('petrocraft.ui.objCollapsed', this.collapsed ? '1' : '0'); } catch { /* ignore */ }
        this.ui.sound('click');
        this.update();
      } else {
        this.ui.sound('open');
        this.ui.open('objectives');
      }
    });
    this.tutorial = h('div.ob-tutorial');
    const body = h('div.ob-list');
    this.list = new KeyedList<Objective>(body, (o) => o.id, (o) => {
      const title = h('div.ob-title');
      const prog = h('span.ob-prog.mono');
      const b = bar(0, '', 'thin');
      const claim = h<HTMLButtonElement>('button.btn.primary.xs.ob-claim', { type: 'button' }, icon('coin'), h('span.lbl', 'Claim'));
      let cur = o;
      claim.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = this.ui.dispatch({ type: 'objective/claim', objectiveId: cur.id }, { successSound: 'cash' });
        if (r.ok) this.ui.toast('success', 'Reward claimed', `${cur.title} · ${money(cur.reward)}`, { icon: 'trophy' });
      });
      const check = h('span.ob-check', icon('check'));
      const node = h('div.ob-item', h('div.row', { style: 'gap:.4rem; align-items:flex-start' }, check, h('div.grow', title), prog), b, claim);
      this.ui.tooltip.attach(node, () => h('div', h('div.tt-title', cur.title), h('div.tt-body', cur.description), cur.reward ? h('div.tt-sub', `Reward ${money(cur.reward)}`) : null));
      return {
        node,
        update: (x: Objective) => {
          cur = x;
          setText(title, x.title);
          setText(prog, x.done ? '✓' : `${compact(Math.min(x.progress, x.target))}/${compact(x.target)}`);
          setBar(b, x.target > 0 ? x.progress / x.target : x.done ? 1 : 0);
          toggleClass(node, 'done', x.done);
          toggleClass(claim, 'hidden', !(x.done && !x.claimed && x.reward > 0));
          b.className = `bar thin${x.done ? ' ok' : ''}`;
        },
      };
    });
    this.el = h('div.pc-objectives.glass.flat', head, this.tutorial, body);
  }

  update() {
    const o = this.ctx.state.objectives;
    const current = o.list.filter((x) => x.chapter === o.chapter && !x.claimed);
    const visible = current.length ? current : o.list.filter((x) => !x.claimed).slice(0, 4);
    const show = visible.slice(0, 5);
    setText(this.chapter, `Chapter ${roman(o.chapter)}`);
    const doneCount = o.list.filter((x) => x.chapter === o.chapter && x.done).length;
    const total = o.list.filter((x) => x.chapter === o.chapter).length;
    setText(this.count, total ? `${doneCount}/${total}` : '');
    toggleClass(this.el, 'collapsed', this.collapsed);
    toggleClass(this.el, 'hidden', o.list.length === 0 && o.tutorialDone);
    const step = !o.tutorialDone ? TUTORIAL_STEPS[o.tutorialStep] : undefined;
    const tutKey = step ? `${o.tutorialStep}|${step.key ?? ''}|${this.ui.app.settings.keybinds[step.key ?? ''] ?? ''}` : '';
    if (tutKey !== this.tutKey) {
      this.tutKey = tutKey;
      this.tutorial.replaceChildren();
      if (step) {
        const k = step.key ? this.ui.app.settings.keybinds[step.key] : undefined;
        this.tutorial.append(
          h('div.ob-tut-title', icon('bulb'), h('span', step.title), k ? h('span.kbd', keyLabel(k)) : null),
          h('div.ob-tut-text', step.text));
      }
    }
    toggleClass(this.tutorial, 'hidden', !step || this.collapsed);
    this.list.sync(this.collapsed ? [] : show);
    const claimable = o.list.some((x) => x.done && !x.claimed && x.reward > 0);
    toggleClass(this.el, 'claimable', claimable);
  }
}
