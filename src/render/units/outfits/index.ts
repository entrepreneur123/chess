/**
 * Outfit dispatcher: each character builder hides covered body parts, adds armour shells, gear,
 * weapons and secondary bones for its level (see the per-character files).
 */
import type { OutfitCtx } from '../kit';
import { minotaur } from './minotaur';
import { devil } from './devil';
import { paladin } from './paladin';
import { soldier } from './soldier';

export interface OutfitResult {
  /** Replace green texture areas (outfit cloth) by the team colour (0..1). */
  teamKey?: number;
}

export function buildOutfit(ctx: OutfitCtx): OutfitResult {
  switch (ctx.ch) {
    case 'sad':
      return paladin(ctx);
    case 'marki':
      return minotaur(ctx);
    case 'walk':
      return soldier(ctx);
    default:
      return devil(ctx);
  }
}
