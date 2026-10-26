import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './rooms.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8787);
const STATIC_DIR = resolve(fileURLToPath(new URL('../dist/client', import.meta.url)));
const serveStatic = existsSync(STATIC_DIR);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.roomCount }));
    return;
  }
  if (!serveStatic) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Skyhoops game server is running. In development, open the Vite dev server (http://localhost:5173).');
    return;
  }
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}

const rooms = new RoomManager();
const server = createServer(handleHttp);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws) => {
  const id = randomUUID().slice(0, 8);
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  rooms.connect({
    id,
    send(msg: ServerMsg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  });

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    rooms.handle(id, msg);
  });
  ws.on('close', () => rooms.disconnect(id));
  ws.on('error', () => rooms.disconnect(id));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
  rooms.tick();
}, 15000);

server.listen(PORT, () => {
  console.log(`Skyhoops server listening on http://localhost:${PORT}${serveStatic ? ' (serving the built game)' : ''}`);
});
