import type { Settings } from './types';

export const DEFAULT_KEYBINDS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', build: 'KeyB', research: 'KeyT', market: 'KeyM', map: 'KeyN', wells: 'KeyJ', workforce: 'KeyH',
  contracts: 'KeyK', finance: 'KeyF', objectives: 'KeyO', xray: 'KeyX', drone: 'KeyV', fly: 'KeyG', rotate: 'KeyR',
  pause: 'Escape', help: 'F1', screenshot: 'F2', hideHud: 'F3', quickSave: 'F5', quickLoad: 'F9', pipeMode: 'KeyP',
  speedUp: 'Period', speedDown: 'Comma', togglePause: 'Backquote', drop: 'KeyQ', inspect: 'KeyI',
};

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8,
  fov: 75,
  mouseSensitivity: 1,
  invertY: false,
  shadows: true,
  shadowQuality: 'medium',
  bloom: true,
  ssao: false,
  clouds: true,
  particles: 'high',
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  uiScale: 1,
  units: 'imperial',
  autosaveMinutes: 5,
  showFps: false,
  renderScale: 1,
  autoQuality: true,
  antialias: true,
  brightness: 1,
  textureQuality: 'classic',
  keybinds: { ...DEFAULT_KEYBINDS },
};

const KEY = 'petrocraft.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SETTINGS), ...parsed, keybinds: { ...DEFAULT_KEYBINDS, ...(parsed.keybinds ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
