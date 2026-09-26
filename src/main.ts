import { App } from './core/App';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const app = new App(canvas, uiRoot);
app.start();
