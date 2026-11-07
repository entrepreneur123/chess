/**
 * Venoa's shot targets are marked apart from captures and by whose Venoa aims: the game screen
 * passes the shot squares as `BoardHighlights.shots` (a subset of `captures`), and the boards draw
 * them as a reticle in the tone's shot colour (own: venom lime, enemy reach preview: magenta) with
 * a matching tile tint. Plain captures keep the red ring whatever the tone. Her whole arrow range
 * (`getShotRange`: every empty square her arrows fly over) is tinted and marked in the same colour.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, getLegalMoves, getPieceById, getShotRange, getTargetsForPiece, type CharacterId, type Level, type Move } from '../src/engine';
import { indexHighlights, tileRgb } from '../src/render/common';
import { BOARD_COLORS } from '../src/render/palette';
import { key, keys, makeState, rngFrom, type Spec } from './helpers';

/** The split game.ts makes for the board: capture targets and the shots among them. */
const split = (moves: Move[]) => ({
  captures: moves.filter((m) => m.captureId || m.push).map((m) => m.to),
  shots: moves.filter((m) => m.shot).map((m) => m.to),
});

describe('Venoa shot markers', () => {
  it('own Venoa: shots are the far captures only (an adjacent capture stays a capture)', () => {
    // Shot lane forward (up the board for player 0): walk 2 ahead; sad right next to her.
    const s = makeState([[0, 'venoa', 1, 4, 4], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 4, 5]]);
    const { captures, shots } = split(getLegalMoves(s, 'p0-venoa'));
    expect(captures.map(key).sort()).toEqual(['4,5', '6,4']);
    expect(shots.map(key)).toEqual(['6,4']);
  });

  it("enemy Venoa's reach preview flags her shots too", () => {
    // Player 1 shoots down the board: my sad two squares below her.
    const s = makeState([[1, 'venoa', 1, 6, 4], [0, 'sad', 1, 4, 4], [0, 'walk', 1, 0, 0]]);
    const venoa = getPieceById(s, 'p1-venoa')!;
    const { shots } = split(getTargetsForPiece(s, venoa));
    expect(shots.map(key)).toEqual(['4,4']);
  });

  it('an Insaner that absorbed Venoa never shoots (no shot squares)', () => {
    const s = makeState([[0, 'insaner', 1, 4, 4], [1, 'walk', 1, 6, 4], [1, 'sad', 1, 9, 9]]);
    s.pieces[0].absorbed = [{ character: 'venoa', level: 3 }];
    expect(split(getLegalMoves(s, 'p0-insaner')).shots).toEqual([]);
  });

  it('palette: own shot, enemy shot and the capture ring are three different colours', () => {
    const cols = [BOARD_COLORS.shotOwn, BOARD_COLORS.shotEnemy, BOARD_COLORS.capture].map((c) => c.toLowerCase());
    expect(new Set(cols).size).toBe(3);
    const tints = [BOARD_COLORS.shotOwnTint, BOARD_COLORS.shotEnemyTint, BOARD_COLORS.captureTint].map((c) => c.toLowerCase());
    expect(new Set(tints).size).toBe(3);
  });

  it('tile tint: a shot square follows the tone; a plain capture does not', () => {
    const at = { r: 6, c: 4 };
    const shotOwn = tileRgb(6, 4, indexHighlights({ captures: [at], shots: [at], tone: 'own' }));
    const shotFoe = tileRgb(6, 4, indexHighlights({ captures: [at], shots: [at], tone: 'enemy' }));
    const capOwn = tileRgb(6, 4, indexHighlights({ captures: [at], tone: 'own' }));
    const capFoe = tileRgb(6, 4, indexHighlights({ captures: [at], tone: 'enemy' }));
    expect(shotOwn).not.toEqual(shotFoe);
    expect(shotOwn).not.toEqual(capOwn);
    expect(shotFoe).not.toEqual(capFoe);
    expect(capOwn).toEqual(capFoe);
    // Lime leans green, magenta leans red + blue.
    expect(shotOwn[1]).toBeGreaterThan(shotOwn[2]);
    expect(shotFoe[2]).toBeGreaterThan(shotFoe[1]);
  });

  it('a shot square outside captures is not tinted (shots only refine captures)', () => {
    const at = { r: 6, c: 4 };
    const plain = tileRgb(6, 4, indexHighlights({}));
    expect(tileRgb(6, 4, indexHighlights({ shots: [at] }))).toEqual(plain);
  });
});

describe('Venoa arrow range (getShotRange)', () => {
  const range = (specs: Spec[], id = 'p0-venoa', extra = {}) => {
    const s = makeState(specs, 0, extra);
    return getShotRange(s, getPieceById(s, id)!).map(key).sort();
  };

  it('1성: straight forward 2..3; 3성: forward and both forward diagonals 2..4', () => {
    expect(range([[0, 'venoa', 1, 4, 4], [1, 'sad', 1, 0, 0]])).toEqual(keys([[6, 4], [7, 4]]));
    expect(range([[0, 'venoa', 3, 4, 4], [1, 'sad', 1, 0, 0]])).toEqual(
      keys([[6, 4], [7, 4], [8, 4], [6, 6], [7, 7], [8, 8], [6, 2], [7, 1], [8, 0]]),
    );
  });

  it('the first piece blocks the lane; the arrow flies over the square right in front of her', () => {
    // Enemy 2 ahead: it is the target, nothing past it is in range.
    expect(range([[0, 'venoa', 1, 4, 4], [1, 'sad', 1, 6, 4]])).toEqual([]);
    // Enemy 3 ahead: the square before it is in range (and the enemy is a shot target).
    expect(range([[0, 'venoa', 1, 4, 4], [1, 'sad', 1, 7, 4]])).toEqual(keys([[6, 4]]));
    // Any piece right in front of her blocks the whole lane.
    expect(range([[0, 'venoa', 1, 4, 4], [0, 'sad', 1, 5, 4], [1, 'walk', 1, 0, 0]])).toEqual([]);
  });

  it('an enemy Venoa aims down the board', () => {
    expect(range([[1, 'venoa', 1, 6, 4], [0, 'sad', 1, 0, 0]], 'p1-venoa')).toEqual(keys([[4, 4], [3, 4]]));
  });

  it('the edge and the storm end a lane; wasteland does not', () => {
    expect(range([[0, 'venoa', 1, 8, 4], [1, 'sad', 1, 0, 0]])).toEqual([]);
    expect(range([[0, 'venoa', 3, 4, 4], [1, 'sad', 1, 0, 5]], 'p0-venoa', { storm: 1 })).toEqual(
      keys([[6, 4], [7, 4], [8, 4], [6, 6], [7, 7], [8, 8], [6, 2], [7, 1]]),
    );
    expect(range([[0, 'venoa', 1, 4, 4], [1, 'sad', 1, 0, 0]], 'p0-venoa', { waste: [64] })).toEqual(keys([[6, 4], [7, 4]]));
  });

  it('nothing for a stunned Venoa or any other piece', () => {
    const s = makeState([[0, 'venoa', 3, 4, 4], [0, 'insaner', 3, 2, 2], [1, 'sad', 1, 0, 0]]);
    s.pieces[0].stun = 1;
    expect(getShotRange(s, s.pieces[0])).toEqual([]);
    s.pieces[1].absorbed = [{ character: 'venoa', level: 3 }];
    expect(getShotRange(s, s.pieces[1])).toEqual([]);
  });

  it('matches the shot rule: every shot flies over range squares only, and range squares are empty', () => {
    const rnd = rngFrom(20261107);
    const others = CHARACTER_IDS.filter((c) => c !== 'venoa');
    let shots = 0;
    let lanes = 0;
    for (let i = 0; i < 400; i++) {
      const used = new Set<number>();
      const free = (): [number, number] => {
        for (;;) {
          const q = Math.floor(rnd() * 100);
          if (!used.has(q)) {
            used.add(q);
            return [Math.floor(q / 10), q % 10];
          }
        }
      };
      const owner = rnd() < 0.5 ? 0 : 1;
      const lv = (1 + Math.floor(rnd() * 3)) as Level;
      const specs: Spec[] = [[owner, 'venoa', lv, ...free()]];
      for (let k = 0; k < 4; k++) {
        const ch = others[Math.floor(rnd() * others.length)] as CharacterId;
        if (specs.some(([o, c]) => c === ch && o === (k % 2 ? 0 : 1))) continue;
        specs.push([k % 2 ? 0 : 1, ch, 1, ...free()]);
      }
      const s = makeState(specs, owner, { storm: rnd() < 0.3 ? 1 : 0 });
      const v = s.pieces[0];
      if (s.storm && (v.pos.c === 0 || v.pos.c === 9)) continue;
      const inRange = new Set(getShotRange(s, v).map(key));
      lanes += inRange.size;
      for (const k of inRange) expect(s.pieces.some((p) => key(p.pos) === k)).toBe(false);
      for (const m of getTargetsForPiece(s, v).filter((x) => x.shot)) {
        const dr = Math.sign(m.to.r - m.from.r);
        const dc = Math.sign(m.to.c - m.from.c);
        const d = Math.max(Math.abs(m.to.r - m.from.r), Math.abs(m.to.c - m.from.c));
        shots++;
        for (let k = 2; k < d; k++) expect(inRange.has(key({ r: m.from.r + dr * k, c: m.from.c + dc * k }))).toBe(true);
      }
    }
    // The sample really exercises both (not a vacuous pass).
    expect(shots).toBeGreaterThan(20);
    expect(lanes).toBeGreaterThan(200);
  });

  it('tile tint: the range follows the tone and is lighter than a target', () => {
    const at = { r: 7, c: 4 };
    const own = tileRgb(7, 4, indexHighlights({ shotRange: [at], tone: 'own' }));
    const foe = tileRgb(7, 4, indexHighlights({ shotRange: [at], tone: 'enemy' }));
    const plain = tileRgb(7, 4, indexHighlights({}));
    expect(own).not.toEqual(plain);
    expect(foe).not.toEqual(plain);
    expect(own).not.toEqual(foe);
    expect(own[1]).toBeGreaterThan(own[2]);
    expect(foe[2]).toBeGreaterThan(foe[1]);
  });
});
