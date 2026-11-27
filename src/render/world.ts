import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BREAKERS,
  CORRIDORS,
  REACTOR_PANELS,
  ROOMS,
  STATIONS,
  VENTS,
  BUTTON,
  WORLD,
  WORLD_H,
  WORLD_W,
  againstWall,
  boundarySegments,
} from '../shared/map';
import type { BodySnap, PlayerSnap } from '../shared/protocol';
import {
  makeBodySprite,
  makeCharacterSheet,
  makeConsoleScreen,
  makeFloorTexture,
  makeIconSprite,
  makeLabel,
  makeWallTexture,
  rand,
  randRange,
} from './textures';

const GRAPHITE = 0x2c2b33;
const WALL_H = 1.35;
const WALL_T = 0.16;

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.translate(64, 64);
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 40;
    ctx.globalAlpha = 0.06 + Math.random() * 0.06;
    ctx.strokeStyle = '#1d1c22';
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.34);
    ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.42);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const ringTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#2c2b33';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass === 0 ? 0.9 : 0.4;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = 104 + Math.sin(a * 5) * 4 + randRange(-2, 2);
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r * 0.62;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2c2b33';
  ctx.beginPath();
  ctx.arc(16, 16, 11, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
})();

/** Hand-drawn "boil": wobble line work a little every frame. */
function boil(mat: THREE.LineBasicMaterial, uniform: { value: number }, amount = 0.012) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBoil = uniform;
    shader.vertexShader = `uniform float uBoil;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.x += sin(uBoil * 5.0 + transformed.y * 3.0 + transformed.z * 2.0) * ${amount.toFixed(3)};
       transformed.z += cos(uBoil * 4.0 + transformed.x * 2.0) * ${amount.toFixed(3)};`,
    );
  };
  mat.needsUpdate = true;
  return mat;
}

function sketchEdges(geo: THREE.BufferGeometry, jitter = 0.02): THREE.BufferGeometry {
  const edges = new THREE.EdgesGeometry(geo, 20);
  const pos = edges.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i++) arr[i] += (Math.random() - 0.5) * jitter * 2;
  pos.needsUpdate = true;
  return edges;
}

interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface Highlight {
  kind: 'task' | 'vent' | 'button' | 'panel' | 'breaker' | 'report' | 'kill';
  x: number;
  z: number;
}

interface PlayerView {
  group: THREE.Group;
  body: THREE.Mesh;
  label: THREE.Sprite;
  shadow: THREE.Mesh;
  frames: THREE.Texture[];
  ghostFrames: THREE.Texture[];
  material: THREE.MeshBasicMaterial;
  labelTex: THREE.CanvasTexture;
  tx: number;
  tz: number;
  dir: number;
  moving: boolean;
  walkTime: number;
  alive: boolean;
  role?: string;
  name: string;
  color: string;
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private camPos = new THREE.Vector3();
  private camSnap = true;
  private clock = new THREE.Clock();
  private playerViews = new Map<string, PlayerView>();
  private bodyViews = new Map<string, THREE.Group>();
  private localId = '';
  private camTarget = new THREE.Vector3(21, 0, 16.5);
  private highlights: THREE.Group;
  private particles: THREE.Points;
  private particleData: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  private particleColors: Float32Array;
  private particlePositions: Float32Array;
  private maxParticles = 220;
  private stationMarkers = new Map<string, THREE.Sprite>();
  private time = 0;
  private boilUniform = { value: 0 };
  private paperGroup = new THREE.Group();
  private labels: THREE.Sprite[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 400);
    this.camera.position.set(25, 14, 28);

    this.scene.background = new THREE.Color('#efe9da');
    this.scene.fog = new THREE.Fog('#efe9da', 44, 92);

    const hemi = new THREE.HemisphereLight(0xfffdf5, 0xd8d0bf, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff6e2, 1.1);
    dir.position.set(-14, 26, 10);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    fill.position.set(18, 12, -22);
    this.scene.add(fill);

    this.buildPaper();
    this.buildFloor();
    this.buildWalls();
    this.buildProps();

    this.highlights = new THREE.Group();
    this.scene.add(this.highlights);

    const pGeo = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.22,
        map: dotTex,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.2,
        depthWrite: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    window.addEventListener('resize', () => this.resize());
  }

  private buildPaper() {
    // the desk the notebook sits on
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e3dbc9';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      ctx.globalAlpha = Math.random() * 0.08;
      ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#9b8f78';
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 12);
    t.colorSpace = THREE.SRGBColorSpace;
    const desk = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshBasicMaterial({ map: t, color: 0xf0ebdd }),
    );
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -0.12;
    this.scene.add(desk);
    this.paperGroup.add(desk);
  }

  private buildFloor() {
    const tex = makeFloorTexture();
    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_H);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(WORLD.minX + WORLD_W / 2, 0, WORLD.minZ + WORLD_H / 2);
    this.scene.add(floor);

    // torn paper edge around the page
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W + 1.4, WORLD_H + 1.4),
      new THREE.MeshBasicMaterial({ color: 0xfdfaf0 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(WORLD.minX + WORLD_W / 2, -0.04, WORLD.minZ + WORLD_H / 2);
    this.scene.add(edge);
  }

  private buildWalls() {
    const segs = boundarySegments();
    const wallTex = makeWallTexture();
    wallTex.repeat.set(1, 1);
    const boxes: THREE.BufferGeometry[] = [];
    const edgeGeos: THREE.BufferGeometry[] = [];
    for (const s of segs) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      if (len < 0.01) continue;
      const cx = (s.x1 + s.x2) / 2;
      const cz = (s.z1 + s.z2) / 2;
      const horizontal = Math.abs(s.x2 - s.x1) > Math.abs(s.z2 - s.z1);
      const geo = new THREE.BoxGeometry(horizontal ? len : WALL_T, WALL_H, horizontal ? WALL_T : len);
      // tile the hatch texture according to wall length
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      const scaleU = (horizontal ? len : WALL_T) * 1.1;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, scaleU), uv.getY(i) * WALL_H * 0.9);
      geo.translate(cx, WALL_H / 2, cz);
      boxes.push(geo);
      const e = sketchEdges(geo, 0.012);
      edgeGeos.push(e);
    }
    const merged = mergeGeometries(boxes, false);
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshLambertMaterial({ map: wallTex, color: 0xf1ece0, side: THREE.DoubleSide }),
      );
      this.scene.add(mesh);
    }
    const mergedEdges = mergeGeometries(edgeGeos, false);
    if (mergedEdges) {
      const lines = new THREE.LineSegments(
        mergedEdges,
        boil(new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.55 }), this.boilUniform, 0.01),
      );
      this.scene.add(lines);
    }
    // a second, fainter pass of the same contours = pencil double-stroke
    if (mergedEdges) {
      const ghost = new THREE.LineSegments(
        mergedEdges.clone(),
        new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.16 }),
      );
      ghost.position.y = 0.02;
      this.scene.add(ghost);
    }
  }

  private prop(x: number, z: number, w: number, h: number, d: number, rot = 0, color = 0xf6f1e4) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.rotation.y = rot;
    this.scene.add(mesh);
    const edges = new THREE.LineSegments(
      sketchEdges(geo, 0.01),
      boil(new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.7 }), this.boilUniform, 0.008),
    );
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    this.scene.add(edges);
    return mesh;
  }

  private buildProps() {
    // ---- task consoles -----------------------------------------------------
    for (const s of STATIONS) {
      const placed = againstWall(s.x, s.z, 0.8);
      const standX = placed.x;
      const standZ = placed.z;
      const g = this.prop(standX, standZ, 1.5, 0.95, 0.8, s.facing, 0xf8f4e9);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.62),
        new THREE.MeshBasicMaterial({ map: makeConsoleScreen(s.name.split(' ')[0]) }),
      );
      screen.position.set(0, 0.24, 0.405);
      g.add(screen);
      const legs = this.prop(standX, standZ, 1.2, 0.12, 0.6, s.facing, 0xe8e1d0);
      legs.position.y = 0.06;
      const marker = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeIconSprite('task'),
          transparent: true,
          depthTest: false,
          opacity: 0.85,
        }),
      );
      marker.position.set(standX, 1.9, standZ);
      marker.scale.set(0.55, 0.55, 1);
      this.scene.add(marker);
      this.stationMarkers.set(s.id, marker);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeLabel(s.name), transparent: true, opacity: 0.55, depthTest: false }),
      );
      label.position.set(standX, 2.35, standZ);
      label.scale.set(3.1, 0.97, 1);
      this.scene.add(label);
      this.labels.push(label);
    }

    // ---- vents -------------------------------------------------------------
    for (const v of VENTS) {
      const base = this.prop(v.x, v.z, 1.25, 0.07, 0.85, 0, 0xe6dfcd);
      base.position.y = 0.035;
      for (let i = -1; i <= 1; i++) {
        const bar = this.prop(v.x, v.z + i * 0.22, 1.0, 0.02, 0.08, 0, 0x8f887a);
        bar.position.y = 0.08;
      }
    }

    // ---- emergency button --------------------------------------------------
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.95, 0.35, 12),
      new THREE.MeshLambertMaterial({ color: 0xf2ecdd }),
    );
    base.position.set(BUTTON.x, 0.17, BUTTON.z);
    this.scene.add(base);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xd6503c }),
    );
    dome.position.set(BUTTON.x, 0.34, BUTTON.z);
    this.scene.add(dome);
    const btnLabel = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeLabel('EMERGENCY', '#d6503c'), transparent: true, depthTest: false, opacity: 0.8 }),
    );
    btnLabel.position.set(BUTTON.x, 1.9, BUTTON.z);
    btnLabel.scale.set(2.8, 0.87, 1);
    this.scene.add(btnLabel);
    this.labels.push(btnLabel);

    // ---- reactor panels & breakers ----------------------------------------
    for (const p of REACTOR_PANELS) {
      const pl = againstWall(p.x, p.z, 0.7);
      const box = this.prop(pl.x, pl.z, 1.3, 1.25, 0.5, 0, 0xded6c3);
      const icon = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeIconSprite('panel'), transparent: true, depthTest: false, opacity: 0.8 }),
      );
      icon.position.set(p.x, 2.1, p.z);
      box.position.x = pl.x;
      box.position.z = pl.z;
      icon.scale.set(0.7, 0.7, 1);
      this.scene.add(icon);
      this.labels.push(icon);
      void box;
    }
    for (const b of BREAKERS) {
      const bl = againstWall(b.x, b.z, 0.6);
      this.prop(bl.x, bl.z, 0.8, 1.1, 0.35, 0, 0xe4dccb);
      const icon = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeIconSprite('breaker'), transparent: true, depthTest: false, opacity: 0.75 }),
      );
      icon.position.set(b.x, 1.9, b.z);
      icon.scale.set(0.6, 0.6, 1);
      this.scene.add(icon);
      this.labels.push(icon);
    }

    // ---- set dressing ------------------------------------------------------
    // cafeteria table
    this.prop(21, 13.6, 4.4, 0.55, 1.5, 0, 0xf7f2e3);
    for (const [x, z] of [
      [19.4, 15.4],
      [22.6, 15.4],
      [19.4, 12.0],
      [22.6, 12.0],
      [21, 16.2],
    ] as const) {
      this.prop(x, z, 0.62, 0.45, 0.62, randRange(0, 1), 0xf2ead7);
    }
    // storage crates
    for (const [x, z, s] of [
      [34.2, 11.2, 1.1],
      [36.6, 10.8, 0.9],
      [38.6, 12.6, 1.2],
      [34.4, 17.4, 1.0],
      [39.2, 15.0, 0.85],
    ] as const) {
      const c = this.prop(x, z, s, s, s, randRange(0, 0.6), 0xefe7d4);
      const hatch = new THREE.LineSegments(
        sketchEdges(c.geometry, 0.02),
        new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.5 }),
      );
      hatch.position.copy(c.position);
      hatch.rotation.copy(c.rotation);
      this.scene.add(hatch);
    }
    // engines
    for (const [x, z] of [
      [4.2, 8.2],
      [4.2, 13.0],
      [4.2, 19.2],
      [4.2, 24.0],
    ] as const) {
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 1.6, 14),
        new THREE.MeshLambertMaterial({ color: 0xf1e9d6 }),
      );
      cyl.rotation.z = Math.PI / 2;
      cyl.position.set(x, 0.85, z);
      this.scene.add(cyl);
      const e = new THREE.LineSegments(
        sketchEdges(cyl.geometry, 0.02),
        new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.6 }),
      );
      e.position.copy(cyl.position);
      e.rotation.copy(cyl.rotation);
      this.scene.add(e);
    }
    // medbay beds
    for (const [x, z] of [
      [17.2, 7.8],
      [19.6, 7.8],
      [22.0, 7.8],
    ] as const) {
      this.prop(x, z, 2.0, 0.45, 0.9, 0, 0xf9f5ea);
      this.prop(x, z - 0.7, 0.9, 0.7, 0.6, 0, 0xece4d1);
    }
    // reactor core
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 1.9, 16),
      new THREE.MeshLambertMaterial({ color: 0xe9e1cd }),
    );
    core.position.set(21, 0.95, 26.6);
    this.scene.add(core);
    const coreEdges = new THREE.LineSegments(
      sketchEdges(core.geometry, 0.02),
      new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.65 }),
    );
    coreEdges.position.copy(core.position);
    this.scene.add(coreEdges);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x7fd6c0, transparent: true, opacity: 0.35 }),
    );
    glow.position.set(21, 2.1, 26.6);
    this.scene.add(glow);
    this.coreGlow = glow;
    // posters in rooms
    for (const [x, z, rot, txt] of [
      [16.6, 12.6, 0, 'NO ERASING'],
      [27.4, 20.4, Math.PI, 'SAFETY FIRST'],
      [35.0, 14.6, 0, 'BOXES'],
      [19.0, 4.2, Math.PI, 'MEDBAY'],
    ] as const) {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.0),
        new THREE.MeshBasicMaterial({ map: makeLabel(txt), transparent: true, opacity: 0.75 }),
      );
      p.position.set(x, 1.15, z);
      p.rotation.y = rot;
      this.scene.add(p);
    }
  }

  coreGlow: THREE.Mesh | null = null;

  // -------------------------------------------------------------------------
  // characters
  // -------------------------------------------------------------------------

  private sheetCache = new Map<string, { frames: THREE.Texture[]; ghost: THREE.Texture[] }>();

  private sheets(color: string) {
    let s = this.sheetCache.get(color);
    if (!s) {
      s = makeCharacterSheet(color);
      this.sheetCache.set(color, s);
    }
    return s;
  }

  syncPlayers(players: PlayerSnap[], localId: string, dt: number) {
    this.localId = localId;
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let view = this.playerViews.get(p.id);
      if (!view) view = this.createPlayerView(p);
      view.tx = p.x;
      view.tz = p.z;
      view.dir = p.dir;
      view.moving = p.moving && p.alive;
      view.alive = p.alive;
      view.role = p.role;
      if (view.name !== p.name || view.color !== p.color) {
        view.name = p.name;
        view.color = p.color;
        view.label.material.map?.dispose();
        const isImp = p.role === 'impostor';
        view.label.material.map = makeLabel(p.name.toUpperCase(), p.color, isImp ? 'impostor' : undefined);
        view.label.material.needsUpdate = true;
        if (isImp) (view.label.material as THREE.SpriteMaterial).color.set('#c33a2c');
        else (view.label.material as THREE.SpriteMaterial).color.set('#ffffff');
      }
      if (p.role === 'impostor') {
        (view.label.material as THREE.SpriteMaterial).color.set('#c33a2c');
      }
    }
    for (const [id, view] of this.playerViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.group);
        this.playerViews.delete(id);
      }
    }
    // animation & interpolation
    for (const [id, view] of this.playerViews) {
      const snap = players.find((p) => p.id === id)!;
      if (!snap) continue;
      const lerp = id === this.localId ? 1 : Math.min(1, dt * 14);
      const cur = view.group.position;
      cur.x += (view.tx - cur.x) * lerp;
      cur.z += (view.tz - cur.z) * lerp;
      if (view.moving) view.walkTime += dt;
      const frame = view.moving ? Math.floor(view.walkTime * 8) % 4 : 0;
      const tex = view.alive ? view.frames[frame] : view.ghostFrames[frame];
      if (view.material.map !== tex) {
        view.material.map = tex;
        view.material.needsUpdate = true;
      }
      view.group.position.y = view.alive ? 0 : 0.35;
      view.material.opacity = view.alive ? 1 : 0.8;
      view.shadow.visible = view.alive;
      // labels only for yourself, teammates, and in meetings
      const showLabel = id === this.localId || snap.role === 'impostor';
      view.label.visible = showLabel;
      // hide yourself from the camera? keep visible, it's a diorama
      const bob = view.moving && view.alive ? Math.sin(view.walkTime * 16) * 0.03 : 0;
      view.body.position.y = 0.74 + bob;
    }
  }

  private createPlayerView(p: PlayerSnap): PlayerView {
    const group = new THREE.Group();
    const sheets = this.sheets(p.color);
    const material = new THREE.MeshBasicMaterial({
      map: sheets.frames[0],
      transparent: true,
      alphaTest: 0.08,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.boilUniform;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.x += sin(uTime * 7.0 + transformed.y * 9.0 + transformed.x * 11.0) * 0.012;
         transformed.y += cos(uTime * 6.0 + transformed.x * 9.0) * 0.008;`,
      );
    };
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.54), material);
    body.position.y = 0.74;
    body.renderOrder = 2;
    group.add(body);

    const labelMat = new THREE.SpriteMaterial({
      map: makeLabel(p.name.toUpperCase(), p.color, p.role === 'impostor' ? 'impostor' : undefined),
      transparent: true,
      depthTest: true,
      opacity: 0.95,
    });
    labelMat.color.set(p.role === 'impostor' ? '#c33a2c' : '#ffffff');
    const label = new THREE.Sprite(labelMat);
    label.position.set(0, 1.8, 0);
    label.scale.set(2.3, 0.72, 1);
    label.renderOrder = 5;
    group.add(label);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.0),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    group.position.set(p.x, 0, p.z);
    this.scene.add(group);
    const view: PlayerView = {
      group,
      body,
      label,
      shadow,
      frames: sheets.frames,
      ghostFrames: sheets.ghost,
      material,
      labelTex: labelMat.map as THREE.CanvasTexture,
      tx: p.x,
      tz: p.z,
      dir: p.dir,
      moving: false,
      walkTime: Math.random() * 4,
      alive: p.alive,
      name: p.name,
      color: p.color,
    };
    this.playerViews.set(p.id, view);
    return view;
  }

  syncBodies(bodies: BodySnap[]) {
    const seen = new Set<string>();
    for (const b of bodies) {
      seen.add(b.id);
      if (this.bodyViews.has(b.id)) continue;
      const group = new THREE.Group();
      const tex = new THREE.CanvasTexture(makeBodySprite(b.color));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 1.45),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
      );
      mesh.position.y = 0.5;
      group.add(mesh);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeIconSprite('exclaim'), transparent: true, depthTest: false, opacity: 0.9 }),
      );
      sprite.position.set(0, 1.9, 0);
      sprite.scale.set(0.6, 0.6, 1);
      group.add(sprite);
      group.position.set(b.x, 0, b.z);
      group.rotation.y = randRange(-0.5, 0.5);
      this.scene.add(group);
      this.bodyViews.set(b.id, group);
    }
    for (const [id, g] of this.bodyViews) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.bodyViews.delete(id);
      }
    }
  }

  setHighlight(list: Highlight[]) {
    // rebuild the ring pool lazily; at most a handful on screen
    while (this.highlights.children.length < list.length) {
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.highlights.add(ring);
    }
    this.highlights.children.forEach((child, i) => {
      const h = list[i];
      child.visible = !!h;
      if (!h) return;
      child.position.set(h.x, 0.06, h.z);
      const s = h.kind === 'kill' ? 1.15 : h.kind === 'report' ? 0.9 : 1;
      child.userData.baseScale = s;
      child.scale.setScalar(s);
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.set(h.kind === 'kill' ? '#c33a2c' : h.kind === 'report' ? '#b8862f' : '#2c2b33');
    });
  }

  setStationDone(doneIds: Set<string>) {
    for (const [id, marker] of this.stationMarkers) {
      const mat = marker.material as THREE.SpriteMaterial;
      const done = doneIds.has(id);
      mat.opacity = done ? 0.18 : 0.85;
      marker.scale.setScalar(done ? 0.4 : 0.55);
    }
  }

  // -------------------------------------------------------------------------
  // particles
  // -------------------------------------------------------------------------

  burst(x: number, z: number, color: string, kind: 'kill' | 'task' | 'vent' | 'star' = 'star') {
    const c = new THREE.Color(color);
    const count = kind === 'kill' ? 46 : kind === 'task' ? 26 : 18;
    for (let i = 0; i < count; i++) {
      if (this.particleData.length >= this.maxParticles) break;
      const a = rand() * Math.PI * 2;
      const sp = kind === 'kill' ? randRange(1.5, 5.5) : randRange(0.8, 2.8);
      this.particleData.push({
        x,
        y: kind === 'vent' ? 0.15 : 0.7 + rand() * 0.6,
        z,
        vx: Math.cos(a) * sp,
        vy: randRange(1.2, 4.2),
        vz: Math.sin(a) * sp,
        life: kind === 'kill' ? randRange(0.5, 1.1) : randRange(0.5, 1.0),
        max: 1.1,
      });
      const idx = this.particleData.length - 1;
      const col = kind === 'kill' ? new THREE.Color('#c33a2c') : c;
      this.particleColors[idx * 3] = col.r;
      this.particleColors[idx * 3 + 1] = col.g;
      this.particleColors[idx * 3 + 2] = col.b;
    }
  }

  private updateParticles(dt: number) {
    let i = 0;
    for (let n = this.particleData.length - 1; n >= 0; n--) {
      const p = this.particleData[n];
      p.life -= dt;
      if (p.life <= 0) {
        this.particleData.splice(n, 1);
        continue;
      }
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
    for (const p of this.particleData) {
      this.particlePositions[i * 3] = p.x;
      this.particlePositions[i * 3 + 1] = p.y;
      this.particlePositions[i * 3 + 2] = p.z;
      i++;
    }
    // park the unused points far away
    for (let n = i; n < this.maxParticles; n++) {
      this.particlePositions[n * 3] = 0;
      this.particlePositions[n * 3 + 1] = -999;
      this.particlePositions[n * 3 + 2] = 0;
    }
    const geo = this.particles.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // camera & frame
  // -------------------------------------------------------------------------

  follow(x: number, z: number, dt: number, immediate = false) {
    if (immediate) {
      this.camTarget.set(x, 0.6, z);
      this.camSnap = true;
    } else {
      this.camTarget.lerp(new THREE.Vector3(x, 0.6, z), Math.min(1, dt * 6));
    }
  }

  update(dt: number) {
    this.time += dt;
    this.boilUniform.value = this.time;
    const sway = Math.sin(this.time * 0.6) * 0.35;
    const sway2 = Math.cos(this.time * 0.47) * 0.25;
    const off = new THREE.Vector3(3.6 + sway, 10.6 + sway2, 9.0 + sway * 0.6);
    const desired = this.camTarget.clone().add(off);
    if (this.camSnap) {
      this.camera.position.copy(desired);
      this.camSnap = false;
    } else {
      this.camera.position.lerp(desired, Math.min(1, dt * 7));
    }
    this.camera.lookAt(this.camTarget.x, 0.2, this.camTarget.z);

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    camRight.y = 0;
    camRight.normalize();
    for (const view of this.playerViews.values()) {
      view.body.quaternion.copy(this.camera.quaternion);
      const side = camRight.x * Math.sin(view.dir) + camRight.z * Math.cos(view.dir);
      view.body.scale.x = side < -0.05 ? -1 : 1;
    }
    for (const [, g] of this.bodyViews) {
      const mesh = g.children[0] as THREE.Mesh;
      mesh.quaternion.copy(this.camera.quaternion);
    }
    // task marker bob
    for (const [id, marker] of this.stationMarkers) {
      void id;
      marker.position.y = 1.9 + Math.sin(this.time * 2 + marker.position.x) * 0.07;
    }
    if (this.coreGlow) {
      const s = 1 + Math.sin(this.time * 3) * 0.08;
      this.coreGlow.scale.setScalar(s);
    }
    // fade far labels so they don't clutter
    for (const l of this.labels) {
      const d = l.position.distanceTo(this.camTarget);
      (l.material as THREE.SpriteMaterial).opacity = Math.max(0.06, 0.5 - d * 0.012);
    }
    this.updateParticles(dt);
    const ringPulse = 1 + Math.sin(this.time * 4) * 0.07;
    for (const ring of this.highlights.children) {
      ring.scale.setScalar((ring.userData.baseScale ?? 1) * ringPulse);
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** world -> screen coords, used for floating DOM tags */
  project(x: number, z: number, y = 1.2) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.container.clientHeight,
      visible: v.z < 1,
    };
  }
}

export { ROOMS, CORRIDORS };
