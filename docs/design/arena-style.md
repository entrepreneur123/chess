# GRID CLASH — "Bright Arena" visual direction (v4)

Owner feedback: the current UI, board and backgrounds feel generic and not pretty. Target the
feel of top mobile strategy games such as Clash Royale: **comfortable on the eyes but high
quality — dimensional (입체적) yet clean (깔끔)**. Do not copy any game's assets, logos, fonts or
layouts; take only the qualities below.

## Qualities to hit
- **Daylight, warm, friendly.** Mid-tone saturated colours, never a near-black screen. Backgrounds
  are rich mid blues with a soft vertical gradient and a very subtle large-scale pattern; no noise.
- **Chunky and tactile.** Every interactive surface looks like a physical piece: rounded corners
  (12–20px), a lighter top edge highlight, a darker 4–6px bottom "lip" (the 3D edge), and a soft
  drop shadow. Pressed = moves down 2–3px and loses the lip.
- **Clean shading.** One light from the top-left. Two or three tones per surface (light top,
  base, dark lip). No glow soup, no heavy neon blur, no busy textures. Glow only for real
  emphasis (legendary, selected, danger).
- **Bold, outlined type.** Headings, numbers and button labels use the display font (Black Han
  Sans, already bundled) in white or cream with a dark navy outline/shadow
  (`text-shadow: 0 2px 0 #1b2445, 0 0 2px #1b2445` or `-webkit-text-stroke`), so they read on any
  colour. Body copy stays Pretendard, dark-on-light or light-on-blue with good contrast.
- **Readable at a glance.** Team blue vs red, rarity colours (common white, rare orange, epic
  purple, legendary rotating rainbow) and the star grades must stay instantly recognisable.

## Shared palette (use these exact values so the board and the UI match)
| Token | Hex | Use |
| --- | --- | --- |
| sky-top | #4f8ee8 | background gradient top |
| sky-bottom | #2a59b8 | background gradient bottom |
| navy-ink | #1b2445 | outlines, text strokes, deep shadows |
| panel | #e9eef8 | light panels / cards (cream-blue) |
| panel-edge | #b9c6e0 | panel bottom lip |
| panel-dark | #2d4b8f | dark panels on the blue background |
| panel-dark-edge | #1d3166 | dark panel lip |
| gold | #ffcf3a | primary CTA top |
| gold-deep | #f29a16 | primary CTA bottom |
| gold-lip | #b8650a | primary CTA lip |
| green | #63d34a | positive / confirm top |
| green-deep | #2f9a2a | positive lip |
| team-blue | #3c8dff (light #8cc2ff, deep #1f56c4) | player |
| team-red | #ff4d57 (light #ff9aa0, deep #c4212c) | opponent |
| grass-light | #8fd16a | board light tile |
| grass-dark | #79bf57 | board dark tile |
| stone | #c9b48e (light #e3d3b0, deep #8f7a57) | board frame / plinth |
| blue-zone | #6fb3ff at ~22% over tiles | player home rows |
| red-zone | #ff7a7a at ~22% over tiles | opponent home rows |

## Board (top-down arena)
- A grassy field of 12 x 12 chunky tiles, alternating grass-light / grass-dark, each tile with a
  1–2px lighter top-left bevel and darker bottom-right edge so the board reads as raised
  tiles, plus a soft inner shadow where the field meets the frame.
- Home rows tinted blue (bottom 3) and red (top 3), clearly but softly; the centre line between
  the halves can be a subtle path or river-like strip, not a hard neon line.
- The field sits on a chunky stone/wood plinth (stone palette) with rounded corners, a light
  top bevel and a dark lip, casting a soft shadow onto the sky-blue background.
- Tokens: thick coins — team-colour rim (light top, deep bottom), inner bevel, face illustration,
  gold star pips, rarity ring outside, soft contact shadow on the grass. Selected token lifts
  slightly with a bigger shadow.
- Move markers: soft white dots with a dark shadow (own), red dots (enemy reach); capture =
  red ring; wasteland = cracked dark purple-green earth that still reads on grass; storm columns
  = purple haze. Everything must read on the green field.

## UI
- Top/bottom player bars: dark panels (panel-dark) with a lip, team-coloured avatar frames,
  chunky timer ring, outlined numbers.
- Buttons: gold (primary), green (confirm), blue (secondary), red (danger) — all with lip +
  pressed state. Icon buttons are rounded squares with a lip.
- Cards/sheets/dialogs: light panels (panel) with navy text, or dark blue panels with white text;
  rounded 20px, lip, soft shadow, a header ribbon/banner where it helps.
- Lobby: bright sky background with the squad illustrations, a big gold "대전 시작" button,
  chunky difficulty selector, chunky bottom dock tiles.
- Respect `prefers-reduced-motion`, keep the safe-area insets, keep phone portrait first
  (360–430px wide) and avoid layout shifts.
