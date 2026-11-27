/**
 * Bridges a websocket to a RoomSim. Written against the common subset of the
 * Cloudflare Workers WebSocket API and the `ws` npm package so both the edge
 * and the local dev server share exactly one implementation.
 */
import { RoomSim } from './sim';
import type { ClientMsg, ServerMsg } from './protocol';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', cb: (ev: any) => void): void;
  addEventListener(type: 'close', cb: (ev: any) => void): void;
  addEventListener(type: 'error', cb: (ev: any) => void): void;
}

const LOOP_MS = 90;

export class RoomHolder {
  sim: RoomSim;
  private sockets = new Map<string, SocketLike>();
  private playerBySocket = new Map<SocketLike, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = Date.now();
  onEmpty?: () => void;

  constructor(code: string, opts: { onEmpty?: () => void } = {}) {
    this.sim = new RoomSim(code, {
      send: (playerId, msg) => {
        const sock = this.sockets.get(playerId);
        if (sock) {
          try {
            sock.send(JSON.stringify(msg));
          } catch {
            /* socket died */
          }
        }
      },
      broadcast: (msg) => {
        const data = JSON.stringify(msg);
        for (const [id, sock] of this.sockets) {
          void id;
          try {
            sock.send(data);
          } catch {
            /* socket died */
          }
        }
      },
    });
    this.onEmpty = opts.onEmpty;
  }

  get code() {
    return this.sim.code;
  }

  attach(socket: SocketLike) {
    this.ensureLoop();
    socket.addEventListener('message', (ev: any) => {
      let msg: ClientMsg | null = null;
      try {
        msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const pid = this.playerBySocket.get(socket);
      if (!pid) {
        if (msg.t !== 'hello') return;
        const name = String(msg.name ?? 'Doodle').slice(0, 14) || 'Doodle';
        const color = typeof msg.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#2f7fd0';
        const player = this.sim.addPlayer(name, color, false, true);
        this.sockets.set(player.id, socket);
        this.playerBySocket.set(socket, player.id);
        this.send(socket, { t: 'welcome', id: player.id, code: this.sim.code });
        if (this.sim.phase === 'lobby' || this.sim.phase === 'over') {
          const wanted = Math.max(0, Math.min(8, Number(msg.botCount) || 0));
          for (let i = 0; i < wanted && this.sim.players.size < 8; i++) {
            this.sim.addPlayer('', '#8f8f8f', true);
          }
        }
        this.sim.broadcastState();
        return;
      }
      if (msg.t === 'ping') {
        this.send(socket, { t: 'event', kind: 'chime', tone: 'pong' });
        return;
      }
      this.sim.handle(msg, pid);
    });

    const drop = () => {
      const pid = this.playerBySocket.get(socket);
      this.playerBySocket.delete(socket);
      if (!pid) return;
      this.sockets.delete(pid);
      this.sim.removePlayer(pid);
      this.sim.broadcastState();
      if (this.sim.humanCount === 0) {
        this.stop();
        this.onEmpty?.();
      }
    };
    socket.addEventListener('close', drop);
    socket.addEventListener('error', drop);
  }

  private send(socket: SocketLike, msg: ServerMsg) {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private ensureLoop() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = now - this.last;
      this.last = now;
      this.sim.tick(dt);
    }, LOOP_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
