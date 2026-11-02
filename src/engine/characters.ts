import type { AbsorbedAbility, CharacterDef, CharacterId, Level } from './types';

/** Every character, in roster order. */
export const CHARACTER_IDS: CharacterId[] = ['sad', 'marki', 'walk', 'insaner'];
/** Characters every account owns from the start (the legendary is unlocked from boxes). */
export const STARTER_IDS: CharacterId[] = ['sad', 'marki', 'walk'];

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  sad: {
    id: 'sad',
    nameKo: '사드',
    nameEn: 'Sad',
    rarity: 'common',
    descKo: ['상하좌우 1칸 이동', '상하좌우 최대 2칸 직진', '상하좌우 최대 3칸 직진'],
    value: [3, 4, 5],
  },
  marki: {
    id: 'marki',
    nameKo: '마르키',
    nameEn: 'Marki',
    rarity: 'rare',
    descKo: ['앞으로만 최대 3칸 직진 · 끝줄에서 방향 전환', '앞으로만 최대 4칸 직진 · 끝줄에서 방향 전환', '앞으로만 최대 6칸 직진 · 끝줄에서 방향 전환'],
    value: [3, 4, 6],
  },
  walk: {
    id: 'walk',
    nameKo: '월크',
    nameEn: 'Walk',
    rarity: 'epic',
    descKo: [
      '바로 앞줄 5칸 중 원하는 칸으로 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
      '바로 앞줄 7칸 중 원하는 칸으로 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
      '바로 앞줄 9칸 중 원하는 칸으로 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
    ],
    value: [4, 6, 8],
  },
  insaner: {
    id: 'insaner',
    nameKo: '인세이너',
    nameEn: 'Insaner',
    rarity: 'legendary',
    descKo: ['상하좌우 최대 2칸 직진', '상하좌우 최대 3칸 직진', '상하좌우·대각선 최대 3칸 직진 · 적을 잡으면 한 번 더 이동'],
    value: [5, 6, 8],
    passiveKo: '적을 잡으면 그 말의 이동 능력을 흡수해 자신의 이동에 더합니다',
  },
};

/** Numeric character codes used by the fast move generator. */
export const CH_SAD = 0;
export const CH_MARKI = 1;
export const CH_WALK = 2;
export const CH_INSANER = 3;
export const CHAR_CODE: Record<CharacterId, number> = { sad: CH_SAD, marki: CH_MARKI, walk: CH_WALK, insaner: CH_INSANER };
export const CHAR_BY_CODE: CharacterId[] = ['sad', 'marki', 'walk', 'insaner'];

/** Sad orthogonal slide range by level (index = level). */
export const SAD_RANGE = [0, 1, 2, 3];
/** Marki forward slide range by level (index = level). */
export const MARKI_RANGE = [0, 3, 4, 6];
/** Walk half-width of the landing row by level (index = level). */
export const WALK_HALF = [0, 2, 3, 4];
/** Insaner orthogonal slide range by level (index = level); level 3 also slides diagonally. */
export const INSANER_RANGE = [0, 2, 3, 3];
export const INSANER_DIAG_LEVEL = 3;

export function pieceValue(character: CharacterId, level: Level): number {
  return CHARACTERS[character].value[level - 1];
}

/** Bit for one (character, level) movement pattern in an absorb mask. */
export function abilityBit(ch: number, level: number): number {
  return 1 << (ch * 3 + (level - 1));
}

/** Bitmask of absorbed movement patterns (0 when nothing was absorbed). */
export function absorbMaskOf(abs: AbsorbedAbility[] | undefined): number {
  if (!abs) return 0;
  let m = 0;
  for (const a of abs) m |= abilityBit(CHAR_CODE[a.character], a.level);
  return m;
}

/** Material value of a piece including half the value of every absorbed ability. */
export function effectiveValue(character: CharacterId, level: Level, abs?: AbsorbedAbility[]): number {
  let v = pieceValue(character, level);
  if (abs) for (const a of abs) v += pieceValue(a.character, a.level) / 2;
  return Math.floor(v);
}
