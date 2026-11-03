# GRID CLASH arena music (BGM)

Six original, seamless arena loops in `public/audio/bgm/<id>.m4a`, played by
`src/audio/music.ts`. They were composed in code (note data in Python), rendered offline with
FluidSynth and the FluidR3_GM SoundFont (MIT), and mixed and mastered in numpy/scipy. No
third-party recordings, samples packs or AI music models are used. Licences are listed in
`public/audio/LICENSES.md`.

## Files in this folder

| File | What it is |
| --- | --- |
| `tracks.py` | The six scores: progressions, parts, patterns, mix settings, plus the shared "Clash" leitmotif |
| `bgm_lib.py` | Engine: score model, libfluidsynth renderer (ctypes), synthesised layers, reverbs, EQ, glue compressor, true-peak limiter, seamless-loop cut |
| `build_bgm.py` | Renders, masters and encodes every track, and writes `loops.json` |
| `measure_bgm.py` | QA on the shipped files (decoded AAC): loudness, true peak, seam checks, spectrogram PNGs; writes `qa-bgm.json` |
| `loops.json` | Loop points per track (mirrored in `MUSIC_LOOPS` in `src/audio/music.ts`; a unit test keeps them in sync) |
| `qa-bgm.json` | The last measurement run (numbers below) |

## Regenerating

```sh
apt install fluidsynth fluid-soundfont-gm ffmpeg    # libfluidsynth 2.3.4, FluidR3_GM.sf2, ffmpeg 6.1 were used
pip install numpy scipy soundfile pyloudnorm matplotlib
python docs/brand/audio/bgm/build_bgm.py [id ...] --work /tmp/bgm-work     # ~10 min for all six on 4 CPU cores
BGM_WORK=/tmp/bgm-work python docs/brand/audio/bgm/measure_bgm.py --png /tmp/bgm-png
```

The render is deterministic: the same scripts and SoundFont give the same files. If loop lengths
change, update `MUSIC_LOOPS` in `src/audio/music.ts`; the `music assets` test fails until you do.

## Production family

All six tracks share:
- **The Clash leitmotif** (`MOTIF` / `MOTIF_B` in `tracks.py`): a 4 + 4 bar minor-mode phrase
  (1 - 5 - b6 | 5 - 4 - b3 | b6 - 5 - 4 - b3 | 2, answered by a rising variant ending on the 5th)
  over i - i - bVI - V. Each arena gives it a different voice.
- **The same space and master**: one synthetic stereo hall IR (frequency-dependent decay, early
  reflections) and one short room IR as send effects; the same master chain: a 2.8 kHz -1 dB dip
  (sampled-brass honk), a +3.5 dB shelf above 4 kHz, a -3 dB shelf below 90 Hz, a 32 Hz
  high-pass, a gentle 1.8:1 glue compressor, normalisation to -20 LUFS, and a 4x-oversampled
  look-ahead limiter with a -1.6 dBFS ceiling. In practice the limiter never reduces gain: the
  final masters' true peaks are -4.5 to -7.6 dBTP.
- **Percussion core**: the FluidR3 taiko patch plus a synthesised sub "boom" under strong hits, a
  synthesised reverse-noise swell into section downbeats, and a quiet periodic noise bed
  (mist, embers, fog, wind, fire or air).
- **Slow-attack pads**: SoundFont attack and release generators offset per part through
  `fluid_synth_set_gen`, and common tones tied across chord changes, not re-struck.
- **Form**: 8-bar sections, a sparser opening section, and an ending on V or on the Phrygian bII,
  so the jump back to bar 1 resolves.

## Tracks

| Track | Key | BPM | Bars / loop | Structure | Instrumentation (FluidR3_GM presets unless noted) | Leitmotif voice |
| --- | --- | --- | --- | --- | --- | --- |
| moonrune | D minor | 84 | 24 / 68.565 s | A (1–8) pulse + harp; B (9–16) horn motif, fuller taiko; C (17–24) choir, celesta, thinning to the A7 turnaround | Slow Strings pad, cello dotted pulse, contrabass, harp arpeggios, French horn, Ohh voices, celesta, soft taiko + sub boom, mist bed, 2 swells | French horn |
| emberforge | C minor (Phrygian Db) | 100 | 32 / 76.8 s | A forge ostinato + drums + anvils; B low-brass riff; C horns motif + choir, full drums; D half-time breakdown building back with tom/timpani fills | Cello 8th ostinato, contrabass, Strings pad, trombones + tuba, French horns, Ahh choir, timpani, taiko, concert bass drum (bank 8), toms, **synthesised anvils** (modal synthesis, two pitches), ember bed, 3 swells | French horns |
| blightmire | F# Phrygian | 90 | 24 / 64.0 s | A pizzicato 3+3+2 ostinato, koto Phrygian turns, hum; B shakuhachi motif, shaker; C bowed-glass shimmer; ends on bII (G) | Pizzicato strings, koto, tremolo-strings drone, contrabass, Ohh-voices hum with chromatic inner line, Bowed Glass pad, shakuhachi, congas/bongos (standard kit), shaker, taiko + sub boom, fog bed | Shakuhachi |
| frostkeep | B minor (Lydian maj7/#11 colour) | 96 | 28 / 69.995 s | A ambient bells + wide pads; B war drums enter + horn motif; C full, choir motif, glockenspiel; D 4-bar cool-down with timpani crescendo into the loop | Warm Pad, Halo Pad, Slow Strings, celesta ostinato, glockenspiel, tubular bells, contrabass, cello, French horns, Ahh choir, taiko war drums + concert BD + timpani + sub boom, ice-wind bed, 3 swells | Horns, then choir |
| madcrown | Bb harmonic minor | 110 | 32 / 69.824 s | A organ chords, dark choir, half pulse; B organ motif, full 8th pulse; C tremolo strings, trombone stabs, high choir motif, toms; D breakdown with tom crescendo into the loop | Church Organ 2 (bank 8, filtered), organ lead, low Ahh choir, Ohh voices, tremolo strings, cello ostinato, contrabass, trombones, church bell (bank 8), taiko pulse + concert BD + toms + sub boom, fire bed, 2 swells | Organ, then choir |
| apex | E minor with E-major lift | 120 | 36 / 72.0 s | A string ostinato + taiko; B horn motif + choir; C brass tutti motif + low brass, cymbals; D major lift (C–D–E) with trumpet, glockenspiel; E 4-bar transition on B | Strings staccato ostinato, cello marcato, contrabass, Slow Strings pad, French horns (motif + countermelody), Brass Section, trumpet, trombones, Ahh choir, harp sweeps, glockenspiel, timpani rolls, taiko + concert BD + orchestra-kit cymbals + sub boom, air bed, 3 swells | Horns, then brass tutti |

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

## Measurements (decoded .m4a, `measure_bgm.py`, 2026-11-03)

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
| madcrown | 672,056 / 656.3 | 70.848 | 69.824 | 74 | -20.0 | 3.0 | -7.6 | -10.1 / -9.1 | 0.495 | 2.1 / 3.5 |
| apex | 674,392 / 658.6 | 73.024 | 72.0 | 72 | -20.0 | 3.9 | -7.1 | -11.3 / -10.3 | 0.299 | 3.2 / 4.5 |

How to read the seam columns (definitions in `measure_bgm.py`):
- **Seam vs master** compares the 500 ms the player produces around the loop jump with the
  master's own continuous audio there. **Same window, no jump** is that comparison for the file
  played straight through.
  - The jump scores within 1.4 dB of straight playback, and on the better side for every track.
    So the seam adds no error beyond AAC coding.
  - The numbers near -10 dB come from the broadband reverse swell landing on the loop point in
    four tracks: the encoder codes noise loosely in waveform terms. The whole-loop codec residual
    is -15.0 to -16.7 dB.
- **Step ratio** is the sample step at the wrap divided by the 99.9th-percentile sample step
  inside the loop. Below 1 means no discontinuity.
  - Without the 40 ms blend (a plain loopStart/loopEnd jump), four tracks would exceed 1:
    emberforge 1.34, frostkeep 1.22, madcrown 1.01, apex 2.08.
  - Without the blend, the moonrune wrap shows a high-frequency spike of 8.2 dB, against 0.7 dB
    with it.
- **HF at seam** is the 8 kHz+ energy in a 6 ms window at the jump against the surrounding
  500 ms. It matches, or is below, the value for the file's own continuous audio at loopStart.
  Blightmire's 11.5 dB is its bar-1 conga/shaker downbeat, identical in straight playback.
- **Master seam residual** (pre-encode, cycle continuity) ranges from -188.9 to -219.8 dB.
- **Spectral balance** (long-term octave bands of the pre-encode masters, relative to 500 Hz) is
  warm by design, keeping the 1–4 kHz voice band clear:
  - 2 kHz: -7.5 to -10.1 dB;
  - 4 kHz: -12.6 to -20.0 dB;
  - 63 Hz: -0.9 to -4.9 dB.
- **Stereo** side/mid energy is -3.0 to -5.0 dB.
- **Spectrogram inspection** of the full loop and ±2 s around the jump showed no discontinuity
  for any track. The broadband stripes are the scored swells and drum hits. The AAC encoder's
  low-pass (spectrum 30 dB below its 6–8 kHz level) sits at 13.5–15.0 kHz.

## Limits

- The timbres are the FluidR3_GM General MIDI samples. They are good for a free GM bank but not
  a commercial orchestral library. Solo brass and choir in particular remain recognisably
  "sampled". Dark low-passing, slow attacks, layering and the hall reverb hide this, but nobody
  has listened to these files.
- Loudness range is narrow (LRA 1.5–4.1 LU). That suits background music under SFX and voice,
  but the sections contrast less than in a concert mix.
- A decoded loop costs about 27 MB of float32 memory (70 s, stereo, 48 kHz); the module keeps at
  most two.
