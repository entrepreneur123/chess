/**
 * Three.js WebGL board view: a premium "tactical fantasy arena" (BOARD_SIZE x BOARD_SIZE = 10 x 10, procedural, render-on-demand).
 *
 * World mapping: x = c - HALF (col 0 at screen left), z = HALF - r with HALF = 4.5 (row 0 nearest the camera,
 * i.e. player 0 at the bottom of the screen), y = up. Tile tops are at y = TILE_TOP.
 *
 * Units are animated glTF characters (src/render/units, public/models/*.glb): one merged skinned
 * draw call each (body + procedural gear), AnimationMixer per piece (idle loop / run / jump /
 * attack / death) plus cloth/wing secondary motion, facing from Piece.dir with a smooth turn.
 * Per piece: ground decal (shadow + rarity glow) and puck (base + ring + level pips) are one draw
 * each; Lv2 adds idle particles, Lv3 a rotating rune and a light shaft. Moves kick up pooled dust,
 * captures throw spark streaks + a shockwave and dissolve the victim; new units pop in with a
 * flash. Until the models load (or if they fail) pieces show silhouettes.
 *
 * Captures (animateMove with captureId): the attacker runs / leaps to strike range, plays its attack
 * clip facing the victim and, at the clip's impact frame, onImpact fires and the character's strike
 * FX play (strikeFx.ts: sad holy slash + light pillar, marki molten crack shockwave + dust + heavier
 * shake, walk shield-shaped shock ring + blue-white flash, insaner violet flame burst + a soul stream
 * into the imp); the victim plays 'hit', then 'death' while it dissolves, and the attacker steps in.
 * Skill moves: sad glints on move start, marki charges (>= 2 squares) with speed streaks, walk
 * leaves an arc trail and a landing ring, an insaner chain move dashes with a violet trail.
 *
 * Rarity rings (tokens.ts): a flat ring around every unit, one shared material per rarity (common
 * white, rare orange, epic purple, legendary rainbow sweeping at a light ~30 fps only while one is on
 * screen). Top-down view: units cross-fade into illustrated tokens (face art, team rim, star pips).
 * Enemy reach previews (BoardHighlights.tone 'enemy') draw red dots and a red selection ring.
 *
 * Storm (setStorm): consumed outer columns (and rows from step 3) get the storm.ts energy field (one draw), their
 * tiles are dimmed, and pieces that vanish from the piece list while the storm is active (not a
 * move's capture) dissolve with a magenta storm edge instead of popping out.
 *
 * Brutile's wasteland (waste.ts): setWaste = one instanced decal draw (scorched ground, glowing
 * green cracks joined across neighbouring squares, poison bubbles, miasma), setSkillPreview = green
 * anchor tint + green / red ghost of the area, animateSkill = rune + flare on the caster, a curse
 * bolt to the area, squares cracking open one by one with a small shake; a `wasted` move dissolves
 * the mover in green; BoardHighlights.deadly targets get a skull instead of the dot.
 *
 * Top-only boards (BoardViewOptions.topOnly, the game's board while the 3D arena is disabled):
 * start in the top-down view and never leave it, never load the glTF units (no mixers, no idle
 * loop), no shadow pass. The 3D path stays intact for topOnly = false.
 * Their look is the v6 "tactical hologram" of docs/design/v6-clean-tactical.md (arena.ts): a
 * transparent canvas over the page's dark backdrop, a painted slim bezel (HUD corner brackets, ruler
 * ticks, thin gold accents, soft outer shadow) under 100 flat deep-navy cells drawn by one unlit
 * instanced cell shader (exact palette colours, faint top light + glass rim), a hologram overlay
 * (home-zone team washes, hex micro-texture, thin glowing cyan grid, intersection crosses), bright
 * thin team zone-edge lines, an optional team-coloured edge glow (setTurnGlow), a faint periodic
 * scan sweep (off with reduced motion), chunky coins (tokens.ts) with glowing rarity rings,
 * luminous additive markers (ice-cyan / red glow dots, glowing selection frame) under a glowing red
 * capture ring, and a lifted selection shown as a screen-up offset with a spreading shadow
 * (applyTopLift). The arena board theme (BoardViewOptions.arena / setArenaTheme, arenaThemes.ts)
 * recolours the cells, bezel, grid and scan sweep, swaps the overlay's surface detail and drives
 * one additive Points draw of ambient particles (ambient.ts, ~10–20 fps by theme, never with reduced motion).
 *
 * Rakaeli (awakenFx.ts): base-form moves leap and shed pale ash feathers (ash feather burst + dim
 * halo-gold ring on a capture). While transformed (`Piece.awaken` > 0) his coin shows the awake face
 * (crimson-tinted base face if that art is missing), an additive crimson / violet flame aura with
 * rising embers under it (one shader, ~30 fps idle tick, static with reduced motion) and a
 * countdown badge; his moves leave a crimson feather trail and captures burst in a dark flame.
 * playAwaken plays the transform ('on': blindfold-burn flash, flame wings unfolding, a pulse, the
 * face swap at the peak) and the revert ('off': embers fade, smoke puff, face swaps back).
 *
 * Performance notes: tiles are one InstancedMesh, overlays are InstancedMeshes, effects reuse
 * pre-allocated meshes (no per-frame / per-move allocations), one 1024 shadow map (none when
 * top-only), pixel ratio capped at 2, effect shaders pre-compiled when idle. Frames are only
 * requested while something is animating: moves / effects at up to 60–90 fps (BUSY_FRAME_MS: a
 * 120 Hz display draws every other refresh); the selection pulse, the legendary ring and the
 * wasteland at ~30 fps (ring / wasteland static with prefers-reduced-motion); unit idle loops at
 * ~24 fps (off with prefers-reduced-motion or setIdleAnimation(false)); nothing while the tab is
 * hidden. An idle top-only board with no legendary and no wasteland draws only the theme's ambient
 * drift (~10–20 fps, ambientFrameMs) and the scan sweep (2.6 s at ~30 fps every 9 s; never with
 * prefers-reduced-motion). Throttled idle loops sleep on a timer between draws (nextFrameIn), not
 * frame by frame; any change (requestRender) still draws on the very next frame. setPaused (the
 * result dialog covers the board) and setLowPower (절전 모드, also ~30 fps moves) stop the
 * decorative idle loops; the storm keeps moving under 절전 모드 (it is game information).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_SIZE, STORM_FULL_STEPS, ZONE_DEPTH } from '../engine/types';
import type { CharacterId, Level, Move, Piece, PlayerId, Pos, Rarity, Trap } from '../engine/types';
import type { BoardHighlights, BoardViewMode, BoardViewOptions, IBoardView, ScreenRect, SkillPreview } from './types';
import type { UnitActor } from './units/actor';
import { loadUnitAssets, unitAssetsIfLoaded } from './units/assets';
import { LOOKS, MOVE_CLIP } from './units/config';
import type { UnitLibrary } from './units/library';
import { AmbientPoints, DustPool, SparkPool } from './boardFx';
import { AMBIENT_MAX, ambientFrameMs, BUSY_FRAME_MS, LOW_POWER_FRAME_MS, makeAmbientSample, PULSE_REST, sampleAmbient } from './ambient';
import { DEFAULT_BOARD_THEME, boardTheme } from './arenaThemes';
import type { BoardTheme } from './arenaThemes';
import { ANIM, BOARD_COLORS, CHARACTER_FX, CHARACTER_RARITY, RAKAELI_AWAKE_FX, RARITY_COLORS, RARITY_GLOW, TEAM_COLORS, WASTE_COLORS } from './palette';
import { GROUND_MODE, StrikeFx } from './strikeFx';
import { RingMaterials, TokenKit } from './tokens';
import { STORM_COLORS, StormFx } from './storm';
import { WasteFx } from './waste';
import { TrapMarks3D } from './trapFx';
import { AWAKEN_COLORS, AwakenMarks3D, RakaeliFx3D, awakenOf, awakenTimeline, isRakaeli, makeAwakenSample, rakaeliStyle, sampleAwaken } from './awakenFx';
import type { AwakeMarks, AwakenPhase, AwakenTimeline, RakaeliStyle } from './awakenFx';
import {
  clamp01,
  containerSize,
  easeInOutCubic,
  easeOutCubic,
  hexToRgb,
  hopSquares,
  arrowSign,
  hopTimingFor,
  indexHighlights,
  shotLaneEnds,
  isHopMove,
  makeRng,
  mixRgb,
  posKey,
  FRAME_STALL_MS,
  prefersReducedMotion,
  pulse01,
  sameLook,
  shakeOffset,
  slideDuration,
  stormSquare,
  tileRgb,
  tilePalette,
} from './common';
import type { HighlightIndex, TilePalette } from './common';
import {
  makeBandTexture,
  makeBlobTexture,
  makeCaptureRingTexture,
  makeShotReticleTexture,
  makeShotSightTexture,
  makeCometTexture,
  makeDotTexture,
  makeFieldOverlayTexture,
  makeFrameTexture,
  makeGlowTexture,
  makePortableTileMaterial,
  makeSelectGlowTexture,
  makeSlabTexture,
  makeTileMaterial,
  makeTileTexture,
  makeTurnGlowTexture,
  releaseAfterUpload,
} from './textures';
import { DOT_WHITEN, FRAME_REGULAR, MARKER_QUAD, frameFit, frameStyleFor } from './arena';
import { MOVE_TRAIL } from './moveStyle';
import type { FrameStyle } from './arena';
import { canvasStats, getFallbackReason, glIdentity, releaseCanvas } from './diag';
import type { ProgramDiag, RenderDiagnostics } from './diag';

const HALF = (BOARD_SIZE - 1) / 2; // 4.5 on 10 x 10
const TILE_SIZE = 0.93;
const TILE_H = 0.09;
const TILE_TOP = TILE_H;
const SLAB_MARGIN = 0.34;
const SLAB_H = 0.4;
const SLAB_SIZE = BOARD_SIZE + SLAB_MARGIN * 2;
const OVERLAY_Y = TILE_TOP + 0.005;
const SELECT_LIFT = 0.12;
const TAP_SLOP_PX = 14;
/** Token opacity of a piece while it is being dragged (its DOM ghost follows the finger). */
const DRAG_SOURCE_OPACITY = 0.3;
/** Token opacity of a stunned piece (with the "속박" badge above it). */
const STUN_OPACITY = 0.55;
/** Camera blend between the tilted arena view and the top-down view. */
const VIEW_TRANSITION_MS = 520;
const TILT_FOV = 34;
const TOP_FOV = 24;
const TOP_ELEVATION_DEG = 89;
const MAX_PIXEL_RATIO = 2;
/**
 * Texture pixels per cell of the painted arena (bezel + field overlay): the on-screen device px per
 * cell rounded up to a 32 px step (so ordinary resizes do not repaint), 64..160.
 */
function arenaPxFor(devicePxPerCell: number): number {
  return Math.min(160, Math.max(64, Math.ceil(devicePxPerCell / 32) * 32));
}
const IDLE_FRAME_MS = 32; // idle pulse (selection / targets) is capped at ~30 fps
const IDLE_ANIM_FRAME_MS = 41; // unit idle loops alone run at ~24 fps
/** A throttled idle loop shorter than this waits frame by frame instead of on a timer (ms). */
const WAKE_MIN_MS = 12;
/** Its timer fires this much early (ms), so the frame it then waits for is not a whole frame late. */
const WAKE_EARLY_MS = 6;
/**
 * Idle caps are met this much early (ms): a frame's timestamp is its start, a little before the
 * timer that woke it, and must not cost one more wake-up just to skip.
 */
const CAP_SLACK_MS = 4;
/** Attack clip length on the board (ms). */
const ATTACK_MS = 440;
/**
 * Capture timeline (ms, relative to the strike's impact frame): the victim recoils ('hit') for
 * HIT_MS, then dies + dissolves over DEATH_MS; the attacker steps from strike range into the square
 * at STEP_AT for STEP_MS. A whole capture stays <= ~1.2 s (walk's leap + slam is the longest).
 */
const HIT_MS = 140;
const DEATH_MS = 360;
const STEP_AT = 230;
const STEP_MS = 200;
/** Distance (tile units) between attacker and victim when the strike lands. */
const STRIKE_RANGE = 0.62;
/** Window (ms) in which an insaner moving again after its capture counts as a chain move. */
const CHAIN_WINDOW_MS = 8000;
/** Facing turn time (s) when a piece's forward direction changes / after a move. */
const TURN_S = 0.25;
/** Height of the puck top above the tile (models stand on it). */
const PUCK_TOP = 0.14;
/** Token (top-down coin) height above the tile top: just above the puck's level pips. */
const TOKEN_Y = PUCK_TOP + 0.075;
/** Top-down view: screen-up offset (world z) per unit of token height (selection lift, hops). */
const TOP_LIFT_Z = 0.9;
/** Rows between the zone edge lines (world z of the line between home zone and no-man's land). */
const ZONE_LINE_Z: Record<PlayerId, number> = {
  0: HALF - (ZONE_DEPTH - 0.5),
  1: -(HALF - (ZONE_DEPTH - 0.5)),
};
const BURST_COUNT = 14;
/** Turn glow (setTurnGlow): fade length (ms) and full opacity of the additive edge glow. */
const TURN_GLOW_MS = 320;
const TURN_GLOW_OPACITY = 0.45;
/**
 * Ambient hologram scan (top-only, off with reduced motion / setIdleAnimation(false)): a faint cyan
 * band sweeps down the field for SCAN_MS once every SCAN_PERIOD_MS; no frames are drawn between
 * sweeps (a single timer wakes the board).
 */
const SCAN_MS = 2600;
const SCAN_PERIOD_MS = 9000;
const SCAN_FIRST_MS = 2500;
const SCAN_BAND = 1.6;

const cellX = (c: number): number => c - HALF;
const cellZ = (r: number): number => HALF - r;

/** Lazily loaded unit library module (code-split with the glTF loader). */
let unitLibraryModule: typeof import('./units/library') | null = null;
let unitLibraryLoading: Promise<typeof import('./units/library')> | null = null;
function loadUnitLibraryModule(): Promise<typeof import('./units/library')> {
  unitLibraryLoading ??= import('./units/library').then((m) => (unitLibraryModule = m));
  unitLibraryLoading.catch(() => {
    unitLibraryLoading = null;
  });
  return unitLibraryLoading;
}

interface PieceVisual {
  piece: Piece;
  /** Positioned on the square (x/z); never lifted. Carries userData.pieceId. */
  root: THREE.Group;
  /** Lifted / bobbed / squashed part (puck + body). Origin sits on the tile top. */
  inner: THREE.Group;
  /** Animated glTF unit (null while the models load or if they failed: `body` is a silhouette). */
  actor: UnitActor | null;
  body: THREE.Object3D | null;
  /** Invisible tap target sized to the unit (the only thing the picker raycasts). */
  proxy: THREE.Mesh;
  /** Holds the 3D body; scaled away as the camera blends into the top-down view. */
  figure: THREE.Group;
  /** Rarity ring on the ground (shared material per rarity), base puck and ground decal. */
  ring: THREE.Mesh;
  puck: THREE.Mesh;
  decal: THREE.Mesh;
  /** Top-down illustrated token and its own material (fade / flash / dissolve uniforms). */
  token: THREE.Mesh;
  tokenMat: THREE.ShaderMaterial;
  /** Top-down lift last applied (inner shifted screen-up, shadow spread); 0 = resting. */
  topLift: number;
  /** Rakaeli's transform marks (aura + countdown badge, children of `inner`), created on demand. */
  awake: AwakeMarks | null;
  /** Shown transform look: awake face blend and aura intensity (0..1). */
  awakeFace: number;
  awakeAura: number;
}

/** Yaw (radians, model faces +z at 0) for a piece's forward direction (+1 = toward row 11 = -z). */
const forwardYaw = (p: Piece): number => ((p.dir ?? (p.owner === 0 ? 1 : -1)) === 1 ? Math.PI : 0);

interface RunningAnim {
  move: Move;
  start: number;
  duration: number;
  /** Approach (run / leap) duration. */
  moveDur: number;
  mover: PieceVisual;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** End of the approach: `to` for plain moves, strike range in front of the victim for captures. */
  strikeAt: THREE.Vector3;
  /** Unit strike / travel direction (xz). */
  dirX: number;
  dirZ: number;
  jump: boolean;
  jumpHeight: number;
  landed: boolean;
  /** True when the move captures (even if the victim's visual was missing). */
  capture: boolean;
  captured: PieceVisual | null;
  capturedAt: THREE.Vector3;
  attackStart: number;
  attackFired: boolean;
  impactAt: number;
  impactFired: boolean;
  deathStart: number;
  deathFired: boolean;
  stepStart: number;
  stepFired: boolean;
  /** Skill flavour: marki charge (>= 2 squares), walk leap trail, insaner chain dash. */
  charge: boolean;
  chain: boolean;
  trail: boolean;
  /** Next footstep dust time (ms since start). */
  nextDust: number;
  /** The mover steps onto wasteland and is destroyed there (toxic dissolve after the approach). */
  wasted: boolean;
  wasteFired: boolean;
  piecesAfter: Piece[];
  /** Picker's hop-through (square by square), or null for every other move. */
  hop: HopData | null;
  /** Rakaeli's move style (crimson feathers when transformed, pale ash otherwise) or null. */
  rk: RakaeliStyle | null;
  /** Next feather emission (ms since start). */
  nextFeather: number;
  resolve: () => void;
}

/** A running playAwaken (or the automatic short revert after a transformed piece's last move). */
interface AwakenRun {
  id: string;
  phase: AwakenPhase;
  tl: AwakenTimeline;
  start: number;
  /** Look when it started (a revert that begins mid-fade continues from there). */
  face0: number;
  aura0: number;
  pulsed: boolean;
  smoked: boolean;
  /** Started by the board itself (no caller waits for it). */
  auto: boolean;
  resolve: () => void;
}

/** One victim of a hop: captured the moment the hopper lands on its square. */
interface HopVictim {
  id: string;
  visual: PieceVisual | null;
  at: THREE.Vector3;
  /** Landing time (ms since start) on its square. */
  impactAt: number;
  fired: boolean;
  deathFired: boolean;
}

interface HopData {
  /** Landing squares in order (world, y = 0); the hop starts at `RunningAnim.from`. */
  squares: THREE.Vector3[];
  stepMs: number;
  landMs: number;
  arc: number;
  victims: HopVictim[];
  /** Index of the last hop whose landing effect has been played (-1 = none yet). */
  landed: number;
}

/** Brutile laying wasteland (animateSkill). */
interface SkillAnim {
  start: number;
  caster: PieceVisual | null;
  from: THREE.Vector3;
  centre: THREE.Vector3;
  /** Squares in crack order with their start time (ms since start) and world position. */
  squares: { sq: number; at: number; x: number; z: number; fired: boolean }[];
  boltAt: number;
  duration: number;
  shook: boolean;
  resolve: () => void;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0..1..0 bump over [a, b]. */
const bump = (a: number, b: number, x: number): number => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
const noRaycast = (): void => undefined;

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Dust colours (sRGB hex numbers). */
const DUST = 0xc9b9a0;
const EMBER = 0xff7a2a;
const SPAWN_MS = 380;
/** Storm removal: dissolve length (ms), dust colour and tile tint. */
const STORM_MS = 520;
const STORM_DUST = 0x9a4bff;
const STORM_TILE = hexToRgb(STORM_COLORS.tile);
const STORM_TILE_STRENGTH = 0.55;
/** Wasteland: tile tint under the decal, toxic smoke colours (dust pool), mover dissolve (ms). */
const WASTE_TILE = hexToRgb(WASTE_COLORS.tile);
const SMOKE_GREEN = 0x1f4a14;
const SMOKE_CURSE = 0x2e1240;
/** Signature dust colours: forge soot (Hammont), frost mist (Glacia, Rampid), bog spores (Venoa). */
const SOOT = 0x3a1c0e;
const FROST_MIST = 0xd6e8ff;
const BOG_SPORE = 0x56702a;
const WASTE_DIE_MS = 560;
/** Rakaeli: dark smoke / pale ash dust, feather cadence (ms) while transformed / in base form. */
const SMOKE_RAK = 0x2a0a18;
const ASH_DUST = 0xb9b2c4;
const FEATHER_MS_AWAKE = 34;
const FEATHER_MS_ASH = 75;
/**
 * Brutile's cast (animateSkill) timeline in ms: caster flare + rune, bolt launch / travel / fade,
 * then the squares crack open one after another (stagger shrinks with the area size).
 */
const SKILL_BOLT_AT = 190;
const SKILL_BOLT_MS = 250;
const SKILL_BOLT_FADE = 300;
const SKILL_CRACK_AT = 430;
const SKILL_CRACK_MS = 300;
const SKILL_RUNE_MS = 1000;

/** Adds a fresnel rim light (team light color) to a standard material's emissive term. */
function addRim(mat: THREE.MeshStandardMaterial, rimHex: string, strength: number, power = 2.3): void {
  const rim = new THREE.Color(rimHex);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rim };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += rimColor * (pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), ${power.toFixed(1)}) * ${strength.toFixed(2)});`,
      );
  };
  mat.customProgramCacheKey = () => `rim${power}-${strength}`;
}

/**
 * Ground decal under a piece in ONE draw: contact shadow (darkens, alpha) + rarity glow (adds),
 * premultiplied blending (src ONE, dst ONE_MINUS_SRC_ALPHA).
 */
function makeGroundDecalMaterial(blob: THREE.Texture, glow: THREE.Texture, color: string, glowAmt: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBlob: { value: blob }, uGlow: { value: glow }, uColor: { value: new THREE.Color(color) }, uGlowAmt: { value: glowAmt } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uBlob; uniform sampler2D uGlow; uniform vec3 uColor; uniform float uGlowAmt; varying vec2 vUv;
      void main(){
        // Soft contact shadow (night-0): 1.12 wide, offset (+0.04, +0.06) (down-right, light from
        // the top-left) inside the 1.5-wide decal.
        vec2 bu = (vUv - 0.5) * (1.5 / 1.12) + 0.5 - vec2(0.04, -0.06) / 1.12;
        float sh = texture2D(uBlob, clamp(bu, 0.0, 1.0)).a * 0.7 * step(0.0, bu.x) * step(bu.x, 1.0) * step(0.0, bu.y) * step(bu.y, 1.0);
        float g = texture2D(uGlow, vUv).a * uGlowAmt;
        gl_FragColor = vec4(vec3(0.0021, 0.0030, 0.0060) * sh + uColor * g, sh);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Puck material: vertex colours + per-vertex emissive (x) and rim (y) from `aEmit`. */
function makePuckMaterial(rimHex: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 });
  const rim = new THREE.Color(rimHex);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aEmit;\nvarying vec2 vEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nvarying vec2 vEmit;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vEmit.x;
        totalEmissiveRadiance += uRim * pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.0) * vEmit.y;`,
      );
  };
  mat.customProgramCacheKey = () => 'puck-v2';
  return mat;
}

/** Shared geometries & materials for every piece (one set per BoardView instance). */
class PieceKit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];

  readonly groundPlane: THREE.BufferGeometry;
  readonly burstBit: THREE.BufferGeometry;
  /** Loading / failure silhouette (capsule body + head) and the invisible pick proxy. */
  readonly capsule: THREE.BufferGeometry;
  readonly capsuleHead: THREE.BufferGeometry;
  readonly proxyGeo: THREE.BufferGeometry;
  readonly proxyMat: THREE.MeshBasicMaterial;
  readonly silhouette: Record<PlayerId, THREE.MeshStandardMaterial>;
  readonly puckMat: THREE.MeshStandardMaterial;
  private readonly decal = new Map<Rarity, THREE.ShaderMaterial>();
  private readonly pucks = new Map<string, THREE.BufferGeometry>();
  private readonly glowTex: THREE.Texture;
  private readonly blobTex: THREE.Texture;

  constructor() {
    const g = <T extends THREE.BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const m = <T extends THREE.Material>(mat: T): T => {
      this.materials.push(mat);
      return mat;
    };

    this.groundPlane = g(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2));
    this.burstBit = g(new THREE.IcosahedronGeometry(0.095, 0));
    this.capsule = g(new THREE.CapsuleGeometry(0.2, 0.36, 6, 16).translate(0, 0.38, 0));
    this.capsuleHead = g(new THREE.SphereGeometry(0.17, 16, 12).translate(0, 0.84, 0));
    this.proxyGeo = g(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0));
    this.proxyMat = m(new THREE.MeshBasicMaterial({ visible: false }));

    const sil = (id: PlayerId): THREE.MeshStandardMaterial => {
      const mat = m(
        new THREE.MeshStandardMaterial({ color: TEAM_COLORS[id].main, roughness: 0.5, metalness: 0.05, emissive: TEAM_COLORS[id].dark, emissiveIntensity: 0.25 }),
      );
      addRim(mat, TEAM_COLORS[id].light, 0.8, 2.2);
      return mat;
    };
    this.silhouette = { 0: sil(0), 1: sil(1) };
    this.glowTex = makeGlowTexture();
    this.blobTex = makeBlobTexture();
    this.textures.push(this.glowTex, this.blobTex);
    this.puckMat = m(makePuckMaterial('#B7C8F5'));
  }

  /** Contact shadow + rarity floor glow material (cached per rarity). */
  private decalMat(r: Rarity): THREE.ShaderMaterial {
    let mat = this.decal.get(r);
    if (!mat) {
      // The rarity ring carries the rarity: keep only a soft floor glow under it (reads on the
      // dark tiles as a faint pool of the rarity colour).
      mat = makeGroundDecalMaterial(this.blobTex, this.glowTex, RARITY_COLORS[r], 0.04 + 0.24 * RARITY_GLOW[r]);
      this.materials.push(mat);
      this.decal.set(r, mat);
    }
    return mat;
  }

  /**
   * Base puck + glowing team rim + team disc + level pips merged into one vertex-coloured geometry.
   * The team rim / disc keep blue vs red readable inside the rarity ring from any camera angle.
   */
  private puck(level: Level, owner: PlayerId): THREE.BufferGeometry {
    const key = `${level}:${owner}`;
    let geo = this.pucks.get(key);
    if (geo) return geo;
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.375, 0),
      new THREE.Vector2(0.4, 0.022),
      new THREE.Vector2(0.405, 0.085),
      new THREE.Vector2(0.38, 0.125),
      new THREE.Vector2(0.33, 0.14),
      new THREE.Vector2(0, 0.14),
    ];
    const parts: { geo: THREE.BufferGeometry; color: string; emit: number; rim: number }[] = [
      { geo: new THREE.LatheGeometry(profile, 32), color: BOARD_COLORS.pieceBase, emit: 0.12, rim: 0.9 },
      {
        geo: new THREE.TorusGeometry(0.405, 0.05, 8, 48).rotateX(Math.PI / 2).translate(0, 0.07, 0),
        color: TEAM_COLORS[owner].glow,
        emit: 0.75,
        rim: 0,
      },
      {
        geo: new THREE.CircleGeometry(0.315, 40).rotateX(-Math.PI / 2).translate(0, 0.1415, 0),
        color: TEAM_COLORS[owner].main,
        emit: 0.6,
        rim: 0,
      },
    ];
    // Level pips: gold gems on the puck lip facing the camera (+z), centered.
    const spread = 0.34;
    for (let i = 0; i < level; i++) {
      const a = (i - (level - 1) / 2) * spread;
      parts.push({
        geo: new THREE.SphereGeometry(0.063, 12, 8).translate(Math.sin(a) * 0.35, 0.145, Math.cos(a) * 0.35),
        color: BOARD_COLORS.pip,
        emit: 1.1,
        rim: 0,
      });
    }
    let vCount = 0;
    let iCount = 0;
    for (const p of parts) {
      vCount += p.geo.attributes.position.count;
      iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const emit = new Float32Array(vCount * 2);
    const idx = new Uint16Array(iCount);
    let vo = 0;
    let io = 0;
    const c = new THREE.Color();
    for (const p of parts) {
      const P = p.geo.attributes.position;
      const N = p.geo.attributes.normal;
      c.set(p.color);
      for (let i = 0; i < P.count; i++) {
        pos.set([P.getX(i), P.getY(i), P.getZ(i)], (vo + i) * 3);
        nor.set([N.getX(i), N.getY(i), N.getZ(i)], (vo + i) * 3);
        col.set([c.r, c.g, c.b], (vo + i) * 3);
        emit[(vo + i) * 2] = p.emit;
        emit[(vo + i) * 2 + 1] = p.rim;
      }
      if (p.geo.index) {
        for (let k = 0; k < p.geo.index.count; k++) idx[io + k] = p.geo.index.getX(k) + vo;
        io += p.geo.index.count;
      } else {
        for (let k = 0; k < P.count; k++) idx[io + k] = vo + k;
        io += P.count;
      }
      vo += P.count;
      p.geo.dispose();
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aEmit', new THREE.BufferAttribute(emit, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.geometries.push(geo);
    this.pucks.set(key, geo);
    return geo;
  }

  build(p: Piece): { root: THREE.Group; inner: THREE.Group; puck: THREE.Mesh; decal: THREE.Mesh } {
    const root = new THREE.Group();
    root.userData.pieceId = p.id;
    const rar = CHARACTER_RARITY[p.character];

    // Contact shadow + rarity floor glow (ground level, never lifted): one decal draw.
    const decal = new THREE.Mesh(this.groundPlane, this.decalMat(rar));
    decal.position.y = TILE_TOP + 0.005;
    decal.renderOrder = 1;
    decal.raycast = () => undefined;
    root.add(decal);

    const inner = new THREE.Group();
    inner.position.y = TILE_TOP;
    root.add(inner);

    // Puck + rarity ring + level pips: one draw (+ one shadow draw).
    const puck = new THREE.Mesh(this.puck(p.level, p.owner), this.puckMat);
    puck.castShadow = false; // the decal already carries the contact shadow
    puck.receiveShadow = false;
    puck.raycast = () => undefined;
    inner.add(puck);
    return { root, inner, puck, decal };
  }

  /** Simple team-coloured capsule unit (models loading / failed to load). */
  silhouetteBody(owner: PlayerId): THREE.Group {
    const g = new THREE.Group();
    for (const geo of [this.capsule, this.capsuleHead]) {
      const me = new THREE.Mesh(geo, this.silhouette[owner]);
      me.castShadow = true;
      g.add(me);
    }
    return g;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const t of this.textures) t.dispose();
    this.decal.clear();
    this.pucks.clear();
  }
}

export class BoardView implements IBoardView {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  private readonly kit = new PieceKit();
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownTextures: THREE.Texture[] = [];

  private readonly tiles: THREE.InstancedMesh;
  private readonly moveDots: THREE.InstancedMesh;
  private readonly captureRings: THREE.InstancedMesh;
  private readonly captureGlow: THREE.InstancedMesh;
  /** Venoa's shot targets: crosshair reticles + glow, own / enemy tone (see shotTex). */
  private readonly shotRings: THREE.InstancedMesh;
  private readonly shotGlow: THREE.InstancedMesh;
  /** Venoa's arrow range: a small sight on each empty square, own / enemy tone (see sightTex). */
  private readonly shotSights: THREE.InstancedMesh;
  private readonly selectRing: THREE.Mesh;
  private readonly selectGlow: THREE.Mesh;
  /** Own / enemy tone textures of the move dots and the selection frame (index 0 = own). */
  private dotTex: THREE.Texture[] = [];
  private selTex: THREE.Texture[] = [];
  private shotTex: THREE.Texture[] = [];
  private sightTex: THREE.Texture[] = [];
  private readonly pieceLayer = new THREE.Group();
  private readonly fxLayer = new THREE.Group();

  // Effects (pre-allocated, reused).
  private readonly landRing: THREE.Mesh;
  private readonly landMat: THREE.MeshBasicMaterial;
  private readonly shockRing: THREE.Mesh;
  private readonly shockMat: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Sprite;
  private readonly flashMat: THREE.SpriteMaterial;
  private readonly burst: THREE.InstancedMesh;
  private readonly burstMat: THREE.MeshBasicMaterial;
  private readonly burstDirs: THREE.Vector3[] = [];
  private readonly burstOrigin = new THREE.Vector3();
  private readonly zoneLine: Record<PlayerId, THREE.Mesh> = {} as Record<PlayerId, THREE.Mesh>;
  private readonly zoneHalo: Record<PlayerId, THREE.Mesh> = {} as Record<PlayerId, THREE.Mesh>;
  private readonly zoneLineMat: Record<PlayerId, THREE.MeshBasicMaterial> = {} as Record<PlayerId, THREE.MeshBasicMaterial>;
  private readonly zoneHaloMat: Record<PlayerId, THREE.MeshBasicMaterial> = {} as Record<PlayerId, THREE.MeshBasicMaterial>;
  private readonly comet: THREE.Mesh;
  private readonly cometMat: THREE.MeshBasicMaterial;
  /** Painted arena (top-only): bezel plane, hologram overlay plane and their current look. */
  private frameMesh: THREE.Mesh | null = null;
  private frameMat: THREE.MeshBasicMaterial | null = null;
  private overlayMesh: THREE.Mesh | null = null;
  private overlayMat: THREE.MeshBasicMaterial | null = null;
  private frameStyle: FrameStyle = FRAME_REGULAR;
  /** Texture px per cell the arena textures were painted at (0 = not painted yet). */
  private arenaPx = 0;
  /** Diagnostics (?diag=1): cell path, shader program status, self-test notes. */
  private tilePath: 'shader' | 'portable' = 'shader';
  private programDiag: ProgramDiag[] = [];
  private readonly diagNotes: string[] = [];
  /** Turn glow (top-only arena): additive edge glow in the team colour, fading in / out. */
  private turnGlowMesh: THREE.Mesh | null = null;
  private turnGlowMat: THREE.MeshBasicMaterial | null = null;
  private glowOwner: PlayerId | null = null;
  private glowLevel = 0;
  private glowFrom = 0;
  private glowTo = 0;
  private tGlow = -1;
  /** Ambient scan band (top-only arena), its next sweep start and the timer that wakes it. */
  private scanMesh: THREE.Mesh | null = null;
  private scanMat: THREE.MeshBasicMaterial | null = null;
  private scanStart = performance.now() + SCAN_FIRST_MS;
  private scanTimer = 0;
  /** Arena board theme (arenaThemes.ts): cells, bezel, grid, surface detail, ambient particles. */
  private theme: BoardTheme = DEFAULT_BOARD_THEME;
  private tilePal: TilePalette = tilePalette(DEFAULT_BOARD_THEME);
  /** Ambient arena particles (top-only arena; null on the 3D path or if its shader failed). */
  private ambient: AmbientPoints | null = null;
  private readonly ambSample = makeAmbientSample();
  private readonly stormFx: StormFx;
  /** Brutile's wasteland, skill targeting overlay, danger marks and cast effects. */
  private readonly wasteFx: WasteFx;
  private skill: SkillAnim | null = null;
  /** Top-down only (BoardViewOptions.topOnly): no glTF units, no shadows, no view switching. */
  private readonly topOnly: boolean;
  /** Storm state (see setStorm). */
  private storm = 0;
  private stormNext: number | null = null;
  /** Pieces being taken by the storm (detached from `visuals`, dissolving) + their shared start. */
  private readonly fading: PieceVisual[] = [];
  private tStormFade = -1;
  private tLand = -1;
  private tCap = -1;
  private tShake = -1;
  private tTurn = -1;
  private turn: PlayerId = 0;
  private turnFxPlayer: PlayerId = 0;

  private readonly visuals = new Map<string, PieceVisual>();
  /** Michelle's doll traps (setTraps) and the dolls / stun badges drawn for them. */
  private traps: Trap[] = [];
  private trapMarks!: TrapMarks3D;
  /** Rakaeli: transform marks, feathers / wings / dark flame, running playAwaken calls. */
  private readonly awakenMarks = new AwakenMarks3D(0.008, TOKEN_Y + 0.06);
  private readonly rakFx: RakaeliFx3D;
  private readonly awakening = new Map<string, AwakenRun>();
  private readonly awSample = makeAwakenSample();
  /** Visuals currently showing the transform aura (keeps the light idle tick alive). */
  private awakeCount = 0;
  /** glTF unit factory (null until the models are loaded, or if loading failed). */
  private units: UnitLibrary | null = null;
  /** Point-sprite scale shared with the unit FX (drawing-buffer px per world unit at distance 1). */
  private readonly pointScale = { value: 600 };
  private readonly dust: DustPool;
  private readonly sparks: SparkPool;
  /** Character strike / skill FX, rarity ring materials, top-down token kit. */
  private readonly strike: StrikeFx;
  private readonly rings = new RingMaterials();
  private readonly tokens: TokenKit;
  private readonly reducedMotion = prefersReducedMotion();
  /** A frame threw once already (logged once; see onFrameError). */
  private frameErrorLogged = false;
  /** Frame-stall check for running animations (see watchFrames). */
  private stallTimer = 0;
  private lastRafAt = 0;
  private impactCb: ((move: Move) => void) | null = null;
  /** True while dispose() settles a running animation (no impact callback then). */
  private disposing = false;
  /** Legendary units on the board (their rainbow ring keeps a light frame tick alive). */
  private legendaryCount = 0;
  /** Last insaner capture (an immediate second move of the same piece is its chain move). */
  private lastCapture: { id: string; t: number } | null = null;
  /** Unit the soul stream flows into (followed while the stream lives). */
  private soulTarget: PieceVisual | null = null;
  /** Camera shake strength multiplier and length (ms) of the current shake. */
  private shakeAmp = 1;
  private shakeMs: number = ANIM.shake;
  /** View blend last applied to the visuals (model scale / token opacity). */
  private lastBlend = -1;
  private readonly camDir = new THREE.Vector3();
  /** Spawn-in (match start / level change): start time and the visuals popping in. */
  private tSpawn = -1;
  private readonly spawning: PieceVisual[] = [];
  private lastFx = 0;
  /** Unit idle loops (breathing etc.) at ~24 fps; off for prefers-reduced-motion. */
  private idleAnim = true;
  private lastTick = 0;
  private readonly pickList: THREE.Object3D[] = [];
  private highlights: BoardHighlights = {};
  private hi: HighlightIndex = indexHighlights({});
  private placedMoves: Pos[] = [];
  private placedCaps: Pos[] = [];
  private placedShots: Pos[] = [];
  private placedSights: Pos[] = [];
  private selVisual: PieceVisual | null = null;
  private pulsing = false;
  /** Covered by the result dialog (setPaused): no decorative idle loops. */
  private paused = false;
  /** 절전 모드 (setLowPower): no decorative idle loops, ~30 fps animations. */
  private lowPower = false;
  /** A change waits to be drawn (requestRender): the next frame draws past the idle caps. */
  private dirty = false;
  /** Timer of a throttled idle loop sleeping until its next draw (nextFrameIn). */
  private wakeTimer = 0;
  private lastFrame = 0;

  private cellCb: ((pos: Pos) => void) | null = null;
  private interactive = true;
  private anim: RunningAnim | null = null;
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private down: { id: number; x: number; y: number } | null = null;
  /** Piece being dragged by the UI (drawn faded on its square), see setDragging. */
  private draggingId: string | null = null;

  /**
   * Camera view: 0 = tilted 3D arena view, 1 = top-down. Animated between the two by
   * setViewMode (viewFrom -> viewTo over VIEW_TRANSITION_MS starting at tView).
   */
  private viewT = 0;
  private viewFrom = 0;
  private viewTo = 0;
  private tView = -1;
  private lastAspect = 1;
  private lastHeightPx = 1;

  // Camera shake basis (computed in fitCamera).
  private readonly camBase = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private pxWorld = 0.01;
  private shaking = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
  private readonly pickNdc = new THREE.Vector2();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();

  constructor(container: HTMLElement, opts: BoardViewOptions = {}) {
    this.container = container;
    this.topOnly = !!opts.topOnly;
    this.theme = boardTheme(opts.arena);
    this.tilePal = tilePalette(this.theme);
    if (this.topOnly) {
      this.viewT = 1;
      this.viewFrom = 1;
      this.viewTo = 1;
    }
    // Throws if WebGL is unavailable -> createBoardView falls back to 2D.
    // Transparent canvas (premultiplied): the page's dark backdrop (UI) shows around the frame.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    const gl = this.renderer.getContext();
    if (!gl) throw new Error('WebGL context unavailable');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    // Top-down tokens lie flat on their pucks: no shadow casters, so no shadow pass at all.
    this.renderer.shadowMap.enabled = !this.topOnly;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x; radius softens
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    (canvas.style as CSSStyleDeclaration & { webkitTapHighlightColor?: string }).webkitTapHighlightColor =
      'transparent';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(canvas);

    this.tokens = new TokenKit(this.renderer.capabilities.getMaxAnisotropy(), () => this.requestRender());
    const glowTex = makeGlowTexture();
    this.ownTextures.push(glowTex);
    try {
      this.idleAnim = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.idleAnim = true;
    }

    this.scene.background = null;

    this.buildLights();
    this.buildBoard(glowTex);

    this.tiles = this.buildTiles();
    const overlays = this.buildOverlays(glowTex);
    this.moveDots = overlays.dots;
    this.captureRings = overlays.rings;
    this.captureGlow = overlays.ringGlow;
    this.shotRings = overlays.shots;
    this.shotGlow = overlays.shotGlow;
    this.shotSights = overlays.sights;
    this.selectRing = overlays.select;
    this.selectGlow = overlays.selectGlow;

    const zl = this.buildZoneLines();
    this.comet = zl.comet;
    this.cometMat = zl.cometMat;
    this.stormFx = new StormFx(OVERLAY_Y + 0.004);
    this.scene.add(this.stormFx.mesh);
    this.wasteFx = new WasteFx(OVERLAY_Y + 0.0005);
    this.scene.add(this.wasteFx.group);
    this.trapMarks = new TrapMarks3D(cellX, cellZ, OVERLAY_Y + 0.006, TILE_TOP + TOKEN_Y + 0.05);
    this.scene.add(this.trapMarks.group);
    this.rakFx = new RakaeliFx3D(this.awakenMarks.auraMaterial());

    const fx = this.buildFx(glowTex);
    this.landRing = fx.landRing;
    this.landMat = fx.landMat;
    this.shockRing = fx.shockRing;
    this.shockMat = fx.shockMat;
    this.flash = fx.flash;
    this.flashMat = fx.flashMat;
    this.burst = fx.burst;
    this.burstMat = fx.burstMat;
    this.dust = new DustPool(160, this.pointScale);
    this.sparks = new SparkPool(72);
    this.strike = new StrikeFx(this.pointScale);
    this.fxLayer.add(this.dust.points, this.sparks.mesh, this.strike.group, this.rakFx.group);

    this.scene.add(this.pieceLayer, this.fxLayer);
    this.applyHighlights();
    this.applyZoneLines(0);

    // Size the canvas and paint the arena at its real size, then verify every shader program
    // links on this device (throws -> createBoardView falls back to the Canvas2D board).
    this.resize();
    this.selfCheck();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    // Top-down only: the glTF models (and the unit code) are never loaded.
    if (!this.topOnly) this.initUnits();
    this.scheduleWarmUp();
  }

  /**
   * Start-up self-check (WebKit / ANGLE-Metal portability): compile the visible scene with shader
   * error checking on and read each program's link status. If the cell shader does not link, the
   * cells switch to the portable built-in material; if a built-in unlit program fails too (the
   * bezel, the overlay), the WebGL board cannot draw the field at all and the constructor throws,
   * so createBoardView falls back to the Canvas2D board.
   */
  private selfCheck(): void {
    const r = this.renderer;
    r.debug.checkShaderErrors = true;
    const programOf = (mat: THREE.Material): { getUniforms(): unknown; diagnostics?: { runnable: boolean; programLog: string; fragmentShader: { log: string }; vertexShader: { log: string } } } | undefined =>
      (r.properties.get(mat) as { currentProgram?: never }).currentProgram;
    /** Programs that failed and were replaced (their GL program is gone after the swap). */
    const failed: ProgramDiag[] = [];
    const runnable = (mat: THREE.Material): boolean => {
      const prog = programOf(mat);
      if (!prog) return true; // not compiled (hidden): nothing to judge
      prog.getUniforms(); // forces the link check
      const d = prog.diagnostics;
      if (d?.runnable !== false) return true;
      const log = (d.programLog || d.fragmentShader.log || d.vertexShader.log).split('\n')[0];
      failed.push({ name: mat.name || mat.type, runnable: false, log: log || undefined });
      return false;
    };
    const collect = (): void => {
      this.programDiag = [...failed];
      for (const prog of r.info.programs ?? []) {
        const p = prog as unknown as { name: string; type: string; getUniforms(): unknown; diagnostics?: { runnable: boolean; programLog: string; fragmentShader: { log: string }; vertexShader: { log: string } } };
        p.getUniforms();
        const d = p.diagnostics;
        const log = d ? (d.programLog || d.fragmentShader.log || d.vertexShader.log).split('\n')[0] : undefined;
        if (d?.runnable === false && failed.some((f) => f.name === (p.name || p.type))) continue;
        this.programDiag.push({ name: p.name || p.type, runnable: d?.runnable !== false, log: log || undefined });
      }
    };
    const fail = (why: string): never => {
      this.disposed = true;
      this.cancelFrames();
      try {
        this.renderer.dispose();
        this.renderer.forceContextLoss();
      } catch {
        // Already gone.
      }
      throw new Error(why);
    };
    try {
      r.compile(this.scene, this.camera);
    } catch (e) {
      fail(`shader compile threw: ${String(e)}`);
    }
    if (!runnable(this.tiles.material as THREE.Material)) {
      this.diagNotes.push('cell shader failed to link: portable cells');
      this.usePortableTiles();
      try {
        r.compile(this.scene, this.camera);
      } catch (e) {
        fail(`shader compile threw: ${String(e)}`);
      }
      if (!runnable(this.tiles.material as THREE.Material)) {
        collect();
        fail('portable cell program failed to link');
      }
    }
    for (const m of [this.frameMat, this.overlayMat]) {
      if (m && !runnable(m)) {
        collect();
        fail(`arena program failed to link (${m.name || m.type})`);
      }
    }
    // The ambient particles are decoration: if their program does not link, drop them only.
    if (this.ambient) {
      const vis = this.ambient.points.visible;
      this.ambient.points.visible = true;
      try {
        r.compile(this.ambient.points, this.camera, this.scene);
      } catch {
        // judged below
      }
      this.ambient.points.visible = vis;
      if (!runnable(this.ambient.mat)) {
        this.diagNotes.push('ambient particle shader failed to link: ambient off');
        this.scene.remove(this.ambient.points);
        this.ambient.dispose();
        this.ambient = null;
      }
    }
    collect();
  }

  /** Swap the instanced cell shader for the built-in unlit material + a painted cell texture. */
  private usePortableTiles(): void {
    const old = this.tiles.material as THREE.Material;
    const { mat, tex } = makePortableTileMaterial();
    this.tiles.material = mat;
    const i = this.ownMaterials.indexOf(old);
    if (i >= 0) this.ownMaterials.splice(i, 1);
    old.dispose();
    this.ownMaterials.push(mat);
    this.ownTextures.push(tex);
    this.tilePath = 'portable';
  }

  /** Diagnostics for the ?diag=1 panel. */
  getDiagnostics(): RenderDiagnostics {
    const r = this.renderer;
    const gl = r.getContext();
    const id = glIdentity(gl);
    const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const c = r.domElement;
    const { w, h } = containerSize(this.container);
    return {
      renderer: isGl2 ? 'webgl2' : 'webgl1',
      glVendor: id.vendor,
      glRenderer: id.renderer,
      maxTextureSize: id.maxTex,
      dpr: r.getPixelRatio(),
      canvas: [c.width, c.height],
      css: [Math.round(w), Math.round(h)],
      frame: this.frameStyle.id,
      tilePath: this.tilePath,
      programs: this.programDiag,
      notes: [...this.diagNotes, `arena ${this.arenaPx}px/cell`, `theme ${this.theme.id}`],
      nullCtx: canvasStats.nullCtx,
      canvases: canvasStats.created,
      fallbackReason: getFallbackReason(),
    };
  }

  /**
   * Compile the (hidden) effect shaders shortly after start-up — strikes, sparks, dust, wasteland,
   * cast bolt / rune — so the first capture or Brutile cast does not hitch on shader compilation.
   * Runs when the browser is idle; uses KHR_parallel_shader_compile (compileAsync) where available.
   */
  private scheduleWarmUp(): void {
    const run = (): void => {
      if (this.disposed) return;
      // Without the parallel-compile extension compileAsync only warns and compiles synchronously.
      const parallel = this.renderer.extensions.has('KHR_parallel_shader_compile');
      // Hidden objects are skipped by compile(): show the Rakaeli FX for its synchronous part.
      this.rakFx.setWarm(true);
      for (const obj of [this.fxLayer, this.wasteFx.group]) {
        try {
          if (parallel) this.renderer.compileAsync(obj, this.camera, this.scene).catch(() => undefined);
          else this.renderer.compile(obj, this.camera, this.scene);
        } catch {
          // Optional optimisation only.
        }
      }
      this.rakFx.setWarm(false);
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 1500 });
    else setTimeout(run, 500);
  }

  /** Use the cached unit models, or load them; pieces show silhouettes until they arrive. */
  private initUnits(): void {
    const ready = unitAssetsIfLoaded();
    if (ready && unitLibraryModule) {
      // Looks built by an earlier view are cached: create units right away, warm the rest when idle.
      this.units = new unitLibraryModule.UnitLibrary(ready, this.pointScale);
      void this.units.prepare([]);
      return;
    }
    // The unit code is code-split like the loader: the board (with silhouettes) is interactive first.
    Promise.all([loadUnitAssets(), loadUnitLibraryModule()]).then(
      ([assets, mod]) => {
        if (this.disposed) return;
        // Build the looks on the board in small async steps (silhouettes stay meanwhile), then swap.
        const lib = new mod.UnitLibrary(assets, this.pointScale);
        void lib.prepare([...this.visuals.values()].map((v) => v.piece)).then(() => {
          if (this.disposed) {
            lib.dispose();
            return;
          }
          this.units = lib;
          this.rebuildBodies();
        });
      },
      (err: unknown) => {
        console.warn('[render] unit models failed to load, using silhouettes:', err);
      },
    );
  }

  // ---------------------------------------------------------------- scene setup

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xdbe6ff, 0x34406a, 2.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
    sun.position.set(-5, 14, 8);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = !this.topOnly;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -8.5;
    s.right = 8.5;
    s.top = 8.5;
    s.bottom = -8.5;
    s.near = 4;
    s.far = 30;
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
  }

  private buildBoard(glowTex: THREE.Texture): void {
    if (this.topOnly) {
      this.buildArena();
      return;
    }
    // Raised rounded stone slab with an inlaid team-colored frame.
    const slabGeo = new RoundedBoxGeometry(SLAB_SIZE, SLAB_H, SLAB_SIZE, 3, 0.2);
    slabGeo.translate(0, -SLAB_H / 2 + 0.001, 0);
    const slabTex = makeSlabTexture(SLAB_SIZE, SLAB_MARGIN);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: slabTex, roughness: 0.8 });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.ownGeometries.push(slabGeo);
    this.ownMaterials.push(slabMat);
    this.ownTextures.push(slabTex);

    // Under-glow: a faint cool halo that lifts the slab off the dark backdrop.
    const ugGeo = new THREE.PlaneGeometry(SLAB_SIZE * 1.5, SLAB_SIZE * 1.5).rotateX(-Math.PI / 2);
    const ugMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: '#3f5fe0',
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ug = new THREE.Mesh(ugGeo, ugMat);
    ug.position.y = -SLAB_H - 0.02;
    ug.renderOrder = -2;
    this.scene.add(ug);
    this.ownGeometries.push(ugGeo);
    this.ownMaterials.push(ugMat);
  }

  /**
   * Top-down v6 "tactical hologram" arena: the bezel + field well as one painted plane (arena.ts)
   * under the cells, the hologram overlay (zone washes, hex texture, glowing grid, edge shadow)
   * right above them, the turn glow (setTurnGlow) and the ambient scan band. Unlit (exact palette
   * colours); four draws (two only while idle without a turn glow), four small textures.
   */
  private buildArena(): void {
    // The textures (and the frame plane's size) are painted by paintArena at the real cell size.
    const pMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    pMat.name = 'arena-frame';
    const pMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pMat);
    pMesh.renderOrder = -3;
    pMesh.raycast = noRaycast;
    const oMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    oMat.name = 'arena-overlay';
    const oMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), oMat);
    oMesh.position.y = TILE_TOP + 0.001;
    oMesh.renderOrder = 0;
    oMesh.raycast = noRaycast;
    // Turn glow: the same plane as the frame, painted white, tinted per team, additive.
    const gMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[0].glow,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    gMat.name = 'arena-turn-glow';
    const gMesh = new THREE.Mesh(pMesh.geometry, gMat);
    gMesh.renderOrder = 0.5; // over the grid, under the wasteland (1) and the markers
    gMesh.visible = false;
    gMesh.raycast = noRaycast;
    // Ambient scan band (soft horizontal band across the field).
    const bandTex = makeBandTexture();
    const sGeo = new THREE.PlaneGeometry(BOARD_SIZE, SCAN_BAND).rotateX(-Math.PI / 2);
    const sMat = new THREE.MeshBasicMaterial({
      map: bandTex,
      color: this.theme.grid,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sMesh = new THREE.Mesh(sGeo, sMat);
    sMesh.position.y = TILE_TOP + 0.003;
    sMesh.renderOrder = 0.6;
    sMesh.visible = false;
    sMesh.raycast = noRaycast;
    this.frameMesh = pMesh;
    this.frameMat = pMat;
    this.overlayMat = oMat;
    this.overlayMesh = oMesh;
    this.turnGlowMesh = gMesh;
    this.turnGlowMat = gMat;
    this.scanMesh = sMesh;
    this.scanMat = sMat;
    this.scene.add(pMesh, oMesh, gMesh, sMesh);
    this.ownGeometries.push(sGeo);
    this.ownMaterials.push(pMat, oMat, gMat, sMat);
    this.ownTextures.push(bandTex);
    // Ambient particles: over the grid and the turn glow, under the wasteland (1) and every marker.
    const amb = new AmbientPoints(AMBIENT_MAX, this.pointScale, OVERLAY_Y + 0.004);
    amb.points.renderOrder = 0.7;
    amb.points.raycast = noRaycast;
    this.ambient = amb;
    this.scene.add(amb.points);
    this.applyAmbientLook();
    const { w, h } = containerSize(this.container);
    this.paintArena(w, h, true);
  }

  /**
   * (Re)paint the arena textures for a w x h CSS px board: the bezel look follows the board width
   * (slim on phones) and the texture resolution the on-screen cell size. No-op unless one of them
   * changed or `force` (first build, WebGL context restored: the canvases are freed after upload).
   */
  private paintArena(w: number, h: number, force = false): void {
    const pMesh = this.frameMesh;
    const oMesh = this.overlayMesh;
    if (!pMesh || !oMesh || !this.frameMat || !this.overlayMat || !this.turnGlowMat || !this.turnGlowMesh) return;
    const st = frameStyleFor(w);
    const fit = frameFit(st);
    const cssCell = Math.min(w / (BOARD_SIZE + fit.side * 2), h / (BOARD_SIZE + fit.top + fit.bottom));
    const px = arenaPxFor(cssCell * Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    if (!force && st === this.frameStyle && px === this.arenaPx) return;
    const styleChanged = st !== this.frameStyle || this.arenaPx === 0;
    this.frameStyle = st;
    this.arenaPx = px;
    const frame = makeFrameTexture(st, px, this.theme);
    const ov = makeFieldOverlayTexture(px, this.theme);
    const glow = makeTurnGlowTexture(st);
    for (const n of [...frame.notes, ...ov.notes, ...glow.notes]) if (!this.diagNotes.includes(n)) this.diagNotes.push(n);
    const swap = (mat: THREE.MeshBasicMaterial, tex: THREE.Texture): void => {
      const old = mat.map;
      mat.map = tex;
      mat.needsUpdate = true;
      this.ownTextures.push(tex);
      if (old) {
        const i = this.ownTextures.indexOf(old);
        if (i >= 0) this.ownTextures.splice(i, 1);
        releaseCanvas(old.image);
        old.dispose();
      }
    };
    // The big static canvases are freed once uploaded (repainted on context restore).
    releaseAfterUpload(frame.tex);
    releaseAfterUpload(ov.tex);
    swap(this.frameMat, frame.tex);
    swap(this.overlayMat, ov.tex);
    swap(this.turnGlowMat, glow.tex);
    if (styleChanged || force) {
      const old = pMesh.geometry;
      const geo = new THREE.PlaneGeometry(frame.width, frame.depth).rotateX(-Math.PI / 2);
      pMesh.geometry = geo;
      this.turnGlowMesh.geometry = geo;
      pMesh.position.set(0, TILE_TOP - 0.02, frame.offsetZ);
      this.turnGlowMesh.position.set(0, TILE_TOP + 0.002, frame.offsetZ);
      old.dispose();
      if (oMesh.geometry.type === 'PlaneGeometry' && (oMesh.geometry as THREE.PlaneGeometry).parameters.width !== ov.size) {
        oMesh.geometry.dispose();
        oMesh.geometry = new THREE.PlaneGeometry(ov.size, ov.size).rotateX(-Math.PI / 2);
      }
    }
  }

  private buildTiles(): THREE.InstancedMesh {
    if (this.topOnly) {
      // Flat cell quads; the raised look (top face, bevel, front lip) is drawn by the tile shader.
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mat = makeTileMaterial();
      const mesh = new THREE.InstancedMesh(geo, mat, BOARD_SIZE * BOARD_SIZE);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      mesh.raycast = noRaycast;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          this.tmpM.makeTranslation(cellX(c), TILE_TOP, cellZ(r));
          mesh.setMatrixAt(r * BOARD_SIZE + c, this.tmpM);
          mesh.setColorAt(r * BOARD_SIZE + c, this.tmpC.set(0xffffff));
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.ownGeometries.push(geo);
      this.ownMaterials.push(mat);
      return mesh;
    }
    const geo = new RoundedBoxGeometry(TILE_SIZE, TILE_H, TILE_SIZE, 2, 0.05);
    geo.translate(0, TILE_H / 2, 0);
    const tex = makeTileTexture();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.82, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, BOARD_SIZE * BOARD_SIZE);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        this.tmpM.makeTranslation(cellX(c), 0, cellZ(r));
        mesh.setMatrixAt(r * BOARD_SIZE + c, this.tmpM);
        mesh.setColorAt(r * BOARD_SIZE + c, this.tmpC.set(0xffffff));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.ownGeometries.push(geo);
    this.ownMaterials.push(mat);
    this.ownTextures.push(tex);
    return mesh;
  }

  private buildOverlays(glowTex: THREE.Texture): {
    dots: THREE.InstancedMesh;
    rings: THREE.InstancedMesh;
    ringGlow: THREE.InstancedMesh;
    shots: THREE.InstancedMesh;
    shotGlow: THREE.InstancedMesh;
    sights: THREE.InstancedMesh;
    select: THREE.Mesh;
    selectGlow: THREE.Mesh;
  } {
    const n = BOARD_SIZE * BOARD_SIZE;
    const mat = (
      color: string,
      opacity: number,
      additive: boolean,
      map: THREE.Texture | null = null,
    ): THREE.MeshBasicMaterial => {
      const mm = new THREE.MeshBasicMaterial({
        color,
        map,
        transparent: true,
        opacity,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.ownMaterials.push(mm);
      return mm;
    };

    // Luminous markers on the dark tiles: additive glow dots (own reach ice-cyan, enemy reach red)
    // and an additive selection frame; the capture ring is normal-blended (it sits over a coin).
    // Each comes as an own / enemy texture pair baked in its colour (white-hot core, tinted halo);
    // applyMarkers swaps the maps on a tone change.
    const own = hexToRgb(BOARD_COLORS.moveDot);
    const foe = hexToRgb(BOARD_COLORS.enemyMoveDot);
    this.dotTex = [makeDotTexture(own, DOT_WHITEN.own), makeDotTexture(foe, DOT_WHITEN.enemy)];
    this.selTex = [makeSelectGlowTexture(hexToRgb(BOARD_COLORS.selected)), makeSelectGlowTexture(hexToRgb(BOARD_COLORS.enemySelected))];
    const capTex = makeCaptureRingTexture(hexToRgb(BOARD_COLORS.capture));
    this.shotTex = [makeShotReticleTexture(hexToRgb(BOARD_COLORS.shotOwn)), makeShotReticleTexture(hexToRgb(BOARD_COLORS.shotEnemy))];
    this.sightTex = [makeShotSightTexture(hexToRgb(BOARD_COLORS.shotOwn)), makeShotSightTexture(hexToRgb(BOARD_COLORS.shotEnemy))];
    this.ownTextures.push(...this.dotTex, ...this.selTex, capTex, ...this.shotTex, ...this.sightTex);
    const dotGeo = new THREE.PlaneGeometry(MARKER_QUAD.dot, MARKER_QUAD.dot).rotateX(-Math.PI / 2);
    const dots = new THREE.InstancedMesh(dotGeo, mat('#ffffff', 0.95, true, this.dotTex[0]), n);
    dots.count = 0;
    dots.renderOrder = 2;
    dots.frustumCulled = false;

    // Capture targets: a glowing red ring over the threatened coin + a soft additive glow under it.
    const ringGeo = new THREE.PlaneGeometry(MARKER_QUAD.capture, MARKER_QUAD.capture).rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, mat('#ffffff', 1, false, capTex), n);
    rings.count = 0;
    rings.renderOrder = 5;
    rings.frustumCulled = false;

    const glowGeo = new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
    const ringGlow = new THREE.InstancedMesh(glowGeo, mat(BOARD_COLORS.capture, 0.6, true, glowTex), n);
    ringGlow.count = 0;
    ringGlow.renderOrder = 2;
    ringGlow.frustumCulled = false;

    // Venoa's shot targets: the same layering in the tone's shot colour (applyMarkers swaps it).
    const shotGeo = new THREE.PlaneGeometry(MARKER_QUAD.shot, MARKER_QUAD.shot).rotateX(-Math.PI / 2);
    const shots = new THREE.InstancedMesh(shotGeo, mat('#ffffff', 1, false, this.shotTex[0]), n);
    shots.count = 0;
    shots.renderOrder = 5;
    shots.frustumCulled = false;
    const shotGlow = new THREE.InstancedMesh(glowGeo, mat(BOARD_COLORS.shotOwn, 0.6, true, glowTex), n);
    shotGlow.count = 0;
    shotGlow.renderOrder = 2;
    shotGlow.frustumCulled = false;
    const sightGeo = new THREE.PlaneGeometry(MARKER_QUAD.sight, MARKER_QUAD.sight).rotateX(-Math.PI / 2);
    const sights = new THREE.InstancedMesh(sightGeo, mat('#ffffff', 0.9, true, this.sightTex[0]), n);
    sights.count = 0;
    sights.renderOrder = 2;
    sights.frustumCulled = false;

    // Selection: an ice-cyan (enemy: red) glowing frame hugging the tile + a soft halo under the coin.
    const selGeo = new THREE.PlaneGeometry(MARKER_QUAD.select, MARKER_QUAD.select).rotateX(-Math.PI / 2);
    const select = new THREE.Mesh(selGeo, mat('#ffffff', 1, true, this.selTex[0]));
    select.visible = false;
    select.renderOrder = 1; // under the rarity ring (2) and the coin (4)
    const selectGlow = new THREE.Mesh(glowGeo, mat(BOARD_COLORS.selected, 0.5, true, glowTex));
    selectGlow.visible = false;
    selectGlow.renderOrder = 1;

    this.ownGeometries.push(dotGeo, ringGeo, glowGeo, selGeo, shotGeo, sightGeo);
    this.scene.add(dots, rings, ringGlow, shots, shotGlow, sights, select, selectGlow);
    return { dots, rings, ringGlow, shots, shotGlow, sights, select, selectGlow };
  }

  /** Glowing home-zone edge lines (one per team) + a comet used for the turn sweep. */
  private buildZoneLines(): { comet: THREE.Mesh; cometMat: THREE.MeshBasicMaterial } {
    const bandTex = makeBandTexture();
    const cometTex = makeCometTexture();
    this.ownTextures.push(bandTex, cometTex);
    const lineGeo = new THREE.PlaneGeometry(BOARD_SIZE - 0.1, this.topOnly ? 0.04 : 0.09).rotateX(-Math.PI / 2);
    const haloGeo = new THREE.PlaneGeometry(BOARD_SIZE + 0.1, 0.8).rotateX(-Math.PI / 2);
    const cometGeo = new THREE.PlaneGeometry(3.2, 0.34).rotateX(-Math.PI / 2);
    this.ownGeometries.push(lineGeo, haloGeo, cometGeo);
    const add = (id: PlayerId): void => {
      // Thin glowing team line + a soft halo band where the home zone meets the neutral field.
      const base = {
        color: TEAM_COLORS[id].glow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      };
      // The line itself is the team's light tone: a bright, thin edge over the soft glow.
      const lineMat = new THREE.MeshBasicMaterial({ ...base, color: TEAM_COLORS[id].light, opacity: 0.8 });
      const haloMat = new THREE.MeshBasicMaterial({ ...base, map: bandTex, opacity: 0.35 });
      this.ownMaterials.push(lineMat, haloMat);
      const line = new THREE.Mesh(lineGeo, lineMat);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      line.position.set(0, OVERLAY_Y + 0.001, ZONE_LINE_Z[id]);
      halo.position.set(0, OVERLAY_Y, ZONE_LINE_Z[id]);
      line.renderOrder = 4;
      halo.renderOrder = 3;
      this.scene.add(halo, line);
      this.zoneLine[id] = line;
      this.zoneHalo[id] = halo;
      this.zoneLineMat[id] = lineMat;
      this.zoneHaloMat[id] = haloMat;
    };
    add(0);
    add(1);
    const cometMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: cometTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.ownMaterials.push(cometMat);
    const comet = new THREE.Mesh(cometGeo, cometMat);
    comet.visible = false;
    comet.renderOrder = 5;
    this.scene.add(comet);
    return { comet, cometMat };
  }

  private buildFx(glowTex: THREE.Texture): {
    landRing: THREE.Mesh;
    landMat: THREE.MeshBasicMaterial;
    shockRing: THREE.Mesh;
    shockMat: THREE.MeshBasicMaterial;
    flash: THREE.Sprite;
    flashMat: THREE.SpriteMaterial;
    burst: THREE.InstancedMesh;
    burstMat: THREE.MeshBasicMaterial;
  } {
    const ringGeo = new THREE.RingGeometry(0.4, 0.5, 48).rotateX(-Math.PI / 2);
    this.ownGeometries.push(ringGeo);
    const ringMat = (): THREE.MeshBasicMaterial => {
      const mm = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.ownMaterials.push(mm);
      return mm;
    };
    const landMat = ringMat();
    const landRing = new THREE.Mesh(ringGeo, landMat);
    landRing.visible = false;
    landRing.renderOrder = 5;
    const shockMat = ringMat();
    const shockRing = new THREE.Mesh(ringGeo, shockMat);
    shockRing.visible = false;
    shockRing.renderOrder = 5;

    const flashMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.ownMaterials.push(flashMat);
    const flash = new THREE.Sprite(flashMat);
    flash.visible = false;
    flash.renderOrder = 10;

    const burstMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownMaterials.push(burstMat);
    const burst = new THREE.InstancedMesh(this.kit.burstBit, burstMat, BURST_COUNT);
    burst.visible = false;
    burst.frustumCulled = false;
    burst.renderOrder = 9;
    const rnd = makeRng(5);
    for (let i = 0; i < BURST_COUNT; i++) {
      const a = (i / BURST_COUNT) * Math.PI * 2 + rnd() * 0.4;
      this.burstDirs.push(
        new THREE.Vector3(Math.cos(a), 0.9 + rnd() * 0.9, Math.sin(a)).multiplyScalar(0.9 + rnd() * 0.5),
      );
    }
    this.fxLayer.add(landRing, shockRing, flash, burst);
    return { landRing, landMat, shockRing, shockMat, flash, flashMat, burst, burstMat };
  }

  // ---------------------------------------------------------------- public API

  setPieces(pieces: Piece[]): void {
    if (this.disposed) return;
    this.finishAnimation(false);
    this.syncPieces(pieces, true);
    this.requestRender();
  }

  animateMove(move: Move, piecesAfter: Piece[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const mover = this.visuals.get(move.pieceId) ?? null;
    if (!mover) {
      this.syncPieces(piecesAfter);
      this.requestRender();
      if (move.captureId) this.emitImpact(move);
      return Promise.resolve();
    }
    if (isHopMove(mover.piece, move)) return this.animateHop(mover, move, piecesAfter);
    const now = performance.now();
    const ch = mover.piece.character;
    const chain = ch === 'insaner' && this.lastCapture?.id === move.pieceId && now - this.lastCapture.t < CHAIN_WINDOW_MS;
    this.lastCapture = null;

    // Detach the captured piece from tracking: it lives only for the effect.
    let captured: PieceVisual | null = null;
    const capturedAt = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    if (move.captureId) {
      const cv = this.visuals.get(move.captureId);
      if (cv) {
        this.visuals.delete(move.captureId);
        captured = cv;
        capturedAt.copy(cv.root.position);
        cv.root.traverse((o) => {
          o.castShadow = false;
        });
      }
    }
    const capture = !!move.captureId;
    // Stepping onto wasteland: the mover reaches the square, then dissolves (no strike, no impact).
    const wasted = !!move.wasted && !capture;

    // Rakaeli and Larhen leap like Walk (pieces in between never block them).
    const rk = rakaeliStyle(mover.piece);
    const jump = ch === 'walk' || ch === 'larhen' || rk !== null;
    const moveDur = jump ? ANIM.jump : slideDuration(move);
    const from = mover.root.position.clone();
    from.y = 0;
    const to = new THREE.Vector3(cellX(move.to.c), 0, cellZ(move.to.r));
    let dirX = to.x - from.x;
    let dirZ = to.z - from.z;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-6) {
      dirX /= len;
      dirZ /= len;
    } else {
      dirX = 0;
      dirZ = mover.piece.owner === 0 ? -1 : 1;
    }
    // Captures stop at strike range in front of the victim, strike, then step in.
    const strikeAt = to.clone();
    if (capture && len > 1e-6) strikeAt.lerpVectors(from, to, Math.max(0, (len - STRIKE_RANGE) / len));
    const approach = from.distanceTo(strikeAt);
    const dist = Math.hypot(move.to.r - move.from.r, move.to.c - move.from.c);

    // Strike timeline: the attack clip starts so its impact frame lands just after the approach.
    const actor = mover.actor;
    const lead = LOOKS[ch].impact * ATTACK_MS;
    const attackStart = capture ? (jump ? moveDur + 50 : Math.max(0, moveDur - 70)) : Infinity;
    const impactAt = capture ? attackStart + (actor?.has('attack') ? lead : 160) : Infinity;
    const deathStart = impactAt + HIT_MS;
    const stepStart = impactAt + STEP_AT;
    const duration = capture
      ? Math.max(stepStart + STEP_MS, deathStart + DEATH_MS) + 20
      : wasted
        ? moveDur + WASTE_DIE_MS + 30
        : moveDur + (jump ? ANIM.land : 40);

    if (actor) {
      if (len > 1e-6) actor.face(Math.atan2(dirX, dirZ), 0.12);
      const clip = MOVE_CLIP[ch];
      if (clip === 'jump' && actor.has('jump')) {
        actor.play('jump', { once: true, fade: 0.06, timeScale: actor.clipDuration('jump') / ((moveDur + ANIM.land) / 1000) });
      } else if (approach > 0.05) {
        actor.play('run', { fade: 0.08, timeScale: 1.55 });
      }
    }
    if (captured?.actor && len > 1e-6) captured.actor.face(Math.atan2(-dirX, -dirZ), 0.15);

    // Skill flavour on move start.
    const fx = CHARACTER_FX[ch];
    const charge = ch === 'marki' && dist >= 2;
    const witch = ch === 'brutile';
    // Base-form Rakaeli only sheds ash feathers (no ribbon); transformed he leaves a crimson ribbon.
    // Every other slider leaves its signature ribbon (render/moveStyle.ts).
    const sigTrail = !jump && !chain && !witch && !rk ? MOVE_TRAIL[ch] : undefined;
    const trail = (jump && rk !== 'ash') || chain || witch || !!sigTrail;
    const p0 = mover.root.position;
    if (rk === 'awake') {
      // Dark flame flaring under him as he takes off + a crimson glint.
      this.rakFx.darkFlame(p0.x, TILE_TOP + 0.014, p0.z, 0.62, 460, now);
      this.strike.glint(p0.x, 0.7, p0.z, 0.8, RAKAELI_AWAKE_FX.primary, 260, now);
    } else if (rk === 'ash') {
      this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 6, 0.8, 0.36, 0.55, ASH_DUST, 0.5);
    } else if (ch === 'sad') {
      this.strike.glint(p0.x - dirZ * 0.18, 1.05, p0.z + dirX * 0.18, 0.9, fx.primary, 300, now);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7 + now * 0.001;
        this.sparks.streak(p0.x + Math.cos(a) * 0.2, 0.35, p0.z + Math.sin(a) * 0.2, 0, 1.6 + i * 0.25, 0, 0.32, fx.secondary, 0.2);
      }
    } else if (charge) {
      this.dust.ring(p0.x, TILE_TOP + 0.04, p0.z, 10, 1.4, 0.5, 0.6, DUST, 0.4);
    } else if (chain) {
      this.strike.ground(1, GROUND_MODE.flame, p0.x, TILE_TOP + 0.012, p0.z, 0.75, fx.primary, fx.secondary, 520, now);
      this.strike.glint(p0.x, 0.9, p0.z, 1.0, '#FF4FE8', 280, now);
    } else if (witch) {
      // Brutile: a green hex glint and a puff of curse smoke where she lifts off.
      this.strike.glint(p0.x, 0.75, p0.z, 0.85, fx.primary, 300, now);
      this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 7, 0.9, 0.42, 0.6, SMOKE_CURSE, 0.5);
    } else {
      this.takeoffFx(ch, p0, jump, now);
    }
    if (trail) {
      this.camera.getWorldDirection(this.camDir);
      if (witch) this.strike.trailStart(fx.primary, fx.core, 0.36, 340, dirX, dirZ, this.camDir);
      else if (rk === 'awake') this.strike.trailStart(RAKAELI_AWAKE_FX.primary, '#FF9A7A', 0.3, 360, dirX, dirZ, this.camDir);
      else if (sigTrail) this.strike.trailStart(fx.primary, fx.core, sigTrail.width, sigTrail.life, dirX, dirZ, this.camDir);
      else this.strike.trailStart(jump ? fx.primary : '#D04BFF', jump ? fx.core : '#FFD6FA', jump ? 0.34 : 0.42, jump ? 300 : 260, dirX, dirZ, this.camDir);
    }

    return new Promise<void>((resolve) => {
      this.anim = {
        move,
        start: now,
        duration,
        moveDur,
        mover,
        from,
        to,
        strikeAt,
        dirX,
        dirZ,
        jump,
        // The jump clip already lifts the body: a lower arc keeps the unit on screen.
        jumpHeight: (0.7 + Math.min(dist, 6) * 0.12) * (actor?.has('jump') ? 0.6 : 1),
        landed: false,
        capture,
        captured,
        capturedAt,
        attackStart,
        attackFired: false,
        impactAt,
        impactFired: false,
        deathStart,
        deathFired: false,
        stepStart,
        stepFired: false,
        charge,
        chain,
        trail,
        nextDust: 0,
        wasted,
        wasteFired: false,
        piecesAfter,
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
   * Picker's hop-through: short arcs square by square with a small "콩" squash on every landing.
   * Each enemy on the way is struck the moment he lands on it (capture FX, onImpact with that
   * victim as `captureId`). Reduced motion: fast, flat hops.
   */
  private animateHop(mover: PieceVisual, move: Move, piecesAfter: Piece[]): Promise<void> {
    const now = performance.now();
    this.lastCapture = null;
    const timing = hopTimingFor(mover.piece.character, this.reducedMotion || !this.idleAnim);
    const cells = hopSquares(move);
    const squares = cells.map((p) => new THREE.Vector3(cellX(p.c), 0, cellZ(p.r)));
    const victims: HopVictim[] = [];
    const ids = move.captureIds ?? (move.captureId ? [move.captureId] : []);
    for (const id of ids) {
      const v = this.visuals.get(id) ?? null;
      const pos = v?.piece.pos;
      const step = pos ? cells.findIndex((q) => q.r === pos.r && q.c === pos.c) : cells.length - 1;
      if (v) this.visuals.delete(id);
      victims.push({
        id,
        visual: v,
        at: v ? v.root.position.clone() : squares[squares.length - 1].clone(),
        impactAt: (Math.max(0, step) + 1) * timing.stepMs,
        fired: false,
        deathFired: false,
      });
    }
    const from = mover.root.position.clone();
    from.y = 0;
    const to = squares[squares.length - 1].clone();
    let dirX = to.x - from.x;
    let dirZ = to.z - from.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;
    const moveDur = squares.length * timing.stepMs;
    const lastImpact = victims.reduce((m, v) => Math.max(m, v.impactAt), 0);
    const wasted = !!move.wasted;
    const duration = Math.max(moveDur + timing.landMs, lastImpact ? lastImpact + HIT_MS + DEATH_MS : 0, wasted ? moveDur + WASTE_DIE_MS : 0) + 30;
    if (mover.actor && mover.actor.has('jump')) mover.actor.face(Math.atan2(dirX, dirZ), 0.1);
    return new Promise<void>((resolve) => {
      this.anim = {
        move,
        start: now,
        duration,
        moveDur,
        mover,
        from,
        to,
        strikeAt: to.clone(),
        dirX,
        dirZ,
        jump: true,
        jumpHeight: timing.arc,
        landed: false,
        capture: false,
        captured: null,
        capturedAt: to.clone(),
        attackStart: Infinity,
        attackFired: true,
        impactAt: Infinity,
        impactFired: true,
        deathStart: Infinity,
        deathFired: true,
        stepStart: Infinity,
        stepFired: true,
        charge: false,
        chain: false,
        trail: false,
        nextDust: Infinity,
        wasted,
        wasteFired: false,
        piecesAfter,
        hop: { squares, stepMs: timing.stepMs, landMs: timing.landMs, arc: timing.arc, victims, landed: -1 },
        rk: null,
        nextFeather: Infinity,
        resolve,
      };
      this.requestRender();
      this.watchFrames();
    });
  }

  /** Advance a hop animation (see animateHop). */
  private tickHop(a: RunningAnim, hop: HopData, t: number, now: number): boolean {
    const root = a.mover.root;
    const inner = a.mover.inner;
    const n = hop.squares.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(t / hop.stepMs)));
    const airborne = t < a.moveDur;
    if (airborne) {
      const k = clamp01((t - i * hop.stepMs) / hop.stepMs);
      const p0 = i === 0 ? a.from : hop.squares[i - 1];
      root.position.lerpVectors(p0, hop.squares[i], easeInOutCubic(k));
      inner.position.y = TILE_TOP + Math.sin(Math.PI * k) * hop.arc;
      let sxz = 1 + 0.09 * Math.sin(Math.PI * k);
      // "콩": a quick squash right after each landing (the previous hop's), stretched take-off.
      const since = t - i * hop.stepMs;
      if (i > 0 && since < hop.landMs) sxz = 1 + 0.16 * Math.sin(Math.PI * (since / hop.landMs));
      inner.scale.set(sxz, 1, sxz);
    } else {
      root.position.copy(hop.squares[n - 1]);
      inner.position.y = TILE_TOP;
      const since = t - a.moveDur;
      const sxz = since < hop.landMs ? 1 + 0.18 * Math.sin(Math.PI * (since / hop.landMs)) : 1;
      inner.scale.set(sxz, 1, sxz);
    }
    // Landing effects for every hop completed so far (one "콩" ring + dust puff each).
    const done = Math.min(n, Math.floor(t / hop.stepMs)) - 1;
    while (hop.landed < done) {
      hop.landed++;
      const at = hop.squares[hop.landed];
      const fx = CHARACTER_FX[a.mover.piece.character];
      // Just the "콩" ring: a dust puff per hop would cover the coin in the top-down view.
      this.startLandFx(at, fx.primary, now);
    }
    // Victims: struck when he lands on their square.
    for (const v of hop.victims) {
      if (!v.fired && t >= v.impactAt) {
        v.fired = true;
        this.hopImpact(a, v, now);
      }
      if (v.fired && v.visual) this.dissolveHopVictim(a, v, t - v.impactAt);
    }
    if (a.wasted && !airborne) {
      this.tickWasted(a, t, now);
      return true;
    }
    return true;
  }

  /** A hop lands on a victim: impact FX in the hopper's colours, then onImpact for that victim. */
  private hopImpact(a: RunningAnim, v: HopVictim, now: number): void {
    const fx = CHARACTER_FX[a.mover.piece.character];
    const at = v.at;
    const gy = TILE_TOP + 0.012;
    this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.05, fx.primary, fx.core, 520, now);
    this.sparks.burst(at.x, 0.7, at.z, 18, 3.4, fx.primary, now % 97);
    this.startCaptureFx(at, fx.primary, 0.5, now, this.reducedMotion ? 0.5 : 1.4, ANIM.shake);
    if (v.visual?.actor?.has('hit')) v.visual.actor.play('hit', { once: true, hold: true, fade: 0.04 });
    this.emitImpact({ ...a.move, captureId: v.id });
  }

  /** Victim of a hop: white flash + shake, then the token burns away (like a strike's victim). */
  private dissolveHopVictim(a: RunningAnim, v: HopVictim, tk: number): void {
    const cv = v.visual!;
    if (cv.awake) this.fadeVictimMarks(cv, clamp01((tk - HIT_MS) / DEATH_MS));
    if (!v.deathFired && tk >= HIT_MS) {
      v.deathFired = true;
      const act = cv.actor;
      if (act) {
        act.play('death', { once: true, hold: true, fade: 0.06, timeScale: act.clipDuration('death') / ((DEATH_MS + 60) / 1000) });
        if (this.units) act.setDying(this.units.dyingMaterial(cv.piece));
      }
    }
    const kb = 0.2 * easeOutCubic(clamp01(tk / (HIT_MS + DEATH_MS)));
    const ck = clamp01((tk - HIT_MS) / DEATH_MS);
    cv.root.position.set(v.at.x + a.dirX * kb, 0.06 * easeOutCubic(ck), v.at.z + a.dirZ * kb);
    if (!cv.actor) cv.inner.scale.setScalar(Math.max(0.001, 1 - easeOutCubic(clamp01((ck - 0.3) / 0.7))));
    const u = cv.tokenMat.uniforms;
    u.uFlash.value = Math.max(0, 1 - tk / 160) * 0.85;
    const shake = tk < HIT_MS ? Math.sin(tk * 0.11) * 0.045 * (1 - tk / HIT_MS) : 0;
    cv.token.position.set(-a.dirZ * shake, TOKEN_Y, a.dirX * shake);
    u.uDissolve.value = ck;
    const sw = 1 + 0.14 * easeOutCubic(ck);
    cv.token.scale.set(sw, 1, sw);
    const rs = Math.max(0.001, 1 - easeOutCubic(ck));
    cv.ring.scale.set(rs, 1, rs);
  }

  // ---------------------------------------------------------------- Rakaeli ("타천")

  /**
   * Play Rakaeli's transform ('on') or revert ('off') on `pieceId`'s token; resolves when done
   * (immediately if the piece is not on the board, always on dispose). setPieces alone gives the
   * same final look without the FX. Call it before (or in the same tick as) the setPieces that
   * changes `awaken`, so the old look is never drawn in between.
   */
  playAwaken(pieceId: string, phase: AwakenPhase): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const v = this.visuals.get(pieceId);
    if (!v) return Promise.resolve();
    const prev = this.awakening.get(pieceId);
    if (prev) this.endAwaken(prev, null); // keep the look it reached; this call continues from it
    if (phase === 'on') this.tokens.loadAwake(v.piece.character, v.piece.level);
    const now = performance.now();
    const reduced = this.reducedMotion || !this.idleAnim;
    // 'on' starts from the base look and 'off' from the transformed one, unless a run was
    // interrupted mid-way (then it continues from what is on screen).
    const face0 = prev ? v.awakeFace : phase === 'on' ? 0 : 1;
    const aura0 = prev ? v.awakeAura : phase === 'on' ? 0 : 1;
    this.ensureMarks(v);
    return new Promise<void>((resolve) => {
      this.awakening.set(pieceId, { id: pieceId, phase, tl: awakenTimeline(phase, reduced), start: now, face0, aura0, pulsed: false, smoked: false, auto: false, resolve });
      if (phase === 'on' && !reduced) {
        // The blindfold catches fire: a hot glint at the eyes as the burn starts.
        const p = v.root.position;
        this.strike.glint(p.x, 0.62, p.z - 0.06, 0.9, AWAKEN_COLORS.ember, 320, now);
      }
      this.tickAwaken(now);
      this.requestRender();
      this.watchFrames();
    });
  }

  /** Advance every running transform / revert; true while any is running. */
  private tickAwaken(now: number): boolean {
    if (this.awakening.size === 0) return false;
    for (const run of this.awakening.values()) {
      const v = this.visuals.get(run.id) ?? null;
      const t = now - run.start;
      if (!v || t >= run.tl.duration) {
        this.endAwaken(run, v);
        continue;
      }
      const sm = sampleAwaken(run.phase, run.tl, Math.max(0, t), run.face0, run.aura0, this.awSample);
      v.awakeFace = sm.face;
      v.awakeAura = sm.aura;
      v.tokenMat.uniforms.uBurn.value = sm.burn;
      this.applyAwakeLook(v);
      const p = v.root.position;
      if (run.phase === 'on') this.rakFx.setWings(p.x, v.inner.position.y + TOKEN_Y - 0.03, p.z, sm.wingK, sm.wingA, now);
      if (!run.pulsed && t >= run.tl.pulseAt) {
        run.pulsed = true;
        this.awakenPulse(v, now);
      }
      if (!run.smoked && t >= run.tl.smokeAt) {
        run.smoked = true;
        this.awakenSmoke(v, now);
      }
    }
    this.recountAwake();
    return this.awakening.size > 0;
  }

  /** Finish a run: settle its end look on `v` (null = keep the current look) and resolve it. */
  private endAwaken(run: AwakenRun, v: PieceVisual | null): void {
    if (this.awakening.get(run.id) !== run) return;
    this.awakening.delete(run.id);
    try {
      if (run.phase === 'on') this.rakFx.setWings(0, 0, 0, 0, 0, 0);
      if (v) {
        const k = run.phase === 'on' ? 1 : 0;
        v.awakeFace = k;
        v.awakeAura = k;
        v.tokenMat.uniforms.uBurn.value = 0;
        this.applyAwakeLook(v);
      }
    } finally {
      run.resolve();
    }
  }

  /** Resolve every run (dispose / context loss): no frames may come to finish them. */
  private settleAwaken(): void {
    for (const run of [...this.awakening.values()]) {
      try {
        this.endAwaken(run, this.visuals.get(run.id) ?? null);
      } catch (e) {
        console.error('[render] settling a transform failed:', e);
      }
    }
  }

  /** The transform peaks: crimson pulse ring, embers, black feathers, a flash and a short shake. */
  private awakenPulse(v: PieceVisual, now: number): void {
    const p = v.root.position;
    const ax = RAKAELI_AWAKE_FX;
    const seed = now % 97;
    this.strike.ground(0, GROUND_MODE.ring, p.x, TILE_TOP + 0.012, p.z, 1.35, ax.primary, ax.core, 560, now);
    this.rakFx.darkFlame(p.x, TILE_TOP + 0.016, p.z, 0.95, 620, now);
    this.sparks.burst(p.x, 0.65, p.z, 18, 3.2, ax.primary, seed);
    this.sparks.burst(p.x, 0.5, p.z, 10, 2.4, ax.secondary, (seed + 31) % 97);
    this.rakFx.featherBurst(p.x, 0.6, p.z, 8, 1.8, 0.36, 950, 0, now);
    this.flashMat.color.set('#ffffff').lerp(this.tmpC.set(ax.primary), 0.6);
    this.flash.position.set(p.x, 0.55, p.z);
    this.flash.visible = true;
    this.tCap = Math.max(this.tCap, now); // reuse the flash timeline (shock ring / burst stay hidden)
    this.tShake = now;
    this.shakeAmp = 1.3;
    this.shakeMs = 200;
  }

  /** The transform ends: a dark smoke puff, a few black feathers drifting off, a dim ash ring. */
  private awakenSmoke(v: PieceVisual, now: number): void {
    const p = v.root.position;
    // The puff rolls outward off the coin (the base face must read again as it swaps back).
    this.dust.ring(p.x, TILE_TOP + 0.08, p.z, 12, 2.0, 0.48, 0.8, SMOKE_RAK, 0.4);
    this.dust.ring(p.x, TILE_TOP + 0.1, p.z, 6, 1.7, 0.26, 0.8, ASH_DUST, 1.3);
    this.rakFx.featherBurst(p.x, 0.5, p.z, 6, 1.0, 0.32, 1000, 0, now);
    this.strike.ground(1, GROUND_MODE.ring, p.x, TILE_TOP + 0.012, p.z, 0.85, CHARACTER_FX.rakaeli.secondary, CHARACTER_FX.rakaeli.primary, 420, now);
  }

  /** Feathers shed along a Rakaeli leap (crimson-edged black when transformed, pale ash otherwise). */
  private featherTrail(a: RunningAnim, t: number, now: number): void {
    const awake = a.rk === 'awake';
    a.nextFeather = t + (awake ? FEATHER_MS_AWAKE : FEATHER_MS_ASH);
    const p = a.mover.root.position;
    const n = (t / 34) | 0;
    const side = n % 2 === 0 ? 1 : -1;
    const ox = -a.dirZ * side * 0.2;
    const oz = a.dirX * side * 0.2;
    const y = a.mover.inner.position.y + 0.25;
    const drift = awake ? 0.7 : 0.4;
    this.rakFx.feather(p.x + ox - a.dirX * 0.2, y, p.z + oz - a.dirZ * 0.2, ox * drift * 2 - a.dirX * 0.5, 0.3, oz * drift * 2 - a.dirZ * 0.5, awake ? 0.34 : 0.28, awake ? 720 : 620, awake ? 0 : 1, Math.atan2(a.dirX, a.dirZ) + side * 0.9, side * (awake ? 3.2 : 2), now);
  }

  /** Landing of a Rakaeli leap (no capture): dark flame + feathers, or an ash puff. */
  private rakaeliLanding(a: RunningAnim, now: number): void {
    const at = a.strikeAt;
    if (a.rk === 'awake') {
      if (!a.capture) this.rakFx.darkFlame(at.x, TILE_TOP + 0.014, at.z, 0.78, 520, now);
      this.rakFx.featherBurst(at.x, 0.45, at.z, 6, 1.4, 0.3, 760, 0, now);
    } else {
      this.strike.ground(1, GROUND_MODE.ring, at.x, TILE_TOP + 0.012, at.z, 0.85, CHARACTER_FX.rakaeli.primary, CHARACTER_FX.rakaeli.core, 380, now);
      this.rakFx.featherBurst(at.x, 0.45, at.z, 4, 1.0, 0.26, 680, 1, now);
    }
  }

  /** A struck transformed Rakaeli: the badge goes at once, the aura burns out with the token. */
  private fadeVictimMarks(cv: PieceVisual, ck: number): void {
    if (!cv.awake) return;
    this.awakenMarks.setCount(cv.awake, 0);
    this.awakenMarks.setAura(cv.awake, cv.awakeAura * (1 - ck));
  }

  /** Create the transform marks of a visual (once; kept until the visual goes). */
  private ensureMarks(v: PieceVisual): AwakeMarks {
    if (!v.awake) {
      v.awake = this.awakenMarks.create();
      v.inner.add(v.awake.group);
    }
    return v.awake;
  }

  /**
   * Sync a visual's transform look to its piece (setPieces / a finished move). A matching running
   * playAwaken keeps playing; `soft` (the mover of a finished move whose transform just ran out)
   * fades out briefly instead of popping, so a playAwaken('off') right after continues from it.
   */
  private syncAwake(v: PieceVisual, soft: boolean): void {
    const want = awakenOf(v.piece) > 0 ? 1 : 0;
    const run = this.awakening.get(v.piece.id);
    if (run) {
      if ((run.phase === 'on') === (want === 1)) {
        this.applyAwakeLook(v);
        return;
      }
      this.endAwaken(run, v);
    }
    if (soft && want === 0 && v.awakeFace > 0 && !this.disposing) {
      const tl = awakenTimeline('off', true);
      this.awakening.set(v.piece.id, { id: v.piece.id, phase: 'off', tl, start: performance.now(), face0: v.awakeFace, aura0: v.awakeAura, pulsed: true, smoked: true, auto: true, resolve: () => undefined });
      return;
    }
    if (want === 1 && isRakaeli(v.piece)) this.tokens.loadAwake(v.piece.character, v.piece.level);
    v.awakeFace = want;
    v.awakeAura = want;
    v.tokenMat.uniforms.uBurn.value = 0;
    this.applyAwakeLook(v);
  }

  /** Push a visual's transform look to its coin uniform, aura decal and countdown badge. */
  private applyAwakeLook(v: PieceVisual): void {
    v.tokenMat.uniforms.uAwake.value = v.awakeFace;
    // The crimson aura stands in for the rarity ring while transformed (the purple epic glow under
    // it would turn the aura pink); the ring comes back as the aura fades.
    v.ring.visible = v.awakeAura < 0.5;
    if (v.awakeFace <= 0 && v.awakeAura <= 0 && !v.awake) return;
    const m = this.ensureMarks(v);
    // The aura fades with the coin (view blend, drag ghost).
    const vis = clamp01(v.tokenMat.uniforms.uOpacity.value / Math.max(0.001, v.piece.stun ? STUN_OPACITY : 1));
    this.awakenMarks.setAura(m, v.awakeAura * vis);
    this.awakenMarks.setCount(m, v.awakeFace >= 0.5 && vis > 0.5 ? awakenOf(v.piece) : 0);
  }

  private recountAwake(): void {
    let n = 0;
    for (const v of this.visuals.values()) if (v.awakeAura > 0) n++;
    this.awakeCount = n;
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
    this.applyHighlights();
    if (this.selectFxOn && this.hi.selected >= 0 && this.hi.selected !== prevSel && !this.anim) this.selectFx(h);
    this.requestRender();
  }

  /**
   * Signature burst when a piece is newly selected (own, or an enemy's reach preview): a rune sigil
   * in its colours under the coin, a glint and a few sparks (more with its grade). Venoa's arrows
   * also sweep each shot lane once, in the tone's shot colour. One-shot pool effects only.
   */
  private selectFx(h: BoardHighlights): void {
    const k = this.hi.selected;
    let v: PieceVisual | undefined;
    for (const x of this.visuals.values()) if (posKey(x.piece.pos) === k) v = x;
    if (!v) return;
    const now = performance.now();
    const p = v.piece;
    const fx = rakaeliStyle(p) === 'awake' ? RAKAELI_AWAKE_FX : CHARACTER_FX[p.character];
    const x = cellX(p.pos.c);
    const z = cellZ(p.pos.r);
    this.strike.ground(1, GROUND_MODE.sigil, x, TILE_TOP + 0.012, z, 1.12, fx.primary, fx.secondary, 460, now);
    this.strike.glint(x, 0.95, z, 0.7 + 0.08 * p.level, fx.primary, 300, now);
    if (!this.lowPower) this.sparks.burst(x, 0.4, z, 4 + p.level * 3, 1.4, fx.primary, now % 97);
    // Venoa: an arrow sweeps each lane to its last square (shot targets included).
    const lanes = shotLaneEnds(p.pos, [...(h.shotRange ?? []), ...(h.shots ?? [])]);
    if (lanes.length && !this.reducedMotion) {
      const col = h.tone === 'enemy' ? BOARD_COLORS.shotEnemy : BOARD_COLORS.shotOwn;
      for (const end of lanes) {
        const dx = cellX(end.c) - x;
        const dz = cellZ(end.r) - z;
        for (const life of [0.3, 0.34, 0.38]) this.sparks.streak(x, 0.5, z, dx / life, 0, dz / life, life, col, 0);
      }
    }
  }

  onCellClick(cb: (pos: Pos) => void): void {
    this.cellCb = cb;
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.down = null;
    this.renderer.domElement.style.cursor = enabled ? 'pointer' : 'default';
  }

  pickCell(clientX: number, clientY: number): Pos | null {
    if (this.disposed) return null;
    return this.pick(clientX, clientY);
  }

  cellRect(pos: Pos): ScreenRect | null {
    if (this.disposed) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.camera.updateMatrixWorld();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // Project the tile's four corners on the tile-top plane (exact square in the top-down view).
    for (let i = 0; i < 4; i++) {
      const v = this.tmpV.set(cellX(pos.c) + (i & 1 ? 0.5 : -0.5), TILE_TOP, cellZ(pos.r) + (i & 2 ? 0.5 : -0.5)).project(this.camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      x0 = Math.min(x0, sx);
      y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx);
      y1 = Math.max(y1, sy);
    }
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }

  setDragging(pieceId: string | null): void {
    if (this.disposed || pieceId === this.draggingId) return;
    const prev = this.draggingId;
    this.draggingId = pieceId;
    for (const id of [prev, pieceId]) {
      const v = id ? this.visuals.get(id) : undefined;
      if (v) this.blendVisual(v);
    }
    this.requestRender();
  }

  /**
   * Optional extra (not part of IBoardView): the side to move changed. Brightens that side's
   * home-zone edge line and plays a short light sweep along it.
   */
  setTurn(player: 0 | 1): void {
    if (this.disposed) return;
    this.turn = player;
    this.turnFxPlayer = player;
    this.tTurn = performance.now();
    this.applyZoneLines(0);
    this.requestRender();
  }

  /**
   * Turn feedback: a subtle glow on the board edge in `owner`'s team colour (null = off). Fades in /
   * out over TURN_GLOW_MS (instant with reduced motion); a static glow costs no frames.
   */
  setTurnGlow(owner: 0 | 1 | null): void {
    if (this.disposed || !this.turnGlowMat || owner === this.glowOwner) return;
    const prev = this.glowOwner;
    this.glowOwner = owner;
    if (owner !== null) this.turnGlowMat.color.set(TEAM_COLORS[owner].glow);
    // Switching teams restarts from dark so the colour never snaps on a lit glow.
    this.glowFrom = prev !== null && owner !== null ? 0 : this.glowLevel;
    this.glowTo = owner === null ? 0 : 1;
    if (this.reducedMotion) {
      this.tGlow = -1;
      this.applyGlow(this.glowTo);
    } else {
      this.tGlow = performance.now();
    }
    this.requestRender();
  }

  private applyGlow(level: number): void {
    this.glowLevel = level;
    if (!this.turnGlowMat || !this.turnGlowMesh) return;
    this.turnGlowMat.opacity = level * TURN_GLOW_OPACITY;
    this.turnGlowMesh.visible = level > 0.002;
  }

  /** Advance the turn glow fade; true while it still needs frames. */
  private tickGlow(now: number): boolean {
    if (this.tGlow < 0) return false;
    const k = clamp01((now - this.tGlow) / TURN_GLOW_MS);
    this.applyGlow(this.glowFrom + (this.glowTo - this.glowFrom) * easeOutCubic(k));
    if (k >= 1) {
      this.tGlow = -1;
      return false;
    }
    return true;
  }

  /** Ambient scan band: true while a sweep is on screen (light ~30 fps frames). No allocations. */
  private tickScan(now: number): boolean {
    const mesh = this.scanMesh;
    if (!mesh || !this.scanMat) return false;
    if (!this.idleAnim || document.hidden || this.paused || this.lowPower) {
      mesh.visible = false;
      return false;
    }
    if (now >= this.scanStart + SCAN_MS) {
      this.scanStart += Math.ceil((now - this.scanStart - SCAN_MS) / SCAN_PERIOD_MS + 1e-6) * SCAN_PERIOD_MS;
    }
    const k = (now - this.scanStart) / SCAN_MS;
    if (k < 0 || k >= 1) {
      mesh.visible = false;
      return false;
    }
    mesh.visible = true;
    const reach = HALF + 0.5 - SCAN_BAND * 0.25;
    mesh.position.z = -reach + 2 * reach * k;
    this.scanMat.opacity = this.theme.holo.scan * Math.sin(Math.PI * k);
    return true;
  }

  /** Idle board: wake up for the next scan sweep with one timer (no frames until then). */
  private scheduleScan(now: number): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = 0;
    if (!this.scanMesh || !this.idleAnim || document.hidden || this.paused || this.lowPower || this.disposed) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = 0;
      this.requestRender();
    }, Math.max(16, this.scanStart - now));
  }

  /**
   * Ambient particles: write this frame's positions (no allocations); false (and hidden) while the
   * theme has none, motion is reduced / off, or the page is hidden.
   */
  private tickAmbient(now: number): boolean {
    const amb = this.ambient;
    const spec = this.theme.ambient;
    if (!amb) return false;
    if (!spec || !this.idleAnim || this.reducedMotion || document.hidden || this.paused || this.lowPower) {
      amb.points.visible = false;
      return false;
    }
    amb.points.visible = true;
    const t = now / 1000;
    const n = Math.min(AMBIENT_MAX, spec.count);
    const p = this.ambSample;
    for (let i = 0; i < n; i++) {
      sampleAmbient(spec, i, t, p);
      amb.set(i, p.x - BOARD_SIZE / 2, p.y - BOARD_SIZE / 2, p.a, p.size, p.color);
    }
    amb.commit();
    return true;
  }

  /** Frame interval of the ambient drift alone for the current theme (see ambientFrameMs). */
  private ambientCapMs(): number {
    const spec = this.theme.ambient;
    return spec ? ambientFrameMs(spec) : IDLE_FRAME_MS;
  }

  /** Colours / shape / count of the ambient particles for the current theme. */
  private applyAmbientLook(): void {
    const spec = this.theme.ambient;
    if (!this.ambient) return;
    if (spec) this.ambient.setLook(spec.colors, spec.kind === 'twinkle', spec.count);
    else this.ambient.points.visible = false;
  }

  /**
   * Switch the arena board theme (arenaThemes.ts; unknown ids = moonrune): repaints the bezel and
   * the field overlay (the old textures are disposed and their canvases freed), re-tints the cells,
   * the scan sweep and the ambient particles. Same theme: no-op.
   */
  setArenaTheme(id: string): void {
    const next = boardTheme(id);
    if (this.disposed || next === this.theme) return;
    this.theme = next;
    this.tilePal = tilePalette(next);
    this.scanMat?.color.set(next.grid);
    this.applyAmbientLook();
    if (this.topOnly) {
      const { w, h } = containerSize(this.container);
      this.paintArena(w, h, true);
    }
    this.applyTileColors();
    this.requestRender();
  }

  /** Optional extra: enable/disable the units' idle loops (battery saver). */
  setIdleAnimation(enabled: boolean): void {
    this.idleAnim = enabled;
    this.requestRender();
  }

  /** Covered board (IBoardView.setPaused): the decorative idle loops stop until resumed. */
  setPaused(paused: boolean): void {
    if (this.paused === paused || this.disposed) return;
    this.paused = paused;
    this.requestRender();
  }

  /** 선택 이펙트 on / off (settings.selectFx). */
  private selectFxOn = true;
  setSelectFx(on: boolean): void {
    this.selectFxOn = on;
  }

  setLowPower(on: boolean): void {
    if (this.lowPower === on || this.disposed) return;
    this.lowPower = on;
    this.requestRender();
  }

  /**
   * Storm state: step `storm` = columns consumed per side (0 = none; from step 3 also
   * `stormRows(storm)` rows at the top and bottom), `nextIn` plies until the next shrink (null =
   * inactive). Consumed columns and rows get the energy field and dimmed tiles; with nextIn <= 2 the
   * next columns (and rows, once they close in) pulse a warning frame. Storm tiles stay tappable (the engine rejects moves there).
   */
  setStorm(storm: number, nextIn: number | null): void {
    if (this.disposed) return;
    this.storm = Math.max(0, Math.min(STORM_FULL_STEPS, Math.floor(storm)));
    this.stormNext = nextIn;
    this.stormFx.set(this.storm, nextIn);
    this.applyHighlights();
    this.requestRender();
  }

  /** Wasteland squares (r * BOARD_SIZE + c, full list): scorched ground with glowing green cracks. */
  setWaste(squares: number[]): void {
    if (this.disposed) return;
    this.wasteFx.setWaste(squares);
    this.applyHighlights();
    this.requestRender();
  }

  /** Skill targeting: anchors get a subtle green tint, the preview area a green (or red) ghost. */
  setTraps(traps: readonly Trap[]): void {
    if (this.disposed) return;
    this.traps = traps.filter((t) => Number.isInteger(t.sq) && t.sq >= 0 && t.sq < BOARD_SIZE * BOARD_SIZE).map((t) => ({ sq: t.sq, owner: t.owner }));
    this.applyTrapMarks();
    this.requestRender();
  }

  /** Dolls (corner minis where a piece stands) and the stun badges, from the synced visuals. */
  private applyTrapMarks(): void {
    const occupied = new Set<number>();
    const stunned: Pos[] = [];
    for (const v of this.visuals.values()) {
      occupied.add(v.piece.pos.r * BOARD_SIZE + v.piece.pos.c);
      if (v.piece.stun) stunned.push(v.piece.pos);
    }
    this.trapMarks.setTraps(this.traps.map((t) => ({ sq: t.sq, owner: t.owner, covered: occupied.has(t.sq) })));
    this.trapMarks.setStunned(stunned);
  }

  setSkillPreview(anchors: number[] | null, preview: SkillPreview | null): void {
    if (this.disposed) return;
    this.wasteFx.setPreview(anchors, preview);
    this.requestRender();
  }

  /**
   * Brutile lays wasteland: her token flares over a rune circle, a green curse bolt arcs to the
   * area, then the squares crack open one after another with a poison eruption and a small shake.
   * ~0.9-1.2 s. Always resolves (also when cut short by setPieces / animateMove / dispose). The
   * squares are part of the wasteland afterwards (setWaste with the full list is still expected).
   */
  animateSkill(caster: string, squares: number[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishAnimation(false);
    const list = [...new Set(squares)].filter((sq) => Number.isInteger(sq) && sq >= 0 && sq < BOARD_SIZE * BOARD_SIZE);
    const cv = this.visuals.get(caster) ?? null;
    if (list.length === 0) return Promise.resolve();
    const now = performance.now();
    const centre = new THREE.Vector3();
    for (const sq of list) centre.x += cellX(sq % BOARD_SIZE) / list.length;
    for (const sq of list) centre.z += cellZ(Math.floor(sq / BOARD_SIZE)) / list.length;
    const from = cv ? cv.root.position.clone() : centre.clone();
    from.y = 0;
    // Cracks spread from the bolt's landing point (area centre), nearest-to-caster first on ties.
    const cells = list.map((sq) => {
      const x = cellX(sq % BOARD_SIZE);
      const z = cellZ(Math.floor(sq / BOARD_SIZE));
      return { sq, x, z, d: Math.hypot(x - centre.x, z - centre.z) + 0.01 * Math.hypot(x - from.x, z - from.z) };
    });
    cells.sort((p, q) => p.d - q.d);
    const boltAt = cv ? SKILL_BOLT_AT : 0;
    const crackAt = cv ? SKILL_CRACK_AT : 120;
    const stagger = cells.length > 1 ? Math.min(75, 380 / (cells.length - 1)) : 0;
    const squaresT = cells.map((c, i) => ({ sq: c.sq, at: crackAt + i * stagger, x: c.x, z: c.z, fired: false }));
    const duration = crackAt + stagger * (cells.length - 1) + SKILL_CRACK_MS + 40;
    this.wasteFx.addClosed(list);
    this.applyHighlights();

    const fx = CHARACTER_FX.brutile;
    if (cv) {
      // Caster flare: rune circle, green flash, glint, curse smoke.
      const p = cv.root.position;
      this.wasteFx.runeShow(p.x, p.z, 2.3);
      this.flashMat.color.set(fx.primary);
      this.flash.position.set(p.x, 0.55, p.z);
      this.flash.visible = true;
      this.tCap = now;
      this.strike.glint(p.x, 0.8, p.z, 1.1, fx.primary, 340, now);
      this.dust.ring(p.x, TILE_TOP + 0.06, p.z, 10, 1.1, 0.5, 0.75, SMOKE_CURSE, 0.3);
      this.sparks.burst(p.x, 0.6, p.z, 10, 2.2, fx.primary, now % 97);
      // Bolt: a quadratic arc bowed sideways (reads in the top-down view) and lifted (tilted view).
      const dx = centre.x - from.x;
      const dz = centre.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      const bow = Math.min(1.6, 0.35 * len) * (dx >= 0 ? 1 : -1);
      this.wasteFx.beamShow(from.x, from.z, (from.x + centre.x) / 2 - (dz / len) * bow, (from.z + centre.z) / 2 + (dx / len) * bow, centre.x, centre.z, TILE_TOP + 0.32, 0.5 + 0.08 * len);
    }
    return new Promise<void>((resolve) => {
      this.skill = { start: now, caster: cv, from, centre, squares: squaresT, boltAt, duration, shook: false, resolve };
      this.requestRender();
      this.watchFrames();
    });
  }

  /** Advance the cast; returns true while it runs. */
  private tickSkill(now: number): boolean {
    const s = this.skill;
    if (!s) return false;
    const t = now - s.start;
    if (t >= s.duration) {
      this.finishSkill();
      return false;
    }
    const fx = CHARACTER_FX.brutile;
    const cv = s.caster;
    if (cv) {
      const pop = 1 + 0.2 * bump(0, 420, t) + 0.08 * bump(s.boltAt, s.boltAt + 260, t);
      cv.token.scale.set(pop, 1, pop);
      cv.tokenMat.uniforms.uFlash.value = 0.4 * Math.max(0, 1 - t / 260);
      this.wasteFx.runeUpdate(t / SKILL_RUNE_MS, t * 0.0016);
      const kb = (t - s.boltAt) / SKILL_BOLT_MS;
      if (kb >= 0) {
        const head = easeOutCubic(clamp01(kb)) * 1.02;
        const tail = clamp01((t - s.boltAt - SKILL_BOLT_MS * 0.75) / SKILL_BOLT_FADE);
        this.wasteFx.beamUpdate(head, tail * tail, t / 1000);
      }
    }
    let opening = false;
    for (let i = 0; i < s.squares.length; i++) {
      const q = s.squares[i];
      const k = (t - q.at) / SKILL_CRACK_MS;
      if (k < 0) continue;
      if (k < 1.2) opening = true;
      this.wasteFx.setOpen(q.sq, easeOutCubic(clamp01(k)));
      if (!q.fired) {
        q.fired = true;
        const seed = (now + i * 17) % 97;
        this.sparks.burst(q.x, 0.25, q.z, 6, 2.0, fx.primary, seed);
        if (!s.shook) {
          s.shook = true;
          // Impact of the bolt: green flash + shock ring at the area centre and a small shake.
          this.startCaptureFx(s.centre, fx.primary, 0.85, now, this.reducedMotion ? 0 : 1.7, 240);
          this.burst.visible = false; // no debris chunks: the ground itself cracks open
        }
      }
    }
    // The tiles under the opening squares darken with them (tile tint follows the reveal).
    if (opening) this.applyTileColors();
    return true;
  }

  /** End the cast now (natural end or cut short): every square fully open, effects hidden. */
  private finishSkill(): void {
    const s = this.skill;
    if (!s) return;
    this.skill = null;
    try {
      this.wasteFx.clearCast();
      if (s.caster) {
        s.caster.token.scale.set(1, 1, 1);
        s.caster.tokenMat.uniforms.uFlash.value = 0;
      }
      this.requestRender();
    } finally {
      s.resolve();
    }
  }

  /** True while the storm rule is in play (anything vanishing near the edges is a storm removal). */
  private get stormActive(): boolean {
    return this.storm > 0 || this.stormNext !== null;
  }

  /** Square inside the storm (columns, and rows from step 3), or (slack 1) the next band to be consumed (vanish detection tolerates call order). */
  private stormAt(r: number, c: number, slack = 0): boolean {
    return stormSquare(r, c, this.storm, slack);
  }

  resize(): void {
    if (this.disposed) return;
    const { w, h } = containerSize(this.container);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.lastAspect = w / h;
    this.lastHeightPx = h;
    if (this.topOnly) this.paintArena(w, h);
    this.refitCamera();
    this.requestRender();
  }

  /**
   * Switch between the tilted arena camera and the top-down camera. Animated unless
   * `animate` is false (or reduced motion is preferred). Safe to call repeatedly.
   */
  setViewMode(mode: BoardViewMode, animate = true): void {
    if (this.disposed || this.topOnly) return; // top-only boards never leave the top-down view
    const to = mode === 'top' ? 1 : 0;
    if (to === this.viewTo && (this.tView >= 0 || this.viewT === to)) return;
    this.viewTo = to;
    if (to === 1) {
      for (const v of this.visuals.values()) {
        this.tokens.load(v.piece.character, v.piece.level);
        this.tokens.loadAwake(v.piece.character, v.piece.level);
      }
    }
    if (!animate || !this.idleAnim) {
      this.viewT = to;
      this.tView = -1;
      this.refitCamera();
      this.applyViewBlend();
      this.requestRender();
      return;
    }
    this.viewFrom = this.viewT;
    this.tView = performance.now();
    this.requestRender();
  }

  getViewMode(): BoardViewMode {
    return this.viewTo === 1 ? 'top' : 'tilt';
  }

  /** Fit the camera for the current size and view blend; refresh the point-sprite scale. */
  private refitCamera(): void {
    this.fitCamera(this.lastAspect, this.lastHeightPx);
    // Spark point sizes: drawing-buffer px per world unit at distance 1.
    this.pointScale.value =
      (this.lastHeightPx * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  /** Advance the view transition; returns true while it is still running. */
  private tickView(now: number): boolean {
    if (this.tView < 0) return false;
    const k = Math.min(1, (now - this.tView) / VIEW_TRANSITION_MS);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    this.viewT = this.viewFrom + (this.viewTo - this.viewFrom) * e;
    if (k >= 1) {
      this.viewT = this.viewTo;
      this.tView = -1;
    }
    this.refitCamera();
    this.applyViewBlend();
    return this.tView >= 0;
  }

  /** Render stats for diagnostics (draw calls / triangles of the last frame). */
  getRenderInfo(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposing = true;
    this.finishAnimation(false);
    this.disposed = true;
    this.impactCb = null;
    this.cancelFrames();
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = 0;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.settleAwaken();
    for (const v of this.visuals.values()) this.removeVisual(v);
    this.visuals.clear();
    for (const v of this.fading) this.removeVisual(v);
    this.fading.length = 0;
    this.strike.dispose();
    this.rings.dispose();
    this.tokens.dispose();
    this.soulTarget = null;
    this.pieceLayer.clear();
    this.stormFx.dispose();
    this.wasteFx.dispose();
    this.trapMarks.dispose();
    this.rakFx.dispose();
    this.awakenMarks.dispose();
    this.units?.dispose();
    this.units = null;
    this.dust.dispose();
    this.sparks.dispose();
    this.ambient?.dispose();
    this.ambient = null;
    this.kit.dispose();
    for (const g of this.ownGeometries) g.dispose();
    this.frameMesh?.geometry.dispose();
    this.overlayMesh?.geometry.dispose();
    for (const m of this.ownMaterials) m.dispose();
    // Free the canvases now: iOS counts live canvases against a page-wide memory budget.
    for (const t of this.ownTextures) {
      releaseCanvas(t.image);
      t.dispose();
    }
    this.tiles.dispose();
    this.moveDots.dispose();
    this.captureRings.dispose();
    this.captureGlow.dispose();
    this.shotRings.dispose();
    this.shotGlow.dispose();
    this.shotSights.dispose();
    this.burst.dispose();
    this.scene.background = null;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.cellCb = null;
  }

  // ---------------------------------------------------------------- pieces

  /**
   * Sync the visuals to `pieces`. With `dissolve`, pieces that vanished while the storm is active
   * and stood in (or next to) a storm column are taken by the storm (dissolve) instead of popping.
   */
  private syncPieces(pieces: Piece[], dissolve = false, softId: string | null = null): void {
    const seen = new Set<string>();
    for (const p of pieces) {
      seen.add(p.id);
      let v = this.visuals.get(p.id);
      if (v && !sameLook(v.piece, p)) {
        this.removeVisual(v);
        v = undefined;
      }
      let fresh = false;
      if (!v) {
        v = this.createVisual(p);
        this.visuals.set(p.id, v);
        this.pieceLayer.add(v.root);
        fresh = true;
      } else if (v.actor) {
        // Forward direction changed (turn-around at the far edge) or a move ended: turn smoothly.
        v.actor.face(forwardYaw(p), TURN_S);
      }
      v.piece = { ...p, pos: { ...p.pos } };
      v.inner.scale.set(1, 1, 1);
      v.root.position.set(cellX(p.pos.c), 0, cellZ(p.pos.r));
      v.root.scale.set(1, 1, 1);
      v.ring.scale.set(1, 1, 1);
      v.token.position.set(0, TOKEN_Y, 0);
      v.token.scale.set(1, 1, 1);
      v.tokenMat.uniforms.uFlash.value = 0;
      v.tokenMat.uniforms.uDissolve.value = 0;
      // Forward chevron on the rim (flips with a turn-around; off for symmetric movers).
      v.tokenMat.uniforms.uArrow.value = arrowSign(p);
      if (fresh && this.idleAnim) this.startSpawn(v);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.visuals.delete(id);
        if (dissolve && this.stormActive && this.stormAt(v.piece.pos.r, v.piece.pos.c, 1) && v.actor && this.units) this.startStormFade(v);
        else this.removeVisual(v);
      }
    }
    let legend = 0;
    for (const v of this.visuals.values()) {
      if (CHARACTER_RARITY[v.piece.character] === 'legendary') legend++;
      this.blendVisual(v); // stun dim follows the piece state
      this.syncAwake(v, v.piece.id === softId);
    }
    this.legendaryCount = legend;
    this.recountAwake();
    this.applyLift();
    this.applyTrapMarks();
  }

  /**
   * Cross-fade between the 3D units (tilt) and the illustrated tokens (top-down) for the current
   * camera blend: units shrink into their puck while the coins fade in (both visible mid-way).
   */
  private applyViewBlend(force = false): void {
    const t = this.viewT;
    if (!force && t === this.lastBlend) return;
    this.lastBlend = t;
    for (const v of this.visuals.values()) this.blendVisual(v);
    for (const v of this.fading) this.blendVisual(v);
    if (this.anim?.captured) this.blendVisual(this.anim.captured);
  }

  private blendVisual(v: PieceVisual): void {
    const t = this.viewT;
    const modelK = 1 - smoothstep(0.12, 0.7, t);
    const tokenK = smoothstep(0.3, 0.85, t);
    v.figure.visible = modelK > 0.002;
    v.figure.scale.set(Math.max(0.002, modelK), Math.max(0.002, modelK * modelK), Math.max(0.002, modelK));
    v.token.visible = tokenK > 0.002;
    // A stunned piece (doll trap) is dimmed until it is free again.
    const stun = v.piece.stun ? STUN_OPACITY : 1;
    v.tokenMat.uniforms.uOpacity.value = (v.piece.id === this.draggingId ? tokenK * DRAG_SOURCE_OPACITY : tokenK) * stun;
    if (v.awake) this.applyAwakeLook(v);
  }

  /** The storm takes a piece: death clip + magenta dissolve, sparks and a purple dust ring. */
  private startStormFade(v: PieceVisual): void {
    const act = v.actor;
    if (!act || !this.units) {
      this.removeVisual(v);
      return;
    }
    const now = performance.now();
    v.root.traverse((o) => {
      o.castShadow = false;
    });
    v.inner.position.y = TILE_TOP;
    v.inner.scale.set(1, 1, 1);
    act.play('death', { once: true, hold: true, fade: 0.05, timeScale: act.clipDuration('death') / (STORM_MS / 1000) });
    act.setDying(this.units.dyingMaterial(v.piece, 'storm'));
    (v.tokenMat.uniforms.uEdge.value as THREE.Color).set(STORM_COLORS.edge);
    const p = v.root.position;
    this.sparks.burst(p.x, 0.8, p.z, 18, 3.2, STORM_COLORS.edge, (now + v.piece.pos.c * 13) % 97);
    this.dust.ring(p.x, TILE_TOP + 0.05, p.z, 10, 1.6, 0.5, 0.7, STORM_DUST, 0.2);
    this.flashMat.color.set('#ffffff').lerp(this.tmpC.set(STORM_COLORS.edge), 0.5);
    this.flash.position.set(p.x, 0.55, p.z);
    this.flash.visible = true;
    this.tCap = Math.max(this.tCap, now); // reuse the flash timeline (shock ring / burst stay hidden)
    this.fading.push(v);
    this.tStormFade = now;
    this.requestRender();
  }

  private createVisual(p: Piece): PieceVisual {
    const b = this.kit.build(p);
    const proxy = new THREE.Mesh(this.kit.proxyGeo, this.kit.proxyMat);
    proxy.userData.pieceId = p.id;
    b.inner.add(proxy);
    // Rarity ring on the ground (not lifted with the unit).
    const ring = new THREE.Mesh(this.rings.geometry, this.rings.get(CHARACTER_RARITY[p.character]));
    ring.position.y = TILE_TOP + 0.007;
    ring.renderOrder = 2;
    ring.raycast = noRaycast;
    b.root.add(ring);
    const figure = new THREE.Group();
    b.inner.add(figure);
    const tokenMat = this.tokens.material(p.character, p.level, p.owner);
    const token = new THREE.Mesh(this.tokens.geometry, tokenMat);
    token.position.y = TOKEN_Y;
    token.renderOrder = 4;
    token.raycast = noRaycast;
    b.inner.add(token);
    if (this.viewTo === 1 || this.viewT > 0) {
      this.tokens.load(p.character, p.level);
      // Rakaeli's transformed face is preloaded with his base face so the swap never waits on it.
      this.tokens.loadAwake(p.character, p.level);
    }
    const v: PieceVisual = {
      piece: p,
      root: b.root,
      inner: b.inner,
      actor: null,
      body: null,
      proxy,
      figure,
      ring,
      puck: b.puck,
      decal: b.decal,
      token,
      tokenMat,
      topLift: 0,
      awake: null,
      awakeFace: 0,
      awakeAura: 0,
    };
    // Top-down coins carry their own rim / thickness: the 3D puck under them is never seen.
    if (this.topOnly) b.puck.visible = false;
    this.attachBody(v, p);
    this.blendVisual(v);
    return v;
  }

  /** (Re)create the unit body of a visual: animated glTF actor, or a silhouette fallback. */
  private attachBody(v: PieceVisual, p: Piece): void {
    if (v.body) v.figure.remove(v.body);
    v.actor?.dispose();
    v.actor = null;
    if (this.topOnly) {
      // Tokens only: no 3D body at all (the tap proxy just covers the coin).
      v.body = null;
      v.figure.visible = false;
      v.proxy.scale.set(0.45, PUCK_TOP + 0.3, 0.45);
      return;
    }
    let height = 0.95;
    if (this.units) {
      try {
        v.actor = this.units.createActor(p);
        v.actor.face(forwardYaw(p), 0);
        v.body = v.actor.object;
        height = v.actor.height;
      } catch (err) {
        console.warn('[render] unit build failed, using a silhouette:', err);
        v.actor = null;
      }
    }
    if (!v.actor) {
      v.body = this.kit.silhouetteBody(p.owner);
      v.body.scale.setScalar(LOOKS[p.character].levels[p.level].scale);
    }
    const body = v.body;
    if (body) {
      body.position.y = PUCK_TOP - 0.01;
      v.figure.add(body);
    }
    v.proxy.scale.set(0.42, PUCK_TOP + height, 0.42);
  }

  /** Swap every silhouette for its glTF unit once the models are ready. */
  private rebuildBodies(): void {
    for (const v of this.visuals.values()) {
      if (v.actor) continue;
      this.attachBody(v, v.piece);
      if (this.idleAnim) this.startSpawn(v);
    }
    this.requestRender();
  }

  private removeVisual(v: PieceVisual): void {
    this.pieceLayer.remove(v.root);
    v.actor?.dispose(); // geometry/materials are shared templates -> freed by the library
    v.actor = null;
    v.tokenMat.dispose(); // per-piece uniforms (the face texture is shared, freed by the token kit)
    if (v.awake) {
      this.awakenMarks.release(v.awake);
      v.awake = null;
    }
    if (this.soulTarget === v) this.soulTarget = null;
  }

  /** Raise the selected piece slightly so the selection reads at a glance. */
  private applyLift(): void {
    this.selVisual = null;
    for (const v of this.visuals.values()) {
      const sel = posKey(v.piece.pos) === this.hi.selected;
      if (sel) this.selVisual = v;
      v.inner.position.y = TILE_TOP + (sel ? SELECT_LIFT : 0);
    }
  }

  // ---------------------------------------------------------------- highlights

  private applyHighlights(): void {
    this.applyTileColors();
    this.applyMarkers();
  }

  /** Tile tints: base two-tone + home zones + highlights + storm columns + wasteland. */
  private applyTileColors(): void {
    const hi = this.hi;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        let rgb = tileRgb(r, c, hi, this.tilePal);
        if (this.storm > 0 && this.stormAt(r, c)) rgb = mixRgb(rgb, STORM_TILE, STORM_TILE_STRENGTH);
        const wk = this.wasteFx.openOf(r * BOARD_SIZE + c);
        if (wk > 0) rgb = mixRgb(rgb, WASTE_TILE, 0.85 * wk);
        this.tmpC.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
        this.tiles.setColorAt(r * BOARD_SIZE + c, this.tmpC);
      }
    }
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }

  /** Move dots, capture rings, danger marks and the selection ring. */
  private applyMarkers(): void {

    const clean = (list: Pos[] | undefined): Pos[] =>
      (list ?? []).filter((p) => p.r >= 0 && p.r < BOARD_SIZE && p.c >= 0 && p.c < BOARD_SIZE);
    // Deadly targets (wasteland) get a skull instead of the dot.
    const deadly = clean(this.highlights.deadly).map(posKey);
    const deadlySet = new Set(deadly);
    this.placedMoves = clean(this.highlights.moves).filter((p) => !deadlySet.has(posKey(p)));
    // Venoa's shots (a subset of the captures) get the reticle instead of the capture ring.
    const caps = clean(this.highlights.captures);
    this.placedCaps = caps.filter((p) => !this.hi.shots.has(posKey(p)));
    this.placedShots = caps.filter((p) => this.hi.shots.has(posKey(p)));
    this.wasteFx.setDeadly(deadly);
    this.placeInstances(this.moveDots, this.placedMoves, 1);
    this.placeInstances(this.captureRings, this.placedCaps, 1);
    this.placeInstances(this.captureGlow, this.placedCaps, 1);
    this.placeInstances(this.shotRings, this.placedShots, 1);
    this.placeInstances(this.shotGlow, this.placedShots, 1);
    // Venoa's arrow range: a sight on every empty square her arrows fly over (a move target keeps
    // its dot or skull).
    this.placedSights = clean(this.highlights.shotRange).filter((p) => !this.hi.moves.has(posKey(p)));
    this.placeInstances(this.shotSights, this.placedSights, 1);

    // Own reach = ice-cyan markers; an enemy's reach preview = red dots + red selection frame.
    const tone = this.hi.enemy ? 1 : 0;
    const dotMat = this.moveDots.material as THREE.MeshBasicMaterial;
    const selMat = this.selectRing.material as THREE.MeshBasicMaterial;
    if (dotMat.map !== this.dotTex[tone]) {
      dotMat.map = this.dotTex[tone];
      selMat.map = this.selTex[tone];
    }
    const shotMat = this.shotRings.material as THREE.MeshBasicMaterial;
    if (shotMat.map !== this.shotTex[tone]) shotMat.map = this.shotTex[tone];
    const sightMat = this.shotSights.material as THREE.MeshBasicMaterial;
    if (sightMat.map !== this.sightTex[tone]) sightMat.map = this.sightTex[tone];
    (this.shotGlow.material as THREE.MeshBasicMaterial).color.set(tone ? BOARD_COLORS.shotEnemy : BOARD_COLORS.shotOwn);
    (this.selectGlow.material as THREE.MeshBasicMaterial).color.set(tone ? BOARD_COLORS.enemySelected : BOARD_COLORS.selected);
    const sel = this.highlights.selected;
    this.selectRing.visible = !!sel;
    this.selectGlow.visible = !!sel;
    if (sel) {
      this.selectRing.position.set(cellX(sel.c), OVERLAY_Y + 0.001, cellZ(sel.r));
      this.selectGlow.position.set(cellX(sel.c), OVERLAY_Y, cellZ(sel.r));
    }
    if (!this.anim) this.applyLift();
    this.pulsing = !!sel || this.placedMoves.length > 0 || this.placedCaps.length > 0 || this.placedShots.length > 0 || this.placedSights.length > 0 || deadly.length > 0;
  }

  private placeInstances(mesh: THREE.InstancedMesh, list: Pos[], scale: number): void {
    this.tmpS.set(scale, scale, scale);
    for (let i = 0; i < list.length; i++) {
      this.tmpV.set(cellX(list[i].c), OVERLAY_Y, cellZ(list[i].r));
      this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpS);
      mesh.setMatrixAt(i, this.tmpM);
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Idle pulse: selection ring, move dots, capture rings, selected-piece bob. No allocations.
   * `rest` (the idle loop is off: covered board / 절전 모드) holds a steady PULSE_REST glow.
   */
  private updatePulse(now: number, rest = false): void {
    if (!this.pulsing) return;
    const s = rest ? PULSE_REST : pulse01(now, 950);
    if (this.selectRing.visible) {
      const k = 1 + 0.03 * s;
      this.selectRing.scale.set(k, 1, k);
      (this.selectRing.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * s;
      this.selectGlow.scale.set(0.9 + 0.2 * s, 1, 0.9 + 0.2 * s);
      (this.selectGlow.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.3 * s;
    }
    if (this.placedMoves.length > 0) {
      // Soft breathing glow (pre-v4 timing).
      (this.moveDots.material as THREE.MeshBasicMaterial).opacity = 0.72 + 0.28 * s;
      this.placeInstances(this.moveDots, this.placedMoves, 0.9 + 0.16 * s);
    }
    if (this.placedCaps.length > 0) {
      const sc = rest ? PULSE_REST : pulse01(now, 700);
      (this.captureGlow.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.35 * sc;
      this.placeInstances(this.captureRings, this.placedCaps, 0.96 + 0.07 * sc);
      this.placeInstances(this.captureGlow, this.placedCaps, 0.85 + 0.25 * sc);
    }
    if (this.placedSights.length > 0) {
      (this.shotSights.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * s;
    }
    if (this.placedShots.length > 0) {
      const sc = rest ? PULSE_REST : pulse01(now, 700);
      (this.shotGlow.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.35 * sc;
      this.placeInstances(this.shotRings, this.placedShots, 0.96 + 0.07 * sc);
      this.placeInstances(this.shotGlow, this.placedShots, 0.85 + 0.25 * sc);
    }
    if (this.selVisual && !this.anim) {
      this.selVisual.inner.position.y = TILE_TOP + SELECT_LIFT + (rest ? 0 : 0.04 * Math.sin(now / 240));
    }
  }

  /**
   * Top-down view: a lifted token (selection, hops) cannot rise toward a camera looking straight
   * down, so its height is shown as a screen-up offset of the coin while its contact shadow stays
   * on the ground and spreads. No allocations; only touches visuals that are (or were) lifted.
   */
  private applyTopLift(): void {
    for (const v of this.visuals.values()) {
      const h = Math.max(0, v.inner.position.y - TILE_TOP);
      if (h === 0 && v.topLift === 0) continue;
      v.topLift = h;
      v.inner.position.z = -h * TOP_LIFT_Z;
      const k = 1 + h * 0.9;
      v.decal.scale.set(k, 1, k);
    }
  }

  // ---------------------------------------------------------------- zone lines / turn

  /** Set zone line brightness; `boost` (0..1) adds the turn-change flare for the mover's line. */
  private applyZoneLines(boost: number): void {
    for (const id of [0, 1] as const) {
      const active = id === this.turn;
      const b = active && id === this.turnFxPlayer ? boost : 0;
      this.zoneLineMat[id].opacity = Math.min(1, (active ? 0.95 : 0.6) + b * 0.5);
      this.zoneHaloMat[id].opacity = Math.min(1, (active ? 0.2 : 0.1) + b * 0.55);
      this.zoneHalo[id].scale.set(1, 1, 1 + b * 0.7);
      this.zoneLine[id].scale.set(1, 1, 1 + b * 1.4);
    }
  }

  // ---------------------------------------------------------------- camera

  /**
   * Fixed tilt, auto-fit distance + recentre so the whole slab (and piece tops) fits the
   * viewport. Portrait uses a steeper elevation and a tiny side margin so the board spans
   * nearly the full width while keeping a readable 3D perspective.
   */
  private fitCamera(aspect: number, heightPx: number): void {
    const cam = this.camera;
    cam.aspect = aspect;
    const portrait = aspect < 0.8;
    const tiltDeg = portrait ? (aspect < 0.7 ? 47 : 47) : aspect < 1.2 ? 50 : 48;
    // Top-down: almost straight down (89deg keeps lookAt well-defined with +y up) and a narrower
    // field of view so units look the same anywhere on the board.
    const t = this.viewT;
    const elevDeg = tiltDeg + (TOP_ELEVATION_DEG - tiltDeg) * t;
    cam.fov = TILT_FOV + (TOP_FOV - TILT_FOV) * t;
    cam.updateProjectionMatrix();
    const elev = THREE.MathUtils.degToRad(elevDeg);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const e = SLAB_SIZE / 2;
    const pts: THREE.Vector3[] = [];
    if (this.topOnly) {
      // Bezel + its lip and a little room for its glow (the shadow fades on the backdrop).
      const fit = frameFit(this.frameStyle);
      const ex = HALF + 0.5 + fit.side;
      const zTop = -(HALF + 0.5 + fit.top);
      const zBottom = HALF + 0.5 + fit.bottom;
      for (const x of [-ex, ex]) for (const z of [zTop, zBottom]) pts.push(new THREE.Vector3(x, 0, z));
    } else {
      for (const x of [-e, e]) {
        for (const z of [-e, e]) {
          pts.push(new THREE.Vector3(x, -SLAB_H, z), new THREE.Vector3(x, 0, z));
        }
      }
    }
    // Tallest piece on the far row (only matters for the tilted view).
    const topY = 2.2 * (1 - t) + 0.4 * t; // TILE_TOP + PUCK_TOP + UNIT_MAX_HEIGHT
    pts.push(new THREE.Vector3(-HALF, topY, -HALF), new THREE.Vector3(HALF, topY, -HALF));
    // Top-down: the flat board fills the limiting side edge to edge (phones: the full width; the
    // slim bezel's fit already keeps a hair of room for its glow).
    const slim = this.topOnly && this.frameStyle.id === 'slim';
    const marginX = THREE.MathUtils.lerp(portrait ? 0.985 : 0.92, slim ? 1 : 0.985, t);
    const marginY = THREE.MathUtils.lerp(portrait ? 0.95 : 0.92, slim ? 1 : 0.975, t);
    const target = new THREE.Vector3(0, 0, 0);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    const measure = (d: number): { minX: number; maxX: number; minY: number; maxY: number } => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        this.tmpV.copy(p).project(cam);
        minX = Math.min(minX, this.tmpV.x);
        maxX = Math.max(maxX, this.tmpV.x);
        minY = Math.min(minY, this.tmpV.y);
        maxY = Math.max(maxY, this.tmpV.y);
      }
      return { minX, maxX, minY, maxY };
    };

    let d = 30;
    for (let iter = 0; iter < 4; iter++) {
      let lo = 4;
      let hi = 250;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const b = measure(mid);
        const fits = (b.maxX - b.minX) / 2 <= marginX && (b.maxY - b.minY) / 2 <= marginY;
        if (fits) hi = mid;
        else lo = mid;
      }
      d = hi;
      const b = measure(d);
      const cx = (b.maxX + b.minX) / 2;
      const cy = (b.maxY + b.minY) / 2;
      if (Math.abs(cx) < 1e-4 && Math.abs(cy) < 1e-4) break;
      // Shift target in the camera plane by the NDC offset converted to world units.
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d;
      const halfW = halfH * aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
    }
    measure(d);
    cam.near = Math.max(0.5, d - 20);
    cam.far = d + 20;
    cam.updateProjectionMatrix();

    // Remember the rest pose + screen basis for the camera micro-shake.
    this.camBase.copy(cam.position);
    this.camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    this.camUp.setFromMatrixColumn(cam.matrixWorld, 1);
    this.pxWorld = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d) / Math.max(1, heightPx);
    this.shaking = false;
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Something on the board changed: draw on the next frame, past the idle frame caps (taps,
   * highlights, pieces never wait for a throttled tick).
   */
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
   * Throttled idle loop: sleep on a timer until the next draw is due, then align to a frame.
   * Waiting frame by frame woke the page on every display refresh (60–120 Hz) just to skip it.
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

  private cancelFrames(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = 0;
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
   * A frame threw (an FX bug, a lost context...). The loop must never die with a move, cast or
   * transform still pending: the game awaits those promises. Settle them all at their end state.
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
   * starved or throttled page), finished at its end state.
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
    if (this.disposed || (!this.anim && !this.skill && this.awakening.size === 0)) return;
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
    this.settleAwaken();
  }

  private renderFrame(now: number): void {
    this.lastRafAt = performance.now();
    const moving = this.tickAnimation(now);
    const casting = this.tickSkill(now);
    const awakening = this.tickAwaken(now);
    const animating = moving || casting || awakening;
    const viewMoving = this.tickView(now);
    const glowing = this.tickGlow(now);
    const fxActive = this.updateFx(now) || viewMoving || glowing;
    // Hidden units (top-down view) only advance while they still have a one-shot to finish.
    let unitsBusy = false;
    let haveActors = false;
    for (const v of this.visuals.values()) {
      if (!v.actor || !v.figure.visible) continue;
      haveActors = true;
      if (v.actor.busy) unitsBusy = true;
    }
    const capturedActor = this.anim?.captured?.actor ?? null;
    const busy = animating || fxActive || unitsBusy;
    // Decorative idle loops run only on a visible, uncovered board (setPaused).
    const live = !document.hidden && !this.paused && !this.lowPower;
    const idleLoop = this.idleAnim && haveActors && live;
    // The storm field and its next-line warning are game information: they keep moving in 절전 모드.
    const stormLoop = this.stormFx.active && !document.hidden && !this.paused;
    // Legendary rainbow ring: a light ~30 fps tick only while one is on the board.
    const ringLoop = this.idleAnim && this.legendaryCount > 0 && live;
    // Wasteland cracks / bubbles, skill ghost and danger marks breathe at the same light rate.
    const wasteLoop = this.idleAnim && this.wasteFx.animated && live;
    // Doll traps wobble gently (~30 fps idle tick; resting with prefers-reduced-motion).
    const trapLoop = this.idleAnim && this.trapMarks.hasDolls && live;
    // Rakaeli's transform aura flickers at the same light rate (static with reduced motion).
    const awakeLoop = this.idleAnim && this.awakeCount > 0 && live;
    const scanLoop = this.tickScan(now);
    // Ambient arena particles: the lightest tick (~10–20 fps by theme), never with reduced motion.
    const ambientLoop = this.tickAmbient(now);
    const lightLoop = stormLoop || ringLoop || wasteLoop || trapLoop || awakeLoop || scanLoop;
    const pulseLoop = this.pulsing && live;
    const since = now - this.lastFrame;
    if (busy || this.dirty) {
      if (since < (this.lowPower ? LOW_POWER_FRAME_MS : BUSY_FRAME_MS)) {
        // High-refresh displays (120 Hz+): moves draw every other refresh (see BUSY_FRAME_MS).
        this.nextFrame();
        return;
      }
    } else if (pulseLoop || idleLoop || lightLoop || ambientLoop) {
      const cap = pulseLoop ? IDLE_FRAME_MS : idleLoop ? IDLE_ANIM_FRAME_MS : lightLoop ? IDLE_FRAME_MS : this.ambientCapMs();
      if (since < cap - CAP_SLACK_MS) {
        this.nextFrameIn(cap - since); // idle pulse / idle loops are throttled; skip drawing this tick
        return;
      }
    }
    this.dirty = false;
    // Unit animation clock (clamped so a long pause never makes the mixers jump).
    const dt = this.lastTick > 0 ? Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000)) : 0;
    this.lastTick = now;
    if (this.visuals.size > 0 || capturedActor || this.fading.length > 0) {
      const step = busy || this.idleAnim ? dt : 0;
      for (const v of this.visuals.values()) {
        const act = v.actor;
        if (act && (v.figure.visible || act.busy)) act.update(step);
      }
      capturedActor?.update(dt);
      for (const v of this.fading) v.actor?.update(dt);
      this.units?.update(now / 1000);
    }
    // Decorative shader clocks (rainbow ring, wasteland shimmer, transform aura) hold still while
    // their loops are off, so a redraw for something else does not make them jump.
    if (this.idleAnim && live) {
      this.rings.time.value = now / 1000;
      this.wasteFx.update(now / 1000, pulse01(now, 800));
    }
    if (stormLoop) this.stormFx.update(now / 1000);
    if (this.trapMarks.hasDolls) this.trapMarks.update(now, trapLoop);
    if (this.idleAnim && live) this.awakenMarks.update(now / 1000);
    this.lastFrame = now;
    this.updatePulse(now, !pulseLoop);
    if (this.topOnly) this.applyTopLift();
    this.renderer.render(this.scene, this.camera);
    if (busy || pulseLoop || idleLoop || lightLoop || ambientLoop) {
      this.nextFrame();
    } else {
      this.lastTick = 0;
      this.scheduleScan(now);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.cancelFrames();
      this.lastTick = 0;
      // No frames while hidden: the game must not wait for a running animation.
      this.settleRunning();
    } else {
      this.requestRender();
    }
  };

  /** Advance the running animation; returns true if more frames are needed. */
  private tickAnimation(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    // rAF timestamps are the frame's start time: the first frame after animateMove can be dated a
    // little BEFORE `a.start`. Clamped, or the hop's square index goes negative.
    const t = Math.max(0, now - a.start);
    if (t >= a.duration) {
      this.finishAnimation(true);
      return false;
    }
    if (a.hop) return this.tickHop(a, a.hop, t, now);
    const root = a.mover.root;
    const inner = a.mover.inner;
    const k = clamp01(t / a.moveDur);
    const e = easeInOutCubic(k);
    if (!a.capture || t < a.stepStart) {
      root.position.lerpVectors(a.from, a.strikeAt, e);
      if (a.capture) {
        // Lunge into the blow around the impact frame.
        const l = 0.14 * bump(a.impactAt - 110, a.impactAt + 150, t);
        root.position.x += a.dirX * l;
        root.position.z += a.dirZ * l;
      }
    } else {
      root.position.lerpVectors(a.strikeAt, a.to, easeInOutCubic(clamp01((t - a.stepStart) / STEP_MS)));
    }
    if (a.jump) {
      let sy = 1 + 0.14 * Math.sin(Math.PI * k); // stretch mid-air
      // Top-down: the coin grows a little mid-air (closer to the eye) instead of thinning.
      let sxz = 1 + (this.topOnly ? 0.1 : -0.07) * Math.sin(Math.PI * k);
      if (t > a.moveDur) {
        // Landing squash.
        const kk = clamp01((t - a.moveDur) / ANIM.land);
        const sq = Math.sin(Math.PI * kk);
        sy = 1 - 0.22 * sq;
        sxz = 1 + 0.13 * sq;
        inner.position.y = TILE_TOP;
      } else {
        inner.position.y = TILE_TOP + Math.sin(Math.PI * k) * a.jumpHeight;
        if (k < 0.12) {
          // Anticipation squat.
          const q = 1 - k / 0.12;
          sy -= 0.12 * q;
          sxz += 0.07 * q;
        }
      }
      inner.scale.set(sxz, sy, sxz);
    } else {
      inner.position.y = TILE_TOP + 0.045 * Math.sin(Math.PI * k);
    }
    if (a.trail && t <= a.moveDur + 16) this.strike.trailPush(root.position.x, inner.position.y + (a.jump ? 0.62 : 0.55), root.position.z, now);
    if (t < a.moveDur && t >= a.nextDust) this.footstep(a, t);
    if (a.rk && t < a.moveDur && t >= a.nextFeather) this.featherTrail(a, t, now);
    if (a.wasted && t >= a.moveDur) {
      this.tickWasted(a, t, now);
      return true;
    }
    if (!a.landed && t >= a.moveDur) {
      a.landed = true;
      const fx = a.rk === 'awake' ? RAKAELI_AWAKE_FX : CHARACTER_FX[a.mover.piece.character];
      // The landing ring is the mover's own colour (its signature), not a team tint.
      this.startLandFx(a.strikeAt, fx.primary, now);
      const big = a.jump || a.charge;
      const dustCol = a.rk === 'awake' ? SMOKE_RAK : a.rk === 'ash' ? ASH_DUST : DUST;
      this.dust.ring(a.strikeAt.x, TILE_TOP + 0.04, a.strikeAt.z, a.jump ? 12 : big ? 10 : 6, a.jump ? 1.8 : big ? 1.5 : 1.0, big ? 0.55 : 0.38, 0.6, dustCol, k);
      if (a.trail) this.strike.trailEnd();
      if (a.rk) this.rakaeliLanding(a, now);
      else if (a.jump) this.strike.ground(1, GROUND_MODE.ring, a.strikeAt.x, TILE_TOP + 0.012, a.strikeAt.z, 0.95, fx.secondary, fx.core, 380, now);
      else if (!a.capture && !a.chain) this.landingFx(a.mover.piece.character, a.strikeAt, now);
      if (a.mover.piece.character === 'brutile' && !a.capture) {
        this.strike.ground(1, GROUND_MODE.ring, a.strikeAt.x, TILE_TOP + 0.012, a.strikeAt.z, 0.8, fx.primary, fx.core, 380, now);
        this.sparks.burst(a.strikeAt.x, 0.3, a.strikeAt.z, 8, 1.8, fx.primary, now % 97);
      }
      if (a.mover.actor && !a.capture && !a.jump) a.mover.actor.idle(0.12);
    }
    if (!a.attackFired && t >= a.attackStart) {
      a.attackFired = true;
      const act = a.mover.actor;
      if (act?.has('attack')) act.play('attack', { once: true, fade: 0.06, timeScale: act.clipDuration('attack') / (ATTACK_MS / 1000) });
    }
    if (a.capture && !a.impactFired && t >= a.impactAt) this.impactFx(a, now);
    if (a.capture && !a.stepFired && t >= a.stepStart) {
      a.stepFired = true;
      const act = a.mover.actor;
      if (act && a.strikeAt.distanceToSquared(a.to) > 0.0025) act.play('run', { fade: 0.1, timeScale: 1.2 });
      if (a.mover.piece.character === 'insaner') {
        // Lingering absorption aura where the imp ends up.
        const fx = CHARACTER_FX.insaner;
        this.strike.ground(1, GROUND_MODE.flame, a.to.x, TILE_TOP + 0.012, a.to.z, 0.72, fx.primary, fx.secondary, 900, now);
      }
    }
    // Strike pop of the attacker's token (top-down view).
    const pop = 1 + 0.14 * bump(a.impactAt - 90, a.impactAt + 170, t);
    a.mover.token.scale.set(pop, 1, pop);

    const cv = a.captured;
    if (cv && a.impactFired) {
      const tk = t - a.impactAt;
      if (!a.deathFired && t >= a.deathStart) {
        a.deathFired = true;
        const act = cv.actor;
        if (act) {
          act.play('death', { once: true, hold: true, fade: 0.06, timeScale: act.clipDuration('death') / ((DEATH_MS + 60) / 1000) });
          if (this.units) act.setDying(this.units.dyingMaterial(cv.piece));
        }
      }
      // Knock-back along the strike, then the body dissolves from a hot edge; silhouettes shrink.
      const kb = 0.26 * easeOutCubic(clamp01(tk / (HIT_MS + DEATH_MS)));
      const ck = clamp01((t - a.deathStart) / DEATH_MS);
      cv.root.position.set(a.capturedAt.x + a.dirX * kb, 0.08 * easeOutCubic(ck), a.capturedAt.z + a.dirZ * kb);
      if (cv.actor && this.units) {
        this.units.setDissolve(clamp01((ck - 0.08) / 0.92));
      } else if (!cv.actor) {
        const sk = clamp01((ck - 0.3) / 0.7);
        cv.inner.scale.setScalar(Math.max(0.001, 1 - easeOutCubic(sk)));
      }
      if (cv.awake) this.fadeVictimMarks(cv, ck);
      // Token: white hit flash + shake, then a burning dissolve that swells slightly (shatter).
      const u = cv.tokenMat.uniforms;
      u.uFlash.value = Math.max(0, 1 - tk / 160) * 0.85;
      const shake = tk < HIT_MS ? Math.sin(tk * 0.11) * 0.045 * (1 - tk / HIT_MS) : 0;
      cv.token.position.set(-a.dirZ * shake, TOKEN_Y, a.dirX * shake);
      u.uDissolve.value = ck;
      const sw = 1 + 0.14 * easeOutCubic(ck);
      cv.token.scale.set(sw, 1, sw);
      // The base (ring, puck, floor decal) sinks away with the body.
      const rs = Math.max(0.001, 1 - easeOutCubic(ck));
      cv.ring.scale.set(rs, 1, rs);
      const ps = Math.max(0.001, 1 - easeOutCubic(clamp01((ck - 0.25) / 0.75)));
      cv.puck.scale.set(ps, ps, ps);
      cv.decal.scale.set(ps, 1, ps);
    }
    return true;
  }

  /** The strike lands: character FX, victim recoil, onImpact. */
  private impactFx(a: RunningAnim, now: number): void {
    a.impactFired = true;
    const mp = a.mover.piece;
    const ch = mp.character;
    const fx = CHARACTER_FX[ch];
    const at = a.capturedAt;
    const gy = TILE_TOP + 0.012;
    const seed = now % 97;
    let shake = 1;
    let shakeMs: number = ANIM.shake;
    let flash = 0.45;
    let col = fx.primary;
    if (a.rk === 'awake') {
      // Dark flame: a smoky black bloom under crimson tongues, crimson / violet embers, black
      // feathers flung out, dark smoke; the victim burns away on a crimson edge.
      const ax = RAKAELI_AWAKE_FX;
      col = ax.primary;
      this.rakFx.darkFlame(at.x, gy + 0.004, at.z, 1.25, 720, now);
      this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.15, ax.primary, ax.core, 460, now);
      this.sparks.burst(at.x, 0.75, at.z, 18 + mp.level * 3, 3.6, ax.primary, seed);
      this.sparks.burst(at.x, 0.55, at.z, 10, 2.6, ax.secondary, (seed + 31) % 97);
      this.rakFx.featherBurst(at.x, 0.55, at.z, 10, 2.2, 0.36, 900, 0, now);
      this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 12, 1.5, 0.6, 0.9, SMOKE_RAK, 0.3);
      if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(ax.primary);
      shake = this.reducedMotion ? 0.6 : 1.9;
      shakeMs = 200;
      flash = 0.7;
    } else if (a.rk === 'ash') {
      // Base form: a dim halo-gold ring and a soft burst of pale ash feathers.
      this.strike.ground(0, GROUND_MODE.sigil, at.x, gy, at.z, 0.95, fx.secondary, fx.primary, 560, now);
      this.sparks.burst(at.x, 0.7, at.z, 12, 2.8, fx.primary, seed);
      this.rakFx.featherBurst(at.x, 0.55, at.z, 8, 1.6, 0.32, 820, 1, now);
      this.dust.ring(at.x, TILE_TOP + 0.06, at.z, 10, 1.2, 0.5, 0.8, ASH_DUST, 0.35);
      if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
      flash = 0.25;
    } else switch (ch) {
      case 'sad':
        this.strike.slash(at.x - a.dirX * 0.1, 0.85, at.z - a.dirZ * 0.1, 2.3, fx.primary, fx.core, a.dirX < 0, now);
        this.strike.pillar(at.x, TILE_TOP, at.z, fx.primary, fx.secondary, fx.core, false, 600, now);
        this.strike.ground(0, GROUND_MODE.sigil, at.x, gy, at.z, 1.05, fx.primary, fx.secondary, 600, now);
        this.sparks.burst(at.x, 0.85, at.z, 20 + mp.level * 4, 3.8, fx.primary, seed);
        break;
      case 'marki':
        this.strike.ground(0, GROUND_MODE.crack, at.x, gy, at.z, 1.6, fx.primary, '#9A7350', 780, now);
        this.dust.ring(at.x, TILE_TOP + 0.05, at.z, 18, 2.9, 0.78, 0.85, DUST, 0.2);
        this.dust.ring(at.x, TILE_TOP + 0.12, at.z, 8, 1.1, 0.6, 1.0, DUST, 1.1);
        for (let i = 0; i < 10; i++) {
          const ang = i * 0.63 + seed;
          this.sparks.streak(at.x, 0.2, at.z, Math.cos(ang) * 1.7, 2.2 + (i % 3) * 0.7, Math.sin(ang) * 1.7, 0.5, '#FF8A2A', 0.6);
        }
        this.sparks.burst(at.x, 0.6, at.z, 16, 3.2, fx.primary, seed);
        shake = this.reducedMotion ? 0.5 : 2.6;
        shakeMs = 260;
        flash = 0.6;
        break;
      case 'walk':
        this.strike.ground(0, GROUND_MODE.shield, at.x, gy, at.z, 1.25, fx.primary, fx.core, 540, now, Math.atan2(a.dirX, a.dirZ));
        this.sparks.burst(at.x, 0.75, at.z, 20 + mp.level * 4, 3.5, fx.secondary, seed);
        shake = this.reducedMotion ? 0.6 : 1.5;
        flash = 0.15;
        break;
      case 'insaner':
        this.strike.pillar(at.x, TILE_TOP, at.z, fx.primary, fx.secondary, fx.core, true, 640, now);
        this.strike.ground(0, GROUND_MODE.flame, at.x, gy, at.z, 1.1, fx.primary, fx.secondary, 660, now);
        this.sparks.burst(at.x, 0.8, at.z, 14, 3.4, fx.primary, seed);
        this.sparks.burst(at.x, 0.6, at.z, 10, 2.6, fx.secondary, (seed + 31) % 97);
        this.strike.soul(at.x, 0.75, at.z, '#8FB8FF', '#FFFFFF', now);
        this.soulTarget = a.mover;
        this.strike.setSoulTarget(a.mover.root.position.x, 0.75, a.mover.root.position.z);
        this.lastCapture = { id: mp.id, t: now };
        break;
      case 'brutile':
        // Curse blast: green poison flames + a toxic pillar, curse cracks, smoke, a green burn-away.
        this.strike.pillar(at.x, TILE_TOP, at.z, fx.primary, fx.secondary, fx.core, true, 640, now);
        this.strike.ground(0, GROUND_MODE.flame, at.x, gy, at.z, 1.15, fx.primary, fx.secondary, 680, now);
        this.strike.ground(1, GROUND_MODE.crack, at.x, gy, at.z, 1.4, fx.primary, WASTE_COLORS.curse, 760, now);
        this.sparks.burst(at.x, 0.8, at.z, 16, 3.4, fx.primary, seed);
        this.sparks.burst(at.x, 0.55, at.z, 8, 2.4, fx.core, (seed + 31) % 97);
        this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 12, 1.6, 0.6, 0.9, SMOKE_GREEN, 0.3);
        this.dust.ring(at.x, TILE_TOP + 0.14, at.z, 8, 1.0, 0.5, 1.0, SMOKE_CURSE, 1.0);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.6 : 1.6;
        flash = 0.75;
        break;
      case 'michelle':
        // Doll curse: a lavender stitched sigil and a puff of grey-violet threads.
        this.strike.ground(0, GROUND_MODE.sigil, at.x, gy, at.z, 1.0, fx.primary, fx.secondary, 620, now);
        this.sparks.burst(at.x, 0.7, at.z, 16, 3.0, fx.primary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 10, 1.3, 0.5, 0.9, SMOKE_CURSE, 0.4);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        flash = 0.55;
        break;
      case 'picker':
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.05, fx.primary, fx.core, 520, now);
        this.sparks.burst(at.x, 0.7, at.z, 18, 3.4, fx.primary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.05, at.z, 12, 1.8, 0.6, 0.8, DUST, 0.25);
        shake = this.reducedMotion ? 0.5 : 1.4;
        break;
      case 'rampid':
        // Ice claw: a frost ring cracking out, ice shards flung low, a cold white flash.
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.15, fx.primary, fx.core, 520, now);
        this.strike.ground(1, GROUND_MODE.crack, at.x, gy, at.z, 1.3, fx.primary, fx.secondary, 640, now);
        for (let i = 0; i < 9; i++) {
          const ang = i * 0.7 + seed;
          this.sparks.streak(at.x, 0.25, at.z, Math.cos(ang) * 2.0, 1.4 + (i % 3) * 0.5, Math.sin(ang) * 2.0, 0.45, fx.secondary, 0.5);
        }
        this.sparks.burst(at.x, 0.7, at.z, 16 + mp.level * 3, 3.4, fx.primary, seed);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.5 : 1.3;
        flash = 0.45;
        break;
      case 'larhen':
        // Twin daggers: a silver slash (one shared slash mesh), an indigo ring and steel glints.
        this.strike.slash(at.x - a.dirX * 0.1, 0.85, at.z - a.dirZ * 0.1, 2.0, fx.primary, fx.core, a.dirX < 0, now);
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.0, fx.secondary, fx.primary, 480, now);
        this.sparks.burst(at.x, 0.8, at.z, 14 + mp.level * 3, 3.6, fx.primary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.06, at.z, 8, 1.1, 0.5, 0.8, SMOKE_CURSE, 0.5);
        flash = 0.3;
        break;
      case 'volkonov':
        // A chord: a rose sigil ringing out with rose and gold sparks.
        this.strike.ground(0, GROUND_MODE.sigil, at.x, gy, at.z, 1.05, fx.primary, fx.secondary, 640, now);
        this.strike.ground(1, GROUND_MODE.ring, at.x, gy, at.z, 1.25, fx.secondary, fx.core, 520, now);
        this.sparks.burst(at.x, 0.75, at.z, 14, 3.0, fx.primary, seed);
        this.sparks.burst(at.x, 0.6, at.z, 10, 2.4, fx.secondary, (seed + 31) % 97);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        flash = 0.4;
        break;
      case 'verish':
        // Power-boot pierce: a teal slash through the victim, a pink ring and streaks flung along the lane.
        this.strike.slash(at.x - a.dirX * 0.1, 0.7, at.z - a.dirZ * 0.1, 2.1, fx.primary, fx.core, a.dirX < 0, now);
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.05, fx.secondary, fx.core, 460, now);
        for (let i = 0; i < 8; i++) {
          const spread = (i - 3.5) * 0.35;
          this.sparks.streak(at.x, 0.3, at.z, a.dirX * 2.6 + a.dirZ * spread, 0.9 + (i % 2) * 0.5, a.dirZ * 2.6 - a.dirX * spread, 0.4, fx.primary, 0.4);
        }
        this.sparks.burst(at.x, 0.6, at.z, 12 + mp.level * 3, 3.2, fx.secondary, seed);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.5 : 1.2;
        flash = 0.35;
        break;
      case 'midos':
        // Ghost claws: a moon-white slash raked through the victim, a violet void ring, shadow smoke.
        this.strike.slash(at.x - a.dirX * 0.1, 0.8, at.z - a.dirZ * 0.1, 2.2, fx.primary, fx.core, a.dirX < 0, now);
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.1, fx.primary, fx.core, 520, now);
        this.sparks.burst(at.x, 0.75, at.z, 14 + mp.level * 3, 3.4, fx.primary, seed);
        this.sparks.burst(at.x, 0.55, at.z, 8, 2.4, fx.core, (seed + 31) % 97);
        this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 10, 1.3, 0.5, 0.9, SMOKE_CURSE, 0.6);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.5 : 1.3;
        flash = 0.45;
        break;
      case 'hammont': {
        // Hammer crush: a forge-hot crater cracking out, molten sparks flung up, soot, a heavy shake.
        this.strike.ground(0, GROUND_MODE.crack, at.x, gy, at.z, 1.7, fx.primary, fx.secondary, 820, now);
        this.strike.ground(1, GROUND_MODE.ring, at.x, gy, at.z, 1.35, fx.core, fx.primary, 460, now);
        for (let i = 0; i < 12; i++) {
          const ang = i * 0.52 + seed;
          this.sparks.streak(at.x, 0.2, at.z, Math.cos(ang) * 1.9, 2.6 + (i % 3) * 0.8, Math.sin(ang) * 1.9, 0.55, i % 2 ? fx.primary : fx.core, 0.7);
        }
        this.sparks.burst(at.x, 0.6, at.z, 18 + mp.level * 3, 3.4, fx.primary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.06, at.z, 16, 2.6, 0.7, 0.9, SOOT, 0.3);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.6 : 2.8;
        shakeMs = 280;
        flash = 0.65;
        break;
      }
      case 'venoa': {
        // Poison arrow: a venom ring and splash where it lands, spores and lime drops flung along
        // the arrow's flight (from her square to the victim), the victim melts on a lime edge.
        const fdx = at.x - a.from.x;
        const fdz = at.z - a.from.z;
        const fl = Math.hypot(fdx, fdz) || 1;
        const ux = fdx / fl;
        const uz = fdz / fl;
        this.strike.ground(0, GROUND_MODE.ring, at.x, gy, at.z, 1.15, fx.primary, fx.core, 560, now);
        this.strike.ground(1, GROUND_MODE.flame, at.x, gy, at.z, 0.85, fx.primary, fx.secondary, 640, now);
        for (let i = 0; i < 9; i++) {
          const spread = (i - 4) * 0.42;
          this.sparks.streak(at.x, 0.35, at.z, ux * 2.2 + uz * spread, 1.2 + (i % 3) * 0.4, uz * 2.2 - ux * spread, 0.45, i % 3 ? fx.primary : fx.core, 0.9);
        }
        this.sparks.burst(at.x, 0.6, at.z, 14 + mp.level * 3, 3.0, fx.primary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 12, 1.4, 0.55, 1.0, BOG_SPORE, 0.4);
        this.dust.ring(at.x, TILE_TOP + 0.12, at.z, 8, 0.9, 0.45, 1.1, SMOKE_GREEN, 1.2);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.4 : 1.1;
        flash = 0.5;
        break;
      }
      case 'glacia': {
        // Shatter: the victim freezes and breaks: a frost ring and ice cracks, crystal shards flung
        // low, frost mist and a cold white flash.
        this.strike.ground(0, GROUND_MODE.crack, at.x, gy, at.z, 1.4, fx.secondary, fx.primary, 760, now);
        this.strike.ground(1, GROUND_MODE.ring, at.x, gy, at.z, 1.2, fx.core, fx.primary, 520, now);
        for (let i = 0; i < 14; i++) {
          const ang = i * 0.449 + seed;
          this.sparks.streak(at.x, 0.3, at.z, Math.cos(ang) * 2.3, 1.1 + (i % 4) * 0.45, Math.sin(ang) * 2.3, 0.5, i % 2 ? fx.core : fx.primary, 1.1);
        }
        this.sparks.burst(at.x, 0.75, at.z, 16 + mp.level * 3, 3.2, fx.secondary, seed);
        this.dust.ring(at.x, TILE_TOP + 0.08, at.z, 12, 1.5, 0.6, 0.9, FROST_MIST, 0.2);
        if (a.captured) (a.captured.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
        shake = this.reducedMotion ? 0.5 : 1.4;
        flash = 0.7;
        break;
      }
    }
    this.startCaptureFx(at, col, flash, now, shake, shakeMs);
    const act = a.captured?.actor;
    if (act?.has('hit')) act.play('hit', { once: true, hold: true, fade: 0.04, timeScale: Math.min(2.5, act.clipDuration('hit') / 0.45) });
    this.emitImpact(a.move);
  }

  /**
   * The mover stands on wasteland: the poison erupts under it (green flame ring, sparks, toxic
   * smoke), it shudders, then its token burns away from a green edge while it sinks in.
   */
  private tickWasted(a: RunningAnim, t: number, now: number): void {
    const v = a.mover;
    const fx = CHARACTER_FX.brutile;
    const p = a.to;
    if (!a.wasteFired) {
      a.wasteFired = true;
      a.landed = true;
      a.nextDust = 0;
      if (a.trail) this.strike.trailEnd();
      v.root.position.copy(a.to);
      v.inner.scale.set(1, 1, 1);
      v.inner.position.y = TILE_TOP;
      const gy = TILE_TOP + 0.012;
      this.strike.ground(0, GROUND_MODE.flame, p.x, gy, p.z, 0.95, fx.primary, WASTE_COLORS.curse, WASTE_DIE_MS + 160, now);
      this.strike.ground(1, GROUND_MODE.ring, p.x, gy, p.z, 0.9, fx.primary, fx.core, 420, now);
      this.sparks.burst(p.x, 0.35, p.z, 14, 2.6, fx.primary, now % 97);
      this.dust.ring(p.x, TILE_TOP + 0.06, p.z, 10, 1.0, 0.55, 0.9, SMOKE_GREEN, 0.2);
      this.dust.ring(p.x, TILE_TOP + 0.1, p.z, 6, 0.6, 0.45, 1.0, SMOKE_CURSE, 1.3);
      this.flashMat.color.set(fx.primary);
      this.flash.position.set(p.x, 0.5, p.z);
      this.flash.visible = true;
      this.tCap = now;
      (v.tokenMat.uniforms.uEdge.value as THREE.Color).set(fx.primary);
      const act = v.actor;
      if (act && this.units) {
        act.play('death', { once: true, hold: true, fade: 0.06, timeScale: act.clipDuration('death') / (WASTE_DIE_MS / 1000) });
        act.setDying(this.units.dyingMaterial(v.piece));
      }
    }
    const tk = t - a.moveDur;
    const k = clamp01(tk / WASTE_DIE_MS);
    const u = v.tokenMat.uniforms;
    u.uFlash.value = 0;
    const shudder = tk < 220 ? Math.sin(tk * 0.09) * 0.035 * (1 - tk / 220) : 0;
    v.token.position.set(shudder, TOKEN_Y - 0.06 * k, 0);
    u.uDissolve.value = clamp01((k - 0.12) / 0.88);
    const ts = 1 - 0.18 * easeOutCubic(k);
    v.token.scale.set(ts, 1, ts);
    const rs = Math.max(0.001, 1 - easeOutCubic(k));
    v.ring.scale.set(rs, 1, rs);
    const ps = Math.max(0.001, 1 - easeOutCubic(clamp01((k - 0.3) / 0.7)));
    v.puck.scale.set(ps, ps, ps);
    v.decal.scale.set(ps, 1, ps);
    if (v.actor && this.units) this.units.setDissolve(clamp01((k - 0.1) / 0.9));
    // A thin trail of rising toxic bubbles while it dissolves.
    if (tk >= a.nextDust) {
      a.nextDust = tk + 70;
      const ang = tk * 0.05;
      this.sparks.streak(p.x + Math.cos(ang) * 0.22, 0.2, p.z + Math.sin(ang) * 0.22, Math.cos(ang) * 0.5, 1.2, Math.sin(ang) * 0.5, 0.4, fx.primary, 0);
    }
  }

  /**
   * Signature take-off of a plain move (characters without a bespoke one above): a short burst in
   * the character's colours where it lifts off. One-shot pool effects, nothing per frame.
   */
  private takeoffFx(ch: CharacterId, p0: THREE.Vector3, jump: boolean, now: number): void {
    const fx = CHARACTER_FX[ch];
    const gy = TILE_TOP + 0.012;
    switch (ch) {
      case 'walk':
      case 'larhen':
        // A leap: a dust kick and a glint in the hero colour.
        this.dust.ring(p0.x, TILE_TOP + 0.04, p0.z, 8, 1.2, 0.42, 0.55, DUST, 0.3);
        this.strike.glint(p0.x, 0.8, p0.z, 0.75, fx.primary, 260, now);
        break;
      case 'insaner':
        this.strike.glint(p0.x, 0.85, p0.z, 0.8, fx.primary, 260, now);
        this.sparks.burst(p0.x, 0.45, p0.z, 6, 1.6, fx.secondary, now % 97);
        break;
      case 'marki':
        this.dust.ring(p0.x, TILE_TOP + 0.04, p0.z, 6, 0.9, 0.4, 0.5, DUST, 0.2);
        break;
      case 'michelle':
        this.strike.glint(p0.x, 0.75, p0.z, 0.7, fx.primary, 300, now);
        this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 6, 0.8, 0.38, 0.6, SMOKE_CURSE, 0.4);
        break;
      case 'picker':
      case 'verish':
        this.strike.glint(p0.x, 0.7, p0.z, 0.7, fx.primary, 240, now);
        break;
      case 'rampid':
        this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 8, 1.0, 0.4, 0.6, FROST_MIST, 0.3);
        this.strike.glint(p0.x, 0.7, p0.z, 0.7, fx.core, 260, now);
        break;
      case 'volkonov':
        this.strike.ground(1, GROUND_MODE.sigil, p0.x, gy, p0.z, 0.7, fx.primary, fx.secondary, 420, now);
        this.sparks.burst(p0.x, 0.5, p0.z, 6, 1.4, fx.secondary, now % 97);
        break;
      case 'midos':
        this.dust.ring(p0.x, TILE_TOP + 0.06, p0.z, 8, 0.9, 0.46, 0.7, SMOKE_CURSE, 0.6);
        this.strike.glint(p0.x, 0.8, p0.z, 0.75, fx.core, 280, now);
        break;
      case 'hammont':
        this.dust.ring(p0.x, TILE_TOP + 0.04, p0.z, 8, 1.1, 0.46, 0.6, SOOT, 0.2);
        for (let i = 0; i < 4; i++) {
          const ang = i * 1.57 + (now % 97);
          this.sparks.streak(p0.x, 0.2, p0.z, Math.cos(ang) * 0.6, 1.8 + i * 0.3, Math.sin(ang) * 0.6, 0.35, fx.primary, 0.8);
        }
        break;
      case 'venoa':
        this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 6, 0.8, 0.36, 0.6, BOG_SPORE, 0.4);
        this.strike.glint(p0.x, 0.7, p0.z, 0.65, fx.primary, 240, now);
        break;
      case 'glacia':
        this.strike.ground(1, GROUND_MODE.ring, p0.x, gy, p0.z, 0.75, fx.core, fx.primary, 380, now);
        this.dust.ring(p0.x, TILE_TOP + 0.05, p0.z, 8, 1.0, 0.42, 0.7, FROST_MIST, 0.2);
        break;
      default:
        if (jump) this.dust.ring(p0.x, TILE_TOP + 0.04, p0.z, 8, 1.2, 0.42, 0.55, DUST, 0.3);
    }
  }

  /** Signature touch-down of a slide that captured nothing: a small burst in the character's colour. */
  private landingFx(ch: CharacterId, at: THREE.Vector3, now: number): void {
    const fx = CHARACTER_FX[ch];
    const seed = now % 97;
    switch (ch) {
      case 'glacia':
      case 'rampid':
        this.dust.ring(at.x, TILE_TOP + 0.05, at.z, 8, 1.1, 0.42, 0.7, FROST_MIST, seed);
        this.sparks.burst(at.x, 0.35, at.z, 8, 1.6, fx.core, seed);
        break;
      case 'hammont':
        this.strike.ground(1, GROUND_MODE.crack, at.x, TILE_TOP + 0.012, at.z, 0.9, fx.primary, fx.secondary, 420, now);
        this.sparks.burst(at.x, 0.3, at.z, 8, 1.8, fx.primary, seed);
        break;
      case 'midos':
        this.dust.ring(at.x, TILE_TOP + 0.06, at.z, 8, 0.9, 0.46, 0.7, SMOKE_CURSE, seed);
        break;
      case 'brutile':
        break; // her own green ring below
      default:
        this.sparks.burst(at.x, 0.35, at.z, 6, 1.4, fx.primary, seed);
    }
  }

  private startLandFx(at: THREE.Vector3, hex: string, now: number): void {
    this.tLand = now;
    this.landMat.color.set(hex).lerp(this.tmpC.set('#ffffff'), 0.45);
    this.landRing.position.set(at.x, OVERLAY_Y + 0.002, at.z);
    this.landRing.visible = true;
  }

  /** Footstep / hoof dust behind a running unit. */
  private footstep(a: RunningAnim, t: number): void {
    if (a.mover.piece.character === 'brutile') {
      // Green sparkle trail: tiny glittering streaks drifting off the witch's path.
      a.nextDust = t + 45;
      const p = a.mover.root.position;
      const n = (t / 45) | 0;
      const side = n % 2 === 0 ? 1 : -1;
      const sx = -a.dirZ * side;
      const sz = a.dirX * side;
      const fx = CHARACTER_FX.brutile;
      this.sparks.streak(p.x + sx * 0.16 - a.dirX * 0.18, 0.32 + 0.1 * (n % 3), p.z + sz * 0.16 - a.dirZ * 0.18, sx * 0.7 - a.dirX * 0.4, 0.9, sz * 0.7 - a.dirZ * 0.4, 0.34, n % 3 === 0 ? fx.core : fx.primary, 0);
      if (n % 3 === 0) this.dust.emit(p.x - a.dirX * 0.25, TILE_TOP + 0.05, p.z - a.dirZ * 0.25, -a.dirX * 0.3, 0.25, -a.dirZ * 0.3, 0.32, 0.55, SMOKE_CURSE);
      return;
    }
    const bull = a.mover.piece.character === 'marki';
    a.nextDust = t + (a.jump ? 1e9 : bull ? 50 : 70);
    const p = a.mover.root.position;
    let dx = a.to.x - a.from.x;
    let dz = a.to.z - a.from.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const y = TILE_TOP + 0.03;
    if (a.jump) {
      this.dust.ring(p.x, y, p.z, 7, 1.1, 0.36, 0.5, a.rk === 'awake' ? SMOKE_RAK : a.rk === 'ash' ? ASH_DUST : DUST, 0);
      return;
    }
    const side = ((t / 70) | 0) % 2 === 0 ? 1 : -1;
    const lx = -dz * side * (bull ? 0.24 : 0.12);
    const lz = dx * side * (bull ? 0.24 : 0.12);
    const back = bull ? 0.35 : 0.12;
    this.dust.emit(p.x - dx * back + lx, y, p.z - dz * back + lz, -dx * 0.5 + lx, 0.35, -dz * 0.5 + lz, bull ? 0.6 : 0.36, bull ? 0.65 : 0.5, DUST);
    if (bull) {
      this.dust.emit(p.x - dx * back - lx, y, p.z - dz * back - lz, -dx * 0.5 - lx, 0.45, -dz * 0.5 - lz, 0.55, 0.6, DUST);
      if (a.mover.piece.level === 3) this.dust.emit(p.x - dx * back, y + 0.1, p.z - dz * back, -dx * 0.3, 0.9, -dz * 0.3, 0.2, 0.55, EMBER);
      if (a.charge) {
        // Charge: speed streaks streaming past the bull's flanks + a thicker dust wake.
        const n = (t / 50) | 0;
        for (let i = 0; i < 2; i++) {
          const side2 = i === 0 ? 1 : -1;
          const off = 0.3 + 0.12 * ((n + i) % 3);
          const h = 0.35 + 0.28 * ((n * 7 + i * 3) % 4);
          this.sparks.streak(p.x - dz * side2 * off - dx * 0.2, h, p.z + dx * side2 * off - dz * 0.2, dx * 4.5, 0, dz * 4.5, 0.16, '#FFE2B0', 0);
        }
        this.dust.emit(p.x - dx * 0.5, y + 0.05, p.z - dz * 0.5, -dx * 0.9, 0.5, -dz * 0.9, 0.75, 0.7, DUST);
      }
    }
  }

  /** Spawn-in for freshly created units: scale pop + white emissive flash (shared uniform). */
  private startSpawn(v: PieceVisual): void {
    if (!v.actor) return;
    if (this.tSpawn < 0) {
      this.tSpawn = performance.now();
      this.spawning.length = 0;
    }
    v.inner.scale.setScalar(0.001);
    this.spawning.push(v);
  }

  /** Generic strike flash + shock ring + debris burst in `col`, plus a camera shake. */
  private startCaptureFx(at: THREE.Vector3, col: string, flashTint: number, now: number, shakeAmp = 1, shakeMs: number = ANIM.shake): void {
    this.tCap = now;
    this.tShake = now;
    this.shakeAmp = shakeAmp;
    this.shakeMs = shakeMs;
    this.shockMat.color.set('#ffffff').lerp(this.tmpC.set(col), 0.8);
    this.shockRing.position.set(at.x, OVERLAY_Y + 0.003, at.z);
    this.shockRing.visible = true;
    this.flashMat.color.set('#ffffff').lerp(this.tmpC.set(col), flashTint);
    this.flash.position.set(at.x, 0.55, at.z);
    this.flash.visible = true;
    this.burstMat.color.set(col).lerp(this.tmpC.set('#ffffff'), 0.25);
    this.burstOrigin.set(at.x, 0.4, at.z);
    this.burst.visible = true;
  }

  /** Advance one-shot effects (landing pulse, capture flash/burst, shake, turn sweep). */
  private updateFx(now: number): boolean {
    let active = false;
    const dt = this.lastFx > 0 ? Math.min(0.05, Math.max(0, (now - this.lastFx) / 1000)) : 1 / 60;
    this.lastFx = now;
    if (this.dust.update(dt)) active = true;
    if (this.sparks.update(dt)) active = true;
    if (this.soulTarget) {
      const p = this.soulTarget.root.position;
      this.strike.setSoulTarget(p.x, 0.75, p.z);
    }
    if (this.strike.update(now, this.camera)) active = true;
    else this.soulTarget = null;
    if (this.rakFx.update(now)) active = true;

    if (this.tSpawn >= 0) {
      const el = now - this.tSpawn;
      let done = true;
      for (const v of this.spawning) {
        const delay = (v.piece.pos.c + (v.piece.owner === 0 ? v.piece.pos.r : BOARD_SIZE - 1 - v.piece.pos.r)) * 14;
        const k = clamp01((el - delay) / SPAWN_MS);
        if (k < 1) done = false;
        v.inner.scale.setScalar(Math.max(0.001, easeOutBack(k)));
      }
      if (this.units) this.units.uniforms.spawn.value = el < 650 ? Math.pow(1 - el / 650, 1.4) * 1.1 : 0;
      if (done && el >= 650) {
        for (const v of this.spawning) v.inner.scale.set(1, 1, 1);
        this.spawning.length = 0;
        this.tSpawn = -1;
        if (this.units) this.units.uniforms.spawn.value = 0;
      } else {
        active = true;
      }
    }

    if (this.tStormFade >= 0) {
      const k = (now - this.tStormFade) / STORM_MS;
      if (k >= 1) {
        for (const v of this.fading) this.removeVisual(v);
        this.fading.length = 0;
        this.tStormFade = -1;
        this.units?.setDissolve(0, 'storm');
      } else {
        active = true;
        const kk = Math.max(0, k);
        this.units?.setDissolve(clamp01((kk - 0.1) / 0.9), 'storm');
        for (const v of this.fading) {
          v.root.position.y = 0.16 * easeOutCubic(kk);
          v.tokenMat.uniforms.uDissolve.value = clamp01((kk - 0.1) / 0.9);
        }
      }
    }

    if (this.tLand >= 0) {
      const k = (now - this.tLand) / ANIM.pulse;
      if (k >= 1) {
        this.tLand = -1;
        this.landRing.visible = false;
      } else {
        active = true;
        const kk = Math.max(0, k);
        const s = 0.85 + 1.15 * easeOutCubic(kk);
        this.landRing.scale.set(s, 1, s);
        this.landMat.opacity = Math.min(1, 1.1 * (1 - kk) * (1 - kk));
      }
    }

    if (this.tCap >= 0) {
      const el = now - this.tCap;
      const kf = el / ANIM.flash;
      if (kf >= 1) {
        this.flash.visible = false;
      } else {
        active = true;
        const kk = Math.max(0, kf);
        const s = 0.5 + 1.9 * easeOutCubic(kk);
        this.flash.scale.set(s, s, 1);
        // A slightly softer white flash in the top-down view keeps the character FX colours.
        this.flashMat.opacity = (1 - kk) * (this.topOnly ? 0.8 : 1);
      }
      const ks = el / (ANIM.capture + 90);
      if (ks >= 1) {
        this.shockRing.visible = false;
        this.burst.visible = false;
        this.tCap = -1;
      } else {
        active = true;
        const kk = Math.max(0, ks);
        const e = easeOutCubic(kk);
        const sr = 0.6 + 2.0 * e;
        this.shockRing.scale.set(sr, 1, sr);
        this.shockMat.opacity = 0.9 * (1 - kk);
        this.updateBurst(kk);
      }
    }

    if (this.tShake >= 0) {
      const k = (now - this.tShake) / this.shakeMs;
      if (k >= 1) {
        this.tShake = -1;
        if (this.shaking) {
          this.camera.position.copy(this.camBase);
          this.shaking = false;
        }
      } else {
        active = true;
        const kk = Math.max(0, k);
        const ox = shakeOffset(kk, 0) * this.pxWorld * this.shakeAmp;
        const oy = shakeOffset(kk, 1) * this.pxWorld * this.shakeAmp;
        this.camera.position
          .copy(this.camBase)
          .addScaledVector(this.camRight, ox)
          .addScaledVector(this.camUp, oy);
        this.shaking = true;
      }
    }

    if (this.tTurn >= 0) {
      const k = (now - this.tTurn) / ANIM.turn;
      if (k >= 1) {
        this.tTurn = -1;
        this.comet.visible = false;
        this.applyZoneLines(0);
      } else {
        active = true;
        const kk = Math.max(0, k);
        const boost = Math.sin(Math.PI * kk);
        this.applyZoneLines(boost);
        const id = this.turnFxPlayer;
        const e = easeInOutCubic(kk);
        const x0 = -HALF - 1.8;
        const x1 = HALF + 1.8;
        const dirX = id === 0 ? 1 : -1;
        this.comet.visible = true;
        this.comet.scale.x = dirX;
        this.comet.position.set(dirX > 0 ? x0 + (x1 - x0) * e : x1 + (x0 - x1) * e, OVERLAY_Y + 0.003, ZONE_LINE_Z[id]);
        this.cometMat.color.set(TEAM_COLORS[id].light);
        this.cometMat.opacity = Math.sin(Math.PI * kk);
      }
    }
    return active;
  }

  private updateBurst(k: number): void {
    const e = easeOutCubic(k);
    const b = this.burstOrigin;
    for (let i = 0; i < BURST_COUNT; i++) {
      const d = this.burstDirs[i];
      this.tmpV.set(b.x + d.x * e * 0.8, b.y + d.y * e * 0.6 - k * k * 0.5, b.z + d.z * e * 0.8);
      const s = 1 - k * 0.7;
      this.tmpM.makeScale(s, s, s).setPosition(this.tmpV);
      this.burst.setMatrixAt(i, this.tmpM);
    }
    this.burst.instanceMatrix.needsUpdate = true;
    this.burstMat.opacity = 1 - k;
  }

  /** Jump the running animation (if any) to its end state and resolve it. */
  private finishAnimation(natural: boolean): void {
    this.finishSkill();
    const a = this.anim;
    if (!natural) this.clearFx();
    if (!a) return;
    this.anim = null;
    try {
      this.settleAnimation(a, natural);
    } finally {
      a.resolve();
    }
  }

  /** The end state of a finished (or cut short) move: see finishAnimation. */
  private settleAnimation(a: RunningAnim, natural: boolean): void {
    a.mover.inner.scale.set(1, 1, 1);
    a.mover.token.scale.set(1, 1, 1);
    if (a.trail) this.strike.trailEnd();
    if (a.captured) this.removeVisual(a.captured);
    if (a.hop) {
      for (const v of a.hop.victims) {
        if (v.visual) this.removeVisual(v.visual);
        // onImpact fires once per victim, even if the hop is cut short.
        if (!v.fired) {
          v.fired = true;
          if (!this.disposing) this.emitImpact({ ...a.move, captureId: v.id });
        }
      }
    }
    if (a.wasted && this.visuals.get(a.mover.piece.id) === a.mover && !a.piecesAfter.some((p) => p.id === a.mover.piece.id)) {
      // Destroyed on the wasteland: drop it here (never a storm fade / pop-out).
      this.visuals.delete(a.mover.piece.id);
      this.removeVisual(a.mover);
      this.units?.setDissolve(0);
    }
    // onImpact fires exactly once per capturing move, even if the animation is cut short.
    if (a.capture && !a.impactFired) {
      a.impactFired = true;
      if (!this.disposing) this.emitImpact(a.move);
    }
    if (a.mover.actor) {
      if (!natural) a.mover.actor.face(a.mover.actor.facing, 0);
      a.mover.actor.idle(natural ? 0.2 : 0);
    }
    // A transformed mover whose transform ran out with this move fades back instead of popping.
    this.syncPieces(a.piecesAfter, true, natural ? a.mover.piece.id : null);
    this.requestRender();
  }

  /** Hide all one-shot effects immediately (state is reset, e.g. by setPieces mid-animation). */
  private clearFx(): void {
    this.tLand = -1;
    this.tCap = -1;
    this.tShake = -1;
    this.tTurn = -1;
    this.landRing.visible = false;
    this.shockRing.visible = false;
    this.flash.visible = false;
    this.burst.visible = false;
    this.comet.visible = false;
    this.dust.clear();
    this.sparks.clear();
    this.strike.clear();
    this.rakFx.clear();
    this.soulTarget = null;
    this.units?.setDissolve(0);
    if (this.tSpawn >= 0) {
      for (const v of this.spawning) v.inner.scale.set(1, 1, 1);
      this.spawning.length = 0;
      this.tSpawn = -1;
      if (this.units) this.units.uniforms.spawn.value = 0;
    }
    if (this.shaking) {
      this.camera.position.copy(this.camBase);
      this.shaking = false;
    }
    this.applyZoneLines(0);
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
    const pos = this.pick(ev.clientX, ev.clientY);
    if (pos) this.cellCb(pos);
  };

  private readonly onPointerCancel = (): void => {
    this.down = null;
  };

  private readonly onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault(); // allow restoration
    this.cancelFrames();
    // No frames are guaranteed until the context comes back (it may never): settle any running
    // move animation now so the game (which awaits animateMove) cannot stall in 'animating'.
    this.finishAnimation(false);
    this.settleAwaken();
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    // The arena canvases were freed after their first upload: repaint them for the new context.
    if (this.topOnly) {
      const { w, h } = containerSize(this.container);
      this.paintArena(w, h, true);
    }
    // The Rakaeli FX canvases were freed after upload too.
    this.awakenMarks.restore();
    this.rakFx.restore();
    this.requestRender();
  };

  /**
   * Screen point -> board square. Forgiving: tapping a piece's body selects its square, except
   * when the plane hit is itself a highlighted move/capture target (so tall pieces never hide
   * a destination square behind them).
   */
  private pick(clientX: number, clientY: number): Pos | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pickNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pickNdc, this.camera);

    let planePos: Pos | null = null;
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, this.tmpV);
    if (hit) {
      const c = Math.round(hit.x + HALF);
      const r = Math.round(HALF - hit.z);
      const edge = HALF + 0.5 + SLAB_MARGIN * 0.6;
      if (Math.abs(hit.x) <= edge && Math.abs(hit.z) <= edge) {
        planePos = { r: Math.min(BOARD_SIZE - 1, Math.max(0, r)), c: Math.min(BOARD_SIZE - 1, Math.max(0, c)) };
      }
    }
    if (planePos) {
      const k = posKey(planePos);
      // Top-down: tokens lie flat on their squares, so the square under the finger is exact.
      if (this.viewT > 0.5 || this.hi.moves.has(k) || this.hi.captures.has(k)) return planePos;
    }

    // Then the unit actually drawn under the finger (front-most along the ray): a tall unit in
    // front of another piece's square takes the tap, matching what the player sees. Only close
    // to its own square, so a unit never steals a tap meant for a square far behind it.
    this.pieceLayer.updateMatrixWorld(); // proxies may not have been rendered since the last sync
    this.pickList.length = 0;
    for (const v of this.visuals.values()) this.pickList.push(v.proxy);
    const hits = this.raycaster.intersectObjects(this.pickList, false);
    this.pickList.length = 0;
    for (const h of hits) {
      const id = h.object.userData.pieceId as string | undefined;
      const v = id ? this.visuals.get(id) : undefined;
      if (!v) continue;
      if (hit) {
        // A tap on the head reaches the ground `height * slope` behind the unit (camera tilt);
        // anything further away is a tap meant for another square.
        const dir = this.raycaster.ray.direction;
        const slope = Math.hypot(dir.x, dir.z) / Math.max(0.05, Math.abs(dir.y));
        const d = Math.hypot(hit.x - v.root.position.x, hit.z - v.root.position.z);
        if (d > 0.6 + v.proxy.scale.y * slope * 1.05) continue;
      }
      return { ...v.piece.pos };
    }
    return planePos;
  }
}
