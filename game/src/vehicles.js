// vehicles.js — every car in Solano Bay: the models, the arcade physics
// (two-circle body so a 5.9 m coupé collides like one), and the traffic
// drivers who follow the street grid in right-hand lanes.

import { AVENUES, STREETS, PARK_SPOTS, circleBlocked } from './city.js';
import { clamp, makeRandom, randPick, randRange } from './random.js';

export const MODELS = {
  caspian: { name: 'Caspián', kind: 'Coupé', len: 5.9, wid: 2.35, top: 47, accel: 16, grip: 9 },
  mirlo: { name: 'Mirlo', kind: 'Sedan', len: 5.5, wid: 2.3, top: 41, accel: 13, grip: 9 },
  brisa: { name: 'Brisa', kind: 'Hatchback', len: 5.1, wid: 2.2, top: 38, accel: 12, grip: 10 },
  furgon: { name: 'Furgón', kind: 'Van', len: 6.4, wid: 2.5, top: 33, accel: 10, grip: 8 },
  taxi: { name: 'Taxi Solano', kind: 'Sedan', len: 5.5, wid: 2.3, top: 41, accel: 13, grip: 9 },
  interceptor: { name: 'Interceptor SBPD', kind: 'Police', len: 5.9, wid: 2.35, top: 51, accel: 18, grip: 10 },
};
const PAINTS = ['#d94f30', '#2471a3', '#f4d03f', '#ecf0f1', '#2e4053', '#ba4a00', '#7dcea0', '#a569bd', '#5d6d7e', '#f1948a', '#1abc9c', '#34495e'];

let nextId = 1;

export function makeCar(modelKey, x, y, angle, opts = {}) {
  const model = MODELS[modelKey];
  return {
    id: nextId++,
    kind: 'car',
    modelKey,
    model,
    x, y, angle,
    vx: 0, vy: 0,
    steerVis: 0,
    health: 100,
    color: opts.color || (modelKey === 'interceptor' ? '#e8e8e8' : modelKey === 'taxi' ? '#f7c948' : '#888888'),
    police: modelKey === 'interceptor',
    driver: opts.driver ?? null, // 'traffic' | 'player' | 'police' | null (parked)
    route: null,
    cruise: randRange(opts.rng || Math.random, 9, 13),
    lightPhase: Math.random() * Math.PI * 2,
    dead: false,
    // Stunt state (activities.js): z is the height above the ground in
    // metres while air is the flight record; both rest at ground level.
    z: 0,
    air: null,
    justLanded: null,
  };
}

export function speedOf(car) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  return car.vx * fx + car.vy * fy;
}

export function speedKmh(car) {
  return Math.abs(speedOf(car)) * 3.6;
}

// Two probe circles (front and rear axle) against the city's solids/water.
export function carCollidesAt(x, y, angle, model) {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const off = model.len * 0.27;
  const r = model.wid * 0.60;
  return (
    circleBlocked(x + fx * off, y + fy * off, r) ||
    circleBlocked(x - fx * off, y - fy * off, r)
  );
}

export function doorPoint(car) {
  const rx = Math.cos(car.angle + Math.PI / 2);
  const ry = Math.sin(car.angle + Math.PI / 2);
  return { x: car.x - rx * (car.model.wid / 2 + 0.9), y: car.y - ry * (car.model.wid / 2 + 0.9) };
}

// Advance one car by dt under a control {throttle, steer, brake}.
// Returns the crash strength (0 when the way was clear).
export function updateCar(car, control, dt) {
  // Airborne off a stunt ramp: the car holds its launch velocity on a
  // fixed arc — no throttle, no steering, no ground collision — until
  // the arc ends and activities.js settles and scores the landing.
  if (car.air) {
    const air = car.air;
    air.t += dt;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    const k = Math.min(1, air.t / air.dur);
    car.z = 4 * 2.3 * k * (1 - k);
    if (air.t >= air.dur) {
      car.air = null;
      car.z = 0;
      car.justLanded = {
        ramp: air.ramp, x0: air.x0, y0: air.y0,
        dist: Math.hypot(car.x - air.x0, car.y - air.y0), airT: air.dur,
      };
    }
    return 0;
  }
  const m = car.model;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let speedF = car.vx * fx + car.vy * fy;
  let speedR = car.vx * -fy + car.vy * fx;

  const throttle = clamp(control.throttle || 0, -1, 1);
  const steer = clamp(control.steer || 0, -1, 1);
  car.steerVis += (steer - car.steerVis) * Math.min(1, dt * 8);

  let accel = 0;
  if (throttle > 0) accel = throttle * m.accel * (speedF < 0 ? 2.2 : 1);
  else if (throttle < 0) accel = throttle * m.accel * 0.62 * (speedF > 0.5 ? 2.4 : 1);
  if (control.brake) accel -= Math.sign(speedF) * 22;
  accel -= speedF * 0.32; // drag + rolling resistance
  speedF += accel * dt;
  const top = throttle < 0 ? m.top * 0.32 : m.top;
  speedF = clamp(speedF, -top, top);
  if (throttle === 0 && !control.brake) speedF -= speedF * 0.55 * dt;

  // Steering: yaw grows with steer and speed, flips in reverse.
  const yawRate = steer * 1.9 * clamp(speedF / 7, -1, 1) * (1 - Math.min(0.45, Math.abs(speedF) / (m.top * 2.6)));
  car.angle += yawRate * dt;
  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  speedR *= Math.exp(-m.grip * dt);
  car.vx = nfx * speedF + -nfy * speedR;
  car.vy = nfy * speedF + nfx * speedR;

  const nx = car.x + car.vx * dt;
  const ny = car.y + car.vy * dt;
  if (!carCollidesAt(nx, ny, car.angle, m)) {
    car.x = nx;
    car.y = ny;
    return 0;
  }
  // Crash: stop dead, take damage, report the strength for sound and shake.
  // Below ~19 km/h nose pressure is free: a car wedged against a wall
  // and throttling used to take damage every burst until it wrecked.
  const strength = Math.min(1, Math.abs(speedF) / 18);
  if (strength > 0.3) car.health = Math.max(5, car.health - strength * 22);
  car.vx *= 0.1;
  car.vy *= 0.1;
  return strength;
}

// Soft push-apart for car-to-car contact; returns impact strength.
export function collideCars(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const min = (a.model.len + b.model.len) * 0.30;
  if (d2 > min * min || d2 === 0) return 0;
  const d = Math.sqrt(d2);
  const push = (min - d) / 2;
  const ux = dx / d;
  const uy = dy / d;
  if (!carCollidesAt(a.x - ux * push, a.y - uy * push, a.angle, a.model)) { a.x -= ux * push; a.y -= uy * push; }
  if (!carCollidesAt(b.x + ux * push, b.y + uy * push, b.angle, b.model)) { b.x += ux * push; b.y += uy * push; }
  const rel = Math.abs((a.vx - b.vx) * ux + (a.vy - b.vy) * uy);
  const swap = 0.35;
  a.vx -= ux * rel * swap; a.vy -= uy * rel * swap;
  b.vx += ux * rel * swap; b.vy += uy * rel * swap;
  // Damage only on a real impact. Low-speed shoves just push apart —
  // a stationary car caught in an intersection shoving match used to
  // be ground from full health to wrecked without ever moving.
  if (rel > 6) {
    const dmg = (rel - 6) * 1.1;
    a.health = Math.max(5, a.health - dmg);
    b.health = Math.max(5, b.health - dmg);
  }
  return Math.min(1, rel / 16);
}

// ------------------------------------------------------------- traffic AI
function laneTarget(car) {
  if (!car.route) {
    // Start on the nearest street, heading along it.
    let bestA = null;
    let bestD = 1e9;
    for (const a of AVENUES) { const d = Math.abs(car.x - a.x); if (d < bestD) { bestD = d; bestA = { axis: 'v', line: a.x }; } }
    for (const s of STREETS) { const d = Math.abs(car.y - s.y); if (d < bestD) { bestD = d; bestA = { axis: 'h', line: s.y }; } }
    const dir = Math.random() < 0.5 ? 1 : -1;
    car.route = { axis: bestA.axis, line: bestA.line, dir };
  }
  return car.route;
}

export function trafficControl(car, dt, cars, rng) {
  const r = laneTarget(car);
  const lookAhead = 16 + Math.abs(speedOf(car)) * 0.9;
  let tx;
  let ty;
  if (r.axis === 'v') {
    tx = r.line + (r.dir > 0 ? 4.6 : -4.6);
    ty = car.y + r.dir * lookAhead;
  } else {
    tx = car.x + r.dir * lookAhead;
    ty = r.line + (r.dir > 0 ? 4.6 : -4.6);
  }
  // At an intersection, sometimes turn onto the crossing street.
  const nearCross = r.axis === 'v'
    ? STREETS.some((s) => Math.abs(car.y - s.y) < 7)
    : AVENUES.some((a) => Math.abs(car.x - a.x) < 7);
  if (nearCross && !car.turnCooldown) {
    if (rng() < 0.006) {
      if (r.axis === 'v') {
        const s = STREETS.reduce((p, c) => (Math.abs(c.y - car.y) < Math.abs(p.y - car.y) ? c : p));
        car.route = { axis: 'h', line: s.y, dir: rng() < 0.5 ? 1 : -1 };
      } else {
        const a = AVENUES.reduce((p, c) => (Math.abs(c.x - car.x) < Math.abs(p.x - car.x) ? c : p));
        car.route = { axis: 'v', line: a.x, dir: rng() < 0.5 ? 1 : -1 };
      }
      car.turnCooldown = 4;
    }
  }
  if (car.turnCooldown) car.turnCooldown = Math.max(0, car.turnCooldown - dt);
  // World edge: turn around by flipping direction at the far end.
  if (r.axis === 'v' && (car.y < 30 || car.y > 720)) car.route.dir = car.y < 30 ? 1 : -1;
  if (r.axis === 'h' && (car.x < 30 || car.x > 1218)) car.route.dir = car.x < 30 ? 1 : -1;

  const desired = Math.atan2(ty - car.y, tx - car.x);
  let diff = desired - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = clamp(diff * 2.2, -1, 1);

  // Slow for anything ahead in our lane. When already stopped behind a
  // car, WAIT (throttle 0, brake held) instead of reversing into the
  // car behind — the old -0.4 reverse at any speed made whole queues
  // accordion into each other at intersections and never clear.
  let throttle = 0.75;
  let holdStill = false;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  for (const other of cars) {
    if (other === car || other.dead) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(dx * -fy + dy * fx);
    if (ahead > 0 && ahead < 13 && side < 2.6) {
      if (ahead < 7 && Math.abs(speedOf(car)) <= 1.5) { throttle = 0; holdStill = true; }
      else throttle = ahead < 7 ? -0.4 : 0.1;
      break;
    }
  }
  if (Math.abs(speedOf(car)) > car.cruise) throttle = Math.min(throttle, 0);
  // Intersection courtesy: if the crossing box just ahead is held by
  // another driven car and we are not in it yet, wait outside it.
  // Perpendicular flows used to meet in the box and shove forever —
  // neither driver's lane check sees a crossing car. A holder inside
  // the box always proceeds (below), so the box always clears and
  // this cannot deadlock.
  const crossings = r.axis === 'v'
    ? STREETS.map((s) => ({ x: r.line, y: s.y }))
    : AVENUES.map((a) => ({ x: a.x, y: r.line }));
  for (const c of crossings) {
    const along = r.axis === 'v' ? (c.y - car.y) * r.dir : (c.x - car.x) * r.dir;
    if (along < 2 || along > 19) continue;
    const weInBox = Math.abs(car.x - c.x) < 10.5 && Math.abs(car.y - c.y) < 10.5;
    if (weInBox) break;
    const held = cars.some((o) => o !== car && !o.dead && o.driver
      && Math.abs(o.x - c.x) < 10.5 && Math.abs(o.y - c.y) < 10.5);
    if (held) {
      if (Math.abs(speedOf(car)) <= 1.5) { throttle = 0; holdStill = true; }
      else throttle = -0.4;
    }
    break;
  }
  return { throttle, steer, brake: throttle < -0.2 || holdStill };
}

export function spawnTraffic(rng, playerPos) {
  const cars = [];
  // Parked cars on a share of the marked spots.
  for (const spot of PARK_SPOTS) {
    if (rng() < 0.42) continue;
    const key = randPick(rng, ['mirlo', 'brisa', 'caspian', 'furgon', 'taxi', 'mirlo', 'brisa']);
    const car = makeCar(key, spot.x, spot.y, spot.angle, { rng });
    car.color = randPick(rng, PAINTS);
    car.driver = null;
    cars.push(car);
  }
  // Moving traffic on the avenues and streets.
  for (let i = 0; i < 14; i++) {
    let x;
    let y;
    let angle;
    if (rng() < 0.6) {
      const a = randPick(rng, AVENUES);
      x = a.x + (rng() < 0.5 ? 4.6 : -4.6);
      y = randRange(rng, 40, 700);
      angle = x > a.x ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const s = randPick(rng, STREETS);
      y = s.y + (rng() < 0.5 ? 4.6 : -4.6);
      x = randRange(rng, 40, 1200);
      angle = y > s.y ? 0 : Math.PI;
    }
    if (Math.hypot(x - playerPos.x, y - playerPos.y) < 60) continue;
    const key = randPick(rng, ['mirlo', 'brisa', 'caspian', 'furgon', 'taxi']);
    const car = makeCar(key, x, y, angle, { rng });
    car.color = randPick(rng, PAINTS);
    car.driver = 'traffic';
    laneTarget(car);
    cars.push(car);
  }
  return cars;
}
