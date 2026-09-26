// How to Play: controls reference + an illustrated guide to PetroCraft's systems.
import { h, clear, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import { Panel } from '../core/panel';
import type { PanelArgs, UIHost } from '../core/host';
import { keyLabel } from '../format';

interface Section { id: string; title: string; icon: IconName; lead: string; body: string[]; tips?: string[]; illus?: string }

const SVG = (inner: string, vb = '0 0 320 150') => `<svg viewBox="${vb}" class="hp-illus-svg" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

const ILLUS: Record<string, string> = {
  seismic: SVG(`
    <defs><linearGradient id="hpsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2533"/><stop offset="1" stop-color="#0c1118"/></linearGradient></defs>
    <rect width="320" height="150" fill="url(#hpsky)"/>
    <path d="M0 34 H320" stroke="#6a9a45" stroke-width="3"/>
    <path d="M0 60 C80 60 110 44 160 44 S240 60 320 60 V76 C240 76 210 60 160 60 S80 76 0 76Z" fill="#6b5a44" opacity=".85"/>
    <path d="M0 76 C80 76 110 60 160 60 S240 76 320 76 V92 C240 92 210 76 160 76 S80 92 0 92Z" fill="#c9a44a" opacity=".9"/>
    <path d="M120 70 C135 62 185 62 200 70 L196 76 C180 70 140 70 124 76Z" fill="#2a1d10"/>
    <path d="M0 92 C80 92 110 76 160 76 S240 92 320 92 V150 H0Z" fill="#4b4f55"/>
    <g stroke="#2ad0e0" stroke-width="1.2" fill="none" opacity=".9"><path d="M60 34 L150 64 L240 34"/><path d="M60 34 L110 58 L160 34" stroke-dasharray="3 3"/><path d="M160 34 L205 60 L250 34" stroke-dasharray="3 3"/></g>
    <rect x="52" y="26" width="16" height="8" rx="2" fill="#ff8a1f"/><g fill="#2ad0e0"><circle cx="160" cy="34" r="3"/><circle cx="240" cy="34" r="3"/><circle cx="250" cy="34" r="3"/></g>
    <text x="126" y="84" fill="#ffb35c" font-size="9" font-family="sans-serif">OIL TRAP</text>`),
  leases: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <g stroke="rgba(255,255,255,.12)">${Array.from({ length: 11 }, (_, i) => `<path d="M${i * 32} 0V150"/>`).join('')}${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${i * 30}H320"/>`).join('')}</g>
    <g fill="rgba(255,138,31,.28)" stroke="#ff8a1f" stroke-width="1.5"><rect x="96" y="30" width="32" height="30"/><rect x="128" y="30" width="32" height="30"/><rect x="128" y="60" width="32" height="30"/></g>
    <ellipse cx="150" cy="62" rx="58" ry="26" fill="rgba(61,220,132,.16)" stroke="#3ddc84" stroke-dasharray="4 3"/>
    <g fill="#ffc233">${[0, 1, 2, 3].map((i) => `<path transform="translate(${222 + i * 14} 108) scale(.5)" d="M12 2.6 14.8 9 21.7 9.5 16.4 14 18 20.8 12 17.2 6 20.8 7.6 14 2.3 9.5 9.2 9z"/>`).join('')}</g>
    <text x="210" y="100" fill="#b7c0cc" font-size="9" font-family="sans-serif">PROSPECTIVITY</text>`),
  mud: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <g stroke="rgba(255,255,255,.08)">${[30, 60, 90, 120].map((y) => `<path d="M40 ${y}H300"/>`).join('')}</g>
    <path d="M70 10 C80 60 90 90 130 140" stroke="#4ea8ff" stroke-width="2.5" fill="none"/>
    <path d="M150 10 C170 60 210 100 280 140" stroke="#ff4d4f" stroke-width="2.5" fill="none"/>
    <path d="M70 10 C80 60 90 90 130 140 L280 140 C210 100 170 60 150 10Z" fill="rgba(61,220,132,.12)"/>
    <path d="M108 10 C118 60 140 100 190 140" stroke="#3ddc84" stroke-width="3" fill="none" stroke-dasharray="6 4"/>
    <text x="46" y="24" fill="#4ea8ff" font-size="9" font-family="sans-serif">PORE</text>
    <text x="236" y="120" fill="#ff4d4f" font-size="9" font-family="sans-serif">FRACTURE</text>
    <text x="150" y="80" fill="#3ddc84" font-size="9" font-family="sans-serif">MUD WEIGHT</text>
    <text x="8" y="80" fill="#8b95a3" font-size="8" font-family="sans-serif" transform="rotate(-90 14 80)">DEPTH</text>`),
  completion: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <rect x="0" y="40" width="320" height="110" fill="#2a2420"/>
    <rect x="0" y="100" width="320" height="20" fill="#5a4320"/>
    <path d="M0 40H320" stroke="#6a9a45" stroke-width="3"/>
    <rect x="148" y="40" width="10" height="90" fill="#9aa1a8"/><rect x="151" y="40" width="4" height="90" fill="#1a1a1a"/>
    <g fill="#ff8a1f">${[104, 110, 116].map((y) => `<path d="M146 ${y}l-10 -2v4zM160 ${y}l10 -2v4z"/>`).join('')}</g>
    <g stroke="#d7dde4" stroke-width="3" fill="none"><path d="M120 38 L152 14 L184 38"/><path d="M100 18 L200 10"/><path d="M100 18 c-6 4 -6 12 0 16"/></g>
    <circle cx="190" cy="30" r="6" fill="none" stroke="#d7dde4" stroke-width="3"/>
    <text x="178" y="112" fill="#ffb35c" font-size="9" font-family="sans-serif">PERFORATIONS</text>`),
  pipelines: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <g font-family="sans-serif" font-size="9" fill="#b7c0cc">
    <rect x="14" y="56" width="44" height="40" rx="6" fill="#1c2430" stroke="#ff8a1f"/><text x="20" y="110">WELLHEAD</text>
    <rect x="128" y="50" width="52" height="52" rx="26" fill="#1c2430" stroke="#c9a44a"/><text x="136" y="116">TANK</text>
    <rect x="248" y="56" width="58" height="40" rx="6" fill="#1c2430" stroke="#60a5fa"/><text x="250" y="110">TERMINAL</text></g>
    <path d="M58 70 H128" stroke="#2b2b2b" stroke-width="8"/><path d="M58 70 H128" stroke="#f2a31e" stroke-width="3" stroke-dasharray="8 6"><animate attributeName="stroke-dashoffset" from="28" to="0" dur="1s" repeatCount="indefinite"/></path>
    <path d="M180 76 H248" stroke="#2b2b2b" stroke-width="8"/><path d="M180 76 H248" stroke="#f2a31e" stroke-width="3" stroke-dasharray="8 6"><animate attributeName="stroke-dashoffset" from="28" to="0" dur="1s" repeatCount="indefinite"/></path>
    <path d="M40 56 V26 H300" stroke="#c9b52c" stroke-width="5" fill="none"/><text x="120" y="20" fill="#e8d23a" font-size="9" font-family="sans-serif">GAS LINE → SALES METER</text>`),
  processing: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <g font-family="sans-serif" font-size="9">
    ${[['CRUDE', '#c98b3a', 10], ['DISTILLATION', '#ff6a6a', 110], ['PRODUCTS', '#f2d94e', 230]].map(([t, c, x]) => `<rect x="${x}" y="52" width="80" height="44" rx="8" fill="#1c2430" stroke="${c}"/><text x="${Number(x) + 10}" y="78" fill="${c}">${t}</text>`).join('')}
    </g>
    <path d="M90 74 H110 M190 74 H230" stroke="#b7c0cc" stroke-width="2" marker-end="url(#hpa)"/>
    <defs><marker id="hpa" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6z" fill="#b7c0cc"/></marker></defs>
    <g fill="#8b95a3" font-family="sans-serif" font-size="8"><text x="236" y="112">Gasoline · Diesel</text><text x="236" y="124">Jet · LPG · Asphalt</text></g>`),
  market: SVG(`
    <rect width="320" height="150" fill="#0f151d"/>
    <g stroke="rgba(255,255,255,.07)">${[30, 60, 90, 120].map((y) => `<path d="M20 ${y}H300"/>`).join('')}</g>
    <path d="M20 100 C50 96 60 70 90 78 S130 110 160 88 S210 40 240 56 S280 70 300 38" stroke="#ff8a1f" stroke-width="2.5" fill="none"/>
    <path d="M20 100 C50 96 60 70 90 78 S130 110 160 88 S210 40 240 56 S280 70 300 38 V140 H20Z" fill="rgba(255,138,31,.12)"/>
    <circle cx="160" cy="88" r="4" fill="#3ddc84"/><text x="140" y="108" fill="#3ddc84" font-size="9" font-family="sans-serif">BUY/STORE</text>
    <circle cx="300" cy="38" r="4" fill="#ff4d4f"/><text x="262" y="30" fill="#ff8a8a" font-size="9" font-family="sans-serif">SELL</text>`),
  hazards: SVG(`
    <rect width="320" height="150" fill="#140c0c"/>
    <radialGradient id="hpf" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#ffd27a"/><stop offset=".4" stop-color="#ff6a00" stop-opacity=".8"/><stop offset="1" stop-color="#ff2a00" stop-opacity="0"/></radialGradient>
    <ellipse cx="160" cy="92" rx="120" ry="60" fill="url(#hpf)"/>
    <path d="M160 130 C130 130 118 108 128 88 C134 76 146 70 146 52 C160 64 166 74 164 90 C172 84 176 74 176 64 C192 80 198 100 190 114 C184 124 174 130 160 130Z" fill="#ffb347"/>
    <path d="M160 130 C148 130 142 120 146 110 C150 102 158 98 158 88 C168 98 174 106 170 116 C168 124 164 130 160 130Z" fill="#fff1c8"/>
    <rect x="120" y="130" width="80" height="8" fill="#2b2b2b"/>`),
};

function sections(ui: UIHost): Section[] {
  const kb = ui.app.settings.keybinds;
  const k = (a: string) => keyLabel(kb[a]);
  return [
    { id: 'start', title: 'Getting Started', icon: 'flag', lead: 'You run a young oil & gas company in a procedurally generated basin. Find hydrocarbons, drill wells, move and process the fluids, and sell them for profit.', body: [
      'Follow the objectives on the left of the screen — they walk you through your first survey, lease, well and sale.',
      `Open the build menu with ${k('build')}, the map with ${k('map')} and your wells with ${k('wells')}. Hover almost anything for details.`,
      'Time passes faster with the speed controls at the top. One game day lasts ten real minutes at 1×.',
    ], tips: ['Your field office already stands at spawn — hire a few workers first.', 'Money is tight early: prove a reservoir before building expensive facilities.'] },
    { id: 'explore', title: 'Exploration & Seismic', icon: 'seismic', illus: ILLUS.seismic, lead: 'Oil and gas collect in traps: anticlines, fault blocks and salt domes sealed by caprock. Seismic surveys image these structures before you drill.', body: [
      'Open the Map and pick the 2D Seismic Line tool, then drag across a promising area. 3D surveys (after research) cover whole rectangles and reveal reservoir outlines.',
      'In the Seismic viewer, look for domed reflectors (anticlines) and bright amplitude spots. With AVO research, fluid indicators colour gas red, oil green and brine blue.',
      'The handheld Geo Scanner reveals shallow anomalies right under your cursor.',
    ], tips: ['Faults can split one reservoir into separate compartments.', 'Known wells are projected onto seismic sections so you can tie logs to reflectors.'] },
    { id: 'leases', title: 'Mineral Leases', icon: 'grid', illus: ILLUS.leases, lead: 'You can only drill on land (or seabed) where you hold the mineral rights. The basin is divided into parcels.', body: [
      'On the Map, enable the Leases layer and click a parcel to see its price, royalty rate and prospectivity stars, then buy it.',
      'Royalties are a share of every barrel sold from that parcel; prospective parcels cost more.',
    ] },
    { id: 'drilling', title: 'Drilling & Mud Weight', icon: 'rig', illus: ILLUS.mud, lead: 'Build a drilling rig, select it and plan a well: vertical, directional or horizontal, with a target depth, casing points and mud weight.', body: [
      'Mud weight must stay above the formation pore pressure (or fluids flow into the well — a kick) and below the fracture pressure (or the rock breaks and you lose mud).',
      'Casing strings seal off drilled sections. Set surface casing below fresh-water aquifers; set intermediate casing before entering over-pressured zones.',
      'If a kick occurs, choose a well-control method quickly: Driller’s method, Wait-and-Weight or Bullhead. Ignored kicks become blowouts.',
    ], tips: ['Bits wear out faster in hard rock — watch bit condition.', 'Mud gas shows on the drilling log hint at hydrocarbons before logs confirm them.'] },
    { id: 'completion', title: 'Completion & Artificial Lift', icon: 'pumpjack', illus: ILLUS.completion, lead: 'Once a well reaches total depth, complete it by perforating the reservoirs you want to produce. A wellhead appears on the surface.', body: [
      'Tight shale needs hydraulic fracturing: place a Frac Spread next to the wellhead and choose the number of stages.',
      'The choke controls rate: open it wider for more production, but too fast accelerates water and gas breakthrough.',
      'As reservoir pressure falls, install artificial lift — pumpjacks, ESPs or gas lift — to keep fluids flowing.',
    ] },
    { id: 'pipes', title: 'Pipelines & Storage', icon: 'pipe', illus: ILLUS.pipelines, lead: 'Wellheads split production into oil, gas and water. Each flows only through its own pipe type.', body: [
      'Place crude, gas, water and product pipes from your hotbar or the Build menu (Pipes & Roads). Pipes connect to adjacent buildings with a matching port.',
      'Send crude to tanks and a truck or rail terminal, gas to a sales meter or gas plant, and water to a disposal well or pit.',
      'Long lines need pump or compressor stations to keep throughput up.',
    ], tips: ['Excess gas with nowhere to go is flared at the wellhead — or vented if flaring is disabled (much worse).'] },
    { id: 'processing', title: 'Processing & Petrochemicals', icon: 'refinery', illus: ILLUS.processing, lead: 'Upgrade raw production into higher-value products.', body: [
      'Gas plants strip NGLs, condensate and sulfur from raw gas and sell dry gas at full price.',
      'Refineries distil crude into gasoline, diesel, jet fuel, LPG and asphalt. Crackers and polymer plants climb further up the value chain.',
      'Select a plant to choose its recipe and throttle, and check its input and output buffers.',
    ] },
    { id: 'markets', title: 'Markets & Contracts', icon: 'chart', illus: ILLUS.market, lead: 'Commodity prices move daily and react to world events. Terminals sell your product automatically when auto-sell is on.', body: [
      'In the Market panel, set a minimum price for auto-selling and a reserve to keep in storage.',
      'Contracts promise a fixed price, often above spot, for delivering a quantity by a deadline. Missing a deadline costs a penalty and reputation.',
      'With a Trading Desk you can hedge future production at today’s price.',
    ] },
    { id: 'workforce', title: 'Workforce', icon: 'users', lead: 'Most buildings need a crew — drillers and roughnecks for rigs, operators for plants, technicians for maintenance.', body: [
      'Hire candidates in the Workforce panel. Auto-assign sends new hires where they are needed most.',
      'Morale falls with fatigue and poor housing; build worker camps. Skilled workers make buildings more efficient.',
    ] },
    { id: 'research', title: 'Research', icon: 'flask', lead: 'Research labs and field offices generate research points each day.', body: [
      'Unlock better drilling (PDC bits, horizontal wells), production (lift, waterflooding, fracking), midstream, refining, safety and offshore technologies.',
      'Queue several technologies so research never idles.',
    ] },
    { id: 'hazards', title: 'Hazards & Safety', icon: 'fire', illus: ILLUS.hazards, lead: 'Equipment wears down and can fail, catch fire or leak. Weather adds storms, lightning and heat.', body: [
      'Keep condition high with maintenance depots and repairs. Fire stations respond to fires nearby.',
      'Blowouts are the worst case: uncontrolled flow, often on fire. Cap the well or drill a relief well.',
      'Use the fire extinguisher and gas detector tools for hands-on emergencies.',
    ] },
    { id: 'environment', title: 'Environment', icon: 'leaf', lead: 'Your social licence to operate depends on your environmental record.', body: [
      'Emissions, flaring, venting and spills lower your score; regulators issue fines and violations.',
      'Three violations suspend operations for several days. Flare-gas recovery, leak detection and carbon capture improve your standing.',
    ] },
    { id: 'graphics', title: 'Graphics & Performance', icon: 'monitor', lead: 'Settings → Graphics tunes image quality against frame rate. Changes apply immediately.', body: [
      'Quality presets (Low, Medium, High, Ultra) set render distance, shadows, bloom, ambient occlusion, clouds, particles and render scale in one click. Changing any of them afterwards shows the preset as Custom.',
      'Render scale draws the 3D world at a lower internal resolution (50–100%) — the quickest way to gain frames on high-resolution screens. The interface always stays sharp.',
      'Auto quality lowers render scale and effects when the frame rate drops below 60 fps and restores them when there is headroom.',
      'Anti-aliasing smooths jagged edges; brightness (60–160%) adjusts scene exposure for dark screens or bright rooms.',
      'Turn on the performance overlay to see FPS, frame time, the effective render scale and renderer statistics under the minimap.',
    ], tips: ['Render distance and shadows cost the most on slower GPUs; SSAO is the most expensive single effect.'] },
    { id: 'offshore', title: 'Offshore', icon: 'platform', lead: 'The biggest fields lie beneath the sea.', body: [
      'Jack-up rigs drill in shallow water; semi-submersibles go deeper. Offshore wells flow to a production platform (within 24 blocks) or FPSO (within 40 blocks).',
      'Crews reach offshore installations by helicopter — build a helipad.',
    ] },
  ];
}

export class HelpPanel extends Panel {
  readonly id = 'help' as const;
  private nav!: HTMLElement;
  private content!: HTMLElement;
  private current = 'controls';

  constructor(ui: UIHost, args: PanelArgs) {
    super(ui, args, 'How to Play', 'book', 'xl');
    this.fixedBody = true;
    if (typeof args.section === 'string') this.current = args.section;
  }

  protected build() {
    this.nav = h('nav.hp-nav.scroll');
    this.content = h('div.hp-content.scroll');
    this.body.appendChild(h('div.hp-layout', this.nav, this.content));
    const all = sections(this.ui);
    const items: [string, string, IconName][] = [['controls', 'Controls', 'keyboard'], ...all.map((s) => [s.id, s.title, s.icon] as [string, string, IconName])];
    const btns = new Map<string, HTMLElement>();
    for (const [id, title, ic] of items) {
      const b = h('button.hp-link', { type: 'button' }, icon(ic), h('span', title));
      b.addEventListener('click', () => {
        this.ui.sound('click');
        this.current = id;
        for (const [k, e] of btns) toggleClass(e, 'on', k === id);
        this.render(all);
      });
      btns.set(id, b);
      this.nav.appendChild(b);
    }
    toggleClass(btns.get(this.current) ?? btns.get('controls')!, 'on', true);
    this.render(all);
  }

  private render(all: Section[]) {
    clear(this.content);
    this.content.scrollTop = 0;
    if (this.current === 'controls') {
      this.content.appendChild(this.controls());
      return;
    }
    const s = all.find((x) => x.id === this.current) ?? all[0];
    const ill = h('div.hp-illus');
    if (s.illus) ill.innerHTML = s.illus;
    else ill.appendChild(h('div.hp-illus-icon', icon(s.icon)));
    this.content.append(
      h('div.hp-hero', ill, h('div.col', h('h3.hp-title', s.title), h('p.hp-lead', s.lead))),
      h('div.hp-body', s.body.map((p) => h('p', p))),
      s.tips?.length ? h('div.hp-tips', s.tips.map((t) => h('div.hp-tip', icon('bulb'), h('span', t)))) : '',
    );
  }

  private controls(): HTMLElement {
    const kb = this.ui.app.settings.keybinds;
    const k = (a: string) => h('span.kbd', keyLabel(kb[a]));
    const row = (keys: (HTMLElement | string)[], label: string) => h('div.hp-ctl', h('div.hp-keys', keys.map((x) => (typeof x === 'string' ? h('span.kbd', x) : x))), h('span', label));
    return h('div.hp-controls',
      h('div.card', h('div.section-title', icon('gamepad'), 'Movement'),
        row([k('forward'), k('left'), k('back'), k('right')], 'Walk'),
        row([k('jump')], 'Jump · fly up'), row([k('sneak')], 'Sneak · fly down'), row([k('sprint')], 'Sprint'),
        row([k('fly')], 'Toggle fly mode'), row([k('drone')], 'Drone camera (top-down)')),
      h('div.card', h('div.section-title', icon('mouse'), 'Interaction'),
        row(['LMB'], 'Break block · use tool · place building'), row(['RMB'], 'Place block · inspect building or well'),
        row(['1–9', 'Wheel'], 'Select hotbar slot'), row([k('rotate')], 'Rotate building'), row([k('pipeMode')], 'Pipe line mode'),
        row([k('xray')], 'X-ray subsurface view'), row([k('drop')], 'Drop one item'), row(['Ctrl', k('drop')], 'Drop whole stack'),
        row(['Walk over'], 'Pick up dropped items')),
      h('div.card', h('div.section-title', icon('layers'), 'Panels'),
        row([k('build')], 'Build'), row([k('inventory')], 'Inventory & shop'), row([k('map')], 'Map'), row([k('wells')], 'Wells'),
        row([k('research')], 'Research'), row([k('market')], 'Market'), row([k('contracts')], 'Contracts'), row([k('workforce')], 'Workforce'),
        row([k('finance')], 'Finance'), row([k('objectives')], 'Objectives'), row([k('help')], 'This help')),
      h('div.card', h('div.section-title', icon('clock'), 'Time & system'),
        row([k('togglePause')], 'Pause / resume time'), row([k('speedDown'), k('speedUp')], 'Game speed'), row([k('pause')], 'Close panel · pause menu'),
        row([k('quickSave')], 'Quick save'), row([k('quickLoad')], 'Quick load'), row([k('hideHud')], 'Hide HUD')));
  }
}
