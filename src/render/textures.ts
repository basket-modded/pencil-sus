/**
 * Everything in PENCIL SUS is drawn with code: graphite strokes, crayon fills
 * and notebook paper. No image assets ship with the game.
 */
import * as THREE from 'three';
import {
  BREAKERS,
  CORRIDORS,
  REACTOR_PANELS,
  ROOMS,
  STATIONS,
  VENTS,
  WORLD,
  WORLD_H,
  WORLD_W,
  boundarySegments,
  isWalkableCell,
} from '../shared/map';

const GRAPHITE = '#2c2b33';
const HAND_FONT = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", "Comic Neue", cursive';

let seed = 1337;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
export function randRange(a: number, b: number) {
  return a + rand() * (b - a);
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

/** A single shaky pencil stroke. */
export function pencilStroke(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { amp?: number; width?: number; alpha?: number; color?: string } = {},
) {
  const amp = opts.amp ?? 1.4;
  const width = opts.width ?? 2;
  ctx.save();
  ctx.strokeStyle = opts.color ?? GRAPHITE;
  ctx.lineCap = 'round';
  const passes = 2;
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = (opts.alpha ?? 0.7) * (p === 0 ? 1 : 0.5);
    ctx.lineWidth = width * (p === 0 ? 1 : 0.6);
    ctx.beginPath();
    ctx.moveTo(x1 + randRange(-amp, amp), y1 + randRange(-amp, amp));
    const segs = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 26));
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const mx = x1 + (x2 - x1) * t + randRange(-amp * 1.6, amp * 1.6);
      const my = y1 + (y2 - y1) * t + randRange(-amp * 1.6, amp * 1.6);
      ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function pencilRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { amp?: number; width?: number; alpha?: number; color?: string } = {},
) {
  pencilStroke(ctx, x, y, x + w, y, opts);
  pencilStroke(ctx, x + w, y, x + w, y + h, opts);
  pencilStroke(ctx, x + w, y + h, x, y + h, opts);
  pencilStroke(ctx, x, y + h, x, y, opts);
}

/** Handwriting that looks like it was pressed into the page. */
export function pencilText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { align?: CanvasTextAlign; alpha?: number; color?: string; weight?: string } = {},
) {
  ctx.save();
  ctx.font = `${opts.weight ?? '700'} ${size}px ${HAND_FONT}`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color ?? GRAPHITE;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = (opts.alpha ?? 0.85) * (i === 0 ? 1 : 0.4);
    ctx.fillText(text, x + randRange(-1.2, 1.2), y + randRange(-1.2, 1.2));
  }
  ctx.restore();
}

/** Crayon-ish fill: waxy, slightly transparent, never inside the lines. */
export function crayonFill(ctx: CanvasRenderingContext2D, path: () => void, color: string, alpha = 0.82) {
  ctx.save();
  path();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.clip();
  // waxy streaks, clipped to the shape so nothing spills onto the page
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    const len = 6 + rand() * 26;
    ctx.globalAlpha = alpha * (0.05 + rand() * 0.16);
    ctx.strokeStyle = rand() > 0.5 ? '#ffffff' : '#000000';
    ctx.lineWidth = 1 + rand() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function paperBase(ctx: CanvasRenderingContext2D, w: number, h: number, tint = '#f6f2e7') {
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  // fibres
  for (let i = 0; i < (w * h) / 700; i++) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.globalAlpha = rand() * 0.07;
    ctx.strokeStyle = rand() > 0.5 ? '#8a8272' : '#ffffff';
    ctx.lineWidth = rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + randRange(-8, 8), y + randRange(-8, 8));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The notebook page the ship is drawn on, including labels and margin notes. */
export function makeFloorTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round((W * WORLD_H) / WORLD_W);
  const { c, ctx } = canvas(W, H);
  paperBase(ctx, W, H, '#f7f3e8');
  const sx = W / WORLD_W;
  const sz = H / WORLD_H;
  const tx = (x: number) => (x - WORLD.minX) * sx;
  const tz = (z: number) => (z - WORLD.minZ) * sz;

  // faint blue graph grid
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#8fb3d9';
  ctx.lineWidth = 1.6;
  for (let x = 0; x < W; x += sx) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += sz) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  // heavy ruled lines every 8 units
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#5d86b5';
  ctx.lineWidth = 3;
  for (let y = 0; y < H; y += sz * 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  // floor shading inside rooms: light hatching along the walls
  for (const r of ROOMS) {
    const x0 = tx(r.x0);
    const z0 = tz(r.z0);
    const w = tx(r.x1 + 1) - x0;
    const h = tz(r.z1 + 1) - z0;
    ctx.save();
    ctx.globalAlpha = 0.1;
    for (let i = -h; i < w; i += 26) {
      ctx.strokeStyle = '#6a6357';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0 + i, z0);
      ctx.lineTo(x0 + i + h, z0 + h);
      ctx.stroke();
    }
    ctx.restore();
    // room name, mid-room, faded like an erased label
    ctx.save();
    ctx.globalAlpha = 0.5;
    pencilText(ctx, r.name, x0 + w / 2, z0 + h - 42, Math.min(50, w / 9), { alpha: 0.26 });
    ctx.restore();
    // room tick marks in the corners
    const corner = 34;
    pencilStroke(ctx, x0 + 10, z0 + 10, x0 + 10 + corner, z0 + 10, { alpha: 0.25 });
    pencilStroke(ctx, x0 + 10, z0 + 10, x0 + 10, z0 + 10 + corner, { alpha: 0.25 });
  }

  // soft graphite shadow hugging the inside of every wall
  ctx.save();
  for (const seg of boundarySegments()) {
    const horizontal = Math.abs(seg.x2 - seg.x1) > Math.abs(seg.z2 - seg.z1);
    const mx = (seg.x1 + seg.x2) / 2;
    const mz = (seg.z1 + seg.z2) / 2;
    const nx = horizontal ? 0 : 1;
    const nz = horizontal ? 1 : 0;
    const sign = isWalkableCell(mx + nx * 0.5, mz + nz * 0.5) ? 1 : -1;
    const steps = horizontal ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.z2 - seg.z1);
    const offsets: [number, number, number][] = [
      [0.12, 0.22, 3.2],
      [0.34, 0.12, 3],
      [0.62, 0.07, 3],
      [1.0, 0.035, 3],
    ];
    for (const [off, alpha, width] of offsets) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#4a463d';
      ctx.lineWidth = width;
      ctx.beginPath();
      const ox = nx * off * sign;
      const oz = nz * off * sign;
      if (horizontal) {
        ctx.moveTo(tx(seg.x1), tz(seg.z1) + oz * sz);
        ctx.lineTo(tx(seg.x2), tz(seg.z1) + oz * sz);
      } else {
        ctx.moveTo(tx(seg.x1) + ox * sx, tz(seg.z1));
        ctx.lineTo(tx(seg.x1) + ox * sx, tz(seg.z2));
      }
      void steps;
      ctx.stroke();
    }
  }
  ctx.restore();

  // corridor arrows
  ctx.save();
  ctx.globalAlpha = 0.28;
  const arrows: [number, number, number, number][] = [
    [19.5, 10.6, 19.5, 11.6],
    [11.6, 14.6, 13.4, 14.6],
    [6.6, 15.4, 6.6, 17.4],
    [11.6, 20.6, 13.4, 20.6],
    [29.6, 15.6, 31.4, 15.6],
    [20.6, 22.4, 20.6, 23.4],
    [30.6, 26.6, 32.4, 26.6],
    [34.6, 20.4, 34.6, 22.4],
  ];
  for (const [x1, z1, x2, z2] of arrows) {
    pencilStroke(ctx, tx(x1), tz(z1), tx(x2), tz(z2), { alpha: 0.5 });
    const ang = Math.atan2(tz(z2) - tz(z1), tx(x2) - tx(x1));
    const ex = tx(x2);
    const ez = tz(z2);
    pencilStroke(ctx, ex, ez, ex - Math.cos(ang - 0.5) * 18, ez - Math.sin(ang - 0.5) * 18, { alpha: 0.5 });
    pencilStroke(ctx, ex, ez, ex - Math.cos(ang + 0.5) * 18, ez - Math.sin(ang + 0.5) * 18, { alpha: 0.5 });
  }
  ctx.restore();

  // coffee ring + margin scribbles
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(tx(6), tz(28.4), 60, 0.2, Math.PI * 1.85);
  ctx.stroke();
  ctx.globalAlpha = 0.09;
  ctx.beginPath();
  ctx.arc(tx(6.1), tz(28.3), 52, 0.4, Math.PI * 1.7);
  ctx.stroke();
  ctx.restore();

  // doodles in the empty margins
  const doodleAngles = [
    [3.4, 3.2],
    [39.4, 4.6],
    [23, 2.0],
    [12.4, 27.6],
    [39, 22.4],
    [31, 4.2],
    [3.2, 29.0],
  ];
  for (const [dx, dz] of doodleAngles) {
    const x = tx(dx);
    const y = tz(dz);
    ctx.save();
    ctx.globalAlpha = 0.34;
    // star doodle
    ctx.strokeStyle = GRAPHITE;
    ctx.lineWidth = 2.4;
    const spikes = 5;
    const rOuter = 22 + rand() * 16;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? rOuter : rOuter * 0.45;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // little "drawn by hand" notes
  ctx.save();
  pencilText(ctx, 'PENCIL  SUS', W * 0.5, H * 0.035, 54, { alpha: 0.18 });
  pencilText(ctx, 'do not let them erase you', W * 0.13, H * 0.965, 34, { alpha: 0.22 });
  pencilText(ctx, 'sketchbook no.7  —  graphite on paper', W * 0.82, H * 0.955, 28, { alpha: 0.2 });
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tiling graphite hatch used for the walls. */
export function makeWallTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  paperBase(ctx, S, S, '#efeade');
  ctx.save();
  for (let i = 0; i < 240; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = 30 + rand() * 90;
    ctx.globalAlpha = 0.05 + rand() * 0.22;
    ctx.strokeStyle = '#3a3742';
    ctx.lineWidth = 0.8 + rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * 0.5, y + len);
    ctx.stroke();
  }
  // brick-ish seams
  ctx.globalAlpha = 0.5;
  for (let y = 0; y <= S; y += S / 4) {
    pencilStroke(ctx, 0, y, S, y, { alpha: 0.35, width: 2 });
  }
  for (let y = 0; y < S; y += S / 4) {
    const offset = (y / (S / 4)) % 2 === 0 ? 0 : S / 2;
    for (let x = offset; x < S; x += S / 2) pencilStroke(ctx, x, y, x, y + S / 4, { alpha: 0.3, width: 2 });
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Grainy overlay for the whole viewport (post effect substitute). */
export function makeGrainTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + rand() * 135;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = rand() * 26;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// characters
// ---------------------------------------------------------------------------

/** Draws a doodled crewmate. 4 walk frames, 2 rows (normal / ghost). */
export function makeCharacterSheet(color: string): { frames: THREE.Texture[]; ghost: THREE.Texture[] } {
  const W = 220;
  const H = 300;
  const frames: THREE.Texture[] = [];
  const ghost: THREE.Texture[] = [];
  for (let f = 0; f < 4; f++) {
    frames.push(new THREE.CanvasTexture(drawCrew(color, f, false, W, H)));
    ghost.push(new THREE.CanvasTexture(drawCrew(color, f, true, W, H)));
  }
  for (const t of [...frames, ...ghost]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { frames, ghost };
}

function drawCrew(color: string, frame: number, isGhost: boolean, W: number, H: number): HTMLCanvasElement {
  const { c, ctx } = canvas(W, H);
  const cx = W / 2;
  const bob = frame === 1 || frame === 3 ? -4 : 0;
  const legSwing = frame === 0 ? -1 : frame === 2 ? 1 : 0;
  const bodyW = 118;
  const bodyH = isGhost ? 150 : 172;
  const top = 66 + bob;
  const bottom = top + bodyH;
  const left = cx - bodyW / 2;
  const right = cx + bodyW / 2;
  const fill = isGhost ? '#ffffff' : color;

  ctx.save();
  if (isGhost) ctx.globalAlpha = 0.62;

  // backpack
  const bpW = 40;
  const bpH = 86;
  const bpX = right - 12;
  const bpY = top + 52;
  ctx.save();
  ctx.globalAlpha *= 0.95;
  crayonFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.roundRect(bpX, bpY, bpW, bpH, 16);
    },
    fill,
    0.9,
  );
  ctx.restore();
  pencilRect(ctx, bpX, bpY, bpW, bpH, { alpha: 0.8, width: 3.2, amp: 1.8 });

  // legs
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.globalAlpha = isGhost ? 0.4 : 0.9;
  for (const side of [-1, 1]) {
    const lx = cx + side * 32;
    ctx.beginPath();
    ctx.moveTo(lx, bottom - 16);
    ctx.lineTo(lx + legSwing * side * 12, bottom + 26);
    ctx.stroke();
  }
  ctx.globalAlpha = isGhost ? 0.5 : 1;

  // body
  crayonFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.roundRect(left, top, bodyW, bodyH, bodyW * 0.46);
    },
    fill,
    0.9,
  );
  // outline, twice for a sketched double line
  for (let i = 0; i < 2; i++) {
    ctx.globalAlpha = isGhost ? 0.4 : 0.9;
    ctx.strokeStyle = GRAPHITE;
    ctx.lineWidth = i === 0 ? 4.2 : 2.4;
    ctx.beginPath();
    ctx.roundRect(
      left + randRange(-2, 2),
      top + randRange(-2, 2),
      bodyW + randRange(-3, 3),
      bodyH + randRange(-3, 3),
      bodyW * 0.46,
    );
    ctx.stroke();
  }

  // visor
  const vx = cx + 14;
  const vy = top + 64;
  ctx.save();
  ctx.globalAlpha = isGhost ? 0.55 : 1;
  ctx.beginPath();
  ctx.ellipse(vx, vy, 46, 34, -0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#eef7fb';
  ctx.fill();
  ctx.globalAlpha = isGhost ? 0.4 : 0.9;
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = 3.6;
  ctx.stroke();
  // glint
  ctx.beginPath();
  ctx.ellipse(vx - 14, vy - 10, 12, 7, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.restore();

  if (isGhost) {
    // wavy ghost tail over the body bottom
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#f7f3e8';
    ctx.beginPath();
    ctx.moveTo(left - 4, bottom - 40);
    ctx.quadraticCurveTo(left + 20, bottom + 18, cx - 30, bottom - 14);
    ctx.quadraticCurveTo(cx, bottom + 24, cx + 26, bottom - 16);
    ctx.quadraticCurveTo(right - 6, bottom + 14, right + 4, bottom - 44);
    ctx.closePath();
    ctx.fill();
    // X eyes over the visor
    ctx.strokeStyle = GRAPHITE;
    ctx.lineWidth = 4;
    for (const off of [-16, 12]) {
      ctx.beginPath();
      ctx.moveTo(vx + off - 8, vy - 8);
      ctx.lineTo(vx + off + 8, vy + 8);
      ctx.moveTo(vx + off + 8, vy - 8);
      ctx.lineTo(vx + off - 8, vy + 8);
      ctx.stroke();
    }
  }

  // crayon scribble texture on the body
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#000000';
  for (let i = 0; i < 14; i++) {
    const sx = left + rand() * bodyW;
    const sy = top + rand() * bodyH;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + randRange(-26, 26), sy + randRange(-10, 10));
    ctx.stroke();
  }
  ctx.restore();
  return c;
}

export function makeBodySprite(color: string): HTMLCanvasElement {
  const W = 260;
  const H = 200;
  const { c, ctx } = canvas(W, H);
  // pencil-pool
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(W / 2, H - 40, 92, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#b23a2e';
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 70;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * r, H - 40 + Math.sin(a) * r * 0.3);
    ctx.lineTo(W / 2 + Math.cos(a) * (r + 18), H - 40 + Math.sin(a) * (r + 18) * 0.3);
    ctx.stroke();
  }
  ctx.restore();

  // body lying on its side
  ctx.save();
  ctx.translate(W / 2, H - 66);
  ctx.rotate(-0.16);
  crayonFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.roundRect(-96, -62, 176, 108, 44);
    },
    color,
    0.85,
  );
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(-96, -62, 176, 108, 44);
  ctx.stroke();
  // backpack
  ctx.beginPath();
  ctx.roundRect(-118, -44, 34, 66, 14);
  ctx.stroke();
  // X eyes
  ctx.lineWidth = 5;
  for (const off of [26, 62]) {
    ctx.beginPath();
    ctx.moveTo(off - 10, -34);
    ctx.lineTo(off + 10, -14);
    ctx.moveTo(off + 10, -34);
    ctx.lineTo(off - 10, -14);
    ctx.stroke();
  }
  ctx.restore();
  return c;
}

export function makeLabel(text: string, color?: string, sub?: string): THREE.CanvasTexture {
  const W = 512;
  const H = 160;
  const { c, ctx } = canvas(W, H);
  if (color) {
    // colour swatch tab
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 74, 30, 22, 40, 8);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.textAlign = 'center';
  pencilText(ctx, text, W / 2 + (color ? 6 : 0), 52, 44, { alpha: 0.92 });
  if (sub) pencilText(ctx, sub, W / 2, 110, 28, { alpha: 0.6 });
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeIconSprite(kind: 'task' | 'vent' | 'button' | 'panel' | 'breaker' | 'exclaim'): THREE.CanvasTexture {
  const S = 160;
  const { c, ctx } = canvas(S, S);
  ctx.save();
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const m = S / 2;
  if (kind === 'task') {
    pencilStroke(ctx, m - 34, m + 6, m - 8, m + 32, { width: 8, amp: 2 });
    pencilStroke(ctx, m - 8, m + 32, m + 34, m - 30, { width: 8, amp: 2 });
  } else if (kind === 'vent') {
    pencilRect(ctx, m - 34, m - 24, 68, 48, { width: 5 });
    for (let i = -1; i <= 1; i++) pencilStroke(ctx, m - 26, m + i * 14, m + 26, m + i * 14, { width: 3, amp: 1 });
  } else if (kind === 'button') {
    ctx.beginPath();
    ctx.arc(m, m, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m, m, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#d24a3a';
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else if (kind === 'panel') {
    pencilRect(ctx, m - 36, m - 28, 72, 56, { width: 5 });
    pencilStroke(ctx, m - 20, m - 8, m + 22, m - 8, { width: 4 });
    pencilStroke(ctx, m - 20, m + 8, m + 10, m + 8, { width: 4 });
    ctx.beginPath();
    ctx.arc(m + 20, m + 14, 8, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'breaker') {
    pencilRect(ctx, m - 26, m - 36, 52, 72, { width: 5 });
    pencilStroke(ctx, m, m - 18, m, m + 18, { width: 6 });
    pencilStroke(ctx, m - 8, m - 18, m + 8, m - 18, { width: 5 });
  } else {
    pencilText(ctx, '!', m, m, 120, { alpha: 0.95, weight: '700' });
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeConsoleScreen(kind: string): THREE.CanvasTexture {
  const W = 256;
  const H = 160;
  const { c, ctx } = canvas(W, H);
  paperBase(ctx, W, H, '#eef4f0');
  ctx.save();
  ctx.globalAlpha = 0.5;
  pencilRect(ctx, 12, 12, W - 24, H - 24, { width: 3 });
  pencilText(ctx, kind, W / 2, 40, 26, { alpha: 0.8 });
  // fake waveform / bars
  for (let i = 0; i < 12; i++) {
    const h = 10 + rand() * 40;
    pencilStroke(ctx, 30 + i * 16, H - 34, 30 + i * 16, H - 34 - h, { width: 4, alpha: 0.6, amp: 1 });
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small hand-drawn map used by the minimap overlay. */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  markers: { x: number; z: number; color: string; alive: boolean; you: boolean }[],
  bodies: { x: number; z: number }[],
) {
  ctx.clearRect(0, 0, W, H);
  const pad = 10;
  const s = Math.min((W - pad * 2) / WORLD_W, (H - pad * 2) / WORLD_H);
  const ox = (W - WORLD_W * s) / 2 - WORLD.minX * s;
  const oz = (H - WORLD_H * s) / 2 - WORLD.minZ * s;
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => oz + z * s;

  const shapes = [...ROOMS, ...CORRIDORS];
  for (const r of shapes) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fdfbf3';
    ctx.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0 + 1) * s, (r.z1 - r.z0 + 1) * s);
    ctx.restore();
    pencilRect(ctx, X(r.x0), Z(r.z0), (r.x1 - r.x0 + 1) * s, (r.z1 - r.z0 + 1) * s, {
      alpha: 0.55,
      width: 1.8,
      amp: 0.9,
    });
  }
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const r of ROOMS) {
    const size = Math.max(7, Math.min(12, (r.x1 - r.x0) * s * 0.18));
    pencilText(ctx, r.name.split(' ')[0], X((r.x0 + r.x1) / 2), Z((r.z0 + r.z1) / 2), size, { alpha: 0.6 });
  }
  ctx.restore();

  for (const b of bodies) {
    ctx.save();
    ctx.strokeStyle = '#c23b2c';
    ctx.lineWidth = 2.4;
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(X(b.x) - r, Z(b.z) - r);
    ctx.lineTo(X(b.x) + r, Z(b.z) + r);
    ctx.moveTo(X(b.x) + r, Z(b.z) - r);
    ctx.lineTo(X(b.x) - r, Z(b.z) + r);
    ctx.stroke();
    ctx.restore();
  }

  for (const m of markers) {
    ctx.save();
    ctx.globalAlpha = m.alive ? 1 : 0.3;
    ctx.fillStyle = m.color;
    ctx.strokeStyle = '#2c2b33';
    ctx.lineWidth = m.you ? 2.5 : 1.4;
    ctx.beginPath();
    ctx.arc(X(m.x), Z(m.z), m.you ? 6 : 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (m.you) {
      ctx.beginPath();
      ctx.arc(X(m.x), Z(m.z), 10, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}

export const POI = { STATIONS, VENTS, BREAKERS, REACTOR_PANELS };
