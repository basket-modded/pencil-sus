import type { TaskKind } from './map';

export type Role = 'crew' | 'impostor';
export type Phase = 'lobby' | 'play' | 'meeting' | 'vote' | 'reveal' | 'eject' | 'over';
export type WinTeam = 'crew' | 'impostors' | null;

export interface TaskInfo {
  id: string;
  name: string;
  kind: TaskKind;
  x: number;
  z: number;
  room: string;
  done: boolean;
}

export interface PlayerSnap {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  dir: number;
  moving: boolean;
  alive: boolean;
  bot: boolean;
  host: boolean;
  /** only present for yourself / impostor teammates */
  role?: Role;
  voted?: string | null;
}

export interface BodySnap {
  id: string;
  playerId: string;
  name: string;
  color: string;
  x: number;
  z: number;
  t: number;
}

export interface SabotageSnap {
  kind: 'lights' | 'reactor';
  timer: number;
  /** reactor panels / breaker switches already activated */
  fixed: number;
  total: number;
  done: number[];
}

export interface VoteResult {
  ejectedId: string | null;
  ejectedName: string | null;
  ejectedRole: Role | null;
  tally: Record<string, number>;
  skipped: number;
  tie: boolean;
}

export interface Snapshot {
  t: 'state';
  code: string;
  phase: Phase;
  timer: number;
  hostId: string | null;
  youId: string;
  youRole: Role;
  impostors: string[];
  players: PlayerSnap[];
  bodies: BodySnap[];
  tasks: TaskInfo[];
  taskProgress: number;
  sabotage: SabotageSnap | null;
  killCooldown: number;
  ventCooldown: number;
  sabotageCooldown: number;
  meeting: { reason: 'body' | 'button'; reporterName: string; reporterId: string } | null;
  votes: Record<string, string> | null;
  result: VoteResult | null;
  winner: WinTeam;
  winReason: string;
  feed: { id: number; text: string; tone: string }[];
  impostorCount: number;
  settings: { tasksPerPlayer: number; killCooldown: number };
}

export type ServerEvent =
  | { t: 'event'; kind: 'kill'; x: number; z: number; color: string }
  | { t: 'event'; kind: 'vent'; x: number; z: number }
  | { t: 'event'; kind: 'sabotage'; sabotage: 'lights' | 'reactor' }
  | { t: 'event'; kind: 'fix'; sabotage: 'lights' | 'reactor' }
  | { t: 'event'; kind: 'taskdone'; x: number; z: number }
  | { t: 'event'; kind: 'meeting' }
  | { t: 'event'; kind: 'vote'; from: string }
  | { t: 'event'; kind: 'eject'; name: string; role: Role; x: number; z: number }
  | { t: 'event'; kind: 'win'; team: 'crew' | 'impostors' }
  | { t: 'event'; kind: 'start' }
  | { t: 'event'; kind: 'chime'; tone: string };

export type ServerMsg = Snapshot | ServerEvent | { t: 'welcome'; id: string; code: string };

export type ClientMsg =
  | { t: 'hello'; name: string; color: string; botCount?: number }
  | { t: 'move'; x: number; z: number; dir: number; moving: boolean }
  | { t: 'start' }
  | { t: 'addBot' }
  | { t: 'kickBot' }
  | { t: 'task'; id: string }
  | { t: 'kill'; target: string }
  | { t: 'vent'; vent: number }
  | { t: 'report'; body: string }
  | { t: 'button' }
  | { t: 'vote'; target: string }
  | { t: 'sabotage'; kind: 'lights' | 'reactor' }
  | { t: 'fixLights'; breaker: number }
  | { t: 'reactorPanel'; panel: number }
  | { t: 'restart' }
  | { t: 'ping'; id: number };
