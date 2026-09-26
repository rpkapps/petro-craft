// Pause menu: resume, save, load, settings, help and quit to menu. Pauses the simulation while open.
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { formatGameDate, money, duration } from '../format';
import { logoBlock } from '../menus/mainMenu';

export class PausePanel extends Panel {
  readonly id = 'pause' as const;
  private pausedByUs = false;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Paused', 'pause', 'sm');
    this.el.classList.add('pause-panel');
    const ctx = ui.ctx;
    if (ctx && !ctx.state.time.paused) {
      ctx.commands.dispatch({ type: 'time/setPaused', paused: true });
      this.pausedByUs = true;
    }
  }

  protected build() {
    const ctx = this.ui.ctx;
    if (ctx) this.setSubtitle(`${ctx.state.company.name} · ${formatGameDate(ctx.state)}`);
    const item = (ic: IconName, label: string, fn: () => void, cls = '') => {
      const b = h<HTMLButtonElement>(`button.mn-item.pz-item${cls}`, { type: 'button' }, h('span.mn-ic', icon(ic)), h('span.mn-lbl', h('span.mn-name', label)), h('span.mn-arrow', icon('chevron-right')));
      b.addEventListener('mouseenter', () => this.ui.sound('hover'));
      b.addEventListener('click', () => { this.ui.sound('click'); fn(); });
      return b;
    };
    const stats = ctx ? h('div.pz-stats',
      h('div', h('span.label', 'Cash'), h('b.mono', money(ctx.state.company.money))),
      h('div', h('span.label', 'Day'), h('b.mono', String(ctx.state.time.day))),
      h('div', h('span.label', 'Played'), h('b.mono', duration(ctx.state.meta.playTimeSec)))) : null;
    this.body.append(
      h('div.pz-logo', logoBlock(false)),
      stats ?? '',
      h('div.mn-nav.pz-nav',
        item('play', 'Resume', () => this.ui.closeAll(), '.primary'),
        item('save', 'Save Game', () => void this.save()),
        item('load', 'Load Game', () => this.ui.open('load', {}, { stack: true })),
        item('settings', 'Settings', () => this.ui.open('settings', {}, { stack: true })),
        item('book', 'How to Play', () => this.ui.open('help', {}, { stack: true })),
        item('logout', 'Quit to Menu', () => void this.quit())));
  }

  private async save() {
    try {
      await this.ui.app.saveGame();
      this.ui.toast('success', 'Game saved', this.ui.ctx?.state.meta.saveName, { icon: 'save' });
    } catch (err) {
      this.ui.toast('danger', 'Save failed', String((err as Error)?.message ?? err));
    }
  }

  private async quit() {
    const ok = await this.ui.confirm({ title: 'Quit to main menu?', text: 'Your progress will be autosaved before returning to the main menu.', confirm: 'Quit', icon: 'logout' });
    if (!ok) return;
    this.pausedByUs = false;
    this.ui.closeAll();
    try {
      await this.ui.app.quitToMenu();
    } catch (err) {
      console.error(err);
    }
  }

  destroy() {
    const ctx = this.ui.ctx;
    if (this.pausedByUs && ctx && ctx.state.time.paused) ctx.commands.dispatch({ type: 'time/setPaused', paused: false });
  }
}
