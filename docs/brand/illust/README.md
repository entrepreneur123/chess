# Character illustration masters (`docs/brand/illust/`)

`illust-{id}-lv{1,2,3}.jpg` are the masters for each character's three grades (1성 / 2성 / 3성).
`../process-illust.py` derives the shipped files from them:

- `public/chars/{id}-lv{n}.jpg`: 540x720 card art.
- `public/chars/{id}-lv{n}-face.jpg`: a 320x320 head crop, cut with the per-character `FACE` box.
  The board token (`unitArt` in `src/ui/components/piece.ts`, `.token__art`) shows the whole face
  file clipped to a circle.

## House style (as observed in the sad / marki / walk / insaner / brutile masters)
- 896x1200 (3:4) JPEG. The brutile masters, made with the same tool as the entries below, are
  baseline JPEG quality 88 with 4:2:0 chroma, and the new masters match that.
- Angular shounen-anime cel shading: thick black ink outlines, two or three hard tones per
  surface, crisp angular cloth folds.
- Backdrop: deep navy blue-black with a soft vignette. Sharp diagonal speed-slash streaks in
  electric cyan and crimson cut in from the upper corners. Floating glass-shard particles and
  sparks.
- One dynamic figure fills the frame, with the head in the upper third.
- Grade escalation:
  - **lv1:** plain gear.
  - **lv2:** upgraded gear in the same pose.
  - **lv3:** legendary trim, plus a strong glow or aura in the character's signature colour
    (gold for sad, lava for marki, violet for walk, green for brutile).

## 미셸 Michelle (`michelle`) and 피커 Picker (`picker`): 2026-11-04

### Generation
- **Tool:** the Magic Patterns `generate_image` MCP tool, in the project's "GRID CLASH
  illustrations" OS (`mES6an8gxzuquCRoUq5cVM`). It returned 896x1200 for aspect ratio `3:4`.
  No paid third-party tool was used.
- **Date:** 2026-11-04.
- **References:**
  - The existing masters are local files and cannot be passed to the tool. It accepts only canvas
    images, which the user has to upload, or Magic Patterns CDN URLs. So each grade-1 image was
    generated from a text prompt that describes the house style above.
  - Grades 2 and 3 were each generated with the chosen grade-1 image as a reference image. That
    locks the face, the pose and the framing, so the face crop box is the same for all three
    grades.
- **Candidates:** 25 requests and 24 images. All raw images are kept as 448x600 JPEGs in
  `generated/`.

| Character | lv1 | lv2 | lv3 | Total images |
| --- | --- | --- | --- | --- |
| michelle | 5 requested, 4 returned (`a` was blocked by the provider: `IMAGE_PROHIBITED_CONTENT`) | 3 | 3 | 10 |
| picker | 8 (`a`–`e`, plus `b2`, an edit of `b`, plus `f` and `g`) | 3 | 3 | 14 |

- **Post-processing:**
  - The picks are re-encoded at the original 896x1200 and PIL quality 88 as
    `illust-{id}-lv{n}.jpg`. There is no retouching.
  - `process-illust.py` gained one `FACE` entry per character. It was then run, and the outputs
    for the existing characters came out byte-identical.
- **Review:** each pick was checked in the following contact sheets, with the five existing
  characters at the same sizes:
  - card art at 180x240;
  - a hand-card crop at 100x180 (`object-fit: cover`, `50% 18%`);
  - face crops at 160px;
  - circular tokens at 40px (1x) and 80px (2x), with both blue and red team rims.

### Picks and reasons
| File | Candidate | Why |
| --- | --- | --- |
| `illust-michelle-lv1.jpg` | `michelle-lv1-c` | Strongest silhouette of the set: a blunt bob with eye-covering bangs, a large patched button-eyed doll and a crouched creeping pose. The pale lower face reads at 40px. The hands are clean. |
| `illust-michelle-lv2.jpg` | `michelle-lv2-b` | Answers "more dolls and stitched ribbons" directly: a patchwork bow, stitched ribbons, three small button-eyed dolls on her capelet, sash and skirt, and cross-stitched seams. Her identity and pose match lv1. |
| `illust-michelle-lv3.jpg` | `michelle-lv3-a` | The doll's button eyes glow cyan, translucent doll silhouettes with glowing eyes float around her, and a cyan and violet aura with glowing seams surrounds her. It keeps the lv1 pose, so the three grades read as one character. |
| `illust-picker-lv1.jpg` | `picker-lv1-b2` | Candidate `b` was the closest to the roster's clean anime faces, and his face is fully lit under the brim. `b` had a second, gun-belt-like strap slung on the hip; `b2` is `b` edited down to one plain belt. |
| `illust-picker-lv2.jpg` | `picker-lv2-c` | The clearest upgrade over lv1: an intact long leather duster, a silver buckle hat band, studded chaps, silver rowel spurs, and a silver rope with a cyan glint on the loop. |
| `illust-picker-lv3.jpg` | `picker-lv3-a` | A single, coherent glowing golden lasso, a gold-embroidered crimson coat, golden spurs and a band of swirling sunset-amber dust. |

### Rejected candidates
- **michelle-lv1:**
  - `b`: long hair, a black pinafore, the doll dangling.
  - `d`: an ash smock and long plum-black hair, twirling. It was the runner-up, but its
    silhouette is weaker at token size.
  - `e`: at small size the bangs read like a black blindfold band.
- **michelle-lv2:**
  - `a`: a stray spike shape by her arm.
  - `c`: lost the striped stockings, so it is less consistent with lv1.
- **michelle-lv3:**
  - `b`: the ghost dolls read as cute blobs.
  - `c`: the strongest drama (floating, with marionette silhouettes on strings), but the pose
    changed and the legs read wrong.
- **picker-lv1:**
  - `a`, `c`, `d`: each has an empty holster on the hip.
  - `b`: a slung gun-belt strap; it became `b2`.
  - `e`: a grittier, more realistic comic style, off-style.
  - `f`: the second strap came back.
  - `g`: acceptable, but the hat shadow covers his eyes.
- **picker-lv2:**
  - `a`: the coat hem is still tattered.
  - `b`: good, but the lasso glint is weaker than in `c`.
- **picker-lv3:**
  - `b`: the glowing rope loops around him several times and no longer reads as one lasso.
  - `c`: a sunset disc and a fur collar, but there is a thigh tie-down strap that reads like a
    holster tie.

### Face crop boxes
These are fractions of (w, h). One box serves all three grades.

- `michelle: (0.285, 0.095, 0.775, 0.461)`: the whole hair dome, the lower face and the doll's
  head with its button eyes. At lv3 the glowing eye shows in the token.
- `picker: (0.26, 0.04, 0.72, 0.383)`: the full hat, the face and the scarf.

### Prompts (winners)
**michelle-lv1-c** (text only, aspect 3:4):
> Vertical 3:4 character art for a dark fantasy anime mobile game, in an angular shounen anime
> cel-shaded style with bold black ink outlines and hard flat shadows. Dark navy night backdrop
> with a vignette, sharp diagonal cyan and red speed-line slashes from the top corners, floating
> shards and sparks. Full-figure dynamic composition that fills the frame, head in the upper third
> near the centre. Subject: original character Michelle, a small eerie gloomy girl, around nine,
> pale grey-white skin. Dark charcoal hair in a blunt bob with a thick fringe of bangs that falls
> over her eyes and completely hides them; the lower half of her face, a tiny nose and a flat sad
> mouth, is clearly visible. Outfit: a muted plum Victorian smock with lace-trimmed cuffs and hem,
> a little ash-grey shawl, striped plum and grey stockings, black buttoned shoes. She clutches a
> large patched button-eyed rag doll tightly against her cheek with both hands; the doll is sewn
> from mismatched fabric scraps with big visible stitches. Pose: crouching low in a forward lunge
> as if creeping across the arena, skirt flaring, small and spooky. Non-violent, modest, eerie not
> scary. No braids, no pigtails, no white collar. No text, no letters, no logo, no watermark.

**michelle-lv2-b** (reference: michelle-lv1-c):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with cyan and red diagonal slash
> streaks and floating shards). This is her upgraded 2-star form: more dolls and stitched ribbons.
> She now has a ribbon headband with a large plum bow sewn from patchwork, stitched ribbons
> trailing from her hair and wrists, a darker plum smock with an ash-grey lace capelet and visible
> cross-stitch embroidery, and three small patched rag dolls with button eyes clinging to her
> capelet, her sash and her skirt, while she still hugs the big patchwork button-eyed doll. Her
> heavy bangs still completely cover her eyes; her pale lower face, small nose and small unsmiling
> mouth stay visible. Eerie but non-violent, modest child clothing. No text, no letters, no logo,
> no watermark.

**michelle-lv3-a** (reference: michelle-lv1-c):
> Redraw the character from the reference image as her legendary 3-star version. Keep the same
> girl, the same face, the same black bob with heavy blunt bangs that completely cover her eyes,
> the same crouching pose and framing, and the same angular shounen anime cel-shaded style with
> thick black outlines on a dark navy background with diagonal cyan and crimson slash streaks.
> Legendary upgrades: a haunting aura of glowing spectral cyan and violet mist swirls around her;
> the button eyes of the big patched doll she hugs glow bright cyan; several translucent ghostly
> doll silhouettes with glowing button eyes float in the air around her; glowing cyan stitched
> threads drift like ribbons; her plum Victorian smock is ornate, darker, with silver-grey lace and
> glowing cross-stitch seams; her hair lifts in a spectral wind. Eerie and haunting but
> non-violent, modest child clothing, no blood. No text, no letters, no logo, no watermark.

**picker-lv1-b** (text only, aspect 3:4; the base of the pick):
> Vertical character splash illustration for a dark fantasy mobile game. Angular shounen anime
> cel-shaded style: thick clean black ink outlines, flat hard-edged cel shading, crisp sharp
> shapes. Background: deep navy blue-black with a soft vignette, sharp diagonal speed-slash streaks
> in electric cyan and crimson cutting in from the upper corners, floating shards, sparks and
> drifting dust. Three-quarter-length figure filling the frame, head in the upper third and
> centred. Subject: original character Picker, a laconic frontier gunslinger-styled cowboy, about
> 35, alone. Angular jaw, light stubble, a thin scar on his cheek, calm narrowed amber eyes, a
> toothpick in the corner of his mouth, face fully visible. Outfit: a dusty dark brown cowboy hat
> with a cord band, a long tattered khaki duster coat blowing in the wind, a grey neckerchief, a
> plain shirt with rolled sleeves, a wide leather belt with an empty buckle and no holster,
> fingerless leather gloves, brown leather boots. He throws a rope lasso toward the viewer: the
> loop flies forward in a big open circle, the rest of the rope coiled in his other hand, one
> continuous rope. Dynamic leaning pose, coat flaring. Absolutely no gun, no pistol, no holster,
> no rifle, no horse, no cattle, no animals. No text, no letters, no logo, no watermark, no frame,
> no border.

**picker-lv1-b2** (reference: picker-lv1-b; the pick):
> Edit the reference image: remove the second, lower leather belt that hangs diagonally across his
> hips and its dangling strap, so he wears only one plain trouser belt with a simple buckle and
> nothing hangs at his hips. Keep everything else exactly the same: the man, his face, hat, scarf,
> toothpick, duster coat, gloves, rope lasso, boots, pose, composition, the angular anime
> cel-shaded style and the dark navy background with cyan and red diagonal slash streaks. No gun,
> no holster. No text, no letters, no logo, no watermark.

**picker-lv2-c** (reference: picker-lv1-b2):
> Upgrade the cowboy in the reference image to a 2-star version while keeping his identity, his
> face, his pose, the framing, the illustration style and the background. Give him a better coat:
> a long deep-brown waxed duster with clean edges, dark leather shoulder panels and turned-up
> collar. A better hat with a silver buckle band, a navy scarf, leather chaps with silver studs
> over his trousers, and boots with large shiny silver rowel spurs. His lasso rope gleams with a
> silver wire weave and catches a bright cyan glint on its loop, one continuous rope. A single
> plain belt with nothing hanging from it. Absolutely no gun, no pistol, no holster, no gun belt,
> no rifle, no horse, no cattle, no animals. No text, no letters, no logo, no watermark.

**picker-lv3-a** (reference: picker-lv1-b2):
> Redraw the cowboy from the reference image as his legendary 3-star version. Keep the same man,
> the same face with stubble and toothpick, the same pose with the lasso loop in his right hand and
> coils in his left, the same framing, and the same angular shounen anime cel-shaded style with
> thick black outlines on a dark navy background with diagonal cyan and crimson slash streaks.
> Legendary upgrades: his lasso is a blazing golden rope of light, glowing bright gold with sparks
> trailing from the loop, one continuous rope; a dramatic sunset-dust aura of swirling glowing
> amber and orange dust and sand surrounds him, lit from behind by a warm sunset rim light; his
> long duster coat is a majestic deep brown-crimson with ornate gold embroidery and gold trim
> flaring in the wind; a dark hat with a gold band; golden spurs; a golden glint in his eyes. A
> single plain belt with nothing hanging from it. Absolutely no gun, no pistol, no holster, no gun
> belt, no rifle, no horse, no cattle, no animals; he is alone. No text, no letters, no logo, no
> watermark.

The rejected candidates used variations of the same text: other poses, long hair instead of a
bob, a pinafore or cardigan for Michelle, and an overhead spin or a shoulder-slung coil for
Picker. The lv2 and lv3 alternatives used the same reference with different upgrade lists.

### Source URLs (Magic Patterns CDN, permanent)
- michelle-lv1-c: <https://cdn.magicpatterns.com/patterns/generated-images/562c840e-98ca-4580-9c4e-457b33407e60.jpg>
- michelle-lv2-b: <https://cdn.magicpatterns.com/patterns/generated-images/5566ddb3-c7bd-406e-9142-80ef75e63082.jpg>
- michelle-lv3-a: <https://cdn.magicpatterns.com/patterns/generated-images/4f30b8fa-01f4-4f9b-9c69-9ffc4a83109a.jpg>
- picker-lv1-b2: <https://cdn.magicpatterns.com/patterns/generated-images/5b024edf-ab45-4269-8b94-86e480f1b66c.jpg>
- picker-lv2-c: <https://cdn.magicpatterns.com/patterns/generated-images/3ecc7802-6f14-4abe-9716-f701ac7e0b32.jpg>
- picker-lv3-a: <https://cdn.magicpatterns.com/patterns/generated-images/3bc426c2-3d04-4ff4-82ff-ca6c64fc847a.jpg>

### Notes for review
- **Michelle and other works:**
  - Her design avoids the Wednesday Addams combination (twin braids, a black dress with a white
    collar) and young Jinx/Powder's blue braids.
  - Button-eyed stitched dolls are a common motif, but they are also strongly associated with
    *Coraline*.
  - Striped stockings with a black bob are a common gothic look.
- **Picker's golden lasso:** a glowing golden lasso is also the signature item of Wonder Woman's
  Lasso of Truth. Here it is a cowboy's rope with a sunset-dust theme, not that design.
- **Small-size escalation:** at hand-card size, the lv1 to lv2 change is subtler for both new
  characters than for brutile. Michelle gains a bow and small dolls; Picker gains a darker coat.
  lv3 is clearly distinct for both.
- **Rights:** the images were generated through the project's Magic Patterns account. Usage rights
  follow Magic Patterns' terms for generated images.
