/**
 * PENCIL SUS — authoritative room simulation.
 *
 * This module is pure TypeScript with no platform APIs so it can run inside a
 * Cloudflare Durable Object, a Node dev server, or the browser (solo mode).
 * The host provides `send` / `broadcast`; the sim does everything else.
 */
import {
  BREAKERS,
  BUTTON,
  PLAYER_COLORS,
  REACTOR_PANELS,
  SPAWNS,
  STATIONS,
  VENTS,
  findPath,
  hitsWall,
  type Station,
} from './map';
import type {
  BodySnap,
  ClientMsg,
  Phase,
  PlayerSnap,
  Role,
  ServerEvent,
  ServerMsg,
  Snapshot,
  TaskInfo,
  VoteResult,
  WinTeam,
} from './protocol';

export interface RoomHost {
  send(playerId: string, msg: ServerMsg): void;
  broadcast(msg: ServerMsg): void;
}

const BOT_NAMES = [
  'Scribbles', 'Doodle', 'Smudge', 'Graphite', 'Ballpoint', 'Stapler', 'Crayon',
  'Ruler', 'Nib', 'Sketch', 'Eraser', 'Sharpie', 'Clip', 'Tape', 'Biro', 'Tracing',
];

const TICK_MS = 90;
const TASKS_PER_PLAYER = 5;
const KILL_COOLDOWN = 18;
const VENT_COOLDOWN = 4;
const SABOTAGE_COOLDOWN = 24;
const REACTOR_TIME = 40;
const MEETING_TIME = 4;
const VOTE_TIME = 20;
const REVEAL_TIME = 5;
const EJECT_TIME = 3.5;
const SPEED = 3.6;
const KILL_RANGE = 2.1;
const USE_RANGE = 1.9;

let idCounter = 0;
function uid(prefix = 'p'): string {
  idCounter++;
  return `${prefix}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface BotBrain {
  path: { x: number; z: number }[];
  station: string | null;
  busy: number;
  repathAt: number;
  idle: number;
  nextSabotage: number;
  voteAt: number;
  target: string | null;
}

interface Body {
  id: string;
  playerId: string;
  name: string;
  color: string;
  x: number;
  z: number;
  t: number;
}

interface Player {
  id: string;
  name: string;
  color: string;
  bot: boolean;
  connected: boolean;
  alive: boolean;
  x: number;
  z: number;
  dir: number;
  moving: boolean;
  role: Role;
  tasks: TaskInfo[];
  voted: string | null;
  killCd: number;
  ventCd: number;
  sabotageCd: number;
  brain: BotBrain | null;
  joinedAt: number;
}

export class RoomSim {
  code: string;
  host: RoomHost;
  phase: Phase = 'lobby';
  timer = 0; // seconds remaining in the current phase
  players = new Map<string, Player>();
  hostId: string | null = null;
  bodies: Body[] = [];
  meeting: { reason: 'body' | 'button'; reporterId: string } | null = null;
  result: VoteResult | null = null;
  winner: WinTeam = null;
  winReason = '';
  sabotage: {
    kind: 'lights' | 'reactor';
    timeLeft: number;
    fixed: boolean[];
  } | null = null;
  feed: { id: number; text: string; tone: string }[] = [];
  feedId = 1;
  impostorCount = 1;
  private tickAcc = 0;
  private lastSnapshot = 0;

  constructor(code: string, host: RoomHost) {
    this.code = code;
    this.host = host;
  }

  // -------------------------------------------------------------------------
  // join / leave
  // -------------------------------------------------------------------------

  addPlayer(name: string, color: string, bot = false, connected = true): Player {
    const used = new Set([...this.players.values()].map((p) => p.color.toLowerCase()));
    let col = color;
    if (used.has(col.toLowerCase())) {
      col = PLAYER_COLORS.find((c) => !used.has(c.toLowerCase())) ?? PLAYER_COLORS[0];
    }
    const spawn = SPAWNS[this.players.size % SPAWNS.length];
    const p: Player = {
      id: uid(bot ? 'b' : 'p'),
      name: (name || 'Doodle').slice(0, 14),
      color: col,
      bot,
      connected,
      alive: false,
      x: spawn.x,
      z: spawn.z,
      dir: Math.PI,
      moving: false,
      role: 'crew',
      tasks: [],
      voted: null,
      killCd: 0,
      ventCd: 0,
      sabotageCd: 0,
      brain: bot
        ? { path: [], station: null, busy: 0, repathAt: 0, idle: 0, nextSabotage: 12, voteAt: 0, target: null }
        : null,
      joinedAt: Date.now(),
    };
    if (bot) {
      const taken = new Set([...this.players.values()].map((x) => x.name));
      p.name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${this.players.size}`;
    }
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    if (this.phase === 'lobby' || this.phase === 'over') {
      p.alive = true;
    } else {
      // joining mid-match: become a paper ghost spectator
      p.alive = false;
      p.role = 'crew';
      p.name = p.name.length > 12 ? p.name.slice(0, 12) : p.name;
    }
    this.pushFeed(`${p.name} joined the page`, 'join');
    return p;
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.bodies = this.bodies.filter((b) => b.playerId !== id);
    if (this.hostId === id) {
      const next = [...this.players.values()].find((x) => !x.bot) ?? [...this.players.values()][0];
      this.hostId = next ? next.id : null;
    }
    this.pushFeed(`${p.name} left`, 'leave');
    if (this.players.size === 0) return;
    if (this.phase === 'play' || this.phase === 'vote') this.checkWin();
  }

  // -------------------------------------------------------------------------
  // messages
  // -------------------------------------------------------------------------

  handle(raw: ClientMsg, playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    switch (raw.t) {
      case 'move': {
        if (this.phase !== 'play') break;
        const dx = Math.abs(raw.x - p.x);
        const dz = Math.abs(raw.z - p.z);
        if (dx > 4 || dz > 4) break; // no teleporting (ghosts may travel freely)
        if (!p.alive || !hitsWall(raw.x, raw.z, 0.36)) {
          p.x = raw.x;
          p.z = raw.z;
        }
        p.dir = raw.dir;
        p.moving = raw.moving;
        break;
      }
      case 'start':
        if (playerId !== this.hostId) break;
        if (this.phase === 'lobby' || this.phase === 'over') this.startGame();
        break;
      case 'addBot':
        if (playerId !== this.hostId || (this.phase !== 'lobby' && this.phase !== 'over')) break;
        if (this.players.size >= 10) break;
        this.addPlayer('', PLAYER_COLORS[this.players.size % PLAYER_COLORS.length], true);
        this.emit({ t: 'event', kind: 'chime', tone: 'join' });
        break;
      case 'kickBot': {
        if (playerId !== this.hostId) break;
        const bot = [...this.players.values()].reverse().find((x) => x.bot);
        if (bot) this.players.delete(bot.id);
        break;
      }
      case 'task':
        this.completeTask(p, raw.id);
        break;
      case 'kill':
        this.doKill(p, raw.target);
        break;
      case 'vent': {
        if (p.role !== 'impostor' || !p.alive || this.phase !== 'play' || p.ventCd > 0) break;
        const near = VENTS.find((v) => Math.hypot(v.x - p.x, v.z - p.z) < USE_RANGE);
        const dest = VENTS.find((v) => v.id === raw.vent);
        if (!near || !dest) break;
        this.emitNear({ t: 'event', kind: 'vent', x: p.x, z: p.z }, p.x, p.z, 8);
        p.x = dest.x;
        p.z = dest.z;
        p.ventCd = VENT_COOLDOWN;
        this.emitNear({ t: 'event', kind: 'vent', x: dest.x, z: dest.z }, p.x, p.z, 8);
        break;
      }
      case 'report': {
        if (!p.alive || this.phase !== 'play') break;
        const body = this.bodies.find((b) => b.id === raw.body);
        if (!body) break;
        if (Math.hypot(body.x - p.x, body.z - p.z) > 2.4) break;
        const idx = this.bodies.indexOf(body);
        this.bodies.splice(idx, 1);
        this.beginMeeting('body', p.id);
        break;
      }
      case 'button': {
        if (!p.alive || this.phase !== 'play') break;
        if (Math.hypot(BUTTON.x - p.x, BUTTON.z - p.z) > 2.6) break;
        this.beginMeeting('button', p.id);
        break;
      }
      case 'vote': {
        if (this.phase !== 'vote' || !p.alive || p.voted) break;
        const target = raw.target;
        if (target !== 'skip') {
          const t = this.players.get(target);
          if (!t || !t.alive || t.id === p.id) break;
        }
        p.voted = target;
        this.emit({ t: 'event', kind: 'vote', from: p.id });
        if ([...this.players.values()].filter((x) => x.alive).every((x) => x.voted)) {
          this.timer = Math.min(this.timer, 1.2);
        }
        break;
      }
      case 'sabotage': {
        if (p.role !== 'impostor' || !p.alive || this.phase !== 'play') break;
        if (this.sabotage || p.sabotageCd > 0) break;
        this.startSabotage(raw.kind, p);
        break;
      }
      case 'fixLights': {
        if (!p.alive || this.sabotage?.kind !== 'lights') break;
        const b = BREAKERS[raw.breaker];
        if (!b || Math.hypot(b.x - p.x, b.z - p.z) > USE_RANGE) break;
        this.sabotage.fixed[raw.breaker] = true;
        this.emit({ t: 'event', kind: 'chime', tone: 'click' });
        if (this.sabotage.fixed.every(Boolean)) this.fixSabotage();
        break;
      }
      case 'reactorPanel': {
        if (!p.alive || this.sabotage?.kind !== 'reactor') break;
        const panel = REACTOR_PANELS[raw.panel];
        if (!panel || Math.hypot(panel.x - p.x, panel.z - p.z) > USE_RANGE) break;
        this.sabotage.fixed[raw.panel] = true;
        this.emit({ t: 'event', kind: 'chime', tone: 'click' });
        if (this.sabotage.fixed.every(Boolean)) this.fixSabotage();
        break;
      }
      case 'restart':
        if (playerId !== this.hostId) break;
        if (this.phase === 'over') this.backToLobby();
        break;
      default:
        break;
    }
  }

  private pushFeed(text: string, tone = 'info') {
    this.feed.push({ id: this.feedId++, text, tone });
    if (this.feed.length > 9) this.feed.shift();
  }

  // -------------------------------------------------------------------------
  // gameplay
  // -------------------------------------------------------------------------

  private startGame() {
    const list = [...this.players.values()];
    if (list.length < 1) return;
    this.bodies = [];
    this.sabotage = null;
    this.result = null;
    this.winner = null;
    this.winReason = '';
    this.meeting = null;
    this.impostorCount = list.length >= 7 ? 2 : 1;
    if (list.length <= 2) this.impostorCount = 1;
    const shuffled = shuffle(list);
    const impostors = new Set(shuffled.slice(0, this.impostorCount).map((p) => p.id));
    const stationPool = STATIONS.map((s) => s.id);
    list.forEach((p, i) => {
      p.alive = true;
      p.role = impostors.has(p.id) ? 'impostor' : 'crew';
      p.voted = null;
      p.killCd = KILL_COOLDOWN;
      p.ventCd = 0;
      p.sabotageCd = 8;
      const spawn = SPAWNS[i % SPAWNS.length];
      p.x = spawn.x;
      p.z = spawn.z;
      p.dir = Math.PI;
      p.tasks =
        p.role === 'crew'
          ? shuffle(stationPool)
              .slice(0, TASKS_PER_PLAYER)
              .map((id) => {
                const s = STATIONS.find((x) => x.id === id)!;
                return { id: s.id, name: s.name, kind: s.kind, x: s.x, z: s.z, room: s.room, done: false };
              })
          : [];
      if (p.brain) {
        p.brain.path = [];
        p.brain.station = null;
        p.brain.busy = 0;
        p.brain.idle = 2 + Math.random() * 3;
        p.brain.nextSabotage = 15 + Math.random() * 15;
        p.brain.voteAt = 0;
        p.brain.target = null;
      }
    });
    this.phase = 'play';
    this.timer = 0;
    this.feed = [];
    this.pushFeed('The ship is drawn. Find the eraser.', 'info');
    this.emit({ t: 'event', kind: 'start' });
    for (const p of this.players.values()) {
      if (p.role === 'impostor' && !p.bot) this.emit({ t: 'event', kind: 'chime', tone: 'impostor' });
    }
    this.broadcastState();
  }

  private backToLobby() {
    this.phase = 'lobby';
    this.timer = 0;
    this.bodies = [];
    this.sabotage = null;
    this.result = null;
    this.winner = null;
    this.winReason = '';
    this.meeting = null;
    this.feed = [];
    let i = 0;
    for (const p of this.players.values()) {
      p.alive = true;
      p.voted = null;
      p.tasks = [];
      p.role = 'crew';
      const spawn = SPAWNS[i++ % SPAWNS.length];
      p.x = spawn.x;
      p.z = spawn.z;
    }
    this.broadcastState();
  }

  private completeTask(p: Player, stationId: string) {
    if (this.phase !== 'play' || !p.alive || p.role !== 'crew') return;
    const task = p.tasks.find((t) => t.id === stationId && !t.done);
    if (!task) return;
    if (Math.hypot(task.x - p.x, task.z - p.z) > 3.2) return;
    task.done = true;
    this.emit({ t: 'event', kind: 'taskdone', x: task.x, z: task.z });
    this.sendTo(p.id, { t: 'event', kind: 'chime', tone: 'task' });
    this.checkWin();
  }

  private doKill(p: Player, targetId: string) {
    if (this.phase !== 'play' || !p.alive || p.role !== 'impostor' || p.killCd > 0) return;
    const t = this.players.get(targetId);
    if (!t || !t.alive || t.id === p.id || t.role === 'impostor') return;
    if (Math.hypot(t.x - p.x, t.z - p.z) > KILL_RANGE + 0.4) return;
    t.alive = false;
    t.tasks = [];
    this.bodies.push({ id: uid('b'), playerId: t.id, name: t.name, color: t.color, x: t.x, z: t.z, t: Date.now() });
    p.killCd = KILL_COOLDOWN;
    this.emitNear({ t: 'event', kind: 'kill', x: t.x, z: t.z, color: t.color }, t.x, t.z, 11);
    this.checkWin();
  }

  private startSabotage(kind: 'lights' | 'reactor', p: Player) {
    const total = kind === 'reactor' ? REACTOR_PANELS.length : BREAKERS.length;
    this.sabotage = { kind, timeLeft: kind === 'reactor' ? REACTOR_TIME : 30, fixed: new Array(total).fill(false) };
    p.sabotageCd = SABOTAGE_COOLDOWN;
    this.emit({ t: 'event', kind: 'sabotage', sabotage: kind });
    this.pushFeed(kind === 'reactor' ? 'REACTOR MELTDOWN!' : 'The lights went out', 'bad');
  }

  private fixSabotage() {
    if (!this.sabotage) return;
    const kind = this.sabotage.kind;
    this.sabotage = null;
    for (const p of this.players.values()) if (p.role === 'impostor') p.sabotageCd = Math.max(p.sabotageCd, 10);
    this.emit({ t: 'event', kind: 'fix', sabotage: kind });
    this.pushFeed(kind === 'reactor' ? 'Reactor stabilised' : 'Lights restored', 'good');
  }

  private beginMeeting(reason: 'body' | 'button', reporterId: string) {
    const reporter = this.players.get(reporterId);
    this.phase = 'meeting';
    this.timer = MEETING_TIME;
    this.meeting = { reason, reporterId };
    this.sabotage = null;
    for (const p of this.players.values()) {
      p.voted = null;
      if (p.alive) {
        const spawn = SPAWNS[[...this.players.values()].indexOf(p) % SPAWNS.length];
        p.x = spawn.x;
        p.z = spawn.z;
        p.moving = false;
        p.killCd = Math.max(p.killCd, 10);
        if (p.brain) {
          p.brain.path = [];
          p.brain.station = null;
          p.brain.busy = 0;
          p.brain.voteAt = 2 + Math.random() * 6;
        }
      }
    }
    this.pushFeed(
      reason === 'body' ? `${reporter?.name ?? '?'} found a body!` : `${reporter?.name ?? '?'} called an emergency meeting!`,
      'warn',
    );
    this.emit({ t: 'event', kind: 'meeting' });
    this.broadcastState();
  }

  private resolveVotes() {
    const alive = [...this.players.values()].filter((p) => p.alive);
    const tally: Record<string, number> = {};
    let skipped = 0;
    for (const p of alive) {
      if (!p.voted || p.voted === 'skip') {
        skipped++;
        continue;
      }
      tally[p.voted] = (tally[p.voted] ?? 0) + 1;
    }
    let bestId: string | null = null;
    let best = 0;
    let tie = false;
    for (const [id, count] of Object.entries(tally)) {
      if (count > best) {
        best = count;
        bestId = id;
        tie = false;
      } else if (count === best) {
        tie = true;
      }
    }
    if (skipped >= best) {
      tie = skipped === best;
      bestId = null;
    }
    return { bestId, tally, skipped, tie };
  }

  private finishVote() {
    const { bestId, tally, skipped, tie } = this.resolveVotes();
    const ejected = bestId ? this.players.get(bestId) ?? null : null;
    this.result = {
      ejectedId: ejected?.id ?? null,
      ejectedName: ejected?.name ?? null,
      ejectedRole: ejected?.role ?? null,
      tally,
      skipped,
      tie,
    };
    this.phase = 'reveal';
    this.timer = REVEAL_TIME;
    if (ejected) {
      ejected.alive = false;
      ejected.tasks = [];
      this.pushFeed(`${ejected.name} was crumpled up and thrown away`, 'warn');
      this.emit({ t: 'event', kind: 'eject', name: ejected.name, role: ejected.role, x: ejected.x, z: ejected.z });
    } else {
      this.pushFeed(tie ? 'The vote was a scribble. Nobody ejected.' : 'Nobody was ejected.', 'info');
    }
  }

  private checkWin(fromVote = false): boolean {
    if (this.phase === 'lobby' || this.phase === 'over') return false;
    const all = [...this.players.values()];
    const crew = all.filter((p) => p.role === 'crew');
    const crewAlive = crew.filter((p) => p.alive);
    const imps = all.filter((p) => p.role === 'impostor');
    const impsAlive = imps.filter((p) => p.alive);
    if (imps.length === 0) return false;

    if (impsAlive.length === 0) {
      this.endGame('crew', 'Every eraser was crumpled up.');
      return true;
    }
    if (crewAlive.length === 0) {
      this.endGame('impostors', 'Nothing left on the page but scribbles.');
      return true;
    }
    if (impsAlive.length >= crewAlive.length) {
      this.endGame('impostors', 'The erasers outnumber the drawings.');
      return true;
    }
    const total = crewAlive.length * TASKS_PER_PLAYER;
    const done = crewAlive.reduce((acc, p) => acc + p.tasks.filter((t) => t.done).length, 0);
    if (total > 0 && done >= total) {
      this.endGame('crew', 'Every single task is ticked off.');
      return true;
    }
    if (this.sabotage?.kind === 'reactor' && this.sabotage.timeLeft <= 0) {
      this.endGame('impostors', 'The reactor melted into a puddle of ink.');
      return true;
    }
    return false;
  }

  private endGame(team: 'crew' | 'impostors', reason: string) {
    this.phase = 'over';
    this.winner = team;
    this.winReason = reason;
    this.timer = 0;
    this.sabotage = null;
    this.emit({ t: 'event', kind: 'win', team });
    this.pushFeed(team === 'crew' ? 'CREWMATES WIN' : 'IMPOSTORS WIN', team === 'crew' ? 'good' : 'bad');
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // tick
  // -------------------------------------------------------------------------

  tick(dtMs: number) {
    const dt = Math.min(dtMs, 250) / 1000;
    this.timer = Math.max(0, this.timer - dt);
    for (const p of this.players.values()) {
      p.killCd = Math.max(0, p.killCd - dt);
      p.ventCd = Math.max(0, p.ventCd - dt);
      p.sabotageCd = Math.max(0, p.sabotageCd - dt);
    }

    if (this.phase === 'play') {
      if (this.sabotage) {
        this.sabotage.timeLeft -= dt;
        if (this.sabotage.timeLeft <= 0) {
          if (this.sabotage.kind === 'reactor') {
            this.checkWin();
          } else {
            // lights flicker back on eventually
            this.fixSabotage();
          }
        }
      }
      for (const p of this.players.values()) if (p.bot) this.tickBot(p, dt);
      this.checkWin();
    } else if (this.phase === 'vote') {
      for (const p of this.players.values()) {
        if (!p.bot || p.voted || !p.alive) continue;
        if (p.brain && p.brain.voteAt > 0) {
          p.brain.voteAt -= dt;
          if (p.brain.voteAt <= 0) {
            p.voted = this.botVote(p);
            this.emit({ t: 'event', kind: 'vote', from: p.id });
          }
        }
      }
      if (this.timer <= 0) this.finishVote();
    } else if (this.phase === 'meeting') {
      if (this.timer <= 0) {
        this.phase = 'vote';
        this.timer = VOTE_TIME;
        for (const p of this.players.values()) {
          if (p.brain) p.brain.voteAt = 1.5 + Math.random() * 6;
        }
      }
    } else if (this.phase === 'reveal') {
      if (this.timer <= 0) {
        this.phase = 'eject';
        this.timer = EJECT_TIME;
        if (this.result?.ejectedId) {
          const w = this.checkWin(true);
          if (w) {
            this.phase = 'over';
          }
        }
      }
    } else if (this.phase === 'eject') {
      if (this.timer <= 0) {
        this.phase = 'play';
        this.timer = 0;
        for (const p of this.players.values()) {
          p.voted = null;
          if (p.brain) {
            p.brain.path = [];
            p.brain.station = null;
            p.brain.busy = 0;
            p.brain.idle = 1 + Math.random() * 2;
          }
        }
        this.result = null;
        this.meeting = null;
      }
    }

    this.tickAcc += dtMs;
    // 12 snapshots per second is plenty at 3.6 m/s movement
    if (this.tickAcc >= 78) {
      this.tickAcc = 0;
      this.broadcastState();
    }
  }

  private botVote(p: Player): string {
    const others = [...this.players.values()].filter((x) => x.alive && x.id !== p.id);
    if (p.role === 'impostor') {
      const crew = others.filter((x) => x.role === 'crew');
      if (crew.length && Math.random() < 0.85) return pick(crew).id;
      return 'skip';
    }
    if (!others.length) return 'skip';
    if (Math.random() < 0.65) return pick(others).id;
    return 'skip';
  }

  private tickBot(p: Player, dt: number) {
    const brain = p.brain!;
    if (!p.alive) {
      // ghosts drift
      p.x = Math.min(Math.max(p.x, 2), 42);
      return;
    }
    if (p.role === 'impostor') this.tickImpostorBot(p, brain, dt);
    else this.tickCrewBot(p, brain, dt);
  }

  private moveBotTo(p: Player, brain: BotBrain, tx: number, tz: number, dt: number, repath: number) {
    brain.repathAt -= dt;
    const last = brain.path[brain.path.length - 1];
    if (!last || brain.repathAt <= 0 || Math.hypot(last.x - tx, last.z - tz) > 1.6) {
      brain.path = findPath({ x: p.x, z: p.z }, { x: tx, z: tz });
      brain.repathAt = repath;
    }
    if (!brain.path.length) return true;
    const wp = brain.path[0];
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.18) {
      brain.path.shift();
      return brain.path.length === 0;
    }
    const step = Math.min(SPEED * dt, dist);
    let nx = p.x + (dx / dist) * step;
    let nz = p.z + (dz / dist) * step;
    if (hitsWall(nx, nz, 0.42)) {
      brain.path = [];
      return false;
    }
    p.dir = Math.atan2(dx, dz);
    p.moving = true;
    p.x = nx;
    p.z = nz;
    return false;
  }

  private tickCrewBot(p: Player, brain: BotBrain, dt: number) {
    // 1) a body on the floor? report it like a good little doodle
    const body = this.bodies.find((b) => Math.hypot(b.x - p.x, b.z - p.z) < 1.6);
    if (body) {
      const idx = this.bodies.indexOf(body);
      this.bodies.splice(idx, 1);
      this.beginMeeting('body', p.id);
      return;
    }
    // 2) sabotage duty
    if (this.sabotage) {
      const target =
        this.sabotage.kind === 'reactor'
          ? REACTOR_PANELS.find((_, i) => !this.sabotage!.fixed[i])
          : BREAKERS.find((_, i) => !this.sabotage!.fixed[i]);
      if (target) {
        const arrived = this.moveBotTo(p, brain, target.x, target.z, dt, 1.2);
        if (arrived || Math.hypot(target.x - p.x, target.z - p.z) < USE_RANGE) {
          const i = 'id' in target ? target.id : 0;
          if (this.sabotage) {
            this.sabotage.fixed[i] = true;
            this.emit({ t: 'event', kind: 'chime', tone: 'click' });
            if (this.sabotage.fixed.every(Boolean)) this.fixSabotage();
          }
        }
        return;
      }
    }
    // 3) tasks
    if (brain.busy > 0) {
      brain.busy -= dt;
      p.moving = false;
      if (brain.busy <= 0 && brain.station) {
        this.completeTask(p, brain.station);
        brain.station = null;
        brain.idle = 0.6 + Math.random() * 2.2;
      }
      return;
    }
    const task = p.tasks.find((t) => !t.done);
    if (!task) {
      p.moving = false;
      brain.idle -= dt;
      return;
    }
    const arrived = this.moveBotTo(p, brain, task.x, task.z, dt, 2);
    if (arrived || Math.hypot(task.x - p.x, task.z - p.z) < 1.3) {
      brain.station = task.id;
      brain.busy = 2.5 + Math.random() * 3;
      p.moving = false;
    }
  }

  private tickImpostorBot(p: Player, brain: BotBrain, dt: number) {
    const crew = [...this.players.values()].filter((x) => x.alive && x.role === 'crew');
    if (!crew.length) return;
    brain.nextSabotage -= dt;
    if (brain.nextSabotage <= 0 && !this.sabotage && p.sabotageCd <= 0 && Math.random() < 0.4) {
      this.startSabotage(Math.random() < 0.6 ? 'lights' : 'reactor', p);
      brain.nextSabotage = 25 + Math.random() * 25;
    }
    // nearest visible-ish crewmate
    let target = crew[0];
    let bestDist = Infinity;
    const sameRoom = (a: Player, b: Player) => Math.hypot(a.x - b.x, a.z - b.z) < 14;
    for (const c of crew) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bestDist && sameRoom(p, c)) {
        bestDist = d;
        target = c;
      }
    }
    if (p.killCd <= 0 && bestDist < KILL_RANGE - 0.1 && Math.random() < 0.5) {
      this.doKill(p, target.id);
      // slink into a vent if one is close
      const nearVent = VENTS.find((v) => Math.hypot(v.x - p.x, v.z - p.z) < 2);
      if (nearVent) {
        const dest = pick(VENTS.filter((v) => v.id !== nearVent.id));
        this.emitNear({ t: 'event', kind: 'vent', x: p.x, z: p.z }, p.x, p.z, 8);
        p.x = dest.x;
        p.z = dest.z;
        this.emitNear({ t: 'event', kind: 'vent', x: dest.x, z: dest.z }, p.x, p.z, 8);
      }
      brain.path = [];
      return;
    }
    if (bestDist < KILL_RANGE - 0.1) {
      p.moving = false;
      return;
    }
    brain.target = target.id;
    this.moveBotTo(p, brain, target.x, target.z, dt, 1.4);
  }

  // -------------------------------------------------------------------------
  // snapshots
  // -------------------------------------------------------------------------

  private emit(ev: ServerEvent) {
    this.host.broadcast(ev);
  }

  /** Send an event only to doodles close enough to have seen it. */
  private emitNear(ev: ServerEvent, x: number, z: number, radius: number) {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      if (p.role === 'impostor' || Math.hypot(p.x - x, p.z - z) <= radius) this.sendTo(p.id, ev);
    }
  }

  private sendTo(id: string, msg: ServerMsg) {
    this.host.send(id, msg);
  }

  broadcastState() {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      this.host.send(p.id, this.snapshotFor(p.id));
    }
  }

  private progress() {
    const crewAlive = [...this.players.values()].filter((p) => p.role === 'crew' && p.alive && p.tasks.length > 0);
    if (!crewAlive.length) return 0;
    const total = crewAlive.length * TASKS_PER_PLAYER;
    const done = crewAlive.reduce((acc, p) => acc + p.tasks.filter((t) => t.done).length, 0);
    return total ? Math.min(1, done / total) : 0;
  }

  snapshotFor(viewerId: string): Snapshot {
    const viewer = this.players.get(viewerId);
    const viewerRole: Role = viewer?.role ?? 'crew';
    const isImp = viewerRole === 'impostor';
    const players: PlayerSnap[] = [...this.players.values()].map((p) => {
      const showRole = p.id === viewerId || (isImp && p.role === 'impostor');
      const snap: PlayerSnap = {
        id: p.id,
        name: p.name,
        color: p.color,
        x: Math.round(p.x * 100) / 100,
        z: Math.round(p.z * 100) / 100,
        dir: Math.round(p.dir * 100) / 100,
        moving: p.moving,
        alive: p.alive,
        bot: p.bot,
        host: p.id === this.hostId,
        voted: p.voted ? (this.phase === 'vote' || this.phase === 'reveal' ? p.voted : undefined) : null,
      };
      if (showRole) snap.role = p.role;
      return snap;
    });
    const canSeeBodies = !viewer || !viewer.alive || isImp;
    const bodies: BodySnap[] = this.bodies
      .filter(
        (b) =>
          canSeeBodies ||
          (viewer && Math.hypot(b.x - viewer.x, b.z - viewer.z) <= 10),
      )
      .map((b) => ({
      id: b.id,
      playerId: b.playerId,
      name: b.name,
      color: b.color,
      x: b.x,
      z: b.z,
      t: b.t,
    }));
    const tasks: TaskInfo[] = viewer?.tasks ?? [];
    const sabotage = this.sabotage
      ? {
          kind: this.sabotage.kind,
          timer: Math.max(0, this.sabotage.timeLeft),
          fixed: this.sabotage.fixed.filter(Boolean).length,
          total: this.sabotage.fixed.length,
          done: this.sabotage.fixed.map((f, i) => (f ? i : -1)).filter((i) => i >= 0),
        }
      : null;
    const votes: Record<string, string> | null =
      this.phase === 'vote' || this.phase === 'reveal'
        ? Object.fromEntries([...this.players.values()].filter((p) => p.voted).map((p) => [p.id, p.voted!]))
        : null;
    return {
      t: 'state',
      code: this.code,
      phase: this.phase,
      timer: Math.round(this.timer * 10) / 10,
      hostId: this.hostId,
      youId: viewerId,
      youRole: viewerRole,
      impostors: isImp ? [...this.players.values()].filter((p) => p.role === 'impostor').map((p) => p.id) : [],
      players,
      bodies,
      tasks,
      taskProgress: this.progress(),
      sabotage,
      killCooldown: viewer?.killCd ?? 0,
      ventCooldown: viewer?.ventCd ?? 0,
      sabotageCooldown: viewer?.sabotageCd ?? 0,
      meeting: this.meeting
        ? {
            reason: this.meeting.reason,
            reporterId: this.meeting.reporterId,
            reporterName: this.players.get(this.meeting.reporterId)?.name ?? '???',
          }
        : null,
      votes,
      result: this.phase === 'reveal' || this.phase === 'eject' || this.phase === 'over' ? this.result : null,
      winner: this.winner,
      winReason: this.winReason,
      feed: this.feed.slice(),
      impostorCount: this.players.size >= 7 ? 2 : 1,
      settings: { tasksPerPlayer: TASKS_PER_PLAYER, killCooldown: KILL_COOLDOWN },
    };
  }

  /** number of human+socket players, used to know when a room can be torn down */
  get humanCount() {
    return [...this.players.values()].filter((p) => !p.bot).length;
  }

  tickInterval = TICK_MS;
}

export { TICK_MS, TASKS_PER_PLAYER, KILL_COOLDOWN, USE_RANGE, STATIONS, VENTS, BUTTON, BREAKERS, REACTOR_PANELS };
export type { Player, Station };
