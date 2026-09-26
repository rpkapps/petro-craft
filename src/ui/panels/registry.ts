// Registers every panel factory with the panel manager.
import type { PanelManager } from '../core/panel';
import { NewGamePanel } from './newGame';
import { LoadPanel, CreditsPanel } from './saves';
import { PausePanel } from './pause';
import { SettingsPanel } from './settings';
import { HelpPanel } from './help';
import { BuildPanel } from './build';
import { InventoryPanel } from './inventory';
import { ResearchPanel } from './research';
import { MarketPanel } from './market';
import { ContractsPanel } from './contracts';
import { WorkforcePanel } from './workforce';
import { FinancePanel } from './finance';
import { MapPanel } from './map';
import { SeismicPanel } from './seismic';
import { WellsPanel } from './wells';
import { WellPanel } from './well';
import { PlannerPanel } from './planner';
import { InspectorPanel } from './inspector';
import { EnvironmentPanel } from './environment';
import { ObjectivesPanel } from './objectives';
import { NotificationsPanel } from './notifications';

export function registerPanels(pm: PanelManager) {
  pm.register('newgame', (ui, a) => new NewGamePanel(ui, a));
  pm.register('load', (ui, a) => new LoadPanel(ui, a));
  pm.register('credits', (ui, a) => new CreditsPanel(ui, a));
  pm.register('pause', (ui, a) => new PausePanel(ui, a));
  pm.register('settings', (ui, a) => new SettingsPanel(ui, a));
  pm.register('help', (ui, a) => new HelpPanel(ui, a));
  pm.register('build', (ui, a) => new BuildPanel(ui, a));
  pm.register('inventory', (ui, a) => new InventoryPanel(ui, a));
  pm.register('research', (ui, a) => new ResearchPanel(ui, a));
  pm.register('market', (ui, a) => new MarketPanel(ui, a));
  pm.register('contracts', (ui, a) => new ContractsPanel(ui, a));
  pm.register('workforce', (ui, a) => new WorkforcePanel(ui, a));
  pm.register('finance', (ui, a) => new FinancePanel(ui, a));
  pm.register('map', (ui, a) => new MapPanel(ui, a));
  pm.register('seismic', (ui, a) => new SeismicPanel(ui, a));
  pm.register('wells', (ui, a) => new WellsPanel(ui, a));
  pm.register('well', (ui, a) => new WellPanel(ui, a));
  pm.register('planner', (ui, a) => new PlannerPanel(ui, a));
  pm.register('inspector', (ui, a) => new InspectorPanel(ui, a));
  pm.register('environment', (ui, a) => new EnvironmentPanel(ui, a));
  pm.register('objectives', (ui, a) => new ObjectivesPanel(ui, a));
  pm.register('notifications', (ui, a) => new NotificationsPanel(ui, a));
}
