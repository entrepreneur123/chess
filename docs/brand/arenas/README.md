# Arena art (`public/arenas/<id>/`)

Each of the six rating arenas (`src/meta/progression.ts`, concepts in
`docs/design/progression.md` "Arena themes and music") has two images:

| File | Size | Use |
| --- | --- | --- |
| `bg.webp` | 1080x1920, budget 250 KB | In-match backdrop (`--bg-match-img`, shown `center 46% / cover`) |
| `card.webp` | 1080x900 (6:5), budget 200 KB | Lobby arena card (`.arena__art`, about 360x300 CSS px, `object-fit: cover`) |

They follow the "Dark Arena" and "Clean Tactical" rules (`docs/design/dark-arena.md`,
`docs/design/v6-clean-tactical.md`) and the workflow of `docs/brand/bg/README.md`.

## Shipped files

| Arena | Accent | `bg.webp` | `card.webp` | bg source | card source |
| --- | --- | --- | --- | --- | --- |
| moonrune | #8cc2ff ice blue | 42.6 KB | 57.3 KB | `../bg/generated/match-raw.jpg` | `../bg/generated/lobby-raw.jpg` |
| emberforge | #ff9a4d orange | 53.9 KB | 66.2 KB | `generated/emberforge-bg-c.jpg` | `generated/emberforge-card-a.jpg` |
| blightmire | #7cff5a toxic green | 88.7 KB | 80.2 KB | `generated/blightmire-bg-c.jpg` | `generated/blightmire-card-a.jpg` |
| frostkeep | #9fe8ff pale cyan | 60.5 KB | 86.1 KB | `generated/frostkeep-bg-b.jpg` | `generated/frostkeep-card-a.jpg` |
| madcrown | #c06cff violet | 50.2 KB | 77.3 KB | `generated/madcrown-bg-c.jpg` | `generated/madcrown-card-a.jpg` |
| apex | #f2c14e gold | 60.2 KB | 71.1 KB | `generated/apex-bg-d.jpg` | `generated/apex-card-a.jpg` |

- `generated/*.jpg` are all 28 untouched model outputs (winners and rejects), as returned:
  backdrops 768x1376, cards 1152x928, about 3 MB in total. They are named
  `<arena>-<bg|card>-<letter>`; the CDN URL of each reject is also listed below.
- `process-arena.py` turns the raw files into all twelve WebPs (and lossless PNG masters in the
  output folder). It is deterministic: two full runs produced byte-identical PNGs and WebPs
  (checked with sha256). The PNG masters (about 1.8 MB each) are not committed because they can
  be regenerated exactly.

Regenerate (from the repo root, with Pillow and NumPy):

```sh
python3 docs/brand/arenas/process-arena.py /tmp/arena-out
for i in moonrune emberforge blightmire frostkeep madcrown apex; do
  cp /tmp/arena-out/$i/bg.webp /tmp/arena-out/$i/card.webp public/arenas/$i/
done
```

## Family rules
All six share one recipe so they read as a set:
- **Backdrop:** an overhead view straight down onto the arena floor. The middle is empty, flat and
  dark. Each arena's identity (lava, roots, ice, chains, clouds) sits only at the **top and
  bottom** edges. The board covers almost the full phone width and `cover` crops about 9% from
  each side on a 390x844 phone, so side-edge detail is hidden and was a reason to reject
  candidates.
- **Card:** a front establishing view of a gate, arch or throne at the far end of a dark arena
  floor. The lower third is a calm, dark floor for the arena name.
- **Style suffix in every prompt:** premium clean painterly concept art; a single key light in the
  arena accent; dimensional but restrained detail; soft vignette; no people, characters, text,
  letters, logos or emblems.

## Generation
- **Tool:** the Magic Patterns `generate_image` MCP tool, in the project's "GRID CLASH
  illustrations" OS.
  - Backdrops used aspect ratio 9:16 and returned 768x1376.
  - Cards used aspect ratio 5:4 and returned 1152x928.
- **Date:** 2026-11-03.
- **References:** none (text prompts only).
- **Candidates:** 28 in total: 5 for each of the four middle arenas, and 8 for apex (6
  backdrops, 2 cards).
  - Moonrune reuses the two existing raw files from `docs/brand/bg/`, and needed no new
    generation.
- **How winners were picked:**
  - Each candidate was viewed on its own.
  - Each backdrop was then shown in a 390x844 phone mock with a navy hologram board, HUD bars and
    a hand row.
  - Each card was shown at 360x300 at 2x, with the lobby shade and a white Black Han Sans title.

### moonrune
- **bg:** the existing `match-c` overhead floor (prompt in `docs/brand/bg/README.md`), run
  through this pipeline so its grade matches the other five.
- **card:** the existing `lobby-d` moonlit gate (prompt in `docs/brand/bg/README.md`). The card
  takes a 6:5 window across the full width, 6% down the frame: the moon, the arch and the closed
  doors.
- **Why reuse:** both already define the look the other arenas were prompted to match, and the
  new card recipe (a gate at the end of the arena) was modelled on it.

### emberforge (5 candidates: 3 bg, 2 card)
**bg, winner `emberforge-bg-c`:**
> Overhead view straight down onto a dark iron forge floor at night, vertical portrait. Heavy dark
> iron plates and black stone with very faint rivet seams, low contrast, near-black with warm brown
> undertones. The middle 60 percent of the image is calm, flat, empty and evenly dark. At the top
> and bottom edges: faint glowing orange lava seams and cracks, drifting embers and soft warm haze
> rising from below. Single warm orange key light, gentle vignette. Premium clean painterly mobile
> game background, restrained detail. No people, no characters, no text, no letters, no logos, no
> emblems, no frame.

- **Why c:** its lava crust sits at the top and bottom, where it stays visible around the board.
- **Rejected:**
  - `bg-a` (a slab floor with cracks on the side edges): visible slab grid through the centre;
    its identity is hidden by the side crop. Prompt: c's subject as "polished black basalt slabs"
    with "thin cracks and narrow molten lava channels" in the outer margins.
    <https://cdn.magicpatterns.com/patterns/generated-images/5c094e6d-b07d-4cf5-9b92-a233f31ebd79.jpg>
  - `bg-b` (lava bars down both sides, an anvil and chains in the top corners): it looked best
    alone, but in the mock the side bars were cropped or covered, and the screen read as flat
    brown. It was the first pick, and was replaced after the mock.
    <https://cdn.magicpatterns.com/patterns/generated-images/4e514d40-20b2-4dc3-bd7d-b5424dfbb5bf.jpg>

**card, winner `emberforge-card-a`:**
> Wide establishing view of a volcanic forge arena at night, dark fantasy. A monumental dark basalt
> forge hall carved into a volcano: a huge stone archway with a great glowing furnace mouth in the
> upper middle, molten lava channels flowing down stepped terraces on both sides, giant black iron
> anvils and hanging chains in silhouette, orange embers drifting in the air, smoke against a dark
> red-black sky. The lower third of the image is a calm, dark, smooth basalt arena floor fading
> into deep shadow. Single warm orange key light from the furnace, dimensional but restrained
> detail, premium clean painterly concept art, soft vignette. No people, no characters, no text, no
> letters, no logos, no emblems.

- **Why a:** a symmetric furnace arch that matches the moonrune gate, with a dark floor for the
  title.
- **Rejected `card-b`** (a caldera arena with a giant anvil monument): busier, and its lit ring
  floor runs under the title.
  <https://cdn.magicpatterns.com/patterns/generated-images/82f03592-332b-44d7-bb91-868db730868e.jpg>

### blightmire (5 candidates: 3 bg, 2 card)
**bg, winner `blightmire-bg-c`:**
> Overhead view straight down onto a dark sunken stone platform in a poisonous bog at night,
> vertical portrait. Smooth dark grey-green stone with very faint cracks and a thin film of moss,
> near-black. The middle 60 percent of the image is calm, flat, empty and evenly dark. At the top
> and bottom edges: thick dark roots, faint glowing toxic green fog and tiny floating green spores.
> Single toxic green key light, gentle vignette. Premium clean painterly mobile game background,
> restrained detail. No people, no characters, no creatures, no text, no letters, no logos, no
> emblems, no frame.

- **Why c:** a calm centre slab, with green roots and fog at the top and bottom.
- **Rejected:**
  - `bg-a`: a busy flagstone grid behind the board; its lanterns sit on the cropped sides.
    <https://cdn.magicpatterns.com/patterns/generated-images/a52e6b1a-c7cf-41a6-8bca-2616301bda9b.jpg>
  - `bg-b`: a light grey centre panel that would glow through the board; heavy side roots.
    <https://cdn.magicpatterns.com/patterns/generated-images/2f812552-4fa8-4aa2-bc36-27dd45fb0dd6.jpg>

**card, winner `blightmire-card-a`:**
> Wide establishing view of a cursed swamp shrine arena at night, dark fantasy. An ancient
> overgrown dark stone shrine with a broken pointed arch in the upper middle, giant twisted black
> tree roots wrapping its pillars, small witch lanterns hanging from the roots glowing toxic green,
> thick luminous green fog rolling over dark bog water, dead trees silhouetted against a murky
> green-black sky. The lower third of the image is a calm, dark, smooth stone arena floor fading
> into deep shadow and low fog. Single toxic green key light, dimensional but restrained detail,
> premium clean painterly concept art, soft vignette. No people, no characters, no creatures, no
> text, no letters, no logos, no emblems.

- **Why a:** a symmetric arch (gate recipe) and a strong green identity.
- **Rejected `card-b`** (a pillar ring under a giant root): its centre is less of a focal
  point.
  <https://cdn.magicpatterns.com/patterns/generated-images/a8a5f077-07f2-476b-b994-18318cd18ffe.jpg>

### frostkeep (5 candidates: 3 bg, 2 card)
**bg, winner `frostkeep-bg-b`:**
> Top-down view of a dark ice fortress arena floor, vertical portrait mobile game background. A
> wide calm square of smooth dark frozen stone under clear black ice fills the centre, very low
> contrast. Around the outer edges only: jagged pale cyan ice crystal formations, snow-covered dark
> battlement stones, tattered frozen banners lying flat at the top corners without any symbols,
> frost spreading from the borders, faint drifting snow. Deep navy-black palette with pale cyan
> glow only at the edges. Single cold key light from above, soft vignette. Premium painterly
> concept art, dimensional but restrained. No people, no characters, no text, no letters, no
> logos, no emblems, no frame.

- **Why b:** the strongest pale-cyan identity in the top and bottom strips (ice crystals,
  battlements).
- **Rejected:**
  - `bg-a` (a flagstone floor with an aurora at the top): it reads too close to moonrune.
    <https://cdn.magicpatterns.com/patterns/generated-images/8014feb3-56e2-4557-833a-1414df66fba1.jpg>
  - `bg-c` (a frozen lake): bright white snow rims, and an aurora reflection inside the board
    zone.
    <https://cdn.magicpatterns.com/patterns/generated-images/98bd5a68-54e3-462c-8630-c7dc35f4a599.jpg>

**card, winner `frostkeep-card-a`:**
> Wide establishing view of a frozen ice citadel arena at night, dark fantasy. A monumental dark
> stone and blue ice fortress gate in the upper middle with tall frost-covered towers, icicles
> hanging from the arch, plain tattered frozen banners without any symbols hanging from the walls,
> a sweeping pale cyan and soft green aurora across a deep navy night sky with stars, light snow
> falling. The lower third of the image is a calm, dark, smooth frozen stone arena floor with thin
> snow, fading into deep shadow. Single cold pale cyan key light, dimensional but restrained
> detail, premium clean painterly concept art, soft vignette. No people, no characters, no text,
> no letters, no logos, no emblems.

- **Why a:** a fortress gate with an aurora (gate recipe).
- **Rejected `card-b`** (an ice-spire ring and a frozen waterfall arch): no gate, and a bright
  wide floor.
  <https://cdn.magicpatterns.com/patterns/generated-images/11344791-ac8b-4f17-8e3a-6053ab92d374.jpg>

### madcrown (5 candidates: 3 bg, 2 card)
**bg, winner `madcrown-bg-c`:**
> Overhead view straight down onto a cracked dark obsidian floor of a ruined throne room at night,
> vertical portrait. Smooth dark violet-black stone with very faint fine cracks, near-black. The
> middle 60 percent of the image is calm, flat, empty and evenly dark. At the top and bottom edges:
> broken chain links, cracks glowing with violet flame, drifting violet embers and a faint crimson
> haze. Single violet key light, gentle vignette. Premium clean painterly mobile game background,
> restrained detail. No people, no characters, no text, no letters, no logos, no emblems, no frame.

- **Why c:** the calmest centre of all candidates, with violet fire cracks at the top and bottom.
- **Rejected:**
  - `bg-a`: visible slab lines and a bright spotlight at the top centre; its fire cracks run down
    the cropped sides.
    <https://cdn.magicpatterns.com/patterns/generated-images/45b25f82-5f12-4090-ac76-7ca89744897e.jpg>
  - `bg-b`: a lit grey centre panel, and a carpet with a patterned gold border (pseudo-ornament).
    <https://cdn.magicpatterns.com/patterns/generated-images/867d6ad1-22b6-4d19-9bbe-73e58a749f8b.jpg>

**card, winner `madcrown-card-a`:**
> Wide establishing view of a mad king's ruined throne hall at night, dark fantasy. A towering
> empty dark obsidian throne with jagged spikes stands at the top of wide stairs in the upper
> middle, giant broken iron chains hang from the high ceiling and lie shattered on the steps, tall
> gothic violet stained-glass windows with abstract patterns only, braziers burning with violet
> demon fire, crimson-violet haze. The lower third of the image is a calm, dark, smooth polished
> marble floor fading into deep shadow. Single violet key light from behind the throne,
> dimensional but restrained detail, premium clean painterly concept art, soft vignette. No
> people, no characters, no figures on the throne, no text, no letters, no logos, no emblems.

- **Why a:** a symmetric throne under violet windows, with the broken chains from the concept.
- **Rejected `card-b`:** its side walls carry carved, emblem-like reliefs, which break the
  no-emblem rule.
  <https://cdn.magicpatterns.com/patterns/generated-images/9a06624a-528d-4ecf-8105-8408743c2ac2.jpg>

### apex (8 candidates: 6 bg, 2 card)
**bg, winner `apex-bg-d` (second round):**
> Vertical portrait mobile game background, view looking straight down from a floating celestial
> arena high above the clouds at night. The middle 60 percent of the image is a calm, flat, empty,
> evenly dark navy-black stone surface with no detail. In the top 18 percent: a warm golden
> starlight glow, ornate gold-trimmed dark stone balustrade fragments seen from above and tiny
> golden light motes. In the bottom 18 percent: a soft sea of moonlit clouds far below with
> gold-edged floating rock fragments and drifting golden sparks. Deep navy-black palette with warm
> gold accents only at the top and bottom. Single warm gold key light, gentle vignette. Premium
> clean painterly concept art, dimensional but restrained detail. No people, no characters, no
> text, no letters, no logos, no emblems, no frame.

- **Why d:** the only candidate where the gold reads in the visible strips: a balustrade at the
  top and clouds below.
- **First-round rejects:**
  - `bg-a`: gold platform rims on the cropped sides; it read brown-grey in the mock.
    <https://cdn.magicpatterns.com/patterns/generated-images/76cab08d-4ce5-4570-ad69-e925f206f3eb.jpg>
  - `bg-b`: a square platform hidden under the board, leaving only a plain starfield with no gold.
    <https://cdn.magicpatterns.com/patterns/generated-images/d9d00302-d837-4673-8213-ab830c8cc5ed.jpg>
  - `bg-c`: a large round ring that fights the square board.
    <https://cdn.magicpatterns.com/patterns/generated-images/ce2ead15-d964-4fc1-bac6-5dbc24c84611.jpg>
- **Second-round rejects:**
  - `bg-e`: a round ring.
    <https://cdn.magicpatterns.com/patterns/generated-images/c53643ef-bcb8-43f1-8d65-a917fbbaa318.jpg>
  - `bg-f`: a round ring, and a vertical line through the centre.
    <https://cdn.magicpatterns.com/patterns/generated-images/a17a9fe8-7372-4315-af7d-7bf310993329.jpg>

**card, winner `apex-card-a`:**
> Wide establishing view of a legendary floating arena high above the clouds at night, dark
> fantasy. A monumental dark navy stone gate with gold trim in the upper middle stands on a
> floating island, slender gold-capped spires and broken floating rock fragments drift around it,
> a sea of moonlit clouds below, a deep navy sky full of stars and a warm golden glow behind the
> gate. The lower third of the image is a calm, dark, smooth stone arena platform with a thin gold
> edge, fading into deep shadow. Single warm gold key light, dimensional but restrained detail,
> premium clean painterly concept art, soft vignette. No people, no characters, no text, no
> letters, no logos, no emblems.

- **Why a:** a glowing gold gate on a floating island (gate recipe), with a dark platform for the
  title.
- **Rejected `card-b`** (a colonnade with a distant golden arch): its gold ellipse floor line runs
  through the title area.
  <https://cdn.magicpatterns.com/patterns/generated-images/ca935e48-9bfb-4741-9b9e-c54abc4382ab.jpg>

## Post-processing (`process-arena.py`, Pillow + NumPy)
It reuses the helpers of `docs/brand/bg/process-bg.py`.

**Backdrop (`make_bg`):**
1. **Resize and crop.** Lanczos-upscale to 1080 px wide (about 1.41x), centre-crop to 1920,
   then apply an unsharp mask (radius 1.6, 40%).
2. **Unify.**
   - Desaturate 12%.
   - Pull the deepest shadows (luminance below 0.22) up to 30% toward night-1 (#0d1322), so every
     arena's blacks match the navy board and panels.
3. **Highlight compression.** Above a per-arena knee (0.42–0.55), luminance rises at 0.45x with
   hue kept, so lava, ice and flames glow without outshining the board and tokens.
4. **Board band.**
   - The band is a superellipse centred at 46% height (matching the CSS `center 46%`), with radii
     of 42% of the width and 27% of the height.
   - Inside it, the image is 75% blended with a 14 px blur, then darkened by up to 45%.
5. **Contrast and vignette.** Reduce global contrast to 85%, then apply the elliptical vignette.
6. **Levelling.**
   - `frostkeep` gets exposure 0.75: its overall mean was 48 against about 30 for the others.
   - `apex` dims its bottom 30% by up to 30%: its bright cloud sea measured 62.
7. **Floor.** Lift the black point to night-0 (#070a12).

**Card (`make_card`):**
1. **Crop.** Take the largest 6:5 window at a per-arena offset and Lanczos-resize it to 1080x900.
   - The new cards are downscaled from 1113x928.
   - Moonrune is upscaled from the 768-wide portrait raw.
   - Apex uses an 82% window framed on the floating island and is upscaled.
   - Both upscaled cards get the same unsharp mask as the backdrops.
2. **Unify.** Desaturate 6% and pull the shadows up to 20% toward night-1.
3. **Highlight compression.** Use a knee of at least 0.55 and a slope of 0.6.
4. **Title zone.** Darken the lower part by up to 62% (from 52% of the height down), and the top
   by up to 22% for the frame brackets. Then apply a light vignette.
5. **Levelling.** `frostkeep` gets exposure 0.85.

**Encode:**
- Add luminance grain (sigma 0.9/255, seed 7).
- Save a PNG master.
- Save the WebP with method 6 at the highest quality from 90 down in steps of 2 that fits the
  budget (250 KB bg, 200 KB card). Every file fit at q90.

### Measured luminance (0–255, from the shipped WebPs)
Columns:
- **Board band:** the centre 70% x 45% at 46% height.
- **Top 15%** and **bottom 25%:** strips of the backdrop.
- **Card lower third:** the lower third of the card.

| Arena | bg overall | Board band mean / std | Top 15% | Bottom 25% | Card lower third |
| --- | --- | --- | --- | --- | --- |
| moonrune | 31.7 | 27.9 / 3.4 | 42.7 | 28.9 | 23.0 |
| emberforge | 30.1 | 24.5 / 4.2 | 43.2 | 34.0 | 20.2 |
| blightmire | 35.5 | 34.0 / 3.1 | 41.1 | 38.0 | 29.7 |
| frostkeep | 38.7 | 30.7 / 3.8 | 52.5 | 39.1 | 32.5 |
| madcrown | 29.2 | 24.0 / 2.1 | 41.1 | 30.7 | 23.4 |
| apex | 36.6 | 25.6 / 1.0 | 45.5 | 53.8 | 25.5 |
| (reference: `public/bg/match.webp`) | 30.8 | 27.3 / 3.0 | 40.4 | 28.2 | – |

## Licensing and source notes
- **Origin.** All images are original AI generations from the text prompts above. They used no
  reference images, photos, or third-party or game art. The prompts name no artist, game or
  franchise.
- **Content.**
  - The images contain no text, logos or emblems.
  - The moonrune floor keeps its invented glyph marks (see `docs/brand/bg/README.md`).
  - The madcrown windows have abstract tracery only.
  - The madcrown card shows a spiked dark throne. It is a generic fantasy motif, but check before
    store submission that it is not read as a well-known screen throne.
- **Rights.** The images were generated through the project's Magic Patterns account. Usage
  rights follow Magic Patterns' terms for generated images.
- **Before store submission.** Confirm the current terms and run a reverse-image search on the
  raw files. This has not been done yet.
