// Registers every panel factory with the panel manager.
import type { PanelManager } from '../core/panel';
import { NewGamePanel } from './newGame';
import { LoadPanel, CreditsPanel } from './saves';
import { PausePanel } from './pause';
import { SettingsPanel } from './settings';
import { HelpPanel } from './help';

export function registerPanels(pm: PanelManager) {
  pm.register('newgame', (ui, a) => new NewGamePanel(ui, a));
  pm.register('load', (ui, a) => new LoadPanel(ui, a));
  pm.register('credits', (ui, a) => new CreditsPanel(ui, a));
  pm.register('pause', (ui, a) => new PausePanel(ui, a));
  pm.register('settings', (ui, a) => new SettingsPanel(ui, a));
  pm.register('help', (ui, a) => new HelpPanel(ui, a));
}
