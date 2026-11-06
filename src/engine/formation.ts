import { BOARD_SIZE, PIECES_PER_SIDE, ZONE_DEPTH } from './types';
import type { CharacterId, Formation, FormationSlot, Level } from './types';
import { CHARACTERS, STARTER_IDS } from './characters';
import { josa } from './josa';

function isLevel(x: unknown): x is Level {
  return x === 1 || x === 2 || x === 3;
}

/**
 * Own-property check: `CHARACTERS[x]` alone is truthy for inherited keys such as "constructor",
 * "toString" or "__proto__", which corrupted or hostile saved data could contain.
 */
export function isCharacterId(x: unknown): x is CharacterId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CHARACTERS, x);
}

/** The characters of a formation, in slot order. */
export function squadOf(f: Formation): CharacterId[] {
  return f.map((s) => s.character);
}

/**
 * Validate a formation (local coordinates): exactly PIECES_PER_SIDE distinct known characters on
 * distinct squares inside the home zone. Error messages are Korean, suitable for the UI.
 */
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
    const def = isCharacterId(slot.character) ? CHARACTERS[slot.character] : undefined;
    const name = def ? def.nameKo : String(slot.character);
    if (!def) {
      errors.push(`알 수 없는 캐릭터입니다: ${String(slot.character)}`);
    } else if (seenChars.has(slot.character)) {
      errors.push(`${josa(name, '이/가')} 중복 배치되었습니다. 캐릭터마다 1개씩만 배치할 수 있습니다.`);
    }
    seenChars.add(slot.character);
    if (!isLevel(slot.level)) errors.push(`${name}의 성급이 올바르지 않습니다. (1~3성)`);
    const inZone =
      Number.isInteger(slot.row) &&
      Number.isInteger(slot.col) &&
      slot.row >= 0 &&
      slot.row < ZONE_DEPTH &&
      slot.col >= 0 &&
      slot.col < BOARD_SIZE;
    if (!inZone) {
      errors.push(`${josa(name, '이/가')} 배치 구역(자기 진영 ${ZONE_DEPTH}줄) 밖에 있습니다.`);
    } else {
      const key = `${slot.row},${slot.col}`;
      if (seenSquares.has(key)) errors.push(`같은 칸에 기물이 두 개 이상 배치되었습니다. (${slot.row}행 ${slot.col}열)`);
      seenSquares.add(key);
    }
  }
  return { ok: errors.length === 0, errors };
}

function lv(levels: Partial<Record<CharacterId, Level>> | undefined, id: CharacterId): Level {
  const l = levels?.[id];
  return isLevel(l) ? l : 1;
}

/**
 * Preset square per character (local coordinates, 2 x 10 zone): Marki, Sad, Michelle, Rakaeli,
 * Rampid and Larhen on the front row, Walk / Insaner / Picker / Brutile / Volkonov on the back rank. Every square is distinct, so any
 * squad of three gets a valid preset; all but Midos (column 1) stay off the two outer columns per
 * side that the storm swallows first.
 */
const DEFAULT_SLOT: Record<CharacterId, { row: number; col: number }> = {
  sad: { row: 1, col: 6 },
  marki: { row: 1, col: 3 },
  walk: { row: 0, col: 4 },
  insaner: { row: 0, col: 5 },
  brutile: { row: 0, col: 3 },
  // Michelle lays traps by stepping back, so she starts in front; Picker hops in from behind.
  michelle: { row: 1, col: 4 },
  picker: { row: 0, col: 6 },
  // Rakaeli jumps forward like Walk: the front row's free middle square.
  rakaeli: { row: 1, col: 5 },
  // Rampid's claw only reaches forward: up front. Larhen jumps sideways along his row.
  rampid: { row: 1, col: 2 },
  larhen: { row: 1, col: 7 },
  // Volkonov supports from behind (his melody reaches every ally wherever they stand).
  volkonov: { row: 0, col: 2 },
  // Verish pierces forward and sideways: the last free square, back rank.
  verish: { row: 0, col: 7 },
  // Midos: the inner columns are all taken, so the ghost waits on the front row's column 1 (still
  // clear of the first storm step); he slides sideways and can teleport out of any corner.
  midos: { row: 1, col: 1 },
};

/** Normalise a squad: distinct known characters, exactly PIECES_PER_SIDE of them (starters fill in). */
export function normalizeSquad(squad: readonly CharacterId[] | undefined): CharacterId[] {
  const out: CharacterId[] = [];
  for (const id of squad ?? []) if (isCharacterId(id) && !out.includes(id) && out.length < PIECES_PER_SIDE) out.push(id);
  for (const id of STARTER_IDS) if (out.length < PIECES_PER_SIDE && !out.includes(id)) out.push(id);
  return out;
}

/** A sensible preset for a squad (default: the three starters). */
export function defaultFormation(levels?: Partial<Record<CharacterId, Level>>, squad?: readonly CharacterId[]): Formation {
  return normalizeSquad(squad).map((id) => ({ character: id, level: lv(levels, id), ...DEFAULT_SLOT[id] }));
}

/** Random valid formation (distinct squares in the home zone) for a squad (default: the starters). */
export function randomFormation(
  rng: () => number = Math.random,
  levels?: Partial<Record<CharacterId, Level>>,
  squad?: readonly CharacterId[],
): Formation {
  const cells: number[] = [];
  for (let i = 0; i < ZONE_DEPTH * BOARD_SIZE; i++) cells.push(i);
  const out: FormationSlot[] = [];
  for (const id of normalizeSquad(squad)) {
    const k = Math.min(cells.length - 1, Math.floor(rng() * cells.length));
    const cell = cells.splice(k, 1)[0];
    out.push({ character: id, level: lv(levels, id), row: Math.floor(cell / BOARD_SIZE), col: cell % BOARD_SIZE });
  }
  return out;
}
