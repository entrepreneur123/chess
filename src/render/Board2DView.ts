/**
 * Lightweight Canvas2D fallback board (flat, top-down) used when WebGL is unavailable.
 * Same palette, highlights, pieces, animations and API as the WebGL BoardView, and the same v6
 * "tactical hologram" look (arena.ts): the bezel and the flat navy cells are painted once per size
 * into a static layer and the hologram overlay (zone washes, hex texture, glowing grid) into a
 * second one; each frame draws the first, only the cells whose tint differs (highlights, storm,
 * wasteland), the overlay, the turn glow (setTurnGlow, a cached sprite per team), markers (luminous
 * sprites cached per size, blended with 'lighter' like the WebGL additive markers), tokens and
 * effects. Transparent canvas. This is the low-end path, so the WebGL board's ambient scan sweep
 * is left out here: an idle 2D board draws nothing.
 * Player 0 (row 0) is at the bottom of the screen; col 0 at the left.
 *
 * Pieces are illustrated tokens: the character's face art (public/chars/<id>-lv<n>-face.jpg,
 * HTMLImageElement cached, neutral placeholder until loaded) in a team-coloured rim with gold star
 * pips, pre-rendered once per (character, level, team, size) into an offscreen canvas; the rarity
 * ring around it is drawn live (legendary = rotating rainbow, ~30 fps only while one is on board and
 * motion is allowed). Captures: the attacker slides to strike range, lunges, the strike lands
 * (onImpact) with the character's FX (sad holy slash + light beam, marki cracks + dust + heavy
 * shake, walk shield shock ring, insaner violet flames + soul stream), the victim flashes, shakes and
 * shatters, the attacker steps in. Enemy reach previews (tone 'enemy') are red.
 *
 * Brutile's wasteland (setWaste): cached per-square sprites (waste2d.ts) of scorched ground with
 * glowing green cracks that run on into neighbouring wasteland squares, a pulsing additive glow and
 * a poison bubble per square (~30 fps, static with reduced motion). setSkillPreview draws the
 * targeting overlay, animateSkill the cast (rune, green bolt, squares cracking open), wasted moves
 * dissolve the mover in green, and deadly move targets show a skull instead of the dot.
 *
 * Rakaeli (awakenFx.ts, same timeline as the WebGL board): base-form leaps shed pale ash feathers;
 * transformed (`Piece.awaken` > 0) his coin shows the awake face (the base face tinted crimson if
 * that art is missing), a flickering crimson / violet aura with embers (cached sprites, ~30 fps
 * idle, static with reduced motion) and the countdown badge; his moves leave crimson feathers and
 * a crimson ribbon, captures burst in a dark flame. playAwaken plays the transform / revert.
 */
import { BOARD_SIZE, STORM_FULL_STEPS, ZONE_DEPTH, stormRows } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos, Trap } from '../engine/types';
import type { BoardHighlights, BoardViewOptions, IBoardView, ScreenRect, SkillPreview } from './types';
import { ambientFrameMs, BUSY_FRAME_MS, clearAmbientSprites, drawAmbient2D, LOW_POWER_FRAME_MS, PULSE_REST } from './ambient';
import { DEFAULT_BOARD_THEME, boardTheme } from './arenaThemes';
import type { BoardTheme } from './arenaThemes';
import { ANIM, BOARD_COLORS, CHARACTER_FX, CHARACTER_RARITY, RAKAELI_AWAKE_FX, RARITY_RING, TEAM_COLORS, WASTE_COLORS } from './palette';
import { MOVE_TRAIL } from './moveStyle';
import { STORM_COLORS } from './storm';
import { wasteMask } from './waste';
import { Waste2DSprites, wasteVariant } from './waste2d';
import { DOLL_CORNER_OFFSET, DOLL_CORNER_SIZE, DOLL_SIZE, STUN_BOX, dollSprite, stunSprite, wobbleAngle } from './trapFx';
import {
  AURA_BOX,
  AWAKEN_COLORS,
  AWAKE_TINT,
  BADGE_BOX,
  BADGE_OFFSET,
  EMBER_COUNT,
  auraSmokeSprite,
  auraSprite,
  awakeFaceUrl,
  awakenOf,
  awakenTimeline,
  badgeSprite,
  clearAwakenSprites,
  emberAt,
  emberSprite,
  featherSprite,
  isRakaeli,
  makeAwakenSample,
  rakaeliStyle,
  sampleAwaken,
  smokeSprite,
  wingSprite,
} from './awakenFx';
import type { AwakenPhase, AwakenTimeline, FeatherTone, RakaeliStyle } from './awakenFx';
import {
  clamp01,
  containerSize,
  ARROW_H,
  ARROW_INK,
  ARROW_LINE,
  ARROW_RIM,
  ARROW_W,
  arrowSign,
  easeInOutCubic,
  easeOutCubic,
  faceUrl,
  hexToRgb,
  hopSquares,
  hopTimingFor,
  indexHighlights,
  shotLaneEnds,
  isHopMove,
  mixRgb,
  posKey,
  FRAME_STALL_MS,
  prefersReducedMotion,
  pulse01,
  rgbToCss,
  shakeOffset,
  slideDuration,
  stormSquare,
  tileRgb,
  tilePalette,
} from './common';
import type { HighlightIndex, TilePalette } from './common';
import {
  DOT_WHITEN,
  FIELD_OVERLAY_MARGIN,
  FRAME_REGULAR,
  MARKER_QUAD,
  SEE_THROUGH_MAX_ALPHA,
  alphaAt,
  frameFit,
  frameStyleFor,
  paintCaptureRing,
  paintFieldOverlay,
  paintFrame,
  paintGlowDot,
  paintSelectGlow,
  paintShotReticle,
  paintShotSight,
  paintTile,
  paintTurnGlow,
  tileOuterPath,
} from './arena';
import type { FrameStyle } from './arena';
import { canvasStats, ctx2d, getFallbackReason, releaseCanvas } from './diag';
import type { RenderDiagnostics } from './diag';

const TAP_SLOP_PX = 14;
/** Opacity of a piece while it is being dragged (its DOM ghost follows the finger). */
const DRAG_SOURCE_ALPHA = 0.3;
/** Opacity of a stunned piece (with the "속박" badge above it). */
const STUN_ALPHA = 0.55;
const MAX_PIXEL_RATIO = 2;
const IDLE_FRAME_MS = 32;
/** A throttled idle loop shorter than this waits frame by frame instead of on a timer (ms). */
const WAKE_MIN_MS = 12;
/** Its timer fires this much early (ms), so the frame it then waits for is not a whole frame late. */
const WAKE_EARLY_MS = 6;
/**
 * Idle caps are met this much early (ms): a frame's timestamp is its start, a little before the
 * timer that woke it, and must not cost one more wake-up just to skip.
 */
const CAP_SLACK_MS = 4;
/** Storm removal: dissolve length (ms). */
const STORM_MS = 520;
/** Capture timeline (ms after the impact): recoil, death (shatter), attacker steps in. */
const HIT_MS = 140;
const DEATH_MS = 340;
const STEP_AT = 200;
const STEP_MS = 200;
const STRIKE_RANGE = 0.62;
const CHAIN_WINDOW_MS = 8000;
/** Capture FX length (ms). */
const FX_MS = 620;
/** Token radius and rarity ring radius (fractions of a cell). */
/** Token sprite size (fraction of a cell): the coin (r 0.385) + its edge and keyline. */
const TOKEN_SPRITE = 0.92;
/** Coin top-face radius and its lift above the cell centre, in cells (paintToken's geometry). */
const COIN_TOP_R = 0.385;
const COIN_TOP_LIFT = 0.024;
/** Forward chevron colours: the team's light tone pushed toward white, over an ink outline. */
const ARROW_CSS: Record<PlayerId, string> = {
  0: rgbToCss(mixRgb(hexToRgb(TEAM_COLORS[0].light), [1, 1, 1], 0.65)),
  1: rgbToCss(mixRgb(hexToRgb(TEAM_COLORS[1].light), [1, 1, 1], 0.65)),
};
const ARROW_INK_CSS = 'rgba(9,13,23,0.8)';
const RING_R = 0.452;
/** Storm tile tint strength (matches the WebGL board). */
const STORM_TILE_ALPHA = 0.55;
/** Wasted move: the mover's toxic dissolve (ms). */
const WASTE_DIE_MS = 560;
/** Brutile's cast timeline (ms): bolt launch / travel, first crack, crack-open length, rune life. */
const SKILL_BOLT_AT = 190;
const SKILL_BOLT_MS = 250;
const SKILL_CRACK_AT = 430;
const SKILL_CRACK_MS = 300;
const SKILL_RUNE_MS = 1000;
/** Turn glow (setTurnGlow): fade length (ms), full opacity and sprite margin around the field (cells). */
const TURN_GLOW_MS = 320;
const TURN_GLOW_OPACITY = 0.45;
const turnGlowMargin = (st: FrameStyle): number => st.width + 0.2;

interface Skill2D {
  start: number;
  casterId: string | null;
  from: { r: number; c: number };
  centre: { r: number; c: number };
  squares: { sq: number; at: number; fired: boolean }[];
  boltAt: number;
  duration: number;
  /** Bow of the bolt (signed, in cells) so it arcs sideways. */
  bow: number;
  shook: boolean;
  resolve: () => void;
}

interface Layout {
  /** Board origin (top-left of the slab interior) in CSS px. */
  x0: number;
  y0: number;
  cell: number;
  pad: number;
}

interface Anim2D {
  move: Move;
  start: number;
  duration: number;
  moveDur: number;
  moverId: string;
  character: CharacterId;
  from: Pos;
  to: Pos;
  /** End of the approach (fractional board coords): `to`, or strike range for captures. */
  strike: { r: number; c: number };
  jump: boolean;
  charge: boolean;
  chain: boolean;
  capture: boolean;
  captured: Piece | null;
  impactAt: number;
  impactFired: boolean;
  deathStart: number;
  stepStart: number;
  landed: boolean;
  /** The mover steps onto wasteland and dissolves there (absent from piecesAfter). */
  wasted: boolean;
  piecesAfter: Piece[];
  /** Picker's hop-through (square by square), or null for every other move. */
  hop: Hop2D | null;
  /** Rakaeli's move style (crimson feathers when transformed, pale ash otherwise) or null. */
  rk: RakaeliStyle | null;
  nextFeather: number;
  resolve: () => void;
}

/** A running playAwaken (or the automatic short revert after a transformed piece's last move). */
interface AwakenRun2D {
  id: string;
  phase: AwakenPhase;
  tl: AwakenTimeline;
  start: number;
  face0: number;
  aura0: number;
  pulsed: boolean;
  smoked: boolean;
  resolve: () => void;
}

/** Shown transform look of a piece (awake face blend, aura, blindfold burn; 0..1). */
interface AwakeLook {
  face: number;
  aura: number;
  burn: number;
}

/** A feather in flight, in screen cell units (x right / y down from the board origin). */
interface Feather2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  t0: number;
  life: number;
  tone: FeatherTone;
}

const FEATHER_POOL = 36;
const FEATHER_MS_AWAKE = 34;
const FEATHER_MS_ASH = 75;

/** Picker's hop: landing squares in order, timing, and the victims struck on landing. */
interface Hop2D {
  squares: Pos[];
  stepMs: number;
  landMs: number;
  arc: number;
  victims: { piece: Piece; impactAt: number; fired: boolean }[];
  landed: number;
}

/** Shared face images (the browser caches the files; one decode per session). */
const faceImages = new Map<string, HTMLImageElement>();
const faceWaiters = new Set<() => void>();

function faceImage(character: CharacterId, level: Level): HTMLImageElement | null {
  return imageAt(faceUrl(character, level));
}

/** Rakaeli's transformed face (null while loading or missing: the base face is tinted instead). */
function awakeImage(level: Level): HTMLImageElement | null {
  return imageAt(awakeFaceUrl(level));
}

function imageAt(url: string): HTMLImageElement | null {
  let img = faceImages.get(url);
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      for (const w of faceWaiters) w();
    };
    img.src = url;
    faceImages.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export class Board2DView implements IBoardView {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private highlights: BoardHighlights = {};
  private hi: HighlightIndex = indexHighlights({});
  private layout: Layout = { x0: 0, y0: 0, cell: 1, pad: 0 };
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private cellCb: ((pos: Pos) => void) | null = null;
  private impactCb: ((move: Move) => void) | null = null;
  private interactive = true;
  private anim: Anim2D | null = null;
  private rafId = 0;
  /** A change waits to be drawn (requestRender): the next frame draws past the idle caps. */
  private dirty = false;
  /** Timer of a throttled idle loop sleeping until its next draw (nextFrameIn). */
  private wakeTimer = 0;
  private disposed = false;
  private disposing = false;
  private resizeObserver: ResizeObserver | null = null;
  /** Bezel look for the current width (slim on phones). */
  private frameStyle: FrameStyle = FRAME_REGULAR;
  /** Arena board theme (arenaThemes.ts) and its cell palette. */
  private theme: BoardTheme = DEFAULT_BOARD_THEME;
  private tilePal: TilePalette = tilePalette(DEFAULT_BOARD_THEME);
  /** Self-test notes for the ?diag=1 panel. */
  private readonly diagNotes: string[] = [];
  private down: { id: number; x: number; y: number } | null = null;
  /** Piece being dragged by the UI (drawn faded on its square), see setDragging. */
  private draggingId: string | null = null;
  /** Static board layer (bezel, base cells) at device pixels, rebuilt on resize. */
  private boardLayer: HTMLCanvasElement | null = null;
  /**
   * Static hologram overlay (zone washes, hex texture, grid, edge shadow) at device pixels, drawn
   * over the cells each frame so re-tinted cells keep their grid (as the WebGL overlay plane).
   */
  private overlayLayer: HTMLCanvasElement | null = null;
  /** Turn glow: owner, fade state and the per-team sprites (built lazily per size). */
  private glowOwner: PlayerId | null = null;
  private glowLevel = 0;
  private glowFrom = 0;
  private glowTo = 0;
  private tGlow = -1;
  private readonly glowSprites: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  private glowColor: PlayerId = 0;
  private turn: PlayerId = 0;
  private tLand = -1;
  private landAt: { r: number; c: number } = { r: 0, c: 0 };
  private landColor = '#ffffff';
  /** Capture FX: start, kind, place, strike direction (screen), seeds, soul target id. */
  private tCap = -1;
  private capKind: CharacterId = 'sad';
  private capAt: { r: number; c: number } = { r: 0, c: 0 };
  private capDir = { x: 0, y: -1 };
  private capBurst: { a: number; v: number }[] = [];
  private soulTo: string | null = null;
  private shakeAmp = 1;
  private shakeMs: number = ANIM.shake;
  /** Skill FX: sad glint (start + place), mover trail (screen points, newest last). */
  private tGlint = -1;
  private glintAt = { x: 0, y: 0 };
  private glintColor = '#ffffff';
  private readonly trail: { x: number; y: number; t: number }[] = [];
  private trailColor = '#ffffff';
  private lastCapture: { id: string; t: number } | null = null;
  private tTurn = -1;
  private lastFrame = 0;
  /** Storm state (see setStorm) and the pieces it is taking (ghosts drawn while they dissolve). */
  private storm = 0;
  private stormNext: number | null = null;
  private readonly fading: { piece: Piece; start: number }[] = [];
  private readonly reducedMotion = prefersReducedMotion();
  /** A frame threw once already (logged once; see onFrameError). */
  private frameErrorLogged = false;
  /** Frame-stall check for running animations (see watchFrames). */
  private stallTimer = 0;
  private lastRafAt = 0;
  private hasLegendary = false;
  /** Pre-rendered tokens keyed by look + pixel size. */
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  /** Michelle's doll traps (setTraps). */
  private traps: Trap[] = [];
  /** Wasteland squares, their reveal (< 1 only while the cast cracks them open), sprites. */
  private readonly waste = new Set<number>();
  private readonly wasteOpen = new Map<number, number>();
  private readonly wasteSprites = new Waste2DSprites();
  /** Skill targeting overlay and the running cast. */
  private anchors: number[] = [];
  private preview: SkillPreview | null = null;
  private previewSet = new Set<number>();
  private skill: Skill2D | null = null;
  /** Bolt-impact flash at the area centre (start time) and cast sparks. */
  private tSkillHit = -1;
  private readonly skillSparks: { x: number; y: number; a: number; v: number; t0: number }[] = [];
  /** Rakaeli: running transforms, looks that differ from the piece data, feathers, one-shot FX. */
  private readonly awRuns = new Map<string, AwakenRun2D>();
  private readonly awLook = new Map<string, AwakeLook>();
  private readonly dataLook: AwakeLook = { face: 0, aura: 0, burn: 0 };
  private readonly awSample = makeAwakenSample();
  private readonly ember = { r: 0, a: 0, s: 0, k: 0 };
  private wing = { id: '', k: 0, a: 0 };
  private readonly feathers: Feather2D[] = [];
  private featherNext = 0;
  private lastFeatherT = 0;
  /** Dark flame (transformed capture / take-off / landing), transform pulse and revert smoke. */
  private dark = { t0: -1, dur: 1, x: 0, y: 0, r: 1 };
  private awPulse = { t0: -1, x: 0, y: 0 };
  private awSmoke = { t0: -1, x: 0, y: 0 };
  private capRak: RakaeliStyle | null = null;
  private readonly onFaceLoaded = (): void => {
    this.sprites.clear();
    this.requestRender();
  };

  constructor(container: HTMLElement, opts: Pick<BoardViewOptions, 'arena'> = {}) {
    this.container = container;
    this.theme = boardTheme(opts.arena);
    this.tilePal = tilePalette(this.theme);
    this.canvas = document.createElement('canvas');
    const ctx = ctx2d(this.canvas);
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.ctx = ctx;
    const st = this.canvas.style;
    st.display = 'block';
    st.width = '100%';
    st.height = '100%';
    st.touchAction = 'none';
    st.userSelect = 'none';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    faceWaiters.add(this.onFaceLoaded);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
  }

  // ---------------------------------------------------------------- public API

  setPieces(pieces: Piece[]): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.collectStormVictims(pieces, null);
    this.setPieceList(clonePieces(pieces));
    this.requestRender();
  }

  /**
   * Replace the piece list. Transform looks follow the data (a matching running playAwaken keeps
   * playing); `softId` = the mover of a finished move: if its transform just ran out, it fades out
   * briefly instead of popping (a playAwaken('off') right after continues from there).
   */
  private setPieceList(list: Piece[], softId: string | null = null): void {
    const before = softId ? this.pieces.find((p) => p.id === softId) : undefined;
    const softFace = before ? this.lookOf(before).face : 0;
    const softAura = before ? this.lookOf(before).aura : 0;
    this.pieces = list;
    this.hasLegendary = list.some((p) => CHARACTER_RARITY[p.character] === 'legendary');
    for (const run of [...this.awRuns.values()]) {
      const p = list.find((q) => q.id === run.id);
      if (!p || (run.phase === 'on') !== awakenOf(p) > 0) this.endRun(run, false);
    }
    for (const id of [...this.awLook.keys()]) if (!this.awRuns.has(id)) this.awLook.delete(id);
    const after = softId ? list.find((p) => p.id === softId) : undefined;
    if (after && softFace > 0 && awakenOf(after) === 0 && !this.awRuns.has(after.id) && !this.disposing) {
      this.awRuns.set(after.id, { id: after.id, phase: 'off', tl: awakenTimeline('off', true), start: performance.now(), face0: softFace, aura0: softAura, pulsed: true, smoked: true, resolve: () => undefined });
      this.awLook.set(after.id, { face: softFace, aura: softAura, burn: 0 });
    }
    // Preload Rakaeli's transformed face so the swap never waits on it.
    for (const p of list) if (isRakaeli(p)) awakeImage(p.level);
  }

  // ---------------------------------------------------------------- Rakaeli ("타천")

  /** See IBoardView.playAwaken. Same timeline as the WebGL board (awakenFx.ts). */
  playAwaken(pieceId: string, phase: AwakenPhase): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const p = this.pieces.find((q) => q.id === pieceId);
    if (!p) return Promise.resolve();
    const prev = this.awRuns.get(pieceId);
    if (prev) this.endRun(prev, false);
    const cur = this.lookOf(p);
    const face0 = prev ? cur.face : phase === 'on' ? 0 : 1;
    const aura0 = prev ? cur.aura : phase === 'on' ? 0 : 1;
    if (phase === 'on' && isRakaeli(p)) awakeImage(p.level);
    const now = performance.now();
    if (phase === 'on' && !this.reducedMotion) {
      this.tGlint = now;
      this.glintAt = { x: this.cx(p.pos.c), y: this.cy(p.pos.r) - this.layout.cell * 0.05 };
      this.glintColor = AWAKEN_COLORS.ember;
    }
    return new Promise<void>((resolve) => {
      this.awRuns.set(pieceId, { id: pieceId, phase, tl: awakenTimeline(phase, this.reducedMotion), start: now, face0, aura0, pulsed: false, smoked: false, resolve });
      this.awLook.set(pieceId, { face: face0, aura: aura0, burn: 0 });
      this.requestRender();
      this.watchFrames();
    });
  }

  /** Finish a run: `settle` = jump to its end look (held until the next piece sync); resolve it. */
  private endRun(run: AwakenRun2D, settle: boolean): void {
    if (this.awRuns.get(run.id) !== run) return;
    this.awRuns.delete(run.id);
    if (this.wing.id === run.id) this.wing.a = 0;
    const l = this.awLook.get(run.id);
    if (l) {
      if (settle) {
        l.face = l.aura = run.phase === 'on' ? 1 : 0;
      }
      l.burn = 0;
    }
    run.resolve();
  }

  private tickAwaken(now: number): boolean {
    if (this.awRuns.size === 0) return false;
    for (const run of this.awRuns.values()) {
      const p = this.pieces.find((q) => q.id === run.id);
      const t = now - run.start;
      if (!p || t >= run.tl.duration) {
        this.endRun(run, true);
        continue;
      }
      const sm = sampleAwaken(run.phase, run.tl, Math.max(0, t), run.face0, run.aura0, this.awSample);
      let l = this.awLook.get(run.id);
      if (!l) {
        l = { face: 0, aura: 0, burn: 0 };
        this.awLook.set(run.id, l);
      }
      l.face = sm.face;
      l.aura = sm.aura;
      l.burn = sm.burn;
      if (run.phase === 'on') {
        this.wing.id = run.id;
        this.wing.k = sm.wingK;
        this.wing.a = sm.wingA;
      }
      const x = p.pos.c + 0.5;
      const y = BOARD_SIZE - 0.5 - p.pos.r;
      if (!run.pulsed && t >= run.tl.pulseAt) {
        run.pulsed = true;
        this.awPulse = { t0: now, x, y };
        this.darkFlame(x, y, 0.95, 620, now);
        this.featherBurst(x, y, 8, 1.8, 0.36, 950, 0, now);
        this.tShake = now;
        this.shakeAmp = 1.3;
        this.shakeMs = 200;
      }
      if (!run.smoked && t >= run.tl.smokeAt) {
        run.smoked = true;
        this.awSmoke = { t0: now, x, y };
        this.featherBurst(x, y, 6, 1.0, 0.32, 1000, 0, now);
      }
    }
    return this.awRuns.size > 0;
  }

  /** Shown transform look of `p` (a shared scratch object when it simply follows the data). */
  private lookOf(p: Piece): AwakeLook {
    const l = this.awLook.get(p.id);
    if (l) return l;
    const k = awakenOf(p) > 0 ? 1 : 0;
    this.dataLook.face = k;
    this.dataLook.aura = k;
    this.dataLook.burn = 0;
    return this.dataLook;
  }

  /** Any transform aura on the board (keeps the light idle tick alive). */
  private get awakeOnBoard(): boolean {
    for (const p of this.pieces) if (this.lookOf(p).aura > 0) return true;
    return false;
  }

  private feather(x: number, y: number, vx: number, vy: number, size: number, life: number, tone: FeatherTone, rot: number, spin: number, now: number): void {
    const f: Feather2D = this.feathers.length < FEATHER_POOL ? { x, y, vx, vy, rot, spin, size, t0: now, life, tone } : this.feathers[this.featherNext];
    if (this.feathers.length < FEATHER_POOL) this.feathers.push(f);
    else {
      this.featherNext = (this.featherNext + 1) % FEATHER_POOL;
      Object.assign(f, { x, y, vx, vy, rot, spin, size, t0: now, life, tone });
    }
  }

  private featherBurst(x: number, y: number, n: number, speed: number, size: number, life: number, tone: FeatherTone, now: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(now * 0.013 + i * 2.3) * 0.4;
      const v = speed * (0.7 + 0.3 * Math.sin(i * 5.1 + now));
      this.feather(x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, Math.cos(a) * v, Math.sin(a) * v, size * (0.85 + 0.15 * (i % 3)), life, tone, a + Math.PI / 2, (i % 2 ? 1 : -1) * (1.5 + (i % 3)), now);
    }
  }

  private darkFlame(x: number, y: number, r: number, dur: number, now: number): void {
    this.dark = { t0: now, dur, x, y, r };
  }

  /** Transform aura under a coin at (x, y): two flickering flame-ring layers + rising embers. */
  private drawAura(x: number, y: number, k: number, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const S = cell * AURA_BOX;
    const px = S * this.dpr;
    const t = this.still ? 0 : now / 1000;
    ctx.save();
    const a0 = ctx.globalAlpha;
    // Smoky dark halo (normal blending: dims the rarity glow under it), then the flames on top.
    ctx.globalAlpha = a0 * k * (0.9 + 0.1 * Math.sin(t * 4.1));
    ctx.drawImage(auraSmokeSprite(px), x - S / 2, y - S / 2, S, S);
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 2; layer++) {
      const fl = layer === 0 ? 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) : 0.55 + 0.45 * Math.sin(t * 5.1 + 2) * Math.sin(t * 2.3);
      ctx.globalAlpha = a0 * k * fl;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(layer === 0 ? t * 0.35 : -t * 0.5 + 1.3);
      ctx.drawImage(auraSprite(px, layer as 0 | 1), -S / 2, -S / 2, S, S);
      ctx.restore();
    }
    const ep = emberSprite(cell * 0.3 * this.dpr);
    const e = this.ember;
    for (let i = 0; i < EMBER_COUNT; i++) {
      emberAt(i, t, e);
      if (e.k <= 0.01) continue;
      ctx.globalAlpha = a0 * k * Math.min(1, e.k);
      const d = e.s * cell * 4.5;
      ctx.drawImage(ep, x + Math.cos(e.a) * e.r * cell - d / 2, y + Math.sin(e.a) * e.r * cell - d / 2, d, d);
    }
    ctx.restore();
  }

  /** Flame wings unfolding from behind a coin at (x, y): `k` unfold, `a` opacity. */
  private drawWings(x: number, y: number, k: number, a: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const s = 0.45 + 0.6 * k;
    const W = 1.6 * cell * s;
    const H = W / 1.6;
    const spr = wingSprite(1.6 * cell * 1.05 * this.dpr);
    ctx.save();
    ctx.globalAlpha *= a;
    for (const side of [1, -1]) {
      ctx.save();
      ctx.translate(x + side * 0.17 * cell, y + 0.04 * cell);
      ctx.scale(side, 1);
      ctx.rotate(1.35 * (1 - k));
      ctx.drawImage(spr, -0.06 * W, -0.55 * H, W, H);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The blindfold burning away: a white-hot band across the eyes, its crimson edge racing out. */
  private drawBurn(x: number, y: number, b: number, sx: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const R = 0.385 * cell * sx;
    const ty = y - 0.024 * cell;
    const fade = 1 - clamp01((b - 0.65) / 0.35);
    const w = R * b * 1.15;
    if (w <= 0.5 || fade <= 0) return;
    const by = ty - 0.14 * R;
    const h = 0.13 * R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, ty, R * 0.775, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,39,66,0)');
    g.addColorStop(0.08, `rgba(255,60,40,${0.95 * fade})`);
    g.addColorStop(0.3, `rgba(255,220,190,${0.8 * fade})`);
    g.addColorStop(0.7, `rgba(255,220,190,${0.8 * fade})`);
    g.addColorStop(0.92, `rgba(255,60,40,${0.95 * fade})`);
    g.addColorStop(1, 'rgba(255,39,66,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w, by - h, w * 2, h * 2);
    ctx.restore();
  }

  /** Feathers, dark flame, the transform pulse and the revert smoke (over the pieces). */
  private drawRakaeliFx(now: number): void {
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const dt = this.lastFeatherT > 0 ? Math.min(0.05, Math.max(0, (now - this.lastFeatherT) / 1000)) : 1 / 60;
    this.lastFeatherT = now;
    const d = this.dark;
    if (d.t0 >= 0) {
      const k = (now - d.t0) / d.dur;
      if (k >= 1) d.t0 = -1;
      else if (k >= 0) {
        const x = x0 + d.x * cell;
        const y = y0 + d.y * cell;
        const e = easeOutCubic(k);
        const fade = 1 - k;
        const R = cell * d.r * (0.2 + 0.62 * e);
        ctx.save();
        // Smoky near-black bloom (darkens the board: normal blending).
        const sg = ctx.createRadialGradient(x, y, R * 0.25, x, y, R * 1.3);
        sg.addColorStop(0, `rgba(12,2,7,${0.2 * fade})`);
        sg.addColorStop(0.55, `rgba(18,3,10,${0.78 * Math.pow(fade, 0.7)})`);
        sg.addColorStop(1, 'rgba(18,3,10,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.3, 0, Math.PI * 2);
        ctx.fill();
        // Crimson / ember flame tongues licking off its rim.
        ctx.globalCompositeOperation = 'lighter';
        const el = now - d.t0;
        for (let layer = 0; layer < 2; layer++) {
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 2;
            const fl = Math.abs(Math.sin(a * 7 + el * 0.024 + layer * 1.9)) * Math.abs(Math.sin(a * 3 - el * 0.011)) * cell * 0.34 * fade;
            const rr = R + fl;
            if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.strokeStyle = hexAlpha(layer === 0 ? AWAKEN_COLORS.crimson : AWAKEN_COLORS.ember, 0.9 * fade);
          ctx.lineWidth = cell * (0.09 - layer * 0.04);
          ctx.stroke();
        }
        if (k < 0.25) {
          const fk = 1 - k / 0.25;
          const fg = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.5);
          fg.addColorStop(0, `rgba(255,230,215,${0.85 * fk})`);
          fg.addColorStop(1, 'rgba(255,39,66,0)');
          ctx.fillStyle = fg;
          ctx.fillRect(x - cell * 0.5, y - cell * 0.5, cell, cell);
        }
        ctx.restore();
      }
    }
    const pu = this.awPulse;
    if (pu.t0 >= 0) {
      const k = (now - pu.t0) / 560;
      if (k >= 1) pu.t0 = -1;
      else if (k >= 0) {
        const x = x0 + pu.x * cell;
        const y = y0 + pu.y * cell;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexAlpha(AWAKEN_COLORS.crimson, 0.9 * (1 - k));
        ctx.lineWidth = cell * 0.07 * (1 - k * 0.5);
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.35 + 1.0 * easeOutCubic(k)), 0, Math.PI * 2);
        ctx.stroke();
        if (k < 0.4) {
          const fk = 1 - k / 0.4;
          const g = ctx.createRadialGradient(x, y, 0, x, y, cell * 1.1);
          g.addColorStop(0, `rgba(255,235,225,${0.8 * fk})`);
          g.addColorStop(0.4, hexAlpha(AWAKEN_COLORS.crimson, 0.5 * fk));
          g.addColorStop(1, hexAlpha(AWAKEN_COLORS.violet, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - cell * 1.1, y - cell * 1.1, cell * 2.2, cell * 2.2);
        }
        ctx.restore();
      }
    }
    const sm = this.awSmoke;
    if (sm.t0 >= 0) {
      const k = (now - sm.t0) / 900;
      if (k >= 1) sm.t0 = -1;
      else if (k >= 0) {
        const x = x0 + sm.x * cell;
        const y = y0 + sm.y * cell;
        const spr = smokeSprite(cell * 0.9 * this.dpr);
        ctx.save();
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9 + 0.4;
          // Rolls outward off the coin so the base face reads again as it swaps back.
          const dd = cell * (0.3 + 0.75 * easeOutCubic(k)) * (0.7 + 0.3 * ((i * 3) % 4) / 3);
          const r = cell * (0.26 + 0.3 * k);
          ctx.globalAlpha = 0.85 * (1 - k) * (1 - k);
          ctx.drawImage(spr, x + Math.cos(a) * dd - r, y + Math.sin(a) * dd - r * 1.1 - k * cell * 0.25, r * 2, r * 2);
        }
        ctx.restore();
      }
    }
    if (this.feathers.length > 0) {
      const drag = Math.pow(0.12, dt);
      const fh = cell * 0.4 * this.dpr;
      ctx.save();
      let alive = 0;
      for (const f of this.feathers) {
        const k = (now - f.t0) / f.life;
        if (k >= 1 || k < 0) continue;
        alive++;
        f.vx *= drag;
        f.vy *= drag;
        f.x += f.vx * dt;
        f.y += f.vy * dt + 0.08 * dt;
        f.rot += f.spin * dt;
        f.spin *= Math.pow(0.5, dt);
        const h = cell * f.size * (1 - 0.25 * k);
        const flut = 0.55 + 0.45 * Math.abs(Math.cos(f.rot * 3.1 + k * 9));
        ctx.globalAlpha = Math.min(1, k * 8) * (1 - k * k);
        ctx.save();
        ctx.translate(x0 + (f.x + Math.sin(k * 7 + f.rot) * 0.05) * cell, y0 + f.y * cell);
        ctx.rotate(f.rot);
        ctx.drawImage(featherSprite(f.tone, fh), (-h / 4) * flut, -h / 2, (h / 2) * flut, h);
        ctx.restore();
      }
      ctx.restore();
      if (alive === 0) this.feathers.length = 0;
    }
  }

  /** True while any Rakaeli one-shot effect is visible. */
  private rakFxActive(now: number): boolean {
    if (this.awRuns.size > 0 || this.dark.t0 >= 0 || this.awPulse.t0 >= 0 || this.awSmoke.t0 >= 0) return true;
    for (const f of this.feathers) if (now - f.t0 < f.life) return true;
    return false;
  }

  /**
   * Storm state: step `storm` = columns consumed per side (0 = none; from step 3 also
   * `stormRows(storm)` rows at the top and bottom), `nextIn` plies until the next shrink (null =
   * inactive). Storm columns and rows get a purple field, a glowing boundary line and dimmed tiles;
   * with nextIn <= 2 the next columns (and rows, once they close in) pulse a warning frame.
   */
  setStorm(storm: number, nextIn: number | null): void {
    if (this.disposed) return;
    this.storm = Math.max(0, Math.min(STORM_FULL_STEPS, Math.floor(storm)));
    this.stormNext = nextIn;
    this.requestRender();
  }

  /** Wasteland squares (r * BOARD_SIZE + c, full list). */
  setWaste(squares: number[]): void {
    if (this.disposed) return;
    const next = squares.filter((q) => Number.isInteger(q) && q >= 0 && q < BOARD_SIZE * BOARD_SIZE);
    for (const q of [...this.wasteOpen.keys()]) if (!next.includes(q)) this.wasteOpen.delete(q);
    this.waste.clear();
    for (const q of next) this.waste.add(q);
    this.requestRender();
  }

  /** Michelle's doll traps (full list). */
  setTraps(traps: readonly Trap[]): void {
    if (this.disposed) return;
    this.traps = traps.filter((t) => Number.isInteger(t.sq) && t.sq >= 0 && t.sq < BOARD_SIZE * BOARD_SIZE).map((t) => ({ sq: t.sq, owner: t.owner }));
    this.requestRender();
  }

  /** Skill targeting: anchors get a subtle green tint, the preview area a green (or red) ghost. */
  setSkillPreview(anchors: number[] | null, preview: SkillPreview | null): void {
    if (this.disposed) return;
    this.anchors = anchors ? [...anchors] : [];
    this.preview = preview ? { squares: [...preview.squares], valid: preview.valid } : null;
    this.previewSet = new Set(this.preview?.squares ?? []);
    this.requestRender();
  }

  /**
   * Brutile lays wasteland: rune + flare on the caster, a green bolt to the area, the squares crack
   * open one after another, small shake. Always resolves (also when cut short or disposed).
   */
  animateSkill(caster: string, squares: number[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const list = [...new Set(squares)].filter((q) => Number.isInteger(q) && q >= 0 && q < BOARD_SIZE * BOARD_SIZE);
    if (list.length === 0) return Promise.resolve();
    const now = performance.now();
    const cp = this.pieces.find((p) => p.id === caster) ?? null;
    const centre = { r: 0, c: 0 };
    for (const q of list) {
      centre.r += Math.floor(q / BOARD_SIZE) / list.length;
      centre.c += (q % BOARD_SIZE) / list.length;
    }
    const from = cp ? { ...cp.pos } : { ...centre };
    const cells = list.map((q) => {
      const r = Math.floor(q / BOARD_SIZE);
      const c = q % BOARD_SIZE;
      return { q, d: Math.hypot(r - centre.r, c - centre.c) + 0.01 * Math.hypot(r - from.r, c - from.c) };
    });
    cells.sort((a, b) => a.d - b.d);
    const crackAt = cp ? SKILL_CRACK_AT : 120;
    const stagger = cells.length > 1 ? Math.min(75, 380 / (cells.length - 1)) : 0;
    for (const c of cells) {
      if (!this.waste.has(c.q)) this.wasteOpen.set(c.q, 0);
      this.waste.add(c.q);
    }
    const dc = centre.c - from.c;
    return new Promise<void>((resolve) => {
      this.skill = {
        start: now,
        casterId: cp ? cp.id : null,
        from,
        centre,
        squares: cells.map((c, i) => ({ sq: c.q, at: crackAt + i * stagger, fired: false })),
        boltAt: cp ? SKILL_BOLT_AT : 0,
        duration: crackAt + stagger * (cells.length - 1) + SKILL_CRACK_MS + 40,
        bow: Math.min(1.6, 0.35 * Math.hypot(centre.r - from.r, dc)) * (dc >= 0 ? 1 : -1),
        shook: false,
        resolve,
      };
      this.requestRender();
      this.watchFrames();
    });
  }

  private tickSkill(now: number): void {
    const s = this.skill;
    if (!s) return;
    const t = now - s.start;
    if (t >= s.duration) {
      this.finishSkill();
      return;
    }
    for (const q of s.squares) {
      const k = (t - q.at) / SKILL_CRACK_MS;
      if (k < 0) continue;
      if (this.wasteOpen.has(q.sq)) this.wasteOpen.set(q.sq, easeOutCubic(clamp01(k)));
      if (!q.fired) {
        q.fired = true;
        const x = this.cx(q.sq % BOARD_SIZE);
        const y = this.cy(Math.floor(q.sq / BOARD_SIZE));
        for (let i = 0; i < 7; i++) this.skillSparks.push({ x, y, a: i * 0.9 + q.sq * 0.37, v: 0.7 + 0.3 * Math.sin(q.sq + i * 2.1), t0: now });
        if (!s.shook) {
          s.shook = true;
          this.tSkillHit = now;
          this.tShake = now;
          this.shakeAmp = this.reducedMotion ? 0 : 1.7;
          this.shakeMs = 240;
        }
      }
    }
  }

  /** End the cast now (natural end or cut short): every square fully open. */
  private finishSkill(): void {
    const s = this.skill;
    if (!s) return;
    this.skill = null;
    try {
      for (const q of s.squares) this.wasteOpen.delete(q.sq);
      this.requestRender();
    } finally {
      s.resolve();
    }
  }

  private get stormActive(): boolean {
    return this.storm > 0 || this.stormNext !== null;
  }

  /** Square in the storm, or (slack 1) in the next band to be consumed (vanish detection tolerates call order). */
  private stormAt(r: number, c: number, slack = 0): boolean {
    return stormSquare(r, c, this.storm, slack);
  }

  /** Pieces missing from `next` (other than `skipId`) that stood near the storm edge dissolve. */
  private collectStormVictims(next: Piece[], skip: string | readonly string[] | null): void {
    if (!this.stormActive) return;
    const seen = new Set(next.map((p) => p.id));
    if (skip !== null) for (const id of typeof skip === 'string' ? [skip] : skip) seen.add(id);
    const now = performance.now();
    for (const p of this.pieces) {
      if (seen.has(p.id) || !this.stormAt(p.pos.r, p.pos.c, 1)) continue;
      this.fading.push({ piece: { ...p, pos: { ...p.pos } }, start: now });
    }
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const mover = this.pieces.find((p) => p.id === move.pieceId);
    if (!mover) {
      this.setPieceList(clonePieces(piecesAfter));
      this.requestRender();
      if (move.captureId) this.emitImpact(move);
      return Promise.resolve();
    }
    if (isHopMove(mover, move)) return this.animateHop(mover, move, piecesAfter);
    const now = performance.now();
    const ch = mover.character;
    const chain = ch === 'insaner' && this.lastCapture?.id === move.pieceId && now - this.lastCapture.t < CHAIN_WINDOW_MS;
    this.lastCapture = null;
    const captured = move.captureId ? (this.pieces.find((p) => p.id === move.captureId) ?? null) : null;
    const capture = !!move.captureId;
    const wasted = !!move.wasted && !capture;
    // Rakaeli and Larhen leap like Walk.
    const rk = rakaeliStyle(mover);
    const jump = ch === 'walk' || ch === 'larhen' || rk !== null;
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const dr = move.to.r - move.from.r;
    const dc = move.to.c - move.from.c;
    const dist = Math.hypot(dr, dc);
    const f = capture && dist > 1e-6 ? Math.max(0, (dist - STRIKE_RANGE) / dist) : 1;
    const strike = { r: move.from.r + dr * f, c: move.from.c + dc * f };
    const impactAt = capture ? moveDur + (jump ? 90 : 60) : Infinity;
    const deathStart = impactAt + HIT_MS;
    const stepStart = impactAt + STEP_AT;
    const duration = capture
      ? Math.max(stepStart + STEP_MS, deathStart + DEATH_MS) + 20
      : wasted
        ? moveDur + WASTE_DIE_MS + 30
        : moveDur + (jump ? ANIM.land : 40);
    // Skill flavour on move start.
    this.trail.length = 0;
    const fx = CHARACTER_FX[ch];
    if (ch === 'sad' || ch === 'brutile') {
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) - this.layout.cell * (ch === 'sad' ? 0.25 : 0) };
      this.glintColor = fx.primary;
    } else if (chain) {
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) };
      this.glintColor = '#FF4FE8';
    } else if (!rk) {
      // Everyone else: a take-off glint in the character's core colour (its signature).
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) };
      this.glintColor = fx.primary;
    }
    this.trailColor = chain ? '#D04BFF' : ch === 'marki' ? '#FFE2B0' : rk === 'awake' ? RAKAELI_AWAKE_FX.primary : fx.primary;
    if (rk === 'awake') {
      this.darkFlame(mover.pos.c + 0.5, BOARD_SIZE - 0.5 - mover.pos.r, 0.62, 460, now);
      this.tGlint = now;
      this.glintAt = { x: this.cx(mover.pos.c), y: this.cy(mover.pos.r) };
      this.glintColor = RAKAELI_AWAKE_FX.primary;
    }
    return new Promise<void>((resolve) => {
      this.anim = {
        move,
        start: now,
        duration,
        moveDur,
        moverId: move.pieceId,
        character: ch,
        from: { ...move.from },
        to: { ...move.to },
        strike,
        jump,
        charge: ch === 'marki' && dist >= 2,
        chain,
        capture,
        captured,
        impactAt,
        impactFired: false,
        deathStart,
        stepStart,
        landed: false,
        wasted,
        piecesAfter: clonePieces(piecesAfter),
        hop: null,
        rk,
        nextFeather: rk ? 30 : Infinity,
        resolve,
      };
      this.requestRender();
      this.watchFrames();
    });
  }

  /**
   * Picker's hop-through: short arcs square by square with a "콩" squash on each landing; every
   * enemy on the way is struck the moment he lands on it (capture FX + onImpact per victim).
   * Reduced motion: fast, flat hops.
   */
  private animateHop(mover: Piece, move: Move, piecesAfter: Piece[]): Promise<void> {
    const now = performance.now();
    this.lastCapture = null;
    const timing = hopTimingFor(mover.character, this.reducedMotion);
    const squares = hopSquares(move);
    const ids = move.captureIds ?? (move.captureId ? [move.captureId] : []);
    const victims: Hop2D['victims'] = [];
    for (const id of ids) {
      const v = this.pieces.find((p) => p.id === id);
      if (!v) continue;
      const step = squares.findIndex((q) => q.r === v.pos.r && q.c === v.pos.c);
      victims.push({ piece: v, impactAt: (Math.max(0, step) + 1) * timing.stepMs, fired: false });
    }
    const moveDur = squares.length * timing.stepMs;
    const lastImpact = victims.reduce((m, v) => Math.max(m, v.impactAt), 0);
    const wasted = !!move.wasted;
    const duration = Math.max(moveDur + timing.landMs, lastImpact ? lastImpact + HIT_MS + DEATH_MS : 0, wasted ? moveDur + WASTE_DIE_MS : 0) + 30;
    this.trail.length = 0;
    this.trailColor = CHARACTER_FX[mover.character].primary;
    return new Promise<void>((resolve) => {
      this.anim = {
        move,
        start: now,
        duration,
        moveDur,
        moverId: move.pieceId,
        character: mover.character,
        from: { ...move.from },
        to: { ...move.to },
        strike: { ...move.to },
        jump: true,
        charge: false,
        chain: false,
        capture: false,
        captured: null,
        impactAt: Infinity,
        impactFired: true,
        deathStart: Infinity,
        stepStart: Infinity,
        landed: false,
        wasted,
        piecesAfter: clonePieces(piecesAfter),
        hop: { squares, stepMs: timing.stepMs, landMs: timing.landMs, arc: timing.arc, victims, landed: -1 },
        rk: null,
        nextFeather: Infinity,
        resolve,
      };
      this.requestRender();
      this.watchFrames();
    });
  }

  /** Hop landings ("콩" ring) and victim impacts up to time `t`. */
  private tickHop(a: Anim2D, hop: Hop2D, t: number, now: number): void {
    const done = Math.min(hop.squares.length, Math.floor(t / hop.stepMs)) - 1;
    while (hop.landed < done) {
      hop.landed++;
      this.tLand = now;
      this.landAt = { ...hop.squares[hop.landed] };
      this.landColor = CHARACTER_FX[a.character].primary;
    }
    if (done >= hop.squares.length - 1) a.landed = true;
    for (const v of hop.victims) {
      if (v.fired || t < v.impactAt) continue;
      v.fired = true;
      this.tCap = now;
      this.tShake = now;
      this.capKind = a.character;
      this.capAt = { ...v.piece.pos };
      const dc = a.to.c - a.from.c;
      const dr = a.to.r - a.from.r;
      const l = Math.hypot(dc, dr) || 1;
      this.capDir = { x: dc / l, y: -dr / l };
      this.capBurst = Array.from({ length: 12 }, (_, i) => ({ a: (i / 12) * Math.PI * 2 + Math.sin(now + i * 7.3) * 0.35, v: 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.37 + i * 3.1)) }));
      this.shakeAmp = this.reducedMotion ? 0.5 : 1.3;
      this.shakeMs = ANIM.shake;
      this.soulTo = null;
      this.capRak = null;
      this.emitImpact({ ...a.move, captureId: v.piece.id });
    }
  }

  /** Register the strike-impact listener (called once per capturing move, at the impact frame). */
  onImpact(cb: (move: Move) => void): void {
    this.impactCb = cb;
  }

  private emitImpact(move: Move): void {
    try {
      this.impactCb?.(move);
    } catch (err) {
      console.error('[render] onImpact listener failed:', err);
    }
  }

  setHighlights(h: BoardHighlights): void {
    if (this.disposed) return;
    const prevSel = this.hi.selected;
    this.highlights = h;
    this.hi = indexHighlights(h);
    if (this.selectFxOn && this.hi.selected >= 0 && this.hi.selected !== prevSel && !this.anim) this.startSelectFx(h);
    this.requestRender();
  }

  /** Selection signature (see BoardView.selectFx): a rune sigil, a glint, Venoa's lane sweep. */
  private sel: { t0: number; at: Pos; c1: string; c2: string; lanes: Pos[]; laneCol: string } | null = null;

  private startSelectFx(h: BoardHighlights): void {
    const k = this.hi.selected;
    const p = this.pieces.find((q) => posKey(q.pos) === k);
    if (!p) return;
    const now = performance.now();
    const fx = rakaeliStyle(p) === 'awake' ? RAKAELI_AWAKE_FX : CHARACTER_FX[p.character];
    const lanes = this.reducedMotion ? [] : shotLaneEnds(p.pos, [...(h.shotRange ?? []), ...(h.shots ?? [])]);
    this.sel = { t0: now, at: { ...p.pos }, c1: fx.primary, c2: fx.secondary, lanes, laneCol: h.tone === 'enemy' ? BOARD_COLORS.shotEnemy : BOARD_COLORS.shotOwn };
    this.tGlint = now;
    this.glintAt = { x: this.cx(p.pos.c), y: this.cy(p.pos.r) };
    this.glintColor = fx.primary;
  }

  private drawSelectFx(now: number): void {
    const sf = this.sel;
    if (!sf) return;
    const el = now - sf.t0;
    if (el >= SELECT_FX_MS) {
      this.sel = null;
      return;
    }
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const k = el / SELECT_FX_MS;
    const x = this.cx(sf.at.c);
    const y = this.cy(sf.at.r);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    fx2dSigil(ctx, x, y, cell * 1.15, easeOutCubic(k), 1 - k, el, sf.c1, sf.c2);
    // Venoa: a bright arrow head with a fading tail runs out along each lane.
    const ak = clamp01(el / 340);
    if (ak < 1) {
      ctx.lineCap = 'round';
      for (const end of sf.lanes) {
        const ex = this.cx(end.c);
        const ey = this.cy(end.r);
        const hx = x + (ex - x) * easeOutCubic(ak);
        const hy = y + (ey - y) * easeOutCubic(ak);
        const tk = Math.max(0, easeOutCubic(ak) - 0.35);
        const g = ctx.createLinearGradient(x + (ex - x) * tk, y + (ey - y) * tk, hx, hy);
        g.addColorStop(0, hexAlpha(sf.laneCol, 0));
        g.addColorStop(1, hexAlpha(sf.laneCol, 0.95 * (1 - ak * ak)));
        ctx.strokeStyle = g;
        ctx.lineWidth = cell * 0.08;
        ctx.beginPath();
        ctx.moveTo(x + (ex - x) * tk, y + (ey - y) * tk);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = hexAlpha('#FFFFFF', 1 - ak);
        ctx.beginPath();
        ctx.arc(hx, hy, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  onCellClick(cb: (pos: Pos) => void): void {
    this.cellCb = cb;
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.down = null;
    this.canvas.style.cursor = enabled ? 'pointer' : 'default';
  }

  pickCell(clientX: number, clientY: number): Pos | null {
    if (this.disposed) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { x0, y0, cell, pad } = this.layout;
    const x = clientX - rect.left - x0;
    const y = clientY - rect.top - y0;
    const size = cell * BOARD_SIZE;
    const tol = pad * 0.8;
    if (x < -tol || y < -tol || x > size + tol || y > size + tol) return null;
    const c = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(x / cell)));
    const r = Math.min(BOARD_SIZE - 1, Math.max(0, BOARD_SIZE - 1 - Math.floor(y / cell)));
    return { r, c };
  }

  cellRect(pos: Pos): ScreenRect | null {
    if (this.disposed) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { x0, y0, cell } = this.layout;
    return { left: rect.left + x0 + pos.c * cell, top: rect.top + y0 + (BOARD_SIZE - 1 - pos.r) * cell, width: cell, height: cell };
  }

  setDragging(pieceId: string | null): void {
    if (this.disposed || pieceId === this.draggingId) return;
    this.draggingId = pieceId;
    this.requestRender();
  }

  /**
   * Turn feedback: a subtle glow on the board edge in `owner`'s team colour (null = off). Fades in /
   * out over TURN_GLOW_MS (instant with reduced motion).
   */
  setTurnGlow(owner: 0 | 1 | null): void {
    if (this.disposed || owner === this.glowOwner) return;
    const prev = this.glowOwner;
    this.glowOwner = owner;
    if (owner !== null) this.glowColor = owner;
    // Switching teams restarts from dark so the colour never snaps on a lit glow.
    this.glowFrom = prev !== null && owner !== null ? 0 : this.glowLevel;
    this.glowTo = owner === null ? 0 : 1;
    if (this.reducedMotion) {
      this.tGlow = -1;
      this.glowLevel = this.glowTo;
    } else {
      this.tGlow = performance.now();
    }
    this.requestRender();
  }

  private tickGlow(now: number): void {
    if (this.tGlow < 0) return;
    const k = clamp01((now - this.tGlow) / TURN_GLOW_MS);
    this.glowLevel = this.glowFrom + (this.glowTo - this.glowFrom) * easeOutCubic(k);
    if (k >= 1) this.tGlow = -1;
  }

  /** The team's turn glow sprite at the current size: painted white, then tinted (as the WebGL tint). */
  private glowSprite(team: PlayerId): HTMLCanvasElement | null {
    const cached = this.glowSprites[team];
    if (cached) return cached;
    const d = this.dpr;
    const s = this.layout.cell * d;
    const m = turnGlowMargin(this.frameStyle) * s;
    const px = Math.max(1, Math.round(BOARD_SIZE * s + m * 2));
    const cvs = document.createElement('canvas');
    cvs.width = px;
    cvs.height = px;
    const g = ctx2d(cvs);
    if (!g) return null;
    paintTurnGlow(g, s, m, m, [1, 1, 1], this.frameStyle);
    // Self-test: the spill must leave the field see-through (see arena.ts fillFrameHole).
    const mid = (Math.floor(BOARD_SIZE / 2) - 0.5) * s + m;
    const a = alphaAt(g, mid, mid);
    if (a > SEE_THROUGH_MAX_ALPHA) {
      this.note(`turn glow centre alpha ${a.toFixed(2)}: repainted without spill`);
      g.clearRect(0, 0, px, px);
      paintTurnGlow(g, s, m, m, [1, 1, 1], this.frameStyle, { spill: false });
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = TEAM_COLORS[team].glow;
    g.fillRect(0, 0, px, px);
    this.glowSprites[team] = cvs;
    return cvs;
  }

  /** Optional extra (not part of IBoardView): the side to move changed; sweeps its zone line. */
  setTurn(player: 0 | 1): void {
    if (this.disposed) return;
    this.turn = player;
    this.tTurn = performance.now();
    this.requestRender();
  }

  private note(n: string): void {
    if (!this.diagNotes.includes(n)) this.diagNotes.push(n);
  }

  /** Diagnostics for the ?diag=1 panel. */
  getDiagnostics(): RenderDiagnostics {
    return {
      renderer: '2d',
      dpr: this.dpr,
      canvas: [this.canvas.width, this.canvas.height],
      css: [Math.round(this.cssW), Math.round(this.cssH)],
      frame: this.frameStyle.id,
      programs: [],
      notes: [...this.diagNotes, `theme ${this.theme.id}`],
      nullCtx: canvasStats.nullCtx,
      canvases: canvasStats.created,
      fallbackReason: getFallbackReason(),
    };
  }

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    // Same framing as the WebGL board: the bezel (+ its lip) fills the limiting side; phones get
    // the slim bezel edge to edge.
    this.frameStyle = frameStyleFor(w);
    const slim = this.frameStyle.id === 'slim';
    const F = frameFit(this.frameStyle);
    const spanX = BOARD_SIZE + F.side * 2;
    const topE = F.top;
    const botE = F.bottom;
    const cell = Math.max(1, Math.min((w * (slim ? 1 : 0.985)) / spanX, (h * (slim ? 1 : 0.975)) / (BOARD_SIZE + topE + botE)));
    const size = cell * BOARD_SIZE;
    const pad = F.side * cell;
    this.layout = { x0: (w - size) / 2, y0: (h - (BOARD_SIZE + topE + botE) * cell) / 2 + topE * cell, cell, pad };
    this.sprites.clear();
    this.wasteSprites.clear();
    clearAwakenSprites();
    this.glowSprites[0] = null;
    this.glowSprites[1] = null;
    this.buildBoardLayer();
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposing = true;
    this.finishAnimation(false);
    for (const run of [...this.awRuns.values()]) this.endRun(run, true);
    this.disposed = true;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = 0;
    this.impactCb = null;
    faceWaiters.delete(this.onFaceLoaded);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.width = 0;
    this.canvas.height = 0;
    // Free every backing store now (iOS counts live canvases against a page-wide budget).
    releaseCanvas(this.boardLayer);
    releaseCanvas(this.overlayLayer);
    releaseCanvas(this.glowSprites[0]);
    releaseCanvas(this.glowSprites[1]);
    this.boardLayer = null;
    this.overlayLayer = null;
    this.glowSprites[0] = null;
    this.glowSprites[1] = null;
    this.sprites.clear();
    this.wasteSprites.clear();
    clearAwakenSprites();
    clearAmbientSprites();
    this.canvas.remove();
    this.pieces = [];
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- render loop

  /**
   * Paint the static arena once per size (arena.ts): the bezel + field well and the BOARD_SIZE x BOARD_SIZE flat cells
   * in their base colours (home tints included) into the board layer, and the hologram overlay into
   * its own field-sized layer. Per frame only highlight / storm / wasteland tints are drawn between
   * the two.
   */
  private buildBoardLayer(): void {
    const cvs = this.boardLayer ?? document.createElement('canvas');
    const d = this.dpr;
    cvs.width = Math.max(1, Math.round(this.cssW * d));
    cvs.height = Math.max(1, Math.round(this.cssH * d));
    const { x0, y0, cell } = this.layout;
    const s = cell * d;
    const g = ctx2d(cvs);
    if (g) {
      const ox = x0 * d;
      const oy = y0 * d;
      g.clearRect(0, 0, cvs.width, cvs.height);
      paintFrame(g, s, ox, oy, this.frameStyle, this.theme);
      const base = indexHighlights({});
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) paintTile(g, ox + c * s, oy + (BOARD_SIZE - 1 - r) * s, s, tileRgb(r, c, base, this.tilePal));
      }
    }
    this.boardLayer = cvs;
    const ov = this.overlayLayer ?? document.createElement('canvas');
    const m = FIELD_OVERLAY_MARGIN * s;
    ov.width = Math.max(1, Math.round(BOARD_SIZE * s + m * 2));
    ov.height = ov.width;
    const og = ctx2d(ov);
    if (og) {
      og.clearRect(0, 0, ov.width, ov.height);
      paintFieldOverlay(og, s, m, m, { theme: this.theme });
      // Self-test: the field must stay see-through, or repaint without the hole-based shadow.
      const mid = (Math.floor(BOARD_SIZE / 2) - 0.5) * s + m;
      const a = alphaAt(og, mid, mid);
      if (a > SEE_THROUGH_MAX_ALPHA) {
        this.note(`overlay centre alpha ${a.toFixed(2)}: repainted without edge shadow`);
        og.clearRect(0, 0, ov.width, ov.height);
        paintFieldOverlay(og, s, m, m, { edgeShadow: false, theme: this.theme });
      }
    }
    this.overlayLayer = ov;
  }

  /** Something changed: draw on the next frame, past the idle frame caps. */
  private requestRender(): void {
    this.dirty = true;
    this.nextFrame();
  }

  /** Keep the frame loop going (an animation or idle loop runs); no forced draw. */
  private nextFrame(): void {
    if (this.disposed || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  /**
   * Throttled idle loop: sleep on a timer until the next draw is due, then align to a frame
   * (instead of waking on every display refresh just to skip it).
   */
  private nextFrameIn(ms: number): void {
    if (this.disposed || this.rafId !== 0 || this.wakeTimer !== 0) return;
    if (ms <= WAKE_MIN_MS) {
      this.nextFrame();
      return;
    }
    this.wakeTimer = window.setTimeout(() => {
      this.wakeTimer = 0;
      this.nextFrame();
    }, ms - WAKE_EARLY_MS);
  }

  private get pulsing(): boolean {
    const h = this.highlights;
    return !!h.selected || (h.moves?.length ?? 0) > 0 || (h.captures?.length ?? 0) > 0 || (h.shotRange?.length ?? 0) > 0 || (h.freezeRange?.length ?? 0) > 0 || (h.deadly?.length ?? 0) > 0;
  }

  private fxActive(now: number): boolean {
    return (
      (this.tLand >= 0 && now - this.tLand < ANIM.pulse) ||
      (this.tCap >= 0 && now - this.tCap < FX_MS + 300) ||
      (this.tShake >= 0 && now - this.tShake < this.shakeMs) ||
      (this.tGlint >= 0 && now - this.tGlint < 320) ||
      (this.sel !== null && now - this.sel.t0 < SELECT_FX_MS) ||
      (this.tTurn >= 0 && now - this.tTurn < ANIM.turn) ||
      this.tGlow >= 0 ||
      this.trail.length > 0 ||
      this.fading.length > 0 ||
      (this.tSkillHit >= 0 && now - this.tSkillHit < 520) ||
      this.skillSparks.length > 0 ||
      this.rakFxActive(now)
    );
  }

  private tShake = -1;

  /** Ambient particles run while the theme has some, motion is allowed and the page is visible. */
  private get ambientOn(): boolean {
    return !!this.theme.ambient && !this.still && !document.hidden;
  }

  /** Covered board (setPaused): decorative idle loops stop. */
  private paused = false;
  /** 절전 모드 (setLowPower): no decorative idle loops, ~30 fps animations. */
  private lowPower = false;

  /** Decorative motion rests (reduced motion, covered board or 절전 모드): steady draw-time looks. */
  private get still(): boolean {
    return this.reducedMotion || this.paused || this.lowPower;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.requestRender();
  }

  /** 선택 이펙트 on / off (settings.selectFx). */
  private selectFxOn = true;
  setSelectFx(on: boolean): void {
    this.selectFxOn = on;
    if (!on) this.sel = null;
  }

  setLowPower(on: boolean): void {
    if (this.lowPower === on) return;
    this.lowPower = on;
    this.requestRender();
  }

  /**
   * Switch the arena board theme (arenaThemes.ts; unknown ids = moonrune): repaints the static
   * layers into the same canvases (nothing new is allocated). Same theme: no-op.
   */
  setArenaTheme(id: string): void {
    const next = boardTheme(id);
    if (this.disposed || next === this.theme) return;
    this.theme = next;
    this.tilePal = tilePalette(next);
    clearAmbientSprites();
    this.buildBoardLayer();
    this.requestRender();
  }

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    try {
      this.renderFrame(now);
    } catch (err) {
      this.onFrameError(err);
    }
  };

  /**
   * A frame threw (an FX bug...). The loop must never die with a move, cast or transform still
   * pending: the game awaits those promises. Settle them all at their end state.
   */
  private onFrameError(err: unknown): void {
    if (!this.frameErrorLogged) {
      this.frameErrorLogged = true;
      console.error('[render] frame failed; running animations settled:', err);
    }
    this.settleRunning();
  }

  /**
   * A move / cast / transform just started: never let it wait on frames that do not come. Hidden
   * page: finished at once. Otherwise checked every FRAME_STALL_MS: no frame for that long (a
   * hidden, starved or throttled page), finished at its end state.
   */
  private watchFrames(): void {
    if (document.hidden) {
      this.settleRunning();
      return;
    }
    this.lastRafAt = performance.now();
    if (!this.stallTimer) this.stallTimer = window.setTimeout(this.onStallCheck, FRAME_STALL_MS);
  }

  private readonly onStallCheck = (): void => {
    this.stallTimer = 0;
    if (this.disposed || (!this.anim && !this.skill && this.awRuns.size === 0)) return;
    if (document.hidden || performance.now() - this.lastRafAt >= FRAME_STALL_MS) this.settleRunning();
    else this.stallTimer = window.setTimeout(this.onStallCheck, FRAME_STALL_MS);
  };

  /** Finish every running move / cast / transform now, at its end state. */
  private settleRunning(): void {
    try {
      this.finishAnimation(false);
    } catch (e) {
      console.error('[render] settling the animation failed:', e);
    }
    for (const run of [...this.awRuns.values()]) {
      try {
        this.endRun(run, true);
      } catch (e) {
        console.error('[render] settling a transform failed:', e);
      }
    }
  }

  private renderFrame(now: number): void {
    this.lastRafAt = performance.now();
    if (this.anim) this.tickAnim(now);
    this.tickSkill(now);
    this.tickAwaken(now);
    this.tickGlow(now);
    const busy = !!this.anim || !!this.skill || this.fxActive(now);
    const ringLoop = this.hasLegendary && !this.still && !document.hidden;
    // Wasteland glow / bubbles and the targeting ghost breathe at <= ~30 fps (static if reduced motion).
    const wasteLoop = !this.still && !document.hidden && (this.waste.size > 0 || this.traps.length > 0 || this.anchors.length > 0 || this.preview !== null);
    // Rakaeli's transform aura flickers at the same light rate (static with reduced motion).
    const awakeLoop = !this.still && !document.hidden && this.awakeOnBoard;
    // The storm field and its next-line warning are game information: they keep moving in 절전 모드.
    const stormLoop = this.storm > 0 || (this.stormActive && this.stormNext !== null && this.stormNext <= 2);
    const lightLoop = this.pulsing || ringLoop || wasteLoop || awakeLoop || stormLoop;
    // Ambient arena particles alone tick at the lightest rate (~10–20 fps by theme).
    const ambientLoop = this.ambientOn;
    const loop = !this.paused && (this.lowPower ? stormLoop : lightLoop || ambientLoop);
    const since = now - this.lastFrame;
    if (busy || this.dirty) {
      // High-refresh displays (120 Hz+): moves draw every other refresh (see BUSY_FRAME_MS).
      if (since < (this.lowPower ? LOW_POWER_FRAME_MS : BUSY_FRAME_MS)) {
        this.nextFrame();
        return;
      }
    } else if (loop) {
      const spec = this.theme.ambient;
      const cap = lightLoop || !spec ? IDLE_FRAME_MS : ambientFrameMs(spec);
      if (since < cap - CAP_SLACK_MS) {
        this.nextFrameIn(cap - since);
        return;
      }
    }
    this.dirty = false;
    this.lastFrame = now;
    this.draw(now);
    if (busy || loop) this.nextFrame();
  }

  private tickAnim(now: number): void {
    const a = this.anim;
    if (!a) return;
    // rAF timestamps are the frame's start time: the first frame after animateMove can be dated a
    // little BEFORE `a.start`. Clamped, or the hop's square index goes negative.
    const t = Math.max(0, now - a.start);
    if (t >= a.duration) {
      this.finishAnimation(true);
      return;
    }
    if (a.hop) {
      this.tickHop(a, a.hop, t, now);
      return;
    }
    if (!a.landed && t >= a.moveDur) {
      a.landed = true;
      this.tLand = now;
      this.landAt = { ...a.strike };
      this.landColor = a.wasted
        ? WASTE_COLORS.glow
        : a.rk === 'awake'
          ? RAKAELI_AWAKE_FX.primary
          : a.rk === 'ash'
            ? CHARACTER_FX.rakaeli.primary
            : CHARACTER_FX[a.character].primary; // the mover's own colour (its signature)
      if (a.rk && !a.wasted) {
        const x = a.strike.c + 0.5;
        const y = BOARD_SIZE - 0.5 - a.strike.r;
        if (a.rk === 'awake' && !a.capture) this.darkFlame(x, y, 0.78, 520, now);
        this.featherBurst(x, y, a.rk === 'awake' ? 6 : 4, a.rk === 'awake' ? 1.4 : 1.0, a.rk === 'awake' ? 0.3 : 0.26, 720, a.rk === 'awake' ? 0 : 1, now);
      }
    }
    if (a.capture && !a.impactFired && t >= a.impactAt) {
      a.impactFired = true;
      this.startImpact(a, now);
      this.emitImpact(a.move);
    }
  }

  private startImpact(a: Anim2D, now: number): void {
    this.tCap = now;
    this.tShake = now;
    this.capKind = a.character;
    this.capAt = a.captured ? { ...a.captured.pos } : { ...a.to };
    // A Venoa shot is animated with to = from: her arrow's direction is toward the victim.
    const aim = a.to.r === a.from.r && a.to.c === a.from.c ? this.capAt : a.to;
    const dc = aim.c - a.from.c;
    const dr = aim.r - a.from.r;
    const l = Math.hypot(dc, dr) || 1;
    this.capDir = { x: dc / l, y: -dr / l };
    this.capBurst = Array.from({ length: 12 }, (_, i) => ({
      a: (i / 12) * Math.PI * 2 + Math.sin(now + i * 7.3) * 0.35,
      v: 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.37 + i * 3.1)),
    }));
    this.shakeAmp = this.reducedMotion ? Math.min(0.6, CAPTURE_SHAKE_2D[a.character] ?? 1) : (CAPTURE_SHAKE_2D[a.character] ?? 1);
    this.shakeMs = a.character === 'marki' || a.character === 'hammont' ? 270 : ANIM.shake;
    this.soulTo = a.character === 'insaner' ? a.moverId : null;
    if (a.character === 'insaner') this.lastCapture = { id: a.moverId, t: now };
    this.capRak = a.rk;
    if (a.rk) {
      const x = this.capAt.c + 0.5;
      const y = BOARD_SIZE - 0.5 - this.capAt.r;
      if (a.rk === 'awake') {
        // Dark flame: a smoky black bloom under crimson tongues, black feathers flung out.
        this.darkFlame(x, y, 1.25, 720, now);
        this.featherBurst(x, y, 10, 2.2, 0.36, 900, 0, now);
        this.shakeAmp = this.reducedMotion ? 0.6 : 1.9;
        this.shakeMs = 200;
      } else {
        this.featherBurst(x, y, 8, 1.6, 0.32, 820, 1, now);
      }
    }
  }

  private finishAnimation(natural: boolean): void {
    this.finishSkill();
    const a = this.anim;
    if (!natural) {
      this.tLand = -1;
      this.tCap = -1;
      this.tShake = -1;
      this.tTurn = -1;
      this.tGlint = -1;
      this.tSkillHit = -1;
      this.trail.length = 0;
      this.skillSparks.length = 0;
      this.feathers.length = 0;
      this.dark.t0 = -1;
      this.awPulse.t0 = -1;
      this.awSmoke.t0 = -1;
    }
    if (!a) return;
    this.anim = null;
    try {
      this.settleAnimation(a, natural);
    } finally {
      a.resolve();
    }
  }

  /** The end state of a finished (or cut short) move: see finishAnimation. */
  private settleAnimation(a: Anim2D, natural: boolean): void {
    // A mover destroyed on the wasteland already dissolved: never a storm ghost too.
    const skip = [a.moverId, ...(a.captured ? [a.captured.id] : []), ...(a.hop ? a.hop.victims.map((v) => v.piece.id) : [])];
    this.collectStormVictims(a.piecesAfter, a.wasted || a.hop ? skip : (a.captured?.id ?? null));
    // A transformed mover whose transform ran out with this move fades back instead of popping.
    this.setPieceList(a.piecesAfter, natural ? a.moverId : null);
    if (a.capture && !a.impactFired) {
      a.impactFired = true;
      if (!this.disposing) this.emitImpact(a.move);
    }
    // A hop cut short still reports every victim once.
    if (a.hop) {
      for (const v of a.hop.victims) {
        if (v.fired) continue;
        v.fired = true;
        if (!this.disposing) this.emitImpact({ ...a.move, captureId: v.piece.id });
      }
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- drawing

  private cx(c: number): number {
    return this.layout.x0 + (c + 0.5) * this.layout.cell;
  }

  private cy(r: number): number {
    return this.layout.y0 + (BOARD_SIZE - 1 - r + 0.5) * this.layout.cell;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Transparent canvas: the page's dark backdrop shows around the frame.
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    // Camera micro-shake.
    let sx = 0;
    let sy = 0;
    if (this.tShake >= 0) {
      const k = (now - this.tShake) / this.shakeMs;
      sx = shakeOffset(k, 0) * this.shakeAmp;
      sy = shakeOffset(k, 1) * this.shakeAmp;
    }
    ctx.translate(sx, sy);

    // Static arena (bezel, cells), then only the cells whose tint differs, then the hologram overlay.
    if (this.boardLayer) ctx.drawImage(this.boardLayer, 0, 0, this.cssW, this.cssH);
    const hi = this.hi;
    const zone = hi.zone;
    const tinted = (k: number, r: number): boolean =>
      hi.selected === k || hi.last.has(k) || hi.captures.has(k) || hi.shotRange.has(k) || hi.freezeRange.has(k) || (hi.enemy && hi.moves.has(k)) || (zone !== null && r >= zone[0] && r <= zone[1]);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const k = r * BOARD_SIZE + c;
        const storm = this.storm > 0 && this.stormAt(r, c);
        const wk = this.wasteK(k);
        const tint = tinted(k, r);
        if (!storm && wk <= 0 && !tint) continue;
        const tx = x0 + c * cell;
        const ty = y0 + (BOARD_SIZE - 1 - r) * cell;
        if (tint) paintTile(ctx, tx, ty, cell, tileRgb(r, c, hi, this.tilePal));
        tileOuterPath(ctx, tx, ty, cell);
        if (storm) {
          ctx.fillStyle = hexAlpha(STORM_COLORS.tile, STORM_TILE_ALPHA);
          ctx.fill();
        }
        if (wk > 0) {
          ctx.fillStyle = hexAlpha(WASTE_COLORS.tile, 0.85 * wk);
          ctx.fill();
        }
      }
    }

    if (this.overlayLayer) {
      const m = FIELD_OVERLAY_MARGIN * cell;
      const sz = BOARD_SIZE * cell + m * 2;
      ctx.drawImage(this.overlayLayer, x0 - m, y0 - m, sz, sz);
    }
    if (this.glowLevel > 0.002) {
      const spr = this.glowSprite(this.glowColor);
      if (spr) {
        const m = turnGlowMargin(this.frameStyle) * cell;
        const sz = BOARD_SIZE * cell + m * 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.glowLevel * TURN_GLOW_OPACITY;
        ctx.drawImage(spr, x0 - m, y0 - m, sz, sz);
        ctx.restore();
      }
    }

    if (this.ambientOn) drawAmbient2D(ctx, this.theme.ambient!, now / 1000, x0, y0, cell);
    this.drawWaste(now);
    this.drawZoneLines(now);
    this.drawStorm(now);
    this.drawSkillPreview(now);

    // Overlays: own reach = ice-cyan glow, an enemy's reach preview = red glow (additive sprites).
    const h = this.highlights;
    const enemy = this.hi.enemy;
    const selCol = enemy ? BOARD_COLORS.enemySelected : BOARD_COLORS.selected;
    const dotCol = enemy ? BOARD_COLORS.enemyMoveDot : BOARD_COLORS.moveDot;
    const sp = this.still ? PULSE_REST : pulse01(now, 950);
    if (h.selected) {
      const x = this.cx(h.selected.c);
      const y = this.cy(h.selected.r);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Soft halo under the coin + the glowing frame hugging the tile.
      const gr = cell * (0.585 + 0.13 * sp);
      const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
      g.addColorStop(0, hexAlpha(selCol, 0.3 + 0.3 * sp));
      g.addColorStop(0.2, hexAlpha(selCol, 0.19 + 0.19 * sp));
      g.addColorStop(0.5, hexAlpha(selCol, 0.05 + 0.05 * sp));
      g.addColorStop(1, hexAlpha(selCol, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 0.75 + 0.25 * sp;
      this.drawMarker('select', selCol, x, y, cell * (1 + 0.03 * sp));
      ctx.restore();
    }
    const deadly = new Set((h.deadly ?? []).map(posKey));
    for (const p of h.deadly ?? []) {
      // Moving there is suicide: a skull instead of the dot.
      const d = cell * (0.95 + 0.06 * sp);
      const S = Math.max(8, Math.round(cell * 0.95 * this.dpr));
      ctx.globalAlpha = 0.85 + 0.15 * sp;
      ctx.drawImage(this.wasteSprites.skullMark(S), this.cx(p.c) - d / 2, this.cy(p.r) - d / 2, d, d);
      ctx.globalAlpha = 1;
    }
    // Move targets: luminous glow dots (white-hot core, soft halo), breathing like the WebGL ones.
    if ((h.moves?.length ?? 0) > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95 * (0.72 + 0.28 * sp);
      const ds = cell * (0.9 + 0.16 * sp);
      for (const p of h.moves ?? []) {
        if (deadly.has(posKey(p))) continue;
        this.drawMarker('dot', dotCol, this.cx(p.c), this.cy(p.r), ds);
      }
      ctx.restore();
    }

    // Venoa's arrow range: a small sight on every empty square her arrows fly over.
    // Glacia's freeze reach (skill targeting) uses the same marks in frost blue.
    const frost = (h.freezeRange?.length ?? 0) > 0;
    const sights = frost ? h.freezeRange! : (h.shotRange ?? []);
    if (sights.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * (0.65 + 0.3 * sp);
      const sightCol = frost ? BOARD_COLORS.freeze : enemy ? BOARD_COLORS.shotEnemy : BOARD_COLORS.shotOwn;
      for (const p of sights) {
        if (this.hi.moves.has(posKey(p)) || this.hi.captures.has(posKey(p))) continue; // a move target keeps its dot (or skull), a target its ring
        this.drawMarker('sight', sightCol, this.cx(p.c), this.cy(p.r), cell);
      }
      ctx.restore();
    }

    this.drawSelectFx(now);
    this.drawTrapsUnder(now);
    const sk = this.skill;
    if (sk && sk.casterId) this.drawRune(this.cx(sk.from.c), this.cy(sk.from.r), cell * 1.15, (now - sk.start) / SKILL_RUNE_MS, (now - sk.start) * 0.0016);
    // Pieces (back rows first so overlaps read naturally).
    const a = this.anim;
    const t = a ? Math.max(0, now - a.start) : 0;
    const list = [...this.pieces].sort((p, q) => q.pos.r - p.pos.r);
    let moverDraw: (() => void) | null = null;
    let moverXY = { x: 0, y: 0 };
    for (const p of list) {
      if (a && a.hop && p.id === a.moverId) {
        const hop = a.hop;
        const n = hop.squares.length;
        const i = Math.max(0, Math.min(n - 1, Math.floor(t / hop.stepMs)));
        let fr: number;
        let fc: number;
        let lift = 0;
        let sq = 1;
        if (t < a.moveDur) {
          const k = clamp01((t - i * hop.stepMs) / hop.stepMs);
          const p0 = i === 0 ? a.from : hop.squares[i - 1];
          const e = easeInOutCubic(k);
          fr = p0.r + (hop.squares[i].r - p0.r) * e;
          fc = p0.c + (hop.squares[i].c - p0.c) * e;
          lift = Math.sin(Math.PI * k) * hop.arc * 8;
          const since = t - i * hop.stepMs;
          sq = i > 0 && since < hop.landMs ? 1 + 0.16 * Math.sin(Math.PI * (since / hop.landMs)) : 1 + 0.08 * Math.sin(Math.PI * k);
        } else {
          fr = a.to.r;
          fc = a.to.c;
          const since = t - a.moveDur;
          sq = since < hop.landMs ? 1 + 0.18 * Math.sin(Math.PI * (since / hop.landMs)) : 1;
        }
        const x = this.cx(fc);
        const y = this.cy(fr);
        moverXY = { x, y: y - lift * cell * 0.12 };
        if (t < a.moveDur) this.pushTrail(moverXY.x, moverXY.y, now);
        if (a.wasted && t >= a.moveDur) {
          const tx = this.cx(a.to.c);
          const ty = this.cy(a.to.r);
          moverDraw = () => this.drawWastedPiece(p, tx, ty, t - a.moveDur, now);
          continue;
        }
        // Squash: wider and a touch flatter on landing (top-down coin).
        moverDraw = () => this.drawPiece(p, x, y, sq, 2 - sq, 1, lift, now);
        continue;
      }
      if (a && a.hop) {
        const v = a.hop.victims.find((q) => q.piece.id === p.id);
        if (v) {
          const x = this.cx(p.pos.c);
          const y = this.cy(p.pos.r);
          if (t < v.impactAt) this.drawPiece(p, x, y, 1, 1, 1, 0, now);
          else this.drawVictim(p, x, y, t - v.impactAt, t, a, now, v.impactAt + HIT_MS);
          continue;
        }
      }
      if (a && p.id === a.moverId) {
        const k = clamp01(t / a.moveDur);
        const e = easeInOutCubic(k);
        let fr = a.from.r + (a.strike.r - a.from.r) * e;
        let fc = a.from.c + (a.strike.c - a.from.c) * e;
        if (a.capture) {
          const l = Math.hypot(a.to.r - a.from.r, a.to.c - a.from.c) || 1;
          const lunge = 0.16 * bump(a.impactAt - 110, a.impactAt + 150, t);
          fr += ((a.to.r - a.from.r) / l) * lunge;
          fc += ((a.to.c - a.from.c) / l) * lunge;
          if (t >= a.stepStart) {
            const ks = easeInOutCubic(clamp01((t - a.stepStart) / STEP_MS));
            fr = a.strike.r + (a.to.r - a.strike.r) * ks;
            fc = a.strike.c + (a.to.c - a.strike.c) * ks;
          }
        }
        const x = this.cx(fc);
        const y = this.cy(fr);
        let lift = a.jump ? Math.sin(Math.PI * k) : 0.2 * Math.sin(Math.PI * k);
        let sxz = 1 + lift * 0.18;
        let syy = 1;
        if (a.jump && t > a.moveDur) {
          const sq = Math.sin(Math.PI * clamp01((t - a.moveDur) / ANIM.land));
          lift = 0;
          sxz = 1 + 0.1 * sq;
          syy = 1 - 0.14 * sq;
        }
        const pop = 1 + 0.14 * bump(a.impactAt - 90, a.impactAt + 170, t);
        moverXY = { x, y: y - lift * cell * 0.1 };
        if (t < a.moveDur && a.rk !== 'ash' && (a.jump || a.chain || a.charge || a.character === 'brutile' || (!a.rk && MOVE_TRAIL[a.character]))) this.pushTrail(moverXY.x, moverXY.y, now);
        if (a.rk && t < a.moveDur && t >= a.nextFeather) {
          // Feathers shed along the leap (crimson-edged black when transformed, pale ash otherwise).
          const awake = a.rk === 'awake';
          a.nextFeather = t + (awake ? FEATHER_MS_AWAKE : FEATHER_MS_ASH);
          const l = Math.hypot(a.to.r - a.from.r, a.to.c - a.from.c) || 1;
          const dx = (a.to.c - a.from.c) / l;
          const dy = -(a.to.r - a.from.r) / l;
          const side = ((t / 34) | 0) % 2 === 0 ? 1 : -1;
          const fx0 = (moverXY.x - x0) / cell - dx * 0.2 - dy * side * 0.2;
          const fy0 = (moverXY.y - y0) / cell - dy * 0.2 + dx * side * 0.2;
          this.feather(fx0, fy0, -dy * side * 0.6 - dx * 0.5, dx * side * 0.6 - dy * 0.5, awake ? 0.34 : 0.28, awake ? 720 : 620, awake ? 0 : 1, Math.atan2(dx, -dy) + side * 0.9, side * (awake ? 3.2 : 2), now);
        }
        if (a.wasted && t >= a.moveDur) {
          const tx = this.cx(a.to.c);
          const ty = this.cy(a.to.r);
          moverDraw = () => this.drawWastedPiece(p, tx, ty, t - a.moveDur, now);
          continue;
        }
        moverDraw = () => this.drawPiece(p, x, y, sxz * pop, syy * pop, 1, lift, now);
        continue;
      }
      if (a && a.captured && p.id === a.captured.id) {
        const x = this.cx(p.pos.c);
        const y = this.cy(p.pos.r);
        if (t < a.impactAt) {
          this.drawPiece(p, x, y, 1, 1, 1, 0, now);
        } else {
          this.drawVictim(p, x, y, t - a.impactAt, t, a, now);
        }
        continue;
      }
      const sel = posKey(p.pos) === this.hi.selected;
      const bob = sel ? 0.5 + 0.1 * Math.sin(now / 240) : 0;
      let sc = sel ? 1.05 : 1;
      let flash = 0;
      if (sk && p.id === sk.casterId) {
        const tk = now - sk.start;
        sc *= 1 + 0.2 * bump(0, 420, tk) + 0.08 * bump(sk.boltAt, sk.boltAt + 260, tk);
        flash = 0.4 * Math.max(0, 1 - tk / 260);
      }
      const alpha = (p.id === this.draggingId ? DRAG_SOURCE_ALPHA : 1) * (p.stun ? STUN_ALPHA : 1);
      this.drawPiece(p, this.cx(p.pos.c), this.cy(p.pos.r), sc, sc, alpha, bob, now, flash);
    }
    this.drawTrapsOver(now);
    // Capture targets sit on top of the threatened tokens.
    const cp = this.still ? PULSE_REST : pulse01(now, 700);
    // Venoa's shots (a subset of the captures) get a reticle in the tone's shot colour instead.
    const shotCol = enemy ? BOARD_COLORS.shotEnemy : BOARD_COLORS.shotOwn;
    for (const p of h.captures ?? []) {
      const shot = this.hi.shots.has(posKey(p));
      this.drawMarker(shot ? 'shot' : 'capture', shot ? shotCol : BOARD_COLORS.capture, this.cx(p.c), this.cy(p.r), cell * (0.96 + 0.07 * cp));
    }
    this.drawTrail(now);
    if (moverDraw) moverDraw();
    this.drawRakaeliFx(now);
    this.drawStormGhosts(now);
    this.drawSkillFx(now);

    this.drawFx(now, a ? moverXY : null);
  }

  /** Squares a resting (not animating) piece stands on. */
  private occupiedSquares(): Set<number> {
    const occ = new Set<number>();
    for (const p of this.pieces) if (!this.anim || (p.id !== this.anim.moverId && !this.anim.hop?.victims.some((v) => v.piece.id === p.id))) occ.add(p.pos.r * BOARD_SIZE + p.pos.c);
    return occ;
  }

  /** Doll traps on empty squares (under the pieces), with their idle wobble. */
  private drawTrapsUnder(now: number): void {
    if (this.traps.length === 0) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const occ = this.occupiedSquares();
    const d = cell * DOLL_SIZE;
    for (const t of this.traps) {
      if (occ.has(t.sq)) continue;
      const x = this.cx(t.sq % BOARD_SIZE);
      const y = this.cy(Math.floor(t.sq / BOARD_SIZE));
      const spr = dollSprite(t.owner, d * this.dpr);
      const ang = this.still ? 0 : wobbleAngle(now, t.sq);
      ctx.save();
      ctx.translate(x, y + d * 0.35);
      ctx.rotate(ang);
      ctx.drawImage(spr, -d / 2, -d * 0.85, d, d);
      ctx.restore();
    }
  }

  /** The "속박" marks of stunned pieces, then mini dolls peeking out of occupied trap squares. */
  private drawTrapsOver(now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const box = cell * STUN_BOX;
    for (const p of this.pieces) {
      if (!p.stun || (this.anim && p.id === this.anim.moverId)) continue;
      ctx.drawImage(stunSprite(box * this.dpr), this.cx(p.pos.c) - box / 2, this.cy(p.pos.r) - box / 2, box, box);
    }
    if (this.traps.length === 0) return;
    const occ = this.occupiedSquares();
    const d = cell * DOLL_CORNER_SIZE;
    for (const t of this.traps) {
      if (!occ.has(t.sq)) continue;
      const x = this.cx(t.sq % BOARD_SIZE) - cell * DOLL_CORNER_OFFSET;
      const y = this.cy(Math.floor(t.sq / BOARD_SIZE)) + cell * DOLL_CORNER_OFFSET;
      const ang = this.still ? 0 : wobbleAngle(now, t.sq);
      ctx.save();
      ctx.translate(x, y + d * 0.35);
      ctx.rotate(ang);
      ctx.drawImage(dollSprite(t.owner, d * this.dpr), -d / 2, -d * 0.85, d, d);
      ctx.restore();
    }
  }

  /** Victim of a strike: white hit flash + shake, then it swells, burns away and shatters. */
  private drawVictim(p: Piece, x: number, y: number, tk: number, t: number, a: Anim2D, now: number, deathStart = a.deathStart): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const l = Math.hypot(this.capDir.x, this.capDir.y) || 1;
    const kb = 0.26 * cell * easeOutCubic(clamp01(tk / (HIT_MS + DEATH_MS)));
    const shake = tk < HIT_MS ? Math.sin(tk * 0.11) * cell * 0.05 * (1 - tk / HIT_MS) : 0;
    const vx = x + (this.capDir.x / l) * kb - (this.capDir.y / l) * shake;
    const vy = y + (this.capDir.y / l) * kb + (this.capDir.x / l) * shake;
    const ck = clamp01((t - deathStart) / DEATH_MS);
    const s = 1 + 0.15 * easeOutCubic(ck);
    if (ck < 1) this.drawPiece(p, vx, vy, s, s, 1 - ck * ck, 0, now, Math.max(0, 1 - tk / 160) * 0.85);
    if (ck > 0) {
      // Shards flying out in the attacker's FX colour.
      const fx = a.rk === 'awake' ? RAKAELI_AWAKE_FX : CHARACTER_FX[a.character];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexAlpha(fx.primary, 0.9 * (1 - ck));
      for (let i = 0; i < 9; i++) {
        const ang = i * 0.7 + i * i * 0.13;
        const d = cell * (0.15 + 0.5 * easeOutCubic(ck)) * (0.7 + 0.3 * ((i * 5) % 3));
        const px = vx + Math.cos(ang) * d;
        const py = vy + Math.sin(ang) * d;
        const r = cell * 0.07 * (1 - ck * 0.6);
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(ang) * r * 1.6, py + Math.sin(ang) * r * 1.6);
        ctx.lineTo(px + Math.cos(ang + 2.2) * r, py + Math.sin(ang + 2.2) * r);
        ctx.lineTo(px + Math.cos(ang - 2.2) * r, py + Math.sin(ang - 2.2) * r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private pushTrail(x: number, y: number, now: number): void {
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 1) return;
    this.trail.push({ x, y, t: now });
    if (this.trail.length > 24) this.trail.shift();
  }

  /** Fading ribbon behind a leaping / charging / chaining mover. */
  private drawTrail(now: number): void {
    const tr = this.trail;
    while (tr.length > 0 && now - tr[0].t > 280) tr.shift();
    if (tr.length < 2) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const k = 1 - (now - tr[i].t) / 280;
      if (k <= 0) continue;
      ctx.strokeStyle = hexAlpha(this.trailColor, 0.55 * k);
      ctx.lineWidth = cell * 0.3 * k * (i / tr.length);
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Storm field over the consumed columns (and, from step 3, the top and bottom rows), crackling
   * boundary lines around the open rectangle, warning frames on the next column / row to go.
   */
  private drawStorm(now: number): void {
    if (this.storm <= 0 && !(this.stormActive && this.stormNext !== null && this.stormNext <= 2)) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const size = cell * BOARD_SIZE;
    const t = now / 1000;
    const warn = this.stormActive && this.stormNext !== null && this.stormNext <= 2 && this.storm < STORM_FULL_STEPS;
    const cols = this.storm;
    const rows = stormRows(cols);
    const rowsNext = warn && stormRows(cols + 1) > rows;
    // The open rectangle: columns [ox0, ox1], rows [oy0, oy1] on screen.
    const ox0 = x0 + cols * cell;
    const ox1 = x0 + size - cols * cell;
    const oy0 = y0 + rows * cell;
    const oy1 = y0 + size - rows * cell;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    ctx.save();
    for (const side of [-1, 1] as const) {
      // Columns: consumed band [x0, ox0] on the left, [ox1, x0 + size] on the right, full height
      // (the corners belong to the columns); the wall runs along the open rows only.
      const xIn = side < 0 ? ox0 : ox1;
      if (cols > 0) this.drawStormBand(side < 0 ? x0 : x0 + size, xIn, y0, y0 + size, oy0, oy1, cols, side, t, cell);
      if (warn) this.drawStormWarn(side < 0 ? xIn : xIn - cell, oy0, oy1, cell, pulse);
    }
    if (rows > 0 || rowsNext) {
      // Rows: the same band drawn with x and y swapped (a reflection across the diagonal), between
      // the open columns. side -1 = the screen bottom (row 0), +1 = the top (row BOARD_SIZE - 1).
      ctx.save();
      ctx.transform(0, 1, 1, 0, 0, 0);
      for (const side of [-1, 1] as const) {
        const yIn = side < 0 ? oy1 : oy0;
        const yEdge = side < 0 ? y0 + size : y0;
        if (rows > 0) this.drawStormBand(yEdge, yIn, ox0, ox1, ox0, ox1, rows, -side as -1 | 1, t, cell);
        // The next row to go spans the columns that are still open after the next step.
        if (rowsNext) this.drawStormWarn(side < 0 ? yIn - cell : yIn, ox0 + cell, ox1 - cell, cell, pulse);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * One consumed storm band in a frame where "across" is x (from the board edge `xEdge` to the
   * boundary `xIn`) and "along" is y: the violet haze and drifting veins over [a0, a1] and the
   * glowing, crackling boundary wall over [w0, w1]. `side` = -1 when the band lies left of `xIn`.
   */
  private drawStormBand(xEdge: number, xIn: number, a0: number, a1: number, w0: number, w1: number, lines: number, side: -1 | 1, t: number, cell: number): void {
    const ctx = this.ctx;
    const bx = Math.min(xEdge, xIn);
    const bw = Math.abs(xIn - xEdge);
    const len = a1 - a0;
    const g = ctx.createLinearGradient(xEdge, 0, xIn, 0);
    // Violet haze added over the dark tiles (as the WebGL storm floor), brighter toward the boundary.
    ctx.globalCompositeOperation = 'lighter';
    g.addColorStop(0, hexAlpha(STORM_COLORS.field, 0.2));
    g.addColorStop(1, hexAlpha(STORM_COLORS.field, 0.36));
    ctx.fillStyle = g;
    ctx.fillRect(bx, a0, bw, len);
    // Drifting veins (one segment per 10/12 cell whatever the band's length: same look on short row bands).
    ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.3);
    ctx.lineWidth = Math.max(1, cell * 0.035);
    const vsegs = Math.max(3, Math.round((12 * len) / (cell * BOARD_SIZE)));
    for (let k = 0; k < lines * 2; k++) {
      const ph = t * 0.6 + k * 1.7;
      ctx.beginPath();
      for (let i = 0; i <= vsegs; i++) {
        const yy = a0 + (i / vsegs) * len;
        const xx = bx + bw * (0.5 + 0.42 * Math.sin(ph + i * 0.9 + k) * Math.cos(t * 0.8 + i * 0.5 + k * 2.1));
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    // Boundary wall: glowing line + crackling arcs.
    ctx.shadowColor = STORM_COLORS.edge;
    ctx.shadowBlur = cell * 0.5;
    ctx.strokeStyle = hexAlpha(STORM_COLORS.core, 0.75);
    ctx.lineWidth = Math.max(2, cell * 0.06);
    ctx.beginPath();
    ctx.moveTo(xIn, w0);
    ctx.lineTo(xIn, w1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.55);
    ctx.lineWidth = Math.max(1, cell * 0.03);
    const wl = w1 - w0;
    const segs = Math.max(4, Math.round((24 * wl) / (cell * BOARD_SIZE)));
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const yy = w0 + (i / segs) * wl;
        const xx = xIn + side * cell * 0.3 * Math.sin(i * 2.3 + t * (7 + k * 3) + k * 4) * Math.sin(i * 0.7 - t * 2);
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Pulsing warning frame on the next storm line: x in [wx, wx + cell], y in [a0, a1] (same frame as drawStormBand). */
  private drawStormWarn(wx: number, a0: number, a1: number, cell: number, pulse: number): void {
    if (a1 <= a0) return;
    const ctx = this.ctx;
    ctx.fillStyle = hexAlpha(STORM_COLORS.edge, 0.06 + 0.12 * pulse);
    ctx.fillRect(wx, a0, cell, a1 - a0);
    ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.55 + 0.45 * pulse);
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.strokeRect(wx + ctx.lineWidth / 2, a0 + ctx.lineWidth / 2, cell - ctx.lineWidth, a1 - a0 - ctx.lineWidth);
  }

  /** Pieces the storm is taking: shrink + fade with an expanding magenta ring, then forget them. */
  private drawStormGhosts(now: number): void {
    if (this.fading.length === 0) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      const k = clamp01((now - f.start) / STORM_MS);
      if (k >= 1) {
        this.fading.splice(i, 1);
        continue;
      }
      const x = this.cx(f.piece.pos.c);
      const y = this.cy(f.piece.pos.r);
      const s = 1 - easeOutCubic(k) * 0.9;
      this.drawPiece(f.piece, x, y - k * cell * 0.3, s, s, 1 - k * k, 0, now);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexAlpha(STORM_COLORS.edge, 0.9 * (1 - k));
      ctx.lineWidth = cell * 0.07 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.25 + 0.6 * easeOutCubic(k)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(STORM_COLORS.core, 0.8 * (1 - k));
      for (let b = 0; b < 8; b++) {
        const a = (b / 8) * Math.PI * 2 + k * 2;
        const d = easeOutCubic(k) * cell * 0.55;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - k * cell * 0.2, cell * 0.05 * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Reveal of a wasteland square: 0 = none .. 1 = fully cracked open. */
  private wasteK(sq: number): number {
    return this.waste.has(sq) ? (this.wasteOpen.get(sq) ?? 1) : 0;
  }

  /** Wasteland squares: cached ground sprite, pulsing additive crack glow, one poison bubble each. */
  private drawWaste(now: number): void {
    if (this.waste.size === 0) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const S = Math.max(8, Math.round(cell * this.dpr));
    const t = this.still ? 0 : now / 1000;
    for (const sq of this.waste) {
      const r = Math.floor(sq / BOARD_SIZE);
      const c = sq % BOARD_SIZE;
      const k = this.wasteK(sq);
      if (k <= 0) continue;
      const x = x0 + c * cell;
      const y = y0 + (BOARD_SIZE - 1 - r) * cell;
      const v = wasteVariant(sq);
      const m = wasteMask(this.waste, sq);
      const mx = x + cell / 2;
      const my = y + cell / 2;
      ctx.save();
      if (k < 1) {
        // Cracking open from the centre outward.
        ctx.beginPath();
        ctx.arc(mx, my, cell * 0.78 * k, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(this.wasteSprites.ground(v, m, S), x, y, cell, cell);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.still ? 0.45 : 0.3 + 0.32 * (0.5 + 0.5 * Math.sin(t * 2.2 + sq * 1.7));
      ctx.drawImage(this.wasteSprites.glow(v, m, S), x, y, cell, cell);
      ctx.globalAlpha = 1;
      if (!this.still) {
        // One poison bubble per square: grows, glints, pops.
        const h = ((sq * 2246822519) >>> 0) / 4294967296;
        const ph = (t * 0.45 + h * 7) % 1;
        if (ph < 0.9) {
          const bx = x + cell * (0.25 + 0.5 * ((h * 13.7) % 1));
          const by = y + cell * (0.25 + 0.5 * ((h * 7.3) % 1));
          const br = cell * (0.03 + 0.07 * ph);
          ctx.fillStyle = hexAlpha(WASTE_COLORS.miasma, 0.55);
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.7);
          ctx.lineWidth = Math.max(0.6, cell * 0.018);
          ctx.stroke();
          ctx.fillStyle = hexAlpha(WASTE_COLORS.core, 0.8);
          ctx.beginPath();
          ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      if (k < 1) {
        // Reveal front + poison eruption.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.9 * (1 - k));
        ctx.lineWidth = cell * 0.06;
        ctx.beginPath();
        ctx.arc(mx, my, cell * 0.78 * k, 0, Math.PI * 2);
        ctx.stroke();
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, cell * 0.6);
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9 * Math.sin(Math.PI * k)));
        g.addColorStop(0.4, hexAlpha(WASTE_COLORS.glow, 0.6 * Math.sin(Math.PI * k)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(mx - cell * 0.6, my - cell * 0.6, cell * 1.2, cell * 1.2);
        ctx.restore();
      }
    }
  }

  /** Skill targeting overlay: anchors tinted, the preview area a green (red if invalid) ghost. */
  private drawSkillPreview(now: number): void {
    if (this.anchors.length === 0 && !this.preview) return;
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const pulse = this.still ? 0.5 : 0.5 + 0.5 * Math.sin((now / 1000) * 4.2);
    const at = (sq: number): { x: number; y: number } => ({ x: x0 + (sq % BOARD_SIZE) * cell, y: y0 + (BOARD_SIZE - 1 - Math.floor(sq / BOARD_SIZE)) * cell });
    ctx.save();
    const inset = cell * 0.1;
    // Anchors: a faint additive green hint (as the WebGL anchor decal).
    ctx.globalCompositeOperation = 'lighter';
    for (const sq of this.anchors) {
      if (this.previewSet.has(sq)) continue;
      const { x, y } = at(sq);
      ctx.fillStyle = hexAlpha(WASTE_COLORS.anchor, 0.05);
      ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
      ctx.strokeStyle = hexAlpha(WASTE_COLORS.anchor, 0.2 + 0.1 * pulse);
      ctx.lineWidth = Math.max(1, cell * 0.035);
      roundRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.12);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const pv = this.preview;
    if (pv) {
      const col = pv.valid ? WASTE_COLORS.ghost : WASTE_COLORS.invalid;
      const S = Math.max(8, Math.round(cell * this.dpr));
      for (const sq of this.previewSet) {
        const { x, y } = at(sq);
        // Dark cursed-earth ghost, glowing cracks / hatching on top.
        ctx.fillStyle = hexAlpha(WASTE_COLORS.ground, 0.5 + 0.1 * pulse);
        ctx.fillRect(x, y, cell, cell);
        if (pv.valid) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.6 + 0.3 * pulse;
          ctx.drawImage(this.wasteSprites.glow(wasteVariant(sq), wasteMask(this.previewSet, sq), S), x, y, cell, cell);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        } else {
          // Forbidden: red diagonal hatching.
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          ctx.clip();
          ctx.strokeStyle = hexAlpha(col, 0.45);
          ctx.lineWidth = cell * 0.08;
          for (let i = -1; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + (i - 1) * cell * 0.33, y + cell);
            ctx.lineTo(x + (i + 2) * cell * 0.33, y);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      // Outline around the whole area (sides without a preview neighbour).
      ctx.strokeStyle = hexAlpha(col, 0.75 + 0.25 * pulse);
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      ctx.lineCap = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = cell * 0.3;
      ctx.beginPath();
      for (const sq of this.previewSet) {
        const { x, y } = at(sq);
        const m = wasteMask(this.previewSet, sq);
        const seg = (ax: number, ay: number, bx: number, by: number): void => {
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        };
        if (!(m & 1)) seg(x + cell, y, x + cell, y + cell);
        if (!(m & 2)) seg(x, y, x, y + cell);
        if (!(m & 4)) seg(x, y, x + cell, y);
        if (!(m & 8)) seg(x, y + cell, x + cell, y + cell);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Witch rune circle (rings, glyph ticks, hexagram over a black-purple disc) at (x, y). */
  private drawRune(x: number, y: number, R: number, k: number, rot: number): void {
    if (k >= 1) return;
    const ctx = this.ctx;
    const f = clamp01(k / 0.14) * (1 - clamp01((k - 0.62) / 0.38));
    if (f <= 0) return;
    const r = R * (0.72 + 0.28 * easeOutCubic(Math.min(1, k * 2.2)));
    ctx.save();
    ctx.globalAlpha = f;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexAlpha(WASTE_COLORS.curse, 0.55));
    g.addColorStop(0.75, hexAlpha(WASTE_COLORS.curse, 0.35));
    g.addColorStop(1, hexAlpha(WASTE_COLORS.curse, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = WASTE_COLORS.glow;
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    // Glyph ticks between the rings.
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (let i = 0; i < 20; i++) {
      const a0 = rot + (i / 20) * Math.PI * 2;
      const len = 0.25 + 0.4 * ((i * 7) % 5) / 5;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.83, a0, a0 + (Math.PI * 2 * len) / 20);
      ctx.stroke();
    }
    // Hexagram, counter-rotating.
    ctx.lineWidth = Math.max(1, r * 0.03);
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = -rot * 1.6 + off + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(a) * r * 0.72;
        const py = y + Math.sin(a) * r * 0.72;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cast effects over the pieces: caster flash, the green bolt, the impact flash, sparks. */
  private drawSkillFx(now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const s = this.skill;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (s && s.casterId) {
      const t = now - s.start;
      const fx0 = this.cx(s.from.c);
      const fy0 = this.cy(s.from.r);
      // Caster flare.
      const kf = t / 260;
      if (kf < 1) {
        const rr = cell * (0.5 + 0.9 * easeOutCubic(kf));
        const g = ctx.createRadialGradient(fx0, fy0, 0, fx0, fy0, rr);
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9 * (1 - kf)));
        g.addColorStop(0.45, hexAlpha(WASTE_COLORS.glow, 0.6 * (1 - kf)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(fx0 - rr, fy0 - rr, rr * 2, rr * 2);
      }
      // Bolt along a sideways-bowed quadratic curve, jittered like lightning.
      const kb = (t - s.boltAt) / SKILL_BOLT_MS;
      if (kb >= 0) {
        const head = easeOutCubic(clamp01(kb));
        const tail = Math.pow(clamp01((t - s.boltAt - SKILL_BOLT_MS * 0.75) / 300), 2);
        if (tail < 1) {
          const tx = this.cx(s.centre.c);
          const ty = this.cy(s.centre.r);
          const dx = tx - fx0;
          const dy = ty - fy0;
          const len = Math.hypot(dx, dy) || 1;
          const bx = (fx0 + tx) / 2 + (dy / len) * s.bow * cell;
          const by = (fy0 + ty) / 2 - (dx / len) * s.bow * cell;
          const N = 22;
          const pts: { x: number; y: number }[] = [];
          for (let i = 0; i <= N; i++) {
            const u = tail + (head - tail) * (i / N);
            const ox = (1 - u) * (1 - u) * fx0 + 2 * (1 - u) * u * bx + u * u * tx;
            const oy = (1 - u) * (1 - u) * fy0 + 2 * (1 - u) * u * by + u * u * ty;
            const j = (Math.sin(u * 37 + t * 0.05) * 0.6 + Math.sin(u * 91 - t * 0.09) * 0.4) * cell * 0.12 * Math.sin(Math.PI * u);
            pts.push({ x: ox - (dy / len) * j, y: oy + (dx / len) * j });
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const [w, col] of [
            [0.3, hexAlpha(WASTE_COLORS.glow, 0.25)],
            [0.12, hexAlpha(WASTE_COLORS.glow, 0.85)],
            [0.04, hexAlpha(WASTE_COLORS.core, 1)],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = cell * w;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
          const hp = pts[pts.length - 1];
          const hg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, cell * 0.35);
          hg.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.9));
          hg.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
          ctx.fillStyle = hg;
          ctx.fillRect(hp.x - cell * 0.35, hp.y - cell * 0.35, cell * 0.7, cell * 0.7);
        }
      }
    }
    // Bolt impact: green flash + shock ring at the area centre.
    if (this.tSkillHit >= 0) {
      const k = (now - this.tSkillHit) / 520;
      if (k >= 1) this.tSkillHit = -1;
      else if (s) {
        const x = this.cx(s.centre.c);
        const y = this.cy(s.centre.r);
        const e = easeOutCubic(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, cell * (0.6 + 1.2 * e));
        g.addColorStop(0, hexAlpha(WASTE_COLORS.core, 0.8 * (1 - k)));
        g.addColorStop(0.5, hexAlpha(WASTE_COLORS.glow, 0.45 * (1 - k)));
        g.addColorStop(1, hexAlpha(WASTE_COLORS.glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.6 + 1.2 * e), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.85 * (1 - k));
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.4 + 1.6 * e), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Poison sparks thrown up by each cracking square.
    for (let i = this.skillSparks.length - 1; i >= 0; i--) {
      const p = this.skillSparks[i];
      const k = (now - p.t0) / 420;
      if (k >= 1) {
        this.skillSparks.splice(i, 1);
        continue;
      }
      const d = cell * (0.1 + 0.55 * easeOutCubic(k)) * p.v;
      ctx.fillStyle = hexAlpha(i % 3 === 0 ? WASTE_COLORS.core : WASTE_COLORS.glow, 0.95 * (1 - k));
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(p.a) * d, p.y + Math.sin(p.a) * d - k * cell * 0.15, cell * 0.045 * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A mover destroyed on wasteland: shudders, burns away from a green edge, toxic bubbles rise. */
  private drawWastedPiece(p: Piece, x: number, y: number, tk: number, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const k = clamp01(tk / WASTE_DIE_MS);
    const shake = tk < 220 ? Math.sin(tk * 0.09) * cell * 0.04 * (1 - tk / 220) : 0;
    const sc = 1 - 0.25 * easeOutCubic(k);
    if (k < 1) this.drawPiece(p, x + shake, y + k * cell * 0.05, sc, sc, 1 - k * k, 0, now, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Green burn glow over the token, strongest mid-way.
    const gk = Math.sin(Math.PI * Math.min(1, k * 1.2));
    const g = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.55);
    g.addColorStop(0, hexAlpha(WASTE_COLORS.glow, 0.55 * gk));
    g.addColorStop(0.7, hexAlpha(WASTE_COLORS.miasma, 0.35 * gk));
    g.addColorStop(1, hexAlpha(WASTE_COLORS.miasma, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - cell * 0.55, y - cell * 0.55, cell * 1.1, cell * 1.1);
    // Flame ring licking out + rising bubbles.
    ctx.strokeStyle = hexAlpha(WASTE_COLORS.glow, 0.85 * (1 - k));
    ctx.lineWidth = cell * 0.06;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const rr = cell * (0.3 + 0.35 * easeOutCubic(k)) + Math.abs(Math.sin(a * 5 + tk * 0.02)) * cell * 0.12 * (1 - k);
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
    for (let b = 0; b < 6; b++) {
      const ph = (tk / 600 + b / 6) % 1;
      const bx = x + Math.cos(b * 2.4) * cell * 0.28;
      const by = y + Math.sin(b * 2.4) * cell * 0.2 - ph * cell * 0.5;
      ctx.fillStyle = hexAlpha(b % 2 ? WASTE_COLORS.core : WASTE_COLORS.glow, 0.8 * (1 - ph) * (1 - k * 0.5));
      ctx.beginPath();
      ctx.arc(bx, by, cell * 0.04 * (1 + ph), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Glowing home-zone edge lines; the side to move is brighter and sweeps on turn change. */
  private drawZoneLines(now: number): void {
    const ctx = this.ctx;
    const { x0, y0, cell } = this.layout;
    const size = cell * BOARD_SIZE;
    const sweepK = this.tTurn >= 0 ? (now - this.tTurn) / ANIM.turn : 2;
    for (const id of [0, 1] as const) {
      const rowEdge = id === 0 ? ZONE_DEPTH : BOARD_SIZE - ZONE_DEPTH; // line between rows
      const y = y0 + (BOARD_SIZE - rowEdge) * cell;
      const active = id === this.turn;
      const boost = active && sweepK >= 0 && sweepK < 1 ? Math.sin(Math.PI * sweepK) : 0;
      // Bright thin team line (light tone) over a soft halo band (as the WebGL line / halo), additive.
      const col = TEAM_COLORS[id].glow;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hh = cell * 0.4 * (1 + boost * 0.7);
      const hg = ctx.createLinearGradient(0, y - hh, 0, y + hh);
      const ha = Math.min(1, (active ? 0.2 : 0.1) + boost * 0.55);
      hg.addColorStop(0, hexAlpha(col, 0));
      hg.addColorStop(0.5, hexAlpha(col, ha));
      hg.addColorStop(1, hexAlpha(col, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(x0 + cell * 0.05, y - hh, size - cell * 0.1, hh * 2);
      ctx.strokeStyle = hexAlpha(TEAM_COLORS[id].light, Math.min(1, (active ? 0.95 : 0.6) + boost * 0.5));
      ctx.lineWidth = Math.max(1, cell * (0.04 + 0.04 * boost));
      ctx.beginPath();
      ctx.moveTo(x0 + cell * 0.05, y);
      ctx.lineTo(x0 + size - cell * 0.05, y);
      ctx.stroke();
      if (active && sweepK >= 0 && sweepK < 1) {
        const e = easeInOutCubic(sweepK);
        const hx = id === 0 ? x0 + size * e : x0 + size * (1 - e);
        const dir = id === 0 ? -1 : 1;
        const g = ctx.createLinearGradient(hx, 0, hx + dir * cell * 3, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(2, cell * 0.1);
        ctx.beginPath();
        ctx.moveTo(hx, y);
        ctx.lineTo(hx + dir * cell * 3, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Landing ring, sad's glint and the character's strike FX (+ the insaner soul stream). */
  private drawFx(now: number, moverXY: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    if (this.tLand >= 0) {
      const k = (now - this.tLand) / ANIM.pulse;
      if (k >= 1) this.tLand = -1;
      else if (k >= 0) {
        ctx.save();
        ctx.globalAlpha = (1 - k) * (1 - k);
        ctx.strokeStyle = this.landColor;
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath();
        ctx.arc(this.cx(this.landAt.c), this.cy(this.landAt.r), cell * (0.4 + 0.45 * easeOutCubic(k)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.tGlint >= 0) {
      const k = (now - this.tGlint) / 320;
      if (k >= 1) this.tGlint = -1;
      else if (k >= 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k * k;
        drawGlint(ctx, this.glintAt.x, this.glintAt.y, cell * 0.65 * Math.sin(Math.PI * Math.min(1, k * 1.25)), k * 1.2, this.glintColor);
        ctx.restore();
      }
    }
    if (this.tCap < 0) return;
    const el = now - this.tCap;
    if (el >= FX_MS + 300) {
      this.tCap = -1;
      this.soulTo = null;
      return;
    }
    const x = this.cx(this.capAt.c);
    const y = this.cy(this.capAt.r);
    const fx = this.capRak === 'awake' ? RAKAELI_AWAKE_FX : CHARACTER_FX[this.capKind];
    const k = clamp01(el / FX_MS);
    const e = easeOutCubic(k);
    const fade = 1 - k;
    const dir = this.capDir;
    ctx.save();
    if (this.capKind === 'marki' && k < 1) {
      // Dust clouds (normal blending, behind the glow).
      for (const b of this.capBurst) {
        const d = cell * (0.25 + 0.7 * e) * b.v;
        ctx.fillStyle = `rgba(201,185,160,${0.32 * fade})`;
        ctx.beginPath();
        ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d * 0.8, cell * (0.12 + 0.18 * e), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // Impact flash.
    const kf = el / ANIM.flash;
    if (kf < 1) {
      const rr = cell * (0.45 + 1.0 * easeOutCubic(kf));
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(255,255,255,${1 - kf})`);
      g.addColorStop(0.45, hexAlpha(this.capKind === 'walk' ? fx.secondary : fx.primary, 0.7 * (1 - kf)));
      g.addColorStop(1, hexAlpha(fx.primary, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (k < 1) {
      switch (this.capKind) {
        case 'sad': {
          // Light beam rising up the screen + a sweeping crescent slash + a holy sigil ring.
          const bw = cell * 0.55 * (1.1 - 0.5 * k);
          const bh = cell * 2.2 * Math.min(1, k * 4);
          const g = ctx.createLinearGradient(0, y, 0, y - bh);
          g.addColorStop(0, hexAlpha(fx.secondary, 0.75 * fade));
          g.addColorStop(1, hexAlpha(fx.primary, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - bw / 2, y - bh, bw, bh);
          const sk = clamp01(el / 300);
          if (sk < 1) {
            const flip = dir.x < 0 ? -1 : 1;
            const a0 = -2.4;
            const head = a0 + 3.4 * easeOutCubic(sk);
            ctx.strokeStyle = hexAlpha(fx.primary, 0.95 * (1 - sk));
            ctx.shadowColor = fx.primary;
            ctx.shadowBlur = cell * 0.3;
            ctx.lineCap = 'round';
            for (let i = 0; i < 3; i++) {
              ctx.lineWidth = cell * (0.16 - i * 0.05);
              ctx.strokeStyle = i === 2 ? hexAlpha('#FFFFFF', 1 - sk) : hexAlpha(fx.primary, 0.9 * (1 - sk));
              ctx.beginPath();
              ctx.ellipse(x, y, cell * 0.62, cell * 0.62, 0, flip > 0 ? Math.max(a0, head - 1.8) : Math.PI - head, flip > 0 ? head : Math.PI - Math.max(a0, head - 1.8), flip < 0);
              ctx.stroke();
            }
            ctx.shadowBlur = 0;
          }
          ctx.strokeStyle = hexAlpha(fx.primary, 0.8 * fade);
          ctx.lineWidth = cell * 0.05;
          ctx.beginPath();
          ctx.arc(x, y, cell * (0.3 + 0.6 * e), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'marki': {
          // Molten ground cracks radiating out.
          ctx.strokeStyle = hexAlpha(fx.primary, Math.min(1, 1.4 * fade));
          ctx.lineWidth = Math.max(1, cell * 0.05);
          ctx.lineJoin = 'round';
          for (const b of this.capBurst) {
            const len = cell * (0.4 + 0.9 * b.v) * Math.min(1, e * 1.7);
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let s = 1; s <= 4; s++) {
              const d = (len * s) / 4;
              const j = Math.sin(b.a * 13 + s * 2.1) * cell * 0.08;
              ctx.lineTo(x + Math.cos(b.a) * d - Math.sin(b.a) * j, y + Math.sin(b.a) * d + Math.cos(b.a) * j);
            }
            ctx.stroke();
          }
          break;
        }
        case 'walk': {
          // Shield-shaped shock ring pointing along the strike + an echo.
          const ang = Math.atan2(dir.y, dir.x) + Math.PI / 2;
          for (const [sc, al] of [
            [0.25 + 0.95 * e, 1],
            [0.15 + 0.6 * e, 0.55],
          ] as const) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            ctx.scale(cell * sc, cell * sc);
            shieldPath(ctx);
            ctx.restore();
            ctx.strokeStyle = hexAlpha(fx.primary, al * fade);
            ctx.shadowColor = fx.secondary;
            ctx.shadowBlur = cell * 0.25;
            ctx.lineWidth = cell * 0.07;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          break;
        }
        case 'brutile': {
          // Curse blast: green poison flame ring over black-purple smoke + toxic cracks.
          ctx.globalCompositeOperation = 'source-over';
          for (const b of this.capBurst) {
            const d = cell * (0.2 + 0.6 * e) * b.v;
            ctx.fillStyle = hexAlpha(WASTE_COLORS.curse, 0.35 * fade);
            ctx.beginPath();
            ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * (0.12 + 0.16 * e), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = hexAlpha(fx.primary, Math.min(1, 1.3 * fade));
          ctx.lineWidth = Math.max(1, cell * 0.045);
          ctx.lineJoin = 'round';
          for (const b of this.capBurst) {
            const len = cell * (0.35 + 0.7 * b.v) * Math.min(1, e * 1.7);
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let st = 1; st <= 4; st++) {
              const d = (len * st) / 4;
              const j = Math.sin(b.a * 11 + st * 2.7) * cell * 0.08;
              ctx.lineTo(x + Math.cos(b.a) * d - Math.sin(b.a) * j, y + Math.sin(b.a) * d + Math.cos(b.a) * j);
            }
            ctx.stroke();
          }
          const R = cell * (0.25 + 0.6 * e);
          for (let layer = 0; layer < 2; layer++) {
            ctx.beginPath();
            for (let i = 0; i <= 36; i++) {
              const a = (i / 36) * Math.PI * 2;
              const fl = Math.abs(Math.sin(a * 6 + el * 0.022 + layer * 1.3)) * cell * 0.24 * fade;
              const rr = R + fl;
              if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
              else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.strokeStyle = hexAlpha(layer === 0 ? fx.primary : fx.core, 0.85 * fade);
            ctx.lineWidth = cell * (0.08 - layer * 0.04);
            ctx.stroke();
          }
          break;
        }
        case 'insaner': {
          // Violet / crimson flame ring.
          const R = cell * (0.25 + 0.6 * e);
          for (let layer = 0; layer < 2; layer++) {
            ctx.beginPath();
            for (let i = 0; i <= 36; i++) {
              const a = (i / 36) * Math.PI * 2;
              const fl = Math.abs(Math.sin(a * 5 + el * 0.02 + layer * 1.7)) * cell * 0.22 * fade;
              const rr = R + fl;
              if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
              else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.strokeStyle = hexAlpha(layer === 0 ? fx.primary : fx.secondary, 0.85 * fade);
            ctx.lineWidth = cell * (0.08 - layer * 0.03);
            ctx.stroke();
          }
          break;
        }
        // The rest of the roster: each the 2D counterpart of its WebGL hit (render/BoardView.ts
        // impactFx), built from the shared painters below.
        case 'michelle':
          // Doll curse: a stitched lavender sigil and grey-violet threads of smoke.
          fx2dPuffs(ctx, x, y, cell, e, fade, this.capBurst, WASTE_COLORS.curse, 0.3);
          fx2dSigil(ctx, x, y, cell, e, fade, el, fx.primary, fx.secondary);
          break;
        case 'picker':
          // A bright bounce ring and a dust puff.
          fx2dPuffs(ctx, x, y, cell, e, fade, this.capBurst, '#C9B9A0', 0.22);
          fx2dRing(ctx, x, y, cell, e, fade, fx.core, 1.15);
          break;
        case 'rakaeli':
          // Base form: a pale halo-gold sigil (the transformed hit is the dark flame above).
          if (this.capRak !== 'awake') fx2dSigil(ctx, x, y, cell, e, fade, el, fx.secondary, fx.primary);
          break;
        case 'rampid':
          // Ice claw: frost cracks and ice shards flung low.
          fx2dCracks(ctx, x, y, cell, e, fade, this.capBurst, fx.primary, 9);
          fx2dShards(ctx, x, y, cell, e, fade, this.capBurst, fx.secondary);
          break;
        case 'larhen':
          // Twin daggers: a silver crescent slash and an indigo ring.
          fx2dSlash(ctx, x, y, cell, el, fx.primary, dir.x < 0);
          fx2dRing(ctx, x, y, cell, e, fade, fx.secondary, 1.0);
          break;
        case 'volkonov':
          // A chord: a rose sigil ringing out with a gold echo ring.
          fx2dSigil(ctx, x, y, cell, e, fade, el, fx.primary, fx.secondary);
          fx2dRing(ctx, x, y, cell, e, fade, fx.secondary, 1.3);
          break;
        case 'verish':
          // Pierce: a teal slash and streaks flung along her lane, a pink ring.
          fx2dSlash(ctx, x, y, cell, el, fx.primary, dir.x < 0);
          fx2dStreaks(ctx, x, y, cell, e, fade, dir, fx.primary);
          fx2dRing(ctx, x, y, cell, e, fade, fx.secondary, 1.0);
          break;
        case 'midos':
          // Ghost claws: a moon-white slash over shadow smoke.
          fx2dPuffs(ctx, x, y, cell, e, fade, this.capBurst, '#140C2E', 0.38);
          fx2dSlash(ctx, x, y, cell, el, fx.core, dir.x < 0);
          break;
        case 'hammont':
          // Hammer crush: forge-hot cracks, soot and a molten ring.
          fx2dPuffs(ctx, x, y, cell, e, fade, this.capBurst, '#3A1C0E', 0.35);
          fx2dCracks(ctx, x, y, cell, e, fade, this.capBurst, fx.primary, 13);
          fx2dRing(ctx, x, y, cell, e, fade, fx.core, 1.35);
          break;
        case 'venoa':
          // Poison arrow: venom splash streaks along the arrow's flight over bog spores.
          fx2dPuffs(ctx, x, y, cell, e, fade, this.capBurst, '#56702A', 0.3);
          fx2dStreaks(ctx, x, y, cell, e, fade, dir, fx.primary);
          fx2dFlameRing(ctx, x, y, cell, e, fade, el, fx.primary, fx.core, 7);
          break;
        case 'glacia':
          // Shatter: ice cracks, crystal shards and a cold white ring.
          fx2dCracks(ctx, x, y, cell, e, fade, this.capBurst, fx.secondary, 5);
          fx2dShards(ctx, x, y, cell, e, fade, this.capBurst, fx.core);
          fx2dRing(ctx, x, y, cell, e, fade, fx.primary, 1.2);
          break;
      }
      // Shock ring + debris.
      ctx.strokeStyle = hexAlpha(fx.primary, 0.85 * fade);
      ctx.lineWidth = cell * 0.06 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.3 + 0.85 * e), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(fx.primary, fade);
      for (const b of this.capBurst) {
        const d = e * cell * 0.75 * b.v;
        ctx.beginPath();
        ctx.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d, cell * 0.06 * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Soul stream: wisps flowing from the victim into the imp.
    if (this.soulTo) {
      let tx = moverXY?.x ?? NaN;
      let ty = moverXY?.y ?? NaN;
      if (!moverXY) {
        const m = this.pieces.find((p) => p.id === this.soulTo);
        if (m) {
          tx = this.cx(m.pos.c);
          ty = this.cy(m.pos.r);
        }
      }
      if (Number.isFinite(tx)) {
        const mx = (x + tx) / 2;
        const my = (y + ty) / 2 - cell * 0.9;
        for (let i = 0; i < 18; i++) {
          const s = (el / 1000 - i * 0.02) / 0.5;
          if (s <= 0 || s >= 1) continue;
          const w = Math.sin(s * Math.PI) * cell * 0.2 * Math.sin(i * 2.3 + s * 9);
          const px = (1 - s) * (1 - s) * x + 2 * (1 - s) * s * mx + s * s * tx + w;
          const py = (1 - s) * (1 - s) * y + 2 * (1 - s) * s * my + s * s * ty;
          const a = Math.pow(Math.sin(s * Math.PI), 0.6);
          const g = ctx.createRadialGradient(px, py, 0, px, py, cell * 0.12);
          g.addColorStop(0, `rgba(255,230,255,${a})`);
          g.addColorStop(0.4, hexAlpha('#B65CFF', 0.8 * a));
          g.addColorStop(1, hexAlpha('#B65CFF', 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Top-down token: contact shadow, rarity ring on the ground, then the pre-rendered illustrated
   * coin (face art, team rim, star pips). `flash` whitens it (hit).
   */
  private drawPiece(p: Piece, x: number, y: number, sx: number, sy: number, alpha: number, lift: number, now: number, flash = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const u = cell * sx;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Soft contact shadow (stays on the ground and spreads while the piece lifts).
    const sg = 1 + lift * 0.12;
    ctx.fillStyle = `rgba(4,6,12,${(0.55 - lift * 0.1) * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x + u * 0.04, y + u * 0.07, u * 0.42 * sg, u * 0.4 * sg, 0, 0, Math.PI * 2);
    ctx.fill();
    const yb = y - lift * cell * 0.12;
    const d = cell * TOKEN_SPRITE;
    // Rakaeli transformed: the crimson aura stands in for the rarity ring (cross-faded), wings
    // (during the transform) under the coin, the awake face over it.
    const lk = this.lookOf(p);
    if (lk.aura < 1) {
      ctx.globalAlpha = alpha * (1 - lk.aura);
      this.drawRarityRing(p.character, x, y, cell * RING_R * Math.min(sx, 1.15), now);
      ctx.globalAlpha = alpha;
    }
    if (lk.aura > 0.003) this.drawAura(x, yb, lk.aura, now);
    if (this.wing.a > 0.003 && this.wing.id === p.id) this.drawWings(x, yb, this.wing.k, this.wing.a);
    if (lk.face < 1) ctx.drawImage(this.tokenSprite(p.character, p.level, p.owner), x - (d * sx) / 2, yb - (d * sy) / 2, d * sx, d * sy);
    if (lk.face > 0) {
      ctx.globalAlpha = alpha * Math.min(1, lk.face);
      ctx.drawImage(this.tokenSprite(p.character, p.level, p.owner, true), x - (d * sx) / 2, yb - (d * sy) / 2, d * sx, d * sy);
      ctx.globalAlpha = alpha;
    }
    if (lk.burn > 0) this.drawBurn(x, yb, lk.burn, sx);
    // Forward chevron on the left rim (mirrors the WebGL token): up / down the screen, flips with a
    // turn-around, absent for symmetric movers. Plain path calls: no per-frame allocation.
    const arrow = arrowSign(p);
    if (arrow !== 0 && flash < 0.3) {
      const R = cell * COIN_TOP_R;
      const ax = x - ARROW_RIM * R * sx;
      const ay = yb - COIN_TOP_LIFT * cell * sy;
      const w = ARROW_W * R * sx;
      const hh = ARROW_H * 0.5 * R * sy * arrow;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ax - w, ay + hh);
      ctx.lineTo(ax, ay - hh);
      ctx.lineTo(ax + w, ay + hh);
      ctx.strokeStyle = ARROW_INK_CSS;
      ctx.lineWidth = 2 * ARROW_INK * R * sx;
      ctx.stroke();
      ctx.strokeStyle = ARROW_CSS[p.owner];
      ctx.lineWidth = 2 * ARROW_LINE * R * sx;
      ctx.stroke();
    }
    if (flash > 0) {
      ctx.globalAlpha = alpha * flash;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, yb, (d * sx) / 2, (d * sy) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // Countdown badge: transformed moves left, on the coin's top-right.
    const n = awakenOf(p);
    if (n > 0 && lk.face >= 0.5 && alpha > 0.5 && flash < 0.3) {
      const B = cell * BADGE_BOX;
      ctx.drawImage(badgeSprite(n, B * this.dpr), x + BADGE_OFFSET * cell - B / 2, yb - BADGE_OFFSET * cell - B / 2, B, B);
    }
    ctx.restore();
  }

  /** Rarity ring: white / orange / purple glow, legendary = rotating rainbow. */
  private drawRarityRing(ch: CharacterId, x: number, y: number, rr: number, now: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const look = RARITY_RING[CHARACTER_RARITY[ch]];
    const lw = cell * 0.052;
    ctx.save();
    // Thin dark keyline under the band (separates it from the coin edge and the tile).
    ctx.strokeStyle = 'rgba(4,6,12,0.55)';
    ctx.lineWidth = lw + Math.max(1, cell * 0.022);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = lw;
    if (look.rainbow) {
      const rot = this.still ? 0 : (now / 1000) * 1.4;
      ctx.shadowColor = `hsl(${Math.round((rot * 57.3) % 360)},100%,70%)`;
      ctx.shadowBlur = cell * 0.3;
      const cg = (ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
      if (cg) {
        const g = cg.call(ctx, rot, x, y);
        for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,72%)`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        for (let i = 0; i < 12; i++) {
          ctx.strokeStyle = `hsl(${i * 30},100%,72%)`;
          ctx.beginPath();
          ctx.arc(x, y, rr, rot + (i / 12) * Math.PI * 2, rot + ((i + 1.08) / 12) * Math.PI * 2);
          ctx.stroke();
        }
      }
      // Rotating shimmer.
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, rr, -rot * 1.3, -rot * 1.3 + 0.5);
      ctx.stroke();
    } else {
      ctx.shadowColor = look.glow;
      ctx.shadowBlur = cell * (0.05 + 0.3 * look.glowAmt);
      ctx.strokeStyle = look.core;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw a marker sprite (arena.ts painters, cached per kind / colour / cell size) centred at
   * (x, y) for a cell of `size` px. Blending is the caller's (dots / selection: 'lighter').
   */
  private drawMarker(kind: keyof typeof MARKER_QUAD, color: string, x: number, y: number, size: number): void {
    const q = MARKER_QUAD[kind];
    const cellPx = Math.max(4, Math.round(this.layout.cell * this.dpr));
    const key = `m:${kind}:${color}:${cellPx}`;
    let c = this.sprites.get(key);
    if (!c) {
      const S = Math.max(8, Math.ceil(cellPx * q));
      c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const g = ctx2d(c);
      if (g) {
        const rgb = hexToRgb(color);
        if (kind === 'dot') paintGlowDot(g, S / 2, S / 2, S / 2, rgb, color === BOARD_COLORS.moveDot ? DOT_WHITEN.own : DOT_WHITEN.enemy);
        else if (kind === 'select') paintSelectGlow(g, S / 2, S / 2, S / q, rgb);
        else if (kind === 'shot') paintShotReticle(g, S / 2, S / 2, S / q, rgb);
        else if (kind === 'sight') paintShotSight(g, S / 2, S / 2, S / q, rgb);
        else paintCaptureRing(g, S / 2, S / 2, S / q, rgb);
      }
      this.sprites.set(key, c);
    }
    const d = size * q;
    this.ctx.drawImage(c, x - d / 2, y - d / 2, d, d);
  }

  /** Illustrated coin for a look, pre-rendered at the current cell size (cached). */
  /**
   * Illustrated coin (cached per look and size). `awake`: Rakaeli's transformed face, or the base
   * face tinted crimson while that art is loading / missing.
   */
  private tokenSprite(ch: CharacterId, level: Level, owner: PlayerId, awake = false): HTMLCanvasElement {
    const S = Math.max(8, Math.round(this.layout.cell * TOKEN_SPRITE * this.dpr));
    const art = awake && isRakaeli({ character: ch }) ? awakeImage(level) : null;
    const img = art ?? faceImage(ch, level);
    const key = `${ch}:${level}:${owner}:${S}:${img ? 1 : 0}:${awake ? (art ? 'a' : 't') : ''}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = ctx2d(c);
    if (g) paintToken(g, S, img, level, owner, awake && !art);
    this.sprites.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- input

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (!this.interactive || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    this.down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== ev.pointerId || !this.interactive || !this.cellCb) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > TAP_SLOP_PX) return;
    const pos = this.pickCell(ev.clientX, ev.clientY);
    if (pos) this.cellCb(pos);
  };

  private readonly onPointerCancel = (): void => {
    this.down = null;
  };

  private readonly onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };
}

/**
 * Paint a chunky illustrated coin into an S x S sprite covering TOKEN_SPRITE of a cell (mirrors the
 * WebGL token shader in tokens.ts): ink keyline, team-deep milled edge below the top face, team rim
 * lit from the top-left with a specular arc, inset bevel ring, face art, gold star pips.
 */
function paintToken(g: CanvasRenderingContext2D, S: number, img: HTMLImageElement | null, level: Level, owner: PlayerId, tint = false): void {
  const team = TEAM_COLORS[owner];
  const u = S / TOKEN_SPRITE; // px per cell
  const c = S / 2;
  const R = 0.385 * u;
  const ty = c - 0.024 * u;
  const ey = c + 0.046 * u;
  const key = 0.022 * u;
  const dark = hexToRgb(team.dark);
  const capsule = (rad: number): void => {
    g.beginPath();
    g.arc(c, ty, rad, Math.PI, 0);
    g.lineTo(c + rad, ey);
    g.arc(c, ey, rad, 0, Math.PI);
    g.closePath();
  };
  // Keyline + coin edge (thickness), darker toward the bottom.
  g.fillStyle = '#090D17';
  capsule(R + key);
  g.fill();
  const eg = g.createLinearGradient(0, ty, 0, ey + R);
  eg.addColorStop(0, rgbToCss(dark));
  eg.addColorStop(1, rgbToCss(mixRgb(dark, [0, 0, 0], 0.3)));
  g.fillStyle = eg;
  capsule(R);
  g.fill();
  // Team rim, lit from the top-left.
  const rim = g.createLinearGradient(c - R * 0.6, ty - R * 0.8, c + R * 0.6, ty + R * 0.8);
  rim.addColorStop(0, team.light);
  rim.addColorStop(0.45, team.main);
  rim.addColorStop(1, team.dark);
  g.fillStyle = rim;
  g.beginPath();
  g.arc(c, ty, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = R * 0.06;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(c, ty, R * 0.915, Math.PI * 1.08, Math.PI * 1.45);
  g.stroke();
  // Inset bevel ring: shadowed top-left, light lower-right.
  const bv = g.createLinearGradient(c - R * 0.6, ty - R * 0.8, c + R * 0.6, ty + R * 0.8);
  bv.addColorStop(0, '#0E1530');
  bv.addColorStop(0.55, rgbToCss(mixRgb(dark, [0, 0, 0], 0.4)));
  bv.addColorStop(1, rgbToCss(mixRgb(hexToRgb(team.light), [1, 1, 1], 0.3)));
  g.fillStyle = bv;
  g.beginPath();
  g.arc(c, ty, R * 0.815, 0, Math.PI * 2);
  g.fill();
  // Face (clipped circle) with the rim's soft inset shadow on its top-left.
  const fr = R * 0.775;
  g.save();
  g.beginPath();
  g.arc(c, ty, fr, 0, Math.PI * 2);
  g.clip();
  if (img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sw = Math.min(w, h) * 0.8;
    g.drawImage(img, (w - sw) / 2, (h - sw) / 2 + h * 0.01, sw, sw, c - fr, ty - fr, fr * 2, fr * 2);
  } else {
    const pg = g.createRadialGradient(c, ty - R * 0.15, 0, c, ty, R * 0.8);
    pg.addColorStop(0, team.dark);
    pg.addColorStop(1, '#101833');
    g.fillStyle = pg;
    g.fillRect(0, 0, S, S);
  }
  if (tint) {
    // Transformed Rakaeli without his awake art: the base face (or placeholder) in crimson.
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(AWAKE_TINT[0] * 255)},${Math.round(AWAKE_TINT[1] * 255)},${Math.round(AWAKE_TINT[2] * 255)})`;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(70,0,14,0.35)';
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
  }
  const vg = g.createRadialGradient(c + fr * 0.12, ty + fr * 0.16, fr * 0.6, c, ty, fr * 1.05);
  vg.addColorStop(0, 'rgba(10,14,30,0)');
  vg.addColorStop(1, 'rgba(10,14,30,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  g.restore();
  // Level stars on the lower rim.
  for (let i = 0; i < level; i++) {
    const a = Math.PI / 2 - (i - (level - 1) / 2) * 0.42;
    const sx = c + Math.cos(a) * R * 0.895;
    const sy = ty + Math.sin(a) * R * 0.895;
    starPath(g, sx, sy, R * 0.15, R * 0.07);
    g.lineJoin = 'round';
    g.lineWidth = R * 0.08;
    g.strokeStyle = '#090D17';
    g.stroke();
    const sg = g.createLinearGradient(sx, sy - R * 0.15, sx, sy + R * 0.15);
    sg.addColorStop(0, '#FFF6D2');
    sg.addColorStop(0.55, BOARD_COLORS.pip);
    sg.addColorStop(1, '#E08A10');
    g.fillStyle = sg;
    g.fill();
  }
}

function starPath(g: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? ro : ri;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

/** Heater-shield outline in unit space (point toward -y before rotation). */
function shieldPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-0.55, 0.5);
  g.lineTo(0.55, 0.5);
  g.lineTo(0.55, 0.05);
  g.quadraticCurveTo(0.5, -0.45, 0, -0.7);
  g.quadraticCurveTo(-0.5, -0.45, -0.55, 0.05);
  g.closePath();
}

/** 4-point star glint. */
function drawGlint(g: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, color: string): void {
  if (size <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, size);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.3, hexAlpha(color, 0.6));
  gr.addColorStop(1, hexAlpha(color, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, size, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  for (const off of [0, Math.PI / 2]) {
    const a = rot + off;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = size * 0.07;
    g.beginPath();
    g.moveTo(x + ca * size, y + sa * size);
    g.lineTo(x - sa * w, y + ca * w);
    g.lineTo(x - ca * size, y - sa * size);
    g.lineTo(x + sa * w, y - ca * w);
    g.closePath();
    g.fill();
  }
}

/** 0..1..0 bump over [a, b]. */
function bump(a: number, b: number, x: number): number {
  return x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a));
}

function clonePieces(pieces: Piece[]): Piece[] {
  return pieces.map((p) => ({ ...p, pos: { ...p.pos } }));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
}

/** Length of the selection signature (rune sigil; Venoa's lane sweep takes its first 340 ms). */
const SELECT_FX_MS = 460;

/** Screen-shake strength of a capture per attacker (Canvas2D board; 1 = the default jolt). */
const CAPTURE_SHAKE_2D: Partial<Record<CharacterId, number>> = {
  marki: 2.6,
  walk: 1.5,
  brutile: 1.6,
  hammont: 2.8,
  glacia: 1.4,
  rampid: 1.3,
  verish: 1.2,
  midos: 1.3,
  picker: 1.4,
  venoa: 1.1,
};

// ------------------------------------------------------------------------------------------------
// Capture FX painters (Canvas2D). Each draws one layer of a hit centred at (x, y) for a cell of
// `cell` px; `e` is the eased progress, `fade` 1 → 0, `el` the elapsed ms. Additive blending is
// the caller's, except fx2dPuffs (smoke) which draws normally and restores 'lighter'.
// ------------------------------------------------------------------------------------------------

/** A glowing ring expanding to `scale` cells. */
function fx2dRing(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, color: string, scale: number): void {
  g.strokeStyle = hexAlpha(color, 0.9 * fade);
  g.lineWidth = cell * 0.05 * (0.5 + fade * 0.5);
  g.beginPath();
  g.arc(x, y, cell * (0.2 + scale * 0.55 * e), 0, Math.PI * 2);
  g.stroke();
}

/** Jagged cracks radiating out (one per burst ray); `jag` varies the zigzag per character. */
function fx2dCracks(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, burst: { a: number; v: number }[], color: string, jag: number): void {
  g.strokeStyle = hexAlpha(color, Math.min(1, 1.4 * fade));
  g.lineWidth = Math.max(1, cell * 0.045);
  g.lineJoin = 'round';
  for (const b of burst) {
    const len = cell * (0.35 + 0.85 * b.v) * Math.min(1, e * 1.7);
    g.beginPath();
    g.moveTo(x, y);
    for (let st = 1; st <= 4; st++) {
      const d = (len * st) / 4;
      const j = Math.sin(b.a * jag + st * 2.3) * cell * 0.08;
      g.lineTo(x + Math.cos(b.a) * d - Math.sin(b.a) * j, y + Math.sin(b.a) * d + Math.cos(b.a) * j);
    }
    g.stroke();
  }
}

/** A flickering flame ring (two layers). */
function fx2dFlameRing(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, el: number, c1: string, c2: string, lobes: number): void {
  const R = cell * (0.22 + 0.55 * e);
  for (let layer = 0; layer < 2; layer++) {
    g.beginPath();
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const rr = R + Math.abs(Math.sin(a * lobes + el * 0.02 + layer * 1.5)) * cell * 0.2 * fade;
      if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.strokeStyle = hexAlpha(layer === 0 ? c1 : c2, 0.85 * fade);
    g.lineWidth = cell * (0.075 - layer * 0.035);
    g.stroke();
  }
}

/** A rune sigil: two rings and six turning ticks between them. */
function fx2dSigil(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, el: number, c1: string, c2: string): void {
  const r1 = cell * (0.3 + 0.38 * e);
  const r2 = r1 * 1.32;
  g.lineWidth = Math.max(1, cell * 0.035);
  g.strokeStyle = hexAlpha(c1, 0.9 * fade);
  g.beginPath();
  g.arc(x, y, r1, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = hexAlpha(c2, 0.75 * fade);
  g.beginPath();
  g.arc(x, y, r2, 0, Math.PI * 2);
  g.stroke();
  const rot = el * 0.0035;
  g.strokeStyle = hexAlpha(c1, fade);
  g.lineWidth = Math.max(1, cell * 0.05);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    g.lineTo(x + Math.cos(a + 0.25) * r2, y + Math.sin(a + 0.25) * r2);
  }
  g.stroke();
}

/** A crescent slash across the victim (three strokes, white-hot core). */
function fx2dSlash(g: CanvasRenderingContext2D, x: number, y: number, cell: number, el: number, color: string, flip: boolean): void {
  const sk = clamp01(el / 300);
  if (sk >= 1) return;
  const a0 = -2.4;
  const head = a0 + 3.4 * easeOutCubic(sk);
  const tail = Math.max(a0, head - 1.8);
  g.lineCap = 'round';
  g.shadowColor = color;
  g.shadowBlur = cell * 0.25;
  for (let i = 0; i < 3; i++) {
    g.lineWidth = cell * (0.15 - i * 0.045);
    g.strokeStyle = i === 2 ? hexAlpha('#FFFFFF', 1 - sk) : hexAlpha(color, 0.9 * (1 - sk));
    g.beginPath();
    if (flip) g.ellipse(x, y, cell * 0.6, cell * 0.6, 0, Math.PI - head, Math.PI - tail, true);
    else g.ellipse(x, y, cell * 0.6, cell * 0.6, 0, tail, head, false);
    g.stroke();
  }
  g.shadowBlur = 0;
}

/** Crystal / ice shards: slim diamonds flung out along the burst rays. */
function fx2dShards(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, burst: { a: number; v: number }[], color: string): void {
  g.fillStyle = hexAlpha(color, 0.95 * fade);
  for (let i = 0; i < burst.length; i += 1) {
    const b = burst[i];
    const d = cell * (0.25 + 0.9 * e * b.v);
    const px = x + Math.cos(b.a + 0.2) * d;
    const py = y + Math.sin(b.a + 0.2) * d;
    const l = cell * 0.16 * (1 - e * 0.5);
    const w = cell * 0.045;
    const ca = Math.cos(b.a + 0.2);
    const sa = Math.sin(b.a + 0.2);
    g.beginPath();
    g.moveTo(px + ca * l, py + sa * l);
    g.lineTo(px - sa * w, py + ca * w);
    g.lineTo(px - ca * l, py - sa * l);
    g.lineTo(px + sa * w, py - ca * w);
    g.closePath();
    g.fill();
  }
}

/** Streaks flung along the attack direction (a fan of seven). */
function fx2dStreaks(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, dir: { x: number; y: number }, color: string): void {
  const nx = -dir.y;
  const ny = dir.x;
  g.strokeStyle = hexAlpha(color, 0.9 * fade);
  g.lineCap = 'round';
  g.lineWidth = Math.max(1, cell * 0.04);
  g.beginPath();
  for (let i = 0; i < 7; i++) {
    const sp = (i - 3) * 0.32;
    const vx = dir.x + nx * sp;
    const vy = dir.y + ny * sp;
    const d0 = cell * (0.2 + 0.8 * e);
    const d1 = d0 + cell * 0.32 * (1 - e * 0.6);
    g.moveTo(x + vx * d0, y + vy * d0);
    g.lineTo(x + vx * d1, y + vy * d1);
  }
  g.stroke();
}

/** Smoke puffs drawn with normal blending (dark smoke would vanish additively); restores 'lighter'. */
function fx2dPuffs(g: CanvasRenderingContext2D, x: number, y: number, cell: number, e: number, fade: number, burst: { a: number; v: number }[], color: string, alpha: number): void {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = hexAlpha(color, alpha * fade);
  for (const b of burst) {
    const d = cell * (0.2 + 0.6 * e) * b.v;
    g.beginPath();
    g.arc(x + Math.cos(b.a) * d, y + Math.sin(b.a) * d * 0.85, cell * (0.11 + 0.17 * e), 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'lighter';
}
