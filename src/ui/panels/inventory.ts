// Inventory (E): 36-slot grid with drag & drop and click-to-move, block shop and company warehouse supplies.
import { h, clear, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, tabs, type TabsCtl } from '../core/components';
import { INVENTORY_SLOTS, HOTBAR_SLOTS } from '../../core/constants';
import { BLOCK_BY_KEY } from '../../core/blocks';
import { ITEMS, SUPPLY_IDS } from '../../content/items';
import { itemIconEl, itemName } from '../render/itemIcons';
import { localPlayer } from '../game';
import { money, int, compact } from '../format';
import { tipBody } from '../core/tooltip';
import type { InventorySlot } from '../../core/types';
import { SHOP_BLOCKS, supplyPrice } from '../../sim/economy';

type Tab = 'inventory' | 'shop' | 'warehouse';

const SUPPLY_USE: Record<string, string> = {
  drill_pipe: 'Consumed while drilling', casing: 'Run at every casing point', cement: 'Casing cement jobs', drilling_mud: 'Circulating system & kicks',
  barite: 'Weighting up during a kick', drill_bit: 'Replaced when worn', proppant: 'Hydraulic fracturing', chemicals: 'Production & water treatment',
  spare_parts: 'Maintenance and repairs', steel: 'Large facility construction',
};

let lastTab: Tab = 'inventory';

export class InventoryPanel extends Panel {
  readonly id = 'inventory' as const;
  private tab: Tab = lastTab;
  private tabCtl!: TabsCtl<Tab>;
  private content!: HTMLElement;
  private slots: { el: HTMLElement; ic: HTMLElement; count: HTMLElement; item: string | null }[] = [];
  private picked: number | null = null;
  private detail!: HTMLElement;
  private supplyRows = new Map<string, { stock: HTMLElement }>();
  private cash!: HTMLElement;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Inventory', 'inventory', 'lg');
    if (typeof args.tab === 'string') this.tab = args.tab as Tab;
  }

  protected build() {
    this.tabCtl = tabs<Tab>([
      { value: 'inventory', label: 'Backpack', icon: 'inventory' },
      { value: 'shop', label: 'Block Shop', icon: 'cube' },
      { value: 'warehouse', label: 'Warehouse', icon: 'building' },
    ], this.tab, (v) => { this.ui.sound('click'); this.tab = v; lastTab = v; this.render(); });
    this.tabsEl.appendChild(this.tabCtl.el);
    this.cash = h('span.mono.accent');
    this.actionsEl.append(h('div.bd-cash', icon('coin'), this.cash));
    this.content = h('div.inv-content');
    this.body.appendChild(this.content);
    this.render();
  }

  private render() {
    clear(this.content);
    this.slots = [];
    this.picked = null;
    this.supplyRows.clear();
    if (this.tab === 'inventory') this.renderInventory();
    else if (this.tab === 'shop') this.renderShop();
    else this.renderWarehouse();
    this.update();
  }

  // ---- backpack ------------------------------------------------------------------------------
  private renderInventory() {
    const main = h('div.inv-grid');
    const hot = h('div.inv-grid.hotbar');
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const ic = h('div.hb-ic');
      const count = h('div.hb-count.mono');
      const el = h('div.inv-slot', { draggable: true, dataset: { idx: String(i) } }, ic, count, i < HOTBAR_SLOTS ? h('span.hb-key', String(i + 1)) : null);
      const idx = i;
      el.addEventListener('dragstart', (e) => {
        const s = this.inv()[idx];
        if (!s) { e.preventDefault(); return; }
        e.dataTransfer?.setData('text/plain', String(idx));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
        this.ui.tooltip.hide();
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const from = Number(e.dataTransfer?.getData('text/plain'));
        if (Number.isFinite(from) && from !== idx) this.move(from, idx);
      });
      el.addEventListener('click', () => {
        if (this.picked === null) {
          if (!this.inv()[idx]) return;
          this.picked = idx;
          this.ui.sound('click');
        } else {
          if (this.picked !== idx) this.move(this.picked, idx);
          this.picked = null;
        }
        this.update();
      });
      el.addEventListener('mouseenter', () => this.showDetail(idx));
      this.ui.tooltip.attach(el, () => {
        const s = this.inv()[idx];
        return s ? tipBody(itemName(s.item), `× ${s.count}`, ITEMS[s.item]?.description) : null;
      });
      this.slots.push({ el, ic, count, item: null });
      (i < HOTBAR_SLOTS ? hot : main).appendChild(el);
    }
    this.detail = h('div.inv-detail.card');
    this.content.append(h('div.inv-layout',
      h('div.col', { style: 'gap:.8rem' },
        h('div.section-title', icon('inventory'), 'Backpack'), main,
        h('div.section-title', icon('menu'), 'Hotbar'), hot,
        h('div.tiny.dim', 'Drag items between slots, or click one slot and then another to swap them.')),
      this.detail));
    this.showDetail(localPlayer(this.ui.game)?.selectedSlot ?? 0);
  }

  private inv(): (InventorySlot | null)[] {
    return localPlayer(this.ui.game)?.inventory ?? [];
  }

  private move(from: number, to: number) {
    const r = this.ui.dispatch({ type: 'player/moveItem', from, to });
    if (r.ok) this.ui.sound('click');
    this.update();
    this.showDetail(to);
  }

  private showDetail(idx: number) {
    if (!this.detail) return;
    clear(this.detail);
    const s = this.inv()[idx];
    if (!s) {
      this.detail.append(h('div.empty', icon('inventory'), h('div', 'Empty slot'), h('div.tiny', `Slot ${idx + 1}${idx < HOTBAR_SLOTS ? ' · hotbar' : ''}`)));
      return;
    }
    const it = ITEMS[s.item];
    const blk = s.item.startsWith('block:') ? BLOCK_BY_KEY[s.item.slice(6)] : undefined;
    this.detail.append(
      h('div.inv-big', itemIconEl(s.item)),
      h('div.inv-dname', itemName(s.item)),
      h('div.dim.small', it ? `${it.kind === 'tool' ? 'Tool' : it.kind} · ${s.count} ${it.unit}` : blk ? `Block · ${s.count} in stack` : ''),
      h('p.inv-ddesc', it?.description ?? (blk?.pipe ? `Pipeline block for the ${blk.pipe} network. Connects to adjacent same-type pipes and building ports.` : blk ? 'Building block. Select it on the hotbar and right-click to place.' : '')),
      idx < HOTBAR_SLOTS ? button('Select on hotbar', { icon: 'check', size: 'sm', onClick: () => { this.ui.dispatch({ type: 'player/selectSlot', slot: idx }); this.ui.sound('click'); } }) : '',
    );
  }

  // ---- block shop ----------------------------------------------------------------------------
  private renderShop() {
    const group = (key: string, industrial: boolean) => (key.startsWith('pipe_') ? 'Pipelines' : industrial ? 'Industrial' : 'Natural & decorative');
    const groups = new Map<string, typeof SHOP_BLOCKS>();
    for (const s of SHOP_BLOCKS) {
      const g = group(s.key, s.industrial);
      groups.set(g, [...(groups.get(g) ?? []), s]);
    }
    const wrap = h('div.col', { style: 'gap:1rem' });
    for (const g of ['Pipelines', 'Industrial', 'Natural & decorative']) {
      const items = groups.get(g);
      if (!items?.length) continue;
      const grid = h('div.shop-grid');
      for (const s of items) {
        const def = BLOCK_BY_KEY[s.key];
        if (!def) continue;
        const buy = (n: number) => {
          const r = this.ui.dispatch({ type: 'market/buy', item: s.item, quantity: n }, { successSound: 'cash' });
          if (r.ok) this.ui.toast('success', `Bought ${n} × ${def.name}`, undefined, { icon: 'cube', ttl: 3 });
        };
        grid.appendChild(h('div.card.shop-card',
          h('div.shop-ic', itemIconEl(s.item)),
          h('div.col.grow', { style: 'gap:.1rem;min-width:0' }, h('div.shop-name.ellipsis', s.name), h('div.mono.small.accent', `${money(s.price)} / block`)),
          h('div.shop-buy', button('16', { size: 'xs', title: `Buy 16 for ${money(s.price * 16)}`, onClick: () => buy(16) }), button('64', { size: 'xs', variant: 'primary', title: `Buy 64 for ${money(s.price * 64)}`, onClick: () => buy(64) }))));
      }
      wrap.append(h('div.section-title', g), grid);
    }
    this.content.appendChild(wrap);
  }

  // ---- warehouse supplies --------------------------------------------------------------------
  private renderWarehouse() {
    const st = this.ui.game.state;
    const yard = Object.values(st.buildings).some((b) => b.type === 'warehouse' && b.constructionProgress >= 1 && b.enabled);
    const grid = h('div.sup-grid');
    for (const id of SUPPLY_IDS) {
      const it = ITEMS[id];
      const unit = supplyPrice(st, id) || it.basePrice;
      const stock = h('span.mono');
      const buy = (n: number) => {
        const r = this.ui.dispatch({ type: 'market/buy', item: id, quantity: n }, { successSound: 'cash' });
        if (r.ok) this.ui.toast('success', `Ordered ${int(n)} ${it.unit} ${it.name}`, undefined, { icon: 'truck', ttl: 3 });
      };
      const lot = it.basePrice >= 5000 ? [1, 5] : it.basePrice >= 500 ? [10, 50] : [100, 1000];
      grid.appendChild(h('div.card.sup-card',
        h('div.shop-ic', itemIconEl(id)),
        h('div.col.grow', { style: 'gap:.1rem;min-width:0' },
          h('div.shop-name', it.name),
          h('div.tiny.dim', SUPPLY_USE[id] ?? it.description),
          h('div.row', { style: 'gap:.8rem' }, h('span.small', h('span.dim', 'Stock '), stock, h('span.dim', ` ${it.unit}`)), h('span.small.mono.accent', `${money(unit)}/${it.unit}`))),
        h('div.shop-buy.col', { style: 'gap:.25rem' }, ...lot.map((n, i) => button(`+${compact(n)}`, { size: 'xs', variant: i ? 'primary' : '', title: `Order ${int(n)} ${it.unit} for ${money(unit * n)}`, onClick: () => buy(n) })))));
      this.supplyRows.set(id, { stock });
    }
    this.content.append(
      yard ? h('div.banner.ok', icon('check'), h('span', h('b', 'Supply Yard active'), ' — bulk discount of 20% applied to all supplies.')) : h('div.banner.info', icon('info'), h('span', 'Build a ', h('b', 'Supply Yard'), ' to buy supplies 20% cheaper. Emergency deliveries are charged at list price.')),
      h('div', { style: 'height:.8rem' }),
      grid);
  }

  update() {
    const st = this.ui.game.state;
    setText(this.cash, money(st.company.money));
    if (this.tab === 'inventory') {
      const inv = this.inv();
      const p = localPlayer(this.ui.game);
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        const it = inv[i];
        const item = it?.item ?? null;
        if (item !== s.item) {
          s.item = item;
          s.ic.replaceChildren(item ? itemIconEl(item) : '');
        }
        setText(s.count, it && it.count > 1 ? String(it.count) : '');
        toggleClass(s.el, 'picked', this.picked === i);
        toggleClass(s.el, 'sel', p?.selectedSlot === i);
        toggleClass(s.el, 'empty', !it);
      }
    } else if (this.tab === 'warehouse') {
      for (const [id, r] of this.supplyRows) setText(r.stock, int(st.company.warehouse[id] ?? 0));
    }
  }
}
