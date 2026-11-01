import { BOARD_SIZE, PIECES_PER_SIDE, ZONE_DEPTH } from './types';
import type { CharacterId, Formation, FormationSlot, Level } from './types';
import { CHARACTERS, CHARACTER_IDS } from './characters';

function isLevel(x: unknown): x is Level {
  return x === 1 || x === 2 || x === 3;
}

/** Validate a formation (local coordinates). Error messages are Korean, suitable for the UI. */
export function validateFormation(f: Formation): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(f)) return { ok: false, errors: ['배치 정보가 올바르지 않습니다.'] };
  if (f.length !== PIECES_PER_SIDE) {
    errors.push(`기물은 정확히 ${PIECES_PER_SIDE}개를 배치해야 합니다. (현재 ${f.length}개)`);
  }
  const seenChars = new Set<string>();
  const seenSquares = new Set<string>();
  for (const slot of f) {
    if (!slot || typeof slot !== 'object') {
      errors.push('배치 정보가 올바르지 않습니다.');
      continue;
    }
    const def = CHARACTERS[slot.character as CharacterId];
    const name = def ? def.nameKo : String(slot.character);
    if (!def) {
      errors.push(`알 수 없는 캐릭터입니다: ${String(slot.character)}`);
    } else if (seenChars.has(slot.character)) {
      errors.push(`${name}이(가) 중복 배치되었습니다. 캐릭터마다 1개씩만 배치할 수 있습니다.`);
    }
    seenChars.add(slot.character);
    if (!isLevel(slot.level)) errors.push(`${name}의 레벨이 올바르지 않습니다. (1~3)`);
    const inZone =
      Number.isInteger(slot.row) &&
      Number.isInteger(slot.col) &&
      slot.row >= 0 &&
      slot.row < ZONE_DEPTH &&
      slot.col >= 0 &&
      slot.col < BOARD_SIZE;
    if (!inZone) {
      errors.push(`${name}이(가) 배치 구역(자기 진영 ${ZONE_DEPTH}줄) 밖에 있습니다.`);
    } else {
      const key = `${slot.row},${slot.col}`;
      if (seenSquares.has(key)) errors.push(`같은 칸에 기물이 두 개 이상 배치되었습니다. (${slot.row}행 ${slot.col}열)`);
      seenSquares.add(key);
    }
  }
  for (const id of CHARACTER_IDS) {
    if (!seenChars.has(id)) errors.push(`${CHARACTERS[id].nameKo}이(가) 배치되지 않았습니다.`);
  }
  return { ok: errors.length === 0, errors };
}

function lv(levels: Partial<Record<CharacterId, Level>> | undefined, id: CharacterId): Level {
  const l = levels?.[id];
  return isLevel(l) ? l : 1;
}

/** A sensible preset: Marki and Sad on the front row, Walk behind them in the middle. */
export function defaultFormation(levels?: Partial<Record<CharacterId, Level>>): Formation {
  return [
    { character: 'sad', level: lv(levels, 'sad'), row: 2, col: 7 },
    { character: 'marki', level: lv(levels, 'marki'), row: 2, col: 4 },
    { character: 'walk', level: lv(levels, 'walk'), row: 1, col: 5 },
  ];
}

/** Random valid formation (3 distinct squares in the home zone). */
export function randomFormation(
  rng: () => number = Math.random,
  levels?: Partial<Record<CharacterId, Level>>,
): Formation {
  const cells: number[] = [];
  for (let i = 0; i < ZONE_DEPTH * BOARD_SIZE; i++) cells.push(i);
  const out: FormationSlot[] = [];
  for (const id of CHARACTER_IDS) {
    const k = Math.min(cells.length - 1, Math.floor(rng() * cells.length));
    const cell = cells.splice(k, 1)[0];
    out.push({ character: id, level: lv(levels, id), row: Math.floor(cell / BOARD_SIZE), col: cell % BOARD_SIZE });
  }
  return out;
}
