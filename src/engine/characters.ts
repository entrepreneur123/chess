import type { AbsorbedAbility, CharacterDef, CharacterId, Level, SkillKind } from './types';

/** Every character, in roster order. */
export const CHARACTER_IDS: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli'];
/** The default squad of a new profile (every character is available to everyone). */
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
  brutile: {
    id: 'brutile',
    nameKo: '브루타일',
    nameEn: 'Brutile',
    rarity: 'legendary',
    descKo: ['앞쪽 좌우 대각선 1칸', '앞쪽 좌우 대각선 1칸 + 뒤로 1칸', '주변 8칸 어디로든 1칸'],
    value: [4, 6, 8],
    skill: {
      kind: 'waste',
      nameKo: '불모지',
      descKo: [
        '빈 칸 1칸을 불모지로 만듭니다. 불모지에 닿은 말은 소멸',
        '빈 칸 2×2(4칸)를 불모지로 만듭니다. 불모지에 닿은 말은 소멸',
        '빈 칸 3×3(9칸)을 불모지로 만듭니다. 불모지에 닿은 말은 소멸',
      ],
    },
  },
  michelle: {
    id: 'michelle',
    nameKo: '미셸',
    nameEn: 'Michelle',
    rarity: 'common',
    descKo: ['좌·우·뒤로 1칸 · 끝줄에서 방향 전환', '좌·우·뒤로 최대 2칸 직진 · 끝줄에서 방향 전환', '좌·우·뒤로 최대 2칸 직진 + 앞으로 1칸 · 끝줄에서 방향 전환'],
    value: [3, 4, 5],
    trait: {
      nameKo: '인형 함정',
      descKo: '처음 3번 뒤로 물러날 때 떠난 칸에 인형 함정을 남깁니다. 함정에 멈춘 상대 말은 다음 1턴 동안 이동·스킬 불가 (함정은 사라지지 않음)',
    },
  },
  picker: {
    id: 'picker',
    nameKo: '피커',
    nameEn: 'Picker',
    rarity: 'rare',
    descKo: ['대각선 4방향 1칸', '대각선 최대 2칸 콩콩 점프 · 지나는 적도 모두 잡음', '대각선 최대 3칸 콩콩 점프 · 지나는 적도 모두 잡음'],
    value: [3, 5, 7],
    trait: {
      nameKo: '콩콩',
      descKo: '칸마다 콩콩 뛰어 막히지 않습니다. 지나는 칸의 적은 모두 잡고 아군은 뛰어넘습니다. 상대 인형 함정에 닿으면 그 칸에서 멈춥니다',
    },
  },
  rakaeli: {
    id: 'rakaeli',
    nameKo: '라카엘리',
    nameEn: 'Rakaeli',
    rarity: 'epic',
    descKo: [
      '앞줄 3칸 중 원하는 칸으로 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
      '앞 2줄 × 3칸 중 원하는 칸으로 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
      '앞 2줄 × 3칸 + 뒤로 1칸 점프 (뛰어넘기 가능 · 끝줄에서 방향 전환)',
    ],
    awakeDescKo: ['앞줄 5칸 중 원하는 칸으로 점프', '앞 2줄 × 5칸 중 원하는 칸으로 점프', '앞 3줄 × 5칸 + 뒤로 1칸 점프'],
    // Self-play (2026-11-04, hard search at 25 ms): a bot valuing him [4, 6, 7] beat one valuing
    // him [3, 7, 8] 0.59 over 300 games and [4, 6, 8] 0.53 over 120, so the spec's start stays.
    value: [4, 6, 7],
    skill: {
      kind: 'transform',
      nameKo: '타천',
      descKo: [
        '타천해 다음 2번 이동 동안 앞줄 5칸으로 범위 확장',
        '타천해 다음 2번 이동 동안 앞 2줄 × 5칸으로 범위 확장',
        '타천해 다음 2번 이동 동안 앞 3줄 × 5칸 + 뒤 1칸으로 범위 확장',
      ],
    },
  },
};

/** Numeric character codes used by the fast move generator. */
export const CH_SAD = 0;
export const CH_MARKI = 1;
export const CH_WALK = 2;
export const CH_INSANER = 3;
export const CH_BRUTILE = 4;
export const CH_MICHELLE = 5;
export const CH_PICKER = 6;
export const CH_RAKAELI = 7;
export const CHAR_CODE: Record<CharacterId, number> = {
  sad: CH_SAD,
  marki: CH_MARKI,
  walk: CH_WALK,
  insaner: CH_INSANER,
  brutile: CH_BRUTILE,
  michelle: CH_MICHELLE,
  picker: CH_PICKER,
  rakaeli: CH_RAKAELI,
};
export const CHAR_BY_CODE: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli'];
/**
 * Number of character codes. Absorb masks hold 3 level bits per code, so they need N_CHARS * 3
 * bits: 24 today. They are stored in Uint32Array / int32 slots, which leaves room for 10 codes.
 */
export const N_CHARS = CHAR_BY_CODE.length;
if (N_CHARS * 3 > 30) throw new Error('absorb masks no longer fit in 31 bits: widen the storage');
/** All three level bits of Picker's pattern in an absorb mask (a hop-through pattern). */
export const PICKER_BITS = 0b111 << (CH_PICKER * 3);

/**
 * Game rule: a piece that reaches the far edge in its forward direction (the enemy's back rank)
 * turns around: its forward and backward swap. Only the fully symmetric movers (Sad, Picker) skip
 * the flip, because it would not change a single square they can reach. Michelle turns too: after
 * the flip her "back" (where she lays doll traps) points toward the enemy side.
 */
export function keepsDirection(ch: number): boolean {
  return ch === CH_SAD || ch === CH_PICKER;
}

/** Michelle's sideways / backward slide range by level (index = level); 3-star adds forward 1. */
export const MICHELLE_RANGE = [0, 1, 2, 2];
export const MICHELLE_FORWARD_LEVEL = 3;
/** Picker's diagonal hop range by level (index = level). */
export const PICKER_RANGE = [0, 1, 2, 3];

/**
 * Rakaeli's jump block by level (index = level): rows ahead (`DEPTH`) x columns within `HALF` of
 * his own; from RAKAELI_BACK_LEVEL he may also jump 1 square straight back. `AWAKE_*` is the
 * transformed form (while `Piece.awaken` > 0). Every square is a jump, like Walk's.
 */
export const RAKAELI_DEPTH = [0, 1, 2, 2];
export const RAKAELI_HALF = [0, 1, 1, 1];
export const RAKAELI_AWAKE_DEPTH = [0, 1, 2, 3];
export const RAKAELI_AWAKE_HALF = [0, 2, 2, 2];
export const RAKAELI_BACK_LEVEL = 3;

/** Sad orthogonal slide range by level (index = level). */
export const SAD_RANGE = [0, 1, 2, 3];
/** Marki forward slide range by level (index = level). */
export const MARKI_RANGE = [0, 3, 4, 6];
/** Walk half-width of the landing row by level (index = level). */
export const WALK_HALF = [0, 2, 3, 4];
/** Insaner orthogonal slide range by level (index = level); level 3 also slides diagonally. */
export const INSANER_RANGE = [0, 2, 3, 3];
export const INSANER_DIAG_LEVEL = 3;
/** Brutile wasteland side length by level (index = level): 1x1, 2x2, 3x3. */
export const WASTE_SIZE = [0, 1, 2, 3];

/** What a character's active skill does, or null when it has none. */
export function skillKindOf(character: CharacterId): SkillKind | null {
  return CHARACTERS[character].skill?.kind ?? null;
}

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
