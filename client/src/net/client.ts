import type { ClientMsg, Profile, RoomSnapshot, ServerMsg } from '@shared/protocol';

type Handler<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;

/** Thin WebSocket client for rooms. Reconnects quietly and re-sends the profile. */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private queue: ClientMsg[] = [];
  private profile: Profile | null = null;
  private wantOpen = false;
  private retry = 0;
  id: string | null = null;
  room: RoomSnapshot | null = null;
  status: 'offline' | 'connecting' | 'online' = 'offline';
  onStatus: (s: NetClient['status']) => void = () => {};

  on<T extends ServerMsg['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(fn as (m: ServerMsg) => void);
    return () => set!.delete(fn as (m: ServerMsg) => void);
  }

  connect(profile: Profile): void {
    this.profile = profile;
    this.wantOpen = true;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      this.send({ t: 'hello', profile });
      return;
    }
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = (import.meta.env.VITE_WS_URL as string | undefined) ?? `${proto}://${location.host}/ws`;
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      // Idle sockets get closed by proxies, so keep a little traffic flowing.
      const keepAlive = setInterval(() => (ws.readyState === WebSocket.OPEN ? ws.send('{"t":"ping"}') : clearInterval(keepAlive)), 25000);
      this.setStatus('online');
      if (this.profile) ws.send(JSON.stringify({ t: 'hello', profile: this.profile } satisfies ClientMsg));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.id = msg.id;
      if (msg.t === 'room') this.room = msg.room;
      if (msg.t === 'left') this.room = null;
      this.handlers.get(msg.t)?.forEach((h) => h(msg));
    };
    ws.onclose = () => {
      this.ws = null;
      const hadRoom = this.room;
      this.room = null;
      this.setStatus('offline');
      if (hadRoom) this.handlers.get('left')?.forEach((h) => h({ t: 'left' }));
      if (this.wantOpen) {
        this.retry = Math.min(this.retry + 1, 6);
        setTimeout(() => this.wantOpen && !this.ws && this.open(), 600 * this.retry);
      }
    };
  }

  private setStatus(s: NetClient['status']): void {
    this.status = s;
    this.onStatus(s);
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ball') this.queue.push(msg);
  }

  get inRoom(): boolean {
    return !!this.room;
  }

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.id;
  }
}

export const net = new NetClient();
