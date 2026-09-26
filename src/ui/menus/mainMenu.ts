// Main menu screen: cinematic background, stylised logo and the primary navigation.
import { h, setText, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import type { SaveSlotInfo } from '../../core/client';
import type { UIHost } from '../core/host';
import { money, timeAgo } from '../format';
import type { MenuBackground } from './menuBackground';

let logoSeq = 0;

export function logoBlock(big = true): HTMLElement {
  const u = `lg${++logoSeq}`;
  const drop = document.createElement('div');
  drop.className = 'lg-mark';
  drop.innerHTML = `<svg viewBox="0 0 64 72"><defs>
    <linearGradient id="${u}A" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd29a"/><stop offset=".55" stop-color="#ff8a1f"/><stop offset="1" stop-color="#b54a00"/></linearGradient>
    <linearGradient id="${u}B" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4452"/><stop offset="1" stop-color="#11161d"/></linearGradient>
    <radialGradient id="${u}C" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <path d="M32 2 61 18.5v35L32 70 3 53.5v-35z" fill="url(#${u}B)" stroke="url(#${u}A)" stroke-width="2.5"/>
    <path d="M32 14c7.5 9.4 12.3 16 12.3 22.3a12.3 12.3 0 0 1-24.6 0C19.7 30 24.5 23.4 32 14z" fill="url(#${u}A)"/>
    <path d="M32 14c7.5 9.4 12.3 16 12.3 22.3a12.3 12.3 0 0 1-24.6 0C19.7 30 24.5 23.4 32 14z" fill="url(#${u}C)"/>
    <path d="M26 38.5a6 6 0 0 0 5.5 5.5" stroke="#fff" stroke-opacity=".75" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M14 58h36" stroke="#ff8a1f" stroke-opacity=".5" stroke-width="1.5"/></svg>`;
  return h(`div.pc-logo${big ? '.big' : ''}`,
    drop,
    h('div.lg-text',
      h('div.lg-word', { dataset: { text: 'PETROCRAFT' } }, h('span.lg-petro', 'PETRO'), h('span.lg-craft', 'CRAFT')),
      h('div.lg-sub', h('i'), 'Oil & Gas Industrial Simulation', h('i'))));
}

export class MainMenu {
  readonly el: HTMLElement;
  private continueBtn: HTMLButtonElement;
  private continueSub: HTMLElement;
  private latest: SaveSlotInfo | null = null;
  private bgHost: HTMLElement;

  constructor(private ui: UIHost, private bg: MenuBackground) {
    this.continueSub = h('span.mn-sub');
    this.continueBtn = this.item('play', 'Continue', () => {
      if (this.latest) void this.load(this.latest.slot);
    }, this.continueSub, true);
    const nav = h('nav.mn-nav',
      this.continueBtn,
      this.item('plus', 'New Game', () => ui.open('newgame')),
      this.item('load', 'Load Game', () => ui.open('load')),
      this.item('settings', 'Settings', () => ui.open('settings')),
      this.item('book', 'How to Play', () => ui.open('help')),
      this.item('users', 'Credits', () => ui.open('credits')));
    this.bgHost = h('div.mn-bghost');
    this.el = h('div.pc-menu',
      this.bgHost,
      h('div.mn-vignette'),
      h('div.mn-grain'),
      h('div.mn-content', logoBlock(true), nav),
      h('footer.mn-footer',
        h('span', 'PetroCraft · Early Access Build 0.1'),
        h('span.sp'),
        h('span.mn-tip', icon('bulb'), 'Tip: seismic first, drill second — dry holes are expensive.')));
  }

  private item(ic: IconName, label: string, onClick: () => void, sub?: HTMLElement, primary = false): HTMLButtonElement {
    const b = h<HTMLButtonElement>(`button.mn-item${primary ? '.primary' : ''}`, { type: 'button' },
      h('span.mn-ic', icon(ic)),
      h('span.mn-lbl', h('span.mn-name', label), sub ?? null),
      h('span.mn-arrow', icon('chevron-right')));
    b.addEventListener('mouseenter', () => this.ui.sound('hover'));
    b.addEventListener('click', () => {
      this.ui.sound('click');
      onClick();
    });
    return b;
  }

  private async load(slot: string) {
    try {
      await this.ui.app.loadGame(slot);
    } catch (err) {
      console.error(err);
      this.ui.toast('danger', 'Could not load save', String((err as Error)?.message ?? err));
      this.ui.app.quitToMenu().catch(() => {});
    }
  }

  show() {
    this.bgHost.appendChild(this.bg.canvas);
    this.bg.dim = 0;
    this.bg.start();
    this.el.classList.add('show');
    void this.refresh();
  }

  hide() {
    this.el.classList.remove('show');
  }

  async refresh() {
    let saves: SaveSlotInfo[] = [];
    try {
      saves = await this.ui.app.listSaves();
    } catch {
      saves = [];
    }
    saves.sort((a, b) => b.savedAt - a.savedAt);
    this.latest = saves[0] ?? null;
    toggleClass(this.continueBtn, 'hidden', !this.latest);
    if (this.latest) setText(this.continueSub, `${this.latest.companyName} · Day ${this.latest.day} · ${money(this.latest.money)} · ${timeAgo(this.latest.savedAt)}`);
  }
}
