# GRID CLASH design system v4 — "Bright Arena"

Daylight, chunky and clean (see `docs/design/arena-style.md`, which the board renderer shares).
Mid-tone sky-blue backgrounds, cream-blue light panels with navy text, dark-blue panels with white
text, every pressable surface a physical piece (light top edge, two-tone face, darker bottom lip,
soft drop; pressed = sinks onto its lip). Display type is Black Han Sans in white with a navy
outline. Plain CSS; tokens live in `tokens.css`.

## Files (import order in `src/main.ts`)

| File | Contents |
| --- | --- |
| `fonts.css` | Self-hosted `@font-face` (Pretendard, Black Han Sans, Exo 2 for the wordmark) |
| `tokens.css` | Arena palette, text, outlines, type, space, radius, depth, background, motion; `.rarity-*`; the light-panel text context |
| `base.css` | Reset, app shell (`#app` sky + lattice), focus ring, `.screen`, `.scroll-body`, `.appbar` |
| `components.css` | Buttons, icon buttons, press FX, cards, titles, chips, grade pills, unit art, tokens, movement diagram, switch, scrim/dialog/sheet/toast, `.enter` |
| `lobby.css` · `collection.css` · `formation.css` · `matchmaking.css` | Screens |
| `overlays.css` | Tutorial carousel, settings sheet, result dialog |
| `game.css` | Match layout: bars, turn strip, clock, timer ring, board area, notes over the board, action-dock row |
| `../ui/game/hud.css` | Match effects and panels: banners, flashes, float text, dock contents, selection chip, cut-in, ≡ drawer |

## Colour

- Palette tokens are the design doc's exact hex values: `--sky-top/bottom`, `--navy-ink`, `--panel`
  (`-edge`, `-well`, `-line`, `-hi`), `--panel-dark` (`-hi`, `-edge`), `--gold` (`-deep`, `-lip`),
  `--green` (`-mid`, `-deep`), `--team-blue`/`--team-red` (`-light`, `-deep`), `--grass-*`, `--stone-*`,
  `--violet-*`, `--storm-*`.
- Text: `--text-1/2/3` are white-ish by default (blue surfaces). Inside light panels (`.card`, `.dialog`,
  `.sheet`, `.tut`, `.fpanel`, `.tray-card`, `.play-panel`, `.unit-card`, or any `.on-light`) they flip to
  navy. Contrast: ≥ 4.5 : 1 for text-1..3 on `--panel-dark` and on `--panel`. Never put body copy
  directly on `--sky-top` (white is 3.3 : 1 there); use a panel or outlined display type.
- Gold text on cream uses `#8a4a00`; green text on cream `--green-text`.
- Rarity: `.rarity-common|rare|epic|legendary` exposes `--rar`, `--rar-deep`, `--rar-glow`, `--rar-soft`.
  Common = white, rare = orange, epic = purple, legendary = rotating rainbow (`--rar-rainbow`).

## Type

| Role | Family | Use |
| --- | --- | --- |
| Display | `--font-display` (Black Han Sans) | Titles, buttons, numbers (`--font-num` aliases it), names |
| Body | `--font-body` (Pretendard 400/600/800) | Running text, captions, hints |
| Logotype | `--font-logo` (Exo 2 italic 900) | The GRID CLASH wordmark and the VS badge only |

Outlined display type: `text-shadow: var(--ink-outline-s | -m | -l)` (white face, navy outline + drop).

## Depth

- Light panel: `background: var(--panel-fill); box-shadow: var(--panel-shadow)`; panels on the sky add
  the navy outline `0 0 0 2.5px var(--navy-ink), 0 var(--lip) 0 2.5px var(--navy-ink)`.
- Dark panel: `var(--dpanel-fill)` + `var(--dpanel-shadow)` (or the navy-outlined variant used by the bars).
- Lip `--lip` (5px), drops `--drop` / `--drop-l`. No glow except for real emphasis.

## Components (class API)

| Component | Classes |
| --- | --- |
| Buttons | `.btn` + `--primary` (alias `--filled`, gold) · `--play` (hero CTA) · `--success` (green confirm) · `--secondary` (blue) · `--tonal` (cream) · `--danger` (red) · `--text`; `--sm`, `--lg`, `--block`; `[disabled]` |
| Icon buttons | `.icon-btn` (chunky blue square, 48px), `--sm` (40px), `--light` (cream) |
| Panels | `.card` (+`--tap`, `.pressable`) |
| Titles | `.section-title` (+`--display` gold gem, white outlined on the sky, navy inside cards), `.section-link`, `.hint` |
| Chips | `.chip` (`--outline`, `--gold`, `--rarity`), `.badge`, `.lv-pill` (`--big`), `.lv-text` |
| Art | `unitArt()` → `.unit-art--face/--card`; `pieceToken()` → `.token--xs/sm/md/lg`; `movementDiagram()` → `.move-diagram` |
| Inputs / rows | `.switch[aria-checked]`, `.set-group > .set-row` (`--link`) |
| Overlays | `.scrim` (`--sheet`, `--drawer`), `.dialog`, `.sheet`, `.toast--neutral/warn/success` |

## Match screen layout

Rows: opponent bar · `.hud-strip` (turn pill + clock) · `.board-wrap` (canvas; `.board-overlay` holds the
storm chip, auto-pass chip and coach mark, never taking input) · `.info-host` (action dock: selection chip,
chain-skip / Brutile skill / targeting) · player bar. The strip and dock have their own rows so the dock's
buttons never cover the board. Landscape ≥ 700px wide moves the strip left and the dock right of the board.

## Motion

`--dur-press 90ms` · `--dur-1 140` · `--dur-2 220` · `--dur-3 340` · `--dur-4 560`; easings `--ease-out`,
`--ease-emph`, `--ease-spring`, `--ease-pop`, `--ease-in-out`. Press FX: `src/ui/components/press.ts`.
`prefers-reduced-motion` zeroes the duration tokens and disables loops/entrances.
