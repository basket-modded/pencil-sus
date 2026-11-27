/**
 * Cloudflare Worker entry point.
 *
 * - Static build (dist/) is served through the ASSETS binding.
 * - /api/room/:code upgrades to a WebSocket handled by a Durable Object that
 *   hosts one authoritative RoomSim per room code.
 */
import { RoomHolder } from '../src/shared/hostBridge';

interface DurableObjectIdLike {
  name?: string;
  toString(): string;
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}
interface DurableObjectStateLike {
  id: DurableObjectIdLike;
  waitUntil?(p: Promise<unknown>): void;
}
interface Env {
  GAME_ROOM: DurableObjectNamespaceLike;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

declare const WebSocketPair: { new (): { 0: any; 1: any } };

export class GameRoom {
  private holder: RoomHolder;
  private state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
    const code = (state.id?.name ?? 'ROOM').toUpperCase().slice(0, 8);
    this.holder = new RoomHolder(code);
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.holder.attach(server);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{1,8})$/);
    if (match) {
      const code = match[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(code);
      return env.GAME_ROOM.get(id).fetch(request);
    }
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true, mode: 'worker' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
