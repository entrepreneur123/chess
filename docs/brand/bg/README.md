# Illustrated backdrops (`public/bg/`)

These are the backdrops for the "Dark Arena" direction (`docs/design/dark-arena.md`). They always sit
on top of a CSS gradient fallback (night-1 to night-0).

| Shipped file | Size | Master | Raw generation |
| --- | --- | --- | --- |
| `public/bg/lobby.webp` | 1080x1920, ~57 KB (budget 300 KB) | `lobby.png` | `generated/lobby-raw.jpg` |
| `public/bg/match.webp` | 1080x1920, ~35 KB (budget 250 KB) | `match.png` | `generated/match-raw.jpg` |
| `public/bg/matchmaking.webp` | 1080x1920, ~54 KB (budget 250 KB) | `matchmaking.png` | `generated/matchmaking-raw.jpg` |

- `generated/*-raw.jpg` are the untouched model outputs: 768x1376 JPEG, which is the highest
  resolution the tool returns.
- `*.png` are the processed 1080x1920 lossless masters.
- `process-bg.py` turns a raw file into its master and WebP. It is deterministic: re-running it
  reproduces the masters byte for byte.

## Generation
- **Tool:** the Magic Patterns `generate_image` MCP tool, at aspect ratio 9:16. It was run on
  2026-11-03.
- **Candidates:**
  - 15 candidates in total: 5 lobby, 6 match and 4 matchmaking.
  - The winners were picked by viewing each candidate and a 390x844 phone mock with a dark board,
    panels and a gold CTA on top.
  - The rejected candidates had busy brick patterns behind the board, a round platform that fights
    the square board, perspective stairs through the UI zone, a left/right (not top/bottom) team
    split, or pseudo-letter runes in prominent places.

### Prompts
**lobby (candidate "lobby-d"):**
> Vertical mobile game title-screen background, dark fantasy. Front view of a monumental moonlit
> arena gate at night: a tall dark stone archway with iron-banded closed doors in the upper half, a
> cold blue moon partly behind thin clouds visible above the arch, carved obsidian buttresses, two
> small iron braziers with faint warm gold flames near the left and right edges at mid height. A
> thick soft blue-violet mist bank covers the bottom of the gate; the lower 40 percent of the image
> is a calm, smooth, dark misty stone courtyard fading to blue-black. Premium clean painterly concept
> art, single cool light source, dimensional but restrained, soft vignette. No people, no
> characters, no text, no letters, no emblems, no logos.

**match (candidate "match-c"):**
> Overhead view straight down onto a vast dark stone arena floor at night, vertical portrait. Large
> irregular polished obsidian and blue-grey slate slabs with very soft, barely visible seams, low
> contrast, deep navy-black and violet-black tones. The middle of the image is an empty, calm, flat,
> uniformly dark stone area occupying most of the frame. Only in the outer margins: a few faint
> fragments of a giant engraved arcane circle and small geometric glyph marks (abstract geometric
> symbols only, no letters) glowing very dimly violet, plus thin soft mist creeping from the edges.
> Soft cool moonlight from the top, gentle vignette. Premium, clean, painterly, minimal mobile game
> background. No people, no objects, no text, no letters, no logos, no frame.

**matchmaking (candidate "matchmaking-c"):**
> Tall vertical dark fantasy duel background, viewed from directly above a dark obsidian stone arena
> floor. The upper half of the image is washed with a deep crimson red glow and red mist coming down
> from the top edge; the lower half is washed with a deep royal blue glow and blue mist rising from
> the bottom edge. Across the exact middle runs a calm horizontal band of near-black shadow where
> the two colours meet softly, with a few tiny floating gold embers. Faint geometric arcane circle
> arcs at the left and right edges. Both colour fields are dark and subtle, not saturated neon.
> Clean premium painterly mobile game art, soft vignette. No characters, no text, no letters, no
> logos.

## Post-processing (`process-bg.py`, Pillow + NumPy)
1. **Resize and crop.** Lanczos-upscale to 1080 px wide (about 1.41x), centre-crop to 1920 px tall,
   then apply a light unsharp mask (radius 1.6, 40%) to offset the upscale.
2. **Grade.**
   - Desaturate 10–25%, then split-tone toward cool blue/violet.
   - Warm, bright pixels are masked out of the tint, so flames keep their gold.
3. **Calm zones.**
   - `lobby`:
     - Blend in a 10 px blur over a soft centre panel zone and the lower third.
     - Darken the centre band by up to 38% and the lower third by up to 50%.
     - The two brazier flames (at about x=28 and x=1052, y=1028) get a small hand-placed gold
       (#f2c14e) core and halo, because grading had turned them grey.
   - `match`:
     - The soft superellipse board band is centred at 46% height, with radii of 40% of the width
       and 26% of the height.
     - Within it, the image is 75% blended with a 14 px blur, then darkened by up to 50%.
     - Global contrast is then reduced to 82%.
   - `matchmaking`:
     - Darken the centre seam by 25%.
     - Dim the two bright rune discs on the side edges by 35%.
4. **Vignette and floor.**
   - Apply an elliptical vignette.
   - Lift the black point to night-0 (#070a12), so nothing is pure black.
5. **Encode.**
   - Add luminance grain (sigma 0.9/255) against banding in the long dark gradients.
   - Save a PNG master and a WebP at quality 88, method 6.
   - Checked at 5x gain, with no visible banding.

Measured mean luminance (0–255) of the final files:

| File | Overall | Board band (centre 70% x 45%) | Lower third |
| --- | --- | --- | --- |
| `match` | 30.8 | 27.3 (std 3.0, very flat) | 29.0 |
| `lobby` | 35.3 | n/a | 29.9 |

## Licensing and source notes
- **Origin.** All three images are original AI generations from the text prompts above. They have
  no reference images, no photos and no third-party or game art as input. The prompts name no
  artist, game or franchise.
- **Content.** The runes and glyphs are invented decorative marks generated by the model. They are
  not real text in any language and contain no logos or trademarks. Some resemble Futhark-like
  strokes.
- **Rights.** The images were generated through the project's Magic Patterns account. Usage rights
  follow Magic Patterns' terms for generated images.
- **Before store submission.** Confirm the current terms. Also run a reverse-image search on the
  three raw files as a final originality check; this has not been done yet.
