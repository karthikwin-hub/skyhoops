import { AVATARS, BALL_COLORS, type Profile } from '@shared/protocol';
import { STAGES } from '../stages';

const KEY = 'skyhoops.progress.v1';
const PROFILE_KEY = 'skyhoops.profile.v1';

interface StageRecord {
  stars: number;
  best: number;
}

type Progress = Record<string, StageRecord>;

function load(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Progress;
  } catch {
    return {};
  }
}

export const progress = {
  get(id: string): StageRecord {
    return load()[id] ?? { stars: 0, best: 0 };
  },

  /** A stage is open once the one before it has at least one star. */
  unlocked(index: number): boolean {
    if (index === 0) return true;
    return this.get(STAGES[index - 1].id).stars > 0;
  },

  totalStars(): number {
    return STAGES.reduce((n, s) => n + this.get(s.id).stars, 0);
  },

  /** Saves a result, returning whether it beat the previous best. */
  record(id: string, score: number, stars: number): { newBest: boolean; unlockedNext: boolean } {
    const all = load();
    const prev = all[id] ?? { stars: 0, best: 0 };
    const idx = STAGES.findIndex((s) => s.id === id);
    const wasUnlocked = idx + 1 < STAGES.length && this.unlocked(idx + 1);
    all[id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, score) };
    localStorage.setItem(KEY, JSON.stringify(all));
    const nowUnlocked = idx + 1 < STAGES.length && this.unlocked(idx + 1);
    return { newBest: score > prev.best, unlockedNext: !wasUnlocked && nowUnlocked };
  },
};

export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null;
    if (p && p.name) return { name: p.name, color: p.color ?? BALL_COLORS[0], avatar: p.avatar ?? AVATARS[0] };
  } catch {
    /* ignore */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}
