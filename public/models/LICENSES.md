# Unit model licenses

All four unit models are built from public-domain (CC0 1.0) assets by
`docs/brand/models/build.mjs` (bull: converted first with `docs/brand/models/blend2glb.py`).
CC0 needs no attribution; credits are kept here as a courtesy.

| File | Source asset | Author | License | URL |
| --- | --- | --- | --- | --- |
| `sad.glb` (paladin) | KayKit Character Pack: Adventurers 1.0, `Knight.glb` + `sword_2handed_color`, `shield_round` | Kay Lousberg (kaylousberg.com) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 · https://kaylousberg.itch.io/kaykit-adventurers |
| `walk.glb` (shield bearer) | KayKit Character Pack: Adventurers 1.0, `Barbarian.glb` + `Knight_Helmet` (from `Knight.glb`), `shield_badge_color`, `shield_square_color`, `shield_round`, `sword_1handed` | Kay Lousberg | CC0 1.0 | same as above |
| `marki.glb` (bull) | Quaternius "Ultimate Animated Animals" (July 2021), `Bull.blend`; armour plates from KayKit `shield_round_color` / `shield_spikes_color` | Quaternius (quaternius.com), Kay Lousberg | CC0 1.0 | https://quaternius.com/packs/ultimateanimatedanimals.html |
| `insaner.glb` (imp) | KayKit Character Pack: Adventurers 1.0, `Rogue.glb` (body, face, `Knife`, `Knife_Offhand`; hair triangles stripped) + `rogue_texture.png` | Kay Lousberg | CC0 1.0 | same as `sad.glb` |

License texts:
- KayKit: `LICENSE.txt` in the pack — "License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — free to use in personal, educational and commercial projects."
- Quaternius: pack page states "CC0 License" (https://creativecommons.org/publicdomain/zero/1.0/).

Modifications (all ours, also CC0-compatible): unused clips/meshes removed, clips renamed
(`idle`, `run`, `jump`, `attack`, `death`), props re-parented, atlases downscaled/merged, bull
material colours baked to vertex colours, the rogue's hair triangles removed (bald imp skull),
meshopt + quantization compression. At runtime (`src/render/units/`) the palette atlas is baked into
per-level vertex colours, and all extra gear (capes, plumes, crowns, wings, visors, barding, mane,
horn wraps, spears, pennants, shield emblems, the imp's skull cap, horns, grin, tail, loincloth,
jester coat, bone mask, trident, flame cape and orbit shards), team colours, patterns and auras are
generated procedurally; no third-party assets are added.
