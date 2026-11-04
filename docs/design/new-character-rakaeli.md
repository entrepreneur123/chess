# New character: 라카엘리 (Rakaeli) — owner spec, 2026-11-04

This spec is binding. Items marked **(lead default)** are decisions the owner did not state; they
are listed again at the end for confirmation. Directions ("forward", "back", "left", "right")
follow the piece's own direction (`pieceDir`), like every other character.

## Identity
- **Id** `rakaeli`, **name** 라카엘리 / Rakaeli, **rarity** 영웅 (epic).
- **Look:** a beautiful, pale young man; a blindfolded fallen angel turned demon.
  - The owner's mood reference is MapleStory's Damian. **Take the mood only.** Never copy
    Damian's design, hair, horns, sword, costume or colour scheme. Avoid the white-haired
    blindfold look too (Jujutsu Kaisen's Gojo).
  - **Lead design (original):**
    - Base form:
      - midnight-black tousled hair;
      - a black silk blindfold over both eyes, with long ribbon tails;
      - a cracked, dimmed golden halo;
      - folded ash-grey feathered wings with a few torn feathers;
      - a long black-and-bone-white priestly coat with a torn hem, and broken chain cuffs;
      - no weapon.
    - Transformed form ("타천"):
      - the blindfold burns away and shows glowing crimson eyes;
      - two short obsidian horns;
      - wings blown wide, black feathers edged with crimson flame;
      - the halo becomes a broken crimson ring;
      - glowing red cracks on the skin;
      - a crimson and violet aura;
      - still no weapon.
- **Voice:**
  - Base form: a soft, calm, melancholic young male voice (a pretty-boy timbre, late teens).
  - Transformed form: clearly different. The same young man, but deeper and colder, with a
    demonic doubled or layered quality. Different lines from the base form.

## Movement
"Jump" means the same as Walk's: the piece lands directly on the square, pieces in between never
block it, and it captures an enemy on the landing square. It cannot land on its own piece.
Wasteland, doll traps and the storm apply to the landing square exactly as they do for Walk.

### Base form
| Grade | Squares (f = 1 row forward, b = 1 row back; columns relative to the piece) |
| --- | --- |
| 1성 | f × {−1, 0, +1}: 3 squares (forward, forward-left, forward-right) |
| 2성 | rows f and 2f × columns −1..+1: a 2-deep, 3-wide block in front (6 squares) |
| 3성 | the 2성 block plus 1 square straight back (7 squares) |

### Transformed form (while `awaken > 0`)
| Grade | Squares |
| --- | --- |
| 1성 | f × columns −2..+2: Walk 1성's 5-square front row |
| 2성 | rows f and 2f × columns −2..+2: a 2-deep, 5-wide block (10 squares) |
| 3성 | rows f, 2f and 3f × columns −2..+2 (15 squares), plus 1 square straight back (16 squares) |

### Movement rules
- **Direction.** He is a forward mover, so he turns around at the far edge like Walk and Marki
  (`keepsDirection` is false for him).
- **Insaner.** If 인세이너 captures 라카엘리, he absorbs the **base** pattern at Rakaeli's grade,
  never the transformed one. **(lead default)**

## Skill: 타천 (transform)
- **Effect.** Using the skill is the player's whole action for that turn. He transforms for **3
  of his owner's turns**, and the casting turn counts as the first. So he makes exactly **2**
  transformed moves, on his owner's next 2 turns, and then turns back.
- **Engine model.**
  - `Piece.awaken?: number`. On cast it is set to `AWAKEN_TURNS` = 3.
  - Like `stun`, it counts down by one at the end of each of the owner's turns (in
    `switchTurn`), so it reads 2 right after the cast. When it reaches 0 the field is deleted.
  - The number shown to players is `awaken`, which is the number of transformed moves left
    (2, then 1).
- **Action shape.**
  - It reuses `SkillAction`, with `anchor` = his own square (the only legal anchor).
  - The history entry is `{ kind: 'skill', ..., squares: [], transform: true }`. Add the
    optional `transform?: true` to that union member; Brutile's entries stay as they are.
- **When it can be used.** The same gates as Brutile's skill:
  - not before `SKILL_UNLOCK_PLY`;
  - not during a chain move;
  - not while stunned;
  - not once the storm has started (storm ≥ 1). **(lead default:** one skill rule for every
    skill, so the copy stays simple.)
  - It cannot be cast while already transformed.
- **Uses: once per match per skill character. (lead default)**
  - Today `skillsUsed` is counted per side and `SKILL_USES_PER_MATCH` = 1. With two skill
    characters in a squad (브루타일 + 라카엘리) a per-side limit would make the player choose
    one, which is not obvious from the UI.
  - Track use per piece instead: add `Piece.skillUsed?: true`. Block with 'used' when it is
    set.
  - Keep `skillsUsed` as a per-side count for the UI and stats.
  - Update every consumer that reads `skillsUsed` as "this side's skill is spent": `fast.ts`,
    `bot.ts`, `fieldPanel.ts` and `game.ts`.
- **Stun and storm while transformed.**
  - A stun does not pause the countdown: a stunned transformed turn is a lost transformed move.
  - The storm does not end the transformation.
- **Lost turns.** `settle` and `sideCanCast` must loop over **every** skill piece, not just the
  first one found.
  - A transform is always castable when unblocked; its anchor is his own square.
  - So a side whose only piece is a boxed-in, untransformed Rakaeli with the skill unused is not
    passed; casting is its turn.

## AI
- **Fast engine** (`fast.ts`):
  - `rakaeli` needs a char code (`CH_RAKAELI` = 7), base and transformed target generation, an
    awaken counter per piece, a per-piece skill-used flag, and the transform skill as a skill
    move with anchor = own square.
  - Absorb masks then use 24 bits, which is fine.
- **Bot** (`bot.ts`):
  - Evaluate casting the transform against moving, using the transformed reach (it threatens
    far more squares).
  - The transform should be used when it creates threats or captures within its 2 moves.
- **Values.** Start from `value: [4, 6, 7]` (epic; Walk is [4, 6, 8]). Tune with bot self-play.
  A transformed piece is worth more in evaluation while `awaken > 0`.
- **Performance.** The move-time budget must not regress: hard's max stays near 1 s.

## Progression
- He opens in **arena 6 (천공의 정점 · apex)**, the empty slot, for 100 essence (epic).
  **(lead default)**
- Upgrades follow rarity: 20 tokens, then 150.
- Profile: a v5 profile without the key loads with `owned.rakaeli = 0`. Do not reset anything.
- He joins the dungeon and AI pools like everyone else, through the arena pool rules.

## UI
- **Character info everywhere the others have it.** Per-grade descriptions for both forms; the
  skill name and copy; the collection, hand cards, field panel, tutorial roster and shop.
- **Movement diagrams.** Show the base pattern, and the transformed pattern as a second diagram
  (or a toggle) labelled 타천.
- **Skill button.** One tap, then a confirm. There is no target to pick: the transform uses his
  own square.
- **While transformed:**
  - the board token switches to the transformed face art;
  - it carries a clear aura and a **countdown badge** with the transformed moves left (2, 1);
  - the hand card shows the transformed art and "타천 · N";
  - reach previews use the transformed pattern.
- **Turning back.** When the transformation ends, a short revert effect and voice line play.
- **Coach toast** the first time a transform happens in a match: "라카엘리 타천: 2번 이동하는
  동안 범위 확장".

## Board render (WebGL `BoardView` and 2D `Board2DView`)
- **Transform-in FX:**
  - the blindfold-burn flash;
  - crimson flame wings unfolding (a sprite or particle burst);
  - a short screen pulse;
  - the token swaps to the awake face at the peak.
- **While transformed:** an idle aura with flickering crimson embers, plus the countdown badge.
- **Transformed move and capture.** These need their own trail and impact, different from every
  other character's (for example, a crimson feather trail and a dark-flame impact).
- **Revert FX:** the embers fade, a smoke puff, and the token swaps back to the base face.
- **Reduced motion:** short fades only.
- **Missing assets.** If the awake face fails to load, fall back to the base face with a crimson
  tint.

## Assets
- **Card art:** `public/chars/rakaeli-lv{1,2,3}.jpg` (540×720) and `-face.jpg` (320×320).
- **Transformed art:** `public/chars/rakaeli-awake-lv{1,2,3}.jpg` and `-face.jpg`.
- **Masters:** `docs/brand/illust/illust-rakaeli-lv{n}.jpg` and
  `illust-rakaeli-awake-lv{n}.jpg`, produced through `process-illust.py`, with one `FACE` box per
  form.
- **Voice** (`src/audio/voice.ts` VoiceEvent):
  - Base form: `select`, `move`, `capture`, `skill` (the transform cast, which should be the most
    dramatic line), `death`, `victory`.
  - Transformed form: `awake-select`, `awake-move`, `awake-capture`, `awake-death`, `awake-end`
    (turning back).
  - Each `awake-*` event falls back to the base event of the same name, and `awake-end` falls
    back to `move`.
- **SFX:** `skill` (the transform), `awake-move`, `awake-capture`, `awake-end`, plus the base
  `move` and `capture`.

## Decisions to confirm with the owner
1. Rakaeli's moves are jumps, like Walk's.
2. One skill use per skill character per match, instead of one per side.
3. The transform cannot be cast once the storm has started, the same rule as Brutile.
4. Insaner absorbs only the base pattern.
5. He opens in arena 6 (apex) for 100 essence.
6. The design is original: a black-haired, blindfolded fallen angel, with horns and flame wings
   only when transformed, and no weapon.
