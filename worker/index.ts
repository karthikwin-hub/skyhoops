import { DurableObject } from 'cloudflare:workers';
import { RoomManager } from '../server/rooms.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

interface Env {
  ASSETS: Fetcher;
  LOBBY: DurableObjectNamespace<Lobby>;
}

/**
 * Holds every live connection and room in memory, exactly like the Node server.
 * One instance is plenty for a handful of rooms and keeps room codes global.
 */
export class Lobby extends DurableObject<Env> {
  private rooms = new RoomManager();

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    this.rooms.connect({
      id,
      send(msg: ServerMsg) {
        try {
          server.send(JSON.stringify(msg));
        } catch {
          // Socket already closing; the close handler cleans up.
        }
      },
    });
    server.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > 16 * 1024) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.rooms.handle(id, msg);
      this.rooms.tick();
    });
    const bye = () => this.rooms.disconnect(id);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }

  async health(): Promise<number> {
    return this.rooms.roomCount;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('global'));
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return lobby.fetch(req);
    }
    if (url.pathname === '/health') return Response.json({ ok: true, rooms: await lobby.health() });
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
