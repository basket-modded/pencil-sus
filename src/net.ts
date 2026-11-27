import type { ClientMsg, ServerMsg } from './shared/protocol';
import { RoomSim } from './shared/sim';

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'local';

export interface Link {
  kind: 'ws' | 'local';
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onStatus(cb: (s: LinkStatus) => void): void;
  close(): void;
}

export function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export class WsLink implements Link {
  kind = 'ws' as const;
  private ws: WebSocket;
  private messageCb: ((m: ServerMsg) => void) | null = null;
  private statusCb: ((s: LinkStatus) => void) | null = null;
  private queue: ServerMsg[] = [];
  private pending: ClientMsg[] = [];
  private closed = false;

  constructor(code: string, name: string, color: string) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/room/${encodeURIComponent(code.toUpperCase())}`;
    this.ws = new WebSocket(url);
    this.statusCb?.('connecting');
    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({ t: 'hello', name, color }));
      for (const m of this.pending) this.ws.send(JSON.stringify(m));
      this.pending = [];
      this.statusCb?.('online');
    });
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (this.messageCb) this.messageCb(msg);
        else this.queue.push(msg);
      } catch {
        /* ignore */
      }
    });
    this.ws.addEventListener('close', () => {
      if (this.closed) return;
      this.statusCb?.('offline');
    });
    this.ws.addEventListener('error', () => {
      this.statusCb?.('offline');
    });
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.pending.push(msg);
  }

  onMessage(cb: (m: ServerMsg) => void) {
    this.messageCb = cb;
    for (const m of this.queue) cb(m);
    this.queue = [];
  }

  onStatus(cb: (s: LinkStatus) => void) {
    this.statusCb = cb;
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}

/**
 * Solo mode: the exact same authoritative simulation, running in a worker
 * thread-free interval inside the page. Used when no game server is reachable
 * (e.g. a purely static deploy) and for "play with doodle bots".
 */
export class LocalLink implements Link {
  kind = 'local' as const;
  private sim: RoomSim;
  private meId: string;
  private messageCb: ((m: ServerMsg) => void) | null = null;
  private statusCb: ((s: LinkStatus) => void) | null = null;
  private queue: ServerMsg[] = [];
  private timer: ReturnType<typeof setInterval>;

  constructor(code: string, name: string, color: string, bots = 3) {
    this.sim = new RoomSim(code, {
      send: (id, msg) => {
        if (id !== this.meId) return;
        if (this.messageCb) this.messageCb(msg);
        else this.queue.push(msg);
      },
      broadcast: (msg) => {
        if (this.messageCb) this.messageCb(msg);
        else this.queue.push(msg);
      },
    });
    this.meId = this.sim.addPlayer(name || 'Doodle', color, false, true).id;
    for (let i = 0; i < Math.min(7, bots); i++) this.sim.addPlayer('', color, true);
    this.sim.broadcastState();
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      this.sim.tick(dt);
    }, 90);
  }

  send(msg: ClientMsg) {
    if (msg.t === 'ping') return;
    this.sim.handle(msg, this.meId);
  }

  onMessage(cb: (m: ServerMsg) => void) {
    this.messageCb = cb;
    for (const m of this.queue) cb(m);
    this.queue = [];
  }

  onStatus(cb: (s: LinkStatus) => void) {
    this.statusCb = cb;
    this.statusCb('local');
  }

  close() {
    clearInterval(this.timer);
  }
}
