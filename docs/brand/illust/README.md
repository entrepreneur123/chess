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

## 라카엘리 Rakaeli (`rakaeli`, `rakaeli-awake`): 2026-11-04

Rakaeli has two forms, and each form has its own three masters:

- **Base form:** `illust-rakaeli-lv{1,2,3}.jpg`.
- **Transformed form, 타천:** `illust-rakaeli-awake-lv{1,2,3}.jpg`.

`process-illust.py` writes `public/chars/rakaeli-lv{n}[-face].jpg` and
`public/chars/rakaeli-awake-lv{n}[-face].jpg`. The design brief is the "Identity" section of
`docs/design/new-character-rakaeli.md`.

### Generation
- **Tool, OS and date:**
  - The same pipeline as Michelle and Picker: the Magic Patterns `generate_image` MCP tool, in
    the "GRID CLASH illustrations" OS (`mES6an8gxzuquCRoUq5cVM`).
  - Aspect ratio `3:4`, which returned 896x1200. 2026-11-04.
- **Reference chain:**
  - Base lv1 was generated from text only, then edited once with the lv1 image as the reference.
  - Base lv2 and lv3 used the chosen base lv1 (`rakaeli-lv1-e2`) as the reference.
  - Transformed lv1 also used the chosen base lv1 as the reference, so the face and hair match
    across forms.
  - Transformed lv2 and lv3 used the chosen transformed lv1 (`rakaeli-awake-lv1-a`) as the
    reference.
- **Candidates:** 21 requests and 21 images, with no provider blocks. All raw images are kept as
  448x600 JPEGs in `generated/rakaeli-*.jpg`.

| Slot | Candidates |
| --- | --- |
| base lv1 | 6 (`a`–`e` from text, plus `e2`, an edit of `e`) |
| base lv2 | 3 (`a`–`c`) |
| base lv3 | 3 (`a`–`c`) |
| transformed lv1 | 4 (`awake-lv1-a`–`d`) |
| transformed lv2 | 3 (`awake-lv2-a`–`c`) |
| transformed lv3 | 2 (`awake-lv3-a`, `b`) |

- **Post-processing:**
  - The picks are re-encoded at the original 896x1200 with PIL quality 88. There is no
    retouching.
  - The `FACE` table is now keyed by everything before `-lv`, so `rakaeli-awake` gets its own box.
    For every other id the key is unchanged.
  - The script was rerun, and the outputs for the seven existing characters came out
    byte-identical (`git status` shows no change under `public/chars/` except the new files).
- **Review:** the picks were checked on contact sheets next to all seven existing characters, at
  the same sizes as for Michelle and Picker:
  - card art at 180x240;
  - a hand-card crop at 100x180 (`50% 18%`);
  - face crops at 160px;
  - circular tokens at 40px and 80px, with both blue and red rims.

### Picks and reasons
| File | Candidate | Why |
| --- | --- | --- |
| `illust-rakaeli-lv1.jpg` | `rakaeli-lv1-e2` | `e` had the strongest silhouette and the most elegant face: ash-grey wings wrapped around his shoulders like a mantle, a hand on his heart and a lowered head. But its coat was almost all black, and its halo was scattered pieces. `e2` is `e` edited to add a wide bone-white stole and cuffs, which makes the coat clearly black-and-bone-white, and to make the halo one dim ring with a crack. |
| `illust-rakaeli-lv2.jpg` | `rakaeli-lv2-a` | Answers the brief directly: silver-thread feather and vine embroidery on the stole, collar and cuffs, a short embroidered capelet, a silver chain across the chest, and long broken chains that reach the hem. Same pose and face as lv1. |
| `illust-rakaeli-lv3.jpg` | `rakaeli-lv3-b` | The strongest signature glow: a pale-gold light burst behind him, a shining cracked halo, glowing pale-gold wing tips and floating luminous feathers, and gold filigree on the coat. At 40px it is clearly brighter than lv1 and lv2. |
| `illust-rakaeli-awake-lv1.jpg` | `rakaeli-awake-lv1-a` | Every transform cue reads: <ul><li>the blindfold burns off one side;</li><li>glowing crimson eyes and a cold smirk;</li><li>two short obsidian horns;</li><li>wide black wings with flaming crimson edges;</li><li>a broken crimson ring halo;</li><li>red cracks on the face and hand;</li><li>a crimson and violet aura;</li><li>a menacing reaching claw.</li></ul> The same face and hair as base lv1, and the same bone-white stole. |
| `illust-rakaeli-awake-lv2.jpg` | `rakaeli-awake-lv2-a` | It matches base lv2's upgrade language: silver thorn and feather embroidery, a chain across the chest and longer chains. So the 2성 step reads the same in both forms. |
| `illust-rakaeli-awake-lv3.jpg` | `rakaeli-awake-lv3-b` | A dark eclipse disc with a crimson corona behind his head, violet fire on the wing tips, crimson sigil embroidery on the stole and black-gold trim. In the token, the crimson ring around the head is a unique mark that no other character has. |

### Rejected candidates
- **base lv1:**
  - `a`: clean and readable, but a plain, stiff, frontal pose and a younger, blander face.
  - `b`: a dynamic reaching pose, but the head is small, so the face crop is weak.
  - `c`: floating and barefoot, with wide wings; a weaker face and a busy silhouette.
  - `d`: arms spread, with a cross-shaped front panel and a sweating, open-mouthed face. Off-mood.
  - `e`: became `e2`.
- **base lv2:**
  - `b`: large Christian cross motifs on the stole and a cross brooch. More overtly religious
    than needed.
  - `c`: an embroidered blindfold, but a chain wrapped around the neck reads like a collar.
- **base lv3:**
  - `a`: the glow is too subtle for a 3성.
  - `c`: a double halo with thorn-like spikes that reads as a crown of thorns, and the wings
    changed design (veined, butterfly-like).
- **transformed lv1:**
  - `b`: the blindfold is still on and the eyes glow through it, which misses the brief, and
    blood drips from the hands.
  - `c`: strong, but a snarling face that loses the cold elegance.
  - `d`: the figure is too small, so the head is tiny at token size, and blood drips from the
    hands.
- **transformed lv2:**
  - `b`: a cross brooch and a chain belt, and the torn hem is gone.
  - `c`: obsidian shoulder spikes clash with the priestly silhouette.
- **transformed lv3:**
  - `a`: the stole turns crimson, which loses the black-and-bone-white identity, and the glow is
    weaker than in `b`.

No candidate was rejected for resembling a known character. See the IP notes below.

### Face crop boxes
These are fractions of (w, h). One box serves all three grades of a form.

- `rakaeli: (0.273, 0.017, 0.72, 0.36)`: the halo, the hair and the blindfold band, down to the
  chin.
- `rakaeli-awake: (0.26, 0.017, 0.707, 0.36)`: the crimson ring halo, the horns, the eyes and the
  smirk. At lv3 it also takes in the eclipse corona.

At 40px:
- the base token reads as black hair with a dark band under a gold ring;
- the transformed token reads as magenta-red with horns and red eyes.

Neither collides with walk (black hair, blue scarf, no halo), insaner (purple skin, green eyes)
or michelle (black bob over a white face). Michelle is the closest at 40px, because both have
black hair over a pale lower face; Rakaeli's gold halo and white collar separate them.

### Prompts (winners)
**rakaeli-lv1-e** (text only, aspect 3:4; the base of the pick):
> Vertical character splash illustration for a dark fantasy mobile game in an angular shounen
> anime cel-shaded style with thick black ink outlines and hard flat shadows. Deep navy blue-black
> backdrop, vignette, sharp diagonal cyan and crimson slash streaks from the upper corners,
> floating shards, sparks and drifting grey feathers. Head-and-torso to knees composition filling
> the frame, head in the upper third near the centre. Subject: original character Rakaeli, a
> beautiful pale young man, late teens, a gentle melancholic fallen angel. Tousled midnight-black
> hair with a few strands over the blindfold. A black silk blindfold over both eyes, long black
> ribbon tails trailing in the wind. Sad soft mouth, pale skin. A dimmed, cracked gold halo
> floating behind his head. Large ash-grey wings folded around his shoulders like a cloak, some
> feathers torn. A long black-and-bone-white priestly coat with a tall collar, buttoned front,
> white trims, torn ragged hem, broken iron chain cuffs on each wrist. Pose: one hand pressed over
> his heart, the other hanging with a broken chain, head lowered, elegant and mournful. No weapon.
> No text, no letters, no logo, no watermark.

**rakaeli-lv1-e2** (reference: rakaeli-lv1-e; the pick):
> Edit the reference image: make his long priestly coat clearly black-and-bone-white. Add a wide
> bone-white priest's stole that hangs from his shoulders down both sides of the front of the black
> coat to the torn hem, and bone-white turned-back cuffs, so the coat reads as black with bold
> bone-white panels. Make the golden halo one dim, tarnished gold ring with a clear crack and a
> small gap, instead of scattered pieces. Keep everything else exactly the same: the young man, his
> face, the black silk blindfold with long ribbon tails, his midnight-black tousled hair, the
> folded ash-grey wings wrapped around his shoulders with torn feathers, the broken chain cuffs,
> the hand on his heart, the pose, the composition, the angular anime cel-shaded style with thick
> black outlines and the dark navy background with cyan and red diagonal slash streaks and floating
> shards. No weapon. No text, no letters, no logo, no watermark.

**rakaeli-lv2-a** (reference: rakaeli-lv1-e2):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with cyan and red diagonal slash
> streaks and floating shards). This is his upgraded 2-star form. Keep his face, the black silk
> blindfold with long ribbon tails, his midnight-black tousled hair, the hand on his heart and the
> folded ash-grey wings with a few torn feathers. Upgrades: a longer, more ornate ankle-length black
> priestly coat with a high collar, and a bone-white stole covered in fine silver-thread embroidery
> of feathers and vine patterns; silver-thread embroidery along the cuffs and coat edges; more
> chains: heavier broken chain cuffs on both wrists with longer dangling chains, plus a thin silver
> chain draped across his chest; the cracked dim golden halo now has small silver fittings. The
> coat hem is still torn. No weapon. No text, no letters, no logo, no watermark.

**rakaeli-lv3-b** (reference: rakaeli-lv1-e2):
> Redraw the character from the reference image as his legendary 3-star version. Keep the same
> blindfolded young man with midnight-black hair, the same face, the same hand-on-heart pose, the
> same framing and the same angular anime cel-shaded style with bold black outlines on the dark
> navy background with cyan and crimson diagonal slashes. Legendary upgrades: behind him a large
> faint pale-gold light burst, the cracked halo shining pale gold with motes of light; swirling pale
> gold and ash-grey glowing particles and floating luminous feathers around him; his
> black-and-bone-white priest coat is regal and longer with gold filigree trim, a gold-embroidered
> stole and a gold clasp; long ribbon tails of the black blindfold edged with thin gold thread;
> ash-grey wings with pale gold glowing feather tips; broken chains glowing faintly gold. Elegant,
> sorrowful, holy. No weapon. No text, no letters, no logo, no watermark.

**rakaeli-awake-lv1-a** (reference: rakaeli-lv1-e2):
> The same young man as in the reference image, same face, same midnight-black tousled hair, same
> black-and-bone-white priest coat with torn hem and broken chain cuffs, same angular shounen anime
> cel-shaded style with thick black outlines, same dark navy background with diagonal cyan and
> crimson slash streaks and floating shards. Now he has transformed into his fallen form. His black
> blindfold is burning away into embers and ash, revealing glowing crimson eyes. Two short curved
> obsidian-black horns grow from his head through his hair. His wings are blown wide open behind
> him, the feathers turned black with edges burning with crimson flame. His halo is now a broken
> crimson ring of light floating above the horns. Thin glowing red cracks run across his cheek,
> neck and hands. A crimson and violet aura swirls around him. Pose: dramatic and menacing, head
> raised, staring straight at the viewer with a cold faint smirk, one clawed open hand reaching
> forward with crimson energy, coat whipping in the wind. No weapon, no sword. Black hair only, no
> white hair. No text, no letters, no logo, no watermark.

**rakaeli-awake-lv2-a** (reference: rakaeli-awake-lv1-a):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with cyan and red diagonal slash
> streaks, crimson and violet aura). This is his upgraded 2-star transformed form. Keep his face
> with the cold smirk, glowing crimson eyes, the burning remains of the blindfold, black tousled
> hair, two short obsidian horns, the broken crimson ring halo, the red cracks on his skin, the wide
> black wings with crimson flame edges and the reaching clawed hand. Upgrades: a longer, more ornate
> ankle-length black priest coat with a high collar, a bone-white stole with fine silver-thread
> embroidery of thorns and feathers, silver-embroidered cuffs and edges; more chains: heavier broken
> shackles on both wrists with long swinging chains and a broken chain draped across his chest.
> Torn hem. No weapon. No text, no letters, no logo, no watermark.

**rakaeli-awake-lv3-b** (reference: rakaeli-awake-lv1-a):
> Redraw the character from the reference image as his legendary 3-star transformed version. Keep
> the same face, crimson eyes, smirk, black hair, short obsidian horns, broken crimson halo ring,
> pose and framing, and the same angular anime cel-shaded style with bold black outlines on the
> dark navy background with cyan and crimson diagonal slashes. Legendary upgrades: a massive
> crimson-violet glow; behind him a dark violet eclipse with a crimson corona; swirling crimson and
> violet flames and black feathers burning into embers all around; his flaming black wings spread
> even wider with violet fire tips; the obsidian horns have glowing crimson veins; his
> black-and-bone-white priest coat is regal and longer with black-gold filigree trim and a stole
> with glowing crimson sigil-like embroidery patterns; glowing red cracks run down his arms.
> Dangerous, regal. No weapon. No text, no letters, no logo, no watermark.

The other candidates used variations of the same text:
- base lv1: other poses (frontal, reaching, floating, arms spread);
- transformed lv1: other poses (arms spread low, a clawed hand by the face, hovering);
- lv2 and lv3: other upgrade lists on the same references.

### Source URLs (Magic Patterns CDN)
- rakaeli-lv1-e2: <https://cdn.magicpatterns.com/patterns/generated-images/b86e03df-1dac-449a-bb5e-576ef6bd34ac.jpg>
- rakaeli-lv2-a: <https://cdn.magicpatterns.com/patterns/generated-images/6d117da9-7977-46bf-8c21-ddff1590c28b.jpg>
- rakaeli-lv3-b: <https://cdn.magicpatterns.com/patterns/generated-images/c4023edc-90ee-4d22-b181-69386d12bf77.jpg>
- rakaeli-awake-lv1-a: <https://cdn.magicpatterns.com/patterns/generated-images/e8ef33e5-9d5c-4b89-a48e-ff919e2bf826.jpg>
- rakaeli-awake-lv2-a: <https://cdn.magicpatterns.com/patterns/generated-images/a5c18663-4f7d-479c-9cc9-a61ae100ad14.jpg>
- rakaeli-awake-lv3-b: <https://cdn.magicpatterns.com/patterns/generated-images/adf8b7cf-c075-4787-9837-650750e57d88.jpg>

### IP check notes
- **MapleStory's Damian (the owner's mood reference):**
  - Only the mood was taken: a pretty, melancholic fallen youth who turns demonic.
  - Rakaeli has:
    - midnight-black hair, not silver or white;
    - no weapon at all, and no greatsword;
    - a black-and-bone-white priest's cassock and stole with broken shackles, a blindfold and a
      halo. These are not Damian's costume elements.
  - The transformed form's red eyes, short horns and black wings are generic demon tropes. The
    prompts did not reference Damian's design, and nothing was copied from it.
- **Gojo (Jujutsu Kaisen):** the blindfold is paired with black hair, never white hair. The
  transformed prompts also say "black hair only, no white hair". The blindfold is silk with long
  ribbon tails, not a bandage-style wrap. Gojo is also not a winged, haloed or religious-coded
  design.
- **Other works:**
  - "Blindfolded angel", "fallen angel turning demon", "broken halo" and "chained priest" are
    common genre tropes. I found no single known character that combines black hair, a black
    blindfold, a cracked halo, folded grey wings and a bone-white stole.
  - This is a visual judgement by the art director, not a legal clearance.
- **Religious iconography:**
  - The picks keep it light: a priest's stole and cassock silhouette, and at base lv2 a small
    cross pendant on the chest chain.
  - Candidates with large cross motifs (`lv2-b`, `awake-lv2-b`) were rejected partly for this
    reason.
  - The lv3 stole patterns are abstract filigree and sigils, with no letters.
- **Rights:** the images were generated through the project's Magic Patterns account. Usage rights
  follow Magic Patterns' terms for generated images.

## 램피드 Rampid (`rampid`), 라르헨 Larhen (`larhen`) and 볼코노프 Volkonov (`volkonov`): 2026-11-05

### Generation
- **Tool, OS and date:**
  - The same pipeline as Michelle and Picker: the Magic Patterns `generate_image` MCP tool, in
    the "GRID CLASH illustrations" OS (`mES6an8gxzuquCRoUq5cVM`).
  - Aspect ratio `3:4`, which returned 896x1200. 2026-11-05. No paid third-party tool was used.
- **References:**
  - Each grade-1 image was generated from a text prompt that describes the house style above.
    The one exception is `rampid-lv1-d2`, an edit of `d` (rejected).
  - Grades 2 and 3 were each generated with the chosen grade-1 image as the reference image, so
    one face crop box serves all three grades.
- **Candidates:** 32 requests and 32 images, with no provider blocks. All raw images are kept as
  448x600 JPEGs in `generated/` (quality 78, progressive, matching the earlier raws).

| Character | lv1 | lv2 | lv3 | Total images |
| --- | --- | --- | --- | --- |
| rampid | 6 (`a`–`e` from text, plus `d2`, an edit of `d`) | 3 | 3 | 12 |
| larhen | 5 (`a`–`e`) | 3 | 3 | 11 |
| volkonov | 4 (`a`–`d`) | 3 | 2 | 9 |

- **Post-processing:**
  - The picks are re-encoded at the original 896x1200 and PIL quality 88 as
    `illust-{id}-lv{n}.jpg` (baseline, 4:2:0, the same as the earlier masters). There is no
    retouching.
  - `process-illust.py` gained one `FACE` entry per character. It was then run, and all 54
    existing outputs under `public/chars/` came out byte-identical (MD5 compared before and
    after).
- **Review:** each candidate was checked in contact sheets next to the existing characters at
  the same sizes:
  - card art at 180x240;
  - a hand-card crop at 100x180 (`object-fit: cover`, `50% 18%`);
  - face crops at 160px, cut with the same code as `process-illust.py`;
  - circular tokens at 40px and 80px, with both blue (`#3b8bff`) and red (`#ff4655`) rims.
  Hands were checked at full resolution for every pick.

### Picks and reasons
| File | Candidate | Why |
| --- | --- | --- |
| `illust-rampid-lv1.jpg` | `rampid-lv1-e` | The largest, best-lit face of the set, with a wide grin and bright cyan eyes. The sky-blue hair is unique in the roster and reads at 40px. The dark navy scarf separates the head from the white jacket. Each gauntlet ends in exactly three curved ice talons, which matches his three-pronged forward move. He crouches on a frozen ramp, carved by his skate blades. |
| `illust-rampid-lv2.jpg` | `rampid-lv2-a` | Keeps the white jacket, black trousers and navy scarf from lv1 and adds faceted ice-crystal pauldrons, a chest guard, knee guards and armoured boots. The gauntlets are heavier, with longer talons. The crystal pauldron also shows in the face crop. |
| `illust-rampid-lv3.jpg` | `rampid-lv3-c` | Cyan frost flames around the whole body and hair, a storm of ice shards, and glowing eyes. The lv2 crystal armour now has silver filigree trim. The navy backdrop stays dark, so the glow is the strongest on the sheet, and the 40px token is clearly brighter than lv1 and lv2. |
| `illust-larhen-lv1.jpg` | `larhen-lv1-e` | The only lv1 that reads at token size: he leaps in front of a large pale full moon, so his long black hair and dark coat form a sharp silhouette on a bright disc. The other four are dark figures on a dark backdrop. Cold, composed face, clean grip on a silver dagger in each hand, and indigo smoke below. |
| `illust-larhen-lv2.jpg` | `larhen-lv2-a` | The clearest upgrade: articulated dark-steel pauldrons, crossed buckled straps, an indigo half-cape, engraved bracers and finer engraved daggers. Same face, pose and moon. |
| `illust-larhen-lv3.jpg` | `larhen-lv3-c` | Silver and indigo aura smoke wraps his head and shoulders. His eyes glow silver, and silver arcs trail from both daggers. He wears silver filigree trim and silver shoulder armour. The full moon becomes a thin crescent, so at token size lv3 reads differently from lv1 and lv2: a smoky silver aura instead of a plain moon disc. |
| `illust-volkonov-lv1.jpg` | `volkonov-lv1-b` | The clearest 실눈캐 face: closed, upturned smiling crescents and a calm smile. His wine-red hair in a low ponytail is unique in the roster at 40px. He wears a burgundy coat with a cream cravat. A ring of rose-magenta notes on staff lines circles him, giving the signature colour at lv1. |
| `illust-volkonov-lv2.jpg` | `volkonov-lv2-a` | "Richer coat, ornate instrument": gold note-and-stave embroidery on the lapels, cuffs and hem, a ruffled cravat with a small gold note brooch, a rose sash, and a lute with a gold rosette and a rose ribbon. The ruffle shows in the token. The lute stays wooden, so lv3's gilded lute is still a step up. |
| `illust-volkonov-lv3.jpg` | `volkonov-lv3-b` | The strongest aura of the set: a large glowing circle of rose-magenta staff lines and notes behind him, a warm gold light, drifting petals and sparkles, gold epaulettes and filigree, and a gilded lute. At 40px the token turns rose-gold, which no other character has. |

### Rejected candidates
- **rampid-lv1:**
  - `a`: good, with literal three-talon gauntlets. But the white scarf, pale jacket and pale
    hair merge into one pale blob at 40px.
  - `b`: shorts over leggings, and a smaller head.
  - `c`: four-fingered ice gloves rather than three talons, and an open-mouthed shout.
  - `d`: a strong composition, but each hand has four or five claws.
  - `d2`: `d` edited to three talons, but four claws per hand came back.
- **rampid-lv2:**
  - `b`: good, but the change at card size is smaller than in `a`.
  - `c`: a full ice suit that drops the white jacket and black trousers, so it reads as a
    different costume.
- **rampid-lv3:**
  - `a`: the glow is too subtle for a 3성.
  - `b`: the strongest light, but the whole backdrop turns pale ice, the hair blends into it at
    40px, and the lv2 crystal armour is replaced by a different jacket.
- **larhen-lv1:**
  - `a`, `d`: western-comic faces, and dark on dark at token size.
  - `b`: the runner-up (a moon glow behind him), but the glow is small and his face is
    plainer.
  - `c`: a strong crossed-dagger silhouette, but a grey, gaunt face, and too dark at 40px.
- **larhen-lv2:**
  - `b`: the curved daggers and the gorget read less "assassin" than the straight blades.
  - `c`: good, but the change at token size is smaller than in `a`.
- **larhen-lv3:**
  - `a`: the afterimages read as two other men standing in the background.
  - `b`: clean, but at token size it is almost identical to lv2.
- **volkonov-lv1:**
  - `a`: soft and pleasant, but light brown hair and a cream coat give a weak token.
  - `c`: a big, readable head, but the eyes read as sleeping (downward curves) rather than an
    eye-smile.
  - `d`: a joyful open laugh, but the dark brown hair at 40px is close to walk.
- **volkonov-lv2:**
  - `b`: a gilded lute already, which leaves lv3 less to escalate.
  - `c`: inlaid lute and a gold chain, but the coat change is the subtlest of the three.
- **volkonov-lv3:**
  - `a`: the glow wraps only the lute area, which is weaker than `b`.

### Face crop boxes
These are fractions of (w, h). One box serves all three grades.

- `rampid: (0.24, 0.06, 0.68, 0.39)`: the whole spiky sky-blue hair, the grin and the navy
  scarf. At lv2 and lv3 the crystal pauldron edge shows; at lv3 so do the frost flames.
- `larhen: (0.28, 0.06, 0.70, 0.375)`: the face, the long hair streaming right and the collar,
  against the moon at lv1 and lv2 and against the crescent and aura at lv3.
- `volkonov: (0.30, 0.05, 0.72, 0.36)`: the wine-red hair, the closed-eye smile, the ponytail and
  the cravat.

At 40px:
- rampid reads as sky-blue hair over a navy scarf;
- larhen reads as a dark-haired head on a pale moon disc, or on silver smoke at lv3;
- volkonov reads as wine-red hair over cream and burgundy, or rose-gold at lv3.

None of these collide with an existing token. The closest is larhen and walk (both
black-haired), but walk has a blue scarf and no moon.

### Prompts (winners)
**rampid-lv1-e** (text only, aspect 3:4):
> Vertical character splash illustration for a dark fantasy mobile game. Angular shounen anime
> cel-shaded style: thick clean black ink outlines, flat hard-edged cel shading, crisp angular
> cloth folds. Background: deep navy blue-black with a soft vignette, sharp diagonal speed-slash
> streaks in electric cyan and crimson from the upper corners, floating ice shards and sparks. One
> dynamic figure fills the frame, head large in the upper third near the centre, face fully lit.
> Subject: original character Rampid, a speedy cocky teenage ice boy, about fifteen, alone. Messy
> spiky sky-blue hair, bright ice-cyan eyes, a wide confident grin. Outfit: plain light winter
> gear, a short frost-white windbreaker jacket with ice-blue panels, a dark navy scarf whipping
> behind him, dark trousers, boots with long gleaming ice-blade runners. Each hand wears a chunky
> translucent blue ice gauntlet with exactly three long curved ice talons, a three-pronged ice
> claw. Pose: racing forward toward the viewer on a frozen ice track that he freezes in mid-air
> beneath his blades, curving up like a ramp, low crouch, one three-talon claw thrust forward, the
> other swept back, frost spray and a long ice trail behind him. Glacial ice-cyan and frost-white
> palette. No metal blades. No text, no letters, no logo, no watermark.

**rampid-lv2-a** (reference: rampid-lv1-e):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with cyan and red diagonal slash
> streaks and floating ice shards). This is his upgraded 2-star form. Keep his face and grin, his
> messy sky-blue hair, the dark navy scarf, the frozen ice ramp under his blades. Upgrades: light
> frost armour over his white jacket, a faceted ice-crystal shoulder pauldron, an ice-blue chest
> guard with silver edges, crystal knee guards, armoured skate boots with longer ice blades, and
> bigger heavier ice gauntlets with exactly three much longer, sharper curved ice talons on each
> hand. No metal blades. No text, no letters, no logo, no watermark.

**rampid-lv3-c** (reference: rampid-lv1-e):
> Redraw the ice boy from the reference image as his legendary 3-star version. Keep the same boy,
> the same face and grin, the same messy sky-blue hair, the same dark navy scarf, the same dashing
> pose and framing, and the same angular shounen anime cel-shaded style with thick black outlines
> on the dark navy background with diagonal cyan and crimson slash streaks. Legendary upgrades: a
> strong glacial aura, bright ice-cyan frost light flaring around his whole body and his hair like
> cold flames, a dense storm of sharp glowing snow shards and ice crystals whirling around him,
> frost mist; his eyes glow ice-cyan; faceted ice-crystal armour on his shoulders, chest and knees
> with ornate silver legendary trim over his white jacket; large glowing crystal ice gauntlets each
> with exactly three long curved ice talons blazing with cold light; the ice ramp under his blades
> is a glowing glacier. The navy background stays dark so he glows against it. No metal blades. No
> text, no letters, no logo, no watermark.

**larhen-lv1-e** (text only, aspect 3:4):
> Vertical character splash illustration for a dark fantasy mobile game. Angular shounen anime
> cel-shaded style: thick clean black ink outlines, flat hard-edged cel shading, crisp angular
> cloth folds. Background: deep navy blue-black with a soft vignette, a large pale silver full moon
> glowing behind his head and shoulders, sharp diagonal speed-slash streaks in electric cyan and
> crimson from the upper corners, floating shards and sparks, curling deep indigo smoke below. One
> dynamic figure fills the frame, head in the upper third near the centre, face fully lit by cold
> moonlight. Subject: original character Larhen, a professional assassin, a man in his thirties,
> alone. Long dark hair flowing behind him in the wind, a lean handsome mature face, light stubble,
> cold composed silver-grey eyes, a calm unreadable expression. Outfit: plain dark leather assassin
> gear with steel-grey accents, a fitted charcoal leather coat with a high collar and silver-grey
> edge trim, a deep indigo sash, leather bracers, dark gloves, soft boots. A straight polished
> silver dagger in each hand, blades catching bright moonlight. Pose: mid-air at the top of a very
> high leap in front of the moon, knees tucked, coat tails flaring, one dagger raised and one held
> low. Moonlit silver steel and deep indigo palette. No hood, no mask. No blood. No text, no
> letters, no logo, no watermark.

**larhen-lv2-a** (reference: larhen-lv1-e):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with the large pale moon behind him,
> cyan and red diagonal slash streaks, indigo smoke). This is his upgraded 2-star form. Keep his
> face, cold silver-grey eyes, stubble and long dark flowing hair. Upgrades: a finer black leather
> assassin coat with articulated dark steel shoulder plates, silver buckled straps across the
> chest, a deep indigo sash and a short indigo half-cape on one shoulder, engraved steel bracers;
> his two daggers are finer: longer polished silver blades with engraved fullers and
> indigo-wrapped hilts with silver crossguards, one in each hand. No hood, no mask. No blood. No
> text, no letters, no logo, no watermark.

**larhen-lv3-c** (reference: larhen-lv1-e):
> Redraw the assassin from the reference image as his legendary 3-star version. Keep the same man,
> the same face with stubble, the same long dark flowing hair, the same leaping pose and framing,
> and the same angular shounen anime cel-shaded style with thick black outlines on the dark navy
> background with diagonal cyan and crimson slash streaks. The moon behind him becomes a thin
> glowing silver crescent and the night sky darker, so his own aura stands out. Legendary upgrades:
> a strong aura of deep indigo smoke and bright silver light swirling tightly around his head,
> shoulders and body, silver light edging his hair; his eyes glow cold silver; a motion trail of
> indigo and silver afterimage streaks follows his leap, blurred copies of his silhouette fading
> behind him; his black leather coat has ornate silver filigree legendary trim, silver shoulder
> armour and a deep indigo half-cape; his twin silver daggers glow bright moonlit silver, leaving
> glowing silver arcs. No hood, no mask. No blood. No text, no letters, no logo, no watermark.

**volkonov-lv1-b** (text only, aspect 3:4):
> Vertical 3:4 character art for a dark fantasy anime mobile game, angular shounen anime
> cel-shaded style with bold black ink outlines and hard flat shadows. Dark navy night backdrop
> with a vignette, sharp diagonal cyan and red speed-line slashes from the top corners, floating
> shards and sparks. Three-quarter-length composition filling the frame, head in the upper third
> near the centre. Subject: original character Volkonov, a charming bard, a man about twenty-five,
> alone. Neat medium-length dark wine-red hair tied in a low ponytail with a loose fringe, eyes
> permanently closed as two thin smiling curves, the classic squinting eye-smile character, a calm
> knowing smile, face clearly lit. Outfit: a plain long traveller's coat in deep burgundy with
> cream lapels, a cream cravat, a satchel strap across the chest, simple gold buttons, dark
> trousers and boots. He holds a lute-like string instrument with a round wooden body and strums
> it. Glowing rose-magenta musical notes and soft rings of sound waves flow out of the instrument
> and float around him. Pose: standing in a relaxed dynamic lean, one foot forward, coat tail
> fluttering. Rose-magenta and warm gold palette. No hat. No text, no letters, no logo, no
> watermark.

**volkonov-lv2-a** (reference: volkonov-lv1-b):
> Same character, same pose, same composition and same art style as the reference image (angular
> anime cel shading, bold black outlines, dark navy backdrop with cyan and red diagonal slash
> streaks, floating shards). This is his upgraded 2-star form. Keep his face with eyes always
> closed in thin smiling curves, his calm smile and his wine-red hair in a low ponytail. Upgrades:
> a richer long burgundy coat with gold embroidery of musical notes and flowing stave lines along
> the hem, cuffs and lapels, gold buttons, a cream ruffled cravat with a small gold brooch shaped
> like a musical note, a rose-coloured sash; his lute is now ornate, with a polished dark wood
> body, gold inlay rosette, gold tuning pegs and a rose silk ribbon tied to the neck. More
> rose-magenta glowing musical notes on a ring of staff lines around him. No hat. No text, no
> letters, no logo, no watermark.

**volkonov-lv3-b** (reference: volkonov-lv1-b):
> Same character, same pose, same composition and same art style as the reference image, as his
> legendary 3-star form. Keep his face with closed smiling crescent eyes, his smile and his
> wine-red ponytail. Legendary: a dazzling rose-magenta aura, a large glowing circle of
> rose-magenta staff lines and floating notes encircling him like a ring, a soft warm gold light
> behind him, rose petals of light and gold sparkles drifting in the air; his coat is an opulent
> burgundy and cream performer's coat with gold filigree trim, gold epaulettes and gold-embroidered
> note motifs; his lute is gilded, glowing warm gold, with music pouring out of it as luminous rose
> ribbons. No hat. No text, no letters, no logo, no watermark.

The other candidates used variations of the same text:
- lv1: other outfits and poses (a hoodie or bomber jacket and a ramp jump for Rampid; crossed
  daggers, a dive or a half ponytail for Larhen; other hair colours and coats for Volkonov);
- lv2 and lv3: other upgrade lists on the same references.

### Source URLs (Magic Patterns CDN)
- rampid-lv1-e: <https://cdn.magicpatterns.com/patterns/generated-images/24ddd66e-b43d-4574-baa1-4c8962f1107a.jpg>
- rampid-lv2-a: <https://cdn.magicpatterns.com/patterns/generated-images/2d371074-564f-430c-95d0-b35b4c522788.jpg>
- rampid-lv3-c: <https://cdn.magicpatterns.com/patterns/generated-images/89f2aad6-5442-4c21-a1de-43261f4385c0.jpg>
- larhen-lv1-e: <https://cdn.magicpatterns.com/patterns/generated-images/d3349f57-cfbe-478d-8744-0425946e7e39.jpg>
- larhen-lv2-a: <https://cdn.magicpatterns.com/patterns/generated-images/f61ffd30-e11c-45c8-8332-f9611f8efd3c.jpg>
- larhen-lv3-c: <https://cdn.magicpatterns.com/patterns/generated-images/bd7e1352-82fe-464d-9e29-fe68153058a3.jpg>
- volkonov-lv1-b: <https://cdn.magicpatterns.com/patterns/generated-images/e3cc14b1-9217-49f9-b004-74b8c2f7dbab.jpg>
- volkonov-lv2-a: <https://cdn.magicpatterns.com/patterns/generated-images/d146ca18-752d-40bb-8d2f-1fa94c67a742.jpg>
- volkonov-lv3-b: <https://cdn.magicpatterns.com/patterns/generated-images/937f84a5-0a76-4925-bdb0-365cc017d93d.jpg>

### Notes for review
- **Small-size escalation:**
  - Larhen's lv1 and lv2 tokens are nearly identical at 40px, because the moon disc dominates.
    The change shows at hand-card size (pauldrons and the indigo cape).
  - Larhen's lv3 trades the full moon for a crescent and an aura. That makes its token darker
    than lv1 and lv2, but clearly different from them. If a brighter lv3 token is preferred,
    `larhen-lv3-b` keeps the full moon.
  - Rampid and Volkonov escalate clearly at every size.
- **Music notation:** Volkonov's embroidery and aura contain notes, treble-clef shapes and staff
  lines. These are notation symbols, not letters, and no readable text appears in the picks.
- **IP check (a visual judgement by the art director, not a legal clearance):**
  - **Rampid:**
    - Three claws per hand is a trope strongly associated with Wolverine. Rampid's talons are
      translucent ice grown from a gauntlet, not metal blades from the knuckles, on a cheerful
      teenager with ice skates.
    - Jack Frost (*Rise of the Guardians*) has white hair, a hoodie and a staff. Rampid has
      sky-blue hair, a windbreaker and armour, and no staff.
    - Ice skating on self-made ice trails is a common power trope.
  - **Larhen:**
    - A long-haired assassin with twin daggers in front of a full moon is a common genre image.
    - There is no hood, so he avoids the *Assassin's Creed* silhouette.
    - I found no single known character with this combination.
  - **Volkonov:**
    - Closed-eye "실눈캐" bards are a common anime archetype.
    - He differs from Venti (*Genshin Impact*: dark braids with teal tips, green cape, lyre),
      Jaskier/Dandelion (*The Witcher*: feathered cap, doublet) and Gin Ichimaru (silver hair,
      no instrument).
    - Wine-red hair, a burgundy coat and a rose staff ring are not tied to any one character I
      know of.
- **Religious iconography:** none in the picks. The lv3 aura circles are staff-line rings and
  frost or moon light, with no crosses or sigils.
- **Rights:** the images were generated through the project's Magic Patterns account. Usage rights
  follow Magic Patterns' terms for generated images.
