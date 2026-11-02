# Unit model licenses

The three unit files are built by `docs/brand/models/build.mjs` from free "Standard" packs by
Quaternius (https://quaternius.com). Armour, weapons, shields, capes, helmets, horns, the bull head,
tails, crowns, orbiting weapons and all colours / FX are generated at runtime by our own code
(`src/render/units/`); no other third-party assets are used.

| File | Source assets | Author | License | URL |
| --- | --- | --- | --- | --- |
| `hero.glb` (sad, marki, walk) | Universal Base Characters [Standard]: `Superhero_Male_FullBody` (body, eyes, eyebrows) + `T_Superhero_Male_Dark` texture | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalbasecharacters.html |
| `hero.glb` (walk outfit) | Modular Character Outfits - Fantasy [Standard]: `Male_Ranger_Body`, `_Arms`, `_Legs`, `_Feet_Boots`, `_Acc_Pauldron` + `T_Ranger_BaseColor` | Quaternius | CC0 1.0 | https://quaternius.com/packs/modularcharacteroutfitsfantasy.html |
| `imp.glb` (insaner) | Bestiary - Dungeon Monsters Kit [Standard]: `Imp.glb` (body, shorts, chains, spiked collar; the mace is not used) + `T_Imp_BaseColor_1`, `T_Imp_Emissive` | Quaternius | **Quaternius Asset License (QAL) v1.0** | https://quaternius.com/packs/bestiarydungeonmonsterskit.html · https://quaternius.com/license.html |
| `anims.glb` (all units) | Universal Animation Library [Standard] `UAL1_Standard.glb` (Idle_Loop, Sword_Idle, Jog_Fwd_Loop, Sprint_Loop, Sword_Attack, Punch_Cross, Hit_Chest, Death01) and Universal Animation Library 2 [Standard] `UAL2_Standard.glb` (Idle_Shield_Loop, Idle_FoldArms_Loop, Shield_OneShot, Shield_Dash, Sword_Regular_A, Sword_Regular_B, Melee_Hook, NinjaJump_Start, NinjaJump_Land) | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalanimationlibrary.html · https://quaternius.com/packs/universalanimationlibrary2.html |

License texts:
- CC0 packs: `License.txt` / `License_Standard.txt` in each pack — "CC0 1.0 Universal (CC0 1.0) Public
  Domain Dedication, https://creativecommons.org/publicdomain/zero/1.0/". No attribution required;
  credited here as a courtesy.
- Bestiary (imp): "Quaternius Asset License (QAL) v1.0 (https://quaternius.com/license.html)" — free
  use in personal, educational and commercial games and other products, no credit required; the
  assets themselves (original or modified) may NOT be resold or redistributed as standalone assets /
  asset packs. Here the imp is only shipped inside the game build as part of the product; do not
  publish `imp.glb` (or the source files) separately, e.g. in an asset or mod download.

Modifications (ours): leaf bones, unused meshes (the imp's mace) and all other clips removed; outfit
parts re-fitted (re-skinned) from the Regular_Male to the Superhero_Male skeleton and simplified with
meshoptimizer; eyes / eyebrows baked to vertex colours; textures downscaled and re-encoded as WebP
(hero body + Ranger outfit share one 2048x1024 atlas; the imp's emissive map is stored in the alpha
channel); normal / roughness / ORM maps dropped; animation clips reduced to bone rotations + the pelvis
translation, resampled, quantized and meshopt-compressed. At runtime the bodies are partly hidden,
recoloured and covered by generated armour shells and gear.
