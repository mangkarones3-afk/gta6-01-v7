// activities.js — the street layer beyond Val's work: timed checkpoint
// races on the avenue grid, stunt jumps off the city's ramps, and the
// caracolas — golden conch shells hidden across the districts. All of
// it is real state: race best times, stunt landings and shell pickups
// live in G.progress, ride the save file (save.js), and the career
// percentage the title screen prints is computed from that state only.

import { carCollidesAt, speedOf } from './vehicles.js';
import { writeSave } from './save.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dist = (a, b, x, y) => Math.hypot(a - x, b - y);

export function fmtTime(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, '0')}.${tenth}`;
}

// ---------------------------------------------------------------- races
// Four street races: a start ring on the grid, a chain of checkpoints
// down real lanes, a par time to beat for the prize. A finish always
// records the best time; beating par is the win that pays.
export const RACES = [
  {
    id: 'faro', name: 'Faro Sprint', start: { x: 126, y: 140 }, par: 80, prize: 900,
    cps: [
      { x: 120, y: 240, name: 'Av. del Faro' },
      { x: 120, y: 351, name: 'the Mercado crossing' },
      { x: 240, y: 360, name: 'Calle del Mercado' },
      { x: 351, y: 360, name: 'past the Palmas mouth' },
    ],
    finish: { x: 470, y: 360, name: 'El Mercado' },
  },
  {
    id: 'mercado', name: 'Mercado Loop', start: { x: 726, y: 353 }, par: 100, prize: 1200,
    cps: [
      { x: 831, y: 360, name: 'the Puerto mouth' },
      { x: 840, y: 240, name: 'Av. del Puerto north' },
      { x: 840, y: 129, name: 'the Aurora crossing' },
      { x: 720, y: 120, name: 'Calle Aurora' },
      { x: 609, y: 129, name: 'the Central mouth' },
    ],
    finish: { x: 609, y: 240, name: 'back at the Taller' },
  },
  {
    id: 'puerto', name: 'Puerto Run', start: { x: 834, y: 591 }, par: 85, prize: 1000,
    cps: [
      { x: 840, y: 480, name: 'Av. del Puerto' },
      { x: 840, y: 369, name: 'the Mercado crossing' },
      { x: 720, y: 360, name: 'Calle del Mercado' },
      { x: 609, y: 360, name: 'the Central mouth' },
    ],
    finish: { x: 480, y: 360, name: 'El Mercado' },
  },
  {
    id: 'prisma', name: 'Prisma Dash', start: { x: 1086, y: 140 }, par: 95, prize: 1100,
    cps: [
      { x: 1080, y: 240, name: 'Av. Prisma' },
      { x: 1080, y: 351, name: 'the Mercado crossing' },
      { x: 1080, y: 480, name: 'past the gallery' },
      { x: 1080, y: 591, name: 'the Cielo crossing' },
      { x: 960, y: 600, name: 'Calle Cielo' },
    ],
    finish: { x: 849, y: 600, name: 'the Puerto mouth' },
  },
];

// ------------------------------------------------------------- stunts
// Eight ramps set into the street grid: cross one fast, on its line,
// and the car leaves the ground. A landing on open ground counts the
// ramp once; the distance and air time are the sim's own numbers.
export const STUNTS = [
  { id: 'cruce', name: 'Cruce Central', x: 545, y: 364.6, angle: 0 },
  { id: 'palmas', name: 'Salto Palmas', x: 363.5, y: 352, angle: Math.PI / 2 },
  { id: 'faro', name: 'Vuelo Faro', x: 123.5, y: 593, angle: Math.PI / 2 },
  { id: 'puerto', name: 'Brisa Hop', x: 836.5, y: 367, angle: -Math.PI / 2 },
  { id: 'prisma', name: 'Salto Prisma', x: 1074, y: 595.4, angle: Math.PI },
  { id: 'marina', name: 'Marina Skip', x: 1150, y: 766, angle: Math.PI / 2 },
  { id: 'aurora', name: 'Aurora Air', x: 356.5, y: 127, angle: -Math.PI / 2 },
  { id: 'playa', name: 'Playa Skim', x: 30, y: 762, angle: 0 },
];
export const STUNT_MIN_SPEED = 13;

// --------------------------------------------------------- caracolas
// Twelve golden conch shells, one hidden in plain sight per landmark.
export const CARACOLAS = [
  { id: 'faro', name: 'Faro Light', x: 58, y: 668 },
  { id: 'playa-oeste', name: 'Playa Oeste', x: 200, y: 762 },
  { id: 'muelle', name: 'Muelle End', x: 1148, y: 860 },
  { id: 'taller', name: 'Yard Shell', x: 720, y: 240 },
  { id: 'torre', name: 'Torre Steps', x: 662, y: 61 },
  { id: 'viejo', name: 'Puerto Viejo', x: 88, y: 116 },
  { id: 'clinica', name: 'Clínica Gate', x: 298, y: 480 },
  { id: 'prisma', name: 'Prisma Steps', x: 960, y: 119 },
  { id: 'isla', name: 'Isla Pump', x: 662, y: 596 },
  { id: 'cine', name: 'Cine Door', x: 182, y: 116 },
  { id: 'motel', name: 'Motel Shell', x: 960, y: 480 },
  { id: 'playa-este', name: 'Playa Este', x: 1050, y: 762 },
];
export const SHELL_PAY = 120;

// ------------------------------------------------------------ progress
export function newProgress() {
  return { racesBest: {}, stuntsLanded: [], caracolasFound: [] };
}

// Read a save-shaped object into a clean progress record: unknown ids
// and bad values are dropped, so a save can never print a count the
// world does not actually hold.
export function sanitizeProgress(s) {
  const p = newProgress();
  if (!s || typeof s !== 'object') return p;
  if (s.racesBest && typeof s.racesBest === 'object') {
    for (const r of RACES) {
      const v = s.racesBest[r.id];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) p.racesBest[r.id] = v;
    }
  }
  if (Array.isArray(s.stuntsLanded)) {
    for (const id of s.stuntsLanded) {
      if (STUNTS.some((r) => r.id === id) && !p.stuntsLanded.includes(id)) p.stuntsLanded.push(id);
    }
  }
  if (Array.isArray(s.caracolasFound)) {
    for (const id of s.caracolasFound) {
      if (CARACOLAS.some((c) => c.id === id) && !p.caracolasFound.includes(id)) p.caracolasFound.push(id);
    }
  }
  return p;
}

export function raceWins(p) {
  let n = 0;
  for (const r of RACES) {
    const best = p && p.racesBest ? p.racesBest[r.id] : undefined;
    if (typeof best === 'number' && best <= r.par) n++;
  }
  return n;
}

// The career line, from save state only: the story is the bulk of a
// life in Solano Bay, the street layer is the rest of it. The story
// count is the save's missionIndex — missions.storyDone is the
// boolean all-done flag, not a count.
export function careerPct(s) {
  if (!s || typeof s !== 'object') return 0;
  const story = clamp01((s.missionIndex || 0) / 15);
  const jobs = clamp01(Math.min(s.jobsDone || 0, 10) / 10);
  const races = clamp01(raceWins(s) / RACES.length);
  const stunts = clamp01((Array.isArray(s.stuntsLanded) ? s.stuntsLanded.length : 0) / STUNTS.length);
  const shells = clamp01((Array.isArray(s.caracolasFound) ? s.caracolasFound.length : 0) / CARACOLAS.length);
  return Math.round(100 * (0.55 * story + 0.10 * jobs + 0.10 * races + 0.10 * stunts + 0.15 * shells));
}

// ------------------------------------------------------------ the system
export class Activities {
  constructor(G) {
    this.G = G;
    this.race = null; // { def, idx, t, offT } — idx indexes cps, then finish
  }

  progress() {
    const G = this.G;
    if (!G.progress) G.progress = newProgress();
    return G.progress;
  }

  banner(title, sub, t = 3.2) {
    this.G.banner = { title, sub, t };
  }

  raceTarget() {
    if (!this.race) return null;
    const { def, idx } = this.race;
    return idx < def.cps.length ? def.cps[idx] : def.finish;
  }

  // Distance from a point to the race's route — the polyline through
  // start, checkpoints and finish. Backtracking along the route is
  // legal in a street race; only leaving its corridor abandons it.
  distToRoute(def, x, y) {
    const pts = [def.start, ...def.cps, def.finish];
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / len2)) : 0;
      const d = Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
      if (d < best) best = d;
    }
    return best;
  }

  startRace(def) {
    const G = this.G;
    if (this.race || G.missions.active || !G.player.car) return false;
    this.race = { def, idx: 0, t: 0, offT: 0 };
    this.banner('STREET RACE', `${def.name} · beat ${fmtTime(def.par)} for $${def.prize.toLocaleString('en-US')}`, 3.0);
    if (G.audio && G.audio.blip) G.audio.blip(520, 0.09, 0.12);
    return true;
  }

  startRaceById(id) {
    const def = RACES.find((r) => r.id === id);
    return def ? this.startRace(def) : false;
  }

  cancelRace(why) {
    if (!this.race) return;
    this.race = null;
    this.lastCancel = why || 'a job started';
    if (why) this.banner('RACE OFF', why, 2.4);
  }

  finishRace() {
    const G = this.G;
    const { def, t } = this.race;
    this.race = null;
    const p = this.progress();
    const prev = p.racesBest[def.id];
    if (typeof prev !== 'number' || t < prev) p.racesBest[def.id] = Math.round(t * 10) / 10;
    if (t <= def.par) {
      G.player.cash += def.prize;
      this.banner('RACE WON', `${def.name} · ${fmtTime(t)} · beat ${fmtTime(def.par)} · +$${def.prize.toLocaleString('en-US')}`, 3.6);
    } else {
      this.banner('RACE LOST', `${def.name} · ${fmtTime(t)} · par was ${fmtTime(def.par)}`, 3.4);
    }
    if (G.audio && G.audio.blip) G.audio.blip(t <= def.par ? 880 : 330, 0.1, 0.12);
    writeSave(G);
  }

  onLanded(car, jl) {
    const G = this.G;
    // A flight can end over a roof or the water: settle the car on the
    // nearest open ground before anything counts it.
    if (carCollidesAt(car.x, car.y, car.angle, car.model)) {
      let placed = false;
      for (let r = 1; r <= 9 && !placed; r += 1) {
        for (let k = 0; k < 10 && !placed; k++) {
          const a = (k / 10) * Math.PI * 2;
          const nx = car.x + Math.cos(a) * r;
          const ny = car.y + Math.sin(a) * r;
          if (!carCollidesAt(nx, ny, car.angle, car.model)) {
            car.x = nx;
            car.y = ny;
            placed = true;
          }
        }
      }
      if (!placed) {
        car.x = jl.x0;
        car.y = jl.y0;
      }
      car.vx = 0;
      car.vy = 0;
    }
    const ramp = STUNTS.find((s) => s.id === jl.ramp);
    if (!ramp) return;
    const p = this.progress();
    const d = Math.round(jl.dist);
    if (!p.stuntsLanded.includes(ramp.id)) {
      p.stuntsLanded.push(ramp.id);
      this.banner(`STUNT ${p.stuntsLanded.length}/${STUNTS.length}`, `${ramp.name} · ${d} m in the air for ${jl.airT.toFixed(1)} s`, 3.4);
      writeSave(G);
    } else {
      this.banner('STUNT', `${ramp.name} · ${d} m · already counted`, 2.6);
    }
    if (G.audio && G.audio.blip) G.audio.blip(740, 0.08, 0.1);
  }

  update(dt) {
    const G = this.G;
    if (G.mode !== 'play') return;
    const p = this.progress();
    const car = G.player.car;
    const px = car ? car.x : G.player.x;
    const py = car ? car.y : G.player.y;

    // A job starting ends a race: Val's work outranks the street.
    if (this.race && G.missions.active) this.cancelRace(null);

    // Caracolas: close enough is a find, on foot or through a windscreen.
    for (const c of CARACOLAS) {
      if (p.caracolasFound.includes(c.id)) continue;
      if (dist(px, py, c.x, c.y) <= 2.6) {
        p.caracolasFound.push(c.id);
        G.player.cash += SHELL_PAY;
        this.banner(`CARACOLA ${p.caracolasFound.length}/${CARACOLAS.length}`, `${c.name} · +$${SHELL_PAY}`, 2.8);
        if (G.audio && G.audio.blip) G.audio.blip(980, 0.07, 0.1);
        writeSave(G);
      }
    }

    if (car && !car.dead) {
      // A landing the physics branch just settled.
      if (car.justLanded) {
        const jl = car.justLanded;
        car.justLanded = null;
        this.onLanded(car, jl);
      }
      // Ramp triggers: fast, on the ramp's line, over its plate.
      if (!car.air) {
        const sp = Math.abs(speedOf(car));
        if (sp >= STUNT_MIN_SPEED) {
          for (const r of STUNTS) {
            if (dist(car.x, car.y, r.x, r.y) > 3.2) continue;
            let da = Math.atan2(Math.sin(car.angle - r.angle), Math.cos(car.angle - r.angle));
            if (Math.abs(da) > 0.55) continue;
            car.air = {
              t: 0,
              dur: Math.min(0.95, Math.max(0.55, 0.5 + sp * 0.013)),
              x0: car.x, y0: car.y, ramp: r.id,
            };
            if (G.audio && G.audio.blip) G.audio.blip(440, 0.08, 0.1);
            break;
          }
        }
      }
    }

    // Races.
    if (this.race) {
      const r = this.race;
      r.t += dt;
      const target = this.raceTarget();
      const d = dist(px, py, target.x, target.y);
      if (d <= 10) {
        if (r.idx < r.def.cps.length) {
          r.idx++;
          if (G.audio && G.audio.blip) G.audio.blip(660, 0.06, 0.1);
        } else {
          this.finishRace();
        }
      } else if (this.distToRoute(r.def, px, py) > 60) {
        r.offT += dt;
        if (r.offT > 10) this.cancelRace('Too far from the route — the field leaves without you.');
      } else {
        r.offT = 0;
      }
    } else if (car && !G.missions.active) {
      // Start rings: roll in and the race is on.
      for (const def of RACES) {
        const d = dist(car.x, car.y, def.start.x, def.start.y);
        if (d <= 3.5) {
          this.startRace(def);
          break;
        }
        if (d <= 10 && !G.prompt) {
          G.prompt = `Street race · ${def.name} — roll into the gold ring`;
        }
      }
    }
  }

  // The HUD card while a race runs — the same shape the mission card
  // prints, fed by the race's real state.
  card() {
    if (!this.race) return null;
    const { def, idx, t } = this.race;
    const total = def.cps.length + 1;
    const at = Math.min(idx + 1, total);
    const target = this.raceTarget();
    const best = this.progress().racesBest[def.id];
    return {
      chapter: 'STREET RACE',
      title: def.name,
      objective: idx < def.cps.length
        ? `Checkpoint ${at} of ${total} — ${target.name}`
        : `Finish — ${target.name}`,
      hint: `Time ${fmtTime(t)} · par ${fmtTime(def.par)}`,
      foot: `PAYS $${def.prize.toLocaleString('en-US')} UNDER PAR · BEST ${typeof best === 'number' ? fmtTime(best) : '—'}`,
    };
  }
}

// Used by the renderer's world pass and by nothing else that mutates.
export function shellAt(id) {
  return CARACOLAS.find((c) => c.id === id) || null;
}
