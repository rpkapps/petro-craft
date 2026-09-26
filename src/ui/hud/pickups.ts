// Item pickup feed next to the hotbar: "+N Item" chips that merge repeated pickups of the same item.
import { h, setText } from '../dom';
import { itemIconEl, itemName } from '../render/itemIcons';

const TTL = 2.6;
const MAX = 5;

interface Entry { item: string; count: number; ttl: number; el: HTMLElement; num: HTMLElement }

export class PickupFeed {
  readonly el: HTMLElement;
  private items: Entry[] = [];

  constructor() {
    this.el = h('div.hb-pickups');
  }

  push(item: string, count: number) {
    if (!(count > 0)) return;
    const cur = this.items.find((e) => e.item === item && e.ttl > 0.3);
    if (cur) {
      cur.count += count;
      cur.ttl = TTL;
      setText(cur.num, `+${cur.count}`);
      // The most recent pickup sits closest to the hotbar.
      this.items = this.items.filter((x) => x !== cur);
      this.items.push(cur);
      this.el.appendChild(cur.el);
      cur.el.classList.remove('bump');
      void cur.el.offsetWidth;
      cur.el.classList.add('bump');
      return;
    }
    const num = h('span.pk-n.mono', `+${count}`);
    const el = h('div.pk-item', h('span.pk-ic', itemIconEl(item)), num, h('span.pk-name', itemName(item)));
    const e: Entry = { item, count, ttl: TTL, el, num };
    this.el.appendChild(el);
    this.items.push(e);
    while (this.items.length > MAX) this.drop(this.items[0]);
  }

  update(dt: number) {
    for (const e of [...this.items]) {
      e.ttl -= dt;
      if (e.ttl <= 0) this.drop(e);
    }
  }

  private drop(e: Entry) {
    this.items = this.items.filter((x) => x !== e);
    e.el.classList.add('leaving');
    window.setTimeout(() => e.el.remove(), 240);
  }
}
