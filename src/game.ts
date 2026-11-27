import * as THREE from 'three';
import {
  BREAKERS,
  BUTTON,
  REACTOR_PANELS,
  STATIONS,
  VENTS,
  hitsWall,
  moveWithCollision,
} from './shared/map';
import type { ClientMsg, PlayerSnap, ServerMsg, Snapshot } from './shared/protocol';
import { World, type Highlight } from './render/world';
import type { UI } from './ui';
import { sfx } from './audio';
import type { Link } from './net';

const TASK_RANGE = 2.7;
const BODY_RANGE = 2.5;
const KILL_RANGE = 2.3;
const USE_RANGE = 2.1;
const SPEED = 3.6;
const GHOST_SPEED = 5.4;

interface Interactable {
  kind: 'task' | 'report' | 'kill' | 'vent' | 'panel' | 'breaker' | 'button';
  id: string;
  x: number;
  z: number;
  label: string;
  taskId?: string;
  vent?: number;
}

export class Game {
  world: World;
  ui: UI;
  link: Link | null = null;
  snap: Snapshot | null = null;
  youId = '';
  local = { x: 21, z: 17, dir: Math.PI, moving: false };
  private keys = new Set<string>();
  private stick = { x: 0, y: 0, active: false };
  private sendAcc = 0;
  private lastPhase = '';
  private candidate: Interactable | null = null;
  private clock = 0;
  private lastTime = performance.now();
  private promptKey = '';
  private immediateCam = true;

  constructor(world: World, ui: UI) {
    this.world = world;
    this.ui = ui;
    this.bindInput();
    requestAnimationFrame(this.loop);
  }

  attach(link: Link) {
    this.link?.close();
    this.link = link;
    link.onMessage((msg) => this.onMessage(msg));
  }

  detach() {
    this.link?.close();
    this.link = null;
    this.snap = null;
    this.youId = '';
    this.promptKey = '';
    this.world.syncPlayers([], '', 0);
    this.world.syncBodies([]);
    this.world.setHighlight([]);
    document.body.classList.remove('lights-out', 'reactor');
  }

  command(msg: ClientMsg) {
    this.send(msg);
  }

  private send(msg: ClientMsg) {
    this.link?.send(msg);
  }

  private onMessage(msg: ServerMsg) {
    if (msg.t === 'welcome') {
      this.youId = msg.id;
      return;
    }
    if (msg.t === 'state') {
      const prev = this.snap;
      this.snap = msg;
      if (!this.youId) this.youId = msg.youId;
      const me = msg.players.find((p) => p.id === msg.youId);
      if (me) {
        const far = Math.hypot(me.x - this.local.x, me.z - this.local.z) > 2.5;
        const forced = msg.phase !== 'play';
        if (forced || far || !prev || prev.phase !== msg.phase) {
          this.local.x = me.x;
          this.local.z = me.z;
          this.immediateCam = true;
        }
        if (msg.phase !== 'play') this.ui.closeTask();
        if (!me.alive) this.ui.closeTask();
        if (prev) {
          const wasAlive = prev.players.find((p) => p.id === msg.youId)?.alive;
          if (wasAlive && !me.alive && msg.phase !== 'lobby') {
            this.ui.showIntro('YOU WERE ERASED', 'your drawing is now a ghost — fly around and watch', 'impostor');
            sfx.whoosh();
          }
        }
        if (prev && prev.phase !== msg.phase) {
          if (msg.phase === 'play' && prev.phase === 'lobby') {
            this.ui.showIntro(
              msg.youRole === 'impostor' ? 'YOU HOLD THE ERASER' : 'YOU ARE A DRAWING',
              msg.youRole === 'impostor'
                ? 'erase the crew, vent away, and sabotage the ship. E to erase'
                : 'finish your tasks and vote out the eraser. WASD to move, E to use',
              msg.youRole === 'impostor' ? 'impostor' : 'crew',
              4800,
            );
          }
          if (msg.phase === 'play' && (prev.phase === 'eject' || prev.phase === 'reveal')) {
            this.ui.showIntro('BACK TO THE PAGE', 'sabotage is reset — keep drawing', 'info', 2200);
          }
        }
      }
      this.handlePhase(prev?.phase ?? '', msg.phase);
      return;
    }
    if (msg.t === 'event') {
      switch (msg.kind) {
        case 'kill':
          this.world.burst(msg.x, msg.z, msg.color, 'kill');
          setTimeout(() => this.world.burst(msg.x, msg.z, '#c33a2c', 'kill'), 90);
          sfx.kill();
          break;
        case 'vent':
          this.world.burst(msg.x, msg.z, '#8b8578', 'vent');
          sfx.whoosh();
          break;
        case 'sabotage':
          sfx.alarm();
          break;
        case 'fix':
          sfx.tick();
          break;
        case 'taskdone':
          this.world.burst(msg.x, msg.z, '#4fae6a', 'task');
          break;
        case 'meeting':
          sfx.alarm();
          break;
        case 'vote':
          sfx.tick();
          break;
        case 'eject':
          sfx.whoosh();
          this.world.burst(msg.x, msg.z, msg.role === 'impostor' ? '#c33a2c' : '#8b8578', 'vent');
          break;
        case 'win':
          sfx.win(msg.team);
          break;
        case 'start':
          sfx.join();
          break;
        case 'chime':
          if (msg.tone === 'task') sfx.task();
          else if (msg.tone === 'impostor') sfx.alarm();
          else if (msg.tone === 'join') sfx.join();
          else if (msg.tone === 'click') sfx.tick();
          else sfx.tick();
          break;
      }
    }
  }

  private handlePhase(prev: string, next: string) {
    if (prev === next) return;
    if (next === 'meeting' || next === 'vote') {
      this.ui.closeTask();
      sfx.alarm();
    }
    if (next === 'play' && (prev === 'eject' || prev === 'reveal')) {
      this.immediateCam = true;
    }
    this.lastPhase = next;
  }

  // -------------------------------------------------------------------------
  // input
  // -------------------------------------------------------------------------

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === 'e' || k === ' ') this.use();
      if (k === 'tab') {
        e.preventDefault();
        this.ui.setMap(!this.ui.isMapOpen);
      }
      if (k === 'q' && this.snap?.youRole === 'impostor') this.toggleSaboMenu();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // virtual stick
    const stick = document.getElementById('stick')!;
    const nub = stick.querySelector('.nub') as HTMLElement;
    let id: number | null = null;
    const setFrom = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const max = r.width / 2;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.stick.x = dx / max;
      this.stick.y = dy / max;
      this.stick.active = Math.hypot(this.stick.x, this.stick.y) > 0.15;
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      setFrom(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (id === e.pointerId) setFrom(e);
    });
    const reset = () => {
      id = null;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
      nub.style.transform = 'translate(0,0)';
    };
    stick.addEventListener('pointerup', reset);
    stick.addEventListener('pointercancel', reset);
  }

  private toggleSaboMenu() {
    document.getElementById('sabo-menu')?.classList.toggle('hidden');
  }

  // -------------------------------------------------------------------------
  // interaction
  // -------------------------------------------------------------------------

  private computeCandidate(): Interactable | null {
    const snap = this.snap;
    if (!snap || snap.phase !== 'play') return null;
    const me = snap.players.find((p) => p.id === this.youId);
    if (!me || !me.alive) return null;
    const { x, z } = this.local;
    const isImp = snap.youRole === 'impostor';

    // bodies first — always the most urgent
    for (const b of snap.bodies) {
      if (Math.hypot(b.x - x, b.z - z) < BODY_RANGE) {
        return { kind: 'report', id: b.id, x: b.x, z: b.z, label: 'REPORT BODY' };
      }
    }
    if (isImp && snap.killCooldown <= 0.01) {
      let best: PlayerSnap | null = null;
      let bd = KILL_RANGE;
      for (const p of snap.players) {
        if (p.id === me.id || !p.alive || p.role === 'impostor') continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) return { kind: 'kill', id: best.id, x: best.x, z: best.z, label: `ERASE ${best.name.toUpperCase()}` };
    }
    if (me.alive && snap.tasks.length) {
      for (const t of snap.tasks) {
        if (t.done) continue;
        if (Math.hypot(t.x - x, t.z - z) < TASK_RANGE) {
          return { kind: 'task', id: t.id, taskId: t.id, x: t.x, z: t.z, label: t.name };
        }
      }
    }
    if (snap.sabotage?.kind === 'reactor') {
      for (const p of REACTOR_PANELS) {
        if (Math.hypot(p.x - x, p.z - z) < USE_RANGE) {
          const done = snap.sabotage.done?.includes(p.id) ?? false;
          return { kind: 'panel', id: `panel${p.id}`, x: p.x, z: p.z, label: done ? 'PANEL OK' : 'STABILISE REACTOR' };
        }
      }
    }
    if (snap.sabotage?.kind === 'lights') {
      for (const b of BREAKERS) {
        if (Math.hypot(b.x - x, b.z - z) < USE_RANGE) {
          return { kind: 'breaker', id: `breaker${b.id}`, x: b.x, z: b.z, label: 'FLIP BREAKER' };
        }
      }
    }
    if (Math.hypot(BUTTON.x - x, BUTTON.z - z) < 2.6) {
      return { kind: 'button', id: 'button', x: BUTTON.x, z: BUTTON.z, label: 'EMERGENCY BUTTON' };
    }
    if (isImp) {
      for (const v of VENTS) {
        if (Math.hypot(v.x - x, v.z - z) < USE_RANGE + 0.3) {
          return { kind: 'vent', id: `vent${v.id}`, x: v.x, z: v.z, label: 'VENT', vent: v.id };
        }
      }
    }
    return null;
  }

  use() {
    const c = this.candidate;
    if (!c) return;
    if (this.ui.taskOpen) return;
    switch (c.kind) {
      case 'task': {
        const task = this.snap?.tasks.find((t) => t.id === c.taskId);
        if (!task) return;
        this.ui.openTask(task, (id) => this.send({ t: 'task', id }));
        break;
      }
      case 'report':
        this.send({ t: 'report', body: c.id });
        sfx.click();
        break;
      case 'kill':
        this.send({ t: 'kill', target: c.id });
        break;
      case 'vent':
        this.send({ t: 'vent', vent: nextVent(c.vent ?? 0) });
        break;
      case 'panel':
        this.send({ t: 'reactorPanel', panel: Number(c.id.replace('panel', '')) });
        break;
      case 'breaker':
        this.send({ t: 'fixLights', breaker: Number(c.id.replace('breaker', '')) });
        break;
      case 'button':
        this.send({ t: 'button' });
        sfx.alarm();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // loop
  // -------------------------------------------------------------------------

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += dt;
    this.tick(dt);
    requestAnimationFrame(this.loop);
  };

  private tick(dt: number) {
    const snap = this.snap;
    if (!snap) {
      this.world.follow(21, 16.5, dt, false);
      this.world.update(dt);
      return;
    }
    if (snap.phase === 'lobby') {
      if (this.ui.current !== 'lobby') {
        this.ui.show('lobby');
        this.ui.closeTask();
      }
      this.ui.renderLobby(snap, this.youId);
      this.world.syncPlayers(snap.players, this.youId, dt);
      this.world.syncBodies([]);
      this.world.setHighlight([]);
      this.world.follow(21, 16.5, dt, false);
      this.world.update(dt);
      return;
    }
    if (this.ui.current !== 'hud') this.ui.show('hud');
    document.body.classList.toggle('lights-out', snap.sabotage?.kind === 'lights' && snap.youRole !== 'impostor');
    document.body.classList.toggle('reactor', snap.sabotage?.kind === 'reactor');
    const me = snap.players.find((p) => p.id === this.youId);
    const canMove = snap.phase === 'play' && !this.ui.taskOpen;
    const ghost = !me?.alive;

    let mx = 0;
    let mz = 0;
    if (canMove) {
      if (this.keys.has('w') || this.keys.has('arrowup')) mz -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) mz += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
      mx += this.stick.x;
      mz += this.stick.y;
    }
    if (mx || mz) {
      // move relative to what the camera shows
      const fwd = new THREE.Vector3();
      this.world.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const wish = new THREE.Vector3()
        .addScaledVector(fwd, -mz)
        .addScaledVector(right, mx);
      mx = wish.x;
      mz = wish.z;
    }
    const len = Math.hypot(mx, mz);
    const moving = len > 0.08;
    if (moving) {
      mx /= len;
      mz /= len;
      const speed = ghost ? GHOST_SPEED : SPEED;
      const step = speed * dt;
      if (ghost) {
        this.local.x += mx * step;
        this.local.z += mz * step;
      } else {
        const res = moveWithCollision(this.local.x, this.local.z, mx * step, mz * step, 0.4);
        this.local.x = res.x;
        this.local.z = res.z;
      }
      this.local.dir = Math.atan2(mx, mz);
    }
    this.local.moving = moving;
    // keep inside the page even as a ghost
    this.local.x = Math.max(2, Math.min(42, this.local.x));
    this.local.z = Math.max(2, Math.min(30, this.local.z));

    this.sendAcc += dt;
    if (this.sendAcc >= 0.07) {
      this.sendAcc = 0;
      if (canMove) {
        this.send({ t: 'move', x: this.local.x, z: this.local.z, dir: this.local.dir, moving });
      }
    }

    // camera focus
    const focusX = snap.phase === 'meeting' || snap.phase === 'vote' || snap.phase === 'reveal' || snap.phase === 'eject' ? 21 : this.local.x;
    const focusZ = snap.phase === 'meeting' || snap.phase === 'vote' || snap.phase === 'reveal' || snap.phase === 'eject' ? 16.5 : this.local.z;
    this.world.follow(focusX, focusZ, dt, this.immediateCam);
    this.immediateCam = false;

    // entities
    const players = snap.players.map((p) =>
      p.id === this.youId ? { ...p, x: this.local.x, z: this.local.z, dir: this.local.dir, moving } : p,
    );
    this.world.syncPlayers(players, this.youId, dt);
    this.world.syncBodies(snap.bodies);

    this.candidate = this.computeCandidate();
    const highlights: Highlight[] = [];
    if (this.candidate) highlights.push({ kind: this.candidate.kind as Highlight['kind'], x: this.candidate.x, z: this.candidate.z });
    if (snap.phase === 'play' && me?.alive) {
      for (const t of snap.tasks) {
        if (!t.done && Math.hypot(t.x - this.local.x, t.z - this.local.z) < 6) {
          highlights.push({ kind: 'task', x: t.x, z: t.z });
        }
      }
      if (snap.youRole === 'impostor') {
        for (const p of snap.players) {
          if (p.alive && p.id !== me.id && p.role !== 'impostor' && Math.hypot(p.x - this.local.x, p.z - this.local.z) < 5) {
            highlights.push({ kind: 'kill', x: p.x, z: p.z });
          }
        }
      }
    }
    this.world.setHighlight(highlights);
    this.world.setStationDone(new Set(snap.tasks.filter((t) => t.done).map((t) => t.id)));

    // hud / prompt only when relevant fields change
    const prompt = this.candidate ? { label: this.candidate.label, enabled: true } : null;
    const key = `${prompt?.label ?? ''}|${snap.phase}|${snap.timer}|${snap.taskProgress}|${snap.feed.length}|${
      snap.votes ? Object.keys(snap.votes).length : 0
    }|${snap.sabotage?.timer.toFixed(1) ?? ''}|${snap.killCooldown.toFixed(1)}|${snap.players
      .map((p) => `${p.name}${p.alive ? 'a' : 'd'}${p.voted ?? ''}${p.color}${p.host ? 'h' : ''}`)
      .join('')}|${snap.tasks.filter((t) => !t.done).length}|${snap.youRole}|${snap.hostId}|${
      snap.result?.ejectedId ?? ''
    }`;
    if (key !== this.promptKey) {
      this.promptKey = key;
      this.ui.renderHud(snap, this.youId, prompt);
    }
    this.ui.drawMap(snap, this.youId);
    this.world.update(dt);
  }

  get localPos() {
    return this.local;
  }
}

function nextVent(from: number) {
  const sorted = VENTS.map((v) => v.id).sort((a, b) => a - b);
  const i = sorted.indexOf(from);
  return sorted[(i + 1) % sorted.length];
}

export { STATIONS, hitsWall };
