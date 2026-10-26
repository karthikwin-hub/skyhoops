import {
  MAX_PLAYERS,
  REACTIONS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  sanitizeProfile,
  type ClientMsg,
  type PlayerSnapshot,
  type Profile,
  type Ranking,
  type RoomSnapshot,
  type RoomState,
  type ServerMsg,
} from '../shared/protocol.ts';

export interface Conn {
  id: string;
  send(msg: ServerMsg): void;
}

interface Client {
  conn: Conn;
  profile: Profile | null;
  roomCode: string | null;
  lastReact: number;
}

interface Room {
  code: string;
  hostId: string;
  state: RoomState;
  stageId: string;
  players: Map<string, PlayerSnapshot>;
  startedAt: number;
}

export const ROUND_TIMEOUT_MS = 5 * 60 * 1000;
const START_COUNTDOWN_MS = 3500;

export class RoomManager {
  private clients = new Map<string, Client>();
  private rooms = new Map<string, Room>();

  constructor(
    private now: () => number = Date.now,
    private random: () => number = Math.random,
  ) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  connect(conn: Conn): void {
    this.clients.set(conn.id, { conn, profile: null, roomCode: null, lastReact: 0 });
    conn.send({ t: 'welcome', id: conn.id });
  }

  disconnect(id: string): void {
    this.leaveRoom(id);
    this.clients.delete(id);
  }

  handle(id: string, msg: ClientMsg): void {
    const client = this.clients.get(id);
    if (!client || !msg || typeof msg !== 'object') return;
    const room = client.roomCode ? this.rooms.get(client.roomCode) : undefined;

    switch (msg.t) {
      case 'hello': {
        const profile = sanitizeProfile(msg.profile);
        if (!profile) return this.error(client, 'Please pick a name first.');
        client.profile = profile;
        const player = room?.players.get(id);
        if (room && player) {
          Object.assign(player, profile);
          this.broadcastRoom(room);
        }
        return;
      }
      case 'create': {
        if (!client.profile) return this.error(client, 'Please pick a name first.');
        this.leaveRoom(id);
        const code = this.newCode();
        const created: Room = {
          code,
          hostId: id,
          state: 'lobby',
          stageId: 'rooftop',
          players: new Map(),
          startedAt: 0,
        };
        this.rooms.set(code, created);
        this.addPlayer(created, client);
        return;
      }
      case 'join': {
        if (!client.profile) return this.error(client, 'Please pick a name first.');
        const code = String(msg.code ?? '').toUpperCase().trim();
        const target = this.rooms.get(code);
        if (!target) return this.error(client, `No room called ${code || '????'}. Check the code!`);
        if (target.players.has(id)) return this.broadcastRoom(target);
        if (target.players.size >= MAX_PLAYERS) return this.error(client, 'That room is full (6 players max).');
        this.leaveRoom(id);
        this.addPlayer(target, client);
        return;
      }
      case 'leave': {
        this.leaveRoom(id);
        client.conn.send({ t: 'left' });
        return;
      }
      case 'start': {
        if (!room || room.hostId !== id) return;
        if (room.state === 'playing') return;
        room.state = 'playing';
        room.stageId = String(msg.stageId).slice(0, 32);
        room.startedAt = this.now();
        for (const p of room.players.values()) {
          Object.assign(p, { score: 0, made: 0, shots: 0, streak: 0, stars: 0, inRound: true, finished: false });
        }
        const seed = Math.floor(this.random() * 2 ** 31);
        this.broadcast(room, { t: 'start', stageId: room.stageId, seed, startIn: START_COUNTDOWN_MS });
        this.broadcastRoom(room);
        return;
      }
      case 'lobby': {
        if (!room || room.hostId !== id) return;
        room.state = 'lobby';
        for (const p of room.players.values()) Object.assign(p, { inRound: false, finished: false });
        this.broadcastRoom(room);
        return;
      }
      case 'ball': {
        if (!room || room.state !== 'playing') return;
        const p = msg.p;
        if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => Number.isFinite(n))) return;
        this.broadcast(room, { t: 'ball', id, p: [p[0], p[1], p[2]] }, id);
        return;
      }
      case 'ballEnd': {
        if (!room) return;
        this.broadcast(room, { t: 'ballEnd', id, made: !!msg.made }, id);
        return;
      }
      case 'progress': {
        const player = room?.players.get(id);
        if (!room || !player || room.state !== 'playing' || !player.inRound) return;
        player.score = clampInt(msg.score, 0, 99999);
        player.made = clampInt(msg.made, 0, 999);
        player.shots = clampInt(msg.shots, 0, 999);
        player.streak = clampInt(msg.streak, 0, 999);
        if (typeof msg.label === 'string' && msg.label) {
          this.broadcast(room, { t: 'feed', id, label: msg.label.slice(0, 40) }, id);
        }
        this.broadcastRoom(room);
        return;
      }
      case 'finish': {
        const player = room?.players.get(id);
        if (!room || !player || room.state !== 'playing' || !player.inRound) return;
        player.score = clampInt(msg.score, 0, 99999);
        player.made = clampInt(msg.made, 0, 999);
        player.shots = clampInt(msg.shots, 0, 999);
        player.stars = clampInt(msg.stars, 0, 3);
        player.finished = true;
        this.checkRoundOver(room);
        if (room.state === 'playing') this.broadcastRoom(room);
        return;
      }
      case 'react': {
        if (!room || !(REACTIONS as readonly string[]).includes(msg.emoji)) return;
        const t = this.now();
        if (t - client.lastReact < 250) return;
        client.lastReact = t;
        this.broadcast(room, { t: 'react', id, emoji: msg.emoji });
        return;
      }
    }
  }

  /** Ends rounds that have been running too long, e.g. because a player wandered off. */
  tick(): void {
    const t = this.now();
    for (const room of this.rooms.values()) {
      if (room.state === 'playing' && t - room.startedAt > ROUND_TIMEOUT_MS) this.finishRound(room);
    }
  }

  snapshot(code: string): RoomSnapshot | null {
    const room = this.rooms.get(code);
    return room ? this.toSnapshot(room) : null;
  }

  private addPlayer(room: Room, client: Client): void {
    const profile = client.profile!;
    room.players.set(client.conn.id, {
      id: client.conn.id,
      ...profile,
      score: 0,
      made: 0,
      shots: 0,
      streak: 0,
      stars: 0,
      inRound: false,
      finished: false,
    });
    client.roomCode = room.code;
    this.broadcastRoom(room);
  }

  private leaveRoom(id: string): void {
    const client = this.clients.get(id);
    if (!client?.roomCode) return;
    const room = this.rooms.get(client.roomCode);
    client.roomCode = null;
    if (!room) return;
    room.players.delete(id);
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === id) room.hostId = room.players.keys().next().value as string;
    this.checkRoundOver(room);
    this.broadcastRoom(room);
  }

  private checkRoundOver(room: Room): void {
    if (room.state !== 'playing') return;
    const racers = [...room.players.values()].filter((p) => p.inRound);
    if (racers.length > 0 && racers.every((p) => p.finished)) this.finishRound(room);
  }

  private finishRound(room: Room): void {
    room.state = 'results';
    const ranking: Ranking[] = [...room.players.values()]
      .filter((p) => p.inRound)
      .sort((a, b) => b.score - a.score || b.made - a.made)
      .map(({ id, name, avatar, color, score, made, shots }) => ({ id, name, avatar, color, score, made, shots }));
    this.broadcast(room, { t: 'results', ranking });
    this.broadcastRoom(room);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(this.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private toSnapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      stageId: room.stageId,
      players: [...room.players.values()].map((p) => ({ ...p })),
    };
  }

  private broadcastRoom(room: Room): void {
    this.broadcast(room, { t: 'room', room: this.toSnapshot(room) });
  }

  private broadcast(room: Room, msg: ServerMsg, exceptId?: string): void {
    for (const pid of room.players.keys()) {
      if (pid === exceptId) continue;
      this.clients.get(pid)?.conn.send(msg);
    }
  }

  private error(client: Client, message: string): void {
    client.conn.send({ t: 'error', message });
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
