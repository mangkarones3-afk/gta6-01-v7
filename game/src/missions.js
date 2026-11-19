// missions.js — the story of Nico Ferrer in five jobs for Valeria Ríos, plus
// repeatable courier and repo work. A mission is a list of stages (talk,
// steal, deliver, fight, escape, pickup); this module runs the stages, pays
// the cash, writes the dialogue and keeps the HUD's mission card honest.

import { POIS, findFree } from './city.js';
import { makeCar } from './vehicles.js';
import { writeSave } from './save.js';

export const CHARACTERS = {
  val: { name: 'Valeria Ríos', color: '#e84393', role: 'Fixer' },
  marco: { name: 'Marco Delgado', color: '#e67e22', role: 'Taller Delgado' },
  tomas: { name: 'Tomás Ibarra', color: '#00b894', role: 'El Contador' },
  duarte: { name: 'Insp. Carla Duarte', color: '#3fa9f5', role: 'SBPD' },
  nico: { name: 'Nico Ferrer', color: '#f5efe0', role: 'You' },
};

function actor(G, name, x, y, opts = {}) {
  const a = {
    kind: 'actor',
    name,
    x, y,
    angle: opts.angle || 0,
    health: 100,
    dead: false,
    hostile: !!opts.hostile,
    shirt: opts.shirt || '#636e72',
    pants: '#2d3436',
    skin: '#e0ac69',
    hair: '#2d3436',
    state: 'idle',
    walkPhase: 0,
    fireTimer: 0,
    speed: 0,
  };
  G.actors.push(a);
  return a;
}

const STORY = [
  {
    title: 'Steal the Caspián',
    chapter: 'Chapter 1 · First Wheels',
    pay: 850,
    setup(G, M) {
      const car = makeCar('caspian', 706, 369, 0, {});
      car.color = '#b03a2e';
      car.driver = null;
      G.cars.push(car);
      M.targetCar = car;
    },
    stages: [
      { type: 'talk', text: 'Answer Val', hint: 'Val is calling — listen', say: [
        ['val', 'Nico. Valeria Ríos. Marco at Taller Delgado needs a Caspián, crimson, parked by El Mercado.'],
        ['val', 'Take it, shake whoever follows, and bring it to his yard. He pays cash.'],
      ] },
      { type: 'steal', text: 'Steal the crimson Caspián by El Mercado', hint: 'Walk to the car and press E', say: [
        ['marco', 'That Caspián has a tracker, muchacho. The SBPD will notice — drive like you mean it.'],
      ] },
      { type: 'deliver', text: 'Deliver the Caspián to Taller Delgado', hint: "Marco's yard is the asphalt court behind the workshop", say: [] },
      { type: 'talk', text: 'Collect from Marco', hint: 'Marco is waiting in the yard', say: [
        ['marco', 'Clean lines, no dents that matter. You drive like family, Nico.'],
        ['marco', 'There is more work where this came from. Val will call.'],
      ] },
    ],
  },
  {
    title: 'Hot Cargo',
    chapter: 'Chapter 2 · Hot Cargo',
    pay: 1200,
    setup(G, M) {
      const van = makeCar('furgon', 113, 470, Math.PI / 2, {});
      van.color = '#7f8c8d';
      van.driver = null;
      G.cars.push(van);
      M.targetCar = van;
    },
    stages: [
      { type: 'talk', text: 'Answer Val', hint: 'A van at the port is loaded and waiting', say: [
        ['val', 'A Furgón at El Puerto is full of Galería Prisma stock that fell off a manifest.'],
        ['val', 'Drive it to the Galería loading door. Someone phoned it in, so the SBPD are warm.'],
      ] },
      { type: 'steal', text: 'Take the loaded Furgón at El Puerto', hint: 'The grey van by the quay', say: [] },
      { type: 'deliver', x: () => POIS.galeriaPrisma.x, y: () => POIS.galeriaPrisma.y, r: 9, text: 'Deliver the Furgón to Galería Prisma', hint: 'Fast and in one piece', time: 190, heat: 130, say: [
        ['duarte', 'All units — grey Furgón leaving the port, intercept on Av. Prisma.'],
      ] },
    ],
  },
  {
    title: 'The Cielo Shakedown',
    chapter: 'Chapter 3 · The Cielo Shakedown',
    pay: 1550,
    setup(G, M) {
      const door = POIS.restauranteCielo;
      M.thugs = [
        actor(G, 'Bruno', door.x - 4, door.y + 2, { shirt: '#2d3436' }),
        actor(G, 'Santi', door.x + 4, door.y + 2, { shirt: '#574b90' }),
      ];
    },
    stages: [
      { type: 'talk', text: 'Answer Val', hint: 'Restaurante Cielo owes three months', say: [
        ['val', 'Restaurante Cielo stopped paying for protection it never asked for. Collect the envelope.'],
        ['val', 'Their new doormen, Bruno and Santi, will object. Object back.'],
      ] },
      { type: 'pickup', x: () => POIS.restauranteCielo.x, y: () => POIS.restauranteCielo.y, r: 3,
        text: 'Collect the envelope at Restaurante Cielo', hint: 'On foot, at the door', say: [
          ['nico', 'Val sends me. The envelope, please.'],
        ] },
      { type: 'fight', text: 'Deal with Bruno and Santi', hint: 'Mouse aims, click fires, R reloads', heat: 215, say: [
        ['val', 'I hear shouting, Nico. Finish it and get scarce — Duarte is rolling.'],
      ] },
      { type: 'escape', maxStars: 1, text: 'Lose the SBPD', hint: 'Break their sight line — or cool down at Taller Delgado', say: [] },
      { type: 'goto', x: () => POIS.tallerYard.x, y: () => POIS.tallerYard.y, r: 9,
        text: 'Bring the envelope to Taller Delgado', hint: "Marco holds Val's cash", say: [
          ['marco', 'Heard Cielo has new doormen. Had. Val is pleased, Nico.'],
        ] },
    ],
  },
  {
    title: 'Paper Trail',
    chapter: 'Chapter 4 · Paper Trail',
    pay: 2100,
    setup(G, M) {
      const car = makeCar('mirlo', 742, 128, 0, {});
      car.color = '#c0c6cc';
      car.driver = null;
      G.cars.push(car);
      M.targetCar = car;
      M.courier = actor(G, 'The Courier', 742, 122, { shirt: '#dfe6e9' });
    },
    stages: [
      { type: 'talk', text: 'Answer Val', hint: 'A courier carries the port ledger', say: [
        ['val', 'A silver Mirlo at Torre Oficinas carries a ledger that names half the port.'],
        ['val', 'Take the car, lose the law, and park it at Librería Faro. Tomás does the rest.'],
      ] },
      { type: 'steal', text: 'Steal the silver Mirlo at Torre Oficinas', hint: 'The courier is having coffee. Move.', heat: 320, say: [
        ['duarte', 'SBPD — the Oficinas car is moving. All units converge, roadblocks up.'],
      ] },
      { type: 'escape', maxStars: 1, text: 'Lose the SBPD', hint: 'Break their sight line — or cool down at Taller Delgado', say: [] },
      { type: 'deliver', x: () => POIS.libreriaFaro.x, y: () => POIS.libreriaFaro.y, r: 9, text: 'Park the Mirlo at Librería Faro', hint: 'Leave it by the bookshop door', say: [
        ['tomas', 'The ledger is beautiful, Nico. Half the port owes me silence now.'],
      ] },
    ],
  },
  {
    title: 'High Tide Heist',
    chapter: 'Chapter 5 · High Tide Heist',
    pay: 3200,
    setup(G, M) {
      M.tomas = actor(G, 'Tomás Ibarra', POIS.cineAurora.x, POIS.cineAurora.y, { shirt: '#00b894' });
    },
    stages: [
      { type: 'talk', text: 'Answer Val', hint: 'One last job, the big one', say: [
        ['val', 'Tomás moved the port money tonight. Duarte knows. He needs to reach the marina pier.'],
        ['val', 'Pick him up at Cine Aurora and do not stop for anyone. Anyone.'],
      ] },
      { type: 'pickup', x: () => POIS.cineAurora.x, y: () => POIS.cineAurora.y, r: 6, inCar: true,
        text: 'Pick up Tomás at Cine Aurora', hint: 'Pull up beside him', heat: 430, say: [
          ['tomas', 'Drive, Nico. The tide and Inspector Duarte wait for no man.'],
          ['duarte', 'HELI-1 has eyes on the car. Nobody lets that coupé reach the water.'],
        ] },
      { type: 'deliver', x: () => POIS.marinaPier.x, y: () => POIS.marinaPier.y, r: 8,
        text: 'Reach the marina pier', hint: 'End of the pier, La Marina', time: 260, say: [] },
      { type: 'talk', text: 'See Tomás off', hint: 'The boat is waiting', say: [
        ['tomas', 'Solano Bay is yours now, Nico. Spend it somewhere warm.'],
        ['val', 'It is done. Every debt on the port has your name under it — in a good way.'],
      ] },
    ],
  },
];

const JOB_SPOTS = ['mercadoDoor', 'cineAurora', 'restauranteCielo', 'galeriaPrisma', 'libreriaFaro', 'barElPuerto', 'torreOficinas'];

export class Missions {
  constructor() {
    this.index = 0;
    this.storyDone = false;
    this.jobsDone = 0;
    this.active = null;
    this.marker = null;
  }

  get busy() {
    return !!this.active;
  }

  startStory(G) {
    if (this.storyDone || this.active) return false;
    const def = STORY[this.index];
    this.begin(G, def, 'story');
    return true;
  }

  startJob(G, kind) {
    if (this.active) return false;
    const rng = Math.random;
    if (kind === 'courier') {
      const fromKey = JOB_SPOTS[Math.floor(rng() * JOB_SPOTS.length)];
      let toKey = JOB_SPOTS[Math.floor(rng() * JOB_SPOTS.length)];
      if (toKey === fromKey) toKey = 'tallerYard';
      const from = POIS[fromKey];
      const to = POIS[toKey] || POIS.tallerYard;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const def = {
        title: 'Courier Run',
        chapter: 'Side work · Courier',
        pay: Math.round(120 + dist * 0.22),
        setup() {},
        stages: [
          { type: 'pickup', x: from.x, y: from.y, r: 3, text: `Pick up the package (${fromKey})`, hint: 'On foot, at the marker', say: [['nico', 'Package is in hand. Now the far side of town.']] },
          { type: 'goto', x: to.x, y: to.y, r: 6, text: 'Deliver the package', hint: 'Any wheels you like', time: Math.round(dist / 8 + 45), say: [] },
        ],
      };
      this.begin(G, def, 'job');
      return true;
    }
    // Repo job: a marked car somewhere on the grid, back to Marco's yard.
    const spot = { x: 140 + rng() * 960, y: 130 + rng() * 460 };
    const free = findFree(spot.x, spot.y, 3);
    const def = {
      title: 'Repo Job',
      chapter: 'Side work · Repo',
      pay: 265,
      setup(G2, M) {
        const car = makeCar(rng() < 0.5 ? 'mirlo' : 'brisa', free.x, free.y, rng() * Math.PI * 2, {});
        car.color = '#5d6d7e';
        car.driver = null;
        G2.cars.push(car);
        M.targetCar = car;
      },
      stages: [
        { type: 'steal', text: 'Take the marked repo car', hint: 'The owner is behind on payments — and on luck', heat: 110, say: [] },
        { type: 'deliver', text: "Deliver it to Marco's yard", hint: 'Taller Delgado pays per panel, so keep it straight', say: [['marco', 'Another one for the yard. The bay provides, eh?']] },
      ],
    };
    this.begin(G, def, 'job');
    return true;
  }

  begin(G, def, kind) {
    const M = {
      def,
      kind,
      stageIndex: 0,
      stage: null,
      stageTime: 0,
      targetCar: null,
      thugs: null,
      tomas: null,
      courier: null,
      failed: false,
    };
    def.setup(G, M);
    this.active = M;
    this.enterStage(G, M, 0);
  }

  enterStage(G, M, i) {
    M.stageIndex = i;
    M.stage = M.def.stages[i];
    M.stageTime = 0;
    const s = M.stage;
    if (s.heat) G.wanted.setStars(Math.max(G.wanted.stars(), Math.round(s.heat / 100)));
    if (s.say) for (const [who, text] of s.say) G.say(who, text);
    if (s.type === 'fight' && M.thugs) for (const t of M.thugs) t.hostile = true;
    this.refreshMarker(G, M);
  }

  refreshMarker(G, M) {
    const s = M.stage;
    if (!s) { this.marker = null; return; }
    const at = (v) => (typeof v === 'function' ? v() : v);
    if (s.type === 'steal' && M.targetCar) this.marker = { x: M.targetCar.x, y: M.targetCar.y, label: M.targetCar.model.name };
    else if (s.type === 'deliver' && M.def.stages[M.stageIndex].x) this.marker = { x: at(s.x), y: at(s.y), label: 'Deliver' };
    else if (s.type === 'deliver') this.marker = { x: POIS.tallerYard.x, y: POIS.tallerYard.y, label: 'Taller Delgado' };
    else if (s.x !== undefined) this.marker = { x: at(s.x), y: at(s.y), label: s.text };
    else if (s.type === 'fight' && M.thugs && M.thugs[0]) this.marker = { x: M.thugs[0].x, y: M.thugs[0].y, label: 'Trouble' };
    else if (s.type === 'talk' && M.kind === 'story' && this.index >= 2 && M.tomas) this.marker = { x: M.tomas.x, y: M.tomas.y, label: 'Tomás' };
    else this.marker = null;
  }

  card() {
    if (!this.active) {
      if (this.storyDone) return { chapter: 'Solano Bay', objective: 'The city is yours — J for courier work, K for repo work', hint: 'Free roam' };
      return { chapter: 'Solano Bay', objective: 'Press Enter to take the next job from Val', hint: 'Or J courier · K repo' };
    }
    const s = this.active.stage;
    return { chapter: this.active.def.chapter, objective: s.text, hint: s.hint || '' };
  }

  complete(G) {
    const M = this.active;
    const pay = M.def.pay;
    G.player.cash += pay;
    G.audio?.sting();
    G.banner = { title: M.kind === 'story' ? 'JOB DONE' : 'WORK DONE', sub: `${M.def.title} · +$${pay.toLocaleString('en-US')}`, t: 3.4 };
    if (M.kind === 'story') {
      this.index++;
      if (this.index >= STORY.length) this.storyDone = true;
    } else {
      this.jobsDone++;
    }
    // Cleanup mission actors that are done with.
    if (M.courier) M.courier.dead = true;
    this.active = null;
    this.marker = null;
    writeSave(G);
  }

  fail(G, why) {
    const M = this.active;
    if (!M) return;
    G.banner = { title: 'JOB FAILED', sub: why, t: 3.2 };
    if (M.targetCar && M.kind === 'job') {
      G.cars = G.cars.filter((c) => c !== M.targetCar);
    }
    if (M.thugs) for (const t of M.thugs) t.hostile = false;
    this.active = null;
    this.marker = null;
  }

  update(G, dt) {
    const M = this.active;
    if (!M) return;
    const s = M.stage;
    M.stageTime += dt;
    const p = G.player;
    const px = p.car ? p.car.x : p.x;
    const py = p.car ? p.car.y : p.y;
    if (s.time && M.stageTime > s.time) {
      this.fail(G, 'Out of time — the job is off.');
      return;
    }
    const at = (v) => (typeof v === 'function' ? v() : v);
    let done = false;
    switch (s.type) {
      case 'talk':
        done = G.dialogue.length === 0 && !G.currentLine;
        break;
      case 'steal':
        done = !!M.targetCar && p.car === M.targetCar;
        if (M.targetCar) this.marker = { x: M.targetCar.x, y: M.targetCar.y, label: M.targetCar.model.name };
        break;
      case 'deliver': {
        const tx = s.x !== undefined ? at(s.x) : POIS.tallerYard.x;
        const ty = s.y !== undefined ? at(s.y) : POIS.tallerYard.y;
        const inRightCar = !M.targetCar || p.car === M.targetCar || M.kind === 'story' && M.stageIndex === 2 && this.index === 4;
        done = inRightCar && !!p.car && Math.hypot(px - tx, py - ty) < (s.r || 9);
        this.marker = { x: tx, y: ty, label: 'Deliver' };
        break;
      }
      case 'goto':
        done = Math.hypot(px - at(s.x), py - at(s.y)) < (s.r || 7);
        break;
      case 'pickup': {
        const inCarOk = s.inCar ? !!p.car : !p.car;
        done = inCarOk && Math.hypot(px - at(s.x), py - at(s.y)) < (s.r || 3);
        if (done && M.tomas) {
          // Tomás gets in: he leaves the street and rides along.
          M.tomas.dead = true;
          G.passenger = 'Tomás Ibarra';
        }
        break;
      }
      case 'fight':
        done = !!M.thugs && M.thugs.every((t) => t.dead);
        if (M.thugs && M.thugs[0] && !M.thugs[0].dead) this.marker = { x: M.thugs[0].x, y: M.thugs[0].y, label: 'Trouble' };
        break;
      case 'escape':
        done = G.wanted.stars() <= (s.maxStars ?? 0) && M.stageTime > 2;
        break;
    }
    if (done) {
      if (M.stageIndex + 1 >= M.def.stages.length) this.complete(G);
      else this.enterStage(G, M, M.stageIndex + 1);
    }
    // Mission actors drift toward the player when hostile (thug pressure).
    if (M.thugs) {
      for (const t of M.thugs) {
        if (t.dead || !t.hostile) continue;
        const d = Math.hypot(p.x - t.x, p.y - t.y);
        if (!p.car && d > 7) {
          const a = Math.atan2(p.y - t.y, p.x - t.x);
          t.x += Math.cos(a) * 2.1 * dt;
          t.y += Math.sin(a) * 2.1 * dt;
          t.angle = a;
        }
      }
    }
  }
}
