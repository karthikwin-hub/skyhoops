export const MAX_PLAYERS = 6;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export const BALL_COLORS = [
  '#ff7a1a',
  '#ff3d7f',
  '#a24bff',
  '#2f8bff',
  '#14c9b4',
  '#7ad63b',
  '#ffcf26',
  '#f2f2f2',
] as const;

export const AVATARS = ['🦄', '🐱', '🐼', '🦊', '🐸', '🐯', '🐧', '🐙', '🐰', '🐨', '🦋', '🐲'] as const;
export const REACTIONS = ['🔥', '😮', '👏', '😂', '💖', '🏀'] as const;

export interface Profile {
  name: string;
  color: string;
  avatar: string;
}

export interface PlayerSnapshot extends Profile {
  id: string;
  score: number;
  made: number;
  shots: number;
  streak: number;
  stars: number;
  inRound: boolean;
  finished: boolean;
}

export type RoomState = 'lobby' | 'playing' | 'results';

export interface RoomSnapshot {
  code: string;
  hostId: string;
  state: RoomState;
  stageId: string;
  players: PlayerSnapshot[];
}

export interface Ranking {
  id: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  made: number;
  shots: number;
}

export type Vec3Tuple = [number, number, number];

export type ClientMsg =
  | { t: 'hello'; profile: Profile }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'start'; stageId: string }
  | { t: 'lobby' }
  | { t: 'ball'; p: Vec3Tuple }
  | { t: 'ballEnd'; made: boolean }
  | { t: 'progress'; score: number; made: number; shots: number; streak: number; label?: string }
  | { t: 'finish'; score: number; made: number; shots: number; stars: number }
  | { t: 'react'; emoji: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; id: string }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'left' }
  | { t: 'start'; stageId: string; seed: number; startIn: number }
  | { t: 'ball'; id: string; p: Vec3Tuple }
  | { t: 'ballEnd'; id: string; made: boolean }
  | { t: 'feed'; id: string; label: string }
  | { t: 'react'; id: string; emoji: string }
  | { t: 'results'; ranking: Ranking[] }
  | { t: 'error'; message: string };

export function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 14) : '';
  const color = typeof r.color === 'string' && (BALL_COLORS as readonly string[]).includes(r.color) ? r.color : BALL_COLORS[0];
  const avatar = typeof r.avatar === 'string' && (AVATARS as readonly string[]).includes(r.avatar) ? r.avatar : AVATARS[0];
  if (!name) return null;
  return { name, color, avatar };
}
