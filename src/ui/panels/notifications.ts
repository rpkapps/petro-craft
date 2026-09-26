// Notifications log: every message the company received, filterable by level, with "locate" links.
import { h, setText, toggleClass, KeyedList } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, emptyState, segmented } from '../core/components';
import type { Notification, NotificationLevel } from '../../core/types';
import { dayLabel, formatClock } from '../format';
import { markNotificationsSeen } from '../game';

type Filter = 'all' | NotificationLevel;
const LEVEL_ICON: Record<NotificationLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', danger: 'danger' };

export class NotificationsPanel extends Panel {
  readonly id = 'notifications' as const;
  private filter: Filter = 'all';
  private list!: KeyedList<Notification>;
  private empty!: HTMLElement;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Messages', 'bell', 'md');
  }

  protected build() {
    const st = this.ui.game.state;
    const seg = segmented<Filter>([{ value: 'all', label: 'All' }, { value: 'danger', label: 'Critical' }, { value: 'warning', label: 'Warnings' }, { value: 'success', label: 'Success' }, { value: 'info', label: 'Info' }], this.filter, (v) => { this.ui.sound('click'); this.filter = v; this.update(); });
    this.tabsEl.appendChild(seg.el);
    const box = h('div.nt-list');
    this.list = new KeyedList<Notification>(box, (n) => n.id, (n) => {
      const node = h(`div.nt-row.lv-${n.level}`,
        h('div.nt-ic', icon(LEVEL_ICON[n.level])),
        h('div.col.grow', { style: 'gap:.1rem;min-width:0' }, h('b', n.title), n.text ? h('span.small.dim', n.text) : null),
        h('div.col', { style: 'gap:.2rem;align-items:flex-end' },
          h('span.tiny.dim.mono', `${dayLabel(st, n.day)} ${formatClock(n.minute)}`),
          n.at ? button('Locate', { icon: 'crosshair', size: 'xs', onClick: () => { this.ui.closeAll(); this.ui.game.bus.emit('ui:focus', { at: n.at! }); } }) : null));
      return { node, update: () => {} };
    });
    this.empty = emptyState('bell', 'No messages');
    this.body.append(box, this.empty);
    markNotificationsSeen(st);
  }

  update() {
    const st = this.ui.game.state;
    const rows = st.notifications.filter((n) => this.filter === 'all' || n.level === this.filter).slice().reverse();
    this.list.sync(rows);
    toggleClass(this.empty, 'hidden', rows.length > 0);
    setText(this.subEl, `${st.notifications.length} messages`);
    markNotificationsSeen(st);
  }
}
