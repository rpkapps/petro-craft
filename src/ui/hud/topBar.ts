// HUD top bar: company, money (tweened with delta pop-ups), date/clock, speed controls, weather,
// commodity ticker, power balance, environment score and research progress.
import { h, setText, toggleClass, setBar, bar, Tween, setStyle } from '../dom';
import { icon, WEATHER_ICON } from '../icons';
import { GAME_SPEEDS } from '../../core/constants';
import { TECHS } from '../../content/tech';
import { ITEMS } from '../../content/items';
import type { GameContext } from '../../core/types';
import type { UIHost } from '../core/host';
import { formatClock, formatGameDate, money, signedMoney, price, signedPct, temperature, windSpeed, power, keyLabel } from '../format';
import { HEADLINE_COMMODITIES, priceChange, priceOf } from '../game';
import { ring, type RingCtl } from '../charts/mini';
import { tipBody } from '../core/tooltip';

const SHORT: Record<string, string> = { crude_oil: 'Crude', dry_gas: 'Gas', gasoline: 'Gasoline' };

export class TopBar {
  readonly el: HTMLElement;
  private moneyVal: HTMLElement;
  private moneyBox: HTMLElement;
  private pops: HTMLElement;
  private moneyTween = new Tween(0, 6);
  private pendingDelta = 0;
  private deltaTimer = 0;
  private company: HTMLElement;
  private rep: HTMLElement;
  private dateEl: HTMLElement;
  private clockEl: HTMLElement;
  private dayEl: HTMLElement;
  private dayIcon: HTMLElement;
  private speedBtns = new Map<number, HTMLButtonElement>();
  private pauseBtn: HTMLButtonElement;
  private weatherIcon: HTMLElement;
  private weatherTemp: HTMLElement;
  private weatherWind: HTMLElement;
  private windArrow: HTMLElement;
  private weatherKind = '';
  private tick = new Map<string, { price: HTMLElement; chg: HTMLElement; arrow: HTMLElement }>();
  private powerBar: HTMLElement;
  private powerTxt: HTMLElement;
  private powerBox: HTMLElement;
  private envRing: RingCtl;
  private envTxt: HTMLElement;
  private resRing: RingCtl;
  private resName: HTMLElement;
  private resPct: HTMLElement;
  private fps: HTMLElement;
  private isDay: boolean | null = null;
  private lastPaused: boolean | null = null;

  constructor(private ui: UIHost, private ctx: GameContext) {
    const kb = ui.app.settings.keybinds;
    // brand
    this.company = h('div.tb-company.ellipsis');
    this.rep = h('div.tb-rep');
    const brand = h('div.tb-brand.tb-sec', h('div.tb-logo', logoMark()), h('div.tb-brand-txt', this.company, this.rep));
    // money
    this.moneyVal = h('div.tb-money-val.mono');
    this.pops = h('div.tb-pops');
    this.moneyBox = h('button.tb-money.tb-sec.tb-click', { type: 'button' }, icon('coin'), h('div.col', { style: 'gap:0' }, h('div.tb-lbl', 'Cash'), this.moneyVal), this.pops);
    this.moneyBox.addEventListener('click', () => { ui.sound('click'); ui.toggle('finance'); });
    ui.tooltip.attach(this.moneyBox, () => {
      const c = this.ctx.state.company;
      return tipBody('Company cash', `Today: ${signedMoney(c.today.revenue - c.today.expenses)}`, `Revenue ${money(c.today.revenue)} · Expenses ${money(c.today.expenses)}. Click for Finance (${keyLabel(kb.finance)}).`);
    });
    // date
    this.dayIcon = h('span.tb-dayicon');
    this.dateEl = h('div.tb-date');
    this.clockEl = h('div.tb-clock.mono');
    this.dayEl = h('div.tb-lbl');
    const date = h('div.tb-datebox.tb-sec', this.dayIcon, h('div.col', { style: 'gap:0' }, this.dayEl, h('div.row', { style: 'gap:.45rem' }, this.dateEl, this.clockEl)));
    // speed
    this.pauseBtn = h<HTMLButtonElement>('button.tb-speed.pause', { type: 'button', title: `Pause (${keyLabel(kb.togglePause)})` }, icon('pause'));
    this.pauseBtn.addEventListener('click', () => {
      this.ui.dispatch({ type: 'time/setPaused', paused: !this.ctx.state.time.paused }, { quiet: true });
      this.ui.sound('click');
    });
    const speeds = h('div.tb-speeds', this.pauseBtn);
    for (const s of GAME_SPEEDS) {
      const b = h<HTMLButtonElement>('button.tb-speed', { type: 'button', title: `${s}× speed` }, `${s}×`);
      b.addEventListener('click', () => {
        this.ui.dispatch({ type: 'time/setSpeed', speed: s }, { quiet: true });
        if (this.ctx.state.time.paused) this.ui.dispatch({ type: 'time/setPaused', paused: false }, { quiet: true });
        this.ui.sound('click');
      });
      this.speedBtns.set(s, b);
      speeds.appendChild(b);
    }
    const speedSec = h('div.tb-sec.tb-speedsec', speeds);
    // weather
    this.weatherIcon = h('span.tb-wicon');
    this.weatherTemp = h('div.tb-temp');
    this.windArrow = h('span.tb-windarrow', icon('nav'));
    this.weatherWind = h('div.tb-wind', this.windArrow, h('span'));
    const weather = h('div.tb-weather.tb-sec', this.weatherIcon, h('div.col', { style: 'gap:0' }, this.weatherTemp, this.weatherWind));
    ui.tooltip.attach(weather, () => {
      const w = this.ctx.state.weather;
      const fc = w.forecast.slice(0, 4).map((f) => h('div.tt-fc', icon(WEATHER_ICON[f.kind] ?? 'cloud'), h('span', `Day ${f.day}`), h('span.dim', `${temperature(f.tempLow, this.ui.units)} / ${temperature(f.tempHigh, this.ui.units)}`)));
      return tipBody(titleWeather(w.current), `${cap(w.season)} · wind ${windSpeed(w.windSpeed, this.ui.units)} · clouds ${Math.round(w.cloudCover * 100)}%`, fc.length ? undefined : 'Build a Weather Station for a multi-day forecast.', fc);
    });
    // ticker
    const ticker = h('button.tb-ticker.tb-sec.tb-click', { type: 'button' });
    for (const id of HEADLINE_COMMODITIES) {
      const p = h('span.tk-price.mono');
      const arrow = h('span.tk-arrow');
      const chg = h('span.tk-chg.mono');
      ticker.appendChild(h('div.tk', h('span.tk-name', SHORT[id] ?? ITEMS[id]?.name ?? id), p, h('span.tk-delta', arrow, chg)));
      this.tick.set(id, { price: p, chg, arrow });
    }
    ticker.addEventListener('click', () => { ui.sound('click'); ui.toggle('market'); });
    ui.tooltip.attach(ticker, `Spot prices vs. yesterday. Click to open the Market (${keyLabel(kb.market)}).`);
    // power
    this.powerBar = bar(0, 'teal', 'thin');
    this.powerTxt = h('div.tb-ptxt.mono');
    this.powerBox = h('div.tb-power.tb-sec', icon('bolt'), h('div.col', { style: 'gap:.2rem' }, this.powerTxt, this.powerBar));
    ui.tooltip.attach(this.powerBox, () => {
      const p = this.ctx.state.power;
      return tipBody('Power grid', `Generation ${power(p.generation)} · Demand ${power(p.demand)}`, p.gridImport > 0 ? `Importing ${power(p.gridImport)} from the utility grid at retail price.` : `Supply satisfaction ${Math.round(p.satisfaction * 100)}%.`);
    });
    // environment
    this.envRing = ring(30, 3.2, '#3ddc84');
    this.envTxt = h('span.tb-ring-txt.mono');
    const env = h('button.tb-env.tb-sec.tb-click', { type: 'button' }, h('div.tb-ring', this.envRing.el, icon('leaf')), h('div.col', { style: 'gap:0' }, h('div.tb-lbl', 'Licence'), this.envTxt));
    env.addEventListener('click', () => { ui.sound('click'); ui.toggle('environment'); });
    ui.tooltip.attach(env, 'Environmental standing with the community and regulator. Click for details.');
    // research
    this.resRing = ring(30, 3.2, '#2ad0e0');
    this.resName = h('div.tb-resname.ellipsis');
    this.resPct = h('div.tb-lbl');
    const research = h('button.tb-research.tb-sec.tb-click', { type: 'button' }, h('div.tb-ring', this.resRing.el, icon('flask')), h('div.col.grow', { style: 'gap:0' }, this.resPct, this.resName));
    research.addEventListener('click', () => { ui.sound('click'); ui.toggle('research'); });
    this.fps = h('div.tb-fps.mono');

    this.el = h('div.pc-topbar.glass.flat',
      h('div.tb-left', brand, this.moneyBox, date, speedSec),
      h('div.tb-right', weather, ticker, this.powerBox, env, research, this.fps));
    this.moneyTween.set(ctx.state.company.money, true);
  }

  onMoney(amount: number) {
    this.pendingDelta += amount;
  }

  frame(dt: number) {
    const c = this.ctx.state.company;
    this.moneyTween.set(c.money);
    const v = this.moneyTween.step(dt);
    setText(this.moneyVal, Math.abs(v) >= 1e7 ? money(v, 2) : `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`);
    toggleClass(this.moneyBox, 'neg', c.money < 0);
    this.deltaTimer += dt;
    if (this.deltaTimer > 0.7) {
      this.deltaTimer = 0;
      if (Math.abs(this.pendingDelta) >= 1) {
        const d = this.pendingDelta;
        this.pendingDelta = 0;
        const pop = h(`div.tb-pop.${d >= 0 ? 'up' : 'down'}.mono`, signedMoney(d));
        this.pops.appendChild(pop);
        while (this.pops.childElementCount > 4) this.pops.firstElementChild?.remove();
        window.setTimeout(() => pop.remove(), 1900);
      }
    }
  }

  update() {
    const st = this.ctx.state;
    const units = this.ui.units;
    setText(this.company, st.company.name);
    setText(this.rep, `Reputation ${Math.round(st.company.reputation)}`);
    // time
    setText(this.dateEl, formatGameDate(st));
    setText(this.clockEl, formatClock(st.time.minuteOfDay));
    setText(this.dayEl, `Day ${st.time.day}`);
    const hr = st.time.minuteOfDay / 60;
    const day = hr >= 6 && hr < 19;
    if (day !== this.isDay) {
      this.isDay = day;
      this.dayIcon.replaceChildren(icon(day ? 'sun' : 'moon'));
      toggleClass(this.dayIcon, 'night', !day);
    }
    toggleClass(this.pauseBtn, 'on', st.time.paused);
    if (this.lastPaused !== st.time.paused) {
      this.lastPaused = st.time.paused;
      this.pauseBtn.replaceChildren(icon(st.time.paused ? 'play' : 'pause'));
      this.pauseBtn.title = st.time.paused ? 'Resume' : 'Pause';
    }
    for (const [s, b] of this.speedBtns) toggleClass(b, 'on', !st.time.paused && st.time.speed === s);
    // weather
    const w = st.weather;
    if (w.current !== this.weatherKind) {
      this.weatherKind = w.current;
      this.weatherIcon.replaceChildren(icon(WEATHER_ICON[w.current] ?? 'cloud'));
      this.weatherIcon.dataset.kind = w.current;
    }
    setText(this.weatherTemp, temperature(w.temperature, units));
    setText(this.weatherWind.lastElementChild, windSpeed(w.windSpeed, units));
    setStyle(this.windArrow, 'transform', `rotate(${((w.windDir * 180) / Math.PI + 90).toFixed(0)}deg)`);
    // ticker
    for (const [id, t] of this.tick) {
      const p = priceOf(st, id);
      const ch = priceChange(st, id);
      setText(t.price, price(p));
      setText(t.chg, signedPct(ch, 1));
      const dir = ch > 0.0005 ? 'up' : ch < -0.0005 ? 'down' : 'flat';
      if (t.arrow.dataset.dir !== dir) {
        t.arrow.dataset.dir = dir;
        t.arrow.replaceChildren(dir === 'flat' ? h('span', '•') : icon(dir === 'up' ? 'tri-up' : 'tri-down'));
        t.chg.parentElement!.className = `tk-delta ${dir}`;
      }
    }
    // power
    const pw = st.power;
    setText(this.powerTxt, `${pw.generation.toFixed(1)} / ${pw.demand.toFixed(1)} MW`);
    setBar(this.powerBar, pw.demand > 0 ? Math.min(1, pw.generation / pw.demand) : pw.generation > 0 ? 1 : 0);
    const short = pw.demand > 0 && pw.satisfaction < 0.98;
    toggleClass(this.powerBox, 'short', short);
    this.powerBar.className = `bar thin ${short ? 'danger' : pw.gridImport > 0 ? 'warn' : 'teal'}`;
    // environment
    const sc = st.environment.score;
    const col = sc >= 65 ? '#3ddc84' : sc >= 40 ? '#ffc233' : '#ff4d4f';
    this.envRing.set(sc / 100, col);
    setText(this.envTxt, `${Math.round(sc)}`);
    // research
    const r = st.research;
    const t = r.current ? TECHS[r.current] : null;
    const frac = t ? Math.min(1, r.progress / Math.max(1, t.cost)) : 0;
    this.resRing.set(frac);
    setText(this.resName, t ? t.name : 'No active research');
    setText(this.resPct, t ? `Research ${Math.round(frac * 100)}%` : `Research · ${r.pointsPerDay.toFixed(0)} pts/d`);
    // fps
    const showFps = this.ui.app.settings.showFps;
    toggleClass(this.fps, 'hidden', !showFps);
    if (showFps) setText(this.fps, `${Math.round(this.ui.app.host?.fps ?? 0)} FPS`);
  }
}

let markSeq = 0;
function logoMark(): SVGSVGElement {
  const id = `lmg${++markSeq}`;
  const w = document.createElement('div');
  w.innerHTML = `<svg viewBox="0 0 32 32" class="logo-mark"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc07a"/><stop offset="1" stop-color="#ff6a00"/></linearGradient></defs><path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="#161c24" stroke="url(#${id})" stroke-width="1.6"/><path d="M16 8c3.2 4 5.2 6.8 5.2 9.4a5.2 5.2 0 0 1-10.4 0C10.8 14.8 12.8 12 16 8z" fill="url(#${id})"/><path d="M13.6 17.8a2.6 2.6 0 0 0 2.4 2.4" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`;
  return w.firstChild as SVGSVGElement;
}
export { logoMark };

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function titleWeather(k: string) {
  return { clear: 'Clear skies', cloudy: 'Partly cloudy', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', blizzard: 'Blizzard', fog: 'Fog', heatwave: 'Heatwave', hurricane: 'Hurricane' }[k] ?? cap(k);
}
