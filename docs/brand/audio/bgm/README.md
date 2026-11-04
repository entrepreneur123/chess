# GRID CLASH music (BGM)

Seven original, seamless loops in `public/audio/bgm/<id>.m4a`, played by `src/audio/music.ts`:
one per arena, plus the lobby/home theme `lobby`.

**Where each plays** (`src/ui/musicBridge.ts`):
- The lobby and every tab screen (shop, collection, formation, arenas) play `lobby`.
- A match plays its arena's track: the matchmaking VS card starts it, and it carries through the
  match and the result panel. The search phase before the VS card keeps whatever was playing (the
  lobby theme, or the previous match's track on a rematch, so it does not bounce through the lobby
  theme for 1-2 s).
- Leaving the result panel (lobby or shop) crossfades back to `lobby`; the module keeps the two
  most recent decoded loops, so the lobby theme returns from memory without a new download.

They were composed in code (note data in Python), rendered offline with
FluidSynth and the FluidR3_GM SoundFont (MIT), and mixed and mastered in numpy/scipy. No
third-party recordings, samples packs or AI music models are used. Licences are listed in
`public/audio/LICENSES.md`.

## Files in this folder

| File | What it is |
| --- | --- |
| `tracks.py` | The seven scores: progressions, parts, patterns, mix settings, plus the shared "Clash" leitmotif (minor, and the lobby's major variant) |
| `bgm_lib.py` | Engine: score model, libfluidsynth renderer (ctypes), synthesised layers, reverbs, EQ, glue compressor, true-peak limiter, seamless-loop cut |
| `build_bgm.py` | Renders, masters and encodes every track, and writes `loops.json` |
| `measure_bgm.py` | QA on the shipped files (decoded AAC): loudness, true peak, seam checks, spectrogram PNGs; writes `qa-bgm.json` |
| `audit_bgm.py` | Distinctness audit of the shipped files: key, tempo, brightness, rhythm and timbre distances between tracks, plus score-level instrument overlap (numbers in "Distinctness audit" below) |
| `loops.json` | Loop points per track (mirrored in `MUSIC_LOOPS` in `src/audio/music.ts`; a unit test keeps them in sync) |
| `qa-bgm.json` | The last measurement run (numbers below) |

## Regenerating

```sh
apt install fluidsynth fluid-soundfont-gm ffmpeg    # libfluidsynth 2.3.4, FluidR3_GM.sf2, ffmpeg 6.1 were used
pip install numpy scipy soundfile pyloudnorm matplotlib
python docs/brand/audio/bgm/build_bgm.py [id ...] --work /tmp/bgm-work     # 2.5-3.5 min per track on 4 CPU cores
BGM_WORK=/tmp/bgm-work python docs/brand/audio/bgm/measure_bgm.py --png /tmp/bgm-png
python docs/brand/audio/bgm/audit_bgm.py                                     # distinctness audit (prints)
```

The render is deterministic: the same scripts and SoundFont give the same files. If loop lengths
change, update `MUSIC_LOOPS` in `src/audio/music.ts`; the `music assets` test fails until you do.

## Production family

All seven tracks share:
- **The Clash leitmotif** (`MOTIF` / `MOTIF_B` in `tracks.py`): a 4 + 4 bar minor-mode phrase
  (1 - 5 - b6 | 5 - 4 - b3 | b6 - 5 - 4 - b3 | 2, answered by a rising variant ending on the 5th)
  over i - i - bVI - V. Each arena gives it a different voice. The lobby quotes it in a major,
  heroic variant (`MOTIF_MAJ` / `MOTIF_MAJ_B`: 1 - 5 - 6 | 5 - 4 - 3 | 6 - 5 - 4 - 3 | 2 with a
  fanfare pickup on the tonic, over I - I - IV - V; the answer climbs to the upper tonic and ends on
  the leading tone).
- **The same space and master**: one synthetic stereo hall IR (frequency-dependent decay, early
  reflections) and one short room IR as send effects; the same master chain: a 2.8 kHz -1 dB dip
  (sampled-brass honk), a +3.5 dB shelf above 4 kHz, a -3 dB shelf below 90 Hz, a 32 Hz
  high-pass, a gentle 1.8:1 glue compressor, normalisation to -20 LUFS, and a 4x-oversampled
  look-ahead limiter with a -1.6 dBFS ceiling. In practice the limiter never reduces gain: the
  final masters' true peaks are -4.4 to -7.6 dBTP.
- **Percussion core**: the FluidR3 taiko patch plus a synthesised sub "boom" under strong hits, a
  synthesised reverse-noise swell into section downbeats, and a quiet periodic noise bed
  (mist, embers, fog, wind, fire or air).
- **Slow-attack pads**: SoundFont attack and release generators offset per part through
  `fluid_synth_set_gen`, and common tones tied across chord changes, not re-struck.
- **Form**: 8-bar sections, a sparser opening section, and an ending on V or on the Phrygian bII,
  so the jump back to bar 1 resolves.

The lobby deliberately leaves the arena palette: it is the only major-key track, and the only one
with a drum-kit backbeat (snare and claps on 2 and 4), tambourine, a bass guitar and marimba. Its
opening has no sustained pad (the strings enter at bar 9), unlike every arena opening.

## Tracks

| Track | Key | BPM | Bars / loop | Structure | Instrumentation (FluidR3_GM presets unless noted) | Leitmotif voice |
| --- | --- | --- | --- | --- | --- | --- |
| moonrune | D minor | 84 | 24 / 68.565 s | A (1–8) pulse + harp; B (9–16) horn motif, fuller taiko; C (17–24) choir, celesta, thinning to the A7 turnaround | Slow Strings pad, cello dotted pulse, contrabass, harp arpeggios, French horn, Ohh voices, celesta, soft taiko + sub boom, mist bed, 2 swells | French horn |
| emberforge | C minor (Phrygian Db) | 100 | 32 / 76.8 s | A forge ostinato + drums + anvils; B low-brass riff; C horns motif + choir, full drums; D half-time breakdown building back with tom/timpani fills | Cello 8th ostinato, contrabass, Strings pad, trombones + tuba, French horns, Ahh choir, timpani, taiko, concert bass drum (bank 8), toms, **synthesised anvils** (modal synthesis, two pitches), ember bed, 3 swells | French horns |
| blightmire | F# Phrygian | 90 | 24 / 64.0 s | A pizzicato 3+3+2 ostinato, koto Phrygian turns, hum; B shakuhachi motif, shaker; C bowed-glass shimmer; ends on bII (G) | Pizzicato strings, koto, tremolo-strings drone, contrabass, Ohh-voices hum with chromatic inner line, Bowed Glass pad, shakuhachi, congas/bongos (standard kit), shaker, taiko + sub boom, fog bed | Shakuhachi |
| frostkeep | B minor (Lydian maj7/#11 colour) | 96 | 28 / 69.995 s | A ambient bells + wide pads; B war drums enter + horn motif; C full, choir motif, glockenspiel; D 4-bar cool-down with timpani crescendo into the loop | Warm Pad, Halo Pad, Slow Strings, celesta ostinato, glockenspiel, tubular bells, contrabass, cello, French horns, Ahh choir, taiko war drums + concert BD + timpani + sub boom, ice-wind bed, 3 swells | Horns, then choir |
| madcrown | Bb harmonic minor | 110 | 32 / 69.824 s | A organ chords, dark choir, half pulse; B organ motif, full triplet (12/8) pulse; C tremolo strings, trombone stabs, high choir motif, toms; D breakdown with a triplet tom crescendo into the loop | Church Organ 2 (bank 8, filtered), organ lead, low Ahh choir, Ohh voices, tremolo strings, cello triplet ostinato, contrabass, trombones, church bell (bank 8), taiko triplet pulse + concert BD + toms + sub boom, fire bed, 2 swells | Organ, then choir (swung onto the triplet grid) |
| apex | E minor with E-major lift | 120 | 36 / 72.0 s | A string ostinato + taiko; B horn motif + choir; C brass tutti motif + low brass, cymbals; D major lift (C–D–E) with trumpet, glockenspiel; E 4-bar transition on B | Strings staccato ostinato, cello marcato, contrabass, Slow Strings pad, French horns (motif + countermelody), Brass Section, trumpet, trombones, Ahh choir, harp sweeps, glockenspiel, timpani rolls, taiko + concert BD + orchestra-kit cymbals + sub boom, air bed, 3 swells | Horns, then brass tutti |
| **lobby** (home, not an arena) | Eb major | 104 | 32 / 73.856 s | A (1–8) the groove alone: kit backbeat with claps and tambourine, bass guitar, marimba hook, brass downbeat chord and "and-of-4" pushes; B (9–16) strings enter, trumpet + horn motif (major); C (17–24) a new playful flute tune doubled on glockenspiel, brass punches, tambourine 16ths, open hats; D (25–32) tutti motif on trumpet over trombones and horns, ending on V (Bb) with a snare-and-clap roll into the loop | Standard GM kit (kick, snare, claps, hats, tambourine, crash), Acoustic Bass, marimba, Strings, Brass Section, trumpet, French horns, trombones, flute, glockenspiel, taiko + sub boom on section downbeats, air bed, 4 swells | Trumpet (horns an octave below), then trumpet over the brass tutti |

## Seamless loop construction

1. The loop length L is the bar count at the tempo, rounded to a multiple of 1024 samples at
   48 kHz (one AAC frame, and a multiple of FluidSynth's 64-sample block). The tempo shift is at
   most 0.009 %. All note and controller events are placed on the 64-sample grid, so FluidSynth
   renders an identical, sample-exact performance in every cycle.
2. The score is rendered four times back to back. Reverb, compression and limiting run on that
   continuous signal, and cycle 2 is kept. Its start already holds cycle 1's ringing tails and
   reverb, exactly as the loop's own end feeds it. With only one warm-up cycle, the tubular bells'
   very long releases still differed by about -58 dB between cycles. With two, the master's seam
   residual is -189 dB or lower.
3. The file is `[24576 samples of the music before the loop][the loop][24576 samples after]`
   (0.512 s guard pads, also frame-aligned), encoded as AAC-LC 48 kHz stereo.
4. `src/audio/music.ts` copies `[loopStart, loopEnd)` into its own AudioBuffer. It blends the last
   40 ms into the audio just before `loopStart` (`buildLoopBuffer`) and plays it with
   `loop = true`. The last sample therefore flows into the first, whatever encoder priming or
   coding noise a platform decoder produces.

## Measurements (decoded .m4a, `measure_bgm.py`; lobby and madcrown 2026-11-04, the others 2026-11-03)

How they were measured:
- Loudness and true peak come from ffmpeg 6.1 `ebur128=peak=true` on each .m4a.
- Everything else comes from the file decoded by ffmpeg to 48 kHz float.
- The decoded audio aligns with the pre-encode master at an offset of 0 samples for every file:
  ffmpeg applies the MP4 edit list.
- No listening test was possible in this environment. The checks are numeric plus spectrogram
  inspection.

| Track | File (bytes / KiB) | File s | Loop s | AAC kb/s | I (LUFS) | LRA (LU) | True peak (dBTP) | Seam vs master / same window, no jump (dB) | Step ratio | HF at seam / at loopStart (dB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moonrune | 677,770 / 661.9 | 69.589 | 68.565 | 76 | -20.0 | 1.5 | -5.5 | -19.1 / -18.1 | 0.281 | 0.7 / 1.0 |
| emberforge | 680,503 / 664.6 | 77.824 | 76.8 | 68 | -20.0 | 3.6 | -6.9 | -10.5 / -9.8 | 0.357 | 0.5 / 1.7 |
| blightmire | 669,495 / 653.8 | 65.024 | 64.0 | 80 | -20.0 | 1.9 | -6.5 | -18.9 / -18.4 | 0.059 | 11.5 / 11.5 |
| frostkeep | 673,813 / 658.0 | 71.019 | 69.995 | 74 | -20.0 | 4.1 | -4.4 | -11.6 / -10.2 | 0.59 | 1.5 / 3.0 |
| madcrown | 672,001 / 656.3 | 70.848 | 69.824 | 74 | -20.1 | 3.4 | -7.2 | -10.3 / -9.3 | 0.963 | 2.4 / 3.6 |
| apex | 674,392 / 658.6 | 73.024 | 72.0 | 72 | -20.0 | 3.9 | -7.1 | -11.3 / -10.3 | 0.299 | 3.2 / 4.5 |
| lobby | 676,043 / 660.2 | 74.88 | 73.856 | 70 | -19.8 | 4.2 | -3.9 | -9.6 / -8.6 | 0.500 | 0.5 / 0.8 |

How to read the seam columns (definitions in `measure_bgm.py`):
- **Seam vs master** compares the 500 ms the player produces around the loop jump with the
  master's own continuous audio there. **Same window, no jump** is that comparison for the file
  played straight through.
  - The jump scores within 1.4 dB of straight playback, and on the better side for every track.
    So the seam adds no error beyond AAC coding.
  - The numbers near -10 dB come from the broadband reverse swell landing on the loop point in
    five tracks: the encoder codes noise loosely in waveform terms. The whole-loop codec residual
    is -15.0 to -16.7 dB for the arenas and -10.5 dB for the lobby, whose hats, tambourine and
    crash are noise-like high-frequency content that AAC at 70 kb/s codes loosely in waveform
    terms (a waveform measure, not a perceptual one).
  - Integrated loudness is -20.0 LUFS on every pre-encode master (pyloudnorm). Decoded, the files
    read -19.8 to -20.1 LUFS in ffmpeg's ebur128.
- **Step ratio** is the sample step at the wrap divided by the 99.9th-percentile sample step
  inside the loop. Below 1 means no discontinuity.
  - Without the 40 ms blend (a plain loopStart/loopEnd jump), four tracks would exceed 1:
    emberforge 1.34, frostkeep 1.22, madcrown 1.12, apex 2.08 (lobby 0.76).
  - Without the blend, the moonrune wrap shows a high-frequency spike of 8.2 dB, against 0.7 dB
    with it.
- **HF at seam** is the 8 kHz+ energy in a 6 ms window at the jump against the surrounding
  500 ms. It matches, or is below, the value for the file's own continuous audio at loopStart.
  Blightmire's 11.5 dB is its bar-1 conga/shaker downbeat, identical in straight playback.
- **Master seam residual** (pre-encode, cycle continuity) ranges from -188.9 to -219.8 dB
  (lobby -219.4, madcrown -218.7).
- **Spectral balance** (long-term octave bands of the pre-encode masters, relative to 500 Hz) is
  warm by design for the arenas, keeping the 1–4 kHz voice band clear under in-match voice lines:
  - 2 kHz: -7.5 to -10.1 dB;
  - 4 kHz: -12.6 to -20.0 dB;
  - 63 Hz: -0.9 to -4.9 dB.
  The lobby is brighter on purpose (2 kHz -4.4, 4 kHz -9.1, 8 kHz -12.4, 63 Hz -2.2 dB): it is the
  festive home theme and plays under far fewer voice lines; the module ducks it by 8 dB when one
  plays.
- **Stereo** side/mid energy is -3.0 to -5.0 dB for the arenas and -6.4 dB for the lobby (its kit,
  bass and lead sit in the centre).
- **Spectrogram inspection** of the full loop and ±2 s around the jump showed no discontinuity
  for any track. The broadband stripes are the scored swells and drum hits. The AAC encoder's
  low-pass (spectrum 30 dB below its 6–8 kHz level) sits at 13.5–15.1 kHz.

## Distinctness audit (2026-11-04)

Request: every arena has its own BGM, and the lobby differs from all of them. Measured on the
decoded files (mono 22.05 kHz), over the first 10 s of the loop (what a player hears on entering)
and over the whole loop. Five feature groups, each divided by the median arena-arena value of that
group so that 1.0 is a typical arena pair, then averaged:
- timbre: Euclidean distance of the mean MFCCs 1–13;
- brightness: the spectral-centroid ratio (log2) plus the energy above 2 kHz;
- tempo: the BPM ratio (log2);
- rhythm: 1 minus the correlation of the bar-folded onset pattern (48 slots per bar, so 16ths and
  triplets both land on the grid);
- tonal: 1 minus the chroma correlation, plus 1 if the estimated modes differ.

`audit_bgm.py` prints these tables.

| Track | Key (est. from audio, r) | BPM (est.) | Centroid Hz (whole / first 10 s) | Energy > 2 kHz dB | Nearest track, first 10 s | Nearest track, whole loop |
| --- | --- | --- | --- | --- | --- | --- |
| moonrune | D minor (0.91) | 84 (85) | 452 / 420 | -17.4 | blightmire 0.90 | frostkeep 0.70 |
| emberforge | C minor (0.63) | 100 (99) | 391 / 302 | -19.7 | blightmire 0.70 | frostkeep 0.92 |
| blightmire | D-major pitch set (0.77; F# Phrygian) | 90 (91) | 392 / 353 | -17.7 | emberforge 0.70 | frostkeep 0.86 |
| frostkeep | B minor (0.78) | 96 (96) | 462 / 586 | -17.5 | lobby 0.88 | moonrune 0.70 |
| madcrown | Bb minor (0.77) | 110 (110) | 488 / 409 | -14.3 | apex 0.77 | apex 0.77 |
| apex | E minor (0.84) | 120 (120) | 496 / 339 | -15.6 | madcrown 0.77 | madcrown 0.77 |
| **lobby** | **Eb major (0.79)** | 104 (103) | **763 / 644** | **-11.9** | frostkeep 0.88 | madcrown **1.51** |

Score matrix, whole loop (first 10 s in brackets):

| | moonrune | emberforge | blightmire | frostkeep | madcrown | apex | lobby |
| --- | --- | --- | --- | --- | --- | --- | --- |
| moonrune | | 1.01 (1.14) | 1.02 (0.90) | 0.70 (0.99) | 1.14 (1.05) | 1.32 (1.17) | 1.89 (1.51) |
| emberforge | | | 1.30 (0.70) | 0.92 (1.12) | 0.99 (0.90) | 1.26 (1.06) | 1.84 (1.33) |
| blightmire | | | | 0.86 (0.88) | 1.76 (1.37) | 1.58 (1.29) | 1.62 (1.30) |
| frostkeep | | | | | 1.03 (1.17) | 0.81 (1.12) | 1.68 (0.88) |
| madcrown | | | | | | 0.77 (0.77) | 1.51 (1.38) |
| apex | | | | | | | 1.66 (1.34) |

Score-level instrument overlap (Jaccard index of the sounding GM programs and drum keys) in the
first 10 s: the lobby shares at most 0.19 with any arena; arena pairs reach 0.25–0.67. Kick, snare,
claps, closed hat, crash, tambourine, marimba, bass guitar and the Brass Section opening chord sound
in the lobby's first 10 s and in no arena's.

Findings:
- No two arenas measure as the same music. All six tonics differ, tempos are 6–17 % apart, and each
  has its own lead colour. The closest whole-loop pairs are moonrune/frostkeep (0.70: both slow,
  dark string-and-pad beds) and madcrown/apex (0.77: both dense and bright with choir, brass and a
  fast taiko pulse; organ against staccato strings).
- The largest single similarity was rhythmic: emberforge and madcrown used the same straight-8th
  cello ostinato (root, root, fifth, root, ...) over the same taiko 8th pulse; their whole-loop
  rhythm correlation was 0.87 (0.92 on a 16th grid), the highest of any pair. Fix (cheap, same
  loop length): madcrown's cello ostinato, taiko pulse and tom fills now run in triplets (a 12/8
  lilt), and its motif is swung onto that grid. Emberforge/madcrown rhythm correlation 0.87 ->
  0.78; their opening score 0.76 -> 0.90. Madcrown's nearest neighbour is still apex at 0.77
  (unchanged), so this separates the pair that shared an engine but does not move the closest pair.
- The lobby is the most distinct track over the whole loop (nearest 1.51; every arena's nearest is
  0.70–0.92) and has the largest mean distance over the first 10 s (1.29). Its nearest opening is
  frostkeep's (0.88), whose ice-bell A section is the brightest and most major-sounding arena
  opening (Bmadd9 - Gmaj7 - D - A); the instrument overlap of those two openings is 0.18.
- Key choice for the lobby: rotating the lobby's chroma through all 12 major keys, Eb major had
  the lowest overlap with the arenas (max chroma correlation 0.15 over the openings, 0.39 over whole
  loops; F major, the first draft, reached 0.74 and 0.65 against madcrown and moonrune, since F
  major is D minor's relative major).

Nobody has listened to these files; the audit is numeric, plus spectrogram inspection.

## Limits

- The timbres are the FluidR3_GM General MIDI samples. They are good for a free GM bank but not
  a commercial orchestral library. Solo brass and choir in particular remain recognisably
  "sampled". Dark low-passing, slow attacks, layering and the hall reverb hide this, but nobody
  has listened to these files.
- Loudness range is narrow (LRA 1.5–4.1 LU). That suits background music under SFX and voice,
  but the sections contrast less than in a concert mix.
- A decoded loop costs about 27 MB of float32 memory (70 s, stereo, 48 kHz); the module keeps at
  most two (in practice the lobby theme and the last match's track).
