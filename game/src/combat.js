// combat.js — gunfire: the player's three-weapon arsenal, hostile actors
// returning fire, SBPD shooting at high wanted levels, bullets against
// bodies, cars and walls, and the damage that ends in a hospital visit.

import { circleBlocked } from './city.js';
import { scarePeds } from './pedestrians.js';
import { clamp } from './random.js';

// The arsenal. One shared magazine and reserve — Marco's crate feeds all
// three — but each weapon fires its own way: the Pistol is the accurate
// all-rounder, the Ráfaga trades damage for a fast automatic cycle and a
// wide cone, and the Escopeta throws six pellets in one slow, heavy pull.
// Slots unlock as the story advances (Ráfaga after Chapter 8, Escopeta
// after Chapter 12); the HUD weapon chip shows owned and locked alike.
export const WEAPONS = [
  { name: 'Pistol', rate: 0.24, speed: 95, damage: 34, spread: 0.035, pellets: 1 },
  { name: 'Ráfaga', rate: 0.085, speed: 95, damage: 15, spread: 0.085, pellets: 1 },
  { name: 'Escopeta', rate: 0.8, speed: 82, damage: 13, spread: 0.17, pellets: 6 },
];
export const WEAPON = WEAPONS[0];

export function weaponOwned(G, i) {
  if (i === 0) return true;
  const idx = G.missions ? G.missions.index : 0;
  const done = G.missions ? !!G.missions.storyDone : false;
  if (i === 1) return done || idx >= 8;
  if (i === 2) return done || idx >= 12;
  return false;
}

export function currentWeapon(G) {
  return WEAPONS[G.weaponIndex || 0] || WEAPONS[0];
}

export function tryPlayerShoot(G, aimX, aimY) {
  const p = G.player;
  if (p.car || G.mode !== 'play' || p.health <= 0) return false;
  if (G.fireCooldown > 0) return false;
  const W = currentWeapon(G);
  G.fireCooldown = W.rate;
  const base = Math.atan2(aimY - p.y, aimX - p.x);
  p.angle = base;
  for (let i = 0; i < W.pellets; i++) {
    const a = base + (Math.random() - 0.5) * W.spread * (W.pellets > 1 ? 2 : 1);
    G.bullets.push({
      x: p.x + Math.cos(a) * 0.7,
      y: p.y + Math.sin(a) * 0.7,
      vx: Math.cos(a) * W.speed,
      vy: Math.sin(a) * W.speed,
      life: 0.85,
      from: 'player',
      damage: W.damage,
    });
  }
  G.effects.push({ type: 'muzzle', x: p.x + Math.cos(base) * 0.85, y: p.y + Math.sin(base) * 0.85, t: 0.055 });
  G.audio?.gunshot();
  scarePeds(G.peds, p.x, p.y, 30);
  if (G.wanted.seenByPolice(G)) G.wanted.addHeat(16);
  return true;
}

export function damagePlayer(G, amount) {
  const p = G.player;
  if (p.health <= 0) return;
  let rest = amount;
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, amount * 0.65);
    p.armour -= absorbed;
    rest = amount - absorbed;
  }
  p.health = Math.max(0, p.health - rest);
  G.hurtFlash = 0.25;
  if (p.health <= 0) G.events.push({ type: 'wasted' });
}

function enemyShoot(G, from, targetX, targetY, accuracy) {
  // Accuracy degrades with range: a flat spread let close-range fire land
  // every round while return fire at pistol range barely registered.
  const d = Math.hypot(targetX - from.x, targetY - from.y);
  const spread = accuracy + d * 0.006;
  const a = Math.atan2(targetY - from.y, targetX - from.x) + (Math.random() - 0.5) * spread;
  G.bullets.push({
    x: from.x + Math.cos(a) * 0.8,
    y: from.y + Math.sin(a) * 0.8,
    vx: Math.cos(a) * WEAPON.speed * 0.9,
    vy: Math.sin(a) * WEAPON.speed * 0.9,
    life: 0.8,
    from: 'enemy',
    damage: 8,
  });
  G.effects.push({ type: 'muzzle', x: from.x + Math.cos(a) * 0.95, y: from.y + Math.sin(a) * 0.95, t: 0.05 });
  if (Math.hypot(from.x - G.player.x, from.y - G.player.y) < 55) G.audio?.gunshot();
}

export function updateCombat(G, dt) {
  G.fireCooldown = Math.max(0, (G.fireCooldown || 0) - dt);
  const p = G.player;

  // Hostile actors (mission muscle) shoot back when close.
  for (const actor of G.actors) {
    if (actor.dead || !actor.hostile) continue;
    actor.fireTimer = (actor.fireTimer || 0) - dt;
    const d = Math.hypot(actor.x - p.x, actor.y - p.y);
    if (!p.car && d < 30 && actor.fireTimer <= 0) {
      enemyShoot(G, actor, p.x, p.y, 0.16);
      actor.fireTimer = 1.25 + Math.random() * 0.75;
    }
  }

  // At four stars and up, SBPD officers fire on an armed, resisting player.
  if (G.wanted.stars() >= 4 && !p.car && G.playerArmed) {
    G.policeFireTimer = (G.policeFireTimer || 0) - dt;
    if (G.policeFireTimer <= 0) {
      const near = G.wanted.units
        .map((u) => u.car)
        .filter((c) => Math.hypot(c.x - p.x, c.y - p.y) < 30)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (near) {
        enemyShoot(G, near, p.x, p.y, 0.22);
        G.policeFireTimer = 1.1 + Math.random() * 0.8;
      } else {
        G.policeFireTimer = 0.4;
      }
    }
  }

  // Bullets. A pistol round crosses up to ~3 m in one frame, while the hit
  // tests below are body-sized circles — point sampling let rounds tunnel
  // clean through a person, so aimed fire at normal range almost never
  // registered and only point-blank shots connected. The move is therefore
  // substepped (<=0.35 m per step) and the same point tests run at each
  // step, stopping at the first thing the round actually passes through.
  for (const b of [...G.bullets]) {
    b.life -= dt;
    let gone = b.life <= 0;
    const stepLen = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(stepLen / 0.35));
    const sx = (b.vx * dt) / steps;
    const sy = (b.vy * dt) / steps;
    for (let step = 0; step < steps && !gone; step++) {
      b.x += sx;
      b.y += sy;
    if (!gone && circleBlocked(b.x, b.y, 0.05)) {
      G.effects.push({ type: 'spark', x: b.x, y: b.y, t: 0.12 });
      gone = true;
    }
    if (!gone && b.from === 'player') {
      for (const target of [...G.actors, ...G.peds]) {
        if (target.dead) continue;
        if (Math.hypot(target.x - b.x, target.y - b.y) < 0.65) {
          target.health -= b.damage;
          // Hit-stop (JF4): a confirmed hit freezes the world clock for
          // a beat — 0.06 s for a wound, 0.12 s when the hit puts the
          // target down. The frame loop scales dt while G.hitStop runs
          // down on real time and restores the scale to exactly 1.
          G.hitStop = Math.max(G.hitStop || 0, target.health <= 0 ? 0.12 : 0.06);
          G.effects.push({ type: 'hit', x: b.x, y: b.y, t: 0.12 });
          if (target.health <= 0 && !target.dead) {
            target.dead = true;
            target.state = 'down';
            G.events.push({ type: target.kind === 'actor' ? 'actorDown' : 'pedDown', target });
            if (G.wanted.seenByPolice(G)) G.wanted.addHeat(target.kind === 'actor' ? 30 : 90);
          }
          gone = true;
          break;
        }
      }
      if (!gone) {
        for (const car of G.cars) {
          if (Math.hypot(car.x - b.x, car.y - b.y) < car.model.len * 0.42) {
            car.health = Math.max(5, car.health - b.damage * 0.4);
            G.effects.push({ type: 'spark', x: b.x, y: b.y, t: 0.1 });
            gone = true;
            break;
          }
        }
      }
    }
    if (!gone && b.from === 'enemy') {
      if (!p.car && Math.hypot(p.x - b.x, p.y - b.y) < 0.6) {
        damagePlayer(G, b.damage);
        G.effects.push({ type: 'hit', x: b.x, y: b.y, t: 0.12 });
        gone = true;
      } else if (p.car && Math.hypot(p.car.x - b.x, p.car.y - b.y) < p.car.model.len * 0.42) {
        p.car.health = Math.max(5, p.car.health - b.damage * 0.3);
        gone = true;
      }
    }
    }
    if (gone) G.bullets = G.bullets.filter((x) => x !== b);
  }
  // Effects decay.
  for (const e of G.effects) e.t -= dt;
  G.effects = G.effects.filter((e) => e.t > 0);
  G.hurtFlash = Math.max(0, (G.hurtFlash || 0) - dt);
}

export function actorHealthFrac(a) {
  return clamp(a.health / 100, 0, 1);
}
