import { beforeEach, describe, expect, it } from 'vitest';
import { RoomManager, ROUND_TIMEOUT_MS } from '../server/rooms';
import type { ClientMsg, RoomSnapshot, ServerMsg } from '../shared/protocol';

class FakeConn {
  inbox: ServerMsg[] = [];
  constructor(readonly id: string) {}
  send(msg: ServerMsg): void {
    this.inbox.push(msg);
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
  all<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  get room(): RoomSnapshot | undefined {
    return this.last('room')?.room;
  }
}

let clock = 0;
let rooms: RoomManager;

function player(id: string, name = id): FakeConn {
  const c = new FakeConn(id);
  rooms.connect(c);
  rooms.handle(id, { t: 'hello', profile: { name, color: '#ff3d7f', avatar: '🐸' } });
  return c;
}

const send = (c: FakeConn, msg: ClientMsg) => rooms.handle(c.id, msg);

/** Host creates a room and the others join it. */
function party(...names: string[]): FakeConn[] {
  const [host, ...rest] = names.map((n) => player(n));
  send(host, { t: 'create' });
  const code = host.room!.code;
  for (const c of rest) send(c, { t: 'join', code });
  return [host, ...rest];
}

beforeEach(() => {
  clock = 1000;
  let seed = 0.1;
  rooms = new RoomManager(
    () => clock,
    () => (seed = (seed * 9301 + 0.49297) % 1),
  );
});

describe('RoomManager', () => {
  it('welcomes connections with their id', () => {
    const c = new FakeConn('a');
    rooms.connect(c);
    expect(c.inbox[0]).toEqual({ t: 'welcome', id: 'a' });
  });

  it('requires a profile before creating or joining', () => {
    const c = new FakeConn('a');
    rooms.connect(c);
    send(c, { t: 'create' });
    expect(c.last('error')).toBeTruthy();
    expect(rooms.roomCount).toBe(0);
  });

  it('cleans up names and rejects empty ones', () => {
    const c = new FakeConn('a');
    rooms.connect(c);
    send(c, { t: 'hello', profile: { name: '<script>', color: 'javascript:', avatar: 'x' } });
    send(c, { t: 'create' });
    const me = c.room!.players[0];
    expect(me.name).toBe('script');
    expect(me.color).toMatch(/^#/);
    send(c, { t: 'hello', profile: { name: '   ', color: '#ff3d7f', avatar: '🐸' } });
    expect(c.last('error')).toBeTruthy();
  });

  it('creates a room with a 4 letter code and lets friends join it', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    expect(mia.room!.code).toMatch(/^[A-Z]{4}$/);
    expect(mia.room!.hostId).toBe('Mia');
    expect(mia.room!.players.map((p) => p.name)).toEqual(['Mia', 'Zoe']);
    expect(zoe.room!.code).toBe(mia.room!.code);
  });

  it('accepts lowercase codes and reports unknown ones', () => {
    const [mia] = party('Mia');
    const zoe = player('Zoe');
    send(zoe, { t: 'join', code: 'QQQQ' });
    expect(zoe.last('error')!.message).toContain('QQQQ');
    send(zoe, { t: 'join', code: mia.room!.code.toLowerCase() });
    expect(zoe.room!.players).toHaveLength(2);
  });

  it('caps rooms at 6 players', () => {
    const six = party('a', 'b', 'c', 'd', 'e', 'f');
    expect(six[0].room!.players).toHaveLength(6);
    const late = player('g');
    send(late, { t: 'join', code: six[0].room!.code });
    expect(late.last('error')!.message).toMatch(/full/);
  });

  it('hands the host role on when the host leaves, and deletes empty rooms', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(mia, { t: 'leave' });
    expect(mia.last('left')).toBeTruthy();
    expect(zoe.room!.hostId).toBe('Zoe');
    rooms.disconnect('Zoe');
    expect(rooms.roomCount).toBe(0);
  });

  it('only the host can start, and everyone gets the same seed', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(zoe, { t: 'start', stageId: 'moon' });
    expect(zoe.last('start')).toBeUndefined();
    send(mia, { t: 'start', stageId: 'moon' });
    const a = mia.last('start')!;
    const b = zoe.last('start')!;
    expect(a.stageId).toBe('moon');
    expect(a.seed).toBe(b.seed);
    expect(zoe.room!.state).toBe('playing');
    expect(zoe.room!.players.every((p) => p.inRound)).toBe(true);
  });

  it('relays ghost balls to everyone except the shooter, dropping junk', () => {
    const [mia, zoe, ava] = party('Mia', 'Zoe', 'Ava');
    send(mia, { t: 'start', stageId: 'rooftop' });
    send(zoe, { t: 'ball', p: [1, 2, 3] });
    expect(mia.last('ball')).toEqual({ t: 'ball', id: 'Zoe', p: [1, 2, 3] });
    expect(ava.last('ball')).toBeTruthy();
    expect(zoe.last('ball')).toBeUndefined();
    send(zoe, { t: 'ball', p: [1, NaN, 3] as [number, number, number] });
    send(zoe, { t: 'ball', p: 'boom' as unknown as [number, number, number] });
    expect(mia.all('ball')).toHaveLength(1);
  });

  it('ignores ghost balls outside a round', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(zoe, { t: 'ball', p: [1, 2, 3] });
    expect(mia.last('ball')).toBeUndefined();
  });

  it('tracks live scores, clamping silly values', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(mia, { t: 'start', stageId: 'rooftop' });
    send(zoe, { t: 'progress', score: 12, made: 4, shots: 5, streak: 3, label: 'SWISH' });
    expect(mia.room!.players.find((p) => p.id === 'Zoe')!.score).toBe(12);
    expect(mia.last('feed')).toEqual({ t: 'feed', id: 'Zoe', label: 'SWISH' });
    send(zoe, { t: 'progress', score: 1e12, made: -5, shots: 5, streak: 0 });
    const z = mia.room!.players.find((p) => p.id === 'Zoe')!;
    expect(z.score).toBe(99999);
    expect(z.made).toBe(0);
  });

  it('sends ranked results once everyone has finished', () => {
    const [mia, zoe, ava] = party('Mia', 'Zoe', 'Ava');
    send(mia, { t: 'start', stageId: 'rooftop' });
    send(mia, { t: 'finish', score: 20, made: 7, shots: 10, stars: 2 });
    send(zoe, { t: 'finish', score: 31, made: 9, shots: 10, stars: 3 });
    expect(mia.last('results')).toBeUndefined();
    send(ava, { t: 'finish', score: 20, made: 8, shots: 10, stars: 2 });
    const r = ava.last('results')!.ranking;
    expect(r.map((x) => x.name)).toEqual(['Zoe', 'Ava', 'Mia']);
    expect(mia.room!.state).toBe('results');
  });

  it('finishes the round when the last unfinished player leaves', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(mia, { t: 'start', stageId: 'rooftop' });
    send(mia, { t: 'finish', score: 9, made: 3, shots: 10, stars: 0 });
    rooms.disconnect('Zoe');
    expect(mia.last('results')!.ranking.map((x) => x.name)).toEqual(['Mia']);
    void zoe;
  });

  it('players who join mid-round sit out until the next one', () => {
    const [mia] = party('Mia');
    send(mia, { t: 'start', stageId: 'rooftop' });
    const zoe = player('Zoe');
    send(zoe, { t: 'join', code: mia.room!.code });
    expect(zoe.room!.players.find((p) => p.id === 'Zoe')!.inRound).toBe(false);
    send(mia, { t: 'finish', score: 5, made: 2, shots: 10, stars: 0 });
    expect(mia.last('results')!.ranking).toHaveLength(1);
  });

  it('times out rounds that never finish', () => {
    const [mia] = party('Mia', 'Zoe');
    send(mia, { t: 'start', stageId: 'rooftop' });
    clock += ROUND_TIMEOUT_MS - 1;
    rooms.tick();
    expect(mia.last('results')).toBeUndefined();
    clock += 2;
    rooms.tick();
    expect(mia.last('results')).toBeTruthy();
  });

  it('host can bring everyone back to the lobby after results', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(mia, { t: 'start', stageId: 'rooftop' });
    send(mia, { t: 'finish', score: 1, made: 1, shots: 10, stars: 0 });
    send(zoe, { t: 'finish', score: 2, made: 1, shots: 10, stars: 0 });
    send(zoe, { t: 'lobby' });
    expect(zoe.room!.state).toBe('results');
    send(mia, { t: 'lobby' });
    expect(zoe.room!.state).toBe('lobby');
  });

  it('rate limits emoji reactions and only allows the known set', () => {
    const [mia, zoe] = party('Mia', 'Zoe');
    send(zoe, { t: 'react', emoji: '🔥' });
    send(zoe, { t: 'react', emoji: '🔥' });
    expect(mia.all('react')).toHaveLength(1);
    clock += 300;
    send(zoe, { t: 'react', emoji: '💩' });
    expect(mia.all('react')).toHaveLength(1);
    send(zoe, { t: 'react', emoji: '👏' });
    expect(mia.all('react')).toHaveLength(2);
  });

  it('survives garbage messages', () => {
    const [mia] = party('Mia');
    expect(() => {
      rooms.handle('Mia', null as unknown as ClientMsg);
      rooms.handle('Mia', { t: 'nope' } as unknown as ClientMsg);
      rooms.handle('ghost', { t: 'create' });
    }).not.toThrow();
    expect(mia.room!.players).toHaveLength(1);
  });
});
