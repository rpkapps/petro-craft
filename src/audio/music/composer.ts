// Generative score performer. Schedules notes ahead on the audio clock using a 16th-note grid.
//
// Game score: pieces of 3–5 sections (4 chords each) with an intensity arc, chosen by time-of-day mood,
// separated by rests. Layers (pads, sub, pluck arpeggios, bell/lead motifs, soft percussion, industrial
// anvil accents) are re-rolled every section from a seeded RNG, so it never loops verbatim.
// A tension layer (dark cluster drone, pulsing bass, taiko) fades in with fires/kicks/blowouts and can
// darken the harmony mid-piece. The menu score follows a composed plan in D minor with a recurring theme.
import { clamp, mulberry32, pick, rand, weighted, type Rng } from '../dsp';
import { Instruments, TensionDrone, type HitProvider } from './instruments';
import { buildChord, nextDegree, noteAtOrAbove, scaleNotes, voiceChord, type Chord, type Extension, type ModeName } from './theory';

export type Mood = 'dawn' | 'day' | 'dusk' | 'night' | 'tension';
export type PerformerKind = 'menu' | 'game';

interface MoodSpec {
  modes: [ModeName, number][];
  bpm: [number, number];
  cutoff: number;
  arp: number;
  perc: number;
  motif: number;
  sub: number;
  padLo: number;
  padHi: number;
  motifInst: ('bell' | 'lead' | 'pluck')[];
  exts: [Extension, number][];
}

const MOODS: Record<Mood, MoodSpec> = {
  dawn: {
    modes: [['lydian', 3], ['ionian', 2]], bpm: [62, 70], cutoff: 1700, arp: 0.6, perc: 0.3, motif: 0.6, sub: 0.5,
    padLo: 55, padHi: 76, motifInst: ['bell', 'bell', 'pluck'], exts: [['add9', 3], ['sus2', 2], ['triad', 1], ['seventh', 1.5]],
  },
  day: {
    modes: [['ionian', 2], ['mixolydian', 2], ['dorian', 1]], bpm: [70, 82], cutoff: 2000, arp: 0.8, perc: 0.6, motif: 0.6, sub: 0.45,
    padLo: 53, padHi: 74, motifInst: ['pluck', 'bell', 'lead'], exts: [['add9', 2], ['triad', 2], ['sus2', 1.5], ['sixth', 1], ['seventh', 1]],
  },
  dusk: {
    modes: [['dorian', 3], ['aeolian', 1], ['mixolydian', 1]], bpm: [62, 72], cutoff: 1350, arp: 0.5, perc: 0.35, motif: 0.65, sub: 0.7,
    padLo: 50, padHi: 72, motifInst: ['lead', 'lead', 'bell'], exts: [['seventh', 2.5], ['add9', 2], ['sus4', 1], ['triad', 1]],
  },
  night: {
    modes: [['aeolian', 3], ['dorian', 2]], bpm: [54, 64], cutoff: 950, arp: 0.3, perc: 0.1, motif: 0.45, sub: 0.85,
    padLo: 48, padHi: 70, motifInst: ['bell', 'lead'], exts: [['add9', 2], ['seventh', 2], ['sus2', 1.5], ['triad', 1]],
  },
  tension: {
    modes: [['phrygian', 2], ['aeolian', 2]], bpm: [76, 88], cutoff: 820, arp: 0.25, perc: 0.2, motif: 0.25, sub: 1,
    padLo: 45, padHi: 67, motifInst: ['lead'], exts: [['triad', 2], ['sus2', 1.5], ['sus4', 1], ['seventh', 1]],
  },
};

// ---- Menu plan (D aeolian) ----------------------------------------------------------------------
const MENU_KEY = 2;
const MENU_PROGS = {
  P1: [0, 5, 2, 6], // Dm Bb F C
  P2: [0, 3, 5, 4], // Dm Gm Bb Am
  P3: [5, 6, 0, 0], // Bb C Dm Dm
  P4: [0, 5, 3, 6], // Dm Bb Gm C
} as const;
interface MenuSection { prog: keyof typeof MENU_PROGS; sub: boolean; arp: boolean; perc: boolean; motif: 'theme-bell' | 'theme-lead' | 'gen' | null; anvil: boolean }
const MENU_PLAN: MenuSection[] = [
  { prog: 'P1', sub: true, arp: false, perc: false, motif: null, anvil: false },
  { prog: 'P1', sub: true, arp: false, perc: false, motif: 'theme-bell', anvil: false },
  { prog: 'P4', sub: true, arp: true, perc: true, motif: 'gen', anvil: true },
  { prog: 'P3', sub: true, arp: true, perc: false, motif: null, anvil: false },
  { prog: 'P1', sub: true, arp: true, perc: true, motif: 'theme-lead', anvil: false },
  { prog: 'P2', sub: false, arp: false, perc: false, motif: 'gen', anvil: true },
];
/** The PetroCraft theme: [step within the 4-chord section, MIDI, length in 16ths]. Over Dm–B♭–F–C. */
const THEME: [number, number, number][] = [
  [0, 69, 8], [8, 74, 4], [12, 76, 4], [16, 77, 12], [28, 76, 4],
  [32, 74, 12], [44, 72, 4], [48, 70, 8], [56, 69, 8],
  [64, 69, 8], [72, 72, 8], [80, 77, 8], [88, 79, 4], [92, 77, 4],
  [96, 76, 16], [112, 74, 4], [116, 72, 4], [120, 74, 8],
];

const RHYTHMS: [number, number][][] = [
  [[0, 8], [8, 4], [12, 4], [16, 12], [28, 4]],
  [[0, 4], [4, 4], [8, 8], [16, 4], [20, 4], [24, 8]],
  [[0, 12], [12, 4], [16, 16]],
  [[2, 6], [8, 6], [14, 2], [16, 8], [24, 8]],
  [[0, 6], [6, 6], [12, 4], [16, 6], [22, 2], [24, 8]],
  [[0, 16], [16, 8], [24, 8]],
];

interface ArpStep { on: boolean; idx: number; oct: number; vel: number }
interface MotifNote { step: number; len: number; midi: number; strong: boolean }

export interface PerformerOutputs {
  dry: AudioNode;
  wet: AudioNode;
}

export class Performer {
  readonly faderDry: GainNode;
  readonly faderWet: GainNode;
  private readonly inst: Instruments;
  private readonly rng: Rng;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly delayIn: GainNode;
  private drone: TensionDrone | null = null;

  // targets from the director
  private moodTarget: Mood = 'day';
  private tensionTarget = 0;
  private tension = 0;

  // clock
  private step = 0;
  private nextTime: number;
  private stepDur = 60 / 66 / 4;
  stopAt = Infinity;

  // piece
  private pieceMood: Mood = 'day';
  private key = 0;
  private mode: ModeName = 'ionian';
  private spec: MoodSpec = MOODS.day;
  private sectionsLeft = 0;
  private sectionIndex = -1;
  private arc: number[] = [];
  private finalSection = false;
  private sectionChordsLeft = 0;
  private sectionStartStep = 0;
  private chord: Chord | null = null;
  private voicing: number[] | null = null;
  private chordEndStep = 0;
  private resting = false;
  private restEndStep = 0;
  private pieces = 0;

  // layers
  private layer = { sub: false, arp: false, perc: false, anvil: false, motifInst: 'bell' as 'bell' | 'lead' | 'pluck' };
  private arp: ArpStep[] = [];
  private arpEvery = 1;
  private motif: MotifNote[] = [];
  private perc = { kick: new Float32Array(16), shaker: new Float32Array(16), tick: new Float32Array(16) };
  private menuIndex = -1;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly kind: PerformerKind,
    out: PerformerOutputs,
    hits: HitProvider,
    seed: number,
    startTime: number,
    readonly level = 1,
  ) {
    this.rng = mulberry32(seed);
    this.faderDry = ctx.createGain();
    this.faderWet = ctx.createGain();
    this.faderDry.gain.value = 0;
    this.faderWet.gain.value = 0;
    this.faderDry.connect(out.dry);
    this.faderWet.connect(out.wet);
    // stereo ping-pong delay
    this.delayIn = ctx.createGain();
    this.delayL = ctx.createDelay(3);
    this.delayR = ctx.createDelay(3);
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.36;
    fbR.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const merger = ctx.createChannelMerger(2);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.55;
    this.delayIn.connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayL.connect(fbL).connect(damp).connect(this.delayR);
    this.delayR.connect(merger, 0, 1);
    this.delayR.connect(fbR).connect(this.delayL);
    merger.connect(dOut);
    dOut.connect(this.faderDry);
    const dWet = ctx.createGain();
    dWet.gain.value = 0.35;
    dOut.connect(dWet).connect(this.faderWet);

    this.inst = new Instruments(ctx, { dry: this.faderDry, wet: this.faderWet, delay: this.delayIn }, hits);
    this.nextTime = startTime;
    if (kind === 'game') {
      this.resting = true;
      this.restEndStep = Math.round(rand(this.rng, 2.5, 5) / this.stepDur);
    } else {
      this.startPiece(0, startTime);
    }
  }

  /** Current key root pitch class (0 = C). */
  get keyRoot(): number {
    return this.kind === 'menu' ? MENU_KEY : this.key;
  }

  get isResting(): boolean {
    return this.resting;
  }

  get currentMood(): Mood {
    return this.pieceMood;
  }

  setMood(mood: Mood, tension: number) {
    this.moodTarget = mood;
    this.tensionTarget = clamp(tension, 0, 1);
  }

  fade(to: number, time: number, at = this.ctx.currentTime) {
    const g = to * this.level;
    this.faderDry.gain.cancelScheduledValues(at);
    this.faderWet.gain.cancelScheduledValues(at);
    this.faderDry.gain.setValueAtTime(this.faderDry.gain.value, at);
    this.faderWet.gain.setValueAtTime(this.faderWet.gain.value, at);
    this.faderDry.gain.linearRampToValueAtTime(g, at + time);
    this.faderWet.gain.linearRampToValueAtTime(g, at + time);
  }

  /** Fade out and stop scheduling; nodes are released after the tails ring out. */
  stop(fadeTime: number) {
    const t = this.ctx.currentTime;
    this.fade(0, fadeTime, t);
    this.stopAt = t + fadeTime;
    this.drone?.stop(t + fadeTime + 0.5);
    this.inst.dispose(t + fadeTime + 0.5);
  }

  /** Release the output faders (after stop + tails). */
  disconnect() {
    try {
      this.faderDry.disconnect();
      this.faderWet.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** Schedule every grid step that starts before `until`. */
  schedule(until: number) {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.05) {
      // fell behind (throttled tab) — skip ahead instead of bursting notes
      const skip = Math.ceil((now + 0.05 - this.nextTime) / this.stepDur);
      this.step += skip;
      this.nextTime += skip * this.stepDur;
    }
    const end = Math.min(until, this.stopAt);
    while (this.nextTime < end) {
      this.tick(this.step, this.nextTime);
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  // ---------------------------------------------------------------------------------------------
  private tick(s: number, t: number) {
    // tension smoothing (per step): quick attack, slow release
    const k = this.tensionTarget > this.tension ? 0.03 : 0.006;
    this.tension += (this.tensionTarget - this.tension) * k;
    if (this.kind === 'game') this.tensionLayer(s, t);

    if (this.resting) {
      const urgent = this.kind === 'game' && this.tensionTarget > 0.4;
      if (s < this.restEndStep && !urgent) return;
      this.startPiece(s, t);
    }
    if (s >= this.chordEndStep) this.nextChord(s, t);
    if (this.resting) return;
    this.arpStep(s, t);
    this.percStep(s, t);
    this.motifStep(s, t);
  }

  private setTempo(bpm: number, t: number) {
    this.stepDur = 60 / bpm / 4;
    const dt = this.stepDur * 3; // dotted eighth
    this.delayL.delayTime.setTargetAtTime(dt, t, 0.05);
    this.delayR.delayTime.setTargetAtTime(dt, t, 0.05);
  }

  private startPiece(s: number, t: number) {
    this.resting = false;
    this.pieces++;
    if (this.kind === 'menu') {
      this.pieceMood = 'dusk';
      this.key = MENU_KEY;
      this.mode = 'aeolian';
      this.spec = { ...MOODS.dusk, cutoff: 1500, padLo: 50, padHi: 74 };
      this.setTempo(70, t);
      this.sectionsLeft = Infinity;
      this.menuIndex = -1;
    } else {
      const mood: Mood = this.tensionTarget > 0.5 ? 'tension' : this.moodTarget;
      this.pieceMood = mood;
      this.spec = MOODS[mood];
      if (this.pieces === 1) this.key = pick(this.rng, [0, 2, 3, 5, 7, 9, 10, 4]);
      else this.key = (this.key + weighted(this.rng, [[5, 3], [7, 3], [9, 2], [2, 1.5], [0, 1], [10, 1]] as [number, number][])) % 12;
      this.mode = weighted(this.rng, this.spec.modes);
      this.setTempo(Math.round(rand(this.rng, this.spec.bpm[0], this.spec.bpm[1])), t);
      this.sectionsLeft = 3 + Math.floor(this.rng() * 3);
      const n = this.sectionsLeft;
      const peak = 0.55 + this.rng() * 0.4;
      this.arc = Array.from({ length: n }, (_, i) => {
        const x = n === 1 ? 0.5 : i / (n - 1);
        return clamp(0.25 + peak * Math.sin(Math.PI * (0.15 + 0.75 * x)) + (this.rng() - 0.5) * 0.15, 0.15, 1);
      });
    }
    this.sectionIndex = -1;
    this.sectionChordsLeft = 0;
    this.finalSection = false;
    this.chord = null;
    this.chordEndStep = s;
    const root = noteAtOrAbove(this.key, 33);
    if (this.kind === 'game') {
      if (!this.drone) this.drone = new TensionDrone(this.ctx, this.faderDry, this.faderWet, root, t);
      else this.drone.setRoot(root, t);
    }
  }

  private newSection(s: number) {
    this.sectionIndex++;
    this.sectionStartStep = s;
    this.sectionChordsLeft = 4;
    const r = this.rng;
    if (this.kind === 'menu') {
      this.menuIndex = this.menuIndex + 1 >= MENU_PLAN.length ? 1 : this.menuIndex + 1;
      const m = MENU_PLAN[this.menuIndex];
      this.layer = { sub: m.sub, arp: m.arp, perc: m.perc, anvil: m.anvil, motifInst: m.motif === 'theme-lead' ? 'lead' : 'bell' };
      this.buildArp(0.55 + r() * 0.2);
      this.buildPerc(0.65);
      this.motif = [];
      if (m.motif === 'theme-bell' || m.motif === 'theme-lead') {
        this.motif = THEME.map(([st, midi, len]) => ({ step: s + st, len, midi, strong: false }));
      } else if (m.motif === 'gen') {
        this.layer.motifInst = r() < 0.5 ? 'bell' : 'pluck';
        this.buildMotif(s, 0.6);
      }
      return;
    }
    this.sectionsLeft--;
    this.finalSection = this.sectionsLeft <= 0;
    const intensity = this.arc[Math.min(this.arc.length - 1, this.sectionIndex)] ?? 0.5;
    const sp = this.spec;
    this.layer = {
      sub: r() < sp.sub + (intensity > 0.5 ? 0.2 : 0),
      arp: intensity > 0.3 && r() < sp.arp * (0.55 + intensity),
      perc: intensity > 0.5 && r() < sp.perc * (0.6 + intensity),
      anvil: r() < 0.3,
      motifInst: pick(r, sp.motifInst),
    };
    this.buildArp(intensity);
    this.buildPerc(intensity);
    this.motif = [];
    if (intensity > 0.3 && r() < sp.motif) this.buildMotif(s, intensity);
  }

  private nextChord(s: number, t: number) {
    // piece end → rest
    if (this.sectionChordsLeft <= 0) {
      if (this.kind === 'game' && this.finalSection) {
        this.resting = true;
        const restSec = this.tensionTarget > 0.3 ? 2 : rand(this.rng, 18, 55);
        this.restEndStep = s + Math.round(restSec / this.stepDur);
        return;
      }
      this.newSection(s);
    }

    // darken harmony when tension spikes mid-piece
    if (this.kind === 'game' && this.tensionTarget > 0.55 && this.pieceMood !== 'tension') {
      this.pieceMood = 'tension';
      this.mode = this.rng() < 0.5 ? 'phrygian' : 'aeolian';
      this.spec = { ...MOODS.tension, padLo: this.spec.padLo - 2, padHi: this.spec.padHi - 2 };
      this.layer.motifInst = 'lead';
    } else if (this.kind === 'game' && this.pieceMood === 'tension' && this.tensionTarget < 0.15 && !this.finalSection) {
      // calm again: wrap up this piece at the end of the section
      this.sectionsLeft = 0;
      this.finalSection = true;
    }

    const r = this.rng;
    let degree: number;
    let len = 32;
    const lastOfSection = this.sectionChordsLeft === 1;
    if (this.kind === 'menu') {
      const m = MENU_PLAN[this.menuIndex];
      const prog = MENU_PROGS[m.prog];
      degree = prog[4 - this.sectionChordsLeft];
    } else if (!this.chord) {
      degree = r() < 0.75 ? 0 : weighted(r, [[5, 1], [3, 1]] as [number, number][]);
    } else if (this.finalSection && lastOfSection) {
      degree = 0;
      len = 48;
    } else {
      degree = nextDegree(r, this.mode, this.chord.degree);
      len = weighted(r, [[32, 5], [16, 1], [64, 1.2]] as [number, number][]);
    }
    const ext = weighted(r, this.spec.exts);
    const chord = buildChord(this.mode, degree, ext);
    const voicing = voiceChord(chord, this.key, this.voicing, this.spec.padLo, this.spec.padHi, 4);
    this.chord = chord;
    this.voicing = voicing;
    this.chordEndStep = s + len;
    this.sectionChordsLeft--;
    const dur = len * this.stepDur;

    const padVel = this.kind === 'menu' ? 0.2 : 0.17;
    const firstOfPiece = this.sectionIndex === 0 && this.sectionChordsLeft === 3;
    this.inst.pad(t, voicing, dur, {
      vel: padVel,
      cutoff: this.spec.cutoff * (0.85 + r() * 0.3),
      attack: firstOfPiece ? 4 : rand(r, 1.6, 3),
      release: this.finalSection && lastOfSection ? 7 : 4,
      wet: 0.6,
    });
    const bass = noteAtOrAbove((this.key + chord.root) % 12, 33);
    if (this.layer.sub) this.inst.sub(t, bass, dur, 0.26, firstOfPiece ? 3 : 1.4);
    if (this.layer.anvil && r() < (this.kind === 'menu' ? 0.5 : 0.25)) {
      const target = noteAtOrAbove((this.key + chord.root) % 12, 79);
      this.inst.hit('m_anvil', t + this.stepDur * pick(r, [0, 4, 8]), 0.1, { rate: Math.pow(2, (target - 85) / 12), pan: rand(r, -0.5, 0.5), wet: 1, delay: 0.35 });
    }
    // swell into the next section
    if (lastOfSection && (this.layer.perc || this.kind === 'menu') && r() < 0.45 && dur > 2.4) {
      this.inst.hit('m_swell', t + dur - 1.9, 0.12, { wet: 0.5 });
    }
  }

  // ---- layers -----------------------------------------------------------------------------------
  private buildArp(intensity: number) {
    const r = this.rng;
    const style = pick(r, ['up', 'updown', 'random', 'pedal'] as const);
    this.arpEvery = intensity > 0.65 && r() < 0.6 ? 1 : 2;
    const density = clamp(0.35 + intensity * 0.6, 0.3, 0.95);
    const steps: ArpStep[] = [];
    let k = 0;
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      const medium = i % 2 === 0;
      const p = strong ? 0.95 : medium ? 0.65 : 0.35;
      const on = r() < p * density;
      let idx = 0;
      if (style === 'up') idx = k;
      else if (style === 'updown') idx = [0, 1, 2, 3, 2, 1][k % 6];
      else if (style === 'random') idx = Math.floor(r() * 4);
      else idx = k % 2 === 0 ? 0 : 1 + Math.floor(r() * 3);
      steps.push({ on, idx, oct: r() < 0.15 ? 1 : 0, vel: (strong ? 1 : medium ? 0.75 : 0.6) * rand(r, 0.85, 1.1) });
      if (on) k++;
    }
    if (steps.filter((x) => x.on).length < 3) steps[0].on = steps[8].on = steps[12].on = true;
    this.arp = steps;
  }

  private buildPerc(intensity: number) {
    const r = this.rng;
    const { kick, shaker, tick } = this.perc;
    kick.fill(0);
    shaker.fill(0);
    tick.fill(0);
    kick[0] = 0.5;
    if (intensity > 0.7 && r() < 0.6) kick[r() < 0.5 ? 8 : 10] = 0.32;
    for (let i = 0; i < 16; i += 2) shaker[i] = i % 4 === 2 ? 0.2 : 0.13;
    if (intensity > 0.7) for (let i = 1; i < 16; i += 2) if (r() < 0.4) shaker[i] = 0.06;
    if (r() < 0.6) {
      tick[4] = 0.1;
      tick[12] = 0.12;
    }
    if (r() < 0.3) tick[14] = 0.06;
  }

  private buildMotif(start: number, intensity: number) {
    const r = this.rng;
    const inst = this.layer.motifInst;
    const [lo, hi] = inst === 'bell' ? [70, 86] : inst === 'pluck' ? [67, 84] : [64, 79];
    const scale = scaleNotes(this.key, this.mode, lo, hi);
    if (!scale.length) return;
    const rhythm = pick(r, RHYTHMS);
    let idx = Math.floor(scale.length * rand(r, 0.3, 0.6));
    const phrase: { st: number; len: number; idx: number }[] = [];
    for (const [st, len] of rhythm) {
      phrase.push({ st, len, idx });
      const stepMove = weighted(r, [[-2, 1], [-1, 3], [1, 3], [2, 1.2], [0, 0.6], [3, 0.4], [-3, 0.4]] as [number, number][]);
      idx = clamp(idx + stepMove, 0, scale.length - 1);
    }
    const notes: MotifNote[] = [];
    const place = (offset: number, shift: number) => {
      phrase.forEach((p, i) => {
        // occasionally drop a note for breath
        if (i > 0 && r() < 0.12) return;
        const ii = clamp(p.idx + shift, 0, scale.length - 1);
        notes.push({ step: start + offset + p.st, len: p.len, midi: scale[ii], strong: p.st % 8 === 0 });
      });
    };
    place(0, 0);
    place(32, r() < 0.5 ? 0 : pick(r, [1, 2, -1]));
    if (intensity > 0.55) place(64, pick(r, [0, 2]));
    if (intensity > 0.75 || r() < 0.3) place(96, 0);
    this.motif = notes;
  }

  private arpStep(s: number, t: number) {
    if (!this.layer.arp || !this.chord || !this.arp.length) return;
    if (s % this.arpEvery !== 0) return;
    const a = this.arp[(s / this.arpEvery) % 16 | 0];
    if (!a.on) return;
    const pcs = this.chord.tones.map((x) => (x + this.key) % 12);
    const base = this.spec.padHi - 6;
    const notes = pcs.map((pc) => noteAtOrAbove(pc, base)).sort((x, y) => x - y);
    const m = notes[a.idx % notes.length] + 12 * a.oct;
    const human = (this.rng() - 0.5) * 0.012;
    const vel = (this.kind === 'menu' ? 0.2 : 0.17) * a.vel;
    this.inst.pluck(t + Math.max(0, human), m, vel, s % 4 < 2 ? -0.3 : 0.3, 0.3, 0.35, this.spec.cutoff * 2.5);
  }

  private percStep(s: number, t: number) {
    if (!this.layer.perc) return;
    const i = s % 16;
    const h = () => t + Math.max(0, (this.rng() - 0.5) * 0.01);
    const v = () => rand(this.rng, 0.85, 1.12);
    const { kick, shaker, tick } = this.perc;
    if (kick[i]) this.inst.hit('m_kick', t, kick[i] * 0.6, { wet: 0.15 });
    if (shaker[i]) this.inst.hit('m_shaker', h(), shaker[i] * v() * 0.8, { pan: rand(this.rng, -0.25, 0.35), wet: 0.25 });
    if (tick[i]) this.inst.hit('m_tick', h(), tick[i] * v(), { pan: rand(this.rng, -0.5, 0.5), wet: 0.5, delay: 0.25 });
  }

  private motifStep(s: number, t: number) {
    if (!this.motif.length || !this.chord) return;
    for (const n of this.motif) {
      if (n.step !== s) continue;
      let midi = n.midi;
      if (n.strong) {
        // snap strong-beat notes to the sounding chord
        const pcs = this.chord.tones.map((x) => (x + this.key) % 12);
        if (!pcs.includes(midi % 12)) {
          let best = midi;
          for (let d = 1; d <= 2; d++) {
            if (pcs.includes((midi + d) % 12)) { best = midi + d; break; }
            if (pcs.includes((midi - d + 12) % 12)) { best = midi - d; break; }
          }
          midi = best;
        }
      }
      const dur = n.len * this.stepDur;
      const inst = this.layer.motifInst;
      if (inst === 'bell') this.inst.bell(t, midi, 0.13, rand(this.rng, -0.3, 0.3), Math.max(2, dur * 2), 0.7, 3.5, 1.2);
      else if (inst === 'pluck') this.inst.pluck(t, midi, 0.24, rand(this.rng, -0.2, 0.2), 0.35, 0.5);
      else this.inst.lead(t, midi, dur * 0.92, this.kind === 'menu' ? 0.15 : 0.12, rand(this.rng, -0.15, 0.15), 0.65);
    }
  }

  private tensionLayer(s: number, t: number) {
    const x = this.tension;
    if (s % 4 === 0) this.drone?.setLevel(x > 0.08 ? 0.05 + 0.14 * x : 0, t);
    if (x < 0.18) return;
    const root = noteAtOrAbove(this.key, 36);
    const rate = Math.pow(2, (root - 36) / 12);
    if (s % 2 === 0) {
      const accent = s % 8 === 0 ? 1.3 : 1;
      this.inst.hit('m_pulse', t, (0.1 + 0.22 * x) * accent, { rate, wet: 0.2, delay: 0.1 });
    }
    if (x > 0.45) {
      const i = s % 16;
      if (i === 0) this.inst.hit('m_taiko', t, 0.35 * x, { wet: 0.5 });
      if (i === 10) this.inst.hit('m_taiko', t, 0.2 * x, { wet: 0.5, rate: 1.12 });
    }
    if (x > 0.7 && s % 2 === 1) this.inst.hit('m_tick', t, 0.05 + 0.05 * x, { pan: (s % 4) < 2 ? -0.4 : 0.4, wet: 0.3 });
  }
}
