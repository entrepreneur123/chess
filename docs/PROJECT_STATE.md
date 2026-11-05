# GRID CLASH: project state (read this first)

A compressed hand-off of everything built so far, for the next session. Numbers below were read
from the code on 2026-11-04 (commit after `6a63286`). **The code is the source of truth:**
re-check `src/engine/types.ts`, `src/engine/characters.ts` and `src/meta/progression.ts` before
quoting a number.

## 1. What it is
- **The game.** An original ability-chess mobile game (Korean UI) by the owner (a game designer who
  writes the rules in Korean).
- **Gameplay.** 10×10 board; each side fields 3 distinct characters in its 2×10 home zone.
- **Opponents.** You play AI opponents, always labelled "AI": there is no online backend yet.
- **Live:** https://tactics12.vercel.app.
- **Repo:** `entrepreneur123/chess`. The branch is `claude/exciting-einstein-548y77`; every
  deploy is pinned to a SHA of this branch.
- **Working rules:** `CLAUDE.md`.
  - Work without interruption.
  - Code, comments and commits in English; reports to the owner in Korean.
  - UI and marketing appeal come first.
  - Never report unverified claims.
  - tsc, vitest and build must be green before committing.

## 2. Stack and layout
- **Stack:**
  - Vite 8, TypeScript strict, vanilla DOM via `h()` (`src/ui/dom.ts`), Vitest;
  - Capacitor 8 (Android shell);
  - three.js for the WebGL board (top-down only; the 3D view is shelved).
- **Packages:**
  - **`src/engine/`**: the pure rules.
    - `types.ts`: constants and the shared types.
    - `characters.ts`: definitions, ranges, values and descKo.
    - `board.ts`: `genTargets` (the one move generator).
    - `rules.ts`: apply/settle, skills, storm, traps, transform and `isDirectional`.
    - `fast.ts`: the FastBoard used by the bot; it must match rules.ts, and parity tests check it.
    - `formation.ts`.
  - **`src/ai/`**: `bot.ts` (search and evaluation, `fallbackAction`), `bot.worker.ts` and
    `botClient.ts`. A failed worker falls back to the main thread.
  - **`src/meta/`**:
    - `profile.ts`: localStorage, schema v5, `devMode`.
    - `progression.ts`: currencies, arenas, prices.
    - `opponent.ts`: AI matchmaking.
    - `rng.ts`: `coinFlipFirst`.
  - **`src/render/`**:
    - the two boards: `BoardView.ts` (WebGL) and `Board2DView.ts` (Canvas2D fallback);
    - `index.ts` (`createBoardView`, fallback logic);
    - `arenaThemes.ts` and `ambient.ts` (per-arena board looks);
    - `storm.ts`, `trapFx.ts`, `awakenFx.ts`;
    - `diag.ts` (the `?diag=1` panel);
    - `dev/boardlab.ts` (a dev-only visual lab).
  - **`src/ui/`**:
    - screens: lobby, collection, formation, shop, arenas, matchmaking, game;
    - `game/GameController.ts`: the turn flow, clock and watchdog;
    - `game/hand.ts`, `hud.ts`, `fieldPanel.ts`, `cutin.ts`;
    - components: sheets, toasts, the settings sheet, the tutorial.
  - **`src/audio/`**: `sfx.ts` (the shared AudioContext and unlock), `music.ts` (BGM loops),
    `voice.ts` and `voiceManifest.ts` (generated).
- **Assets:**
  - `public/chars/<id>-lv{1,2,3}.jpg` and `-face.jpg`, plus `rakaeli-awake-*`;
  - `public/arenas/<id>/{bg,card}.webp`;
  - `public/audio/{bgm,vo,sfx}`.
- **Asset pipelines (all documented in their READMEs):**
  - art: `docs/brand/illust/` (Magic Patterns `generate_image`, then `process-illust.py`);
  - voices: `docs/brand/audio/` (Qwen3-TTS clone, `post_voice.py`);
  - BGM: `docs/brand/audio/bgm/` (FluidSynth scores, `audit_bgm.py`).
- **Design docs:** `docs/design/`: progression, Michelle/Picker, Rakaeli, v6 UI, arena style.
  Their "(lead default)" items are unconfirmed choices.

## 3. Current rules (from the code)
**Board and turns**
- `BOARD_SIZE` 10, `ZONE_DEPTH` 2, `PIECES_PER_SIDE` 3.
- Player 0 (me) is at the bottom: rows 0–1 move toward row 9.
- The first player is random 50/50 (`coinFlipFirst`). It is shown on the VS card and in the start
  banner.
- `turnNumber` = floor(ply / 2) + 1.

**Turn time**
- 45 s per turn; 40 s once either side has 2 or fewer pieces; 20 s at 1 piece.
- Running out forfeits at once.
- The clock is wall-clock (Date.now deadline). It KEEPS running when the app or tab is hidden,
  and is re-checked on return.
- The bot keeps playing while the page is hidden.

**Turning around**
- Forward movers turn around when they reach the real far edge.
- Sad and Picker never turn (`keepsDirection`).
- A storm row is not an edge, so a piece cannot turn there.

**Storm (자기장)**
- **Start:** at turn 20 (`SUDDEN_DEATH_PLY` 38), or as soon as a side is down to 1 piece.
- **Shrink:** every 2 turns (`STORM_INTERVAL_PLIES` 4).
- **Which squares close:**
  - each step closes one outer column on both sides;
  - from step 3 (`STORM_ROWS_FROM`) it also closes rows from the top and bottom, max(0, step − 2)
    per end.
  - Step 5 covers the whole board, so `MAX_MATCH_PLIES` = 38 + 5×4 = 58 (29 turns).
- **Storm squares:** a piece on one is removed. Nothing may enter or pass through a storm square.
- **Both sides wiped in one step:** the side that had MORE PIECES wins. Rarity and grade are
  ignored; equal counts are a draw.
- **Must act every turn (`immobile`, owner rule):** at ANY point of the match, a side to move
  with no legal move and no castable skill LOSES at once. Exceptions:
  - a side that has no moves only because of a doll-trap stun is passed ('stunned');
  - a chain move that cannot be played just lapses.
- There is no stalemate any more: the side to move loses first.

**Skills**
- Each skill character may use its skill once per match (`Piece.skillUsed`).
- Skills unlock at ply 6 (each side's 4th turn).
- No skill during the storm (storm ≥ 1), during a chain move or while stunned.

**Characters**

| Character | Rarity | 1성 / 2성 / 3성 movement | Special |
| --- | --- | --- | --- |
| 사드 sad | common | orthogonal slide 1 / 2 / 3 | never turns |
| 마르키 marki | rare | forward slide 3 / 4 / 5; 3성 adds left/right 1 | turns at the edge |
| 월크 walk | epic | jump to the front row, width 5 / 7 / 9 | |
| 인세이너 insaner | legendary | orthogonal 2 / 3 / 3 (no diagonal at any grade) | see below |
| 브루타일 brutile | legendary | forward diagonals 1; 2성 + back 1; 3성 all 8 around | skill 불모지 |
| 미셸 michelle | common | left/right/back 1 / ≤2 / ≤2; forward 0 / 1 / ≤2 (slides) | trait 인형 함정 |
| 피커 picker | rare | diagonal 1 / 2 / 3 | trait 콩콩 |
| 라카엘리 rakaeli | epic | jumps: front 1×3; 2×3; 2×3 + back 1 | skill 타천 |
| 램피드 rampid | common | claw slide (forward + both forward diagonals) 1 / 2 / 3 | turns at the edge |
| 라르헨 larhen | common | jumps: left/right 1 + forward diagonals 1; 2성 + back diagonals (H); 3성 the H one row taller (side columns ±2 rows too) | |
| 볼코노프 volkonov | common | orthogonal slide 1 / 2 / 2 | skill 선율; never turns |
| 베리쉬 verish | rare | slides: left/right 1 + forward 2; left/right 2 + forward 2; left/right 2 + forward 3 + back 1 | trait 관통 |

- **인세이너:**
  - Capturing absorbs the victim's MOVEMENT PATTERN only, never traits or skills. An absorbed
    Picker is a plain blocked diagonal slide.
  - 3성: after a capture he moves once more; this happens once per turn and never chains.
- **브루타일 불모지:** lays wasteland of 1×1 / 2×2 / 3×3 on empty squares. A piece that touches
  wasteland dies.
- **미셸 인형 함정:**
  - Her first 3 backward moves leave a permanent doll trap. "Backward" is judged by her direction
    before the move.
  - An enemy that lands on a trap is stunned for its owner's next turn.
- **피커 콩콩:** hops square by square, is never blocked, captures every enemy on the path, and
  stops at an enemy trap.
- **라카엘리 타천:**
  - Casting takes the turn. He then makes 2 moves transformed (`Piece.awaken` 3 → 2 → 1).
  - Transformed reach: front 1×5; 2×5; 3×5 + back 1.
  - Insaner absorbs only his base pattern.
- **베리쉬 관통 (2026-11-05):** each lane is a slide that captures and passes every enemy on it
  (`canHop`, like Picker's hop but straight lines); her own piece, wasteland (she never enters it),
  the edge and the storm stop her before the square; doll traps do not stop her (only the landing
  catches). Insaner absorbs her lanes as a plain slide. Boards play her move square by square,
  flat and fast (`hopTimingFor`).
- **볼코노프 선율 (2026-11-05):**
  - Casting takes the turn; anchor = his own square; needs at least one other piece of his side
    (`SkillBlock` 'alone').
  - Every OTHER piece of his side gets `Piece.buff` = BUFF_TURNS[level] + 1 (3 / 3 / 4 turns),
    counted down at the end of each of its owner's turns like `awaken`; a stun does not pause it.
  - A buffed piece moves 1 square further in each orthogonal direction than its pattern reaches
    there (`orthoReach`, measured on an empty board), or 1 where it reaches nowhere, as a plain
    slide (blocked, captures the blocking enemy, ends on wasteland). Never absorbed by Insaner.
  - UI: a rose "♪ N" badge on the board (DOM layer, `ui/game/melodyFx.ts`), a "선율 · N턴" band and
    the extra squares in the hand card's diagram, `is-buffed` on enemy roster chips.
- **Owner-brief interpretations (decided by the lead on 2026-11-05; the owner asked for no more
  questions on these):** Larhen's back diagonals arrive at 2성 (the brief said "일성에서", which would
  make 1성 and 2성 identical); his 3성 keeps the four diagonals (an H); the melody buffs the other
  pieces only, not Volkonov himself; all three are common (일반); unlocks in arenas 2 / 3 / 4.
  Larhen 3성 was later changed by the owner to the taller H (the 5-wide row is gone).
- **Absorb masks:** 2 bits per character code holding the highest absorbed level (`absorbMerge`);
  exact because every pattern contains its lower grades (checked in `tests/commons3.test.ts`).
  Room for 15 character codes.
- **Values (bot material):**

  | Character | Values (1성 / 2성 / 3성) |
  | --- | --- |
  | sad | 3/4/5 |
  | marki | 3/4/6 |
  | walk | 4/6/8 |
  | insaner | 5/6/8 |
  | brutile | 4/6/8 |
  | michelle | 3/4/5 |
  | picker | 3/5/7 |
  | rakaeli | 4/6/7 |
  | rampid | 3/4/5 |
  | larhen | 3/4/5 |
  | volkonov | 3/4/5 |
  | verish | 3/5/7 |

- **Direction arrows:** shown when the reach depends on direction (`isDirectional`). Sad, Picker, Volkonov, 2성+ Larhen,
  3성 Brutile and an Insaner without directional absorbs show none.

## 4. Progression (all localStorage; editable by the player, no server)
**Currencies**
- **Tokens:** from the daily dungeon only. One win reward per day: 쉬움 5 / 보통 10 / 어려움 15 /
  극악 20. A loss keeps the chance.
- **Essence:** win 3 / draw 1 / loss 0, with no cap.

**Prices**

| Rarity | Upgrade 1→2 / 2→3 (tokens) | Unlock (essence) |
| --- | --- | --- |
| common | 5 / 50 | 30 |
| rare | 10 / 100 | 50 |
| epic | 20 / 150 | 100 |
| legendary | 50 / 300 | 200 |

**Arenas (rating)**

| # | Arena | Rating | Win + | Loss − | Unlocks |
| --- | --- | --- | --- | --- | --- |
| 1 | moonrune 달빛 룬 투기장 | 0–300 | 29–31 | 5–7 | sad, marki, walk (starters) |
| 2 | emberforge | 301–600 | 25–29 | 10–14 | brutile, volkonov |
| 3 | blightmire | 601–1000 | 20–22 | 15–17 | insaner, larhen |
| 4 | frostkeep | 1001–1500 | 18–22 | 17–20 | michelle, rampid |
| 5 | madcrown | 1501–2000 | 15–17 | 19–21 | picker, verish |
| 6 | apex | 2001+ | 14–16 | 20–22 | rakaeli |

**Modes**
- **전장전 (ranked):** opponent band ±60, clamped to the arena.
- **견습전투 (casual):** band ±150, no rating change.
- **던전 (dungeon).**

**AI strength by arena:** arena 1 easy, 2–3 normal, 4–5 hard, 6 extreme. 극악 fields every
legendary.

**Each arena has its own look and sound:**
- BGM (`public/audio/bgm/<id>.m4a`);
- the match backdrop;
- the board theme (`arenaThemes.ts`).
- The lobby and tab screens play a separate `lobby` theme (Eb major). Matches crossfade to the
  arena track at the VS reveal.

**Developer mode**
- **Unlock:** tap the version label at the bottom of settings 7 times in 2 s.
- **Effect:**
  - currencies pinned at 999,999 (shown as ∞);
  - rating 10000;
  - every character at 3성;
  - a DEV chip;
  - a lobby "DEV · 전장 선택" picker that plays any arena.
- **Off:** restores the snapshot of the real profile (current settings kept).

**절전 모드 (settings.powerSave, off by default)**
- A settings switch (`ui/powerSave.ts`): `html.power-save` stops the decorative CSS loops
  (`base.css`), and the board (`setLowPower`) stops its decorative idle loops (particles, scan
  sweep, shimmer, selection pulse) and draws moves at ~30 fps. The storm keeps animating (it is
  game information).

## 5. Deploy and verify (the routine)
1. **Gates:** `npx tsc --noEmit -p .`, `npx vitest run` (403 tests at last count) and
   `npm run build`.
   - Never leave temporary `tests/*.tmp.test.ts` or `zz-*` files; `node:` imports break tsc.
   - Vitest hides `console.log` from passing tests, so simulations write results to files.
2. **Commit and push** to the branch. The stop hook demands a clean tree, so work in progress is
   committed as `wip: … (not deployed)`.
3. **Deploy** with `mcp__Vercel__create_deployment`:
   - teamId `team_HKMkmzQNFo2UjOkkJWqlvD5Z`, `skipAutoDetectionConfirmation` "1";
   - requestBody: name/project `tactics12`, gitSource github `entrepreneur123/chess`, the branch
     as ref, the commit SHA, target `production`.
4. **Wait for the switch:** poll https://tactics12.vercel.app/ until the index references the
   new `main-*.js`. The local `dist/` name is the same as the live one.
5. **Live flows:** `node scripts/e2e-flow.cjs <base> <W> <H> <tag>` (tutorial → tabs → match →
   resign → result; screenshots go to `/tmp/e2e-<tag>-*.png`). Expect `errors []` at 390×844,
   360×640 and 1180×820.
6. **Playwright:** only the pre-installed Chromium. Never run `playwright install`; there is no
   WebKit here, so iOS Safari is always unverified.
7. **Never use `pkill -f`**; kill processes by PID or port.

**Heat / battery budget (measure before and after any render or CSS change)**
- Rules that keep the device cool:
  - no requestAnimationFrame loop for DOM UI: the HUD clock is a paced timer
    (`Disposables.pacedLoop`, `clockRedrawMs`, ~5–12 updates/s);
  - looping CSS animations use `transform` / `opacity` only (compositor); never `left`, `box-shadow`,
    custom properties or filters in an infinite animation (use an opacity cross-fade on a
    pseudo-element instead, see `.hand-card__skill.is-ready`, `.storm-chip.is-soon`);
  - the board draws on demand: idle loops are throttled (ambient drift ~10–20 fps by theme via
    `ambientFrameMs`, light loops ~30 fps) and sleep on a timer between draws; moves draw at most
    every ~10 ms (120 Hz displays every other refresh); any change still draws on the next frame;
  - the result dialog pauses the board (`setPaused`): no full-screen re-blur under the scrim.
- How it was measured (headless Chromium, software GL, idle match, 12 s): requestAnimationFrame
  callbacks 120/s → 29/s, board frames 21/s → 14/s, main thread 379 → 239 ms/s; result screen
  board frames 23/s → 0; 2D board main thread 232 → 116 ms/s; 절전 모드 idle match 7 ms/s;
  lobby and collection main thread 3.9% / 5.8% → ~0% (no per-frame style recalcs). Real-device
  temperatures were not measured.

**Debug aids**
- `?diag=1` shows the render diagnostics panel and exposes the read-only `window.__gridclash`
  probe (snapshot, legalMoves, cellRect).
- With `?diag=1`, `&board2d` forces the 2D board.

## 6. Important past bugs (do not reintroduce)
- **iPad Safari board flat blue:** a negative-width `rect()` frame hole. Fixed with even-odd
  holes, a pixel self-test, a shader self-check and a 2D fallback.
- **Picker freeze mid-match:** a rAF timestamp earlier than the animation start gave hop index
  −1, which threw; the frame loop died and the move never resolved.
  - Fixed by clamping `t` and the index.
  - Safety nets added:
    - frame errors settle animations;
    - a stall of 500 ms or more settles them;
    - the controller caps animation awaits at 6 s;
    - after a WebGL context loss the board switches to 2D in 3 s.
- **Music only after opening settings (iOS):** Safari unlocks audio only on touchend or click,
  inside the gesture. The unlock now listens to pointerdown, touchend, click and keydown, and
  starts a silent buffer. It also requests `navigator.audioSession.type = 'playback'` (WebKit Audio Session API) so the
  iOS/iPadOS silent mode does not mute the game; every iOS browser, Chrome included, is WebKit.
  `?diag=1` shows an `audio ctx=… session=…` line for device reports.
  On the web the first tap starts the sound (browser autoplay policy, unavoidable). In the native
  app (`Capacitor.isNativePlatform()`) `main.ts` primes audio at launch; Capacitor's Android
  WebView already sets `mediaPlaybackRequiresUserGesture(false)` (Bridge.java). This is untested on a
  device, and there is no iOS project yet.
- **Endless splash right after a deploy:** old hashed chunks 404 at once, and the CDN may serve a
  stale index for seconds. `public/boot-guard.js` reloads once with a cache-busting `?_r=`, then
  shows 다시 시도. After 12 s on the splash it reloads once if the main chunk already downloaded
  (start-up stuck), otherwise it shows the retry. The exact first-load stall seen a few times right
  after deploys was never reproduced with full request logging; the guard covers it either way.
- **Michelle phantom trap in the fast engine:** "backward" was judged after the turn-around flip.
- **CSP** (`vercel.json`) forbids inline scripts, so helpers live in external files
  (boot-guard.js, audition.js).

## 7. Open items and decisions waiting for the owner
- **Balance (hard-bot self-play, noisy):**
  - Insaner after the 3성 diagonal was removed (3성 vs 3성, 80 games each): 0.59 vs Brutile,
    0.79 vs Rakaeli, 0.82 vs Walk. Further levers if needed: 3성 orthogonal to 2, or an absorb cap.
  - Michelle: 1성 weak (~0.24); 2/3성 ~0.53–0.55 after the forward buff.
- **An `immobile` loss shows no on-board callout:** the result appears after about 0.65 s with "더 이상 움직일 수 없어 패배".
  Consider a toast or FX.
- **Store assets:** the screenshots and promo video still show the old 12×12 board and must be
  regenerated with `docs/store-assets/capture.mjs`.
- **Online PvP needs a server.** Supabase is available as a connector. Until then the
  currencies, rating and dev mode are client-side only.
- **Unverified everywhere:** real iOS/Android devices (including actual temperatures after the
  heat work), WebKit GPU cost of the ambient particles (the idle board redraws at ~10–20 fps by
  theme, plus a ~30 fps scan sweep 2.6 s of every 9 s), and how the voices and music sound.
- **Legendary rainbow rings in the DOM never rotated:** `--rar-rainbow` resolves its angle at
  `:root`, so the old `rar-spin` animation only cost style passes. It was removed (the static look
  players saw is kept). A real rotation would need a compositor `transform` on the round rings; an
  owner call (it adds a constant compositor animation).
- **IP notes:** a small cross pendant on Rakaeli's base 2성 art. Owner mood references
  (Damian, Wednesday or Jinx, Clash Royale) were taken as mood only.
- **Main JS chunk** is about 1.1 MB (gzip about 320 kB); code splitting is a future
  optimisation.
