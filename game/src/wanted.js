// wanted.js — the SBPD response: heat and stars, patrol spawns, pursuit
// tactics (pursue, ram, intercept), roadblocks at three stars, a helicopter
// with a searchlight at four, and the busted meter when they corner you.

import { AVENUES, STREETS, POIS, findFree } from './city.js';
import { makeCar, speedOf, updateCar } from './vehicles.js';
import { clamp } from './random.js';

const DESIRED = [0, 2, 3, 5, 6, 8];
const TACTICS = ['PURSUE', 'RAMMING', 'INTERCEPT'];

export class WantedSystem {
  constructor() {
    this.heat = 0;
    this.heatFloor = 0;
    this.units = [];
    this.heli = null;
    this.nextUnitId = 1;
    this.spawnTimer = 0;
    this.roadblockTimer = 6;
    this.bustedMeter = 0;
    this.seenTimer = 0;
  }

  reset() {
    this.heat = 0;
    this.heatFloor = 0;
    this.units = [];
    this.heli = null;
    this.bustedMeter = 0;
    this.seenTimer = 0;
  }

  stars() {
    return clamp(Math.floor(this.heat / 100), 0, 5);
  }

  addHeat(amount) {
    this.heat = clamp(this.heat + amount, 0, 599);
  }

  setStars(n) {
    this.heat = clamp(n * 100 + 20, 0, 599);
  }

  clear() {
    this.heat = 0;
    this.heatFloor = 0;
  }

  playerPos(G) {
    return G.player.car || G.player;
  }

  seenByPolice(G) {
    const p = this.playerPos(G);
    if (this.heli) return true;
    return this.units.some((u) => Math.hypot(u.car.x - p.x, u.car.y - p.y) < 62);
  }

  spawnPoint(G) {
    const p = this.playerPos(G);
    // A street point 95–135 m away: close enough to matter, never on screen.
    for (let tries = 0; tries < 12; tries++) {
      const onAvenue = Math.random() < 0.6;
      let x;
      let y;
      if (onAvenue) {
        const a = AVENUES[Math.floor(Math.random() * AVENUES.length)];
        x = a.x;
        y = p.y + (Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 40);
      } else {
        const s = STREETS[Math.floor(Math.random() * STREETS.length)];
        y = s.y;
        x = p.x + (Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 40);
      }
      y = clamp(y, 20, 724);
      x = clamp(x, 20, 1228);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > 88 && d < 150) return findFree(x, y, 3);
    }
    return findFree(p.x + 120, p.y, 3);
  }

  spawnUnit(G, tactic, at) {
    const pos = at || this.spawnPoint(G);
    const car = makeCar('interceptor', pos.x, pos.y, Math.random() * Math.PI * 2, {});
    car.driver = 'police';
    car.color = '#e8e8e8';
    const unit = {
      id: `SBPD-${this.nextUnitId++}`,
      car,
      tactic: tactic || TACTICS[Math.floor(Math.random() * TACTICS.length)],
      stuckFor: 0,
      reversing: 0,
      lastX: pos.x,
      lastY: pos.y,
    };
    this.units.push(unit);
    G.cars.push(car);
    return unit;
  }

  tryRoadblock(G) {
    const p = this.playerPos(G);
    if (!G.player.car) return;
    const speed = Math.abs(speedOf(G.player.car));
    if (speed < 5) return;
    const fx = Math.cos(G.player.car.angle);
    const fy = Math.sin(G.player.car.angle);
    let bx = p.x + fx * 62;
    let by = p.y + fy * 62;
    // Snap to the nearest street crossing ahead.
    let bestD = 1e9;
    for (const a of AVENUES) for (const s of STREETS) {
      const d = Math.hypot(a.x - bx, s.y - by);
      if (d < bestD) { bestD = d; bx = a.x; by = s.y; }
    }
    const horizontal = Math.abs(fx) > Math.abs(fy);
    for (let i = 0; i < 2; i++) {
      const off = i === 0 ? -3.4 : 3.4;
      const pos = horizontal ? { x: bx, y: by + off } : { x: bx + off, y: by };
      const free = findFree(pos.x, pos.y, 3);
      const unit = this.spawnUnit(G, 'ROADBLOCK', free);
      unit.car.angle = horizontal ? Math.PI / 2 + (i === 0 ? 0.5 : -0.5) : (i === 0 ? 0.5 : -0.5);
      unit.roadblock = true;
    }
    this.roadblockTimer = 26;
  }

  update(G, dt) {
    const stars = this.stars();
    const p = this.playerPos(G);
    const seen = this.seenByPolice(G);
    if (seen) this.seenTimer = 0;
    else this.seenTimer += dt;

    // Heat decay: only when unseen; the Taller Delgado yard cools you faster.
    if (stars > 0 && !seen) {
      const inYard = Math.hypot(p.x - POIS.tallerYard.x, p.y - POIS.tallerYard.y) < 26;
      const rate = inYard ? 34 : 9;
      this.heat = Math.max(this.heatFloor, this.heat - rate * dt);
    }

    // Spawning to the desired strength for the current stars.
    this.spawnTimer -= dt;
    const desired = DESIRED[stars];
    if (stars > 0 && this.units.length < desired && this.spawnTimer <= 0) {
      this.spawnUnit(G);
      this.spawnTimer = this.heli ? 0.7 : 1.4;
    }
    // Roadblocks at 3+ stars.
    if (stars >= 3) {
      this.roadblockTimer -= dt;
      if (this.roadblockTimer <= 0) this.tryRoadblock(G);
    }
    // Helicopter at 4+ stars: real spawn pressure — no heat decay, faster spawns.
    if (stars >= 4 && !this.heli) {
      this.heli = { x: p.x - 60, y: p.y - 60, angle: 0, id: 'HELI-1' };
    }
    if (stars < 4) this.heli = null;
    if (this.heli) {
      const h = this.heli;
      const tx = p.x - 14;
      const ty = p.y - 10;
      const dx = tx - h.x;
      const dy = ty - h.y;
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, 34 * dt);
      if (d > 0.01) {
        h.x += (dx / d) * step;
        h.y += (dy / d) * step;
        h.angle = Math.atan2(dy, dx);
      }
    }

    // Drive every unit.
    for (const unit of [...this.units]) {
      const car = unit.car;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d > 250 && !unit.roadblock) {
        this.removeUnit(G, unit);
        continue;
      }
      if (unit.roadblock) {
        if (d < 30) {
          unit.roadblock = false;
          unit.tactic = 'PURSUE';
        } else {
          continue; // hold the block
        }
      }
      const control = this.pursuitControl(G, unit, dt);
      const crash = updateCar(car, control, dt);
      if (crash > 0.5 && G.player.car && Math.hypot(car.x - G.player.car.x, car.y - G.player.car.y) < 8) {
        G.events.push({ type: 'copRam', strength: crash });
      }
      // Unstick: if we are barely moving while trying, reverse a moment.
      const moved = Math.hypot(car.x - unit.lastX, car.y - unit.lastY);
      if (moved < 0.4 * dt * 10 && Math.abs(speedOf(car)) < 1) unit.stuckFor += dt;
      else unit.stuckFor = 0;
      unit.lastX = car.x;
      unit.lastY = car.y;
    }

    // Busted: a cop close to a stopped or on-foot player fills the meter.
    let nearest = 1e9;
    for (const u of this.units) {
      nearest = Math.min(nearest, Math.hypot(u.car.x - p.x, u.car.y - p.y));
    }
    const playerSpeed = G.player.car ? Math.abs(speedOf(G.player.car)) : Math.hypot(G.player.vx || 0, G.player.vy || 0);
    const cornered = stars > 0 && nearest < (G.player.car ? 6.5 : 4.2) && playerSpeed < 1.2;
    if (cornered) {
      this.bustedMeter += dt / 1.5;
      if (this.bustedMeter >= 1) {
        this.bustedMeter = 0;
        G.events.push({ type: 'busted' });
      }
    } else {
      this.bustedMeter = Math.max(0, this.bustedMeter - dt * 1.6);
    }

    // Siren loudness follows the nearest unit.
    if (G.audio) {
      const level = stars === 0 ? 0 : clamp(0.15 - nearest / 900, 0, 0.15);
      G.audio.setSiren(level);
    }
  }

  removeUnit(G, unit) {
    this.units = this.units.filter((u) => u !== unit);
    G.cars = G.cars.filter((c) => c !== unit.car);
  }

  pursuitControl(G, unit, dt) {
    const car = unit.car;
    const target = this.playerPos(G);
    let tx = target.x;
    let ty = target.y;
    const pvx = target.vx || 0;
    const pvy = target.vy || 0;
    if (unit.tactic === 'RAMMING') {
      tx += pvx * 0.25;
      ty += pvy * 0.25;
    } else if (unit.tactic === 'INTERCEPT') {
      tx += pvx * 1.1;
      ty += pvy * 1.1;
    } else {
      tx += pvx * 0.55;
      ty += pvy * 0.55;
    }
    if (unit.reversing > 0) {
      unit.reversing -= dt;
      return { throttle: -1, steer: unit.reverseSteer || 0.6, brake: false };
    }
    if (unit.stuckFor > 1.6) {
      unit.stuckFor = 0;
      unit.reversing = 0.75;
      unit.reverseSteer = Math.random() < 0.5 ? -0.8 : 0.8;
      return { throttle: -1, steer: unit.reverseSteer, brake: false };
    }
    const desired = Math.atan2(ty - car.y, tx - car.x);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 2.6, -1, 1);
    const d = Math.hypot(tx - car.x, ty - car.y);
    let throttle = 1;
    if (Math.abs(diff) > 2.4 && d < 9) throttle = -0.8;
    else if (Math.abs(diff) > 1.9) throttle = 0.25;
    if (d < 4 && unit.tactic !== 'RAMMING') throttle = 0.1;
    return { throttle, steer, brake: false };
  }

  // Rows for the HUD police-response panel: live units, nearest first.
  panelRows(G, max = 5) {
    const p = this.playerPos(G);
    const rows = this.units
      .map((u) => ({
        id: u.id,
        dist: Math.round(Math.hypot(u.car.x - p.x, u.car.y - p.y)),
        tactic: u.roadblock ? 'ROADBLOCK' : u.tactic,
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, max);
    if (this.heli) {
      rows.push({ id: this.heli.id, dist: Math.round(Math.hypot(this.heli.x - p.x, this.heli.y - p.y)), tactic: 'TRACKING' });
    }
    return rows;
  }

  pursuitState(G) {
    if (this.stars() === 0) return 'NO PURSUIT';
    return this.seenByPolice(G) ? 'PURSUIT' : 'SEARCHING';
  }
}
