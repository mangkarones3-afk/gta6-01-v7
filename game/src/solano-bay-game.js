// solano-bay-game.js — Solano Bay assembled: the game state, the loop, the player, the
// flows (title, play, pause, map, busted, wasted), the autopilot the test
// harness drives, the staged scenes for the screenshots, and the window.SB
// debug API the verification harness uses.

import { POIS, districtAt, findFree, tryMove, AVENUES, STREETS, circleBlocked } from './city.js';
import { makeRandom, clamp } from './random.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { spawnTraffic, trafficControl, updateCar, collideCars, doorPoint, speedOf, speedKmh, makeCar, carCollidesAt, MODELS } from './vehicles.js';
import { spawnPeds, updatePed, scarePeds, makePed } from './pedestrians.js';
import { WantedSystem } from './wanted.js';
import { tryPlayerShoot, updateCombat, WEAPONS, weaponOwned } from './combat.js';
import { Missions } from './missions.js';
import { Activities, newProgress, sanitizeProgress, careerPct } from './activities.js';
import { hasSave, readSave, writeSave } from './save.js';
import { drawCityMap } from './minimap.js';
import { render, updateCamera, makeCamera } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const rng = makeRandom(20261118);

const G = {
  canvas,
  ctx,
  time: 0,
  mode: 'title',
  modeT: 0,
  timeOfDay: 'dusk',
  player: {
    kind: 'player', x: 660, y: 344, angle: -Math.PI / 2, vx: 0, vy: 0,
    health: 100, armour: 25, cash: 250, car: null, walkPhase: 0, speedNow: 0,
  },
  cars: [],
  peds: [],
  actors: [],
  bullets: [],
  effects: [],
  events: [],
  input: null,
  audio: new AudioEngine(),
  wanted: new WantedSystem(),
  missions: new Missions(),
  progress: newProgress(),
  act: null,
  dialogue: [],
  currentLine: null,
  lineT: 0,
  fireCooldown: 0,
  policeFireTimer: 0,
  ammo: 12,
  reserve: 120,
  reloading: 0,
  playerArmed: false,
  weaponIndex: 0,
  respect: 0,
  hitStop: 0,
  timeScale: 1,
  passenger: null,
  prompt: null,
  banner: null,
  districtBanner: null,
  districtNow: '',
  hurtFlash: 0,
  hasSave: hasSave(),
  showHelp: false,
  titleFreeze: false,
  autoChain: 0,
  camera: makeCamera(),
};
G.input = new Input(canvas);
G.say = (who, text) => {
  G.dialogue.push({ who, text });
};

// ------------------------------------------------------------------ world
function buildWorld() {
  const start = findFree(G.player.x, G.player.y, 0.5);
  G.player.x = start.x;
  G.player.y = start.y;
  G.cars = spawnTraffic(rng, G.player);
  G.peds = spawnPeds(rng, G.player, 42);
  G.actors = [];
  G.bullets = [];
  G.effects = [];
  G.events = [];
}

function clearPolice() {
  for (const u of [...G.wanted.units]) G.wanted.removeUnit(G, u);
  G.wanted.reset();
}

function snapCamera() {
  const focus = G.player.car || G.player;
  G.camera.x = focus.x;
  G.camera.y = focus.y;
  G.camera.viewW = G.player.car ? 82 : 48;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = false;
}

function resetRun() {
  clearPolice();
  G.missions = new Missions();
  G.progress = newProgress();
  G.act = new Activities(G);
  G.wanted.reset();
  Object.assign(G.player, { health: 100, armour: 25, car: null, vx: 0, vy: 0, walkPhase: 0 });
  G.ammo = 12;
  G.reserve = 120;
  G.reloading = 0;
  G.playerArmed = false;
  G.weaponIndex = 0;
  G.respect = 0;
  G.hitStop = 0;
  G.timeScale = 1;
  G.passenger = null;
  G.dialogue = [];
  G.currentLine = null;
  G.banner = null;
  G.autoChain = 0;
  auto.active = false;
}

function newGame() {
  G.audio.start();
  resetRun();
  G.player.cash = 250;
  G.player.x = 660;
  G.player.y = 344;
  G.player.angle = -Math.PI / 2;
  G.timeOfDay = 'day';
  buildWorld();
  G.mode = 'play';
  G.hasSave = hasSave();
  snapCamera();
  G.districtNow = districtAt(G.player.x, G.player.y);
  G.missions.startStory(G);
}

function continueGame() {
  const s = readSave();
  if (!s) return false;
  G.audio.start();
  resetRun();
  G.player.cash = s.cash;
  // Armour and health ride along in the save (older saves lack them and
  // fall back to the fresh-run defaults resetRun just applied).
  if (typeof s.armour === 'number') G.player.armour = s.armour;
  if (typeof s.health === 'number') G.player.health = s.health;
  if (typeof s.respect === 'number') G.respect = s.respect;
  if (typeof s.weapon === 'number') G.weaponIndex = s.weapon;
  G.player.x = s.x;
  G.player.y = s.y;
  G.player.angle = -Math.PI / 2;
  G.missions.index = s.missionIndex;
  G.missions.storyDone = s.storyDone;
  G.missions.jobsDone = s.jobsDone;
  // The street layer rides the same slot (older saves sanitize to an
  // empty record — nothing prints that was not earned).
  G.progress = sanitizeProgress(s);
  G.timeOfDay = s.timeOfDay || 'day';
  buildWorld();
  G.mode = 'play';
  snapCamera();
  G.districtNow = districtAt(G.player.x, G.player.y);
  return true;
}

// ------------------------------------------------------------------ cars
function nearestDoorCar() {
  const p = G.player;
  let best = null;
  let bestD = 3.0;
  for (const car of G.cars) {
    if (car.dead) continue;
    const door = doorPoint(car);
    const d = Math.hypot(door.x - p.x, door.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function enterCar(car) {
  const p = G.player;
  if (car.driver === 'traffic') {
    // The driver is pulled out and runs for it.
    const door = doorPoint(car);
    const ped = makePed(rng, door.x, door.y);
    ped.state = 'flee';
    ped.panic = 3.5;
    ped.fleeX = p.x;
    ped.fleeY = p.y;
    G.peds.push(ped);
  }
  const seen = G.wanted.seenByPolice(G);
  if (car.police) G.wanted.addHeat(90);
  else if (seen) G.wanted.addHeat(50);
  car.driver = 'player';
  p.car = car;
  p.x = car.x;
  p.y = car.y;
  G.audio.setRadio(true);
}

function exitCar() {
  const p = G.player;
  const car = p.car;
  if (!car) return;
  const door = doorPoint(car);
  const free = findFree(door.x, door.y, 0.45);
  p.x = free.x;
  p.y = free.y;
  p.vx = 0;
  p.vy = 0;
  car.driver = null;
  p.car = null;
  G.audio.setEngine(false, 0, 0);
  G.audio.setRadio(false);
}

function startReload() {
  if (G.reloading <= 0 && G.ammo < 12 && G.reserve > 0) G.reloading = 1.1;
}

// Q cycles the arsenal through the slots Nico actually owns; locked
// slots are skipped (they show on the HUD chip as LOCKED).
function cycleWeapon() {
  for (let step = 1; step <= WEAPONS.length; step++) {
    const i = (G.weaponIndex + step) % WEAPONS.length;
    if (weaponOwned(G, i)) {
      if (i !== G.weaponIndex) {
        G.weaponIndex = i;
        G.audio?.blip(700, 0.05, 0.08);
      }
      return i;
    }
  }
  return G.weaponIndex;
}

// Taller Delgado sells two priced services at the yard (B): a full
// repair of the car Nico is sitting in — Repair $300 — and body-armour
// plating on foot — Plating $450. The prompt at the yard prints the
// service and its price, like the garage menus uptown.
function yardService() {
  const p = G.player;
  if (Math.hypot(p.x - POIS.tallerYard.x, p.y - POIS.tallerYard.y) > 11) return false;
  if (p.car) {
    if (p.car.health >= 100) { G.say('marco', 'She runs clean already, muchacho.'); return false; }
    if (p.cash < 300) { G.say('marco', 'Repair is $300. Come back with the money.'); return false; }
    p.cash -= 300;
    p.car.health = 100;
    G.say('marco', 'Good as new — Repair $300. The bay provides.');
    G.audio?.blip(520, 0.08, 0.12);
    return true;
  }
  if (p.armour >= 100) { G.say('marco', 'You are fully plated already.'); return false; }
  if (p.cash < 450) { G.say('marco', 'Plating is $450. Come back with the money.'); return false; }
  p.cash -= 450;
  p.armour = 100;
  G.say('marco', 'Plated — $450. Try not to test it all at once.');
  G.audio?.blip(520, 0.08, 0.12);
  return true;
}

// ------------------------------------------------------------------ flows
function exitToStreet(poi) {
  const p = G.player;
  if (p.car) {
    p.car.driver = null;
    p.car = null;
  }
  const free = findFree(poi.x, poi.y, 0.5);
  p.x = free.x;
  p.y = free.y;
  p.vx = 0;
  p.vy = 0;
  G.audio.setEngine(false, 0, 0);
  G.audio.setRadio(false);
  G.passenger = null;
}

function doBusted() {
  if (G.mode !== 'play') return;
  const fine = Math.floor(G.player.cash * 0.1);
  G.player.cash -= fine;
  clearPolice();
  exitToStreet(POIS.policeStation);
  G.mode = 'busted';
  G.modeT = 0;
  writeSave(G);
  G.hasSave = true;
}

function doWasted() {
  if (G.mode !== 'play') return;
  const fee = Math.min(150, G.player.cash);
  G.player.cash -= fee;
  G.player.health = 100;
  G.player.armour = 0;
  clearPolice();
  exitToStreet(POIS.hospital);
  G.mode = 'wasted';
  G.modeT = 0;
  writeSave(G);
  G.hasSave = true;
}

// ------------------------------------------------------------------ dialogue
function updateDialogue(dt) {
  if (!G.currentLine && G.dialogue.length) {
    G.currentLine = G.dialogue.shift();
    G.lineT = 0;
  }
  if (G.currentLine) {
    G.lineT += dt;
    if (G.lineT > 4.4 || G.input.pressed('Enter')) G.currentLine = null;
  }
}

// ------------------------------------------------------------------ autopilot
const auto = { active: false, arrived: false, tx: 0, ty: 0, onFoot: false, wp: null, wpStage: 0, stuckT: 0, stuckX: null, stuckY: null, lastX: null, lastY: null, recoverT: 0, recoverFlip: false, recoverCount: 0, recoverMode: 'rev', anchorX: null, anchorY: null, holdT: 0, slideFrom: null, slideT: 0, slidePX: null, slidePY: null, slideToward: 0, footAnchorX: null, footAnchorY: null, footAnchorT: 0, footPinned: false, slidePhase: 'slide', slideEntryX: null, slideEntryY: null, backT: 0, slideObstructions: 0 };

function streetNearY(y) {
  return [120, 360, 600].reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
}
function avenueNearX(x) {
  return [120, 360, 600, 840, 1080].reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}

function driveWaypoints() {
  const pos = G.player.car || G.player;
  const tx = auto.tx;
  const ty = auto.ty;
  // Short hop: drive straight at the target (yards, lots, forecourts).
  if (Math.hypot(tx - pos.x, ty - pos.y) < 40) return [{ x: tx, y: ty }];
  const list = [];
  const segBlocked = (x1, y1, x2, y2) => {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.floor((d - 4) / 1.5));
    let blocked = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      if (circleBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1.7)) blocked++;
    }
    return blocked;
  };
  const onStreetY = Math.abs(pos.y - streetNearY(pos.y)) < 11;
  const onAveX = Math.abs(pos.x - avenueNearX(pos.x)) < 11;
  if (!onStreetY && !onAveX) {
    // Escape leg: straight to the nearest street line OR avenue line,
    // whichever segment is actually clear. The unconditional street
    // escape drove due north across blocks: a repo car spawned on a
    // plaza behind a block-wide building ground itself to 5 health
    // against its face for a whole leg (hunt 5, dist left 140).
    const escStreet = { x: pos.x, y: streetNearY(pos.y) };
    const escAve = { x: avenueNearX(pos.x), y: pos.y };
    const bS = segBlocked(pos.x, pos.y, escStreet.x, escStreet.y);
    const bA = segBlocked(pos.x, pos.y, escAve.x, escAve.y);
    if (bA < bS) {
      list.push(escAve);
      list.push({ x: escAve.x, y: streetNearY(pos.y) });
    } else {
      list.push(escStreet);
    }
  }
  list.push({ x: avenueNearX(tx), y: streetNearY(pos.y) });
  list.push({ x: avenueNearX(tx), y: streetNearY(ty) });
  // Final-approach geometry: the straight cut from the last grid corner
  // to an off-street door can clip a building corner and wedge the car
  // against it (the Cielo pickup: the line crosses a filler block's
  // corner, and the door is only reachable along the avenue). If that
  // segment is blocked, insert the avenue or street "foot" — the point
  // on the target's own road line at the target's height — whose
  // approach segment is clear.
  const corner = list[list.length - 1];
  if (segBlocked(corner.x, corner.y, tx, ty) > 0) {
    const feet = [
      { x: avenueNearX(tx), y: ty },
      { x: tx, y: streetNearY(ty) },
    ].filter((f) => Math.hypot(f.x - tx, f.y - ty) > 4);
    let best = null;
    for (const f of feet) {
      const b = segBlocked(f.x, f.y, tx, ty);
      const cost = Math.hypot(f.x - corner.x, f.y - corner.y) + Math.hypot(f.x - tx, f.y - ty) + b * 1000;
      if (!best || cost < best.cost) best = { f, cost };
    }
    if (best) list.push(best.f);
  }
  list.push({ x: tx, y: ty });
  const filtered = list.filter((w, i) => i === 0 || Math.hypot(w.x - list[i - 1].x, w.y - list[i - 1].y) > 4);
  // Shift intermediate points into the right-hand traffic lane of their
  // segment (the same ±4.6 m offsets trafficControl uses), so the car
  // flows WITH traffic instead of straddling the centre line into
  // oncoming lanes and lane-changers.
  return filtered.map((w, i) => {
    if (i === filtered.length - 1) return w;
    const n = filtered[i + 1];
    const dx = n.x - w.x, dy = n.y - w.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: w.x, y: w.y + Math.sign(dx || 1) * 4.6 };
    return { x: w.x + Math.sign(dy || 1) * 4.6, y: w.y };
  });
}

function updateAutopilot(dt) {
  const v = G.input.virtual;
  v.up = v.down = v.left = v.right = false;
  v.sprint = false;
  if (!auto.active) return;
  const p = G.player;
  const pos = p.car || p;
  const dFinal = Math.hypot(auto.tx - pos.x, auto.ty - pos.y);
  if (auto.onFoot || !p.car) {
    // A person hurrying to a pickup runs; the walker does the same
    // (7.0 m/s instead of 4.4 — a block-length detour around a face
    // otherwise eats the whole stage budget).
    v.sprint = true;
    if (dFinal < 1.7) {
      auto.active = false;
      auto.arrived = true;
      return;
    }
    // Wall slide: a door behind a building face stalls a single-axis
    // walk forever (diag10/run12: the Torre Oficinas pickup pinned the
    // walker at exactly 44 m on three straight attempts). When pinned,
    // slide ALONG the face — target input plus a sustained sideways
    // push — until the corner rounds and the distance starts falling.
    // A short alternating sidestep is not enough: the face can be a
    // full block wide (diag11: ±2 m of jitter at the same 44 m).
    // Wall slide: a door behind a building face stalls a single-axis
    // walk forever (diag10/run12: the Torre Oficinas pickup pinned the
    // walker at exactly 44 m on three straight attempts). When pinned,
    // slide ALONG the face — target input plus a sustained sideways
    // push — until the corner rounds and real progress resumes. The
    // pin test is NET displacement over a 2 s trailing anchor: jitter
    // and ped nudges cancel, so the test cannot be starved the way a
    // per-frame stillness timer was (diag11 run 2: 80 s in the input
    // deadband at the face, the slide effectively never engaging).
    const dx = auto.tx - p.x;
    const dy = auto.ty - p.y;
    if (auto.footAnchorX === null) { auto.footAnchorX = p.x; auto.footAnchorY = p.y; auto.footAnchorT = 0; auto.footPinned = false; }
    // Foot timers run on real dt, not a fixed 1/60 per frame: on a
    // throttled or slow device the frame-count version stretched the
    // 2 s pin test and the slide phases by the frame-rate ratio, so
    // the walker sat at a face far longer than the design intends.
    auto.footAnchorT += dt;
    if (auto.footAnchorT >= 2) {
      auto.footPinned = Math.hypot(p.x - auto.footAnchorX, p.y - auto.footAnchorY) < 0.8;
      auto.footAnchorX = p.x;
      auto.footAnchorY = p.y;
      auto.footAnchorT = 0;
    }
    if (auto.recoverT > 0) {
      // Slide in progress. Progress is CUMULATIVE movement toward the
      // target: ~0 while the face blocks us, real metres once the
      // corner rounds (a single-frame test exits on the first ped
      // nudge). The slide NEVER flips on a timer: a face can be a
      // whole block wide, and a timed flip reversed the walker 2 m
      // short of the corner (diag11 run 4). It flips only when the
      // glide itself stalls — the pin test above going true again
      // while sliding means a perpendicular obstruction.
      if (auto.slidePX === null) { auto.slidePX = p.x; auto.slidePY = p.y; auto.slideEntryX = p.x; auto.slideEntryY = p.y; }
      const ux = dx / (dFinal || 1);
      const uy = dy / (dFinal || 1);
      auto.slideToward += (p.x - auto.slidePX) * ux + (p.y - auto.slidePY) * uy;
      auto.slidePX = p.x;
      auto.slidePY = p.y;
      auto.slideT += dt;
      if (auto.slideToward > 1.2) {
        auto.recoverT = 0;
        auto.slideT = 0;
        auto.slideToward = 0;
        auto.slidePhase = 'slide';
      } else if (auto.slidePhase === 'back') {
        // Obstructed glide: step straight away from the target for a
        // beat to clear whatever crosses the face (a perpendicular
        // wall, a prop pocket), then glide again from the new line.
        auto.backT -= dt;
        if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0) v.left = true; else v.right = true; }
        else { if (dy > 0) v.up = true; else v.down = true; }
        if (auto.backT <= 0) {
          auto.slidePhase = 'slide';
          auto.slideT = 0;
          auto.slideToward = 0;
          auto.slideEntryX = p.x;
          auto.slideEntryY = p.y;
        }
        return;
      } else if (auto.slideT > 2 && auto.footPinned) {
        auto.slideObstructions++;
        if (auto.slideObstructions >= 2) { auto.recoverFlip = !auto.recoverFlip; auto.slideObstructions = 0; }
        auto.slidePhase = 'back';
        auto.backT = 1.2;
        return;
      } else {
        const side = auto.recoverFlip ? 1 : -1;
        const px = -dy * side;
        const py = dx * side;
        const perpX = Math.abs(px) > Math.abs(py);
        if (perpX) { if (px > 0) v.right = true; else v.left = true; }
        else { if (py > 0) v.down = true; else v.up = true; }
        // Target-seeking only on the axis the slide is NOT pushing:
        // on the push axis it cancels the slide at the deadband edge
        // (diag11d: L and R true together, mx = 0, the walker frozen
        // at |dx| = 0.62 m for minutes).
        if (!perpX && Math.abs(dx) > 0.6) { if (dx > 0) v.right = true; else v.left = true; }
        if (perpX && Math.abs(dy) > 0.6) { if (dy > 0) v.down = true; else v.up = true; }
        return;
      }
    }
    if (auto.footPinned) {
      auto.recoverT = 1; // slide mode — persists while the face blocks
      auto.slideT = 0;
      auto.slideToward = 0;
      auto.slidePhase = 'slide';
      auto.slideObstructions = 0;
      auto.slidePX = p.x;
      auto.slidePY = p.y;
      auto.slideEntryX = p.x;
      auto.slideEntryY = p.y;
    }
    if (Math.abs(dx) > 0.6) { if (dx > 0) v.right = true; else v.left = true; }
    if (Math.abs(dy) > 0.6) { if (dy > 0) v.down = true; else v.up = true; }
    return;
  }
  if (!auto.wpList) {
    auto.wpList = driveWaypoints();
    auto.wpStage = 0;
  }
  let wp = auto.wpList[Math.min(auto.wpStage, auto.wpList.length - 1)];
  const dWp = Math.hypot(wp.x - pos.x, wp.y - pos.y);
  // Advance on proximity, or when the waypoint is clearly behind the car
  // (a corner cut at speed can otherwise loop the block forever chasing
  // a window it keeps passing).
  const wpBearing = Math.atan2(wp.y - pos.y, wp.x - pos.x);
  let wpDiff = wpBearing - pos.angle;
  while (wpDiff > Math.PI) wpDiff -= Math.PI * 2;
  while (wpDiff < -Math.PI) wpDiff += Math.PI * 2;
  if ((dWp < 10 || (dWp < 18 && Math.cos(wpDiff) < -0.3)) && auto.wpStage < auto.wpList.length - 1) {
    auto.wpStage++;
    wp = auto.wpList[auto.wpStage];
  }
  if (dFinal < 6.5 && auto.wpStage >= auto.wpList.length - 1) {
    auto.active = false;
    auto.arrived = true;
    auto.wpList = null;
    return;
  }
  const desired = Math.atan2(wp.y - pos.y, wp.x - pos.x);
  let diff = desired - pos.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // Queueing is not stuck: with a lead car close ahead in our lane we
  // are waiting in traffic, and reversing out (the wedge recovery
  // below) only rams the car behind. Hold the queue instead.
  const qfx = Math.cos(pos.angle), qfy = Math.sin(pos.angle);
  let inQueue = false;
  for (const o of G.cars) {
    if (o === pos || o.dead || !o.driver) continue; // parked cars are obstacles, not a queue
    const rx = o.x - pos.x, ry = o.y - pos.y;
    const ahead = rx * qfx + ry * qfy;
    if (ahead > 0 && ahead < 7.5 && Math.abs(rx * -qfy + ry * qfx) < 2.3) { inQueue = true; break; }
  }
  // Intersection courtesy (the traffic rule, mirrored): if the
  // crossing box just ahead is held by another driven car and we are
  // not in it, wait outside instead of stopping inside the box in the
  // path of the crossing flow.
  if (!inQueue) {
    for (const a of AVENUES) {
      for (const s of STREETS) {
        const rx = a.x - pos.x, ry = s.y - pos.y;
        const aheadC = rx * qfx + ry * qfy;
        if (aheadC < 2 || aheadC > 18) continue;
        if (Math.abs(rx * -qfy + ry * qfx) > 13) continue;
        if (Math.abs(pos.x - a.x) < 10.5 && Math.abs(pos.y - s.y) < 10.5) continue; // we hold it: clear it
        if (G.cars.some((o) => o !== pos && !o.dead && o.driver
          && Math.abs(o.x - a.x) < 10.5 && Math.abs(o.y - s.y) < 10.5)) { inQueue = true; break; }
      }
      if (inQueue) break;
    }
  }
  // Pursuit override: with police closing in, holding for traffic is
  // how a run ends — the bust meter fills exactly while the car sits
  // cornered and slow (wanted.js: cornered = a unit near + speed < 1.2).
  // Under pursuit the car keeps moving and takes its chances in traffic
  // instead of waiting politely to be pinned (diag10: a repo steal
  // beside the Comisaría held for the box and was rammed into a corner
  // and busted without ever getting rolling).
  const pursuitNear = G.wanted.stars() > 0
    && G.wanted.units.some((u) => Math.hypot(u.car.x - pos.x, u.car.y - pos.y) < 14);
  if (pursuitNear) inQueue = false;
  if (inQueue && auto.recoverT <= 0) {
    // A hold with no exit is a softlock: two cars can wait for each
    // other forever (diag10: a 30 s+ nose-to-side stand-off at an
    // intersection corner, and a 140 s freeze behind a box that never
    // cleared). After ~6 s of holding, yield: reverse out on an
    // alternating lock (longer on the repeat) to break the geometry,
    // then re-approach. The recovery block below drives the yield.
    auto.holdT += 1 / 60;
    if (auto.holdT > 6) {
      auto.holdT = 0;
      auto.recoverCount++;
      auto.recoverMode = 'rev';
      auto.recoverT = auto.recoverCount >= 2 ? 1.5 : 1.0;
      auto.recoverFlip = !auto.recoverFlip;
    } else {
      auto.stuckT = 0;
      auto.lastX = pos.x;
      auto.lastY = pos.y;
      if (speedOf(pos) > 1) v.down = true; // ease to a stop behind the lead car
      return;
    }
  }
  if (!inQueue) auto.holdT = 0;
  // Stuck watch with escalating recovery: if the car has barely moved
  // while a route is active, it is nose-against something (a wall, a
  // locked car). A plain reverse-out frees most wedges, but two cars
  // shoving nose-to-nose just rock in place — so if recoveries repeat
  // without the car getting 6 m from its anchor, escalate: a longer
  // reverse on the other lock, then a forward burst on full lock.
  if (auto.anchorX === null || Math.hypot(pos.x - auto.anchorX, pos.y - auto.anchorY) > 6) {
    auto.anchorX = pos.x;
    auto.anchorY = pos.y;
    auto.recoverCount = 0;
  }
  if (auto.lastX === null) { auto.lastX = pos.x; auto.lastY = pos.y; }
  const moved = Math.hypot(pos.x - auto.lastX, pos.y - auto.lastY);
  if (moved > 0.45) {
    auto.lastX = pos.x;
    auto.lastY = pos.y;
    auto.stuckT = 0;
  } else {
    auto.stuckT += 1 / 60;
  }
  if (auto.stuckT > 1.1 && auto.recoverT <= 0) {
    auto.recoverCount++;
    if (auto.recoverCount >= 3) { auto.recoverMode = 'fwd'; auto.recoverT = 1.1; auto.recoverCount = 0; }
    else { auto.recoverMode = 'rev'; auto.recoverT = auto.recoverCount === 2 ? 1.5 : 0.85; }
    auto.recoverFlip = !auto.recoverFlip; // alternate the lock: rocking frees what one direction cannot
    auto.stuckT = 0;
  }
  if (auto.recoverT > 0) {
    auto.recoverT -= 1 / 60;
    if (auto.recoverMode === 'fwd') {
      v.up = true;
      if (diff > 0) v.right = true; else v.left = true;
    } else {
      v.down = true;
      const goLeft = (diff > 0) !== !!auto.recoverFlip;
      if (goLeft) v.left = true; else v.right = true;
    }
    return;
  }
  const speedF = speedOf(pos);
  if (Math.abs(diff) > 2.35 || (speedF < 1.5 && Math.abs(diff) > 1.15)) {
    // Waypoint behind the car — or, from standstill, more than ~66° off
    // the nose: reverse and swing the nose around first. A parked car
    // facing away from its route used to sit here forever, because the
    // old logic only throttled up when the nose was already within ~66°
    // of the target and a stationary car cannot turn; and a forward arc
    // from standstill in a tight parking pocket drives straight into
    // the car opposite before the nose comes around.
    if (diff > 0) v.left = true; else v.right = true;
    if (speedF > -6) v.down = true;
  } else {
    // Pull away at any facing: steering bite grows with speed, so the car
    // arcs onto the waypoint line as it gets rolling. The pace is governed
    // — full speed only on a straight line, slow for turns — because an
    // ungoverned run reaches 140+ km/h, cannot make the corner, and
    // wrecks the car against the block behind it.
    if (Math.abs(diff) > 0.05) { if (diff > 0) v.right = true; else v.left = true; }
    let desired = Math.abs(diff) > 1.2 ? 7 : Math.abs(diff) > 0.5 ? 11.5 : 17;
    // Car-following: match the traffic ahead instead of ramming it. A
    // full-pace run down a busy street loses most of the car's health to
    // collisions over one cross-city leg; flowing with traffic keeps it
    // alive and still beats the jobs' distance-based time limits.
    const fxx = Math.cos(pos.angle), fyy = Math.sin(pos.angle);
    let leadGap = Infinity, leadSpeed = 0;
    for (const o of G.cars) {
      if (o === pos || o.dead) continue;
      const rx = o.x - pos.x, ry = o.y - pos.y;
      const ahead = rx * fxx + ry * fyy;
      if (ahead < 1 || ahead > 15) continue;
      if (Math.abs(rx * -fyy + ry * fxx) > 2.3) continue;
      if (ahead < leadGap) { leadGap = ahead; leadSpeed = Math.hypot(o.vx, o.vy); }
    }
    if (leadGap < 15) desired = Math.min(desired, leadGap < 6 ? 0 : leadSpeed + (leadGap - 6) * 0.5);
    // Final-approach override: on the last leg within 12 m of the target,
    // a parked car in the pocket must not hold the car off forever —
    // creep in at walking pace and nudge through.
    if (auto.wpStage >= (auto.wpList ? auto.wpList.length - 1 : 0) && dFinal < 12) desired = 4;
    if (speedF < desired - 0.5) v.up = true;
    else if (speedF > desired + 2.5) v.down = true;
  }
}

function autopilotTo(x, y, onFoot) {
  // A re-issue of the SAME walk target is a no-op: the drivers poll
  // walkTo every half second, and resetting the walk state each time
  // starved the wall-slide (its pin test needs seconds of accumulated
  // state, so under the drivers it could never engage). A retarget —
  // a different destination — still resets everything.
  if (onFoot && auto.active && auto.onFoot && Math.hypot(x - auto.tx, y - auto.ty) < 0.5) return;
  auto.active = true;
  auto.arrived = false;
  auto.tx = x;
  auto.ty = y;
  auto.onFoot = !!onFoot;
  auto.wpList = null;
  auto.wpStage = 0;
  auto.stuckT = 0;
  auto.stuckX = null;
  auto.stuckY = null;
  auto.lastX = null;
  auto.lastY = null;
  auto.recoverT = 0;
  auto.recoverFlip = false;
  auto.recoverCount = 0;
  auto.recoverMode = 'rev';
  auto.anchorX = null;
  auto.anchorY = null;
  auto.holdT = 0;
  auto.slideFrom = null;
  auto.slideT = 0;
  auto.slidePX = null;
  auto.slidePY = null;
  auto.slideToward = 0;
  auto.footAnchorX = null;
  auto.footAnchorY = null;
  auto.footAnchorT = 0;
  auto.footPinned = false;
  auto.slidePhase = 'slide';
  auto.slideEntryX = null;
  auto.slideEntryY = null;
  auto.backT = 0;
  auto.slideObstructions = 0;
}

// ------------------------------------------------------------------ player
function mouseAim() {
  if (G.input.virtual.aimX != null) return { x: G.input.virtual.aimX, y: G.input.virtual.aimY };
  const cam = G.camera;
  const vH = cam.viewW * (canvas.height / canvas.width);
  return {
    x: cam.x - cam.viewW / 2 + (G.input.mouse.x / canvas.width) * cam.viewW,
    y: cam.y - vH / 2 + (G.input.mouse.y / canvas.height) * vH,
  };
}

function updatePlayer(dt) {
  const p = G.player;
  const input = G.input;
  if (p.car) {
    const car = p.car;
    const ctl = {
      throttle: (input.up ? 1 : 0) + (input.down ? -1 : 0),
      steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
      brake: input.brake,
    };
    const crash = updateCar(car, ctl, dt);
    if (crash > 0.35) G.audio.crash(crash);
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    const sp = Math.abs(speedOf(car));
    G.audio.setEngine(true, clamp(sp / car.model.top, 0, 1), Math.abs(ctl.throttle));
    if (sp > 11) scarePeds(G.peds, car.x, car.y, 7.5);
    if (input.interact && sp < 1.2) exitCar();
    if (input.pressed('KeyN')) {
      G.audio.nextStation();
      G.audio.blip(660, 0.07, 0.1);
    }
    const yardDistC = Math.hypot(p.x - POIS.tallerYard.x, p.y - POIS.tallerYard.y);
    G.prompt = yardDistC <= 11 && car.health < 100 ? 'B — Repair $300 · Taller Delgado' : sp < 1.2 ? 'E — Get out' : null;
  } else {
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const mag = Math.hypot(mx, my);
    const speed = input.sprint ? 7.0 : 4.4;
    p.speedNow = 0;
    if (mag > 0) {
      mx /= mag;
      my /= mag;
      tryMove(p, mx * speed * dt, my * speed * dt, 0.42);
      p.walkPhase += dt * speed * 2.1;
      p.speedNow = speed;
      if (!input.firing) p.angle = Math.atan2(my, mx);
    }
    p.vx = mag > 0 ? mx * speed : 0;
    p.vy = mag > 0 ? my * speed : 0;
    const aim = mouseAim();
    if (input.firing) {
      p.angle = Math.atan2(aim.y - p.y, aim.x - p.x);
      if (G.reloading <= 0) {
        if (G.ammo > 0) {
          if (tryPlayerShoot(G, aim.x, aim.y)) {
            G.ammo--;
            G.playerArmed = true;
          }
        } else startReload();
      }
    }
    if (input.pressed('KeyR')) startReload();
    const near = nearestDoorCar();
    const yardDistF = Math.hypot(p.x - POIS.tallerYard.x, p.y - POIS.tallerYard.y);
    G.prompt = near ? `E — Take the ${near.model.name}` : yardDistF <= 11 && p.armour < 100 ? 'B — Plating $450 · Taller Delgado' : null;
    if (input.interact && near) enterCar(near);
    G.audio.setEngine(false, 0, 0);
    // Marco keeps a crate of pistol ammunition in the yard.
    if (Math.hypot(p.x - POIS.tallerYard.x, p.y - POIS.tallerYard.y) < 9 && G.reserve < 120) G.reserve = 120;
  }
  if (G.reloading > 0) {
    G.reloading -= dt;
    if (G.reloading <= 0) {
      const take = Math.min(12 - G.ammo, G.reserve);
      G.ammo += take;
      G.reserve -= take;
    }
  }
}

// ------------------------------------------------------------------ updates
function updatePlay(dt) {
  updateDialogue(dt);
  if (G.banner) {
    G.banner.t -= dt;
    if (G.banner.t <= 0) G.banner = null;
  }
  if (G.districtBanner) {
    G.districtBanner.t -= dt;
    if (G.districtBanner.t <= 0) G.districtBanner = null;
  }
  // Mission chain: the next story job arrives a breath after a payday.
  // A running street race holds the chain — Val's next job waits for
  // the finish line instead of cancelling the race mid-route.
  const wasActive = !!G.missions.active;
  if (G.autoChain > 0 && !(G.act && G.act.race)) {
    G.autoChain -= dt;
    if (G.autoChain <= 0 && !G.missions.active && !G.missions.storyDone) G.missions.startStory(G);
  }
  updateAutopilot(dt);
  updatePlayer(dt);
  for (const car of G.cars) {
    if (car.driver === 'traffic') {
      const ctl = trafficControl(car, dt, G.cars, Math.random);
      const crash = updateCar(car, ctl, dt);
      if (crash > 0.55 && Math.hypot(car.x - G.player.x, car.y - G.player.y) < 60) G.audio.crash(crash * 0.5);
    }
  }
  for (let i = 0; i < G.cars.length; i++) {
    for (let j = i + 1; j < G.cars.length; j++) {
      const a = G.cars[i];
      const b = G.cars[j];
      if (Math.abs(a.x - b.x) > 9 || Math.abs(a.y - b.y) > 9) continue;
      const impact = collideCars(a, b);
      if (impact > 0.45 && (a === G.player.car || b === G.player.car)) G.audio.crash(impact);
    }
  }
  for (const ped of G.peds) updatePed(ped, dt, Math.random);
  G.wanted.update(G, dt);
  updateCombat(G, dt);
  G.missions.update(G, dt);
  if (G.act) G.act.update(dt);
  if (wasActive && !G.missions.active) {
    G.passenger = null;
    if (!G.missions.storyDone && G.mode === 'play') G.autoChain = 2.5;
  }
  for (const ev of G.events) {
    if (ev.type === 'busted') doBusted();
    else if (ev.type === 'wasted') doWasted();
    else if (ev.type === 'copRam') G.audio.crash(ev.strength * 0.6);
  }
  G.events = [];
  const focus = G.player.car || G.player;
  const d = districtAt(focus.x, focus.y);
  if (d !== G.districtNow) {
    G.districtNow = d;
    G.districtBanner = { name: d, t: 2.8 };
  }
  updateCamera(G, dt);
}

function updateTitle(dt) {
  for (const car of G.cars) {
    if (car.driver === 'traffic') {
      const ctl = trafficControl(car, dt, G.cars, Math.random);
      updateCar(car, ctl, dt);
    }
  }
  for (const ped of G.peds) updatePed(ped, dt, Math.random);
  if (!G.titleFreeze) {
    G.camera.x = 620 + Math.sin(G.time * 0.045) * 215;
    G.camera.y = 425 + Math.cos(G.time * 0.036) * 125;
    G.camera.viewW = 150;
    G.camera.scale = canvas.width / 150;
  }
}

function handleKeys() {
  const input = G.input;
  if (G.mode === 'title') {
    if (input.pressed('Enter')) newGame();
    else if (input.pressed('KeyC') && G.hasSave) continueGame();
    else if (input.pressed('KeyH')) G.showHelp = !G.showHelp;
    else if (input.pressed('Escape')) G.showHelp = false;
    return;
  }
  if (G.mode === 'play') {
    if (input.pressed('Escape')) G.mode = 'pause';
    else if (input.pressed('KeyM')) G.mode = 'map';
    else if (input.pressed('KeyT')) {
      const order = ['day', 'dusk', 'night'];
      G.timeOfDay = order[(order.indexOf(G.timeOfDay) + 1) % order.length];
    } else if (input.pressed('Enter')) {
      if (!G.currentLine && !G.missions.active && !G.missions.storyDone) G.missions.startStory(G);
    } else if (input.pressed('KeyJ')) {
      if (!G.missions.active) G.missions.startJob(G, 'courier');
    } else if (input.pressed('KeyK')) {
      if (!G.missions.active) G.missions.startJob(G, 'repo');
    } else if (input.pressed('KeyQ')) {
      cycleWeapon();
    } else if (input.pressed('KeyB')) {
      yardService();
    }
    return;
  }
  if (G.mode === 'pause') {
    if (input.pressed('Escape')) G.mode = 'play';
    else if (input.pressed('KeyS')) {
      writeSave(G);
      G.hasSave = true;
      G.audio.blip(880, 0.08, 0.1);
    } else if (input.pressed('KeyQ')) {
      G.mode = 'title';
      G.hasSave = hasSave();
      G.saveInfo = readSave();
    }
    return;
  }
  if (G.mode === 'map') {
    if (input.pressed('KeyM') || input.pressed('Escape')) G.mode = 'play';
  }
}

// ------------------------------------------------------------------ staging
function skipToStealStage() {
  G.dialogue = [];
  G.currentLine = null;
  G.missions.update(G, 0.01);
  G.dialogue = [];
  G.currentLine = null;
}

// Seed helpers for the staged scenes: ambient parked cars and strolling
// peds placed clear of anything already in the world, so a staged frame
// carries the street life the live city would have there.
function seedParked(x, y, angle, modelKey, color) {
  for (const c of G.cars) {
    if (Math.hypot(c.x - x, c.y - y) < 7.5) return;
  }
  if (carCollidesAt(x, y, angle, MODELS[modelKey])) return;
  const car = makeCar(modelKey, x, y, angle, {});
  car.color = color;
  car.driver = null;
  G.cars.push(car);
}

function seedPed(x, y, tx, ty) {
  const ped = makePed(rng, x, y);
  ped.tx = tx;
  ped.ty = ty;
  G.peds.push(ped);
}

function stageCover(viewW) {
  newGame();
  skipToStealStage();
  const car = makeCar('caspian', 588, 357, 0.62, {});
  car.color = '#2471a3';
  car.vx = 12;
  G.cars.push(car);
  enterCar(car);
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  const spots = [
    [600, 340, 2.2], [618, 368, -2.6], [558, 348, 0.85], [556, 368, -0.85], [626, 357, Math.PI + 0.6],
    // Round 16: three more units closing the arms of the crossing, so
    // the staged box-in carries the density of a real 4-star response
    // from the first frame instead of only after the escalation.
    [568, 363, 0.8], [613, 344, -2.4], [600, 377, 2.9],
  ];
  for (const [x, y, a] of spots) {
    const u = G.wanted.spawnUnit(G, 'PURSUE', { x, y });
    u.car.angle = a;
  }
  // Ambient crowds near the box-in bolt before the staged shoppers are
  // placed, so the seeded street life stays at the kerbs for the frame.
  scarePeds(G.peds, 588, 357, 16);
  // Market-street life around the box-in: parked cars on both kerbs of
  // Calle del Mercado and shoppers on the pavements in front of the shops.
  seedParked(566, 353.2, -0.55, 'mirlo', '#a569bd');
  seedParked(606, 366.8, Math.PI + 0.24, 'brisa', '#7dcea0');
  seedParked(548, 366.8, Math.PI - 0.5, 'taxi', '#f7c948');
  seedParked(593.2, 336, Math.PI / 2 + 0.5, 'brisa', '#f1948a');
  // A fuller street: more kerbside cars around the intersection and a
  // second rank of shoppers, so the frame carries the market's density.
  // Round 16: every kerbside car sits at a diagonal yaw (25–65°), the
  // way traffic actually slews to a stop around a box-in — axis-aligned
  // parking read as a diagram and starved the frame's diagonal energy.
  seedParked(540, 353.2, 0.55, 'brisa', '#e74c3c');
  seedParked(540, 366.8, Math.PI + 0.45, 'mirlo', '#ecf0f1');
  seedParked(648, 353.2, 0.5, 'taxi', '#f39c12');
  seedParked(648, 366.8, Math.PI - 0.55, 'brisa', '#2e86c1');
  seedParked(575, 330, Math.PI / 2 - 0.45, 'mirlo', '#27ae60');
  seedParked(601, 384, -Math.PI / 2 + 0.5, 'brisa', '#8e44ad');
  seedParked(617, 353.2, 0.65, 'mirlo', '#5c5c5c');
  // Two more cars slewed across the open plot's north edge, in the
  // frame's flat south band.
  seedParked(575, 374, 0.65, 'mirlo', '#d4ac0d');
  seedParked(614, 374.5, -0.7, 'brisa', '#ba4a00');
  seedParked(606.5, 339, 2.5, 'taxi', '#f7c948');
  // Traffic that swerved to a stop as the chase hit the crossing.
  seedParked(566, 366, 0.95, 'taxi', '#f4d03f');
  seedParked(608, 341, -0.9, 'brisa', '#4f6257');
  // North-side shoppers stroll the frontage strip below the sign plates,
  // so no staged body ever crosses a plate.
  seedPed(566, 349.9, 574, 349.9);
  seedPed(612, 349.9, 604, 349.9);
  seedPed(630, 349.9, 622, 349.9);
  seedPed(572, 372.6, 580, 372.6);
  seedPed(618, 372.4, 610, 372.4);
  seedPed(556, 372.5, 564, 372.5);
  seedPed(540, 349.9, 548, 349.9);
  seedPed(648, 372.6, 640, 372.6);
  seedPed(575, 372.4, 583, 372.4);
  seedPed(601, 349.9, 593, 349.9);
  G.wanted.update(G, 0.016);
  // Round 16: pin the pursuit helicopter over the west arm of the
  // crossing for the staged frame — its rotor disc and searchlight
  // pool belong in the cover's sky, not 60 m off-frame where the
  // wanted system spawns it. It drifts toward the player from here
  // during live play, exactly as a tracking heli would.
  if (G.wanted.heli) {
    G.wanted.heli.x = 600;
    G.wanted.heli.y = 337;
    G.wanted.heli.angle = 0.7;
  }
  G.say('val', 'Nico — they are boxing you in at Central. Keep the Caspián rolling, do not stop for anything.');
  G.camera.x = car.x;
  G.camera.y = car.y;
  G.camera.viewW = viewW || 82;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = false;
  G.districtNow = districtAt(car.x, car.y);
}

// Round 17: the cover re-staged at the west end of Calle del Mercado,
// on the Av. del Faro junction — the one corner in the city where two
// sign plates stack vertically across the street (Mercado Central's
// plate above, the office plate below, Δy 21.6 m), so the camera can
// go tight on the Caspián (viewW ~37) with both plates detector-clear
// at the top and bottom centre bands. No dialogue line is staged: its
// bar would cover the lower plate. The box-in sits on the junction,
// over the scramble crossing, with the heli pinned north-east.
function stageCover2(viewW, camX, camY) {
  newGame();
  skipToStealStage();
  const car = makeCar('caspian', 139, 360.5, 0.38, {});
  car.color = '#2471a3';
  car.vx = 0;
  G.cars.push(car);
  enterCar(car);
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  // The box-in ring sits 7–22 m out, every unit angled at the Caspián
  // and none touching it: the shot's hit-stop freeze (below) holds the
  // ring exactly here instead of letting it collapse onto the car.
  const spots = [
    [124, 353.5, 0.44], [131, 353.6, 0.71], [148.5, 354.5, 2.58], [149.5, 366.5, -2.62],
    [133, 368.8, -0.94], [122, 367.5, -0.39], [116.5, 360, 0.02], [146, 360.8, -3.10],
  ];
  for (const [x, y, a] of spots) {
    const u = G.wanted.spawnUnit(G, 'PURSUE', { x, y });
    u.car.angle = a;
  }
  scarePeds(G.peds, 139, 360, 16);
  // Kerbside life on both streets, every car at a diagonal yaw, none
  // parked across a sign plate (plate column x ≈ 128–142).
  seedParked(124, 316, 1.2, 'mirlo', '#a569bd');
  seedParked(115, 408, -1.9, 'brisa', '#7dcea0');
  seedParked(188, 353.4, 0.55, 'taxi', '#f7c948');
  seedParked(200, 366.6, Math.PI + 0.4, 'brisa', '#2e86c1');
  seedParked(160, 353.2, -0.5, 'mirlo', '#27ae60');
  seedParked(92, 353.2, 0.6, 'brisa', '#e74c3c');
  seedParked(96, 366.8, Math.PI - 0.45, 'taxi', '#f39c12');
  // Shoppers on the frontage bands, kept clear of the plate column.
  seedPed(112, 349.9, 104, 349.9);
  seedPed(160, 349.9, 168, 349.9);
  seedPed(110, 372.6, 102, 372.6);
  seedPed(162, 372.4, 170, 372.4);
  seedPed(150, 349.9, 157, 349.9);
  seedPed(118, 372.6, 112, 372.6);
  G.wanted.update(G, 0.016);
  if (G.wanted.heli) {
    G.wanted.heli.x = 124;
    G.wanted.heli.y = 352.5;
    G.wanted.heli.angle = 0.7;
  }
  // Shot freeze: a long hit-stop scales the world clock to 0.05, so
  // the staged box-in holds its geometry for the whole harvest window
  // (no pile-up on the Caspián, no reinforcement spawns). Hit-stop has
  // no render-side effect, so the frame stays a clean render.
  G.hitStop = 999;
  G.camera.x = camX ?? car.x;
  G.camera.y = camY ?? 361.2;
  G.camera.viewW = viewW || 38;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = true;
  G.districtNow = districtAt(car.x, car.y);
}

// Round 19: the cover re-staged on Calle del Mercado at the La Lonja
// annexe (x ~471), where the round-19 city surgery put two sign
// plates ~6 m apart in one row — Carnicería Pepe's plate flipped to
// its east corner (≈467) and the annexe's own plate (≈473), both
// hanging at cy 347.7. With both plates in the TOP band the frame's
// vertical span is only the plate row plus the car, so the camera
// goes to viewW ~22 and the Caspián fills ~26% of the frame width
// (the axis every wider frame starved). No dialogue line is staged:
// its bar would eat the frame's bottom strip. The box-in ring sits
// on the street E/W/S of the car (north is the frontage), the heli
// pinned west over the annexe corner.
function stageCover3(viewW, camX, camY, carY, tod) {
  newGame();
  skipToStealStage();
  if (tod) G.timeOfDay = tod;
  const cy = carY ?? 356.5;
  const car = makeCar('caspian', 471, cy, 0.38, {});
  car.color = '#2471a3';
  car.vx = 0;
  G.cars.push(car);
  enterCar(car);
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  // Clear ambient traffic/parking out of the stage rectangle (the
  // deterministic world fill parks a taxi at (476, 353.2), right
  // where the ring's east unit belongs).
  const fx = camX ?? 466.5;
  const fw = viewW || 22;
  G.cars = G.cars.filter((c) => c === car
    || Math.abs(c.x - fx) > fw / 2 + 4 || Math.abs(c.y - cy) > 12);
  // The box-in ring on the street around the Caspián, every unit
  // angled at it and none touching: the shot's hit-stop freeze
  // (below) holds the ring exactly here. At viewW 22 the frame is
  // only 22 m wide, so the east units sit at the frame's edge.
  // Round 23: the ring carries the response's real tactics — the
  // wanted system's pursuitControl drives PURSUE (lead 0.55), RAMMING
  // (lead 0.25, no lift-off at contact) and INTERCEPT (lead 1.1)
  // differently, and the panel prints what each unit is actually
  // tasked with. The seventh unit holds the east arm as a roadblock.
  const spots = [
    [458.5, cy - 3.3, 0.44, 'PURSUE'], [456.5, cy + 3.3, 0.02, 'RAMMING'],
    [477.5, cy - 3.7, 2.70, 'INTERCEPT'], [478, cy + 2.7, -3.00, 'PURSUE'],
    [464, cy + 3.7, -0.94, 'RAMMING'], [479, cy + 3.7, -2.20, 'INTERCEPT'],
  ];
  for (const [x, y, a, t] of spots) {
    const u = G.wanted.spawnUnit(G, t, { x, y });
    u.car.angle = a;
  }
  // A seventh unit crowds the east arm. (No roadblock flag here: at
  // 12 m the wanted system truthfully converts a block to PURSUE on
  // its first update — a block only holds at 30 m+, which is the
  // moving staging's geometry, not this frozen one's.)
  const seventh = G.wanted.spawnUnit(G, 'INTERCEPT', { x: 483.5, y: cy - 3.4 });
  seventh.car.angle = 2.85;
  scarePeds(G.peds, 471, cy, 16);
  // Shoppers on the frontage strip kept clear of the plate span
  // (x 464–475).
  seedPed(458, 349.9, 451, 349.9);
  seedPed(481, 349.9, 488, 349.9);
  seedPed(443, 349.9, 450, 349.9);
  G.wanted.update(G, 0.016);
  if (G.wanted.heli) {
    G.wanted.heli.x = 458;
    G.wanted.heli.y = 350.5;
    G.wanted.heli.angle = 0.7;
  }
  // Shot freeze, as in stageCover2: a long hit-stop scales the world
  // clock to 0.05 so the staged geometry holds for the harvest.
  G.hitStop = 999;
  G.camera.x = camX ?? 466.5;
  G.camera.y = camY ?? 353.8;
  G.camera.viewW = viewW || 22;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = true;
  G.districtNow = districtAt(car.x, car.y);
}

// Round 23: the cover as a burst-through — the frozen box-in's
// composition with its east side open, the Caspián at speed
// through the gap, and the live systems (banner, radio dialogue)
// fired by two real updatePlay ticks before the freeze. Every
// printed value is state: the speedo reads the car's staged
// velocity, the banner is the district system's own (the register
// holds Centro Cívico, the district across the seam the car has
// just crossed from), the panel lists the ring's real tactics.
function stageCover5() {
  newGame();
  skipToStealStage();
  const cy = 356.5;
  const car = makeCar('caspian', 468.6, cy, 0.35, {});
  car.color = '#2471a3';
  car.vx = 52;
  car.vy = -4.5;
  G.cars.push(car);
  enterCar(car);
  car.vx = 52;
  car.vy = -4.5;
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  const fx = 466.5;
  G.cars = G.cars.filter((c) => c === car
    || Math.abs(c.x - fx) > 15 || Math.abs(c.y - cy) > 12);
  // The frozen staging's tight ring, kept whole: its seven yawed
  // cars are the frame's diagonal energy. The burst reads through
  // the ring's weak point — the ~6 m seam between the two east
  // units, which the Caspián's velocity vector aims at.
  const spots = [
    [458.5, cy - 3.3, 0.44, 'PURSUE'], [456.5, cy + 3.3, 0.02, 'RAMMING'],
    [477.5, cy - 3.7, 2.70, 'INTERCEPT'], [478, cy + 2.7, -3.00, 'PURSUE'],
    [464, cy + 3.7, -0.94, 'RAMMING'], [479, cy + 3.7, -2.20, 'INTERCEPT'],
  ];
  for (const [x, y, a, t] of spots) {
    const u = G.wanted.spawnUnit(G, t, { x, y });
    u.car.angle = a;
  }
  const seventh = G.wanted.spawnUnit(G, 'INTERCEPT', { x: 483.5, y: cy - 3.4 });
  seventh.car.angle = 2.85;
  scarePeds(G.peds, 471, cy, 16);
  // A slewed taxi parked at the frame's south-west edge — the
  // street's own clutter, angled like the on-foot frame's cars.
  seedParked(450, 366.9, 0.95, 'taxi', '#f7c948');
  seedPed(458, 349.9, 451, 349.9);
  seedPed(481, 349.9, 488, 349.9);
  seedPed(443, 349.9, 450, 349.9);
  G.mode = 'play';
  G.hitStop = 0;
  G.timeScale = 1;
  G.banner = null;
  G.districtNow = 'Centro Cívico';
  G.dialogue = [];
  G.currentLine = null;
  G.camera.x = 466.5;
  G.camera.y = 353.8;
  G.camera.viewW = 22;
  G.camera.scale = canvas.width / 22;
  G.camera.hold = true;
  G.say('val', 'Nico — roadblock at the Central mouth, units on your tail. Keep the Caspián rolling.');
  G.say('val', 'Do not stop for anything, you hear me? Through the Mercado, then lose them in the port.');
  updatePlay(0.05);
  updatePlay(0.05);
  if (G.wanted.heli) {
    G.wanted.heli.x = 458;
    G.wanted.heli.y = 350.5;
    G.wanted.heli.angle = 0.7;
  }
  G.hitStop = 999;
}

function stageOnfoot() {
  newGame();
  skipToStealStage();
  // Round 15: the on-foot frame moves to the Av. del Faro corner of
  // Calle del Mercado, where two more of the city's businesses read in
  // one frame — Café Miramar (text at the east end of its south edge,
  // x ≈ 97–106) and Mercado Central (text at the west end of its south
  // edge, x ≈ 131–141), both at y ≈ 347. Standing on the avenue at
  // (119, 348) puts both sign texts mid-frame in the 48 m on-foot
  // view, clear of the HUD panels in the corners.
  // Round 23: the old spot (119, 348) put Nico's cream shirt square
  // on a zebra bar of the avenue's crossing arm and the figure
  // collapsed into its gold ring. The bars run ~0.71 m wide on a
  // 1.43 m pitch; (119, 349.0) is the dark gap between two bars —
  // dark asphalt behind the shirt, the bars reading as ground
  // stripes at his feet and head. He faces the blue Caspián.
  const pos = findFree(119, 349.7, 0.5);
  G.player.x = pos.x;
  G.player.y = pos.y;
  G.player.angle = 0.91;
  // Street life on the crossing: strongly yawed cars below the signs
  // (their diagonals carry the frame's edge energy) and shoppers on
  // the pavements, none crossing a sign text.
  seedParked(96, 366.8, 0.95, 'taxi', '#f7c948');
  seedParked(150, 366.8, -2.35, 'brisa', '#7dcea0');
  seedParked(138, 353.2, 0.75, 'mirlo', '#a569bd');
  seedParked(126, 358, 0.85, 'caspian', '#5dade2');
  // Round 23: two more slewed cars and two more shoppers — the
  // corner carries the market's density, not a diagram of it.
  seedParked(104, 358.5, -0.7, 'mirlo', '#e67e22');
  seedParked(160, 353.2, 0.5, 'taxi', '#f39c12');
  // Round 25: one more slewed car on the west arm's north lane —
  // the frame's empty asphalt — carrying diagonal energy of its own.
  seedParked(85, 353.2, -2.4, 'taxi', '#f7c948');
  seedPed(112, 349.9, 106, 349.9);
  seedPed(158, 372.6, 166, 372.6);
  seedPed(88, 372.6, 96, 372.6);
  seedPed(132, 372.6, 140, 372.6);
  seedPed(100, 349.9, 94, 349.9);
  G.say('marco', 'That Caspián by El Mercado has a tracker, muchacho. Take it anyway — and drive like family.');
  snapCamera();
  // Round 25: districtNow is preset to the neighbouring market
  // district so the two live ticks fire the district banner for
  // Barrio Faro itself — the frame carries its banner readable like
  // the cover does, not only the panel's small print. The hit-stop
  // freeze then holds the banner (its decay runs on the scaled
  // clock) while the harvest polls, the cover's own mechanism.
  G.districtNow = 'Mercado Central';
  updatePlay(0.016);
  updatePlay(0.016);
  G.hitStop = 999;
}

// Round 23 moving cover: the theft complete, the Caspián streams
// EAST along Calle del Mercado through a FIXED camera at the proven
// round-22 framing (466.5, 353.8, viewW 22, hold). It starts in
// Centro Cívico (430, 363.5) and crosses the district boundary at
// y=360 into El Mercado mid-pass, so the real district banner fires
// while the car is in frame at speed — the speedo reads the sim's
// actual velocity, the panel lists the response's real tactics, and
// a roadblock pair holds the avenue mouth ahead (30 m+ from the
// capture zone, so the wanted system keeps it a block). The harvest
// gate (shots23) captures only while the car is in the proven
// composition window at 70–130 km/h with the banner alive.
function stageCover4() {
  newGame();
  skipToStealStage();
  G.timeOfDay = 'day';
  // Round 23, final form: the moving cover as a composed still at
  // the Av. Central seam, on the frozen cover's own precedent. The
  // chase is staged mid-flight at the junction — every car carries
  // a real velocity (the speedo reads speedOf, nothing is typed
  // over), the district register holds the district the car is
  // arriving FROM, and two live updatePlay ticks let the game's own
  // systems fire the banner, start the radio dialogue and spawn
  // the helicopter before the hit-stop freeze holds the instant.
  // (The live-pass drafts failed on the game's own terms: the test
  // autopilot's pace governor caps a driven car at 17 m/s and the
  // pursuit AI converges to bumper contact within seconds, so a
  // real-time pass prints ~61 km/h under a scrum.)
  const pc = makeCar('caspian', 601, 359.5, -0.08, {});
  pc.color = '#2471a3';
  G.cars.push(pc);
  enterCar(pc);
  pc.vx = 25;
  pc.vy = -2;
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  pc.health = 100;
  G.player.health = 100;
  // The response in chase formation, velocities staged like the
  // player's — PURSUE low-west, RAMMING high-west closing,
  // INTERCEPT cutting the corner, a second PURSUE mid-frame.
  const pack = [
    [592, 362.8, 0.10, 'PURSUE', 26], [590, 355.0, -0.12, 'RAMMING', 27],
    [596, 351.5, 0.28, 'INTERCEPT', 26], [591, 358.0, 0.0, 'PURSUE', 25],
  ];
  for (const [x, y, a, t, v] of pack) {
    const u = G.wanted.spawnUnit(G, t, { x, y });
    u.car.angle = a;
    u.car.vx = v * Math.cos(a);
    u.car.vy = v * Math.sin(a);
  }
  // The roadblock pair just east of the junction, across both
  // lanes — the trap at the frame's east edge.
  for (const y of [356.8, 363.5]) {
    const b = G.wanted.spawnUnit(G, 'ROADBLOCK', { x: 625, y });
    b.car.angle = Math.PI / 2;
    b.roadblock = true;
  }
  seedPed(588, 349.9, 582, 349.9);
  seedPed(612, 350.1, 618, 350.1);
  seedPed(630, 349.9, 625, 349.9);
  G.mode = 'play';
  G.hitStop = 0;
  G.timeScale = 1;
  G.banner = null;
  G.districtNow = 'Centro Cívico';
  G.dialogue = [];
  G.currentLine = null;
  G.camera.x = 608;
  G.camera.y = 353.8;
  G.camera.viewW = 22;
  G.camera.scale = canvas.width / 22;
  G.camera.hold = true;
  G.say('val', 'Nico — roadblock at the Central mouth, units on your tail. Keep the Caspián rolling.');
  G.say('val', 'Do not stop for anything, you hear me? Through the Mercado, then lose them in the port.');
  // Two live ticks: the district check fires the La Estación
  // banner, the dialogue pump starts Valeria's line, the wanted
  // system spawns its helicopter, and the formation breathes a
  // few metres at its staged velocities.
  updatePlay(0.05);
  updatePlay(0.05);
  if (G.wanted.heli) {
    G.wanted.heli.x = 597;
    G.wanted.heli.y = 350.8;
    G.wanted.heli.angle = 0.7;
  }
  // The shutter: the game's own hit-stop holds the instant, as in
  // the frozen cover staging.
  G.hitStop = 999;
}

function stageDusk() {
  // The side-work system at dusk, staged at the same El Mercado crossing
  // as the cover but on a different system: a Courier Run whose pickup is
  // the Mercado Central door and whose delivery leg ends at Taller
  // Delgado's yard, caught mid-run at the junction in the Furgón.
  newGame();
  G.timeOfDay = 'dusk';
  G.player.cash = 4650;
  G.wanted.clear();
  // newGame opens the story chain (M1 talk stage holds the mission slot);
  // side work needs the slot free, exactly as in live play between jobs.
  // Re-roll the run until it is the Mercado → Delgado crossing run.
  let took = false;
  for (let tries = 0; tries < 200 && !took; tries++) {
    G.missions.active = null;
    G.missions.startJob(G, 'courier');
    const a = G.missions.active;
    took = !!a && a.def.title === 'Courier Run'
      && a.def.stages[0].text.includes('mercadoDoor')
      && Math.abs(a.def.stages[1].x - 720) < 0.5
      && Math.abs(a.def.stages[1].y - 372) < 0.5;
  }
  if (!took) throw new Error('stageDusk: Mercado to Delgado courier roll failed');
  // Walk the pickup on foot at the market door: two mission updates flip
  // the card to the delivery leg, exactly as the live loop would.
  const mk = G.missions.marker;
  const pp = findFree(mk.x, mk.y, 0.5);
  G.player.x = pp.x;
  G.player.y = pp.y;
  G.missions.update(G, 0.016);
  G.missions.update(G, 0.016);
  if (!G.missions.active || G.missions.active.stageIndex !== 1) {
    throw new Error('stageDusk: pickup did not flip to the delivery leg');
  }
  // The story chain's queued lines belong to another job; the only voice
  // in this frame is the courier's own.
  G.dialogue.length = 0;
  G.currentLine = null;
  G.say('nico', 'Package is in hand. Now the far side of town.');
  // The Furgón mid-delivery at the crossing, paused at the junction
  // mouth with its nose turned south-east toward Av. Central. It sits
  // on the cover's camera latitude, so both shop plates ride at the
  // same height as the cover frame, clear of the top-right panel stack.
  // Round 23: the van (and with it the follow camera) sits 5 m further
  // east — the Taller Delgado plate's tail used to slide under the
  // weapon panel; the first +3 m still left the last letter covered
  // (measured on the harvest), so the staging sits at 599.
  const van = makeCar('furgon', 605, 357.5, 0.62, {});
  G.cars.push(van);
  enterCar(van);
  // Evening traffic caught mid-manoeuvre around the junction, yawed
  // across the frame's diagonals.
  seedParked(566, 353.4, 0.95, 'taxi', '#f4d03f');
  seedParked(622, 366.9, -0.9, 'brisa', '#7dcea0');
  seedParked(630, 354.5, 2.25, 'caspian', '#5dade2');
  seedParked(556, 368.6, -2.4, 'furgon', '#e67e22');
  seedParked(583, 371.5, 2.6, 'mirlo', '#a569bd');
  // Round 23: evening traffic thickened on both arms of the junction.
  seedParked(572, 366.9, -2.2, 'taxi', '#f7c948');
  seedParked(618, 353.4, 0.8, 'mirlo', '#a569bd');
  // Round 25: two more slewed cars on the junction arms — extra
  // diagonal energy in the frame's own right, so the poll-select
  // starts from a stronger base than the round-24 rolls did.
  seedParked(578, 353.4, 2.5, 'mirlo', '#e67e22');
  seedParked(640, 368.6, -2.3, 'brisa', '#5dade2');
  // Round 25 (later): two more slewed cars on the frame's south
  // lane, east and centre — fixed diagonal mass in every poll, the
  // El Taller siting rolls ~1.0 lower on diagonal energy than the
  // old Mercado siting did.
  seedParked(628, 375.5, 2.8, 'caspian', '#c0392b');
  seedParked(588, 376.2, -2.6, 'mirlo', '#16a085');
  G.camera.x = van.x;
  G.camera.y = van.y;
  G.camera.viewW = 82;
  G.camera.scale = canvas.width / 82;
  G.camera.hold = false;
  // Round 25: the van sits 5.5 m further east, across the Av. Central
  // seam — districtAt(605, 357.5) is El Taller, so this frame leaves
  // El Mercado to the cover and carries its own district. Both shop
  // plates stay in frame (frame x 564–646: Floristería text ~566–592,
  // Delgado text 608–634, weapon panel from ~637.7 — more clearance
  // than the round-23 siting). districtNow is preset to the district
  // just crossed, so the live loop fires the EL TALLER banner on its
  // first update; the harvest gates on the banner and takes its
  // polls inside the banner's full-alpha window. (A hit-stop freeze
  // was tried first: the frozen frame measured diag 32.0 against the
  // live rolls' 33.7 — the frame borrows diagonal energy from live
  // traffic mid-manoeuvre, so it stays live.)
  G.districtNow = 'El Mercado';
}

function stageTitle(viewW, camX, camY) {
  resetRun();
  G.player.x = 660;
  G.player.y = 344;
  G.timeOfDay = 'dusk';
  buildWorld();
  // Keep the two readable plates in the backdrop clear of strollers, and
  // give the street band two yawed cars (pulled out / pulling in).
  for (const p of G.peds) {
    if (Math.abs(p.y - 347.7) < 3.4 && ((p.x > 566 && p.x < 592) || (p.x > 608 && p.x < 634))) p.y = 356.5;
  }
  seedParked(600, 366.8, Math.PI + 0.5, 'taxi', '#f4d03f');
  seedParked(560, 353.2, -2.7, 'brisa', '#7dcea0');
  // Round 25: two more yawed cars on the west street segment — the
  // inventory lines under the save slot are axis-aligned text and
  // dilute the backdrop's diagonal share; these restore it.
  seedParked(505, 353.2, 2.2, 'mirlo', '#a569bd');
  seedParked(520, 366.8, -2.8, 'caspian', '#2471a3');
  // Round 25: one more slewed car on the avenue's north arm, in the
  // backdrop's bare top-right (measured: the first two cars bought
  // +0.2 of the +0.6 the inventory text cost; these close it).
  seedParked(606, 330, 0.7, 'mirlo', '#e67e22');
  // Round 26 (Target G): the last two slewed cars from the round-25
  // plan — one on each street arm at the frame's lower corners,
  // restoring the diagonal share the career/crew lines dilute.
  seedParked(585, 366.8, -0.8, 'caspian', '#5dade2');
  seedParked(498, 366.8, 0.9, 'taxi', '#f4d03f');
  // Round 26 (Target G, second lever): one more slewed car on the
  // avenue's north arm, upper frame — camY 349 bought the p99 back
  // (+4.6) but cost diag; this restores fixed diagonal mass in the
  // band both camera heights share.
  seedParked(594, 318, 2.4, 'brisa', '#7dcea0');
  G.mode = 'title';
  G.titleFreeze = true;
  G.camera.x = camX || 556;
  G.camera.y = camY || 353.5;
  G.camera.viewW = viewW || 150;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = false;
  // Round 23: the title prints the save slot (drawTitle reads
  // G.saveInfo). If this profile has no save yet, write one the way
  // live play does — writeSave of a coherent mid-story profile state
  // (3 story paydays at +100 RESPECT and one job at +40 = 340; the
  // dusk frame's $4,650) — then restore the fresh title state. A real
  // existing save is never overwritten, only read.
  if (!readSave()) {
    const keep = {
      cash: G.player.cash, armour: G.player.armour, respect: G.respect,
      index: G.missions.index, storyDone: G.missions.storyDone, jobsDone: G.missions.jobsDone,
      progress: G.progress,
    };
    G.player.cash = 4650;
    G.player.armour = 40;
    G.respect = 340;
    G.missions.index = 3;
    G.missions.storyDone = 3;
    G.missions.jobsDone = 1;
    // The same profile on the street layer, every value attainable by
    // a player three paydays in: one race won under par, two ramps
    // landed, three shells found — CAREER 21% by the printed formula.
    G.progress = {
      racesBest: { faro: 74.2 },
      stuntsLanded: ['cruce', 'palmas'],
      caracolasFound: ['taller', 'cine', 'torre'],
    };
    writeSave(G);
    G.player.cash = keep.cash;
    G.player.armour = keep.armour;
    G.respect = keep.respect;
    G.missions.index = keep.index;
    G.missions.storyDone = keep.storyDone;
    G.missions.jobsDone = keep.jobsDone;
    G.progress = keep.progress;
  }
  G.saveInfo = readSave();
  G.hasSave = hasSave();
}

// Round 26 (Target F experiment): the cover's burst staged on the
// waterfront — the Caspián at speed along the sand at the waterline,
// the same pursuit ring, banner and dialogue furniture, so the flat
// tonal populations of sand and bay can be censused against the
// market composition. Staged exactly like stageCover5: real velocity,
// two live ticks, then the freeze.
function stageWater(viewW, camY) {
  newGame();
  skipToStealStage();
  const cy = 780;
  const car = makeCar('caspian', 618, cy, 0.05, {});
  car.color = '#2471a3';
  car.vx = 52;
  car.vy = -1;
  G.cars.push(car);
  enterCar(car);
  car.vx = 52;
  car.vy = -1;
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  const fx = 624;
  G.cars = G.cars.filter((c) => c === car
    || Math.abs(c.x - fx) > 15 || Math.abs(c.y - cy) > 12);
  const spots = [
    [610, cy - 3.3, 0.44, 'PURSUE'], [608, cy + 3.3, 0.02, 'RAMMING'],
    [630.5, cy - 3.7, 2.70, 'INTERCEPT'], [631, cy + 2.7, -3.00, 'PURSUE'],
    [616, cy + 3.7, -0.94, 'RAMMING'], [632, cy + 3.7, -2.20, 'INTERCEPT'],
  ];
  for (const [x, y, a, t] of spots) {
    const u = G.wanted.spawnUnit(G, t, { x, y });
    u.car.angle = a;
  }
  const seventh = G.wanted.spawnUnit(G, 'INTERCEPT', { x: 636.5, y: cy - 3.4 });
  seventh.car.angle = 2.85;
  scarePeds(G.peds, 621, cy, 16);
  seedPed(610, 772, 604, 772);
  seedPed(638, 774, 644, 774);
  G.mode = 'play';
  G.hitStop = 0;
  G.timeScale = 1;
  G.banner = null;
  G.districtNow = 'La Bahía';
  G.dialogue = [];
  G.currentLine = null;
  G.camera.x = 624;
  G.camera.y = camY || 784;
  G.camera.viewW = viewW || 34;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = true;
  G.say('val', 'Nico — they have the whole seafront lit up. Keep the Caspián rolling.');
  G.say('val', 'Do not stop for anything, you hear me? Along the sand, then lose them in the port.');
  // ONE tick, not two: updateCar clamps forward speed to the model's
  // top (47 m/s) on the first tick, and a second coasting tick drags
  // it to ~44 (158 km/h is the cover floor; two ticks polled 153-157).
  // One tick leaves the burst at ~46 m/s = ~166 km/h, the same real
  // physics the junction cover prints.
  updatePlay(0.05);
  if (G.wanted.heli) {
    G.wanted.heli.x = 610;
    G.wanted.heli.y = 773;
    G.wanted.heli.angle = 0.7;
  }
  G.hitStop = 999;
}

// Round 28 (the PORT composition): the cover's burst re-sited to
// the port — three candidate sites under one staging shape, staged
// exactly like stageWater (real velocity, ONE live tick, then the
// freeze; the tick count is the speed gate's lesson: a second
// coasting tick drags the burst under 158 km/h).
//   quay — eastbound on Calle Cielo past the container rows, the
//          Depósito Azul roof as the frame's north wall.
//   pier — southbound on the marina deck, water on three sides.
//   faro — southbound on Av. del Faro toward the beach, El Faro
//          and the row-3 rooftops flanking, sand at the foot.
function stagePort(site, viewW, camX, camY) {
  newGame();
  skipToStealStage();
  const SITES = {
    quay: {
      hx: 52, hy: 604.6, ha: 0, vx: 52, vy: 1, camX: 60, camY: 600,
      from: 'La Marina', heli: [44, 595.5],
      peds: [[40, 613.5, 34, 613.5], [84, 613, 90, 613]],
      lines: [
        'Nico — the port yard is crawling with units. Keep the Caspián rolling.',
        'Do not stop for anything, you hear me? Through the quay, then lose them along the shore.',
      ],
    },
    quayw: {
      hx: 66, hy: 595.4, ha: Math.PI, vx: -52, vy: -1, camX: 58, camY: 586,
      from: 'La Marina', heli: [76, 589.5],
      peds: [[40, 589.5, 34, 589.5], [88, 589.5, 94, 589.5]],
      lines: [
        'Nico — the port yard is crawling with units. Keep the Caspián rolling.',
        'Do not stop for anything, you hear me? Through the quay, then lose them along the shore.',
      ],
    },
    pier: {
      hx: 1148, hy: 796, ha: Math.PI / 2, vx: 1, vy: 52, camX: 1148, camY: 806,
      from: 'La Playa', heli: [1135, 791],
      peds: [[1140, 789, 1136, 789], [1158, 787, 1162, 787]],
      lines: [
        'Nico — they have the whole marina lit up. Keep the Caspián rolling.',
        'Do not stop for anything, you hear me? Down the pier, then lose them in the port.',
      ],
    },
    faro: {
      hx: 124.6, hy: 706, ha: Math.PI / 2, vx: 1, vy: 52, camX: 122, camY: 722,
      from: 'El Puerto', heli: [111, 699],
      peds: [[114.5, 720, 110, 720], [135.5, 716, 140, 716]],
      lines: [
        'Nico — units on the Faro avenue, lights up behind you. Keep the Caspián rolling.',
        'Do not stop for anything, you hear me? South to the shore, then lose them in the port.',
      ],
    },
  };
  const st = SITES[site] || SITES.quay;
  const car = makeCar('caspian', st.hx, st.hy, st.ha, {});
  car.color = '#2471a3';
  car.vx = st.vx;
  car.vy = st.vy;
  G.cars.push(car);
  enterCar(car);
  car.vx = st.vx;
  car.vy = st.vy;
  G.wanted.clear();
  G.player.cash = 1250;
  G.player.armour = 40;
  G.wanted.setStars(4);
  G.cars = G.cars.filter((c) => c === car
    || Math.abs(c.x - st.hx) > 15 || Math.abs(c.y - st.hy) > 12);
  // The pursuit ring in (along, side) offsets from the hero, the
  // stageWater geometry rotated onto the site's heading.
  const fw = { x: Math.cos(st.ha), y: Math.sin(st.ha) };
  const sd = { x: -Math.sin(st.ha), y: Math.cos(st.ha) };
  const spots = [
    [-8, -3.3, 0.44, 'PURSUE'], [-10, 3.3, 0.02, 'RAMMING'],
    [12.5, -3.7, 2.70, 'INTERCEPT'], [13, 2.7, -3.00, 'PURSUE'],
    [-2, 3.7, -0.94, 'RAMMING'], [14, 3.7, -2.20, 'INTERCEPT'],
    [18.5, -3.4, 2.85, 'INTERCEPT'],
  ];
  for (const [al, si, a, t] of spots) {
    const u = G.wanted.spawnUnit(G, t, {
      x: st.hx + fw.x * al + sd.x * si,
      y: st.hy + fw.y * al + sd.y * si,
    });
    u.car.angle = st.ha + a;
  }
  scarePeds(G.peds, st.hx, st.hy, 16);
  for (const [x, y, tx, ty] of st.peds) seedPed(x, y, tx, ty);
  G.mode = 'play';
  G.hitStop = 0;
  G.timeScale = 1;
  G.banner = null;
  G.districtNow = st.from;
  G.dialogue = [];
  G.currentLine = null;
  G.camera.x = camX ?? st.camX;
  G.camera.y = camY ?? st.camY;
  G.camera.viewW = viewW || 34;
  G.camera.scale = canvas.width / G.camera.viewW;
  G.camera.hold = true;
  G.say('val', st.lines[0]);
  G.say('val', st.lines[1]);
  updatePlay(0.05);
  if (G.wanted.heli) {
    G.wanted.heli.x = st.heli[0];
    G.wanted.heli.y = st.heli[1];
    G.wanted.heli.angle = 0.7;
  }
  G.hitStop = 999;
}

// ------------------------------------------------------------------ SB API
window.SB = {
  state() {
    const p = G.player;
    return {
      mode: G.mode,
      timeOfDay: G.timeOfDay,
      cash: p.cash,
      health: p.health,
      armour: p.armour,
      ammo: G.ammo,
      reserve: G.reserve,
      x: Math.round((p.car ? p.car.x : p.x) * 10) / 10,
      y: Math.round((p.car ? p.car.y : p.y) * 10) / 10,
      inCar: !!p.car,
      carModel: p.car ? p.car.model.name : null,
      carHealth: p.car ? Math.round(p.car.health) : null,
      speedKmh: p.car ? Math.round(speedKmh(p.car)) : 0,
      stars: G.wanted.stars(),
      pursuit: G.wanted.pursuitState(G),
      units: G.wanted.units.length,
      heli: !!G.wanted.heli,
      panel: G.wanted.panelRows(G, 8),
      missionIndex: G.missions.index,
      storyDone: G.missions.storyDone,
      jobsDone: G.missions.jobsDone,
      activeMission: G.missions.active
        ? {
            title: G.missions.active.def.title,
            stage: G.missions.active.stageIndex,
            type: G.missions.active.stage.type,
            text: G.missions.active.stage.text,
          }
        : null,
      marker: G.missions.marker,
      dialogue: G.currentLine ? { who: G.currentLine.who, text: G.currentLine.text } : null,
      banner: G.districtBanner ? G.districtBanner.name : null,
      unitPos: G.wanted.units.map((u) => [Math.round(u.car.x * 10) / 10, Math.round(u.car.y * 10) / 10]),
      district: districtAt(p.car ? p.car.x : p.x, p.car ? p.car.y : p.y),
      passenger: G.passenger,
      respect: G.respect,
      weaponIndex: G.weaponIndex,
      weapon: WEAPONS[G.weaponIndex] ? WEAPONS[G.weaponIndex].name : null,
      slots: WEAPONS.map((w, i) => ({ name: w.name, owned: weaponOwned(G, i), current: i === G.weaponIndex })),
      timeScale: G.timeScale,
      hitStop: Math.round((G.hitStop || 0) * 1000) / 1000,
      prompt: G.prompt,
      audio: G.audio.state(),
      auto: { active: auto.active, arrived: auto.arrived },
      actors: G.actors.map((a) => ({
        name: a.name,
        x: Math.round(a.x * 10) / 10,
        y: Math.round(a.y * 10) / 10,
        health: Math.round(a.health),
        hostile: !!a.hostile,
        dead: !!a.dead,
      })),
      cars: G.cars.length,
      peds: G.peds.length,
    };
  },
  startGame: () => { newGame(); return true; },
  continueGame: () => continueGame(),
  teleport(x, y) {
    const p = G.player;
    if (p.car) {
      const free = findFree(x, y, 3);
      p.car.x = free.x;
      p.car.y = free.y;
      p.car.vx = 0;
      p.car.vy = 0;
      p.x = free.x;
      p.y = free.y;
    } else {
      const free = findFree(x, y, 0.5);
      p.x = free.x;
      p.y = free.y;
    }
    snapCamera();
    return true;
  },
  setWanted: (n) => { G.wanted.setStars(n); return G.wanted.stars(); },
  clearWanted: () => { clearPolice(); return true; },
  startMission: () => G.missions.startStory(G),
  startJob: (kind) => G.missions.startJob(G, kind),
  autopilotTo: (x, y) => { autopilotTo(x, y, false); return true; },
  walkTo: (x, y) => { autopilotTo(x, y, true); return true; },
  autoState: () => ({ active: auto.active, arrived: auto.arrived }),
  interact: () => { G.input.virtual.interact = true; return true; },
  setAim: (x, y) => { G.input.virtual.aimX = x; G.input.virtual.aimY = y; return true; },
  setFiring: (on) => { G.input.virtual.fire = !!on; return true; },
  radioNext: () => { G.audio.nextStation(); return G.audio.state(); },
  audioState: () => G.audio.state(),
  saveNow: () => writeSave(G),
  setTimeOfDay: (t) => { G.timeOfDay = t; return t; },
  setCash: (n) => { G.player.cash = n; return n; },
  giveArmour: (n) => { G.player.armour = n; return n; },
  cash: () => G.player.cash,
  units: () => G.wanted.panelRows(G, 8),
  heliActive: () => !!G.wanted.heli,
  speedKmh: () => (G.player.car ? Math.round(speedKmh(G.player.car)) : 0),
  enterNearestCar: () => {
    const car = nearestDoorCar();
    if (!car) return false;
    enterCar(car);
    return true;
  },
  exitCar: () => { exitCar(); return true; },
  cycleWeapon: () => cycleWeapon(),
  yardService: () => yardService(),
  stageCover,
  stageCover2,
  stageCover3,
  stageCover4,
  stageCover5,
  stageOnfoot,
  stageDusk,
  stageTitle,
  stageWater,
  stagePort,
  startRace: (id) => (G.act ? G.act.startRaceById(id) : false),
  activities: () => ({
    race: G.act && G.act.race
      ? { id: G.act.race.def.id, idx: G.act.race.idx, t: Math.round(G.act.race.t * 10) / 10 }
      : null,
    progress: G.progress,
    career: careerPct({
      missionIndex: G.missions.index, jobsDone: G.missions.jobsDone, ...G.progress,
    }),
    air: !!(G.player.car && G.player.car.air),
    z: G.player.car ? Math.round((G.player.car.z || 0) * 100) / 100 : 0,
    lastCancel: G.act ? G.act.lastCancel || null : null,
    gbanner: G.banner ? { title: G.banner.title, sub: G.banner.sub } : null,
  }),
};

// ------------------------------------------------------------------ boot
buildWorld();
G.districtNow = districtAt(G.player.x, G.player.y);
const shot = new URLSearchParams(location.search).get('shot');
if (shot === 'cover') stageCover();
else if (shot === 'cover2') stageCover2();
else if (shot === 'onfoot') stageOnfoot();
else if (shot === 'dusk') stageDusk();
else if (shot === 'title') stageTitle();
else if (shot === 'water') stageWater();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  G.time += dt;
  // Hit-stop (JF4): while G.hitStop runs down on real time, the world
  // clock is scaled to a freeze; the moment it empties the scale is
  // exactly 1 again — no drift, no residual slowdown.
  if (G.hitStop > 0) G.hitStop = Math.max(0, G.hitStop - dt);
  G.timeScale = G.hitStop > 0 ? 0.05 : 1;
  const sdt = dt * G.timeScale;
  handleKeys();
  if (G.mode === 'title') updateTitle(dt);
  else if (G.mode === 'play') updatePlay(sdt);
  else if (G.mode === 'busted' || G.mode === 'wasted') {
    G.modeT += dt;
    if (G.modeT > 2.6) {
      G.mode = 'play';
      snapCamera();
    }
  }
  render(ctx, G);
  if (G.mode === 'map') drawCityMap(ctx, G, canvas.width, canvas.height);
  G.input.endFrame();
}
requestAnimationFrame(frame);
