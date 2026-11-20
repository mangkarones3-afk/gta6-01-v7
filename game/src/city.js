// city.js — Solano Bay itself: street grid, districts, buildings with diegetic
// signage, props, the bay, collision and place lookup. Everything the other
// modules need to know about the world lives here and nowhere else.

import { makeRandom, randRange, randPick } from './random.js';

export const WORLD = { w: 1248, h: 912 };
export const STREET_W = 18;

export const AVENUES = [
  { x: 120, name: 'Av. del Faro' },
  { x: 360, name: 'Av. de las Palmas' },
  { x: 600, name: 'Av. Central' },
  { x: 840, name: 'Av. del Puerto' },
  { x: 1080, name: 'Av. Prisma' },
];
export const STREETS = [
  { y: 120, name: 'Calle Aurora' },
  { y: 360, name: 'Calle del Mercado' },
  { y: 600, name: 'Calle Cielo' },
];

// The bay: open water along the whole south edge. A wooden pier deck reaches
// into it at the marina; the deck is walkable and drivable, the water is not.
export const WATER = [{ x: 0, y: 792, w: WORLD.w, h: WORLD.h - 792 }];
export const DECKS = [{ x: 1112, y: 780, w: 72, h: 96 }];
export const BEACH_Y = 736;

// Block columns and rows between the streets (metres, inclusive rects).
const COLS = [
  { x0: 10, x1: 111 },
  { x0: 129, x1: 351 },
  { x0: 369, x1: 591 },
  { x0: 609, x1: 831 },
  { x0: 849, x1: 1071 },
  { x0: 1089, x1: 1238 },
];
const ROWS = [
  { y0: 10, y1: 111 },
  { y0: 129, y1: 351 },
  { y0: 369, y1: 591 },
  { y0: 609, y1: 727 },
];
const DISTRICT_GRID = [
  ['Puerto Viejo', 'Barrio Aurora', 'Distrito Cielo', 'Las Torres', 'Prisma', 'Litoral Norte'],
  ['Barrio Faro', 'Mercado Central', 'El Mercado', 'El Taller', 'Palmeras', 'Palmeras Este'],
  ['El Puerto', 'Santa Brisa', 'Centro Cívico', 'La Estación', 'La Motelera', 'La Marina'],
  ['El Puerto', 'Paseo Marítimo', 'Paseo Marítimo', 'Paseo Marítimo', 'La Marina', 'La Marina'],
];
const GROUND_TINTS = [
  ['#8f8578', '#94897b', '#978c7c', '#8d867e', '#968a76', '#94897b'],
  ['#978c7c', '#9a8d77', '#72766e', '#8f8578', '#8f9478', '#8f9478'],
  ['#8a8073', '#94897b', '#b8ac92', '#8f8578', '#978c7c', '#8f8a76'],
  ['#c9b18a', '#c9b18a', '#c9b18a', '#c9b18a', '#c2ab84', '#c2ab84'],
];

export function blockRect(col, row) {
  return { x: COLS[col].x0, y: ROWS[row].y0, w: COLS[col].x1 - COLS[col].x0, h: ROWS[row].y1 - ROWS[row].y0 };
}

export function districtAt(x, y) {
  if (y >= WATER[0].y) return 'La Bahía';
  if (y >= BEACH_Y) return 'La Playa';
  let col = COLS.findIndex((c) => x <= c.x1 + 9);
  let row = ROWS.findIndex((r) => y <= r.y1 + 9);
  if (col < 0) col = 5;
  if (row < 0) row = 3;
  return DISTRICT_GRID[row][col];
}

export function groundTintAt(x, y) {
  let col = COLS.findIndex((c) => x <= c.x1 + 9);
  let row = ROWS.findIndex((r) => y <= r.y1 + 9);
  if (col < 0) col = 5;
  if (row < 0) row = 3;
  return GROUND_TINTS[row][col];
}

export function streetNameAt(x, y) {
  let best = null;
  let bestD = 15;
  for (const a of AVENUES) {
    const d = Math.abs(x - a.x);
    if (d < bestD) { bestD = d; best = a.name; }
  }
  for (const s of STREETS) {
    const d = Math.abs(y - s.y);
    if (d < bestD) { bestD = d; best = s.name; }
  }
  return best;
}

// ---------------------------------------------------------------- buildings
// A building: footprint rect, height (drives the shadow), a palette, an
// optional diegetic sign (name + colours) painted on its street-facing edge,
// and rooftop props so no roof in frame is bare.

const WALLS = ['#c96f4a', '#d9a066', '#e3cfa3', '#b7c3b0', '#7fb3b0', '#d98a80', '#e8e0cc', '#a8b8c8', '#caa46a', '#8a9a7b'];
const ROOFS = ['#9c5a41', '#a98a63', '#8f8578', '#7d8b74', '#6f8f8c', '#a06a5a', '#b0a58e', '#75879a'];

function plotRect(col, row, plot) {
  const b = blockRect(col, row);
  const gap = 10;
  const hw = (b.w - gap) / 2;
  const hh = (b.h - gap) / 2;
  switch (plot) {
    case 'NW': return { x: b.x, y: b.y, w: hw, h: hh };
    case 'NE': return { x: b.x + hw + gap, y: b.y, w: hw, h: hh };
    case 'SW': return { x: b.x, y: b.y + hh + gap, w: hw, h: hh };
    case 'SE': return { x: b.x + hw + gap, y: b.y + hh + gap, w: hw, h: hh };
    case 'W': return { x: b.x, y: b.y, w: hw, h: b.h };
    case 'E': return { x: b.x + hw + gap, y: b.y, w: hw, h: b.h };
    case 'N': return { x: b.x, y: b.y, w: b.w, h: hh };
    case 'S': return { x: b.x, y: b.y + hh + gap, w: b.w, h: hh };
    default: return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
}

const NAMED = [
  // name, col, row, plot, kind, height
  ['Bar El Puerto', 0, 0, 'SE', 'tavern', 9],
  ['Cine Aurora', 1, 0, 'W', 'cinema', 14],
  ['Hotel Brisa', 2, 0, 'W', 'hotel', 26],
  ['Restaurante Cielo', 2, 0, 'NE', 'restaurant', 10],
  ['Torre Oficinas', 3, 0, 'NW', 'tower', 44],
  ['Torre Mirador', 3, 0, 'SE', 'tower', 36],
  ['Galería Prisma', 4, 0, 'FULL', 'mall', 15],
  ['Banco del Litoral', 5, 0, 'SW', 'bank', 16],
  ['Librería Faro', 0, 1, 'NE', 'shop', 9],
  ['Café Miramar', 0, 1, 'SE', 'cafe', 8],
  ['Mercado Central', 1, 1, 'FULL', 'market', 13],
  ['Carnicería Pepe', 2, 1, 'SW', 'shop', 8],
  ['Frutería Dulce', 2, 1, 'NW', 'shop', 8],
  ['Panadería Sol', 2, 1, 'NE', 'shop', 8],
  ['Floristería Lila', 2, 1, 'SE', 'shop', 8],
  ['Zapatería Andar', 3, 1, 'NW', 'shop', 9],
  ['Farmacia Sol', 3, 1, 'NE', 'shop', 8],
  ['Taller Delgado', 3, 1, 'S', 'workshop', 7],
  ['Residencial Palmeras', 4, 1, 'FULL', 'flats', 22],
  ['Colegio San Bruno', 5, 1, 'W', 'school', 11],
  ['Almacén 9', 0, 2, 'N', 'warehouse', 11],
  ['Depósito Azul', 0, 2, 'S', 'warehouse', 10],
  ['Clínica Santa Brisa', 1, 2, 'NE', 'hospital', 15],
  ['Comisaría SBPD', 2, 2, 'NW', 'police', 12],
  ['Juzgado de Solano', 2, 2, 'SE', 'court', 13],
  ['Gasolinera Ola', 3, 2, 'W', 'fuel', 6],
  ['Motel Brisa', 4, 2, 'N', 'motel', 9],
  ['Club Náutico', 5, 2, 'S', 'club', 9],
  ['Chiringuito Sol', 1, 3, 'W', 'kiosk', 5],
  ['Heladería Nube', 2, 3, 'E', 'kiosk', 5],
  ['Bar La Ola', 3, 3, 'W', 'tavern', 6],
  ['Escuela de Surf', 4, 3, 'E', 'kiosk', 5],
  ['El Faro', 0, 3, 'W', 'lighthouse', 24],
];

const GENERIC_SIGNS = {
  shop: ['CAFÉ', 'TIENDA', 'ÓPTICA', 'JOYERÍA', 'PAPELERÍA', 'LAVANDERÍA', 'PELUQUERÍA', 'FERRETERÍA'],
  office: ['OFICINAS', 'SEGUROS', 'DENTAL', 'ABOGADOS', 'INMOBILIARIA'],
  flats: ['RESIDENCIAL', 'APARTAMENTOS', ''],
  warehouse: ['LOGÍSTICA', 'DEPÓSITO', ''],
};

export const BUILDINGS = [];
export const SOLIDS = [];

function roofProps(rng, b) {
  const props = [];
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const t = randPick(rng, ['ac', 'ac', 'tank', 'solar', 'garden', 'box']);
    const w = t === 'tank' ? randRange(rng, 5, 8) : randRange(rng, 3, 9);
    props.push({
      t,
      x: b.x + randRange(rng, 3, Math.max(4, b.w - w - 3)),
      y: b.y + randRange(rng, 3, Math.max(4, b.h - w - 3)),
      w,
      h: t === 'tank' ? w : randRange(rng, 3, 7),
    });
  }
  if (b.kind === 'tower' && b.name === 'Torre Oficinas') {
    props.push({ t: 'helipad', x: b.x + b.w / 2 - 11, y: b.y + b.h / 2 - 11, w: 22, h: 22 });
  }
  if (b.kind === 'hotel' || b.kind === 'mall') {
    props.push({ t: 'pool', x: b.x + b.w * 0.55, y: b.y + 6, w: b.w * 0.34, h: 10 });
  }
  return props;
}

function addBuilding(rng, spec) {
  const inset = spec.kind === 'market' || spec.kind === 'mall' ? 2 : 5;
  const r = spec.rect;
  const b = {
    x: r.x + inset,
    y: r.y + inset,
    w: r.w - inset * 2,
    h: r.h - inset * 2,
    height: spec.height,
    name: spec.name || null,
    sign: spec.name || spec.sign || null,
    kind: spec.kind,
    wall: spec.wall || randPick(rng, WALLS),
    roof: spec.roof || randPick(rng, ROOFS),
    district: districtAt(r.x + r.w / 2, r.y + r.h / 2),
  };
  b.props = roofProps(rng, b);
  // The sign plate sits on the edge nearest a street (or the beach
  // promenade), anchored toward the nearest avenue corner so corner
  // buildings sign toward their intersection.
  const edgeLines = [120, 360, 600, 792];
  const dN = Math.min(...edgeLines.map((y) => Math.abs(y - b.y)));
  const dS = Math.min(...edgeLines.map((y) => Math.abs(y - (b.y + b.h))));
  b.signEdge = dN < dS ? 'N' : 'S';
  const bcx = b.x + b.w / 2;
  const nearestAve = AVENUES.map((a) => a.x).reduce((best, x) => (Math.abs(x - bcx) < Math.abs(best - bcx) ? x : best), 120);
  b.signAnchor = bcx < nearestAve ? 'E' : 'W';
  BUILDINGS.push(b);
  SOLIDS.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  return b;
}

function buildCity() {
  const rng = makeRandom(20261117);
  const taken = new Set();
  for (const [name, col, row, plot, kind, height] of NAMED) {
    taken.add(`${col},${row},${plot}`);
    addBuilding(rng, { rect: plotRect(col, row, plot), name, kind, height });
  }
  // The Taller Delgado yard: open asphalt south of the workshop, a delivery
  // and cool-down court (not a building, so not solid).
  // Procedural fill for every remaining plot.
  const kinds = ['shop', 'office', 'flats', 'warehouse'];
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 4; row++) {
      for (const plot of ['NW', 'NE', 'SW', 'SE']) {
        if (taken.has(`${col},${row},${plot}`)) continue;
        // A plot is also taken when a named building used a half/full plot.
        let covered = false;
        for (const key of taken) {
          const [c, r, p] = key.split(',');
          if (Number(c) === col && Number(r) === row && (p === 'FULL' || p === 'W' || p === 'E' || p === 'N' || p === 'S')) {
            if (p === 'FULL') covered = true;
            if (p === 'W' && (plot === 'NW' || plot === 'SW')) covered = true;
            if (p === 'E' && (plot === 'NE' || plot === 'SE')) covered = true;
            if (p === 'N' && (plot === 'NW' || plot === 'NE')) covered = true;
            if (p === 'S' && (plot === 'SW' || plot === 'SE')) covered = true;
          }
        }
        if (covered) continue;
        const roll = rng();
        if (row === 3 && roll < 0.55) continue; // beachfront stays open
        if (roll < 0.16) continue; // plaza / parking gap
        const kind = row === 3 ? 'kiosk' : randPick(rng, kinds);
        const sign = rng() < 0.45 ? randPick(rng, GENERIC_SIGNS[kind] || GENERIC_SIGNS.shop) : null;
        addBuilding(rng, {
          rect: plotRect(col, row, plot),
          kind,
          height: kind === 'flats' ? randRange(rng, 14, 26) : kind === 'office' ? randRange(rng, 12, 30) : randRange(rng, 6, 12),
          sign: sign || null,
        });
      }
    }
  }
}
buildCity();

// Round 19 (cover surgery, late-add — fresh rng, no shift to any
// existing building): the market annexe "La Lonja" fills the free
// strip between Carnicería Pepe and Floristería Lila on Calle del
// Mercado (spec rect insets by the market 2 m to 471–487 × 256–346;
// the north end stops 1 m short of the plaza stall row at y 249–255),
// so its south-edge plate hangs at cy 347.7 — the same latitude as
// Carnicería's. Carnicería's own plate flips to its east corner, and
// the two plates sit ~6 m apart in one row: the tightest signed
// frontage pair in the city, staged for the cover's top band.
{
  const carn = buildingByName('Carnicería Pepe');
  if (carn) carn.signAnchor = 'E';
  addBuilding(makeRandom(20261120), {
    rect: { x: 469, y: 254, w: 20, h: 94 },
    name: 'La Lonja',
    kind: 'market',
    height: 10,
  });
}

export function buildingByName(name) {
  return BUILDINGS.find((b) => b.name === name) || null;
}

export function frontOf(building, dy = 14) {
  // A point on the street just south of a building's main face.
  return { x: building.x + building.w / 2, y: building.y + building.h + dy };
}

// ---------------------------------------------------------------- props
export const PROPS = [];
function buildProps() {
  const rng = makeRandom(977351);
  // Palms along the beach and the boardwalk.
  for (let x = 24; x < WORLD.w - 10; x += 26) {
    if (x > 1090 && x < 1210) continue; // keep the pier clear
    PROPS.push({ t: 'palm', x: x + randRange(rng, -3, 3), y: BEACH_Y + randRange(rng, 2, 10) });
  }
  // Palms along Av. de las Palmas and in plazas.
  for (let y = 30; y < 720; y += 44) {
    PROPS.push({ t: 'palm', x: 360 - 13, y: y + randRange(rng, -4, 4) });
    PROPS.push({ t: 'palm', x: 360 + 13, y: y + 22 + randRange(rng, -4, 4) });
  }
  // Street lamps on every street corner run.
  for (const a of AVENUES) {
    for (let y = 24; y < 730; y += 38) PROPS.push({ t: 'lamp', x: a.x + 10.5, y });
  }
  for (const s of STREETS) {
    for (let x = 24; x < WORLD.w - 10; x += 38) PROPS.push({ t: 'lamp', x, y: s.y + 10.5 });
  }
  // Market stalls in the El Mercado plaza (block 2,1 centre).
  const plaza = blockRect(2, 1);
  for (let i = 0; i < 8; i++) {
    const sx = plaza.x + 26 + (i % 4) * 44;
    const sy = plaza.y + 58 + Math.floor(i / 4) * 62;
    PROPS.push({ t: 'stall', x: sx, y: sy, color: randPick(rng, ['#c0392b', '#e67e22', '#27ae60', '#2980b9']) });
    SOLIDS.push({ x: sx, y: sy, w: 10, h: 6 });
  }
  // Port crates and containers (block 0,2 and the quay).
  const port = blockRect(0, 2);
  for (let i = 0; i < 10; i++) {
    const cx = port.x + 12 + (i % 5) * 20;
    const cy = port.y + port.h - 34 + Math.floor(i / 5) * 16;
    const cont = { t: 'container', x: cx, y: cy, color: randPick(rng, ['#2166ac', '#b2182b', '#1b7837', '#e08214']) };
    PROPS.push(cont);
    SOLIDS.push({ x: cx, y: cy, w: 12, h: 5 });
  }
  for (let i = 0; i < 14; i++) {
    PROPS.push({ t: 'crate', x: port.x + randRange(rng, 6, port.w - 8), y: port.y + randRange(rng, port.h * 0.45, port.h - 8) });
  }
  // Benches and hydrants along the boardwalk and sidewalks.
  for (let x = 40; x < WORLD.w - 20; x += 52) PROPS.push({ t: 'bench', x, y: BEACH_Y - 4 });
  for (let i = 0; i < 26; i++) {
    PROPS.push({ t: 'hydrant', x: randRange(rng, 16, WORLD.w - 16), y: randRange(rng, 16, 720) });
  }
  // Gas pumps at the Gasolinera Ola forecourt.
  const gas = buildingByName('Gasolinera Ola');
  if (gas) {
    for (let i = 0; i < 3; i++) PROPS.push({ t: 'pump', x: gas.x + 12 + i * 12, y: gas.y + gas.h + 6 });
  }
  // Street-life dressing for the market quarter: planters, bins, crates,
  // tyre stacks, benches and shop awnings along the frontages and kerbs
  // around Av. Central x Calle del Mercado and the Café Miramar terrace
  // on Av. del Faro — the pavements a driver or walker actually passes.
  // Awnings are canopies (no solid); the rest are solid at their drawn
  // footprint so nobody strolls through a planter.
  const dress = (t, x, y, extra, solid) => {
    PROPS.push(Object.assign({ t, x, y }, extra || {}));
    if (solid) SOLIDS.push({ x: x - solid[0] / 2, y: y - solid[1] / 2, w: solid[0], h: solid[1] });
  };
  // North frontage band (below the sign plates, above the kerb).
  dress('planter', 549.5, 349.9, { rot: 0.22 }, [1.9, 1.0]);
  dress('stall', 556.5, 349.9, { color: '#27ae60' }, [3.2, 2.5]);
  dress('crate', 564.5, 350.1, { rot: 0.4 }, [1.2, 1.2]);
  dress('planter', 590.0, 349.9, null, [1.9, 1.0]);
  dress('bin', 611.8, 349.8, null, [0.8, 0.9]);
  dress('awning', 614.5, 350.0, { w: 40, color: '#b03a2e' }, null);
  dress('planter', 636.5, 349.9, null, [1.9, 1.0]);
  dress('tires', 641.0, 350.0, null, [1.3, 1.3]);
  dress('bin', 646.0, 349.8, null, [0.8, 0.9]);
  dress('awning', 569, 349.9, { color: '#b03a2e', w: 18 }, null);
  // Kerb palms flanking the Faro x Mercado corners by the cafe.
  dress('palm', 109.5, 344, null, [0.6, 0.6]);
  dress('palm', 131.5, 344, null, [0.6, 0.6]);
  // South kerb band of Calle del Mercado.
  dress('bin', 552, 370.3, null, [0.8, 0.9]);
  dress('planter', 566, 370.4, null, [1.9, 1.0]);
  dress('crate', 580, 370.2, { rot: -0.35 }, [1.2, 1.2]);
  dress('planter', 618, 370.3, null, [1.9, 1.0]);
  dress('tires', 626, 370.2, null, [1.3, 1.3]);
  dress('planter', 636, 370.4, { rot: -0.2 }, [1.9, 1.0]);
  dress('crate', 643, 370.2, { rot: 0.5 }, [1.2, 1.2]);
  // Market spillover row on the open plot south of the street: five
  // red-canopied stalls facing the crossing, clear of the avenue.
  dress('stall', 545, 378.5, { color: '#b03a2e' }, [3.2, 2.5]);
  dress('stall', 550.5, 378.5, { color: '#b03a2e' }, [3.2, 2.5]);
  dress('stall', 556, 378.5, { color: '#b03a2e' }, [3.2, 2.5]);
  dress('stall', 561.5, 378.5, { color: '#b03a2e' }, [3.2, 2.5]);
  dress('stall', 567, 378.5, { color: '#b03a2e' }, [3.2, 2.5]);
  // Av. Central kerbs, north and south of the market crossing.
  dress('planter', 588.5, 320, null, [1.9, 1.0]);
  dress('bin', 611.8, 316, null, [0.8, 0.9]);
  dress('planter', 611.8, 338, null, [1.9, 1.0]);
  dress('bin', 588.5, 340, null, [0.8, 0.9]);
  dress('planter', 611.8, 378, null, [1.9, 1.0]);
  dress('bin', 588.5, 380, null, [0.8, 0.9]);
  // Café Miramar terrace and the west kerb of Av. del Faro.
  dress('awning', 74, 350.1, { w: 30, color: '#1f6f5c' }, null);
  dress('planter', 84, 350.2, null, [1.9, 1.0]);
  dress('bench', 93, 350.3, null, null);
  dress('planter', 102, 350.2, null, [1.9, 1.0]);
  dress('planter', 108.4, 308, null, [1.9, 1.0]);
  dress('crate', 108.5, 318, { rot: -0.42 }, [1.2, 1.2]);
  dress('bin', 108.7, 326, null, [0.8, 0.9]);
  dress('planter', 108.4, 342, null, [1.9, 1.0]);
  // Painted kerb and apron bands along the El Mercado frontage:
  // flat municipal paintwork in the same dressing vocabulary as
  // the Central and Faro frontages — a cream pedestrian band, a
  // buff terrace edge, and the blue zona-azul parking band along
  // the kerb, interrupted by one clay loading marker. Paint is
  // flat on the ground (no solid).
  const band = (x0, x1, y, color, h = 0.25) => {
    PROPS.push({ t: 'paveband', x: x0, y, w: x1 - x0, h, color });
  };
  band(380, 480, 348.53, '#e0c498', 0.32);
  band(380, 480, 349.17, '#d5b588', 0.32);
  band(380, 463, 350.84, '#627384', 0.32);
  band(470.5, 480, 350.84, '#627384', 0.32);
  PROPS.push({ t: 'paveband', x: 463, y: 350.84, w: 7.5, h: 0.32, color: '#c6875e', fe: 0 });
}
buildProps();

// Parked-car spots along street edges (vehicles.js fills a share of them).
export const PARK_SPOTS = [];
function buildParkSpots() {
  const rng = makeRandom(4451);
  for (const a of AVENUES) {
    for (let y = 26; y < 724; y += 15) {
      if (rng() < 0.55) PARK_SPOTS.push({ x: a.x - 6.8, y, angle: Math.PI / 2 });
      if (rng() < 0.55) PARK_SPOTS.push({ x: a.x + 6.8, y, angle: -Math.PI / 2 });
    }
  }
  for (const s of STREETS) {
    for (let x = 26; x < WORLD.w - 16; x += 15) {
      if (rng() < 0.5) PARK_SPOTS.push({ x, y: s.y - 6.8, angle: 0 });
      if (rng() < 0.5) PARK_SPOTS.push({ x, y: s.y + 6.8, angle: Math.PI });
    }
  }
}
buildParkSpots();

// ---------------------------------------------------------------- places
const mercado = buildingByName('Mercado Central');
const clinica = buildingByName('Clínica Santa Brisa');
const comisaria = buildingByName('Comisaría SBPD');
const taller = buildingByName('Taller Delgado');
const residencial = buildingByName('Residencial Palmeras');

// Pale concrete forecourts: the paved market frontage along Calle del
// Mercado and the Café Miramar terrace strip — a distinct light surface
// with expansion joints, speckle and workshop oil stains.
export const FORECOURTS = [
  { x: 556, y: 349.2, w: 88, h: 4.6 },
  { x: 66, y: 349.2, w: 44, h: 4.6 },
];


export const POIS = {
  home: { x: 960, y: 360 },
  hospital: frontOf(clinica, 12),
  policeStation: frontOf(comisaria, 12),
  tallerYard: { x: taller.x + taller.w / 2, y: taller.y + taller.h + 26 },
  mercadoDoor: frontOf(mercado, 10),
  elMercado: { x: 720, y: 240 },
  cineAurora: frontOf(buildingByName('Cine Aurora'), 12),
  restauranteCielo: frontOf(buildingByName('Restaurante Cielo'), 12),
  galeriaPrisma: frontOf(buildingByName('Galería Prisma'), 12),
  torreOficinas: frontOf(buildingByName('Torre Oficinas'), 12),
  libreriaFaro: frontOf(buildingByName('Librería Faro'), 12),
  barElPuerto: frontOf(buildingByName('Bar El Puerto'), 12),
  marinaPier: { x: 1148, y: 848 },
  beach: { x: 624, y: 762 },
  coverCorner: { x: 600, y: 360 },
};

// ---------------------------------------------------------------- collision
function circleRectHit(x, y, r, rect) {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

export function inWater(x, y) {
  for (const d of DECKS) {
    if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return false;
  }
  return WATER.some((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h);
}

export function circleBlocked(x, y, r) {
  if (x < r || y < r || x > WORLD.w - r || y > WORLD.h - r) return true;
  const onDeck = DECKS.some((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
  if (!onDeck) {
    for (const w of WATER) {
      if (circleRectHit(x, y, r, w)) return true;
    }
  }
  for (const s of SOLIDS) {
    if (circleRectHit(x, y, r, s)) return true;
  }
  return false;
}

// Nearest free spot to (x, y) for a circle of radius r — used by spawns,
// respawns and teleports so nobody materialises inside a building or the bay.
export function findFree(x, y, r) {
  if (!circleBlocked(x, y, r)) return { x, y };
  for (let ring = 4; ring <= 60; ring += 4) {
    for (let a = 0; a < 12; a++) {
      const nx = x + Math.cos((a / 12) * Math.PI * 2) * ring;
      const ny = y + Math.sin((a / 12) * Math.PI * 2) * ring;
      if (!circleBlocked(nx, ny, r)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}

// Move a circle entity by (dx, dy), sliding along whatever it hits.
// Returns which axes were blocked.
export function tryMove(e, dx, dy, r) {
  const hit = { x: false, y: false };
  if (dx !== 0) {
    if (!circleBlocked(e.x + dx, e.y, r)) e.x += dx;
    else hit.x = true;
  }
  if (dy !== 0) {
    if (!circleBlocked(e.x, e.y + dy, r)) e.y += dy;
    else hit.y = true;
  }
  return hit;
}

export function pointInRect(x, y, rect, pad = 0) {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}
