import type { AbsorbedAbility, CharacterDef, CharacterId, Level, SkillKind } from './types';

/** Every character, in roster order. */
export const CHARACTER_IDS: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli', 'rampid', 'larhen', 'volkonov', 'verish', 'midos', 'hammont', 'venoa', 'glacia'];
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
    descKo: ['앞으로만 최대 3칸 직진 · 끝줄에서 방향 전환', '앞으로만 최대 4칸 직진 · 끝줄에서 방향 전환', '앞으로 최대 5칸 직진 + 좌우 1칸 · 끝줄에서 방향 전환'],
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
    descKo: [
      '상하좌우 최대 2칸 직진',
      '상하좌우 최대 3칸 직진',
      '상하좌우 최대 3칸 직진 · 적을 잡으면 한 번 더 이동 (추가 이동은 턴당 1번, 연속 추가 이동 없음)',
    ],
    value: [5, 6, 8],
    passiveKo: '적을 잡으면 그 말의 이동 범위를 자신의 이동에 더합니다. 이동 범위만 흡수 (특성·스킬은 흡수 안 함)',
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
    descKo: ['좌·우·뒤로 1칸 · 끝줄에서 방향 전환', '좌·우·뒤로 최대 2칸 직진 + 앞으로 1칸 · 끝줄에서 방향 전환', '좌·우·뒤로 최대 2칸 직진 + 앞으로 최대 2칸 직진 · 끝줄에서 방향 전환'],
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
  rampid: {
    id: 'rampid',
    nameKo: '램피드',
    nameEn: 'Rampid',
    rarity: 'common',
    descKo: [
      '앞 · 앞쪽 좌우 대각선 1칸 (발톱) · 끝줄에서 방향 전환',
      '앞 · 앞쪽 좌우 대각선 최대 2칸 직진 · 끝줄에서 방향 전환',
      '앞 · 앞쪽 좌우 대각선 최대 3칸 직진 · 끝줄에서 방향 전환',
    ],
    value: [3, 4, 5],
  },
  larhen: {
    id: 'larhen',
    nameKo: '라르헨',
    nameEn: 'Larhen',
    rarity: 'common',
    descKo: [
      '좌우 1칸 + 앞쪽 좌우 대각선 1칸 점프 (뛰어넘기 가능)',
      '좌우 1칸 + 대각선 4방향 1칸 점프 (H자 · 뛰어넘기 가능)',
      '좌우 1칸 + 양옆 줄 앞뒤 2칸까지 점프 (세로로 긴 H자 · 뛰어넘기 가능)',
    ],
    value: [3, 4, 5],
  },
  volkonov: {
    id: 'volkonov',
    nameKo: '볼코노프',
    nameEn: 'Volkonov',
    rarity: 'common',
    descKo: ['상하좌우 1칸 이동', '상하좌우 최대 2칸 직진', '상하좌우 최대 2칸 직진'],
    value: [3, 4, 5],
    skill: {
      kind: 'buff',
      nameKo: '선율',
      descKo: [
        '다른 아군 전원이 3턴 동안 상하좌우로 1칸 더 이동 (그 방향 이동이 없던 말도 1칸)',
        '다른 아군 전원이 3턴 동안 상하좌우로 1칸 더 이동 (그 방향 이동이 없던 말도 1칸)',
        '다른 아군 전원이 4턴 동안 상하좌우로 1칸 더 이동 (그 방향 이동이 없던 말도 1칸)',
      ],
    },
  },
  verish: {
    id: 'verish',
    nameKo: '베리쉬',
    nameEn: 'Verish',
    rarity: 'rare',
    descKo: [
      '좌우 1칸 + 앞으로 최대 2칸 관통 슬라이드 · 끝줄에서 방향 전환',
      '좌우 최대 2칸 + 앞으로 최대 2칸 관통 슬라이드 · 끝줄에서 방향 전환',
      '좌우 최대 2칸 + 앞으로 최대 3칸 + 뒤로 1칸 관통 슬라이드 · 끝줄에서 방향 전환',
    ],
    value: [3, 5, 7],
    trait: {
      nameKo: '관통',
      descKo: '슬라이드하며 지나는 칸의 적을 모두 잡고 뚫고 지나갑니다. 아군 · 불모지 · 벽 · 자기장에는 막혀 그 앞에서 멈춥니다',
    },
  },
  midos: {
    id: 'midos',
    nameKo: '미도스',
    nameEn: 'Midos',
    rarity: 'epic',
    descKo: [
      '좌 · 우 · 앞으로 1칸 (뒤 · 대각선 불가) · 끝줄에서 방향 전환',
      '좌 · 우 · 앞으로 최대 2칸 직진 (뒤 · 대각선 불가) · 끝줄에서 방향 전환',
      '좌 · 우 · 앞으로 최대 3칸 직진 (뒤 · 대각선 불가) · 끝줄에서 방향 전환',
    ],
    value: [4, 5, 6],
    skill: {
      kind: 'blink',
      nameKo: '그림자 도약',
      descKo: [
        '보드의 빈 칸 어디로든 순간이동 (말 · 불모지 · 상대 함정이 없는 칸)',
        '보드의 빈 칸 어디로든 순간이동 (말 · 불모지 · 상대 함정이 없는 칸)',
        '보드의 빈 칸 어디로든 순간이동 (말 · 불모지 · 상대 함정이 없는 칸)',
      ],
    },
  },
  hammont: {
    id: 'hammont',
    nameKo: '해먼트',
    nameEn: 'Hammont',
    rarity: 'rare',
    descKo: [
      '상하좌우 최대 2칸 직진 · 적을 치면 잡지 않고 1칸 밀쳐냄 (막히면 분쇄)',
      '상하좌우 최대 3칸 직진 · 적을 치면 1칸 밀쳐냄 (막히면 분쇄)',
      '상하좌우 최대 3칸 직진 · 적을 치면 1칸 밀쳐내고 1턴 기절 (막히면 분쇄)',
    ],
    value: [3, 4, 6],
    trait: {
      nameKo: '해머 강타',
      descKo: '적에게 부딪히면 잡는 대신 그 칸을 차지하고 적을 같은 방향으로 1칸 날려 보냅니다. 뒤가 벽 · 자기장 · 다른 말 · 불모지로 막혀 있으면 적은 분쇄됩니다 (3성: 날아간 적은 다음 1턴 기절)',
    },
  },
  venoa: {
    id: 'venoa',
    nameKo: '베노아',
    nameEn: 'Venoa',
    rarity: 'rare',
    descKo: [
      '상하좌우 1칸 · 앞으로 2~3칸 거리의 적을 독화살로 저격',
      '상하좌우 1칸 · 앞과 앞쪽 대각선 2~3칸 거리의 적을 저격',
      '상하좌우 1칸 · 앞과 앞쪽 대각선 2~4칸 거리의 적을 저격',
    ],
    value: [4, 5, 6],
    trait: {
      nameKo: '독화살',
      descKo: '움직이지 않고 2칸 이상 떨어진 적을 쏘아 잡습니다. 화살은 사이에 있는 말에 막힙니다 (끝줄에서 방향 전환)',
    },
  },
  glacia: {
    id: 'glacia',
    nameKo: '글라시아',
    nameEn: 'Glacia',
    rarity: 'epic',
    descKo: [
      '상하좌우로 막힐 때까지 빙판 활주 (멈출 수 없음 · 활주로는 못 잡음) + 대각선 1칸',
      '상하좌우로 막힐 때까지 빙판 활주 + 대각선 1칸',
      '상하좌우로 막힐 때까지 빙판 활주 + 대각선 최대 2칸 직진',
    ],
    value: [4, 5, 6],
    skill: {
      kind: 'freeze',
      nameKo: '빙결',
      descKo: [
        '주변 2칸 안의 적 1명을 얼려 다음 1턴 동안 이동 · 스킬 불가',
        '주변 3칸 안의 적 1명을 얼려 다음 1턴 동안 이동 · 스킬 불가',
        '주변 4칸 안의 적 1명을 얼려 다음 1턴 동안 이동 · 스킬 불가',
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
export const CH_RAMPID = 8;
export const CH_LARHEN = 9;
export const CH_VOLKONOV = 10;
export const CH_VERISH = 11;
export const CH_MIDOS = 12;
export const CH_HAMMONT = 13;
export const CH_VENOA = 14;
export const CH_GLACIA = 15;
export const CHAR_CODE: Record<CharacterId, number> = {
  sad: CH_SAD,
  marki: CH_MARKI,
  walk: CH_WALK,
  insaner: CH_INSANER,
  brutile: CH_BRUTILE,
  michelle: CH_MICHELLE,
  picker: CH_PICKER,
  rakaeli: CH_RAKAELI,
  rampid: CH_RAMPID,
  larhen: CH_LARHEN,
  volkonov: CH_VOLKONOV,
  verish: CH_VERISH,
  midos: CH_MIDOS,
  hammont: CH_HAMMONT,
  venoa: CH_VENOA,
  glacia: CH_GLACIA,
};
export const CHAR_BY_CODE: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli', 'rampid', 'larhen', 'volkonov', 'verish', 'midos', 'hammont', 'venoa', 'glacia'];
/**
 * Number of character codes. An absorb mask holds, per code, the highest absorbed level of that
 * character's pattern in ABSORB_FIELD_BITS bits (see `absorbMerge`), so it needs N_CHARS * 2 bits:
 * 32 today, the whole of a 32-bit word. Masks are uint32 bit patterns: the field of code 15 uses
 * bit 31, so a mask held in a plain JS number may read negative (int32) while the FastBoard keeps it
 * in a Uint32Array; every reader goes through `>>>` (`absorbedLevel`), which sees both the same.
 * A 17th character needs wider storage (two words, or Float64 arithmetic).
 */
export const N_CHARS = CHAR_BY_CODE.length;
/** Bits per character code in an absorb mask: the absorbed level 0..3. */
export const ABSORB_FIELD_BITS = 2;
if (N_CHARS * ABSORB_FIELD_BITS > 32) throw new Error('absorb masks no longer fit in 32 bits: widen the storage');

/**
 * Game rule: a piece that reaches the far edge in its forward direction (the enemy's back rank)
 * turns around: its forward and backward swap. Only the fully symmetric movers (Sad, Picker,
 * Volkonov, Hammont, Glacia) skip the flip, because it would not change a single square they can reach. Michelle
 * turns too: after the flip her "back" (where she lays doll traps) points toward the enemy side.
 */
export function keepsDirection(ch: number): boolean {
  return ch === CH_SAD || ch === CH_PICKER || ch === CH_VOLKONOV || ch === CH_HAMMONT || ch === CH_GLACIA;
}

/** Rampid's three-pronged "claw" (forward, forward-left, forward-right) slide range by level. */
export const RAMPID_RANGE = [0, 1, 2, 3];
/**
 * Larhen jumps (nothing in between blocks him) by level: left / right 1, the two forward diagonals
 * 1, from LARHEN_BACK_LEVEL the two backward diagonals 1 too (an "H" around him), and from
 * LARHEN_TALL_LEVEL the H grows one row taller at both ends: the squares two rows ahead and two
 * rows behind in the columns beside him (owner, 2026-11-05).
 */
export const LARHEN_BACK_LEVEL = 2;
export const LARHEN_TALL_LEVEL = 3;
/**
 * Verish's pierce slides by level (index = level): sideways (left and right) and forward up to
 * these lengths, and straight back from VERISH_BACK_LEVEL. Every enemy on the way is captured and
 * passed; her own pieces, wasteland, the board edge and the storm stop her before the square.
 */
export const VERISH_SIDE = [0, 1, 2, 2];
export const VERISH_FORWARD = [0, 2, 2, 3];
export const VERISH_BACK = [0, 0, 0, 1];
/**
 * Midos's slides by level (index = level): left, right and straight forward, never back or
 * diagonally. His skill "그림자 도약" teleports him to any free square instead (see `blinkAnchors`).
 */
export const MIDOS_RANGE = [0, 1, 2, 3];
/**
 * Hammont's orthogonal slide range by level (index = level). Every enemy he runs into is knocked
 * back one square instead of captured (crushed when it cannot go); from HAMMONT_STUN_LEVEL the
 * knocked enemy is also stunned for its owner's next turn.
 */
// Self-play (2026-11-06): with 1 / 2 / 2 a 1성 Hammont squad scored 0.10 against the reference squad
// (every other 1성 0.30-0.84), so his reach went up one square at 1성 and 2성.
export const HAMMONT_RANGE = [0, 2, 3, 3];
export const HAMMONT_STUN_LEVEL = 3;
/**
 * Venoa steps 1 square orthogonally and shoots ("독화살") along her shot lanes: straight forward,
 * and from VENOA_DIAG_LEVEL the two forward diagonals too, hitting the FIRST piece of the lane if it
 * is an enemy at a distance of VENOA_SHOT_MIN..VENOA_SHOT_MAX[level] squares. She stays put.
 */
export const VENOA_SHOT_MIN = 2;
export const VENOA_SHOT_MAX = [0, 3, 3, 4];
export const VENOA_DIAG_LEVEL = 2;
/**
 * Glacia glides ("빙판 활주") orthogonally until something stops her (she cannot stop early and
 * never captures by gliding) and steps diagonally up to GLACIA_DIAG[level] squares (a normal slide
 * that may capture). Her skill "빙결" freezes one enemy within GLACIA_FREEZE[level] squares
 * (Chebyshev distance).
 */
export const GLACIA_DIAG = [0, 1, 1, 2];
export const GLACIA_FREEZE = [0, 2, 3, 4];
/** Volkonov's orthogonal slide range by level (index = level). */
export const VOLKONOV_RANGE = [0, 1, 2, 2];

/** Michelle's sideways / backward slide range by level (index = level). */
export const MICHELLE_RANGE = [0, 1, 2, 2];
/**
 * Michelle's straight forward slide by level (index = level): none at 1-star, 1 square at 2-star,
 * up to 2 at 3-star (blocked by pieces like her other slides). Her doll traps stay backward-only.
 */
export const MICHELLE_FORWARD_RANGE = [0, 0, 1, 2];
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
export const MARKI_RANGE = [0, 3, 4, 5];
/** From this level Marki may also step 1 square left or right (a plain 1-square slide). */
export const MARKI_SIDE_LEVEL = 3;
/** Walk half-width of the landing row by level (index = level). */
export const WALK_HALF = [0, 2, 3, 4];
/** Insaner orthogonal slide range by level (index = level). */
export const INSANER_RANGE = [0, 2, 3, 3];
/** Brutile wasteland side length by level (index = level): 1x1, 2x2, 3x3. */
export const WASTE_SIZE = [0, 1, 2, 3];

/** What a character's active skill does, or null when it has none. */
export function skillKindOf(character: CharacterId): SkillKind | null {
  return CHARACTERS[character].skill?.kind ?? null;
}

export function pieceValue(character: CharacterId, level: Level): number {
  return CHARACTERS[character].value[level - 1];
}

/**
 * Absorb mask holding one (character, level) movement pattern. A mask stores, per character code,
 * the HIGHEST absorbed level only: every character's pattern at a level contains its pattern at
 * every lower level (tests/characters-new.test.ts checks this nesting), so the union of several
 * levels of one character is simply the highest one. Combine masks with `absorbMerge`, never `|`.
 */
export function abilityBit(ch: number, level: number): number {
  return level << (ch * ABSORB_FIELD_BITS);
}

/** Level of character code `ch` in absorb mask `mask` (0 = not absorbed). */
export function absorbedLevel(mask: number, ch: number): number {
  return (mask >>> (ch * ABSORB_FIELD_BITS)) & 3;
}

/** Union of two absorb masks: the higher level per character. */
export function absorbMerge(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  let m = 0;
  for (let ch = 0; ch < N_CHARS; ch++) {
    const la = absorbedLevel(a, ch);
    const lb = absorbedLevel(b, ch);
    const l = la > lb ? la : lb;
    if (l) m |= l << (ch * ABSORB_FIELD_BITS);
  }
  return m;
}

/** `mask` without the holder's own pattern (`ch` at exactly `level`): it adds nothing. */
export function absorbWithout(mask: number, ch: number, level: number): number {
  return absorbedLevel(mask, ch) === level ? mask & ~(3 << (ch * ABSORB_FIELD_BITS)) : mask;
}

/** Absorb mask of a list of absorbed movement patterns (0 when nothing was absorbed). */
export function absorbMaskOf(abs: AbsorbedAbility[] | undefined): number {
  if (!abs) return 0;
  let m = 0;
  for (const a of abs) m = absorbMerge(m, abilityBit(CHAR_CODE[a.character], a.level));
  return m;
}

/** Material value of a piece including half the value of every absorbed ability. */
export function effectiveValue(character: CharacterId, level: Level, abs?: AbsorbedAbility[]): number {
  let v = pieceValue(character, level);
  if (abs) for (const a of abs) v += pieceValue(a.character, a.level) / 2;
  return Math.floor(v);
}
