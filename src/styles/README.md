# GRID CLASH design system v2 — "Night Arena"

Dark premium tactical look: navy/graphite ink, **gold = the one primary action**, team blue/red,
rarity colours for collection items. Everything is plain CSS (no framework); tokens live in
`tokens.css` and every other file consumes them.

## Files (import order in `src/main.ts`)

| File | Contents |
| --- | --- |
| `fonts.css` | Self-hosted `@font-face` (bundled from npm, offline-safe) |
| `tokens.css` | Colour, type, space, radius, elevation, texture, motion tokens; `.rarity-*` contexts; legacy `--c-*` aliases |
| `base.css` | Reset, app shell (`#app`, film grain), `.screen`, `.scroll-body`, `.appbar`, type primitives |
| `components.css` | Buttons, icon buttons, press FX, cards/panels, chips/badges, currency, rarity frames, unit art, tokens, movement diagram, progress, segmented, list rows, switch, avatars, scrim/dialog/sheet/toast |
| `lobby.css` · `collection.css` · `shop.css` · `formation.css` · `matchmaking.css` | Screens |
| `overlays.css` | Tutorial carousel, settings sheet, result dialog |
| `game.css` | Baseline in-game HUD (consolidated v1 rules on v2 tokens). The game screen owns the HUD and may override it (`src/ui/game/hud.css`) |

## Typography

| Role | Family | Use |
| --- | --- | --- |
| Body / UI | `var(--font-body)` — Pretendard 400 / 600 / 800 | All running text, labels, buttons |
| Korean display | `var(--font-display)` — Black Han Sans | Screen titles, CTA (`.btn--play`), result titles, names on cards. Weight is always 400 (single-weight face) |
| Latin display + numerals | `var(--font-num)` — Exo 2 (variable, upright + italic) | Wordmark, currency, levels (`Lv.3`, italic 800–900), timers, counts, eyebrows |

Scale: `--fs-hero 46` · `--fs-display 34` · `--fs-h1 24` · `--fs-h2 20` · `--fs-h3 17` · `--fs-body-l 16` ·
`--fs-body 14` · `--fs-label 13` · `--fs-caption 12` · `--fs-micro 11` (floor — nothing smaller).
Weights: `--fw-regular 400`, `--fw-semibold 600`, `--fw-bold 800` (700 resolves to 800).

Rules
- Numbers that change (currency, timers, counters, scores) always use `font-variant-numeric: tabular-nums`
  (`.t-num` does this) so digits don't jitter.
- Letter-spacing: Korean body `-0.01em`, titles `-0.02em`, display `-0.01em`; Latin all-caps eyebrows
  `+0.12em` (`.t-eyebrow`). Never track Korean body text positively.
- `word-break: keep-all` is global (Korean wraps at word boundaries).

## Colour

- Ink (backgrounds → raised): `--ink-950 … --ink-400`. App bg `--ink-900`, cards `--surface-1`, raised
  `--surface-2`, glass overlays `--surface-glass`, inset wells `--surface-well`.
- Text: `--text-1` (primary), `--text-2` (secondary), `--text-3` (tertiary), `--text-off` (disabled, non-essential).
  Contrast on `--ink-800`: 16.2 / 9.8 / 6.2 : 1; on the lightest control surface (`#2a3c60`) text-2 is 6.2 : 1.
- Gold (primary action only): `--gold-100 … --gold-800`; text on gold `--text-on-gold` (10.4 : 1 on gold-300).
- Team: blue `--blue-200 … 700` (player, bottom), red `--red-200 … 700` (opponent, top).
- Semantic: success `--green-*`, premium currency `--gem-*`.
- Rarity: put `.rarity-common|rare|epic|legendary` on any element; descendants get `--rar`, `--rar-deep`,
  `--rar-glow`, `--rar-soft`. Common = steel, rare = azure + glow, epic (영웅) = violet + glow + corner gems,
  legendary = gold + glow + pulsing glow + corner gems.

## Shape, space, depth, texture

- 8px grid (`--s-1 4px … --s-10 40px`), screen gutter `--gutter 16px`, wide-screen column `--column 480px`.
- Radii: `--r-xs 6` (tiny tags), `--r-s 10` (wells, rows), `--r-m 14` (buttons, small cards),
  `--r-l 18` (cards), `--r-xl 24` (panels, dialogs, sheets), `--r-full`.
- Elevation = inset 1px top light (`--hi-1/2`) + drop shadow (`--sh-1/2/3`). Glows (`--glow-*`) only for
  "live" states: active turn, selected, rarity, reward.
- Texture: global film grain (`#app::after`, `--tex-grain`); fine hatching `--tex-hatch` on hero panels.
  Gilded frame: `.panel--gilded` (gold hairline gradient border).

## Motion

`--dur-press 90ms` (press feedback) · `--dur-1 140` · `--dur-2 220` · `--dur-3 340` · `--dur-4 560`.
Easings: `--ease-out` (default), `--ease-emph` (entrances), `--ease-spring` (bouncy UI),
`--ease-pop` (rewards, strong overshoot), `--ease-in-out` (loops).
- Every pressable gets a press transform plus a touch-point glow: `src/ui/components/press.ts` (one delegated
  listener) applies `.fx-ripple` to `.btn`, `.icon-btn` and anything with `.pressable`.
- Staggered entrances: add `.enter` and `style="--i:<n>"`; containers that re-render add `.is-settled`
  so entrances don't replay.
- Only `transform`/`opacity` are animated in loops. `prefers-reduced-motion` zeroes all duration tokens and
  disables loops/entrances.

## Components (class API)

| Component | Classes |
| --- | --- |
| Buttons | `.btn` + `--primary` (alias `--filled`) · `--play` (hero CTA, 72px, display font) · `--upgrade`/`--success` (green) · `--secondary` (blue) · `--tonal` (steel) · `--danger` · `--text`; sizes `--sm` / `--lg`; `--block`. Disabled: `[disabled]` (not clickable) or `[aria-disabled="true"]` (still clickable → explain via toast). Cost pill inside: `.btn__cost` (`.is-short` when unaffordable) |
| Icon buttons | `.icon-btn` (48px) + `--glass` / `--outlined`, `--sm` (40px, dense HUD only) |
| Panels | `.card` / `.panel`, `.panel--gilded`, `.card--tap` (+`.pressable`) |
| Titles | `.section-title` (+`--display` for the gold-tick display style), `.section-link`, `.hint` |
| Chips | `.chip`, `--outline`, `--gold`, `--dev`, `--rarity` (via `rarityChip()`), `.badge` (red count), `.lv-pill` (`--big` gold), `.lv-text` |
| Currency | `coinChip()` / `gemChip()` → `.coin-chip` (`--gem`, `.is-infinite` for the developer account), `.wallet`, `.wallet__btn`, `.wallet__plus` |
| Art | `unitArt(id, lv, {kind:'face'|'card'})` → `.unit-art--face` / `--card` with rarity ring/glow/gems; `pieceToken()` → `.token--xs/sm/md/lg` (`.owner-1` red); `movementDiagram()` → `.move-diagram` |
| Progress | `.progress > .progress__bar` (`.is-full` turns green), `.progress-block__label/__value` |
| Inputs | `.segmented`, `.switch[aria-checked]`, `.field > .field__input` |
| Rows | `.list-row`, `.set-group > .set-row` (`--link`) |
| Overlays | `.scrim` (+`--sheet`), `.dialog` (`__icon/__title/__body/__actions`), `.sheet`, `.toast--neutral/warn/success` |
| Chest art | `chestArt('free'|'basic')` from `components/chest.ts` |

## HUD guide (for the in-game screen)

The HUD should read as part of the same product. Use these, rather than raw values:

- Bars / panels: `background: var(--surface-glass)`, `box-shadow: inset 0 0 0 1px var(--line-1), var(--hi-2), var(--sh-1)`,
  radius `--r-l`. Active-turn emphasis: `inset 0 0 0 1.5px` + 20px glow in the side colour
  (blue `--blue-400` for the player, red `--red-400` for the opponent).
- Turn pill / banners: chunky style = gradient (`--blue-500→--blue-600` or `--red-500→--red-600`), 3px bottom
  edge in `--blue-700` / `--red-700`, `--hi-2`; text white 800 (contrast ≥ 4.5 : 1 on those gradients).
  Big announcements ("내 차례", "승리!") use `--font-display`; numbers (timer, ply counter) use
  `--font-num` + tabular nums.
- Timer ring: track `rgba(255,255,255,.12)`, arc `--blue-400` / `--red-400`, warn state `--red-300` label.
- Coach marks / hints: `--surface-2` + `inset 0 0 0 1px rgba(255,195,40,.5)` gold hairline, icon `--gold-300`.
- Info card: `--surface-2`, top accent `inset 0 3px 0 <side colour>`, `--sh-3`; secondary text `--text-2`,
  actionable status `--gold-200`.
- Hit / capture flashes: `--red-400` glow for damage, `--gold-300` for player success, `--ease-pop` timing.
- Toasts while in game sit above the bottom bar automatically (`body.in-game .toast-host`).
- Legacy `--c-*`, `--fs-title-*`, `--radius-*`, `--elev-*`, `--t-*` tokens remain as aliases until the HUD is migrated.

## Lobby layout contract

- `.lobby` sets `--hero-h` from the viewport height so the PLAY panel stays above the dock on 360×640;
  `--dock-h` is the dock height.
- The hero key visual uses the card illustrations `./chars/{id}-lv{n}.jpg` (540×720) with radial masks, so
  regenerated art with the same filenames and a dark background drops in without CSS changes.
