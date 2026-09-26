// Hotbar (9 slots) with item icons, counts, selection highlight, health bar and item-name toast.
import { h, setText, toggleClass, setBar, bar } from '../dom';
import { HOTBAR_SLOTS } from '../../core/constants';
import type { GameContext, InventorySlot } from '../../core/types';
import type { UIHost } from '../core/host';
import { itemIconEl, itemName } from '../render/itemIcons';
import { localPlayer } from '../game';
import { icon } from '../icons';
import { ITEMS } from '../../content/items';
import { tipBody } from '../core/tooltip';

export class Hotbar {
  readonly el: HTMLElement;
  private slots: { el: HTMLElement; icon: HTMLElement; count: HTMLElement; item: string | null }[] = [];
  private nameToast: HTMLElement;
  private nameTimer = 0;
  private lastSel = -1;
  private lastItem = '';
  private health: HTMLElement;
  private healthTxt: HTMLElement;
  private healthWrap: HTMLElement;

  constructor(private ui: UIHost, private ctx: GameContext) {
    const row = h('div.hb-row');
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const ic = h('div.hb-ic');
      const count = h('div.hb-count.mono');
      const el = h('button.hb-slot', { type: 'button' }, h('span.hb-key', String(i + 1)), ic, count);
      el.addEventListener('click', () => {
        this.ui.dispatch({ type: 'player/selectSlot', slot: i }, { quiet: true });
        this.ui.sound('click');
      });
      const idx = i;
      ui.tooltip.attach(el, () => {
        const s = localPlayer(this.ctx)?.inventory[idx];
        if (!s) return null;
        return tipBody(itemName(s.item), s.count > 1 ? `× ${s.count}` : undefined, ITEMS[s.item]?.description ?? (s.item.startsWith('block:') ? 'Building block — place with right click.' : undefined));
      });
      row.appendChild(el);
      this.slots.push({ el, icon: ic, count, item: null });
    }
    this.nameToast = h('div.hb-name');
    this.health = bar(1, 'danger', 'hb-health-bar');
    this.healthTxt = h('span.mono');
    this.healthWrap = h('div.hb-health', icon('heart'), this.health, this.healthTxt);
    this.el = h('div.pc-hotbar', this.nameToast, this.healthWrap, row);
  }

  update(dt: number) {
    const p = localPlayer(this.ctx);
    if (!p) return;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const inv: InventorySlot | null = p.inventory[i] ?? null;
      const item = inv?.item ?? null;
      if (item !== s.item) {
        s.item = item;
        s.icon.replaceChildren(item ? itemIconEl(item) : '');
      }
      setText(s.count, inv && inv.count > 1 ? String(inv.count) : '');
      toggleClass(s.el, 'sel', p.selectedSlot === i);
      toggleClass(s.el, 'empty', !inv);
    }
    const sel = p.inventory[p.selectedSlot];
    const selItem = sel?.item ?? '';
    if (p.selectedSlot !== this.lastSel || selItem !== this.lastItem) {
      const first = this.lastSel === -1;
      this.lastSel = p.selectedSlot;
      this.lastItem = selItem;
      if (!first && selItem) {
        setText(this.nameToast, itemName(selItem));
        this.nameToast.classList.remove('show');
        void this.nameToast.offsetWidth;
        this.nameToast.classList.add('show');
        this.nameTimer = 1.8;
      }
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.nameToast.classList.remove('show');
    }
    const hp = Math.max(0, Math.min(100, p.health));
    setBar(this.health, hp / 100);
    setText(this.healthTxt, `${Math.round(hp)}`);
    toggleClass(this.healthWrap, 'low', hp < 35);
    toggleClass(this.healthWrap, 'full', hp >= 99.5);
  }
}
