# GRID CLASH — "Dark Arena" visual direction (v5, replaces arena-style.md v4)

Owner feedback on v4 "Bright Arena":
- The in-game screen got worse. This game suits a slightly **dark, shadowy (darkness) mood**.
- The move-range markers were better before. The v4 flat white dots with dark outlines look
  childish and "AI slop".

Keep what v4 got right: **dimensional (입체적) but clean (깔끔)**. That means:
- chunky surfaces with a light top edge and a darker bottom lip;
- one light source, two or three tones per surface;
- outlined display type;
- no glow soup.

Move the whole mood to dark fantasy: obsidian, iron, candle-gold and arcane glow. Think of a
premium night-time strategy game, polished and readable, never muddy or near-black flat.
Do not copy any game's assets, logos, fonts or layouts.

## Mood
- **Dark but rich.** Use deep blue-black and violet-black backgrounds with a soft vignette and a
  faint large-scale texture (stone, mist or arcane rings) at very low contrast. Never pure #000.
  Never a flat single colour on a big area.
- **Light comes from the action.** Team glows, the selected unit, gold UI trim and skill FX are
  the bright things. Everything else stays in mid-dark values so they pop.
- **Gold is the premium accent.** Use thin gilded trims on frames, the primary CTA, stars and
  victory moments. Keep it sparse.
- **Readable.** Text contrast is at least 4.5:1. Team blue and red, rarity colours and star
  grades must read instantly.

## Shared palette (use these exact values so the board, UI and art match)
| Token | Hex | Use |
| --- | --- | --- |
| night-0 | #070a12 | deepest background / vignette edge |
| night-1 | #0d1322 | app background base |
| night-2 | #151d31 | raised background areas |
| panel | #1b2338 | panels and cards |
| panel-top | #28324d | panel top highlight edge |
| panel-lip | #090d17 | panel bottom lip and shadow |
| line | #33405f | hairlines and dividers |
| ink | #eef2ff | primary text |
| ink-muted | #9aa6c4 | secondary text |
| gold | #f2c14e | primary accent and CTA top |
| gold-deep | #c8891e | CTA bottom |
| gold-lip | #6e4510 | CTA lip |
| arcane | #8b6cff | magic / skill accent |
| toxic | #7cff5a | Brutile, wasteland accent |
| team-blue | #3b8bff (light #8cc2ff, glow #5fb0ff, deep #1a4fb8) | player |
| team-red | #ff4655 (light #ff9aa0, glow #ff6a5a, deep #9e1c27) | opponent |
| danger | #ff4655 | destructive actions |
| positive | #3ccf7a (lip #1d7a45) | confirm |

Rarity colours stay as they are: common white, rare orange #ff9a2e, epic purple #b65cff, and
legendary as a rotating rainbow ring.

## Board (top-down, in-game)
- **Tiles.** Dark slate/obsidian stone tiles, two close tones (about #222b40 / #1b2336). Each has
  a subtle bevel: a 1px lighter top-left edge and a darker bottom-right edge.
- **Home zones.** The bottom 3 rows are tinted toward team-blue deep, the top 3 toward team-red
  deep. Each zone has a thin glowing team-coloured edge line where it meets the neutral field,
  as in the pre-v4 board the owner liked.
- **Frame.** A dark iron/obsidian frame with a thin gold trim and a soft outer shadow. The board
  floats on the dark backdrop; no bright plinth.
- **Tokens.** Illustrated face coins with a team-colour rim, rarity ring and gold star pips.
- **Move markers.** Restore the pre-v4 look: soft, luminous, slightly glowing dots.
  - Own reach: cool white / ice-cyan glow.
  - Enemy reach: red glow.
  - Capture: glowing red ring.
  - Deadly (wasteland): skull.
  - Never flat opaque white discs with dark outlines.
- **Wasteland and storm.** Wasteland is cracked black-green earth with a toxic-green glow. Storm
  columns are a violet haze. Both must read on dark tiles.

## UI
- **Backgrounds.** Dark gradient night-1 to night-0 with a vignette. Optional illustrated
  backdrops come from `public/bg/` (see below) and are always layered over a CSS gradient
  fallback.
- **Panels and cards.** Use `panel` with a `panel-top` inner top highlight, a `panel-lip` bottom
  lip, radius 14–20px, and a soft shadow. Hairline borders use `line`, or gold for premium or
  selected items.
- **Buttons.**
  - Primary is gold with a dark-ink label.
  - Secondary is the dark panel style with a light label.
  - Confirm is positive green; danger is red.
  - Every button has a lip and a pressed state that moves down 2–3px and loses the lip.
- **Type.** Display type is Black Han Sans in ink with a dark outline/shadow. Body text is
  Pretendard.
- **HUD.** Player bars are dark panels with team-coloured avatar frames and a timer ring that
  glows in the team colour on your turn. The turn chip is gold on your turn and muted otherwise.
- **General.**
  - Respect `prefers-reduced-motion` and safe-area insets.
  - Design portrait-first for 360–430px widths.
  - Avoid layout shifts.

## Illustrated backdrops (`public/bg/`)
| File | Size | Content |
| --- | --- | --- |
| `lobby.webp` | 1080x1920 portrait, ≤ 300 KB | Dark fantasy war-hall / moonlit arena gate. The centre and lower third are calm and dark enough for UI on top. No characters, no text. |
| `match.webp` | 1080x1920 portrait, ≤ 250 KB | Very calm dark stone arena floor with mist and faint arcane runes at the edges. The centre is darkest, because the board sits there. No characters, no text. |
