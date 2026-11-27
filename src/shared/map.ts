/**
 * PENCIL SUS — the ship, drawn in graphite.
 *
 * Everything here is authored in grid units (1 unit = 1 meter). Rooms and
 * corridors are rectangles; walls are generated from the walkable grid so the
 * geometry always matches the collision data.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface RoomDef extends Rect {
  id: string;
  name: string;
}

/** Bounds of the notebook page we sketch the ship on. */
export const WORLD = { minX: 1, minZ: 1, maxX: 43, maxZ: 31 };
export const WORLD_W = WORLD.maxX - WORLD.minX;
export const WORLD_H = WORLD.maxZ - WORLD.minZ;

export const ROOMS: RoomDef[] = [
  { id: 'medbay', name: 'MEDBAY', x0: 16, z0: 3, x1: 24, z1: 9 },
  { id: 'cafeteria', name: 'CAFETERIA', x0: 14, z0: 12, x1: 28, z1: 21 },
  { id: 'upper', name: 'UPPER ENGINE', x0: 3, z0: 7, x1: 10, z1: 14 },
  { id: 'lower', name: 'LOWER ENGINE', x0: 3, z0: 18, x1: 10, z1: 25 },
  { id: 'reactor', name: 'REACTOR', x0: 17, z0: 24, x1: 25, z1: 29 },
  { id: 'storage', name: 'STORAGE', x0: 32, z0: 10, x1: 40, z1: 18 },
];

export const CORRIDORS: Rect[] = [
  { x0: 18, z0: 9, x1: 21, z1: 12 }, // medbay -> cafeteria
  { x0: 10, z0: 13, x1: 14, z1: 16 }, // cafeteria -> upper engine
  { x0: 5, z0: 14, x1: 8, z1: 18 }, // upper -> lower engine
  { x0: 10, z0: 19, x1: 14, z1: 22 }, // cafeteria -> lower engine
  { x0: 28, z0: 14, x1: 32, z1: 17 }, // cafeteria -> storage
  { x0: 19, z0: 21, x1: 22, z1: 24 }, // cafeteria -> reactor
  { x0: 25, z0: 25, x1: 36, z1: 28 }, // reactor -> storage (south hall)
  { x0: 33, z0: 18, x1: 36, z1: 25 }, // south hall -> storage
];

export const CELL = 1;
const GW = Math.ceil(WORLD_W) + 2;
const GH = Math.ceil(WORLD_H) + 2;

function inRect(cx: number, cz: number, r: Rect): boolean {
  return cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1;
}

function cellIndex(cx: number, cz: number): number {
  const ix = Math.floor(cx) - WORLD.minX;
  const iz = Math.floor(cz) - WORLD.minZ;
  return iz * GW + ix;
}

export const walkable: Uint8Array = (() => {
  const grid = new Uint8Array(GW * GH);
  for (let iz = 0; iz < GH; iz++) {
    for (let ix = 0; ix < GW; ix++) {
      const cx = ix + WORLD.minX + 0.5;
      const cz = iz + WORLD.minZ + 0.5;
      let ok = false;
      for (const r of ROOMS) if (inRect(cx, cz, r)) ok = true;
      if (!ok) for (const r of CORRIDORS) if (inRect(cx, cz, r)) ok = true;
      grid[iz * GW + ix] = ok ? 1 : 0;
    }
  }
  return grid;
})();

export function isWalkableCell(cx: number, cz: number): boolean {
  const ix = Math.floor(cx) - WORLD.minX;
  const iz = Math.floor(cz) - WORLD.minZ;
  if (ix < 0 || iz < 0 || ix >= GW || iz >= GH) return false;
  return walkable[iz * GW + ix] === 1;
}

export function isWalkable(x: number, z: number): boolean {
  return isWalkableCell(x, z);
}

/** True if a circle of radius r at (x,z) overlaps a wall cell. */
export function hitsWall(x: number, z: number, r = 0.42): boolean {
  const minX = Math.floor(x - r);
  const maxX = Math.floor(x + r);
  const minZ = Math.floor(z - r);
  const maxZ = Math.floor(z + r);
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (isWalkableCell(cx + 0.5, cz + 0.5)) continue;
      // circle vs axis aligned cell
      const nx = Math.max(cx, Math.min(x, cx + 1));
      const nz = Math.max(cz, Math.min(z, cz + 1));
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

/** Slide a circle from a to b, resolving each axis separately. */
export function moveWithCollision(
  x: number,
  z: number,
  dx: number,
  dz: number,
  r = 0.42,
): { x: number; z: number } {
  let nx = x + dx;
  let nz = z + dz;
  if (hitsWall(nx, z, r)) nx = x;
  if (hitsWall(nx, nz, r)) nz = z;
  if (nx === x && nz === z && !hitsWall(x + dx, z + dz, r)) {
    nx = x + dx;
    nz = z + dz;
  }
  return { x: nx, z: nz };
}

export function roomAt(x: number, z: number): RoomDef | null {
  for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 + 1 && z >= r.z0 && z <= r.z1 + 1) return r;
  return null;
}

// ---------------------------------------------------------------------------
// pathfinding (A* on the walkable grid) — used by the doodle bots
// ---------------------------------------------------------------------------

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findPath(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const sx = Math.floor(from.x) - WORLD.minX;
  const sz = Math.floor(from.z) - WORLD.minZ;
  let tx = Math.floor(to.x) - WORLD.minX;
  let tz = Math.floor(to.z) - WORLD.minZ;
  if (tx < 0 || tz < 0 || tx >= GW || tz >= GH) return [];
  if (!walkable[tz * GW + tx]) {
    const near = nearestWalkableCell(tx, tz);
    if (!near) return [];
    tx = near[0];
    tz = near[1];
  }
  const start = sz * GW + sx;
  const goal = tz * GW + tx;
  if (start === goal) return [{ x: to.x, z: to.z }];
  const open: number[] = [start];
  const cameFrom = new Int32Array(GW * GH).fill(-1);
  const gScore = new Float32Array(GW * GH).fill(Infinity);
  gScore[start] = 0;
  const fScore = new Float32Array(GW * GH).fill(Infinity);
  fScore[start] = Math.abs(sx - tx) + Math.abs(sz - tz);
  const closed = new Uint8Array(GW * GH);
  while (open.length) {
    let bestI = 0;
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bestI]]) bestI = i;
    const current = open.splice(bestI, 1)[0];
    if (current === goal) {
      const cells: number[] = [];
      let c = current;
      while (c !== -1) {
        cells.push(c);
        c = cameFrom[c];
      }
      cells.reverse();
      const pts = cells.map((idx) => ({
        x: (idx % GW) + WORLD.minX + 0.5,
        z: Math.floor(idx / GW) + WORLD.minZ + 0.5,
      }));
      pts.push({ x: to.x % 1 === 0 ? to.x + 0.5 : to.x, z: to.z });
      return simplify(pts, from);
    }
    closed[current] = 1;
    const cx = current % GW;
    const cz = Math.floor(current / GW);
    for (const [dx, dz] of N4) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GW || nz >= GH) continue;
      const ni = nz * GW + nx;
      if (!walkable[ni] || closed[ni]) continue;
      const tentative = gScore[current] + 1;
      if (tentative < gScore[ni]) {
        cameFrom[ni] = current;
        gScore[ni] = tentative;
        fScore[ni] = tentative + Math.abs(nx - tx) + Math.abs(nz - tz);
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return [];
}

function nearestWalkableCell(ix: number, iz: number): [number, number] | null {
  for (let r = 1; r < 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= GW || z >= GH) continue;
        if (walkable[z * GW + x]) return [x, z];
      }
    }
  }
  return null;
}

function lineClear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsWall(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.42)) return false;
  }
  return true;
}

/** Drop waypoints we can walk straight past. */
function simplify(pts: { x: number; z: number }[], from: { x: number; z: number }): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    for (; j > i; j--) if (lineClear(cur, pts[j])) break;
    const p = pts[j];
    out.push(p);
    cur = p;
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// points of interest
// ---------------------------------------------------------------------------

export type TaskKind = 'wires' | 'swipe' | 'dial' | 'fuel' | 'trash';

export interface Station {
  id: string;
  name: string;
  kind: TaskKind;
  x: number;
  z: number;
  room: string;
  /** side of the console the player should stand on */
  facing: number;
}

export const STATIONS: Station[] = [
  { id: 'sample', name: 'INSPECT SAMPLE', kind: 'dial', x: 18.5, z: 5.5, room: 'medbay', facing: Math.PI },
  { id: 'scan', name: 'MEDICAL SCAN', kind: 'swipe', x: 22.5, z: 5.5, room: 'medbay', facing: Math.PI },
  { id: 'trash', name: 'EMPTY TRASH', kind: 'trash', x: 17.5, z: 15.5, room: 'cafeteria', facing: 0 },
  { id: 'download', name: 'DOWNLOAD DATA', kind: 'dial', x: 25.5, z: 18.5, room: 'cafeteria', facing: 0 },
  { id: 'align', name: 'ALIGN OUTPUT', kind: 'dial', x: 5.5, z: 10.5, room: 'upper', facing: 0 },
  { id: 'refuel', name: 'REFUEL ENGINE', kind: 'fuel', x: 5.5, z: 22.5, room: 'lower', facing: 0 },
  { id: 'boot', name: 'BOOT REACTOR', kind: 'swipe', x: 21.5, z: 27.5, room: 'reactor', facing: 0 },
  { id: 'wires', name: 'WIRE PANEL', kind: 'wires', x: 35.5, z: 13.5, room: 'storage', facing: Math.PI },
  { id: 'filters', name: 'CLEAN FILTERS', kind: 'trash', x: 38.5, z: 16.5, room: 'storage', facing: Math.PI },
  { id: 'fuelstore', name: 'FUEL STORAGE', kind: 'fuel', x: 33.5, z: 15.5, room: 'storage', facing: Math.PI * 0.5 },
];

export const VENTS: { id: number; x: number; z: number }[] = [
  { id: 0, x: 23.5, z: 7.5 },
  { id: 1, x: 26.5, z: 19.5 },
  { id: 2, x: 8.5, z: 12.5 },
  { id: 3, x: 8.5, z: 20.5 },
  { id: 4, x: 23.5, z: 26.0 },
  { id: 5, x: 37.5, z: 11.5 },
];

export const REACTOR_PANELS: { id: number; x: number; z: number }[] = [
  { id: 0, x: 18.5, z: 25.5 },
  { id: 1, x: 24.5, z: 28.5 },
];

export const BREAKERS: { id: number; x: number; z: number }[] = [
  { id: 0, x: 9.5, z: 8.5 },
  { id: 1, x: 39.5, z: 17.5 },
];

export const BUTTON = { x: 21, z: 16.5 };

export const SPAWNS: { x: number; z: number }[] = (() => {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push({ x: 21 + Math.cos(a) * 3.2, z: 17 + Math.sin(a) * 2.4 });
  }
  return pts;
})();

// ---------------------------------------------------------------------------
// wall boundary helpers (shared by the 3D mesher and the drawn floor shadow)
// ---------------------------------------------------------------------------

export interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** Collapse the walkable boundary into long, merged wall runs. */
export function boundarySegments(): Segment[] {
  const segs: Segment[] = [];
  const minX = WORLD.minX - 1;
  const maxX = WORLD.maxX + 1;
  const minZ = WORLD.minZ - 1;
  const maxZ = WORLD.maxZ + 1;
  const walk = (x: number, z: number) => isWalkableCell(x, z);
  for (let z = minZ; z <= maxZ; z++) {
    let runStart: number | null = null;
    for (let x = minX; x <= maxX; x++) {
      const isWall = walk(x, z - 1) !== walk(x, z);
      if (isWall && runStart === null) runStart = x;
      if (!isWall && runStart !== null) {
        segs.push({ x1: runStart, z1: z, x2: x, z2: z });
        runStart = null;
      }
    }
    if (runStart !== null) segs.push({ x1: runStart, z1: z, x2: maxX + 1, z2: z });
  }
  for (let x = minX; x <= maxX; x++) {
    let runStart: number | null = null;
    for (let z = minZ; z <= maxZ; z++) {
      const isWall = walk(x - 1, z) !== walk(x, z);
      if (isWall && runStart === null) runStart = z;
      if (!isWall && runStart !== null) {
        segs.push({ x1: x, z1: runStart, x2: x, z2: z });
        runStart = null;
      }
    }
    if (runStart !== null) segs.push({ x1: x, z1: runStart, x2: x, z2: maxZ + 1 });
  }
  return segs;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Direction from a point toward the closest wall, plus how far away it is. */
export function toNearestWall(x: number, z: number): { dx: number; dz: number; dist: number } {
  let best = { dx: 0, dz: 0, dist: 99 };
  for (const [dx, dz] of DIRS) {
    for (let d = 0.4; d < 6; d += 0.25) {
      if (!isWalkable(x + dx * d, z + dz * d)) {
        if (d < best.dist) best = { dx, dz, dist: d };
        break;
      }
    }
  }
  return best;
}

/** Push a prop toward the wall so the doodle stands in front of it. */
export function againstWall(x: number, z: number, gap = 0.75): { x: number; z: number } {
  const w = toNearestWall(x, z);
  if (w.dist === 99) return { x, z };
  const move = Math.min(gap, Math.max(0, w.dist - 0.45));
  return { x: x + w.dx * move, z: z + w.dz * move };
}

export const PLAYER_COLORS = [
  '#e8563f', // crayon red
  '#2f7fd0', // ink blue
  '#e5a325', // pencil yellow
  '#4fae6a', // green
  '#a862c9', // purple
  '#e07fb2', // pink
  '#f07d2b', // orange
  '#3fb8b0', // teal
  '#8f8f8f', // graphite
  '#d8c455', // ochre
];
