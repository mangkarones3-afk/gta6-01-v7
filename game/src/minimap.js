// minimap.js — the corner minimap (streets, water, police blips, the
// objective diamond, Nico's arrow) and the full city map screen with every
// district and landmark named.

import { AVENUES, STREETS, WATER, WORLD, blockRect, districtAt, groundTintAt, BUILDINGS, PROPS } from './city.js';

function worldToMap(x, y, ox, oy, scale) {
  return [ox + x * scale, oy + y * scale];
}

// A hex colour scaled toward map tone (roof colours at 0.78, so the
// footprints sit inside the base map's register).
function mapTone(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return 'rgba(20,24,28,0.55)';
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.78);
  const g = Math.round(((n >> 8) & 255) * 0.78);
  const b = Math.round((n & 255) * 0.78);
  return `rgb(${r},${g},${b})`;
}

function drawBase(ctx, ox, oy, scale, detailed) {
  // Land and water.
  ctx.fillStyle = '#3d7f96';
  ctx.fillRect(ox, oy, WORLD.w * scale, WORLD.h * scale);
  ctx.fillStyle = '#b8a888';
  ctx.fillRect(ox, oy, WORLD.w * scale, WATER[0].y * scale);
  ctx.fillStyle = '#d9c08d';
  ctx.fillRect(ox, oy + 736 * scale, WORLD.w * scale, (WATER[0].y - 736) * scale);
  // District blocks.
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 4; row++) {
      const b = blockRect(col, row);
      ctx.fillStyle = groundTintAt(b.x + b.w / 2, b.y + b.h / 2);
      ctx.fillRect(ox + b.x * scale, oy + b.y * scale, b.w * scale, b.h * scale);
    }
  }
  // Streets.
  ctx.fillStyle = '#3a3f45';
  for (const a of AVENUES) ctx.fillRect(ox + (a.x - 9) * scale, oy, 18 * scale, WATER[0].y * scale);
  for (const s of STREETS) ctx.fillRect(ox, oy + (s.y - 9) * scale, WORLD.w * scale, 18 * scale);
  if (detailed) {
    ctx.fillStyle = 'rgba(20,24,28,0.42)';
    for (const b of BUILDINGS) {
      ctx.fillRect(ox + b.x * scale, oy + b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
      // Roof furniture (tanks, solar, gardens) as light/dark marks.
      if (Array.isArray(b.props)) {
        for (const rp of b.props) {
          ctx.fillStyle = rp.t === 'garden' ? 'rgba(46,125,79,0.85)'
            : rp.t === 'solar' ? 'rgba(140,170,220,0.7)' : 'rgba(230,234,238,0.45)';
          ctx.fillRect(ox + rp.x * scale, oy + rp.y * scale,
            Math.max(1.2, rp.w * scale), Math.max(1.2, (rp.h || rp.w) * scale));
        }
        ctx.fillStyle = 'rgba(20,24,28,0.42)';
      }
    }
    // Street furniture: market stalls and port containers in their
    // colours, palms as green marks, lamps as pale points — the same
    // props the street render draws.
    for (const pr of PROPS) {
      if (pr.t === 'stall' || pr.t === 'container') {
        ctx.fillStyle = mapTone(pr.color);
        ctx.fillRect(ox + pr.x * scale, oy + pr.y * scale, Math.max(1.6, 6 * scale), Math.max(1.4, 4 * scale));
      } else if (pr.t === 'palm') {
        ctx.fillStyle = 'rgba(46,125,79,0.85)';
        ctx.fillRect(ox + pr.x * scale - 1, oy + pr.y * scale - 1, 2, 2);
      } else if (pr.t === 'lamp') {
        ctx.fillStyle = 'rgba(245,239,224,0.45)';
        ctx.fillRect(ox + pr.x * scale, oy + pr.y * scale, 1.3, 1.3);
      }
    }
  }
}

export function drawMinimap(ctx, G, x, y, size) {
  // Round 23: the corner map is a LOCAL window (220 m across, centred
  // on the player) — the whole-world version compressed a street
  // scene's police blips into a few pixels at the centre. Everything
  // drawn is live game state: unit blips, the route to the active
  // objective marker, and the search ring at the wanted system's
  // real 62 m sight radius. The full city map (drawCityMap) still
  // shows the whole island.
  const rectH = size * (WORLD.h / WORLD.w);
  const scale = size / 220;
  const p = G.player.car || G.player;
  const ox = x + size / 2 - p.x * scale;
  const oy = y + rectH / 2 - p.y * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, rectH);
  ctx.clip();
  // Detailed base: the real building footprints inside the window —
  // a local map that only showed district tints and two road bands
  // read as near-empty at street scale (and measured poor); the
  // footprints are the same live city the full map draws.
  drawBase(ctx, ox, oy, scale, true);
  const [pcx, pcy] = worldToMap(p.x, p.y, ox, oy, scale);
  // Search ring: the radius at which a unit's line of sight counts
  // as seeing the player (wanted.seenByPolice), coloured by the
  // pursuit state the HUD prints.
  const stars = G.wanted && typeof G.wanted.stars === 'function' ? G.wanted.stars() : 0;
  if (stars > 0) {
    const searching = typeof G.wanted.pursuitState === 'function' && G.wanted.pursuitState(G) === 'SEARCHING';
    ctx.strokeStyle = searching ? 'rgba(245,185,66,0.9)' : 'rgba(255,90,80,0.8)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash(searching ? [5, 4] : []);
    ctx.beginPath();
    ctx.arc(pcx, pcy, 62 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Route line to the active objective.
  const marker = G.missions?.marker;
  if (marker) {
    const [mx, my] = worldToMap(marker.x, marker.y, ox, oy, scale);
    ctx.strokeStyle = 'rgba(255,216,61,0.85)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pcx, pcy);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Police blips.
  for (const u of G.wanted.units) {
    const [bx, by] = worldToMap(u.car.x, u.car.y, ox, oy, scale);
    ctx.fillStyle = '#3fa9f5';
    ctx.beginPath();
    ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (G.wanted.heli) {
    const [hx, hy] = worldToMap(G.wanted.heli.x, G.wanted.heli.y, ox, oy, scale);
    ctx.strokeStyle = '#3fa9f5';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hx - 3.4, hy);
    ctx.lineTo(hx + 3.4, hy);
    ctx.moveTo(hx, hy - 3.4);
    ctx.lineTo(hx, hy + 3.4);
    ctx.stroke();
  }
  // Objective diamond.
  if (marker) {
    const [mx, my] = worldToMap(marker.x, marker.y, ox, oy, scale);
    const pulse = 3.4 + Math.sin(G.time * 5) * 0.9;
    ctx.fillStyle = '#ffd83d';
    ctx.beginPath();
    ctx.moveTo(mx, my - pulse);
    ctx.lineTo(mx + pulse, my);
    ctx.lineTo(mx, my + pulse);
    ctx.lineTo(mx - pulse, my);
    ctx.closePath();
    ctx.fill();
  }
  // Player arrow.
  const [px, py] = worldToMap(p.x, p.y, ox, oy, scale);
  const ang = p.angle || 0;
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#14181c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3.6, -3.2);
  ctx.lineTo(-3.6, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Frame + north marker.
  ctx.strokeStyle = 'rgba(10,14,18,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, size, size * (WORLD.h / WORLD.w));
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', x + size - 10, y + 13);
}

export function drawCityMap(ctx, G, w, h) {
  ctx.fillStyle = '#10151b';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f5efe0';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SOLANO BAY', 36, 48);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#b9c4cc';
  ctx.fillText('City map — districts, streets and landmarks. M or Esc closes.', 36, 74);

  const scale = Math.min((w - 80) / WORLD.w, (h - 190) / WORLD.h);
  const ox = (w - WORLD.w * scale) / 2;
  const oy = 96;
  drawBase(ctx, ox, oy, scale, true);

  // District labels at block centres.
  ctx.textAlign = 'center';
  const seen = new Set();
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 4; row++) {
      const b = blockRect(col, row);
      const name = districtAt(b.x + b.w / 2, b.y + b.h / 2);
      const key = `${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(16,20,24,0.75)';
      const [lx, ly] = worldToMap(b.x + b.w / 2, b.y + b.h / 2, ox, oy, scale);
      ctx.fillText(name.toUpperCase(), lx, ly);
    }
  }
  // Street names.
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(245,239,224,0.9)';
  for (const a of AVENUES) {
    const [lx, ly] = worldToMap(a.x, 420, ox, oy, scale);
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(a.name, 0, 3);
    ctx.restore();
  }
  for (const s of STREETS) {
    const [lx, ly] = worldToMap(660, s.y, ox, oy, scale);
    ctx.fillText(s.name, lx, ly + 3);
  }
  // Landmark labels.
  ctx.font = '10.5px system-ui, sans-serif';
  ctx.fillStyle = '#ffe9a8';
  for (const b of BUILDINGS) {
    if (!b.name) continue;
    const [lx, ly] = worldToMap(b.x + b.w / 2, b.y + b.h / 2, ox, oy, scale);
    ctx.fillText(b.name, lx, ly + 12);
  }
  // Player + objective.
  const p = G.player.car || G.player;
  const [px, py] = worldToMap(p.x, p.y, ox, oy, scale);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#14181c';
  ctx.stroke();
  const marker = G.missions?.marker;
  if (marker) {
    const [mx, my] = worldToMap(marker.x, marker.y, ox, oy, scale);
    ctx.fillStyle = '#ffd83d';
    ctx.beginPath();
    ctx.moveTo(mx, my - 8);
    ctx.lineTo(mx + 8, my);
    ctx.lineTo(mx, my + 8);
    ctx.lineTo(mx - 8, my);
    ctx.closePath();
    ctx.fill();
  }
  // Legend.
  const ly = oy + WORLD.h * scale + 22;
  ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#b9c4cc';
  ctx.fillText('● You      ◆ Objective      ● SBPD unit      + Helicopter      The bay blocks all travel — use the marina pier on foot or by car.', 36, ly);
}
