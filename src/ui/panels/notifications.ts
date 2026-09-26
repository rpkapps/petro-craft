// Notifications log: every message the company received, filterable by level, with "locate" links.
// Read state lives in GameState (notification.read, persisted): rows are marked read via the
// 'notifications/markRead' command as they scroll into view; "Mark all read" clears the rest.
import { h, setText, toggleClass, KeyedList } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, emptyState, segmented, setDisabled } from '../core/components';
import type { Notification, NotificationLevel } from '../../core/types';
import { dayLabel, formatClock } from '../format';

type Filter = 'all' | NotificationLevel;
const LEVEL_ICON: Record<NotificationLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', danger: 'danger' };

export class NotificationsPanel extends Panel {
  readonly id = 'notifications' as const;
  private filter: Filter = 'all';
  private list!: KeyedList<Notification>;
  private empty!: HTMLElement;
  private markAll!: HTMLButtonElement;
  /** Messages that were unread when first shown in this viewing session (highlighted as "new"). */
  private fresh = new Set<string>();
  /** Ids that became visible and still need to be marked read. */
  private seen = new Set<string>();
  private observer: IntersectionObserver | null = null;
  private rowIds = new WeakMap<Element, string>();

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Messages', 'bell', 'md');
  }

  protected build() {
    const st = this.ui.game.state;
    const seg = segmented<Filter>([{ value: 'all', label: 'All' }, { value: 'danger', label: 'Critical' }, { value: 'warning', label: 'Warnings' }, { value: 'success', label: 'Success' }, { value: 'info', label: 'Info' }], this.filter, (v) => { this.ui.sound('click'); this.filter = v; this.update(); });
    this.tabsEl.appendChild(seg.el);
    this.markAll = button('Mark all read', { icon: 'check', size: 'sm', onClick: () => this.markAllRead() });
    this.actionsEl.appendChild(this.markAll);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = this.rowIds.get(e.target);
          if (id) this.seen.add(id);
        }
      }, { root: this.body, threshold: 0.6 });
    }
    const box = h('div.nt-list');
    this.list = new KeyedList<Notification>(box, (n) => n.id, (n) => {
      if (!n.read) this.fresh.add(n.id);
      const node = h(`div.nt-row.lv-${n.level}`,
        h('div.nt-ic', icon(LEVEL_ICON[n.level])),
        h('div.col.grow', { style: 'gap:.1rem;min-width:0' }, h('div.row', { style: 'gap:.45rem' }, h('b', n.title), h('span.nt-new', 'New')), n.text ? h('span.small.dim', n.text) : null),
        h('div.col', { style: 'gap:.2rem;align-items:flex-end' },
          h('span.tiny.dim.mono', `${dayLabel(st, n.day)} ${formatClock(n.minute)}`),
          n.at ? button('Locate', { icon: 'crosshair', size: 'xs', onClick: () => { this.ui.closeAll(); this.ui.game.bus.emit('ui:focus', { at: n.at! }); } }) : null));
      this.rowIds.set(node, n.id);
      this.observer?.observe(node);
      return { node, update: (x) => toggleClass(node, 'new', this.fresh.has(x.id)) };
    });
    this.empty = emptyState('bell', 'No messages');
    this.body.append(box, this.empty);
  }

  update() {
    const st = this.ui.game.state;
    const rows = st.notifications.filter((n) => this.filter === 'all' || n.level === this.filter).slice().reverse();
    this.list.sync(rows);
    toggleClass(this.empty, 'hidden', rows.length > 0);
    // Without IntersectionObserver every listed row counts as viewed.
    if (!this.observer) for (const n of rows) this.seen.add(n.id);
    this.flushSeen();
    let unread = 0;
    for (const n of st.notifications) if (!n.read) unread++;
    setText(this.subEl, unread ? `${st.notifications.length} messages · ${unread} unread` : `${st.notifications.length} messages`);
    setDisabled(this.markAll, unread === 0);
  }

  private flushSeen() {
    if (!this.seen.size) return;
    const st = this.ui.game.state;
    const ids: string[] = [];
    for (const n of st.notifications) if (!n.read && this.seen.has(n.id)) ids.push(n.id);
    this.seen.clear();
    if (ids.length) this.ui.dispatch({ type: 'notifications/markRead', ids }, { quiet: true });
  }

  private markAllRead() {
    this.ui.sound('click');
    this.ui.dispatch({ type: 'notifications/markRead' }, { quiet: true });
    this.update();
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
  }
}
