import { SKILL_UNLOCK_PLY, SKILL_USES_PER_MATCH, STORM_INTERVAL_PLIES, SUDDEN_DEATH_PLY, TRAPS_PER_MICHELLE, TRAP_STUN, TURN_TIME_1_MS, TURN_TIME_2_MS, TURN_TIME_MS } from './types';
import type { AbsorbedAbility, EndReason, Formation, GameState, HistoryEntry, Move, PassReason, Piece, PlayerId, Pos, SkillAction, Trap } from './types';
import { BOARD_SIZE } from './types';
import { CHARACTERS, CHAR_CODE, WASTE_SIZE, absorbMaskOf, effectiveValue, keepsDirection } from './characters';
import { N_SQUARES, atTurnRow, canHop, formationToAbsolute, forwardDir, genTargets, inStorm, isOnBoard, posOf, sqOf, trapBit } from './board';
import { validateFormation } from './formation';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function createGame(f0: Formation, f1: Formation, firstTurn: PlayerId = 0): GameState {
  const pieces: Piece[] = [];
  const fs: [Formation, Formation] = [f0, f1];
  for (const owner of [0, 1] as PlayerId[]) {
    const v = validateFormation(fs[owner]);
    if (!v.ok) throw new Error(`Invalid formation for player ${owner}: ${v.errors.join(' / ')}`);
    for (const slot of fs[owner]) {
      pieces.push({
        id: `p${owner}-${slot.character}`,
        owner,
        character: slot.character,
        level: slot.level,
        pos: formationToAbsolute(owner, slot),
      });
    }
  }
  const state: GameState = {
    pieces,
    turn: firstTurn,
    ply: 0,
    pliesSinceCapture: 0,
    consecutiveTimeouts: [0, 0],
    status: 'playing',
    winner: null,
    endReason: null,
    history: [],
    bonusPieceId: null,
    storm: 0,
    stormIn: null,
    waste: [],
    skillsUsed: [0, 0],
  };
  return settle(state);
}

export function getPieceAt(state: GameState, pos: Pos): Piece | undefined {
  return state.pieces.find((p) => p.pos.r === pos.r && p.pos.c === pos.c);
}

export function getPieceById(state: GameState, id: string): Piece | undefined {
  return state.pieces.find((p) => p.id === id);
}

/** Occupancy (piece index or -1) + owners array for a list of pieces. */
export function buildOccupancy(pieces: Piece[]): { occ: Int8Array; owners: Uint8Array } {
  const occ = new Int8Array(N_SQUARES).fill(-1);
  const owners = new Uint8Array(pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    owners[i] = p.owner;
    if (isOnBoard(p.pos)) occ[sqOf(p.pos)] = i;
  }
  return { occ, owners };
}

const tmpTargets = new Int16Array(128);

/** Length-144 wasteland flags for a state's `waste` list (shared scratch: read it before the next call). */
const wasteScratch = new Uint8Array(N_SQUARES);
let wasteScratchKey: number[] | null = null;
export function wasteFlags(waste: readonly number[] | undefined): Uint8Array | null {
  if (!waste || waste.length === 0) return null;
  if (wasteScratchKey !== waste) {
    wasteScratch.fill(0);
    for (const s of waste) wasteScratch[s] = 1;
    wasteScratchKey = waste as number[];
  }
  return wasteScratch;
}

/** Length-144 doll-trap masks (bit `trapBit(owner)` per trap) for a state's `traps` (shared scratch). */
const trapScratch = new Uint8Array(N_SQUARES);
let trapScratchKey: readonly Trap[] | null = null;
export function trapFlags(traps: readonly Trap[] | undefined): Uint8Array | null {
  if (!traps || traps.length === 0) return null;
  if (trapScratchKey !== traps) {
    trapScratch.fill(0);
    for (const t of traps) trapScratch[t.sq] |= trapBit(t.owner);
    trapScratchKey = traps;
  }
  return trapScratch;
}

/** True while a doll trap holds the piece (no moves, no skill). */
export function isStunned(piece: Pick<Piece, 'stun'>): boolean {
  return (piece.stun ?? 0) > 0;
}

/** Is there a doll trap of `owner` on `pos`? */
export function trapAt(state: Pick<GameState, 'traps'>, pos: Pos, owner: PlayerId): boolean {
  const sq = sqOf(pos);
  return (state.traps ?? []).some((t) => t.sq === sq && t.owner === owner);
}

/** Doll traps `owner`'s Michelle can still lay this match. */
export function trapsLeft(state: Pick<GameState, 'trapsLaid'>, owner: PlayerId): number {
  return Math.max(0, TRAPS_PER_MICHELLE - (state.trapsLaid?.[owner] ?? 0));
}

/** Every piece a move captures, in path order (Picker's hop-through can take several). */
export function capturedIds(move: Pick<Move, 'captureId' | 'captureIds'>): string[] {
  if (move.captureIds && move.captureIds.length) return move.captureIds;
  return move.captureId ? [move.captureId] : [];
}

/**
 * Squares strictly between `from` and `to` of a diagonal hop (Picker's hop-through), or [] when the
 * move is not a diagonal of two or more squares.
 */
export function hopPath(from: Pos, to: Pos): Pos[] {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  const n = Math.abs(dr);
  if (n < 2 || n !== Math.abs(dc)) return [];
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  const out: Pos[] = [];
  for (let k = 1; k < n; k++) out.push({ r: from.r + sr * k, c: from.c + sc * k });
  return out;
}

/**
 * Enemies a piece of `owner` hops onto on the way from `from` to `to`. Only a hop-through
 * (Picker's pattern) can reach a diagonal square past pieces, so for any LEGAL move of a piece that
 * can hop these are exactly the pieces it captures before landing.
 */
function hopVictims(pieces: Piece[], occ: Int8Array, owner: PlayerId, from: Pos, to: Pos): string[] {
  const out: string[] = [];
  for (const q of hopPath(from, to)) {
    const o = occ[sqOf(q)];
    if (o >= 0 && pieces[o].owner !== owner) out.push(pieces[o].id);
  }
  return out;
}

/** Current forward direction of a piece (forward-only movers turn around at the far edge). */
export function pieceDir(piece: Pick<Piece, 'owner' | 'dir'>): 1 | -1 {
  return piece.dir ?? forwardDir(piece.owner);
}

function countTargets(occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number, waste: Uint8Array | null, traps: Uint8Array | null): number {
  return genTargets(occ, owners, piece.owner, CHAR_CODE[piece.character], piece.level, sqOf(piece.pos), tmpTargets, 0, false, pieceDir(piece), storm, absorbMaskOf(piece.absorbed), waste, traps);
}

function targetsWith(pieces: Piece[], occ: Int8Array, owners: Uint8Array, piece: Piece, storm: number, waste: Uint8Array | null, traps: Uint8Array | null): Move[] {
  const n = countTargets(occ, owners, piece, storm, waste, traps);
  const hopper = canHop(CHAR_CODE[piece.character], absorbMaskOf(piece.absorbed));
  const moves: Move[] = [];
  for (let i = 0; i < n; i++) {
    const s = tmpTargets[i];
    const m: Move = { pieceId: piece.id, from: { r: piece.pos.r, c: piece.pos.c }, to: posOf(s) };
    const o = occ[s];
    if (o >= 0) m.captureId = pieces[o].id;
    if (hopper) {
      const on = hopVictims(pieces, occ, piece.owner, m.from, m.to);
      if (on.length) {
        m.captureIds = m.captureId ? [...on, m.captureId] : on;
        m.captureId ??= on[0];
      }
    }
    moves.push(m);
  }
  return moves;
}

/**
 * Pseudo-moves for ANY piece regardless of whose turn it is (for previewing reach). A stunned piece
 * has none: it cannot act on its owner's next turn.
 */
export function getTargetsForPiece(state: GameState, piece: Piece): Move[] {
  if (isStunned(piece)) return [];
  const { occ, owners } = buildOccupancy(state.pieces);
  return targetsWith(state.pieces, occ, owners, piece, state.storm, wasteFlags(state.waste), trapFlags(state.traps));
}

/** True when moving to `to` touches wasteland (the mover is destroyed there). */
export function isWasteMove(state: Pick<GameState, 'waste'>, to: Pos): boolean {
  return state.waste.includes(sqOf(to));
}

/**
 * Legal moves of the side to move (optionally for a single piece). [] if the game has ended.
 * While a chain move is pending only the chaining piece may move.
 */
export function getLegalMoves(state: GameState, pieceId?: string): Move[] {
  if (state.status !== 'playing') return [];
  const { occ, owners } = buildOccupancy(state.pieces);
  const out: Move[] = [];
  for (const p of state.pieces) {
    if (p.owner !== state.turn) continue;
    if (pieceId !== undefined && p.id !== pieceId) continue;
    if (state.bonusPieceId !== null && p.id !== state.bonusPieceId) continue;
    if (isStunned(p)) continue;
    for (const m of targetsWith(state.pieces, occ, owners, p, state.storm, wasteFlags(state.waste), trapFlags(state.traps))) out.push(m);
  }
  return out;
}

/** Does `player` have a move? `ignoreStun` asks whether it would have one once its stuns wear off. */
function hasAnyMove(state: GameState, player: PlayerId, onlyPieceId: string | null = null, ignoreStun = false): boolean {
  const pieces = state.pieces;
  const { occ, owners } = buildOccupancy(pieces);
  const wf = wasteFlags(state.waste);
  const tf = trapFlags(state.traps);
  for (const p of pieces) {
    if (p.owner !== player) continue;
    if (onlyPieceId !== null && p.id !== onlyPieceId) continue;
    if (!ignoreStun && isStunned(p)) continue;
    if (countTargets(occ, owners, p, state.storm, wf, tf) > 0) return true;
  }
  return false;
}

const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

export function isLegalMove(state: GameState, move: Move): boolean {
  if (!move || !move.from || !move.to) return false;
  return getLegalMoves(state, move.pieceId).some((m) => samePos(m.from, move.from) && samePos(m.to, move.to));
}

export function materialScore(state: GameState, player: PlayerId): number {
  let s = 0;
  for (const p of state.pieces) if (p.owner === player) s += effectiveValue(p.character, p.level, p.absorbed);
  return s;
}

/** Winner by material, or null for a draw. */
export function adjudicate(state: GameState): PlayerId | null {
  const a = materialScore(state, 0);
  const b = materialScore(state, 1);
  return a > b ? 0 : b > a ? 1 : null;
}

function countPieces(pieces: Piece[], player: PlayerId): number {
  let n = 0;
  for (const p of pieces) if (p.owner === player) n++;
  return n;
}

/**
 * Time allowed for the current turn: TURN_TIME_MS (45 s) normally, TURN_TIME_2_MS (40 s) once
 * either side is down to two pieces, TURN_TIME_1_MS (20 s) once either side is down to one.
 */
export function turnTimeMsFor(state: Pick<GameState, 'pieces'>): number {
  const m = Math.min(countPieces(state.pieces, 0), countPieces(state.pieces, 1));
  return m <= 1 ? TURN_TIME_1_MS : m <= 2 ? TURN_TIME_2_MS : TURN_TIME_MS;
}

function end(state: GameState, winner: PlayerId | null, reason: GameState['endReason']): GameState {
  return { ...state, status: 'ended', winner, endReason: reason };
}

/**
 * Hand the move to the other player: appends `entry`, bumps the ply, clears any chain move and
 * ticks the storm clock (which may advance the storm and remove pieces).
 */
function switchTurn(state: GameState, entry: HistoryEntry, pliesSinceCapture: number): GameState {
  let next: GameState = {
    ...state,
    pieces: countDownStuns(state.pieces, state.turn),
    turn: other(state.turn),
    ply: state.ply + 1,
    pliesSinceCapture,
    bonusPieceId: null,
    history: [...state.history, entry],
  };
  // A side that just lost its last piece decides the game (see `settle`): the storm does not tick.
  const alive0 = countPieces(next.pieces, 0);
  const alive1 = countPieces(next.pieces, 1);
  if (next.stormIn !== null && alive0 > 0 && alive1 > 0) {
    const left = next.stormIn - 1;
    if (left > 0) next = { ...next, stormIn: left };
    else {
      const storm = next.storm + 1;
      const killed: string[] = [];
      const pieces = next.pieces.filter((p) => {
        if (!inStorm(p.pos.c, storm)) return true;
        killed.push(p.id);
        return false;
      });
      next = { ...next, storm, stormIn: STORM_INTERVAL_PLIES, pieces, history: [...next.history, { kind: 'storm', storm, killed }] };
      const left0 = countPieces(pieces, 0);
      const left1 = countPieces(pieces, 1);
      // The storm swallowed the last pieces of BOTH sides at once: decided by what was lost.
      if (left0 === 0 && left1 === 0) {
        const gone = state.pieces.filter((p) => killed.includes(p.id));
        return end(next, adjudicate({ ...next, pieces: gone }), 'storm');
      }
      if (left0 === 0 || left1 === 0) return end(next, left0 > 0 ? 0 : 1, 'storm');
    }
  }
  return next;
}

/** The turn of `player` ends: each of its stunned pieces has one owner turn less to sit out. */
function countDownStuns(pieces: Piece[], player: PlayerId): Piece[] {
  if (!pieces.some((p) => p.owner === player && p.stun)) return pieces;
  return pieces.map((p) => {
    if (p.owner !== player || !p.stun) return p;
    const q: Piece = { ...p };
    if (p.stun > 1) q.stun = p.stun - 1;
    else delete q.stun;
    return q;
  });
}

/**
 * Post-ply bookkeeping: elimination (by capture or storm), storm activation (one piece left or
 * sudden death), chain moves that cannot be played, and automatic passes when the side to move has
 * no legal moves (stalemate if neither side can move).
 * `state` must already be a fresh object owned by the caller.
 */
function settle(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  for (;;) {
    const n0 = countPieces(state.pieces, 0);
    const n1 = countPieces(state.pieces, 1);
    if (n0 === 0 || n1 === 0) return end(state, n0 > 0 ? 0 : n1 > 0 ? 1 : null, eliminationReason(state, n0 === 0 && n1 === 0 ? null : n0 === 0 ? 0 : 1));
    if (state.stormIn === null && (n0 <= 1 || n1 <= 1 || state.ply >= SUDDEN_DEATH_PLY)) state = { ...state, stormIn: STORM_INTERVAL_PLIES };
    if (state.bonusPieceId !== null) {
      if (hasAnyMove(state, state.turn, state.bonusPieceId)) return state;
      // The chaining piece is boxed in: the chain move lapses.
      state = switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1);
      continue;
    }
    // A side that cannot move but can still lay its wasteland is not passed: casting is its turn.
    if (hasAnyMove(state, state.turn) || sideCanCast(state, state.turn)) return state;
    // Stuns wear off, so the game is only stuck when neither side could act even without them.
    const selfLater = hasAnyMove(state, state.turn, null, true) || sideCanCast(state, state.turn, true);
    if (!selfLater && !hasAnyMove(state, other(state.turn), null, true) && !sideCanCast(state, other(state.turn), true)) return end(state, adjudicate(state), 'stalemate');
    const reason: PassReason = selfLater ? 'stunned' : 'noMoves';
    state = switchTurn(state, { kind: 'pass', player: state.turn, reason }, state.pliesSinceCapture + 1);
  }
}

/**
 * Why a side has no pieces left after the last action (storm eliminations end the game inside
 * `switchTurn`): its last piece stepped onto wasteland, or it was captured.
 */
function eliminationReason(state: GameState, loser: PlayerId | null): EndReason {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const e = state.history[i];
    if (e.kind === 'storm') continue;
    return e.kind === 'move' && e.move.wasted && (loser === null || e.player === loser) ? 'waste' : 'elimination';
  }
  return 'elimination';
}

/** Current turn, counted per player: both players' first moves are turn 1, the next pair turn 2... */
export function turnNumber(state: Pick<GameState, 'ply'>): number {
  return Math.floor(state.ply / 2) + 1;
}

/** Plies left before sudden death starts the storm; null once the storm is active (or the game ended). */
export function suddenDeathIn(state: Pick<GameState, 'ply' | 'stormIn' | 'status'>): number | null {
  if (state.status !== 'playing' || state.stormIn !== null) return null;
  return Math.max(0, SUDDEN_DEATH_PLY - state.ply);
}

/** Union of absorbed abilities (deduplicated, never including the holder's own pattern). */
function absorbInto(holder: Piece, victim: Piece): AbsorbedAbility[] {
  const out: AbsorbedAbility[] = [...(holder.absorbed ?? [])];
  const add = (a: AbsorbedAbility) => {
    if (a.character === holder.character && a.level === holder.level) return;
    if (out.some((x) => x.character === a.character && x.level === a.level)) return;
    out.push({ character: a.character, level: a.level });
  };
  add({ character: victim.character, level: victim.level });
  for (const a of victim.absorbed ?? []) add(a);
  return out;
}

/** Pure: returns a new state. Throws if the game is over or the move is illegal. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.status !== 'playing') throw new Error('Game is already over');
  if (!move || !move.from || !move.to) throw new Error('Malformed move');
  const legal = getLegalMoves(state, move.pieceId).find((m) => samePos(m.from, move.from) && samePos(m.to, move.to));
  if (!legal) throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  const player = state.turn;
  const mover = state.pieces.find((p) => p.id === legal.pieceId)!;
  // Everything the move captures: the piece on `to`, plus every enemy Picker hops onto on the way.
  const victimIds = capturedIds(legal);
  const victims = victimIds.map((id) => state.pieces.find((p) => p.id === id)!);
  // Touching wasteland destroys the mover (wasteland never holds a piece). A hop still takes the
  // enemies it landed on before reaching the wasteland square.
  const wasted = isWasteMove(state, legal.to);
  const d = pieceDir(mover);
  // Michelle's doll trap: her first TRAPS_PER_MICHELLE backward moves leave one on `from`.
  const laysTrap = mover.character === 'michelle' && !wasted && (legal.to.r - legal.from.r) * d < 0 && trapsLeft(state, player) > 0;
  // Ending a move on an ENEMY doll trap stuns the mover (its own side's traps never catch it).
  const caught = !wasted && trapAt(state, legal.to, other(player));
  const pieces: Piece[] = [];
  for (const p of state.pieces) {
    if (victimIds.includes(p.id)) continue;
    if (p.id === legal.pieceId && wasted) continue;
    if (p.id === legal.pieceId) {
      const moved: Piece = { ...p, pos: { r: legal.to.r, c: legal.to.c } };
      // Forward-only movers turn around when they reach the last row in their direction.
      if (!keepsDirection(CHAR_CODE[p.character]) && atTurnRow(moved.pos.r, d)) moved.dir = d === 1 ? -1 : 1;
      // Insaner steals the movement pattern of whatever it captures (every victim of a hop).
      if (p.character === 'insaner' && victims.length) {
        let holder: Piece = moved;
        for (const v of victims) holder = { ...holder, absorbed: absorbInto(holder, v) };
        moved.absorbed = holder.absorbed;
      }
      if (caught) moved.stun = TRAP_STUN;
      pieces.push(moved);
    } else pieces.push(p);
  }
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] = 0;
  const recorded: Move = { pieceId: legal.pieceId, from: { ...legal.from }, to: { ...legal.to } };
  if (legal.captureId) recorded.captureId = legal.captureId;
  if (legal.captureIds) recorded.captureIds = [...legal.captureIds];
  if (wasted) recorded.wasted = true;
  if (laysTrap) recorded.trap = true;
  if (caught) recorded.stunned = true;
  const entry: HistoryEntry = { kind: 'move', player, move: recorded };
  const psc = victims.length ? 0 : state.pliesSinceCapture + 1;
  const base: GameState = { ...state, pieces, consecutiveTimeouts: ct };
  if (laysTrap) {
    const sq = sqOf(legal.from);
    const traps = state.traps ?? [];
    base.traps = traps.some((t) => t.sq === sq && t.owner === player)
      ? traps
      : [...traps, { sq, owner: player }].sort((a, b) => a.sq - b.sq || a.owner - b.owner);
    const laid: [number, number] = [state.trapsLaid?.[0] ?? 0, state.trapsLaid?.[1] ?? 0];
    laid[player] += 1;
    base.trapsLaid = laid;
  }
  // Chain move: a Level-3 Insaner that captures moves once more (one extra move per turn; a
  // multi-capture is still one capture). A doll trap that catches it ends the turn instead.
  if (victims.length && mover.character === 'insaner' && mover.level === 3 && state.bonusPieceId === null && !caught && !wasted) {
    return settle({ ...base, ply: state.ply + 1, pliesSinceCapture: psc, bonusPieceId: mover.id, history: [...state.history, entry] });
  }
  return settle(switchTurn(base, entry, psc));
}

/** Squares (r * 12 + c) of a k x k wasteland whose lowest-row, lowest-column square is `anchor`. */
export function wasteArea(level: number, anchor: Pos): number[] {
  const k = WASTE_SIZE[level] ?? 1;
  const out: number[] = [];
  for (let r = anchor.r; r < anchor.r + k; r++) for (let c = anchor.c; c < anchor.c + k; c++) out.push(r * BOARD_SIZE + c);
  return out;
}

export type SkillBlock = 'noSkill' | 'notYourTurn' | 'chain' | 'notYet' | 'used' | 'storm' | 'stunned' | 'ended';

/**
 * Why `pieceId` cannot use its skill right now, or null when it can. Brutile's wasteland unlocks at
 * SKILL_UNLOCK_PLY (each side has played 3 turns), SKILL_USES_PER_MATCH times per side, and is
 * forbidden once the storm has started closing in (storm >= 1).
 */
export function skillBlock(state: GameState, pieceId: string): SkillBlock | null {
  if (state.status !== 'playing') return 'ended';
  const p = state.pieces.find((x) => x.id === pieceId);
  if (!p || !CHARACTERS[p.character].skill) return 'noSkill';
  if (p.owner !== state.turn) return 'notYourTurn';
  if (state.bonusPieceId !== null) return 'chain';
  if (state.storm > 0) return 'storm';
  if (state.skillsUsed[p.owner] >= SKILL_USES_PER_MATCH) return 'used';
  if (state.ply < SKILL_UNLOCK_PLY) return 'notYet';
  // Checked last: 'stunned' means the skill would be usable once the doll trap lets go.
  if (isStunned(p)) return 'stunned';
  return null;
}

/** Turns (of the side to move) until the skill unlocks; 0 once unlocked. */
export function skillUnlockIn(state: Pick<GameState, 'ply'>): number {
  return Math.max(0, Math.ceil((SKILL_UNLOCK_PLY - state.ply) / 2));
}

/**
 * Could `player` lay a wasteland on its turn (ignoring whose turn it is now)? `ignoreStun`: could it
 * once a doll trap lets its caster go.
 */
function sideCanCast(state: GameState, player: PlayerId, ignoreStun = false): boolean {
  if (state.bonusPieceId !== null) return false;
  const p = state.pieces.find((x) => x.owner === player && CHARACTERS[x.character].skill);
  if (!p) return false;
  const block = skillBlock({ ...state, turn: player }, p.id);
  return (block === null || (ignoreStun && block === 'stunned')) && freeAnchors(state, p.level).length > 0;
}

/** Valid anchors for `pieceId`'s wasteland: the whole area on the board and free of pieces. */
export function skillAnchors(state: GameState, pieceId: string): Pos[] {
  if (skillBlock(state, pieceId) !== null) return [];
  const p = state.pieces.find((x) => x.id === pieceId)!;
  return freeAnchors(state, p.level);
}

function freeAnchors(state: GameState, level: number): Pos[] {
  const k = WASTE_SIZE[level];
  const occupied = new Uint8Array(N_SQUARES);
  for (const q of state.pieces) occupied[sqOf(q.pos)] = 1;
  const out: Pos[] = [];
  for (let r = 0; r + k <= BOARD_SIZE; r++) {
    for (let c = 0; c + k <= BOARD_SIZE; c++) {
      let ok = true;
      for (let dr = 0; dr < k && ok; dr++) for (let dc = 0; dc < k && ok; dc++) if (occupied[(r + dr) * BOARD_SIZE + c + dc]) ok = false;
      if (ok) out.push({ r, c });
    }
  }
  return out;
}

export function isLegalSkill(state: GameState, action: SkillAction): boolean {
  if (!action || action.kind !== 'skill' || !action.anchor) return false;
  return skillAnchors(state, action.pieceId).some((a) => samePos(a, action.anchor));
}

/** Pure: Brutile lays its wasteland; this is the player's action for the turn. Throws if illegal. */
export function applySkill(state: GameState, action: SkillAction): GameState {
  if (!isLegalSkill(state, action)) throw new Error(`Illegal skill: ${JSON.stringify(action)}`);
  const p = state.pieces.find((x) => x.id === action.pieceId)!;
  const squares = wasteArea(p.level, action.anchor);
  const waste = [...new Set([...state.waste, ...squares])].sort((a, b) => a - b);
  const used: [number, number] = [state.skillsUsed[0], state.skillsUsed[1]];
  used[p.owner] += 1;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[p.owner] = 0;
  const entry: HistoryEntry = { kind: 'skill', player: p.owner, pieceId: p.id, squares };
  return settle(switchTurn({ ...state, waste, skillsUsed: used, consecutiveTimeouts: ct }, entry, state.pliesSinceCapture + 1));
}

/** The player declines the pending chain move. No-op when none is pending. */
export function skipBonus(state: GameState): GameState {
  if (state.status !== 'playing' || state.bonusPieceId === null) return state;
  return settle(switchTurn(state, { kind: 'pass', player: state.turn, reason: 'bonusSkip' }, state.pliesSinceCapture + 1));
}

/**
 * The side to move ran out of turn time: it forfeits at once ('timeoutForfeit'). Exception: letting
 * a pending chain move lapse is not a forfeit (the player already moved this turn), it just skips it.
 */
export function applyTimeout(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  if (state.bonusPieceId !== null) return skipBonus(state);
  const player = state.turn;
  const ct: [number, number] = [state.consecutiveTimeouts[0], state.consecutiveTimeouts[1]];
  ct[player] += 1;
  const entry: HistoryEntry = { kind: 'pass', player, reason: 'timeout' };
  return end({ ...state, consecutiveTimeouts: ct, history: [...state.history, entry] }, other(player), 'timeoutForfeit');
}

export function resign(state: GameState, player: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return end({ ...state }, other(player), 'resign');
}
