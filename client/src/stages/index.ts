import { rooftop } from './rooftop';
import { lantern } from './lantern';
import { cliffs } from './cliffs';
import { island } from './island';
import { moon } from './moon';
import { portal } from './portal';
import { storm } from './storm';
import type { StageDef } from './stageTypes';

export const STAGES: StageDef[] = [rooftop, lantern, cliffs, island, moon, portal, storm];

export function stageById(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? rooftop;
}
