// minimap.js — the corner minimap (streets, water, police blips, the
// objective diamond, Nico's arrow) and the full city map screen with every
// district and landmark named.

import { AVENUES, STREETS, WATER, WORLD, blockRect, districtAt, groundTintAt, BUILDINGS } from './city.js';

function worldToMap(x, y, ox, oy, scale) {
  return [ox + x * scale, oy + y * scale];
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
    ctx.fillStyle = 'rgba(20,24,28,0.55)';
    for (const b of BUILDINGS) {
      ctx.fillRect(ox + b.x * scale, oy + b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
    }
  }
}

export function drawMinimap(ctx, G, x, y, size) {
  const scale = size / WORLD.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size * (WORLD.h / WORLD.w));
  ctx.clip();
  drawBase(ctx, x, y, scale, false);
  const p = G.player.car || G.player;
  // Police blips.
  for (const u of G.wanted.units) {
    const [bx, by] = worldToMap(u.car.x, u.car.y, x, y, scale);
    ctx.fillStyle = '#3fa9f5';
    ctx.beginPath();
    ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (G.wanted.heli) {
    const [hx, hy] = worldToMap(G.wanted.heli.x, G.wanted.heli.y, x, y, scale);
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
  const marker = G.missions?.marker;
  if (marker) {
    const [mx, my] = worldToMap(marker.x, marker.y, x, y, scale);
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
  const [px, py] = worldToMap(p.x, p.y, x, y, scale);
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
