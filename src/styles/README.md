# GRID CLASH design system v5 — "Dark Arena"

Dark, rich and polished (see `docs/design/dark-arena.md`, shared with the board renderer and the
illustrated backdrops). Night-blue backgrounds with a vignette, obsidian panels, candle gold as the
sparse premium accent, and light that comes from the action: team glows, the selected unit, gold
trim, arcane (storm/skills) and toxic (Brutile) accents. Every pressable surface is still a physical
piece — a light top edge, a two-tone face, a darker bottom lip and a soft drop; pressed = it sinks
onto its lip. Display type is Black Han Sans in ink with a near-black outline. Plain CSS; tokens live
in `tokens.css`.

## Files (import order in `src/main.ts`)

| File | Contents |
| --- | --- |
| `fonts.css` | Self-hosted `@font-face` (Pretendard, Black Han Sans, Exo 2 for the wordmark) |
| `tokens.css` | Palette (doc hex values), derived shades, text, outlines, type, space, radius, depth, backgrounds, motion; `.rarity-*` |
| `base.css` | Reset, app shell (`#app` gradient + arcane rings, backdrop layer `::before`, vignette `::after`), focus ring, `.screen`, `.scroll-body`, `.appbar` |
| `components.css` | Buttons, icon buttons, press FX, cards, titles, chips, grade pills, unit art, tokens, movement diagram, switch, scrim/dialog/sheet/toast, `.enter` |
| `lobby.css` · `collection.css` · `formation.css` · `matchmaking.css` | Screens |
| `overlays.css` | Tutorial carousel, settings sheet, result dialog |
| `game.css` | Match layout: bars, timer ring, turn strip (turn count + turn chip), notes line, board area, action-dock row |
| `nav.css` | Bottom tab bar (router chrome) and the tab-switch cross-fade |
| `../ui/game/hud.css` | Match effects and panels: banners, flashes, float text, urgency, dock contents, selection chip, cut-in, ≡ drawer |

## Backdrops

`src/ui/backdrops.ts` preloads `public/bg/{lobby,matchmaking,match}.webp` after first paint. Only once
an image has decoded does it set `--bg-<name>-img` (an absolute URL, so it works in dev, under
`base: './'` and in the Capacitor WebView) and add `has-bg-<name>` on `<html>`; `#app::before` then
fades the art in over the CSS gradient. A missing file leaves the gradient. The lobby art is used by
the outer screens, the matchmaking art by `[data-screen='matchmaking']`, and the match art while
`body.in-game`.

## Colour

- Palette tokens are the design doc's exact values: `--night-0/1/2`, `--panel`, `--panel-top`,
  `--panel-lip`, `--line`, `--ink`, `--ink-muted`, `--gold` (`-deep`, `-lip`), `--arcane`, `--toxic`,
  `--team-blue`/`--team-red` (`-light`, `-glow`, `-deep`), `--danger`, `--positive` (`-lip`).
- Text: `--text-1` ink (14.6:1 on `--panel`), `--text-2` ink-muted (6.6:1), `--text-3` (4.8:1).
  Gold copy uses `--gold-text`; labels on gold use `--gold-ink` (11:1). Arcane / toxic / positive
  copy use `--arcane-text`, `--toxic-text`, `--positive-text`.
- Rarity: `.rarity-common|rare|epic|legendary` exposes `--rar`, `--rar-deep`, `--rar-glow`, `--rar-soft`.
  Common = white, rare = orange, epic = purple, legendary = rainbow (`--rar-rainbow`).
- Gold is sparse: the primary CTA, the turn chip on my turn, stars, 3성 / selected items, frame
  hairlines and victory moments.

## Type

| Role | Family | Use |
| --- | --- | --- |
| Display | `--font-display` (Black Han Sans) | Titles, buttons, numbers (`--font-num` aliases it), names |
| Body | `--font-body` (Pretendard 400/600/800) | Running text, captions, hints |
| Logotype | `--font-logo` (Exo 2 italic 900) | The GRID CLASH wordmark and the VS badge only |

Outlined display type: `text-shadow: var(--ink-outline-s | -m | -l)` (ink face, `--outline` + drop).

## Depth

- Panel: `background: var(--panel-fill); box-shadow: var(--panel-shadow)` (top highlight edge,
  hairline rim, dark lip, soft drop). Premium / selected: `var(--panel-shadow-gold)`.
- Inset well: `background: var(--panel-well); box-shadow: var(--well-shadow)`.
- Bars on the backdrop (app bar, docks): `var(--bar-fill)` with a gold hairline.
- Lip `--lip` (5px), drops `--drop` / `--drop-l`. Glows only for real emphasis (team, gold, arcane).

## Components (class API)

| Component | Classes |
| --- | --- |
| Buttons | `.btn` (dark panel face) + `--primary` (alias `--filled`, gold) · `--play` (hero CTA) · `--success` (green confirm) · `--secondary` / `--tonal` (dark) · `--danger` (red) · `--text`; `--sm`, `--lg`, `--block`; `[disabled]` |
| Icon buttons | `.icon-btn` (chunky dark square, 48px), `--sm` (40px), `--light` (quiet) |
| Panels | `.card` (+`--tap`, `.pressable`) |
| Titles | `.section-title` (+`--display` gold gem), `.section-link`, `.hint` |
| Chips | `.chip` (`--outline`, `--gold`, `--rarity`), `.badge`, `.lv-pill` (`--big`), `.lv-text` |
| Art | `unitArt()` → `.unit-art--face/--card`; `pieceToken()` → `.token--xs/sm/md/lg`; `movementDiagram()` → `.move-diagram` |
| Inputs / rows | `.switch[aria-checked]`, `.set-group > .set-row` (`--link`) |
| Overlays | `.scrim` (`--sheet`, `--drawer`), `.dialog`, `.sheet`, `.toast--neutral/warn/success` |

## Navigation (v6)

Top-level screens (캐릭터 `collection` · 대전 `lobby` · 진형 `formation`) share a persistent bottom
tab bar (`nav.css`, `src/ui/components/tabBar.ts`, tab list in `src/ui/nav.ts`). The router appends
the single bar instance under tab screens only and adds `.has-tabbar` (and `.screen--tab` for a
tab-to-tab cross-fade) to the screen. Tabs carry `data-nav`; the active one has
`aria-current="page"`; the centre Battle tab is raised (`.tab--main`). Tab screens have no back
arrow; hardware back from any tab returns to the lobby, and from the lobby leaves the app.

## Match screen layout

Rows (top to bottom): opponent bar · `.hud-strip` (turn count `.turn-count` + turn chip `.turn-pill`) ·
`.hud-notes` (storm chip, auto-pass chip, first-match coach; also the legacy `.board-overlay` hook) ·
`.board-wrap` · `.info-host` (selection chip + action dock: chain skip / Brutile skill / targeting) ·
`.pbar--hand` (my hand: three `.hand-card`s from `src/ui/game/hand.ts`, then the timer ring above
resign). Every row has a fixed height so the board never resizes. The board row is sized to the
board (`--board-h`, width-bound on phones), the hand takes what is left between `--hand-min` and
`--hand-max`, and any remainder is split above the board and above the hand, so there are no dead
bands. Short phones (`max-height: 720px`) tighten the chrome. Landscape ≥ 700px wide puts the strip,
notes and dock left of the board and the hand right of it. The turn timer ring glows in the team
colour, turns gold at 10 s and pulses red in the last 5 s (`.is-critical`; a timeout is a forfeit),
as does the hand bar.

## Motion

`--dur-press 90ms` · `--dur-1 140` · `--dur-2 220` · `--dur-3 340` · `--dur-4 560`; easings `--ease-out`,
`--ease-emph`, `--ease-spring`, `--ease-pop`, `--ease-in-out`. Press FX: `src/ui/components/press.ts`.
`prefers-reduced-motion` zeroes the duration tokens and disables loops/entrances; urgency stays
visible as a steady glow.
