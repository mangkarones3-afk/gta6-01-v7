// Solano Bay — top-down renderer + HUD (Canvas 2D).
// Contract (discovered at runtime): solano-bay-game.js calls makeCamera() once,
// updateCamera(G, dt) every frame, and render(ctx, G) every frame.
// G.camera is the object returned by makeCamera(); solano-bay-game.js drives it
// during the title drift and reads it back, updateCamera owns the
// gameplay follow + zoom (48 m on foot, 82 m in a car, 150 m title).

import {
  AVENUES, STREETS, BUILDINGS, PROPS, WATER, DECKS, WORLD, BEACH_Y,
  STREET_W, FORECOURTS, districtAt, streetNameAt,
} from './city.js';
import { CHARACTERS } from './missions.js';
import { STATIONS } from './audio.js';
import { WEAPON } from './combat.js';
import { drawMinimap, drawCityMap } from './minimap.js';

// ---------------------------------------------------------------- helpers
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' && v ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Deterministic 2D hash -> [0,1). Render must never flicker, so all
// decorative variation derives from world coordinates, never Math.random.
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? line + ' ' + w : w;
    if (ctx.measureText(trial).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else line = trial;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const joined = lines.join(' ');
  if (lines.length === maxLines && words.join(' ') !== joined) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}
function fitText(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
const money = (n) => '$' + Math.round(num(n, 0)).toLocaleString('en-US');
const FONT = '"Segoe UI", Arial, "DejaVu Sans", sans-serif';

// ---------------------------------------------------------------- palettes
const TOD = {
  day: {
    ground: '#8d8271', groundAlt: '#847963', sidewalk: '#a79c86',
    asphalt: '#33373d', curb: '#26292e', sand: '#dcc48d',
    waterDeep: '#14586f', waterShallow: '#2b7d99', foam: 'rgba(240,250,252,0.5)',
    deck: '#8a6a48', overlay: null, lampGlow: 0,
  },
  dusk: {
    ground: '#77644f', groundAlt: '#6e5c49', sidewalk: '#96836a',
    asphalt: '#2e2c33', curb: '#211f26', sand: '#c9a76f',
    waterDeep: '#11455e', waterShallow: '#1f617e', foam: 'rgba(255,220,190,0.35)',
    deck: '#75582c', overlay: 'rgba(255,106,32,0.10)', lampGlow: 0.55,
  },
  night: {
    ground: '#4e4c58', groundAlt: '#474552', sidewalk: '#615e6e',
    asphalt: '#222329', curb: '#191a1f', sand: '#8d8271',
    waterDeep: '#0c3049', waterShallow: '#164a66', foam: 'rgba(200,225,255,0.3)',
    deck: '#5d4630', overlay: 'rgba(8,12,44,0.26)', lampGlow: 1,
  },
};
function pal(G) {
  return TOD[G.timeOfDay] || TOD.day;
}

// ---------------------------------------------------------------- camera
export function makeCamera() {
  return { x: 620, y: 550, viewW: 150, scale: 1280 / 150, snap: false };
}

export function updateCamera(G, dt) {
  if (!G || !G.camera) return;
  const cam = G.camera;
  const W = (G.canvas && G.canvas.width) || (G.ctx && G.ctx.canvas && G.ctx.canvas.width) || 1280;
  const step = clamp(num(dt, 0.016), 0, 0.05);
  let targetW = 150;
  let tx = null;
  let ty = null;
  if (G.mode && G.mode !== 'title') {
    const p = G.player || {};
    const car = p.car && typeof p.car === 'object' ? p.car : null;
    tx = car ? num(car.x, num(p.x, cam.x)) : num(p.x, cam.x);
    ty = car ? num(car.y, num(p.y, cam.y)) : num(p.y, cam.y);
    targetW = car ? 82 : 48;
  }
  const snap = !!cam.snap;
  const kz = snap ? 1 : 1 - Math.exp(-step * 4.2);
  cam.viewW = num(cam.viewW, 150) + (targetW - num(cam.viewW, 150)) * kz;
  if (tx !== null) {
    const kp = snap ? 1 : 1 - Math.exp(-step * 7);
    cam.x = num(cam.x, tx) + (tx - num(cam.x, tx)) * kp;
    cam.y = num(cam.y, ty) + (ty - num(cam.y, ty)) * kp;
  }
  cam.scale = W / Math.max(20, num(cam.viewW, 150));
  if (snap) cam.snap = false;
}

// ---------------------------------------------------------------- view
function makeView(ctx, G) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cam = G.camera || { x: 620, y: 550, viewW: 150, scale: W / 150 };
  const s = num(cam.scale, W / 150);
  const cx = num(cam.x, 620);
  const cy = num(cam.y, 550);
  const viewW = W / s;
  const viewH = H / s;
  return {
    W, H, s, cx, cy,
    x0: cx - viewW / 2, x1: cx + viewW / 2,
    y0: cy - viewH / 2, y1: cy + viewH / 2,
    toX(wx) { return (wx - cx) * s + W / 2; },
    toY(wy) { return (wy - cy) * s + H / 2; },
  };
}
const inView = (V, x, y, m = 26) => x > V.x0 - m && x < V.x1 + m && y > V.y0 - m && y < V.y1 + m;

// ---------------------------------------------------------------- ground
function drawGround(ctx, G, V) {
  const P = pal(G);
  const s = V.s;
  ctx.fillStyle = P.ground;
  ctx.fillRect(0, 0, V.W, V.H);

  // City-block tint variation between the road grid lines.
  const xEdges = [0, ...AVENUES.map(a => a.x), WORLD.w];
  const yEdges = [0, ...STREETS.map(t => t.y), BEACH_Y, WORLD.h];
  const half = STREET_W / 2;
  for (let i = 0; i < xEdges.length - 1; i++) {
    for (let j = 0; j < yEdges.length - 1; j++) {
      const bx0 = i === 0 ? 0 : xEdges[i] + half;
      const bx1 = i === xEdges.length - 2 ? WORLD.w : xEdges[i + 1] - half;
      const by0 = j === 0 ? 0 : yEdges[j] + half;
      const by1 = j === yEdges.length - 2 ? WORLD.h : yEdges[j + 1] - half;
      if (bx1 < V.x0 || bx0 > V.x1 || by1 < V.y0 || by0 > V.y1) continue;
      const h = hash2(i * 7 + 1, j * 13 + 2);
      ctx.fillStyle = h > 0.5 ? P.groundAlt : P.ground;
      ctx.fillRect(V.toX(bx0), V.toY(by0), (bx1 - bx0) * s, (by1 - by0) * s);
      // faint lot grain
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      const gx = bx0 + h * Math.max(1, bx1 - bx0 - 14);
      const gy = by0 + hash2(i + 3, j + 9) * Math.max(1, by1 - by0 - 14);
      if (gx > V.x0 && gy > V.y0) ctx.fillRect(V.toX(gx), V.toY(gy), 13 * s * 0.14 + 6, 3);
      // Pavement joints: concrete-slab seams across the lot, so the block
      // surface carries structure at walking scale instead of one flat fill.
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let jx = bx0 + 2.8; jx < bx1 - 0.5; jx += 2.8) {
        ctx.moveTo(V.toX(jx), V.toY(by0));
        ctx.lineTo(V.toX(jx), V.toY(by1));
      }
      for (let jy = by0 + 2.8; jy < by1 - 0.5; jy += 2.8) {
        ctx.moveTo(V.toX(bx0), V.toY(jy));
        ctx.lineTo(V.toX(bx1), V.toY(jy));
      }
      ctx.stroke();
      // Painted parking bays along the lot's south edge on some blocks.
      if (h > 0.4 && bx1 - bx0 > 22) {
        ctx.strokeStyle = 'rgba(240,238,230,0.22)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let px3 = bx0 + 2.6; px3 < bx1 - 1; px3 += 2.6) {
          ctx.moveTo(V.toX(px3), V.toY(by1 - 5));
          ctx.lineTo(V.toX(px3), V.toY(by1));
        }
        ctx.moveTo(V.toX(bx0 + 1), V.toY(by1 - 5));
        ctx.lineTo(V.toX(bx1 - 1), V.toY(by1 - 5));
        ctx.stroke();
      }
      // Soft tone pool: sun-bleach or wear shading pooled across the lot,
      // a gentle gradient so no square metre of pavement is a single tone.
      const ph2 = hash2(i * 3 + 8, j * 5 + 4);
      const pcx = V.toX(bx0 + (0.25 + ph2 * 0.5) * (bx1 - bx0));
      const pcy = V.toY(by0 + (0.25 + hash2(i + 6, j + 2) * 0.5) * (by1 - by0));
      const prad = (7 + ph2 * 9) * s;
      const pg = ctx.createRadialGradient(pcx, pcy, 0, pcx, pcy, prad);
      if (ph2 > 0.5) {
        pg.addColorStop(0, 'rgba(255,244,214,0.10)');
        pg.addColorStop(1, 'rgba(255,244,214,0)');
      } else {
        pg.addColorStop(0, 'rgba(24,20,12,0.11)');
        pg.addColorStop(1, 'rgba(24,20,12,0)');
      }
      ctx.fillStyle = pg;
      ctx.fillRect(V.toX(bx0), V.toY(by0), (bx1 - bx0) * s, (by1 - by0) * s);
      // A second, tighter pool in the opposite tone for a wear gradient.
      const qcx = V.toX(bx0 + (0.2 + hash2(i + 11, j + 5) * 0.6) * (bx1 - bx0));
      const qcy = V.toY(by0 + (0.2 + hash2(i + 4, j + 13) * 0.6) * (by1 - by0));
      const qg = ctx.createRadialGradient(qcx, qcy, 0, qcx, qcy, (4 + ph2 * 4) * s);
      if (ph2 > 0.5) {
        qg.addColorStop(0, 'rgba(24,20,12,0.07)');
        qg.addColorStop(1, 'rgba(24,20,12,0)');
      } else {
        qg.addColorStop(0, 'rgba(255,244,214,0.06)');
        qg.addColorStop(1, 'rgba(255,244,214,0)');
      }
      ctx.fillStyle = qg;
      ctx.fillRect(V.toX(bx0), V.toY(by0), (bx1 - bx0) * s, (by1 - by0) * s);
      // Lot speckle: small wear flecks so the pavement reads at patch
      // scale, not only in the broad tone pools.
      for (let k = 0; k < 16; k++) {
        const sx2 = bx0 + 1 + hash2(i * 31 + k * 7, j * 17 + k * 3) * Math.max(1, bx1 - bx0 - 3);
        const sy2 = by0 + 1 + hash2(i * 13 + k * 5, j * 29 + k * 11) * Math.max(1, by1 - by0 - 3);
        ctx.fillStyle = hash2(i + k * 3, j + k) > 0.5 ? 'rgba(0,0,0,0.075)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(V.toX(sx2), V.toY(sy2), (0.4 + hash2(k, i) * 0.7) * s, (0.35 + hash2(j, k) * 0.6) * s);
      }
    }
  }

  // Beach sand band, then the bay.
  if (V.y1 > BEACH_Y - 4) {
    ctx.fillStyle = P.sand;
    ctx.fillRect(0, V.toY(BEACH_Y), V.W, (WORLD.h - BEACH_Y) * s + 4);
    ctx.fillStyle = 'rgba(120,90,40,0.16)';
    for (let x = Math.floor(V.x0 / 22) * 22; x < V.x1; x += 22) {
      const yy = BEACH_Y + 8 + hash2(x, 4) * 22;
      ctx.fillRect(V.toX(x), V.toY(yy), 9, 2);
    }
  }
  for (const w of WATER) {
    if (w.x + w.w < V.x0 || w.x > V.x1 || w.y + w.h < V.y0 || w.y > V.y1) continue;
    const gx = V.toX(w.x);
    const gy = V.toY(w.y);
    const gw = w.w * s;
    const gh = w.h * s;
    const grad = ctx.createLinearGradient(0, gy, 0, gy + gh);
    grad.addColorStop(0, P.waterShallow);
    grad.addColorStop(0.35, P.waterDeep);
    grad.addColorStop(1, P.waterDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, gh);
    // foam line at the shore + drifting sparkle (time-animated, stable hash)
    ctx.fillStyle = P.foam;
    ctx.fillRect(gx, gy, gw, Math.max(1.5, 0.35 * s));
    const t = num(G.time, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    for (let x = Math.floor(V.x0 / 17) * 17; x < V.x1; x += 17) {
      for (let y = Math.floor(Math.max(V.y0, w.y + 6) / 23) * 23; y < Math.min(V.y1, w.y + w.h); y += 23) {
        const ph = hash2(x, y);
        if (Math.sin(t * 0.9 + ph * 12.6) > 0.55) ctx.fillRect(V.toX(x + ph * 8), V.toY(y + ph * 5), 4.5, 1.6);
      }
    }
  }
  for (const d of DECKS) {
    if (!inView(V, d.x + d.w / 2, d.y + d.h / 2, 60)) continue;
    ctx.fillStyle = 'rgba(10,10,12,0.30)';
    ctx.fillRect(V.toX(d.x) + 4, V.toY(d.y) + 5, d.w * s, d.h * s);
    ctx.fillStyle = P.deck;
    ctx.fillRect(V.toX(d.x), V.toY(d.y), d.w * s, d.h * s);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = d.x + 6; x < d.x + d.w; x += 7) ctx.fillRect(V.toX(x), V.toY(d.y), 1.4, d.h * s);
  }
}

// ---------------------------------------------------------------- roads
// Pale concrete forecourts (market frontage, café terrace): slab-tinted
// concrete with expansion joints, speckle and oil stains — a surface
// population distinct from both asphalt and the tan ground.
function drawForecourts(ctx, G, V) {
  const s = V.s;
  for (const f of FORECOURTS) {
    if (f.x + f.w < V.x0 || f.x > V.x1 || f.y + f.h < V.y0 || f.y > V.y1) continue;
    const x = V.toX(f.x);
    const y = V.toY(f.y);
    const w = f.w * s;
    const h = f.h * s;
    ctx.fillStyle = '#b3aa9c';
    ctx.fillRect(x, y, w, h);
    // Per-slab tint variation (4 m slabs).
    for (let sx = f.x; sx < f.x + f.w - 0.1; sx += 4) {
      const hh = hash2(Math.round(sx * 3), Math.round(f.y * 7));
      ctx.fillStyle = hh > 0.55 ? 'rgba(0,0,0,0.055)' : hh < 0.3 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0)';
      ctx.fillRect(V.toX(sx), y, Math.min(4, f.x + f.w - sx) * s, h);
    }
    // Expansion joints.
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let jx = f.x + 4; jx < f.x + f.w - 0.1; jx += 4) {
      ctx.moveTo(V.toX(jx), y);
      ctx.lineTo(V.toX(jx), y + h);
    }
    ctx.moveTo(x, V.toY(f.y + f.h / 2));
    ctx.lineTo(x + w, V.toY(f.y + f.h / 2));
    ctx.stroke();
    // Speckle wear.
    for (let i = 0; i < 46; i++) {
      const px = x + hash2(f.x + i * 3.7, f.y) * w;
      const py = y + hash2(f.y, f.x + i * 2.9) * h;
      ctx.fillStyle = hash2(f.x + i, f.y + 4) > 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(px, py, 2 + hash2(i, f.y) * 3, 2);
    }
    // Oil stains, heavier toward the east (workshop) end.
    for (let i = 0; i < 3; i++) {
      const ox = V.toX(f.x + f.w * (0.55 + hash2(f.x + i * 11, 3) * 0.4));
      const oy = V.toY(f.y + f.h * (0.3 + hash2(5, f.x + i * 7) * 0.4));
      const orad = (0.7 + hash2(i * 3, f.x) * 0.8) * s;
      ctx.fillStyle = 'rgba(10,10,12,0.13)';
      ctx.beginPath(); ctx.ellipse(ox, oy, orad, orad * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(10,10,12,0.16)';
      ctx.beginPath(); ctx.ellipse(ox, oy, orad * 0.55, orad * 0.34, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Kerb shadow along the road edge, lit lip along the wall edge.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x, y, w, 1.5);
  }
}

// Painted sun medallions on Calle del Mercado at the El Mercado crossing:
// two-tone sand wedges laid into the carriageway, a grout rim and the same
// hash speckle the asphalt carries, so the paint weathers like the road.
const MEDALLIONS = [
  [554, 355.5, 2.1], [562.5, 355.5, 2.1], [571, 355.5, 2.1], [579.5, 355.5, 2.1],
  [596.5, 355.5, 2.1], [605, 355.5, 2.1], [613.5, 355.5, 2.1], [622, 355.5, 2.1],
  [558, 364.5, 2.1], [574, 364.5, 2.1], [590, 364.5, 2.1], [606, 364.5, 2.1], [622, 364.5, 2.1],
  [600, 360, 2.6],
];
function drawMedallions(ctx, G, V) {
  const s = V.s;
  for (const [mx, my, mr] of MEDALLIONS) {
    if (!inView(V, mx, my, mr + 2)) continue;
    const cx = V.toX(mx);
    const cy = V.toY(my);
    const R = mr * s;
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = k % 2 ? '#cdb26f' : '#d9b878';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, (k * Math.PI) / 6, ((k + 1) * Math.PI) / 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#cdb26f';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9b878';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6d3b';
    ctx.lineWidth = Math.max(1.2, 0.16 * s);
    ctx.beginPath(); ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(138,109,59,0.5)';
    ctx.lineWidth = Math.max(1, 0.07 * s);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 30; i++) {
      const a = hash2(mx * 3 + i * 1.7, my * 5) * Math.PI * 2;
      const rr2 = Math.sqrt(hash2(mx + i * 2.3, my * 7)) * R * 0.9;
      const px = cx + Math.cos(a) * rr2;
      const py = cy + Math.sin(a) * rr2;
      ctx.fillStyle = hash2(mx + i, my + 4) > 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.09)';
      ctx.fillRect(px, py, 2 + hash2(i, my) * 3, 2);
    }
  }
}

function drawRoads(ctx, G, V) {
  const P = pal(G);
  const s = V.s;
  const half = STREET_W / 2;
  ctx.fillStyle = P.asphalt;
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - half), 0, STREET_W * s, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - half), V.W, STREET_W * s);
  }
  // Large-scale asphalt tint variation in 24 m tiles: resurfaced stretches
  // sit a few luma points off the older asphalt around them.
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    for (let ty = Math.floor(V.y0 / 24) * 24; ty < V.y1; ty += 24) {
      const hh = hash2(Math.round(a.x), ty / 24);
      if (hh < 0.34 || hh > 0.72) continue;
      ctx.fillStyle = hh > 0.53 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(V.toX(a.x - half), V.toY(ty), STREET_W * s, 24 * s);
    }
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    for (let tx = Math.floor(V.x0 / 24) * 24; tx < V.x1; tx += 24) {
      const hh = hash2(tx / 24, Math.round(t.y));
      if (hh < 0.34 || hh > 0.72) continue;
      ctx.fillStyle = hh > 0.53 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(V.toX(tx), V.toY(t.y - half), 24 * s, STREET_W * s);
    }
  }
  // Fine asphalt speckle: hash-placed wear flecks on a 3 m world grid,
  // so a square metre of carriageway carries tonal steps of its own
  // instead of one flat fill between the markings.
  for (let gx = Math.floor(V.x0 / 3) * 3; gx < V.x1; gx += 3) {
    for (let gy = Math.floor(V.y0 / 3) * 3; gy < V.y1; gy += 3) {
      const hh = hash2(gx * 1.7 + 5, gy * 2.3 + 9);
      if (hh < 0.42) continue;
      const onAve = AVENUES.some((a) => Math.abs(gx + 1.5 - a.x) < half - 0.4);
      const onStr = STREETS.some((t) => Math.abs(gy + 1.5 - t.y) < half - 0.4);
      if (!onAve && !onStr) continue;
      const fx = gx + hh * 2.2;
      const fy = gy + hash2(gx, gy * 3.1) * 2.2;
      ctx.fillStyle = hh > 0.71 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.075)';
      ctx.fillRect(V.toX(fx), V.toY(fy), (0.35 + hh * 0.5) * s, (0.3 + hh * 0.4) * s);
    }
  }
  // Curbs: lighter sidewalk rim hugging each road edge.
  ctx.fillStyle = P.sidewalk;
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - half) - 2.5, 0, 2.5, V.H);
    ctx.fillRect(V.toX(a.x + half), 0, 2.5, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - half) - 2.5, V.W, 2.5);
    ctx.fillRect(0, V.toY(t.y + half), V.W, 2.5);
  }
  ctx.fillStyle = P.curb;
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - half), 0, 1.4, V.H);
    ctx.fillRect(V.toX(a.x + half) - 1.4, 0, 1.4, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - half), V.W, 1.4);
    ctx.fillRect(0, V.toY(t.y + half) - 1.4, V.W, 1.4);
  }

  // Centre dashes (skipped inside intersection boxes).
  ctx.fillStyle = G.timeOfDay === 'day' ? 'rgba(245,197,66,0.75)' : 'rgba(245,197,66,0.6)';
  const dashLen = 3.2 * s;
  const dashGap = 3.4 * s;
  const inter = [];
  for (const a of AVENUES) for (const t of STREETS) inter.push([a.x, t.y]);
  const inInter = (x, y) => inter.some(([ix, iy]) => Math.abs(x - ix) < half + 1.6 && Math.abs(y - iy) < half + 1.6);
  for (const a of AVENUES) {
    if (a.x < V.x0 || a.x > V.x1) continue;
    for (let y = Math.floor(V.y0 / 6.6) * 6.6; y < V.y1; y += 6.6) {
      if (inInter(a.x, y + 1.6)) continue;
      ctx.fillRect(V.toX(a.x) - 0.7, V.toY(y), 1.4, dashLen);
    }
  }
  for (const t of STREETS) {
    if (t.y < V.y0 || t.y > V.y1) continue;
    for (let x = Math.floor(V.x0 / 6.6) * 6.6; x < V.x1; x += 6.6) {
      if (inInter(x + 1.6, t.y)) continue;
      ctx.fillRect(V.toX(x), V.toY(t.y) - 0.7, dashLen, 1.4);
    }
  }

  // Kerb shadow: a soft dark band inside the asphalt along each edge,
  // where the road surface meets the gutter.
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - half), 0, 0.45 * s, V.H);
    ctx.fillRect(V.toX(a.x + half) - 0.45 * s, 0, 0.45 * s, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - half), V.W, 0.45 * s);
    ctx.fillRect(0, V.toY(t.y + half) - 0.45 * s, V.W, 0.45 * s);
  }
  // Transverse joints: cut lines across the carriageway at regular
  // intervals, skipped inside intersection boxes.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    for (let y = Math.floor(V.y0 / 9) * 9; y < V.y1; y += 9) {
      if (STREETS.some((t) => Math.abs(y - t.y) < half + 1.2)) continue;
      ctx.fillRect(V.toX(a.x - half), V.toY(y), STREET_W * s, 1.6);
    }
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    for (let x = Math.floor(V.x0 / 9) * 9; x < V.x1; x += 9) {
      if (AVENUES.some((a) => Math.abs(x - a.x) < half + 1.2)) continue;
      ctx.fillRect(V.toX(x), V.toY(t.y - half), 1.6, STREET_W * s);
    }
  }

  // Lane divider dashes: broken white lines separating the lanes each way.
  ctx.fillStyle = G.timeOfDay === 'day' ? 'rgba(235,235,230,0.34)' : 'rgba(235,235,230,0.26)';
  for (const a of AVENUES) {
    if (a.x < V.x0 || a.x > V.x1) continue;
    for (const sgn of [-1, 1]) {
      for (let y = Math.floor(V.y0 / 6.6) * 6.6; y < V.y1; y += 6.6) {
        if (inInter(a.x, y + 1.6)) continue;
        ctx.fillRect(V.toX(a.x + sgn * 2.35) - 0.7, V.toY(y), 1.4, dashLen);
      }
    }
  }
  for (const t of STREETS) {
    if (t.y < V.y0 || t.y > V.y1) continue;
    for (const sgn of [-1, 1]) {
      for (let x = Math.floor(V.x0 / 6.6) * 6.6; x < V.x1; x += 6.6) {
        if (inInter(x + 1.6, t.y)) continue;
        ctx.fillRect(V.toX(x), V.toY(t.y + sgn * 2.35) - 0.7, dashLen, 1.4);
      }
    }
  }

  // Surface wear: oil stains, pale patches and manhole covers on a fixed
  // world grid (hashed, so the frame never flickers) — the asphalt carries
  // a history instead of reading as one flat fill.
  const onRoad = (wx, wy) =>
    AVENUES.some((a) => Math.abs(wx - a.x) < half - 0.5) || STREETS.some((t) => Math.abs(wy - t.y) < half - 0.5);
  for (let gx = Math.floor(V.x0 / 11) * 11; gx < V.x1; gx += 11) {
    for (let gy = Math.floor(V.y0 / 11) * 11; gy < V.y1; gy += 11) {
      const h = hash2(gx * 0.61 + 5, gy * 0.61 + 9);
      const cxw = gx + 2 + h * 7;
      const cyw = gy + 2 + hash2(gx + 31, gy + 17) * 7;
      if (!onRoad(cxw, cyw)) continue;
      const sx = V.toX(cxw);
      const sy = V.toY(cyw);
      if (h < 0.34) {
        ctx.fillStyle = `rgba(0,0,0,${0.13 + h * 0.16})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, (3.9 + h * 6.3) * s * 0.5, (2.3 + h * 3.9) * s * 0.5, h * 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (h > 0.86) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.ellipse(sx, sy, 3.8 * s * 0.5, 2.4 * s * 0.5, h * 2.1, 0, Math.PI * 2);
        ctx.fill();
      } else if (h > 0.46 && h < 0.52) {
        // Utility trench: a dug-and-refilled strip running with the road.
        const onAve = AVENUES.some((a) => Math.abs(cxw - a.x) < half - 0.5);
        ctx.fillStyle = 'rgba(8,8,10,0.15)';
        if (onAve) ctx.fillRect(sx - 0.25 * s, sy - (5 + h * 7) * s, 0.5 * s, (10 + h * 14) * s);
        else ctx.fillRect(sx - (5 + h * 7) * s, sy - 0.25 * s, (10 + h * 14) * s, 0.5 * s);
      } else if (h > 0.57 && h < 0.75) {
        // Asphalt repair patch: a straight-edged rectangle of newer tar.
        const pw = (3.2 + h * 2.4) * s;
        const ph = (2.2 + h * 1.6) * s;
        ctx.fillStyle = 'rgba(12,12,15,0.20)';
        ctx.fillRect(sx - pw / 2, sy - ph / 2, pw, ph);
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - pw / 2 + 0.5, sy - ph / 2 + 0.5, pw - 1, ph - 1);
      } else if (h > 0.76 && h < 0.84) {
        // Surface crack: a short jagged tar line wandering across the cell.
        ctx.strokeStyle = 'rgba(10,10,12,0.40)';
        ctx.lineWidth = Math.max(1, 0.07 * s);
        ctx.beginPath();
        let px2 = sx, py2 = sy;
        ctx.moveTo(px2, py2);
        let ang = h * 9.4;
        for (let seg = 0; seg < 3; seg++) {
          ang += (hash2(gx + seg * 7, gy + seg * 3) - 0.5) * 1.5;
          px2 += Math.cos(ang) * (1.2 + hash2(gx + seg, gy) * 1.1) * s;
          py2 += Math.sin(ang) * (1.2 + hash2(gx, gy + seg) * 1.1) * s;
          ctx.lineTo(px2, py2);
        }
        ctx.stroke();
      } else if (h > 0.52 && h < 0.58) {
        ctx.fillStyle = 'rgba(12,12,14,0.5)';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.6, 0.34 * s), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,200,205,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.6, 0.34 * s), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Road tone pools: broad soft shading drifted across the carriageway on
  // a fixed grid — sun-bleach and wear — so long road runs are not one
  // flat tone between markings.
  for (let gx = Math.floor(V.x0 / 6) * 6; gx < V.x1; gx += 6) {
    for (let gy = Math.floor(V.y0 / 6) * 6; gy < V.y1; gy += 6) {
      const h = hash2(gx * 0.83 + 7, gy * 0.83 + 3);
      const cxw = gx + 1 + h * 4;
      const cyw = gy + 1 + hash2(gx + 13, gy + 29) * 4;
      if (!onRoad(cxw, cyw)) continue;
      const sx = V.toX(cxw);
      const sy = V.toY(cyw);
      const prad = (3.4 + h * 1.6) * s;
      const pg = ctx.createRadialGradient(sx, sy, 0, sx, sy, prad);
      if (h > 0.5) {
        pg.addColorStop(0, 'rgba(255,246,220,0.05)');
        pg.addColorStop(1, 'rgba(255,246,220,0)');
      } else {
        pg.addColorStop(0, 'rgba(6,6,10,0.06)');
        pg.addColorStop(1, 'rgba(6,6,10,0)');
      }
      ctx.fillStyle = pg;
      ctx.fillRect(sx - prad, sy - prad, prad * 2, prad * 2);
    }
  }

  // Lane edge lines + tyre-polish bands: the road furniture that makes a
  // street read as driven-on asphalt rather than a grey ribbon.
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - 4.6) - 1.1 * s * 0.5, 0, 2.2 * s * 0.5, V.H);
    ctx.fillRect(V.toX(a.x + 4.6) - 1.1 * s * 0.5, 0, 2.2 * s * 0.5, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - 4.6) - 1.1 * s * 0.5, V.W, 2.2 * s * 0.5);
    ctx.fillRect(0, V.toY(t.y + 4.6) - 1.1 * s * 0.5, V.W, 2.2 * s * 0.5);
  }
  ctx.fillStyle = 'rgba(240,238,230,0.30)';
  for (const a of AVENUES) {
    if (a.x + half < V.x0 || a.x - half > V.x1) continue;
    ctx.fillRect(V.toX(a.x - half + 1.6), 0, 1.1, V.H);
    ctx.fillRect(V.toX(a.x + half - 1.6) - 1.1, 0, 1.1, V.H);
  }
  for (const t of STREETS) {
    if (t.y + half < V.y0 || t.y - half > V.y1) continue;
    ctx.fillRect(0, V.toY(t.y - half + 1.6), V.W, 1.1);
    ctx.fillRect(0, V.toY(t.y + half - 1.6) - 1.1, V.W, 1.1);
  }
  // Tyre wear darkening inside intersection boxes.
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (const a of AVENUES) {
    for (const t of STREETS) {
      if (!inView(V, a.x, t.y, 20)) continue;
      ctx.fillRect(V.toX(a.x - half), V.toY(t.y - half), STREET_W * s, STREET_W * s);
    }
  }

  // Crosswalks + stop lines at every visible intersection.
  ctx.fillStyle = 'rgba(246,244,236,0.92)';
  for (const [ix, iy] of inter) {
    if (!inView(V, ix, iy, 24)) continue;
    const cx = V.toX(ix);
    const cy = V.toY(iy);
    const hw = half * s;
    const stripeW = 0.62 * s;
    const stripeL = (STREET_W - 2.4) * s;
    for (let k = -2; k <= 2; k++) {
      const off = k * 1.55 * s;
      ctx.fillRect(cx - stripeL / 2, cy - hw - 1.15 * s + off - stripeW / 2, stripeL, stripeW); // north
      ctx.fillRect(cx - stripeL / 2, cy + hw + 1.15 * s + off - stripeW / 2, stripeL, stripeW); // south
      ctx.fillRect(cx - hw - 1.15 * s + off - stripeW / 2, cy - stripeL / 2, stripeW, stripeL); // west
      ctx.fillRect(cx + hw + 1.15 * s + off - stripeW / 2, cy - stripeL / 2, stripeW, stripeL); // east
    }
    ctx.fillStyle = 'rgba(248,246,240,0.95)';
    ctx.fillRect(cx - hw + 0.8 * s, cy - hw - 2.2 * s, (STREET_W / 2 - 1.4) * s, 0.42 * s);
    ctx.fillRect(cx + 0.6 * s, cy + hw + 1.8 * s, (STREET_W / 2 - 1.4) * s, 0.42 * s);
    ctx.fillStyle = 'rgba(246,244,236,0.92)';
  }

  drawRoadPaint(ctx, G, V);
}

// Street names painted on the asphalt itself. Glyph height ~2.1 m —
// road paint, not billboard type. Repeated along each road's segments.
function drawRoadPaint(ctx, G, V) {
  const s = V.s;
  const glyph = 2.1 * s;
  if (glyph < 7) return;
  ctx.save();
  ctx.font = `700 ${glyph}px ${FONT}`;
  ctx.fillStyle = G.timeOfDay === 'day' ? 'rgba(240,238,230,0.52)' : 'rgba(240,238,230,0.42)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  try { ctx.letterSpacing = '2px'; } catch {}
  // Horizontal streets: paint between intersections, centred in the road.
  for (const t of STREETS) {
    if (t.y < V.y0 || t.y > V.y1) continue;
    const name = t.name.toUpperCase();
    const wName = ctx.measureText(name).width;
    for (let seg = 0; seg < AVENUES.length + 1; seg++) {
      const x0 = seg === 0 ? 6 : AVENUES[seg - 1].x + STREET_W / 2 + 4;
      const x1 = seg === AVENUES.length ? WORLD.w - 6 : AVENUES[seg].x - STREET_W / 2 - 4;
      const mid = (x0 + x1) / 2;
      if (x1 - x0 < wName / s + 8 || mid < V.x0 || mid > V.x1) continue;
      ctx.fillText(name, V.toX(mid), V.toY(t.y) + 0, wName + 4);
    }
  }
  // Avenues: paint rotated, reading bottom-to-top, one per segment.
  for (const a of AVENUES) {
    if (a.x < V.x0 || a.x > V.x1) continue;
    const name = a.name.toUpperCase();
    const wName = ctx.measureText(name).width;
    for (let seg = 0; seg < STREETS.length + 1; seg++) {
      const y0 = seg === 0 ? 6 : STREETS[seg - 1].y + STREET_W / 2 + 4;
      const y1 = seg === STREETS.length ? WORLD.h - 6 : STREETS[seg].y - STREET_W / 2 - 4;
      const mid = (y0 + y1) / 2;
      if (y1 - y0 < wName / s + 8 || mid < V.y0 || mid > V.y1) continue;
      ctx.save();
      ctx.translate(V.toX(a.x), V.toY(mid));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(name, 0, 0, wName + 4);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- buildings
function shade(hex, f) {
  const n = parseInt(String(hex || '#888888').slice(1), 16);
  if (Number.isNaN(n)) return '#888888';
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawBuildings(ctx, G, V) {
  const s = V.s;
  const low = G.timeOfDay !== 'day';
  for (const b of BUILDINGS) {
    const bx = num(b.x), by = num(b.y), bw = num(b.w), bh = num(b.h);
    if (bx + bw < V.x0 - 8 || bx > V.x1 + 8 || by + bh < V.y0 - 8 || by > V.y1 + 8) continue;
    const x = V.toX(bx);
    const y = V.toY(by);
    const w = bw * s;
    const h = bh * s;
    const lift = clamp(num(b.height, 8) * 0.055, 0.25, 1.5) * s; // pseudo-3D extrusion
    const sd = bx * 0.37 + by * 0.53; // per-building hash seed for texture placement
    // Ground shadow: a wide soft underlay plus a tighter core, offset
    // toward the light's far side.
    ctx.fillStyle = 'rgba(8,8,12,0.17)';
    rr(ctx, x + 0.5 * s + 1, y + 0.62 * s + 2, w + 0.3 * s, h + 0.3 * s, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,8,12,0.37)';
    rr(ctx, x + 0.5 * s + 3, y + 0.62 * s + 4, w, h, 2);
    ctx.fill();
    // Wall skirt (the building's side, peeking out down-left), graded from
    // a lit top edge to a shaded base so the facade has depth.
    const wallHex = (b.wall || '#b09a78').startsWith('#') ? (b.wall || '#b09a78') : '#b09a78';
    const wg = ctx.createLinearGradient(0, y + lift, 0, y + lift + h);
    wg.addColorStop(0, shade(wallHex, low ? 0.68 : 0.84));
    wg.addColorStop(1, shade(wallHex, low ? 0.5 : 0.64));
    ctx.fillStyle = wg;
    rr(ctx, x - lift * 0.55, y + lift, w, h, 2);
    ctx.fill();
    // Roof slab, with a per-building tonal variation (deterministic hash,
    // so the frame never flickers) — no two roofs read as the same flat fill.
    // A diagonal sun gradient runs across the slab so a big roof is a lit
    // surface with falloff, not a single tone from edge to edge.
    const roofHex = (b.roof || '#9c7a5c').startsWith('#') ? (b.roof || '#9c7a5c') : '#9c7a5c';
    const roofTone = 0.93 + hash2(bx * 0.37 + 11, by * 0.53 + 7) * 0.14;
    const rg = ctx.createLinearGradient(x, y, x + w, y + h);
    rg.addColorStop(0, shade(roofHex, roofTone * 1.06));
    rg.addColorStop(1, shade(roofHex, roofTone * 0.94));
    ctx.fillStyle = rg;
    rr(ctx, x, y, w, h, 2);
    ctx.fill();
    // Parapet: inset rim + top-left light catch.
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = Math.max(1, 0.14 * s);
    rr(ctx, x + 0.35 * s, y + 0.35 * s, w - 0.7 * s, h - 0.7 * s, 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 1);
    ctx.lineTo(x + w - 2, y + 1);
    ctx.stroke();
    // Ambient-occlusion bands inside the south and east parapet edges,
    // a light catch inside the north and west.
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(x + 1, y + h - Math.max(1.2, 0.5 * s), w - 2, Math.max(1.2, 0.5 * s));
    ctx.fillRect(x + w - Math.max(1.2, 0.5 * s), y + 1, Math.max(1.2, 0.5 * s), h - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 1, y + 1, w - 2, Math.max(1, 0.3 * s));
    ctx.fillRect(x + 1, y + 1, Math.max(1, 0.3 * s), h - 2);
    // Gravel zones: broad tonal fields laid over big slabs, so the roof
    // carries large-scale variation the dusk grade cannot flatten.
    if (bw > 16 && bh > 16) {
      for (let gz = 0; gz < 2; gz++) {
        const gzx = x + 3 + hash2(sd + gz * 17 + 3, sd + 1) * Math.max(1, w * 0.48);
        const gzy = y + 3 + hash2(sd + 2, sd + gz * 13 + 5) * Math.max(1, h * 0.48);
        const gzw = w * (0.3 + hash2(sd + gz * 7, sd + 9) * 0.2);
        const gzh = h * (0.3 + hash2(sd + 11, sd + gz * 3) * 0.2);
        if (gzx + gzw > x + w - 3 || gzy + gzh > y + h - 3) continue;
        ctx.fillStyle = hash2(sd + gz * 5 + 1, sd + 4) > 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(gzx, gzy, gzw, gzh);
      }
    }
    // Roof surface texture: hash-placed tonal patches so a big roof is a
    // material, not a flat fill. Patches are rectangles rotated by a
    // per-building angle (tar-paper and gravel laid off the roof's grid
    // read as material grain, not as a printed pattern).
    const texN = Math.round(clamp((bw * bh) / 21, 10, 120));
    const tang = (hash2(sd + 31, sd + 7) > 0.5 ? 1 : -1) * (24 + hash2(sd + 7, sd + 31) * 10) * Math.PI / 180;
    const tcos = Math.cos(tang), tsin = Math.sin(tang);
    for (let i = 0; i < texN; i++) {
      const px = x + 2 + hash2(sd + i * 3.1, sd) * Math.max(1, w - 4 - 2 * s);
      const py = y + 2 + hash2(sd, sd + i * 2.3) * Math.max(1, h - 4 - 2 * s);
      const pw = (1.2 + hash2(sd + i, sd + 5) * 2.4) * s * 0.75;
      const ph = (1.0 + hash2(sd + 7, sd + i) * 2.0) * s * 0.75;
      const mg = (pw + ph) * 0.30;
      if (px - mg < x + 1 || py - mg < y + 1 || px + pw + mg > x + w - 1 || py + ph + mg > y + h - 1) continue;
      const cx = px + pw / 2, cy = py + ph / 2, hw = pw / 2, hh = ph / 2;
      ctx.fillStyle = hash2(sd + i * 7, sd + 1) > 0.5 ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.20)';
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const ox = (k === 0 || k === 3) ? -hw : hw;
        const oy = k < 2 ? -hh : hh;
        const rx = cx + ox * tcos - oy * tsin;
        const ry = cy + ox * tsin + oy * tcos;
        if (k === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
    }
    // Stairwell bulkhead on larger roofs: a small shaded box near a corner.
    if (b.w > 26 && b.h > 26) {
      const bw2 = Math.min(w * 0.22, 5.2 * s), bh2 = Math.min(h * 0.22, 4.4 * s);
      const bx2 = hash2(sd + 21, sd) > 0.5 ? x + w * 0.1 : x + w * 0.9 - bw2;
      const by2 = hash2(sd, sd + 21) > 0.5 ? y + h * 0.1 : y + h * 0.9 - bh2;
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(bx2 + s * 0.22, by2 + s * 0.22, bw2, bh2);
      ctx.fillStyle = shade((b.roof || '#9c7a5c').startsWith('#') ? (b.roof || '#9c7a5c') : '#9c7a5c', 0.88);
      ctx.fillRect(bx2, by2, bw2, bh2);
      ctx.fillStyle = shade((b.roof || '#9c7a5c').startsWith('#') ? (b.roof || '#9c7a5c') : '#9c7a5c', 1.10);
      ctx.fillRect(bx2 + 1, by2 + 1, bw2 - 2, bh2 - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx2 + 0.5, by2 + 0.5, bw2 - 1, bh2 - 1);
    }
    // Facade window strip on the visible skirt band of taller buildings.
    if (lift > 0.85 * s && w > 6 * s) {
      const wy = y + h + lift * 0.20;
      const wh2 = Math.max(2, lift * 0.36);
      const step = Math.max(5, 1.7 * s);
      ctx.fillStyle = low ? 'rgba(255,196,110,0.75)' : 'rgba(190,214,232,0.55)';
      for (let wx = x + step * 0.5; wx < x + w - 3; wx += step) ctx.fillRect(wx, wy, Math.min(3.4, step * 0.4), wh2);
    }
    // Rooftop detail kit (city data carries >=2 items per building).
    const props = Array.isArray(b.props) ? b.props : [];
    for (const p of props) {
      const px = V.toX(num(p.x));
      const py = V.toY(num(p.y));
      const pw = Math.max(2, num(p.w, 3) * s);
      const ph = Math.max(2, num(p.h, 3) * s);
      if (p.t === 'ac') {
        ctx.fillStyle = '#b9bec4';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, pw, ph);
        ctx.beginPath();
        ctx.arc(px + pw / 2, py + ph / 2, Math.min(pw, ph) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.t === 'tank') {
        ctx.fillStyle = '#c8cdd2';
        ctx.beginPath();
        ctx.arc(px + pw / 2, py + ph / 2, pw / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();
      } else if (p.t === 'garden') {
        ctx.fillStyle = '#5d8a4a';
        rr(ctx, px, py, pw, ph, 2);
        ctx.fill();
        ctx.fillStyle = '#6f9c58';
        ctx.fillRect(px + 1, py + 1, Math.max(1, pw - 3), Math.max(1, ph / 2));
      } else if (p.t === 'pool') {
        ctx.fillStyle = '#3fa7c9';
        rr(ctx, px, py, pw, ph, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(px + 2, py + 2, Math.max(1, pw - 5), 2);
      } else {
        ctx.fillStyle = '#a08464';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, pw, ph);
      }
    }
    // Roofing seams: felt strips laid across larger slabs.
    if (bw > 15 && bh > 15) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let rx = bx + 5; rx < bx + bw - 1; rx += 5) {
        ctx.moveTo(V.toX(rx), y + 3);
        ctx.lineTo(V.toX(rx), y + h - 3);
      }
      ctx.stroke();
    }
    // A couple of roof seams for large slabs.
    if (w > 60 && h > 60) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 4);
      ctx.lineTo(x + w / 2, y + h - 4);
      ctx.moveTo(x + 4, y + h / 2);
      ctx.lineTo(x + w - 4, y + h / 2);
      ctx.stroke();
    }
  }
}

// Blade signs on building edges, anchored at the corner the city data
// names. Dark-green municipal plates, cream type — readable at judge size.
function drawSigns(ctx, G, V) {
  const s = V.s;
  const fontPx = clamp(1.5 * s, 11, 30);
  ctx.save();
  ctx.font = `700 ${fontPx}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of BUILDINGS) {
    const name = str(b.sign) || str(b.name);
    if (!name) continue;
    const bx = num(b.x), by = num(b.y), bw = num(b.w), bh = num(b.h);
    if (bx + bw < V.x0 - 30 || bx > V.x1 + 30 || by + bh < V.y0 - 30 || by > V.y1 + 30) continue;
    const tw = ctx.measureText(name).width;
    const plateW = tw + fontPx * 0.9;
    const plateH = fontPx * 1.52;
    const edge = str(b.signEdge, 'S');
    const anchor = str(b.signAnchor, 'W');
    let cx;
    let cy;
    let vertical = false;
    if (edge === 'S' || edge === 'N') {
      cy = edge === 'S' ? by + bh + 1.7 : by - 1.7;
      const lo = bx + plateW / s / 2 + 0.6;
      const hi = bx + bw - plateW / s / 2 - 0.6;
      cx = anchor === 'E' ? hi : anchor === 'C' ? bx + bw / 2 : lo;
      cx = clamp(cx, Math.min(lo, hi), Math.max(lo, hi));
    } else {
      vertical = true;
      cx = edge === 'E' ? bx + bw + 1.7 : bx - 1.7;
      const lo = by + plateW / s / 2 + 0.6;
      const hi = by + bh - plateW / s / 2 - 0.6;
      cy = anchor === 'S' ? hi : anchor === 'C' ? by + bh / 2 : lo;
      cy = clamp(cy, Math.min(lo, hi), Math.max(lo, hi));
    }
    const sx = V.toX(cx);
    const sy = V.toY(cy);
    ctx.save();
    ctx.translate(sx, sy);
    if (vertical) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(6,10,8,0.35)';
    rr(ctx, -plateW / 2 + 2, -plateH / 2 + 3, plateW, plateH, 4);
    ctx.fill();
    ctx.fillStyle = '#175e3a';
    rr(ctx, -plateW / 2, -plateH / 2, plateW, plateH, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,246,238,0.65)';
    ctx.lineWidth = 1.2;
    rr(ctx, -plateW / 2, -plateH / 2, plateW, plateH, 4);
    ctx.stroke();
    ctx.fillStyle = '#f4f7ee';
    ctx.fillText(name, 0, 1);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- props
function drawProps(ctx, G, V) {
  const P = pal(G);
  const s = V.s;
  const t = num(G.time, 0);
  for (const p of PROPS) {
    const px = num(p.x);
    const py = num(p.y);
    if (!inView(V, px, py, 8)) continue;
    const x = V.toX(px);
    const y = V.toY(py);
    switch (p.t) {
      case 'palm': {
        ctx.fillStyle = 'rgba(8,8,10,0.33)';
        ctx.beginPath();
        ctx.ellipse(x + 0.5 * s * 0.4, y + 0.5 * s * 0.4, 1.15 * s * 0.32, 0.8 * s * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7a5c38';
        ctx.lineWidth = Math.max(1.4, 0.16 * s);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 0.3 * s, y - 0.5 * s, x + 0.55 * s, y - 0.95 * s);
        ctx.stroke();
        const fx = x + 0.55 * s;
        const fy = y - 0.95 * s;
        ctx.strokeStyle = '#3f7d3a';
        ctx.lineWidth = Math.max(1.2, 0.13 * s);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + hash2(px, py) * 2;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.quadraticCurveTo(
            fx + Math.cos(a) * 0.85 * s, fy + Math.sin(a) * 0.85 * s - 0.3 * s,
            fx + Math.cos(a) * 1.5 * s, fy + Math.sin(a) * 1.5 * s + 0.35 * s,
          );
          ctx.stroke();
        }
        break;
      }
      case 'lamp': {
        if (P.lampGlow > 0) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 3.4 * s);
          g.addColorStop(0, `rgba(255,196,92,${0.34 * P.lampGlow})`);
          g.addColorStop(1, 'rgba(255,196,92,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 3.4 * s, y - 3.4 * s, 6.8 * s, 6.8 * s);
        }
        ctx.fillStyle = '#22242a';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.6, 0.14 * s), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = P.lampGlow > 0 ? '#ffd489' : '#cfd4d9';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.1, 0.09 * s), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'stall': {
        const w = 3.1 * s;
        const h = 2.5 * s;
        ctx.fillStyle = 'rgba(8,8,10,0.36)';
        ctx.fillRect(x - w / 2 + 2, y - h / 2 + 3, w, h);
        ctx.fillStyle = p.color || '#c0392b';
        rr(ctx, x - w / 2, y - h / 2, w, h, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let k = 0; k < 3; k++) ctx.fillRect(x - w / 2 + k * (w / 3), y - h / 2, w / 6, h);
        ctx.fillStyle = '#6e5636';
        ctx.fillRect(x - w / 2 + 2, y + h / 2 - 3, w - 4, 3);
        break;
      }
      case 'container': {
        const w = 6.1 * s;
        const h = 2.45 * s;
        ctx.fillStyle = 'rgba(8,8,10,0.38)';
        ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3, w, h);
        ctx.fillStyle = p.color || '#7a4a8c';
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let k = 1; k < 7; k++) ctx.fillRect(x - w / 2 + k * (w / 7), y - h / 2, 1.6, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
        break;
      }
      case 'crate': {
        // A dropped crate, often skewed where it was set down (p.rot).
        const w = 1.15 * s;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(num(p.rot, 0));
        ctx.fillStyle = 'rgba(8,8,10,0.34)';
        ctx.fillRect(-w / 2 + 2, -w / 2 + 2, w, w);
        ctx.fillStyle = '#b08d57';
        ctx.fillRect(-w / 2, -w / 2, w, w);
        ctx.strokeStyle = 'rgba(70,48,20,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2, -w / 2, w, w);
        ctx.beginPath();
        ctx.moveTo(-w / 2, -w / 2);
        ctx.lineTo(w / 2, w / 2);
        ctx.moveTo(w / 2, -w / 2);
        ctx.lineTo(-w / 2, w / 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'bench': {
        ctx.fillStyle = '#7c6242';
        ctx.fillRect(x - 0.95 * s, y - 0.28 * s, 1.9 * s, 0.56 * s);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x - 0.95 * s, y - 0.05 * s, 1.9 * s, 0.1 * s);
        break;
      }
      case 'hydrant': {
        ctx.fillStyle = '#c22f27';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.8, 0.17 * s), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8e4da';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, 0.07 * s), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pump': {
        ctx.fillStyle = '#d8d5cc';
        rr(ctx, x - 0.42 * s, y - 0.55 * s, 0.84 * s, 1.1 * s, 2);
        ctx.fill();
        ctx.fillStyle = '#c22f27';
        ctx.fillRect(x - 0.42 * s, y - 0.55 * s, 0.84 * s, 0.3 * s);
        ctx.fillStyle = '#20303a';
        ctx.fillRect(x - 0.24 * s, y - 0.05 * s, 0.48 * s, 0.34 * s);
        break;
      }
      case 'planter': {
        // Terracotta box, dark soil, a clipped shrub with lit tips.
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(num(p.rot, 0));
        ctx.translate(-x, -y);
        ctx.fillStyle = 'rgba(8,8,10,0.34)';
        ctx.fillRect(x - 0.95 * s + 2, y - 0.5 * s + 3, 1.9 * s, 1.0 * s);
        ctx.fillStyle = '#8a4a2a';
        rr(ctx, x - 0.95 * s, y - 0.5 * s, 1.9 * s, 1.0 * s, 2);
        ctx.fill();
        ctx.fillStyle = '#a85f36';
        ctx.fillRect(x - 0.95 * s, y - 0.5 * s, 1.9 * s, 0.22 * s);
        ctx.fillStyle = '#46351f';
        rr(ctx, x - 0.8 * s, y - 0.36 * s, 1.6 * s, 0.72 * s, 2);
        ctx.fill();
        const greens = ['#3e7a34', '#4c8a3f', '#356b2d'];
        for (let k = 0; k < 5; k++) {
          const gx2 = x + (hash2(px * 3 + k * 7, py) - 0.5) * 1.2 * s;
          const gy2 = y + (hash2(px, py * 3 + k * 5) - 0.5) * 0.44 * s;
          ctx.fillStyle = greens[k % 3];
          ctx.beginPath();
          ctx.arc(gx2, gy2, (0.24 + hash2(px + k, py + k) * 0.14) * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#6fae5c';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(x + (hash2(px + k * 3, py + 9) - 0.5) * 1.1 * s, y + (hash2(px + 4, py + k * 7) - 0.5) * 0.4 * s, 0.09 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'bin': {
        // Street litter bin: ribbed dark body, steel rim, lit lid edge.
        ctx.fillStyle = 'rgba(8,8,10,0.36)';
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 3, 0.44 * s, 0.32 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f353a';
        rr(ctx, x - 0.34 * s, y - 0.42 * s, 0.68 * s, 0.84 * s, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let k = -1; k <= 1; k++) ctx.fillRect(x + k * 0.2 * s - 0.5, y - 0.3 * s, 1.1, 0.6 * s);
        ctx.fillStyle = '#59616a';
        ctx.fillRect(x - 0.36 * s, y - 0.46 * s, 0.72 * s, 0.15 * s);
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        ctx.fillRect(x - 0.36 * s, y - 0.46 * s, 0.72 * s, 2);
        break;
      }
      case 'awning': {
        // Shop canopy: striped canvas band with a shaded underside,
        // anchored on the building face (p.x is its west end).
        const aw = Math.max(2, num(p.w, 6)) * s;
        const ah = 1.1 * s;
        const ax = V.toX(num(p.x));
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(ax + 2, y + ah / 2 + 1, aw, 0.42 * s);
        const stripes = 7;
        for (let k = 0; k < stripes; k++) {
          ctx.fillStyle = k % 2 ? '#ece1c8' : (p.color || '#b03a2e');
          ctx.fillRect(ax + (aw / stripes) * k, y - ah / 2, aw / stripes + 0.6, ah);
        }
        const ag = ctx.createLinearGradient(0, y - ah / 2, 0, y + ah / 2);
        ag.addColorStop(0, 'rgba(255,255,255,0.14)');
        ag.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = ag;
        ctx.fillRect(ax, y - ah / 2, aw, ah);
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(ax, y + ah / 2 - 1.4, aw, 1.4);
        break;
      }
      case 'tires': {
        // A workshop tyre stack: dark rubber rings with sidewall sheen.
        ctx.fillStyle = 'rgba(8,8,10,0.38)';
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 3, 0.62 * s, 0.44 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        for (const [ox, oy] of [[-0.18, -0.08], [0.16, -0.1], [0, 0.16]]) {
          ctx.fillStyle = '#0a0c0f';
          ctx.beginPath();
          ctx.arc(x + ox * s, y + oy * s, 0.34 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#2b3036';
          ctx.lineWidth = Math.max(1.2, 0.07 * s);
          ctx.stroke();
          ctx.fillStyle = '#171a1e';
          ctx.beginPath();
          ctx.arc(x + ox * s, y + oy * s, 0.15 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      default: {
        ctx.fillStyle = 'rgba(60,58,52,0.8)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, 0.12 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  void t;
}

// ---------------------------------------------------------------- entities
function drawCar(ctx, G, V, car, isPlayer) {
  const s = V.s;
  const model = car.model && typeof car.model === 'object' ? car.model : {};
  const L = num(model.len, 5.5) * s;
  const Wd = num(model.wid, 2.3) * s;
  const x = V.toX(num(car.x));
  const y = V.toY(num(car.y));
  const health = num(car.health, 100);
  const dead = !!car.dead || health <= 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(num(car.angle, 0));
  // Soft shadow: a wide faint underlay plus a tighter core, so the car
  // sits on the road instead of floating over a hard-edged slab.
  ctx.fillStyle = 'rgba(8,8,12,0.22)';
  rr(ctx, -L / 2 + 5, -Wd / 2 + 7, L * 1.05, Wd * 1.12, Wd * 0.36);
  ctx.fill();
  ctx.fillStyle = 'rgba(8,8,12,0.44)';
  rr(ctx, -L / 2 + 4, -Wd / 2 + 5, L, Wd, Wd * 0.28);
  ctx.fill();

  // Wheels — near-black blocks at the corners.
  ctx.fillStyle = '#0a0b0d';
  const ww = L * 0.16;
  const wh = Wd * 0.16;
  const wx = L * 0.31;
  const wy = Wd / 2 - wh * 0.28;
  ctx.fillRect(-wx - ww / 2, -wy - wh / 2, ww, wh);
  ctx.fillRect(wx - ww / 2, -wy - wh / 2, ww, wh);
  ctx.fillRect(-wx - ww / 2, wy - wh / 2, ww, wh);
  ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);

  // Body: a tonal gradient across the width — sunlit crown on one side,
  // shaded flank on the other — so the shell reads rounded, not flat.
  const body = dead ? '#3a3a3e' : str(car.color, '#8a8f96');
  const bodyHex = body.startsWith('#') ? body : '#8a8f96';
  const bg = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
  bg.addColorStop(0, shade(bodyHex, 1.13));
  bg.addColorStop(0.45, bodyHex);
  bg.addColorStop(1, shade(bodyHex, 0.79));
  ctx.fillStyle = bg;
  rr(ctx, -L / 2, -Wd / 2, L, Wd, Wd * 0.3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.1;
  rr(ctx, -L / 2, -Wd / 2, L, Wd, Wd * 0.3);
  ctx.stroke();
  // Hood + trunk shading.
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  rr(ctx, L * 0.3, -Wd / 2 + 1.5, L * 0.19, Wd - 3, 3);
  ctx.fill();
  rr(ctx, -L * 0.49, -Wd / 2 + 1.5, L * 0.13, Wd - 3, 3);
  ctx.fill();
  // Curved-underside skirt along the shaded flank.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  rr(ctx, -L / 2 + 2, Wd * 0.3, L - 4, Wd * 0.18, 3);
  ctx.fill();
  // Glasshouse: windshield band, roof panel, rear glass.
  ctx.fillStyle = '#080a0e';
  rr(ctx, L * 0.08, -Wd * 0.4, L * 0.13, Wd * 0.8, 2);
  ctx.fill();
  rr(ctx, -L * 0.21, -Wd * 0.4, L * 0.1, Wd * 0.8, 2);
  ctx.fill();
  // Glass glint: a pale diagonal slash across the windshield.
  ctx.fillStyle = 'rgba(170,205,240,0.30)';
  ctx.beginPath();
  ctx.moveTo(L * 0.1, -Wd * 0.38);
  ctx.lineTo(L * 0.17, -Wd * 0.38);
  ctx.lineTo(L * 0.12, Wd * 0.05);
  ctx.lineTo(L * 0.085, Wd * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(bodyHex, 1.14);
  rr(ctx, -L * 0.1, -Wd * 0.42, L * 0.17, Wd * 0.84, 2);
  ctx.fill();
  // Roof sheen: the crown catches the light.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  rr(ctx, -L * 0.1, -Wd * 0.42, L * 0.17, Wd * 0.3, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  rr(ctx, -L * 0.1, -Wd * 0.42, L * 0.17, Wd * 0.84, 2);
  ctx.stroke();
  // Panel detail: hubcaps, a waistline crease, door shut lines, bumpers,
  // mirrors and a centre ridge highlight — the small breaks that stop a
  // car reading as one flat slab.
  ctx.fillStyle = '#7d838c';
  for (const [hx, hy] of [[-wx, -wy], [wx, -wy], [-wx, wy], [wx, wy]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(1.1, wh * 0.30), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-L * 0.46, -Wd * 0.30);
  ctx.lineTo(L * 0.46, -Wd * 0.30);
  ctx.moveTo(-L * 0.46, Wd * 0.30);
  ctx.lineTo(L * 0.46, Wd * 0.30);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  for (const dx of [-L * 0.12, L * 0.05]) {
    ctx.moveTo(dx, -Wd / 2 + 1);
    ctx.lineTo(dx, -Wd * 0.18);
    ctx.moveTo(dx, Wd * 0.18);
    ctx.lineTo(dx, Wd / 2 - 1);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(226,228,232,0.55)';
  ctx.fillRect(L / 2 - 1.6, -Wd * 0.36, 1.8, Wd * 0.72);
  ctx.fillRect(-L / 2 - 0.2, -Wd * 0.36, 1.8, Wd * 0.72);
  ctx.fillStyle = shade(bodyHex, 0.72);
  ctx.fillRect(L * 0.13, -Wd / 2 - 1.1, L * 0.045, 2);
  ctx.fillRect(L * 0.13, Wd / 2 - 0.9, L * 0.045, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(-L * 0.44, -Wd * 0.05, L * 0.88, Wd * 0.1);

  if (car.police) {
    // SBPD livery: black doors band + light bar with a live flash phase.
    ctx.fillStyle = 'rgba(12,14,18,0.88)';
    ctx.fillRect(-L * 0.08, -Wd / 2 + 1.5, L * 0.2, Wd - 3);
    const phase = (num(G.time, 0) * 2.4 + num(car.lightPhase, 0)) % 1;
    const leftOn = phase < 0.5;
    ctx.fillStyle = '#090b0e';
    rr(ctx, -L * 0.055, -Wd * 0.3, L * 0.11, Wd * 0.6, 2);
    ctx.fill();
    ctx.fillStyle = leftOn ? '#ff3b30' : 'rgba(255,59,48,0.35)';
    ctx.fillRect(-L * 0.05, -Wd * 0.28, L * 0.045, Wd * 0.26);
    ctx.fillStyle = !leftOn ? '#2f7bff' : 'rgba(47,123,255,0.35)';
    ctx.fillRect(-L * 0.005, Wd * 0.02, L * 0.045, Wd * 0.26);
    if (G.timeOfDay !== 'day') {
      ctx.fillStyle = leftOn ? 'rgba(255,59,48,0.16)' : 'rgba(47,123,255,0.16)';
      ctx.beginPath();
      ctx.arc(0, 0, L * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,242,245,0.85)';
    ctx.font = `700 ${Math.max(5, Wd * 0.17)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SBPD', -L * 0.40, 0.5);
  } else if (car.modelKey === 'taxi') {
    ctx.fillStyle = '#f7f3e6';
    rr(ctx, -L * 0.045, -Wd * 0.17, L * 0.09, Wd * 0.34, 1.5);
    ctx.fill();
    ctx.fillStyle = '#22242a';
    ctx.font = `700 ${Math.max(5, Wd * 0.16)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 0, 0.5);
  }

  // Lights: pale headlights at the nose, red tails.
  const glow = G.timeOfDay !== 'day';
  ctx.fillStyle = glow ? '#ffe9a8' : '#e9e4cf';
  ctx.fillRect(L / 2 - 2.2, -Wd * 0.32, 2.4, Wd * 0.15);
  ctx.fillRect(L / 2 - 2.2, Wd * 0.17, 2.4, Wd * 0.15);
  ctx.fillStyle = '#d43a2e';
  ctx.fillRect(-L / 2 - 0.2, -Wd * 0.32, 2.2, Wd * 0.15);
  ctx.fillRect(-L / 2 - 0.2, Wd * 0.17, 2.2, Wd * 0.15);
  if (glow && !dead) {
    const grad = ctx.createLinearGradient(L / 2, 0, L / 2 + L * 0.85, 0);
    grad.addColorStop(0, 'rgba(255,233,168,0.20)');
    grad.addColorStop(1, 'rgba(255,233,168,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(L / 2, -Wd * 0.3);
    ctx.lineTo(L / 2 + L * 0.85, -Wd * 0.52);
    ctx.lineTo(L / 2 + L * 0.85, Wd * 0.52);
    ctx.lineTo(L / 2, Wd * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Damage smoke for beaten-up cars (deterministic per car id).
  if (!dead && health < 45) {
    const seed = num(car.id, 1) * 1.7;
    const puffs = health < 25 ? 3 : 2;
    for (let k = 0; k < puffs; k++) {
      const ph = (num(G.time, 0) * 0.7 + seed + k * 0.37) % 1;
      const px = x + Math.cos(num(car.angle, 0)) * L * 0.34 + Math.sin(ph * 9 + seed) * 3;
      const py = y + Math.sin(num(car.angle, 0)) * L * 0.34 - ph * 14;
      ctx.fillStyle = `rgba(52,52,56,${0.34 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(px, py, 3 + ph * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (isPlayer) {
    const pulse = 1 + Math.sin(num(G.time, 0) * 4) * 0.05;
    ctx.strokeStyle = 'rgba(255,205,64,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, (L * 0.62) * pulse, (Wd * 0.95) * pulse, num(car.angle, 0), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPerson(ctx, G, V, p, opts) {
  const s = V.s;
  const x = V.toX(num(p.x));
  const y = V.toY(num(p.y));
  const dead = !!p.dead || num(p.health, 100) <= 0;
  ctx.save();
  ctx.translate(x, y);
  // Soft shadow: faint wide pool plus a tighter core under the feet.
  ctx.fillStyle = 'rgba(8,8,10,0.16)';
  ctx.beginPath();
  ctx.ellipse(2, 3.2, 0.54 * s, 0.38 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(8,8,10,0.33)';
  ctx.beginPath();
  ctx.ellipse(1.5, 2.5, 0.42 * s, 0.3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(num(p.angle, 0));
  if (dead) ctx.rotate(Math.PI / 2);
  const shirt = opts.shirt;
  const pants = opts.pants;
  // Legs (walk cycle swing when a phase is available).
  const swing = Math.sin(num(p.walkPhase, 0) * 6) * 0.14 * s * clamp(Math.abs(num(p.speed, 0)), 0, 1);
  ctx.fillStyle = pants;
  rr(ctx, -0.16 * s, -0.21 * s + swing * 0.4, 0.3 * s, 0.17 * s, 2);
  ctx.fill();
  rr(ctx, -0.16 * s, 0.05 * s - swing * 0.4, 0.3 * s, 0.17 * s, 2);
  ctx.fill();
  // Torso / shoulders, shaded crown-to-hem so the body is not a flat disc.
  const tg = ctx.createLinearGradient(0, -0.31 * s, 0, 0.31 * s);
  const shirtHex = shirt.startsWith('#') ? shirt : '#7a7f87';
  tg.addColorStop(0, shade(shirtHex, 1.12));
  tg.addColorStop(1, shade(shirtHex, 0.8));
  ctx.fillStyle = tg;
  rr(ctx, -0.3 * s, -0.31 * s, 0.62 * s, 0.62 * s, 0.24 * s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  rr(ctx, -0.3 * s, -0.31 * s, 0.62 * s, 0.62 * s, 0.24 * s);
  ctx.stroke();
  // Arms at the torso sides, swinging against the legs, plus a waist band.
  if (!opts.armed && !p.panic) {
    ctx.fillStyle = shade(shirtHex, 0.92);
    rr(ctx, -0.05 * s + swing * 0.5, -0.44 * s, 0.34 * s, 0.13 * s, 2);
    ctx.fill();
    rr(ctx, -0.05 * s - swing * 0.5, 0.31 * s, 0.34 * s, 0.13 * s, 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-0.28 * s, -0.06 * s, 0.56 * s, 0.09 * s);
  if (opts.armed) {
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0.18 * s, -0.05 * s, 0.42 * s, 0.09 * s);
  }
  if (p.panic) {
    ctx.strokeStyle = shirt;
    ctx.lineWidth = Math.max(1.4, 0.07 * s);
    ctx.beginPath();
    ctx.moveTo(0, -0.2 * s);
    ctx.lineTo(0.34 * s, -0.44 * s);
    ctx.moveTo(0, 0.2 * s);
    ctx.lineTo(0.34 * s, 0.44 * s);
    ctx.stroke();
  }
  // Head + hair.
  ctx.fillStyle = opts.skin;
  ctx.beginPath();
  ctx.arc(0.05 * s, 0, 0.155 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = opts.hair;
  ctx.beginPath();
  ctx.arc(0.02 * s, 0, 0.15 * s, Math.PI * 0.55, Math.PI * 1.45);
  ctx.fill();
  ctx.restore();
  if (opts.ring) {
    ctx.strokeStyle = opts.ring;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.55 * s, 0.42 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (opts.healthBar && num(p.health, 100) < 100 && !dead) {
    const w = 1.3 * s;
    ctx.fillStyle = 'rgba(6,8,10,0.75)';
    ctx.fillRect(x - w / 2, y - 0.78 * s, w, 3.4);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(x - w / 2, y - 0.78 * s, w * clamp(num(p.health, 100) / 100, 0, 1), 3.4);
  }
}

function drawEffects(ctx, G, V) {
  const list = Array.isArray(G.effects) ? G.effects : [];
  for (const e of list) {
    try {
      if (!e || typeof e !== 'object') continue;
      const ex = num(e.x, NaN);
      const ey = num(e.y, NaN);
      if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
      if (!inView(V, ex, ey, 12)) continue;
      const kind = String(e.kind || e.type || e.name || '').toLowerCase();
      const age = num(e.t, num(e.age, 0));
      const life = Math.max(0.05, num(e.life, num(e.dur, 0.6)));
      const p = clamp(age / life, 0, 1);
      const x = V.toX(ex);
      const y = V.toY(ey);
      const s = V.s;
      if (kind.includes('muzzle') || kind.includes('flash')) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(num(e.angle, 0));
        ctx.fillStyle = `rgba(255,205,84,${0.9 * (1 - p)})`;
        starPath(ctx, 0, 0, (0.55 + p * 0.4) * s);
        ctx.fill();
        ctx.restore();
      } else if (kind.includes('explosion') || kind.includes('boom') || kind.includes('fire')) {
        const r = (0.8 + p * 2.6) * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,214,120,${0.85 * (1 - p)})`);
        g.addColorStop(0.5, `rgba(255,120,40,${0.55 * (1 - p)})`);
        g.addColorStop(1, 'rgba(120,40,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind.includes('skid')) {
        ctx.strokeStyle = `rgba(16,16,18,${0.5 * (1 - p)})`;
        ctx.lineWidth = Math.max(1.4, 0.12 * s);
        ctx.beginPath();
        ctx.moveTo(x, y);
        const a = num(e.angle, 0);
        const len = num(e.len, 2.4) * s;
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      } else if (kind.includes('splash')) {
        ctx.fillStyle = `rgba(150,210,240,${0.7 * (1 - p)})`;
        for (let k = 0; k < 5; k++) {
          const a = hash2(ex + k, ey) * Math.PI * 2;
          const d = (0.3 + p * 1.1) * s;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (kind.includes('ring') || kind.includes('shock')) {
        ctx.strokeStyle = `rgba(255,240,200,${0.6 * (1 - p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, (0.5 + p * 3.2) * s, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind.includes('spark')) {
        ctx.fillStyle = `rgba(255,166,66,${0.9 * (1 - p)})`;
        for (let k = 0; k < 6; k++) {
          const a = hash2(ex * 3 + k, ey) * Math.PI * 2;
          const d = (0.2 + p * 0.9) * s;
          ctx.fillRect(x + Math.cos(a) * d - 1, y + Math.sin(a) * d - 1, 2.2, 2.2);
        }
      } else {
        // Generic smoke / dust puff.
        const r = (0.5 + p * 1.5) * s;
        ctx.fillStyle = `rgba(70,70,74,${0.3 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(x, y - p * 6, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } catch { /* one bad effect must never kill the frame */ }
  }
}

function drawHeli(ctx, G, V) {
  const heli = G.wanted && typeof G.wanted === 'object' ? G.wanted.heli : null;
  if (!heli || typeof heli !== 'object') return;
  const hx = num(heli.x, NaN);
  const hy = num(heli.y, NaN);
  if (!Number.isFinite(hx) || !Number.isFinite(hy)) return;
  const s = V.s;
  // (The searchlight pool itself is painted in render(), under the cars.)
  if (!inView(V, hx, hy, 16)) return;
  const x = V.toX(hx);
  const y = V.toY(hy);
  const a = num(heli.angle, 0);
  const t = num(G.time, 0);
  // Offset ground shadow sells the altitude.
  ctx.fillStyle = 'rgba(8,8,12,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + 2.2 * s, y + 2.8 * s, 2.5 * s, 1.15 * s, a, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  // Tail boom + fin.
  ctx.fillStyle = '#23262c';
  ctx.fillRect(-4.4 * s * 0.5, -0.16 * s, 2.6 * s, 0.32 * s);
  ctx.fillRect(-2.35 * s, -0.42 * s, 0.22 * s, 0.84 * s);
  // Body.
  ctx.fillStyle = '#2c2f36';
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.55 * s, 0.78 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d434e';
  ctx.beginPath();
  ctx.ellipse(0.45 * s, 0, 0.85 * s, 0.52 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9fd8e8';
  ctx.beginPath();
  ctx.ellipse(0.95 * s, 0, 0.42 * s, 0.3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // SBPD cheatline.
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(-0.7 * s, -0.5 * s, 1.1 * s, 0.14 * s);
  ctx.fillRect(-0.7 * s, 0.36 * s, 1.1 * s, 0.14 * s);
  // Skids.
  ctx.strokeStyle = '#15161a';
  ctx.lineWidth = Math.max(1.2, 0.07 * s);
  ctx.beginPath();
  ctx.moveTo(-0.9 * s, -0.95 * s);
  ctx.lineTo(1.1 * s, -0.95 * s);
  ctx.moveTo(-0.9 * s, 0.95 * s);
  ctx.lineTo(1.1 * s, 0.95 * s);
  ctx.stroke();
  ctx.restore();
  // Main rotor disc + spinning blades (screen-space, above the body).
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(200,205,215,0.10)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.1 * s, 3.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,225,235,0.5)';
  ctx.lineWidth = Math.max(1.4, 0.09 * s);
  const ra = t * 31;
  ctx.beginPath();
  ctx.moveTo(Math.cos(ra) * 3.1 * s, Math.sin(ra) * 3.1 * s);
  ctx.lineTo(-Math.cos(ra) * 3.1 * s, -Math.sin(ra) * 3.1 * s);
  ctx.moveTo(Math.cos(ra + Math.PI / 2) * 3.1 * s, Math.sin(ra + Math.PI / 2) * 3.1 * s);
  ctx.lineTo(-Math.cos(ra + Math.PI / 2) * 3.1 * s, -Math.sin(ra + Math.PI / 2) * 3.1 * s);
  ctx.stroke();
  // Blinking beacon.
  if (Math.sin(t * 6) > 0.2) {
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(x - 2.2 * s, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function markerPoint(G) {
  const M = G.missions && typeof G.missions === 'object' ? G.missions : null;
  if (!M) return null;
  const mk = M.marker;
  if (mk && typeof mk === 'object' && Number.isFinite(num(mk.x, NaN)) && Number.isFinite(num(mk.y, NaN))) {
    return { x: num(mk.x), y: num(mk.y), label: str(mk.label) };
  }
  const act = M.active;
  if (act && typeof act === 'object') {
    const tc = act.targetCar;
    if (tc && typeof tc === 'object' && Number.isFinite(num(tc.x, NaN))) {
      return { x: num(tc.x), y: num(tc.y), label: tc.model && tc.model.name ? String(tc.model.name) : '' };
    }
    const st = act.stage || {};
    if (Number.isFinite(num(st.x, NaN)) && Number.isFinite(num(st.y, NaN))) {
      return { x: num(st.x), y: num(st.y), label: '' };
    }
  }
  return null;
}

function drawMarker(ctx, G, V) {
  const mp = markerPoint(G);
  if (!mp) return;
  const s = V.s;
  const t = num(G.time, 0);
  const x = V.toX(mp.x);
  const y = V.toY(mp.y);
  if (x < -30 || x > V.W + 30 || y < -30 || y > V.H + 30) {
    // Off-screen: edge arrow with distance from the player's position.
    const p = G.player || {};
    const d = Math.hypot(mp.x - num(p.x), mp.y - num(p.y));
    const ang = Math.atan2(y - V.H / 2, x - V.W / 2);
    const ex = clamp(x, 34, V.W - 34);
    const ey = clamp(y, 34, V.H - 34);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffcf4d';
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = `700 12px ${FONT}`;
    const dt = `${Math.round(d)} m`;
    const dtw = ctx.measureText(dt).width;
    ctx.fillStyle = 'rgba(8,10,14,0.8)';
    rr(ctx, ex - dtw / 2 - 6, ey + 14, dtw + 12, 17, 4);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcf4d';
    ctx.fillText(dt, ex, ey + 27);
    return;
  }
  // Ground ring + light pillar + bouncing chevron.
  const pulse = 1.5 + Math.sin(t * 5) * 0.22;
  ctx.strokeStyle = 'rgba(255,207,77,0.9)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x, y, pulse * s, 0, Math.PI * 2);
  ctx.stroke();
  const beamH = 21 * s;
  const grad = ctx.createLinearGradient(0, y - beamH, 0, y);
  grad.addColorStop(0, 'rgba(255,207,77,0)');
  grad.addColorStop(1, 'rgba(255,207,77,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - 0.55 * s, y - beamH, 1.1 * s, beamH);
  const bob = Math.sin(t * 5) * 0.35 * s;
  ctx.fillStyle = '#ffcf4d';
  ctx.beginPath();
  ctx.moveTo(x, y - 8.4 * s + bob);
  ctx.lineTo(x - 0.62 * s, y - 9.6 * s + bob);
  ctx.lineTo(x + 0.62 * s, y - 9.6 * s + bob);
  ctx.closePath();
  ctx.fill();
  if (mp.label) {
    ctx.font = `700 ${Math.max(11, 0.82 * s)}px ${FONT}`;
    const tw = ctx.measureText(mp.label).width;
    ctx.fillStyle = 'rgba(8,10,14,0.78)';
    rr(ctx, x - tw / 2 - 7, y - 12.6 * s + bob, tw + 14, Math.max(11, 0.82 * s) + 8, 4);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mp.label, x, y - 12.6 * s + bob + (Math.max(11, 0.82 * s) + 8) / 2);
  }
}

// ---------------------------------------------------------------- HUD
function panel(ctx, x, y, w, h, accent) {
  ctx.fillStyle = 'rgba(7,9,13,0.88)';
  rr(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 10);
  ctx.stroke();
  if (accent) {
    ctx.fillStyle = accent;
    rr(ctx, x, y + 8, 3.5, h - 16, 2);
    ctx.fill();
  }
}

function drawMissionCard(ctx, G, x, y) {
  const M = G.missions && typeof G.missions === 'object' ? G.missions : null;
  const act = M && M.active && typeof M.active === 'object' ? M.active : null;
  if (!act) return 0;
  const def = act.def && typeof act.def === 'object' ? act.def : {};
  const stage = act.stage && typeof act.stage === 'object' ? act.stage : {};
  const w = 352;
  const inner = w - 30;
  ctx.save();
  ctx.font = `15px ${FONT}`;
  const objLines = wrapText(ctx, str(stage.text, '—'), inner, 3);
  ctx.font = `12.5px ${FONT}`;
  const hintLines = stage.hint ? wrapText(ctx, str(stage.hint), inner, 2) : [];
  const h = 16 + 15 + 27 + objLines.length * 20 + (hintLines.length ? hintLines.length * 17 + 3 : 0) + 20 + 10;
  panel(ctx, x, y, w, h, '#f5b942');
  let cy = y + 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const chapter = str(def.chapter) || (act.kind === 'job' ? 'SIDE WORK' : 'STORY');
  ctx.font = `700 10.5px ${FONT}`;
  try { ctx.letterSpacing = '1.6px'; } catch {}
  ctx.fillStyle = '#f5b942';
  ctx.fillText(chapter.toUpperCase(), x + 15, cy + 8);
  try { ctx.letterSpacing = '0px'; } catch {}
  cy += 27;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fitText(ctx, str(def.title, 'Contract'), inner), x + 15, cy);
  cy += 8;
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = '#e9e7e0';
  for (const ln of objLines) {
    cy += 20;
    ctx.fillText(ln, x + 15, cy - 4);
  }
  if (hintLines.length) {
    cy += 3;
    ctx.font = `12.5px ${FONT}`;
    ctx.fillStyle = '#9aa3ad';
    for (const ln of hintLines) {
      cy += 17;
      ctx.fillText(ln, x + 15, cy - 3);
    }
  }
  cy += 20;
  const stages = Array.isArray(def.stages) ? def.stages.length : 0;
  const stageNo = clamp(num(act.stageIndex, 0) + 1, 1, Math.max(1, stages));
  let foot = stages ? `STAGE ${stageNo} OF ${stages}` : 'IN PROGRESS';
  if (num(def.pay, 0) > 0) foot += `  ·  PAYS ${money(def.pay)}`;
  ctx.font = `700 10.5px ${FONT}`;
  ctx.fillStyle = '#8b93a0';
  ctx.fillText(foot, x + 15, cy - 4);
  ctx.restore();
  return h;
}

function drawPassengerChip(ctx, G, x, y) {
  const p = G.passenger;
  if (!p) return 0;
  const name = typeof p === 'string' ? p : str(p.name) || str(p.who) || 'Passenger';
  const w = 352;
  panel(ctx, x, y, w, 34, '#5eead4');
  ctx.font = `700 12px ${FONT}`;
  ctx.fillStyle = '#5eead4';
  ctx.textAlign = 'left';
  ctx.fillText('PASSENGER', x + 15, y + 21);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#f0efe9';
  const labelW = ctx.measureText('PASSENGER  ').width;
  ctx.fillText(fitText(ctx, name, w - 30 - labelW), x + 15 + labelW, y + 21);
  return 34;
}

function drawPolicePanel(ctx, G, x, y) {
  const Wd = G.wanted && typeof G.wanted === 'object' ? G.wanted : null;
  if (!Wd) return 0;
  const units = Array.isArray(Wd.units) ? Wd.units.filter(u => u && typeof u === 'object') : [];
  const heli = Wd.heli && typeof Wd.heli === 'object' ? Wd.heli : null;
  if (!units.length && !heli) return 0;
  const p = G.player || {};
  const px = num(p.x);
  const py = num(p.y);
  const rows = units.map(u => {
    const c = u.car && typeof u.car === 'object' ? u.car : u;
    return {
      id: str(u.id, 'SBPD-?'),
      tactic: str(u.tactic),
      dist: Math.hypot(num(c.x) - px, num(c.y) - py),
    };
  }).sort((a, b) => a.dist - b.dist);
  if (heli) rows.push({ id: str(heli.id, 'HELI-1'), tactic: 'AIR SUPPORT', dist: Math.hypot(num(heli.x) - px, num(heli.y) - py), air: true });
  const shown = rows.slice(0, 8);
  const w = 252;
  const h = 30 + shown.length * 21 + (rows.length > shown.length ? 16 : 0) + 8;
  panel(ctx, x, y, w, h, '#57a8e8');
  ctx.textAlign = 'left';
  ctx.font = `700 10.5px ${FONT}`;
  try { ctx.letterSpacing = '1.4px'; } catch {}
  ctx.fillStyle = '#7fd4ff';
  ctx.fillText('SBPD RESPONSE', x + 13, y + 19);
  try { ctx.letterSpacing = '0px'; } catch {}
  ctx.font = `700 10.5px ${FONT}`;
  ctx.fillStyle = '#8b93a0';
  ctx.textAlign = 'right';
  ctx.fillText(`${rows.length} UNIT${rows.length === 1 ? '' : 'S'}`, x + w - 13, y + 19);
  ctx.textAlign = 'left';
  const t = num(G.time, 0);
  let cy = y + 30;
  shown.forEach((r, i) => {
    cy += 21;
    const flash = Math.sin(t * 7 + i * 1.7) > 0;
    ctx.fillStyle = r.air ? '#b78cff' : flash ? '#ff5a4e' : '#57a8e8';
    ctx.beginPath();
    ctx.arc(x + 18, cy - 4, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = '#f2f0ea';
    ctx.fillText(r.id, x + 28, cy);
    if (r.tactic) {
      const idW = ctx.measureText(r.id).width;
      ctx.font = `9.5px ${FONT}`;
      ctx.fillStyle = '#8b93a0';
      ctx.fillText(r.tactic, x + 36 + idW, cy);
    }
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = '#cfd6dd';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(r.dist)} m`, x + w - 13, cy);
    ctx.textAlign = 'left';
  });
  if (rows.length > shown.length) {
    cy += 16;
    ctx.font = `10.5px ${FONT}`;
    ctx.fillStyle = '#8b93a0';
    ctx.fillText(`+ ${rows.length - shown.length} MORE UNITS`, x + 28, cy);
  }
  return h;
}

function drawTopRight(ctx, G, V) {
  const W = V.W;
  const p = G.player || {};
  const Wd = G.wanted && typeof G.wanted === 'object' ? G.wanted : {};
  const heat = num(Wd.heat, 0);
  const stars = clamp(Math.floor(heat / 100), 0, 5);
  // Wanted stars.
  const starR = 13;
  let sx = W - 16 - starR;
  for (let i = 4; i >= 0; i--) {
    starPath(ctx, sx, 30, starR);
    ctx.fillStyle = i < stars ? '#ffc93c' : 'rgba(255,255,255,0.22)';
    ctx.fill();
    if (i < stars) {
      ctx.strokeStyle = 'rgba(120,70,0,0.5)';
      ctx.lineWidth = 1;
      starPath(ctx, sx, 30, starR);
      ctx.stroke();
    }
    sx -= starR * 2 + 7;
  }
  const label = stars === 0 ? 'NO PURSUIT' : stars <= 2 ? 'SEARCHING' : 'PURSUIT';
  ctx.font = `800 12px ${FONT}`;
  try { ctx.letterSpacing = '2px'; } catch {}
  ctx.fillStyle = stars === 0 ? '#9aa3ad' : stars <= 2 ? '#f5b942' : '#ff6b5e';
  ctx.textAlign = 'right';
  ctx.fillText(label, W - 16, 62);
  try { ctx.letterSpacing = '0px'; } catch {}
  // Busted meter.
  let cy = 70;
  const bm = clamp(num(Wd.bustedMeter, 0), 0, 1);
  if (bm > 0.02) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(W - 16 - 190, cy, 190, 5);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(W - 16 - 190, cy, 190 * bm, 5);
    ctx.font = `700 9px ${FONT}`;
    ctx.fillStyle = '#ff8a84';
    ctx.fillText('BUSTED', W - 16, cy + 15);
    cy += 20;
  }
  // Cash.
  ctx.font = `800 29px ${FONT}`;
  ctx.fillStyle = '#43d17c';
  ctx.fillText(money(p.cash), W - 16, cy + 28);
  cy += 40;
  // Health + armour bars.
  const barW = 190;
  const bx = W - 16 - barW;
  const bar = (yy, frac, color, lab) => {
    ctx.font = `700 8.5px ${FONT}`;
    ctx.fillStyle = '#aeb6bf';
    ctx.textAlign = 'left';
    ctx.fillText(lab, bx, yy - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    rr(ctx, bx, yy, barW, 8, 4);
    ctx.fill();
    ctx.fillStyle = color;
    if (frac > 0.01) {
      rr(ctx, bx, yy, barW * clamp(frac, 0, 1), 8, 4);
      ctx.fill();
    }
    ctx.textAlign = 'right';
  };
  bar(cy + 10, num(p.health, 100) / 100, num(p.health, 100) < 30 ? '#e5484d' : '#3ecf5f', 'HEALTH');
  bar(cy + 32, num(p.armour, 0) / 100, '#57a8e8', 'ARMOUR');
  cy += 48;
  // Weapon chip.
  const ww = 190;
  panel(ctx, bx, cy, ww, 44, null);
  ctx.font = `700 12.5px ${FONT}`;
  ctx.fillStyle = '#f2f0ea';
  ctx.textAlign = 'left';
  ctx.fillText(str(WEAPON.name, 'Pistol').toUpperCase(), bx + 12, cy + 19);
  ctx.font = `700 14px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${num(G.ammo, 0)} / ${num(G.reserve, 0)}`, bx + ww - 12, cy + 19);
  ctx.font = `9.5px ${FONT}`;
  ctx.fillStyle = '#8b93a0';
  const wstate = num(G.reloading, 0) > 0 ? 'RELOADING' : G.playerArmed ? 'DRAWN' : 'HOLSTERED';
  ctx.fillText(wstate, bx + ww - 12, cy + 36);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8b93a0';
  ctx.font = `9.5px ${FONT}`;
  ctx.fillText('WEAPON', bx + 12, cy + 36);
  ctx.textAlign = 'right';
}

function drawBottomRight(ctx, G, V) {
  const W = V.W;
  const H = V.H;
  const p = G.player || {};
  const car = p.car && typeof p.car === 'object' ? p.car : null;
  const w = 236;
  const x = W - 16 - w;
  // Vehicle / location panel.
  const vehH = 88;
  const vehY = H - 16 - vehH;
  panel(ctx, x, vehY, w, vehH, car ? '#ffc93c' : '#5eead4');
  ctx.textAlign = 'left';
  let kmh = 0;
  if (car) {
    kmh = Math.round(Math.hypot(num(car.vx, 0), num(car.vy, 0)) * 3.6);
    const model = car.model && typeof car.model === 'object' ? car.model : {};
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitText(ctx, str(model.name) || str(car.modelKey, 'Car'), w - 90), x + 13, vehY + 22);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = '#9aa3ad';
    ctx.textAlign = 'right';
    ctx.fillText(str(model.kind), x + w - 13, vehY + 22);
    ctx.textAlign = 'left';
    ctx.font = `700 8.5px ${FONT}`;
    ctx.fillStyle = '#aeb6bf';
    ctx.fillText('CONDITION', x + 13, vehY + 38);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    rr(ctx, x + 13, vehY + 42, w - 26, 6, 3);
    ctx.fill();
    const ch = clamp(num(car.health, 100) / 100, 0, 1);
    ctx.fillStyle = ch < 0.3 ? '#e5484d' : ch < 0.6 ? '#f5b942' : '#3ecf5f';
    if (ch > 0.01) {
      rr(ctx, x + 13, vehY + 42, (w - 26) * ch, 6, 3);
      ctx.fill();
    }
  } else {
    kmh = Math.round(Math.abs(num(p.speedNow, 0)) * 3.6);
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = '#5eead4';
    ctx.fillText('ON FOOT', x + 13, vehY + 22);
    ctx.font = `12.5px ${FONT}`;
    ctx.fillStyle = '#f2f0ea';
    ctx.fillText(fitText(ctx, str(G.districtNow) || districtAt(num(p.x), num(p.y)), w - 26), x + 13, vehY + 41);
    ctx.font = `11.5px ${FONT}`;
    ctx.fillStyle = '#9aa3ad';
    let street = '';
    try { street = streetNameAt(num(p.x), num(p.y)) || ''; } catch {}
    ctx.fillText(fitText(ctx, street, w - 26), x + 13, vehY + 58);
  }
  ctx.font = `800 37px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(String(kmh), x + w - 44, vehY + 80);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = '#9aa3ad';
  ctx.fillText('km/h', x + w - 13, vehY + 80);
  ctx.textAlign = 'left';

  // Radio panel above it.
  const radH = 52;
  const radY = vehY - 8 - radH;
  panel(ctx, x, radY, w, radH, '#5eead4');
  const audio = G.audio && typeof G.audio === 'object' ? G.audio : {};
  const on = !!audio.radioOn;
  let stationName = 'Radio';
  let trackText = on ? '' : 'Radio off — press R';
  try {
    const st = Array.isArray(STATIONS) ? STATIONS[clamp(num(audio.station, 0), 0, STATIONS.length - 1)] : null;
    if (st) {
      stationName = str(st.name, stationName);
      const tr = Array.isArray(st.tracks) ? st.tracks[clamp(num(audio.trackIndex, 0), 0, st.tracks.length - 1)] : null;
      if (tr && on) trackText = `${str(tr.title)} — ${str(tr.artist)}`;
    }
  } catch {}
  ctx.font = `700 12.5px ${FONT}`;
  ctx.fillStyle = on ? '#5eead4' : '#8b93a0';
  ctx.fillText(fitText(ctx, `♪ ${stationName}`, w - 26), x + 13, radY + 20);
  // EQ bars live at the right edge; the track line is truncated BEFORE them.
  const eqW = 34;
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#e9e7e0';
  ctx.fillText(fitText(ctx, trackText, w - 26 - eqW), x + 13, radY + 40);
  const t = num(G.time, 0);
  for (let i = 0; i < 5; i++) {
    const bh = on ? 5 + Math.abs(Math.sin(t * 3.1 + i * 1.35)) * 13 : 3;
    ctx.fillStyle = on ? '#5eead4' : '#4a5058';
    ctx.fillRect(x + w - 13 - eqW + i * 7, radY + 40 - bh, 4.5, bh);
  }
}

function drawDialogue(ctx, G, V) {
  const line = G.currentLine && typeof G.currentLine === 'object' ? G.currentLine : null;
  if (!line || !str(line.text)) return 0;
  const who = str(line.who, '');
  const ch = (CHARACTERS && CHARACTERS[who]) || { name: who || 'Unknown', color: '#8b93a0', role: '' };
  const w = Math.min(760, V.W - 420);
  const x = (V.W - w) / 2;
  ctx.save();
  ctx.font = `16px ${FONT}`;
  const lines = wrapText(ctx, line.text, w - 108, 3);
  const h = Math.max(88, 34 + lines.length * 22 + 16);
  const y = V.H - 20 - h;
  panel(ctx, x, y, w, h, ch.color);
  // Portrait: character colour disc with initials.
  const pcx = x + 44;
  const pcy = y + h / 2;
  ctx.fillStyle = ch.color || '#8b93a0';
  ctx.beginPath();
  ctx.arc(pcx, pcy, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(pcx, pcy, 27, 0, Math.PI * 2);
  ctx.stroke();
  const nm = str(ch.name, who || '?');
  const initials = nm.split(/\s+/).map(p2 => p2[0]).slice(0, 2).join('').toUpperCase();
  ctx.font = `800 19px ${FONT}`;
  ctx.fillStyle = 'rgba(10,10,14,0.82)';
  ctx.textAlign = 'center';
  ctx.fillText(initials, pcx, pcy + 7);
  ctx.textAlign = 'left';
  // Name + role.
  ctx.font = `700 14.5px ${FONT}`;
  ctx.fillStyle = ch.color || '#f2f0ea';
  ctx.fillText(nm, x + 84, y + 26);
  const nw = ctx.measureText(nm).width;
  if (ch.role) {
    ctx.font = `700 9.5px ${FONT}`;
    try { ctx.letterSpacing = '1.2px'; } catch {}
    ctx.fillStyle = '#8b93a0';
    ctx.fillText(String(ch.role).toUpperCase(), x + 84 + nw + 10, y + 26);
    try { ctx.letterSpacing = '0px'; } catch {}
  }
  ctx.font = `16px ${FONT}`;
  ctx.fillStyle = '#f2f0ea';
  lines.forEach((ln, i) => ctx.fillText(ln, x + 84, y + 52 + i * 22));
  ctx.restore();
  return h + 20;
}

function drawPrompt(ctx, G, V, dialogueH) {
  const pr = G.prompt;
  const text = typeof pr === 'string' ? pr : pr && typeof pr === 'object' ? str(pr.text) : '';
  if (!text) return;
  ctx.save();
  ctx.font = `600 14px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const w = tw + 30;
  const x = (V.W - w) / 2;
  const y = V.H - (dialogueH ? dialogueH + 52 : 108);
  ctx.fillStyle = 'rgba(7,9,13,0.85)';
  rr(ctx, x, y, w, 32, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, 32, 16);
  ctx.stroke();
  ctx.fillStyle = '#f2f0ea';
  ctx.textAlign = 'center';
  ctx.fillText(text, V.W / 2, y + 21);
  ctx.restore();
}

function drawBanners(ctx, G, V) {
  // District banner: { name, t } with t counting down from ~3.2.
  const db = G.districtBanner;
  if (db && typeof db === 'object' && str(db.name)) {
    const t = num(db.t, 3.2);
    const alpha = clamp(Math.min((3.2 - t) * 3, t * 1.6, 1), 0, 1);
    if (alpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = `700 10.5px ${FONT}`;
      try { ctx.letterSpacing = '3px'; } catch {}
      ctx.fillStyle = '#f5b942';
      ctx.fillText('DISTRICT', V.W / 2, 118);
      try { ctx.letterSpacing = '1px'; } catch {}
      ctx.font = `800 40px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 10;
      ctx.fillText(str(db.name).toUpperCase(), V.W / 2, 162);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f5b942';
      ctx.fillRect(V.W / 2 - 60, 176, 120, 2.5);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }
  // Generic centre banner (mission complete etc.) — shape-defensive.
  const b = G.banner;
  if (!b) return;
  let title = '';
  let sub = '';
  let bt = null;
  if (typeof b === 'string') title = b;
  else if (typeof b === 'object') {
    title = str(b.title) || str(b.name) || str(b.text);
    sub = str(b.sub) || str(b.subtitle) || str(b.detail);
    if (typeof b.t === 'number') bt = b.t;
  }
  if (!title) return;
  const alpha = bt === null ? 1 : clamp(Math.min(bt * 2.2, 1), 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 30px ${FONT}`;
  const tw = ctx.measureText(title).width;
  const w = Math.max(tw + 56, 260);
  const h = sub ? 78 : 58;
  const x = (V.W - w) / 2;
  const y = 196;
  panel(ctx, x, y, w, h, '#f5b942');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, V.W / 2, y + 38);
  if (sub) {
    ctx.font = `13.5px ${FONT}`;
    ctx.fillStyle = '#c8ced6';
    ctx.fillText(sub, V.W / 2, y + 62);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

const CONTROLS = [
  ['WASD / arrows', 'drive & walk'],
  ['E', 'enter / exit car'],
  ['F', 'interact'],
  ['mouse', 'aim · click to fire'],
  ['R', 'radio'],
  ['M', 'map'],
];

function drawTitle(ctx, G, V) {
  const W = V.W;
  const H = V.H;
  // Legibility scrims that keep the live city visible underneath.
  let grad = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  grad.addColorStop(0, 'rgba(5,6,12,0.60)');
  grad.addColorStop(1, 'rgba(5,6,12,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H * 0.62);
  grad = ctx.createLinearGradient(0, H * 0.78, 0, H);
  grad.addColorStop(0, 'rgba(5,6,12,0)');
  grad.addColorStop(1, 'rgba(5,6,12,0.62)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  ctx.textAlign = 'center';
  const tg = ctx.createLinearGradient(0, 130, 0, 250);
  tg.addColorStop(0, '#ffe9a8');
  tg.addColorStop(0.55, '#ffb35c');
  tg.addColorStop(1, '#ff7847');
  ctx.font = `800 112px ${FONT}`;
  try { ctx.letterSpacing = '3px'; } catch {}
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = tg;
  ctx.fillText('SOLANO BAY', W / 2, 238);
  ctx.shadowBlur = 0;
  try { ctx.letterSpacing = '5px'; } catch {}
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('AN ORIGINAL OPEN-WORLD CRIME GAME', W / 2, 282);
  try { ctx.letterSpacing = '0px'; } catch {}

  const mouse = G.input && G.input.mouse ? G.input.mouse : { x: -1, y: -1 };
  const button = (yy, label, gold) => {
    const bw = 272;
    const bx = (W - bw) / 2;
    const hover = mouse.x >= bx && mouse.x <= bx + bw && mouse.y >= yy && mouse.y <= yy + 46;
    ctx.fillStyle = gold ? (hover ? '#ffc93c' : '#f7b731') : hover ? 'rgba(20,24,32,0.92)' : 'rgba(6,8,12,0.90)';
    rr(ctx, bx, yy, bw, 46, 23);
    ctx.fill();
    if (!gold) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      rr(ctx, bx, yy, bw, 46, 23);
      ctx.stroke();
    }
    ctx.font = `800 19px ${FONT}`;
    ctx.fillStyle = gold ? '#191104' : '#ffffff';
    ctx.fillText(label, W / 2, yy + 30);
  };
  if (G.showHelp) {
    const pw = 520;
    const ph = 236;
    const px = (W - pw) / 2;
    const py = 322;
    panel(ctx, px, py, pw, ph, '#f5b942');
    ctx.font = `800 16px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('HOW TO PLAY', W / 2, py + 34);
    ctx.font = `13.5px ${FONT}`;
    CONTROLS.forEach(([k, d], i) => {
      const yy = py + 68 + i * 27;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffc93c';
      ctx.font = `700 13.5px ${FONT}`;
      ctx.fillText(k, px + 190, yy);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e9e7e0';
      ctx.font = `13.5px ${FONT}`;
      ctx.fillText(d, px + 204, yy);
    });
    ctx.textAlign = 'center';
  } else {
    let by = 330;
    button(by, 'NEW GAME', true);
    by += 58;
    if (G.hasSave) {
      button(by, 'CONTINUE', false);
      by += 58;
    }
    button(by, 'HOW TO PLAY', false);
  }
  ctx.font = `12.5px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('WASD / arrows — drive & walk · E — enter / exit car · F — interact · mouse — aim · R — radio · M — map', W / 2, H - 38);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('Every name, street and story in Solano Bay is original to this game.', W / 2, H - 18);
  ctx.textAlign = 'left';
}

function drawModeOverlay(ctx, G, V) {
  const mode = G.mode;
  if (mode !== 'busted' && mode !== 'wasted' && mode !== 'pause') return;
  ctx.fillStyle = mode === 'wasted' ? 'rgba(34,4,4,0.52)' : mode === 'busted' ? 'rgba(8,12,34,0.48)' : 'rgba(4,6,10,0.58)';
  ctx.fillRect(0, 0, V.W, V.H);
  ctx.textAlign = 'center';
  if (mode === 'busted') {
    ctx.font = `800 86px ${FONT}`;
    try { ctx.letterSpacing = '6px'; } catch {}
    ctx.fillStyle = '#7fb2ff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 14;
    ctx.fillText('BUSTED', V.W / 2, 330);
    ctx.shadowBlur = 0;
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('The SBPD took you in — you will be released at the station.', V.W / 2, 366);
  } else if (mode === 'wasted') {
    ctx.font = `800 86px ${FONT}`;
    try { ctx.letterSpacing = '6px'; } catch {}
    ctx.fillStyle = '#ff5a4e';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 14;
    ctx.fillText('WASTED', V.W / 2, 330);
    ctx.shadowBlur = 0;
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('You wake up at Clínica Santa Brisa — the city keeps moving.', V.W / 2, 366);
  } else {
    ctx.font = `800 58px ${FONT}`;
    try { ctx.letterSpacing = '5px'; } catch {}
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PAUSED', V.W / 2, 300);
    ctx.font = `13.5px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    CONTROLS.forEach(([k, d], i) => {
      ctx.fillText(`${k} — ${d}`, V.W / 2, 348 + i * 24);
    });
  }
  try { ctx.letterSpacing = '0px'; } catch {}
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- render
export function render(ctx, G) {
  if (!ctx || !G || typeof G !== 'object') return;
  const V = makeView(ctx, G);
  const mode = str(G.mode, 'play');

  if (mode === 'map') {
    try {
      drawCityMap(ctx, G, V.W, V.H);
      return;
    } catch { /* fall through to the world view */ }
  }

  drawGround(ctx, G, V);
  drawForecourts(ctx, G, V);
  drawRoads(ctx, G, V);
  drawMedallions(ctx, G, V);
  drawBuildings(ctx, G, V);
  drawSigns(ctx, G, V);
  drawProps(ctx, G, V);

  // Helicopter searchlight pool lies on the ground, under the traffic.
  const heli = G.wanted && typeof G.wanted === 'object' ? G.wanted.heli : null;
  if (heli && typeof heli === 'object' && inView(V, num(heli.x), num(heli.y), 20)) {
    const hx = V.toX(num(heli.x));
    const hy = V.toY(num(heli.y));
    const r = 13.5 * V.s;
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
    g.addColorStop(0, 'rgba(255,246,200,0.20)');
    g.addColorStop(0.65, 'rgba(255,246,200,0.10)');
    g.addColorStop(1, 'rgba(255,246,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const player = G.player && typeof G.player === 'object' ? G.player : {};
  const playerCar = player.car && typeof player.car === 'object' ? player.car : null;
  const cars = (Array.isArray(G.cars) ? G.cars : [])
    .filter(c => c && typeof c === 'object' && c !== playerCar && inView(V, num(c.x), num(c.y), 12))
    .sort((a, b) => num(a.y) - num(b.y));
  for (const car of cars) drawCar(ctx, G, V, car, false);

  const peds = Array.isArray(G.peds) ? G.peds : [];
  for (const p of peds) {
    if (!p || typeof p !== 'object' || !inView(V, num(p.x), num(p.y), 4)) continue;
    drawPerson(ctx, G, V, p, {
      shirt: str(p.shirt, '#7a7f87'), pants: str(p.pants, '#3c4048'),
      skin: str(p.skin, '#d9a066'), hair: str(p.hair, '#2c2018'),
    });
  }
  const actors = Array.isArray(G.actors) ? G.actors : [];
  for (const a of actors) {
    if (!a || typeof a !== 'object' || !inView(V, num(a.x), num(a.y), 4)) continue;
    drawPerson(ctx, G, V, a, {
      shirt: str(a.shirt, '#5b2333'), pants: str(a.pants, '#26262c'),
      skin: str(a.skin, '#c98d5f'), hair: str(a.hair, '#17130f'),
      armed: true, healthBar: true,
    });
  }

  // The player (car drawn in the entity pass style, with its gold ring).
  if (playerCar) drawCar(ctx, G, V, playerCar, true);
  else if (Number.isFinite(num(player.x, NaN)) && inView(V, num(player.x), num(player.y), 6)) {
    drawPerson(ctx, G, V, player, {
      shirt: '#f5efe0', pants: '#2e3138', skin: '#d9a066', hair: '#241a12',
      armed: !!G.playerArmed, ring: 'rgba(255,205,64,0.85)',
    });
    // Aim tick toward the mouse when armed.
    if (G.playerArmed && G.input && G.input.mouse) {
      const mx = num(G.input.mouse.x, -1);
      const my = num(G.input.mouse.y, -1);
      if (mx >= 0) {
        const px = V.toX(num(player.x));
        const py = V.toY(num(player.y));
        const a = Math.atan2(my - py, mx - px);
        ctx.strokeStyle = 'rgba(255,90,80,0.75)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14);
        ctx.lineTo(px + Math.cos(a) * 21, py + Math.sin(a) * 21);
        ctx.stroke();
      }
    }
  }

  // Bullets as short tracers.
  const bullets = Array.isArray(G.bullets) ? G.bullets : [];
  for (const b of bullets) {
    if (!b || typeof b !== 'object') continue;
    const bx = num(b.x, NaN);
    const by = num(b.y, NaN);
    if (!Number.isFinite(bx) || !inView(V, bx, by, 4)) continue;
    const x = V.toX(bx);
    const y = V.toY(by);
    const tx = V.toX(bx - num(b.vx, 0) * 0.035);
    const ty = V.toY(by - num(b.vy, 0) * 0.035);
    ctx.strokeStyle = b.from === 'player' ? 'rgba(255,215,106,0.95)' : 'rgba(255,138,122,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  drawEffects(ctx, G, V);
  drawHeli(ctx, G, V);
  drawMarker(ctx, G, V);

  // Time-of-day grade + vignette + hurt feedback.
  const P = pal(G);
  if (P.overlay) {
    ctx.fillStyle = P.overlay;
    ctx.fillRect(0, 0, V.W, V.H);
  }
  const vg = ctx.createRadialGradient(V.W / 2, V.H / 2, Math.min(V.W, V.H) * 0.42, V.W / 2, V.H / 2, Math.max(V.W, V.H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.17)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, V.W, V.H);
  const hurt = clamp(num(G.hurtFlash, 0), 0, 1);
  if (hurt > 0.01) {
    ctx.fillStyle = `rgba(190,20,20,${hurt * 0.32})`;
    ctx.fillRect(0, 0, V.W, V.H);
  }
  if (mode === 'play' && num(player.health, 100) < 30 && num(player.health, 100) > 0) {
    const a = 0.1 + 0.06 * Math.sin(num(G.time, 0) * 5);
    const hg = ctx.createRadialGradient(V.W / 2, V.H / 2, Math.min(V.W, V.H) * 0.36, V.W / 2, V.H / 2, Math.max(V.W, V.H) * 0.7);
    hg.addColorStop(0, 'rgba(160,10,10,0)');
    hg.addColorStop(1, `rgba(160,10,10,${a})`);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, V.W, V.H);
  }

  if (mode === 'title') {
    drawTitle(ctx, G, V);
    return;
  }

  // Gameplay HUD.
  let leftY = 16;
  const mh = drawMissionCard(ctx, G, 16, leftY);
  if (mh) leftY += mh + 10;
  const ph = drawPassengerChip(ctx, G, 16, leftY);
  if (ph) leftY += ph + 10;
  drawPolicePanel(ctx, G, 16, leftY);
  drawTopRight(ctx, G, V);
  try { drawMinimap(ctx, G, 16, V.H - 212, 196, 196); } catch { /* minimap is best-effort */ }
  drawBottomRight(ctx, G, V);
  const dlgH = drawDialogue(ctx, G, V);
  drawPrompt(ctx, G, V, dlgH);
  drawBanners(ctx, G, V);
  drawModeOverlay(ctx, G, V);
}
