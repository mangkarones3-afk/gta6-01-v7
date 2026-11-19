// pedestrians.js — the people of Solano Bay: they stroll the sidewalks and
// the beach, chat in pairs, and run when the shooting or the driving starts.

import { AVENUES, STREETS, WORLD, tryMove } from './city.js';
import { randPick, randRange } from './random.js';

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const SHIRTS = ['#e74c3c', '#f39c12', '#27ae60', '#2980b9', '#ecf0f1', '#9b59b6', '#fd79a8', '#00cec9', '#dfe6e9', '#e17055'];
const PANTS = ['#2d3436', '#636e72', '#0984e3', '#6c5ce7', '#b2bec3', '#ffeaa7'];

let nextId = 1;

export function makePed(rng, x, y) {
  return {
    id: nextId++,
    kind: 'ped',
    x, y,
    angle: rng() * Math.PI * 2,
    speed: 0,
    tx: x, ty: y,
    shirt: randPick(rng, SHIRTS),
    pants: randPick(rng, PANTS),
    skin: randPick(rng, SKIN),
    hair: randPick(rng, ['#2d3436', '#636e72', '#d63031', '#e17055', '#fdcb6e', '#000000']),
    state: 'walk',
    panic: 0,
    health: 100,
    dead: false,
    walkPhase: rng() * Math.PI * 2,
    wait: 0,
  };
}

export function walkwayPoint(rng) {
  // A point on a sidewalk: beside an avenue, beside a street, or on the beach.
  const roll = rng();
  if (roll < 0.42) {
    const a = randPick(rng, AVENUES);
    return { x: a.x + (rng() < 0.5 ? -12.6 : 12.6), y: randRange(rng, 20, 724) };
  }
  if (roll < 0.84) {
    const s = randPick(rng, STREETS);
    return { x: randRange(rng, 20, WORLD.w - 20), y: s.y + (rng() < 0.5 ? -12.6 : 12.6) };
  }
  return { x: randRange(rng, 20, WORLD.w - 20), y: randRange(rng, 742, 786) };
}

export function spawnPeds(rng, playerPos, count = 42) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const p = walkwayPoint(rng);
    if (Math.hypot(p.x - playerPos.x, p.y - playerPos.y) < 24) continue;
    const ped = makePed(rng, p.x, p.y);
    const t = walkwayPoint(rng);
    ped.tx = t.x;
    ped.ty = t.y;
    peds.push(ped);
  }
  return peds;
}

export function scarePeds(peds, x, y, radius) {
  for (const ped of peds) {
    if (ped.dead) continue;
    const d = Math.hypot(ped.x - x, ped.y - y);
    if (d < radius) {
      ped.state = 'flee';
      ped.panic = 3.5;
      ped.fleeX = x;
      ped.fleeY = y;
    }
  }
}

export function updatePed(ped, dt, rng) {
  if (ped.dead) return;
  ped.walkPhase += dt * (ped.state === 'flee' ? 13 : 7);
  let speed = 0;
  if (ped.state === 'flee') {
    ped.panic -= dt;
    if (ped.panic <= 0) ped.state = 'walk';
    const dx = ped.x - (ped.fleeX ?? ped.x);
    const dy = ped.y - (ped.fleeY ?? ped.y);
    const d = Math.hypot(dx, dy) || 1;
    ped.angle = Math.atan2(dy, dx);
    speed = 3.6;
    tryMove(ped, (dx / d) * speed * dt, (dy / d) * speed * dt, 0.38);
  } else if (ped.wait > 0) {
    ped.wait -= dt;
  } else {
    const dx = ped.tx - ped.x;
    const dy = ped.ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.2) {
      if (rng() < 0.25) ped.wait = randRange(rng, 1, 4);
      const t = walkwayPoint(rng);
      ped.tx = t.x;
      ped.ty = t.y;
    } else {
      ped.angle = Math.atan2(dy, dx);
      speed = 1.35;
      tryMove(ped, (dx / d) * speed * dt, (dy / d) * speed * dt, 0.38);
    }
  }
  ped.speed = speed;
}
