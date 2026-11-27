import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { RoomHolder } from '../src/shared/hostBridge';

/**
 * Local dev counterpart of the Durable Object: same RoomSim, same protocol,
 * hosted on the Vite http server at /api/room/:code.
 */
export function pencilRooms(): Plugin {
  return {
    name: 'pencil-sus-rooms',
    configureServer(server) {
      const rooms = new Map<string, RoomHolder>();
      const wss = new WebSocketServer({ noServer: true });
      const http = server.httpServer;
      if (!http) return;
      http.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{1,8})$/);
        if (!match) return; // let vite's HMR socket handle its own upgrades
        const code = match[1].toUpperCase();
        wss.handleUpgrade(req, socket as any, head, (ws) => {
          let holder = rooms.get(code);
          if (!holder) {
            holder = new RoomHolder(code, {
              onEmpty: () => {
                rooms.delete(code);
                console.log(`[pencil-sus] room ${code} closed`);
              },
            });
            rooms.set(code, holder);
            console.log(`[pencil-sus] room ${code} opened`);
          }
          holder.attach(ws as any);
        });
      });
      server.httpServer?.on('close', () => {
        for (const r of rooms.values()) r.stop();
        rooms.clear();
        wss.close();
      });
      // tiny health/host info endpoint
      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, rooms: rooms.size, mode: 'dev' }));
      });
    },
  };
}
