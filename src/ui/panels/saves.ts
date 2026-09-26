// Load Game dialog: save slots grid with thumbnails; load, delete, export and import.
import { h, clear, downloadBlob } from '../dom';
import { icon } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { button, chip, emptyState } from '../core/components';
import type { SaveSlotInfo } from '../../core/client';
import { duration, money, timeAgo, titleCase } from '../format';

export class LoadPanel extends Panel {
  readonly id = 'load' as const;
  private grid!: HTMLElement;
  private fileIn!: HTMLInputElement;

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Load Game', 'load', 'lg');
    this.setSubtitle('Saved companies on this device');
  }

  protected build() {
    this.fileIn = h<HTMLInputElement>('input', { type: 'file', accept: '.pcsave,.json,.gz,application/octet-stream', style: 'display:none' });
    this.fileIn.addEventListener('change', () => void this.importFile());
    this.actionsEl.append(
      button('Import', { icon: 'upload', size: 'sm', onClick: () => { this.ui.sound('click'); this.fileIn.click(); } }),
      button(null, { icon: 'refresh', size: 'sm', title: 'Refresh', onClick: () => { this.ui.sound('click'); void this.refresh(); } }),
      this.fileIn);
    this.grid = h('div.sv-grid');
    this.body.appendChild(this.grid);
    void this.refresh();
  }

  private async refresh() {
    let saves: SaveSlotInfo[] = [];
    try {
      saves = await this.ui.app.listSaves();
    } catch (err) {
      console.error(err);
    }
    saves.sort((a, b) => b.savedAt - a.savedAt);
    clear(this.grid);
    if (!saves.length) {
      this.grid.appendChild(h('div', { style: 'grid-column: 1 / -1' }, emptyState('save', 'No saved games yet', 'Start a new game — it autosaves every few minutes.')));
      return;
    }
    for (const s of saves) this.grid.appendChild(this.card(s));
  }

  private card(s: SaveSlotInfo): HTMLElement {
    const special = s.slot === 'autosave' ? chip('Autosave', 'teal') : s.slot === 'quicksave' ? chip('Quicksave', 'accent') : null;
    const thumb = h('div.sv-thumb', s.thumbnail ? h('img', { src: s.thumbnail, alt: '', draggable: false }) : h('div.sv-noimg', icon('pumpjack')), special ? h('div.sv-slot', special) : null);
    const load = button('Load', { icon: 'play', variant: 'primary', size: 'sm', onClick: (e) => { e.stopPropagation(); void this.load(s.slot); } });
    const exp = button(null, { icon: 'download', size: 'sm', title: 'Export save file', onClick: (e) => { e.stopPropagation(); void this.export(s); } });
    const del = button(null, { icon: 'trash', size: 'sm', variant: 'danger', title: 'Delete', onClick: (e) => { e.stopPropagation(); void this.remove(s); } });
    const el = h('div.card.hoverable.sv-card',
      thumb,
      h('div.sv-info',
        h('div.sv-name', s.saveName || s.companyName),
        h('div.sv-meta', h('span', icon('building'), s.companyName), h('span', icon('calendar'), `Day ${s.day}`), h('span', icon('coin'), money(s.money))),
        h('div.sv-meta', h('span', icon('clock'), duration(s.playTimeSec)), h('span', icon('map'), `${titleCase(s.worldSize)} · ${titleCase(s.difficulty)}`), h('span', timeAgo(s.savedAt)))),
      h('div.sv-actions', load, h('span.sp'), exp, del));
    el.addEventListener('dblclick', () => void this.load(s.slot));
    el.addEventListener('mouseenter', () => this.ui.sound('hover'));
    return el;
  }

  private async load(slot: string) {
    this.ui.sound('success');
    this.ui.closeAll();
    try {
      await this.ui.app.loadGame(slot);
    } catch (err) {
      console.error(err);
      this.ui.toast('danger', 'Could not load save', String((err as Error)?.message ?? err));
      try { await this.ui.app.quitToMenu(); } catch { /* ignore */ }
    }
  }

  private async remove(s: SaveSlotInfo) {
    const ok = await this.ui.confirm({ title: 'Delete save?', text: `“${s.saveName || s.companyName}” (day ${s.day}) will be permanently deleted.`, confirm: 'Delete', danger: true, icon: 'trash' });
    if (!ok) return;
    try {
      await this.ui.app.deleteSave(s.slot);
      this.ui.toast('info', 'Save deleted', s.saveName);
    } catch (err) {
      this.ui.toast('danger', 'Delete failed', String(err));
    }
    void this.refresh();
  }

  private async export(s: SaveSlotInfo) {
    try {
      const blob = await this.ui.app.exportSave(s.slot);
      const safe = (s.saveName || s.companyName || 'petrocraft').replace(/[^\w-]+/g, '_');
      downloadBlob(blob, `${safe}-day${s.day}.pcsave`);
      this.ui.sound('success');
    } catch (err) {
      this.ui.toast('danger', 'Export failed', String(err));
    }
  }

  private async importFile() {
    const f = this.fileIn.files?.[0];
    this.fileIn.value = '';
    if (!f) return;
    try {
      const slot = await this.ui.app.importSave(f);
      this.ui.toast('success', 'Save imported', slot);
      void this.refresh();
    } catch (err) {
      this.ui.toast('danger', 'Import failed', String((err as Error)?.message ?? err));
    }
  }
}

export class CreditsPanel extends Panel {
  readonly id = 'credits' as const;
  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'Credits', 'users', 'sm');
  }
  protected build() {
    const sec = (t: string, ...lines: string[]) => h('div', h('h4', t), ...lines.map((l) => h('p', l)));
    this.body.appendChild(h('div.credits',
      sec('PetroCraft', 'A voxel oil & gas industrial simulation'),
      sec('Engineering', 'World & geology · Rendering · Entities & FX', 'Player & interaction · Upstream simulation', 'Facilities & networks · Economy · Audio · Interface'),
      sec('Technology', 'three.js · TypeScript · Vite · simplex-noise · fflate'),
      sec('Art & Audio', 'Everything you see and hear is generated procedurally at runtime.'),
      sec('Thanks', 'To roughnecks, geoscientists and engineers everywhere.')));
  }
}
