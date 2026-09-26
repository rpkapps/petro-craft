// The UI host: the services every UI component receives (app shell, audio, current game, panels, dialogs).
import type { AppShell } from '../../core/client';
import type { AudioEngine } from '../../audio';
import type { GameContext, NotificationLevel, Settings } from '../../core/types';
import type { GameEvents, UiPanelId } from '../../core/EventBus';
import type { Command, CommandResult, CommandType } from '../../core/commands';
import type { Units } from '../format';
import type { IconName } from '../icons';
import type { Tooltip } from './tooltip';

export type PanelId =
  | 'build' | 'inventory' | 'research' | 'market' | 'contracts' | 'workforce' | 'finance' | 'map' | 'wells' | 'well'
  | 'planner' | 'seismic' | 'inspector' | 'environment' | 'objectives' | 'notifications' | 'pause' | 'settings' | 'help'
  | 'load' | 'newgame' | 'credits';

export type PanelArgs = Record<string, unknown>;
export type UISound = Parameters<AudioEngine['ui']>[0];

export interface ModalAction {
  label: string;
  icon?: IconName;
  variant?: 'primary' | 'danger' | 'teal' | 'ghost' | '';
  /** Return false to keep the modal open. */
  onClick?: () => void | boolean | Promise<void | boolean>;
  disabled?: () => boolean;
}
export interface ModalOptions {
  title: string;
  icon?: IconName;
  body: HTMLElement | string;
  actions?: ModalAction[];
  width?: string;
  danger?: boolean;
  onClose?: () => void;
}
export interface ModalHandle {
  el: HTMLElement;
  close(): void;
  refresh(): void;
}

export interface UIHost {
  readonly app: AppShell;
  readonly audio: AudioEngine;
  readonly root: HTMLElement;
  /** Current game (null in menus). */
  readonly ctx: GameContext | null;
  /** Current game; throws when no game is attached (use inside in-game panels only). */
  readonly game: GameContext;
  readonly units: Units;
  readonly tooltip: Tooltip;
  sound(name: UISound): void;
  open(id: PanelId, args?: PanelArgs, opts?: { stack?: boolean }): void;
  close(id?: PanelId): void;
  closeAll(): void;
  toggle(id: PanelId, args?: PanelArgs): void;
  isOpen(id: PanelId): boolean;
  toast(level: NotificationLevel, title: string, text?: string, opts?: { icon?: IconName; onClick?: () => void; ttl?: number }): void;
  modal(opts: ModalOptions): ModalHandle;
  confirm(opts: { title: string; text: string; confirm?: string; danger?: boolean; icon?: IconName }): Promise<boolean>;
  /** Dispatch a command on the current game; plays feedback sounds. */
  dispatch<K extends CommandType>(cmd: Command<K>, opts?: { quiet?: boolean; successSound?: UISound }): CommandResult;
  /** Announce an in-panel view on the bus as 'ui:open' (e.g. the map's lease layer → 'leases'); not re-handled by the UI. */
  notifyView(panel: UiPanelId, args?: PanelArgs): void;
  /** Apply settings through the app shell and refresh settings-dependent UI (works in menus too). */
  applySettings(p: Partial<Settings>): void;
  /** Subscribe to the current game's bus; auto-unsubscribed when the game detaches. */
  listen<K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void): () => void;
}
