# Character audio pipeline (voices + SFX)

## Current cast: ElevenLabs (shipped 2026-11-07)

Every shipped voice clip comes from ElevenLabs (owner's workspace, Creator plan: commercial licence;
`public/audio/LICENSES.md`). The pipeline is driven through the ElevenLabs connector (no API key):

1. **Voice design** — one voice per character from a text prompt (`creative_design_voice`, model
   `eleven_ttv_v3`, language `ko`, a 100+ character Korean sample line in the character's register),
   previews measured for register (median F0 with `v4`'s autocorrelation tracker, loudness, length)
   and the best saved (`creative_save_designed_voice`). Ids: `lines.json` → `elevenlabs.voice_id`.
   The safety filter refuses child / teen descriptions, so Michelle is an airy adult voice in a high
   register lifted +2 st in mastering, and Rampid a light, high, energetic adult male voice.
2. **Direction** — `v4/direction.json`: per line, `eleven_v4` audio tags + the spoken text
   (`[calm] [warmly] [composed] 명을 받들겠습니다.`). `v4/merge_direction.py` writes it into
   `lines.json` as `v4` and the tag-free caption as `text` (it fails on a missing or extra line).
3. **Render** — `creative_generate_speech` with the character's voice id and `eleven_v4`, two takes
   per line, ~35 credits a take (the full cast: 343 takes). Generation ids per line: `v4/gens.tsv`
   (`char  id  gen1  gen2`, `-` = no second take). The mp3 takes are downloaded from the signed
   `content_url`s of `creative_get_flow_run_status` into a scratch directory (not committed).
4. **Master** — `v4/master_v4.py --gens v4/gens.tsv --raw <takes dir> --out public/audio/vo`:
   per line both takes are trimmed (lead -42 dB with 20 ms pre-roll, tail -54 dB + 180 ms) and
   measured; quick events (select / move / capture / skill / chain / trap / hop / awake-*) take the
   shorter take, one-off moments (death / victory / awake-end) the longer; a take under 0.45 s or
   with a flat-topped peak is rejected. Treatment: 60 Hz high-pass; `"fx": "rakaeli-awake"` lines get
   the demon layer (-1 st and -0.8 st detuned copies, formant preserved, 15 ms delay, dark room);
   Michelle +2 st; Midos a short slap echo. Loudness -16 LUFS integrated, limiter ceiling -3 dB
   before the encoder; the decoded AAC is re-measured and the ceiling lowered until the true peak is
   under -1.5 dBTP (48 kb/s was measured to add up to 2.4 dB of overshoot, so 64 kb/s is used).
   Overs are consonant spikes of 0.1-1 ms (5-30 ms per clip in total), so the 1.5 ms look-ahead
   limiter may take up to 15 dB off them; a sustained over beyond 4 dB leaves the clip quieter
   instead (flagged). QA per clip in `v4/qa-v4.json` (take, candidates, duration, LUFS, true peak,
   gain, limiting, attempts, size).
5. `python3 write_manifest.py`, `python3 write_audition.py`, gates, `VOICE_LINES_READY` stays true.

Result (172 clips, 16 characters): LUFS -17.0 … -15.7 (sad death-1 is the one clip left 1 dB under
target, its opening gasp is a 16 dB spike), true peak ≤ -1.33 dBTP, 0.80-5.02 s, 5,828-42,232 bytes,
3,434,898 bytes in all (`tests/voice.test.ts` budget raised to 4.25 MiB for vo + sfx).

To change a line: edit `v4/direction.json`, run `merge_direction.py`, render the line, add its
generation ids to `gens.tsv`, run `master_v4.py --only <char>:<id>` (or `--only <char>`), then the
manifest. Everything below this point documents the earlier Qwen3-TTS pipeline (2026-11-03 →
2026-11-07): it is history, nothing shipped comes from it any more, and its scripts and `refs/` are
kept only for reference.

## Current effects: ElevenLabs Sound Effects (sfx-v2, shipped 2026-11-07)

The 68 character / generic effects (`public/audio/sfx/<name>.m4a`, same names and events as before,
so `write_manifest.py` and `src/audio/voice.ts` needed no change) are ElevenLabs
`eleven_text_to_sound_v2` renders:

1. **Prompts** — `sfx-v2/prompts.json`: one concrete sound per effect (the gesture the old
   synthesis aimed at, in the model's own terms: texture, transient, space), requested length
   0.5-1.8 s, `prompt_influence` 0.55 (0.7 on the four re-renders).
2. **Render** — one `sfx` node per effect on flow `hPMT5V9ngdzZBGXWqnJ2` (`sfx-v2/nodes.tsv`),
   run in batches of 20 with two takes each (2-6 credits a take). Takes are downloaded from the
   signed `content_url`s into a scratch directory; generation ids per take: `sfx-v2/gens.tsv`.
   Four effects (walk-select, michelle-move, picker-move, volkonov-capture) came back almost silent
   (raw peak under -20 dBFS: words like "quiet", "faint", "near-silent" in the prompt do that) and
   were re-rendered with reworded prompts; the silent takes are left out of `gens.tsv`.
3. **Master** — `sfx-v2/master_sfx.py --gens sfx-v2/gens.tsv --raw <takes> --out public/audio/sfx`:
   both takes trimmed and measured; clipped, under-0.3 s or quiet takes (raw peak under -14 dBFS)
   rejected; select / move take the shorter take, the rest the longer; then the voice pipeline's
   mastering (`v4/master_v4.py`) at -17 LUFS, 48 kHz mono, 64 kb/s, with up to 6 dB of sustained
   limiting allowed on impacts. QA per effect: `sfx-v2/qa-sfx-v2.json`.

Result: 68 effects, 559,859 bytes (the synthesised set was 556,565), true peak ≤ -1.32 dBTP,
-17 LUFS ± 0.5 except impacts whose peaks lead (death -17.6, hammont-select -17.8). The runtime UI
sounds in `src/audio/sfx.ts` (taps, turn, win / lose) are still synthesised in the browser.

The music is documented in `bgm/README.md` ("Current tracks").

## Earlier pipeline: Qwen3-TTS (history)

Generates the files in `public/audio/` and the manifest `src/audio/voiceManifest.ts`.
Licences and sources: `public/audio/LICENSES.md`. Large models are never committed.
Audition every shipped line at `/audio/audition.html` (`public/audio/audition.html`).

**Voice lines are switched off until the cast is re-recorded: see `VOICE_REDO.md`.**

| File | Purpose |
| --- | --- |
| `lines.json` | Voice script: per character the art-derived `concept`, the VoiceDesign prompt of its reference, the clone reference, and every line (text, event). |
| `refs/*-ref.flac` | One clone reference per character, each a Qwen3-TTS VoiceDesign take (designed voice, no real person). |
| `gen_voice.py` | Qwen3-TTS: N sampled takes per line (CPU). Base-model voice cloning of the character's reference (VoiceDesign for characters without one). |
| `post_voice.py` | Take selection (Whisper CER, pitch, length, gender gate), de-essing / adaptive de-harsh, per-character FX, natural tails, -16 LUFS / -1 dBTP, AAC encode, QA. |
| `voice_qa.py` | Objective measurements (loudness, true peak, F0, formants, brightness, sibilance, tail decay, artefact proxies, optional gender classifier). Also a CLI. |
| `write_audition.py` | Writes `public/audio/audition.html` from `lines.json` + `qa-voice.json`. |
| `process_voice.py` | The previous post-processor (pitch-shifting); kept only because `post_voice.py` reuses its helpers. Do not use it to ship. |
| `gen_sfx.py`, `encode_sfx.py` | History: pure numpy/scipy synthesis of the previous character SFX set; -17 LUFS normalisation and encode. Replaced by `sfx-v2/` on 2026-11-07. |
| `write_manifest.py` | Writes `src/audio/voiceManifest.ts` from `lines.json` + files present on disk. |
| `qa-voice.json`, `qa-sfx.json` | History: objective QA of the Qwen voices and the synthesised SFX (current QA: `v4/qa-v4.json`, `sfx-v2/qa-sfx-v2.json`). |

## Setup (CPU only, ~11 GB disk)

```bash
W=/some/scratch/dir           # outside the repo
uv venv -p 3.12 $W/venv
VIRTUAL_ENV=$W/venv uv pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
VIRTUAL_ENV=$W/venv uv pip install qwen-tts==0.1.1 pyworld pyloudnorm faster-whisper scipy numpy soundfile
$W/venv/bin/hf download Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign --local-dir $W/qwen-vd
$W/venv/bin/hf download Qwen/Qwen3-TTS-12Hz-1.7B-Base --local-dir $W/qwen-base
$W/venv/bin/hf download Systran/faster-whisper-medium --local-dir $W/fw-medium
# QA only (gender plausibility gate for brutile, michelle, picker and rakaeli), Apache-2.0:
$W/venv/bin/hf download prithivMLmods/Common-Voice-Gender-Detection config.json model.safetensors preprocessor_config.json --local-dir $W/gender-w2v
# QA only, second gender opinion (MIT, ECAPA-TDNN; needs the repo's model.py, run outside the repo):
$W/venv/bin/hf download JaesungHuh/voice-gender-classifier --local-dir $W/gender-ecapa
```

ffmpeg 6.x must be on PATH.

## Run

```bash
cd docs/brand/audio
PY="$W/venv/bin/python -I"
OMP_WAIT_POLICY=PASSIVE $PY gen_voice.py --model $W/qwen-vd --base-model $W/qwen-base \
    --lines lines.json --out $W/raw --seeds 5 --threads 3   # fewer threads than cores on a busy box
$PY post_voice.py --lines lines.json --raw $W/raw --asr $W/fw-medium --gender $W/gender-w2v \
    --out ../../../public/audio/vo --qa qa-voice.json --threads 3
python3 write_manifest.py
python3 write_audition.py
```

`gen_voice.py` skips lines whose takes already exist; `--only sad:capture-1,walk:skill-1`
regenerates single lines (delete their old takes first). `post_voice.py --only-char sad` or
`--only-line sad:capture-1` reprocesses a subset. Check `qa-voice.json` after every run.

### Making a new reference voice

Write the timbre prompt into a small lines file without a `clone` entry, generate 6+ VoiceDesign
takes of one or two in-character lines, measure them (`python -I voice_qa.py --gender ... FILES`
plus a Whisper transcript), pick a take in the right register (calm takes; Qwen's shouted takes of
male voices sit at 250-400 Hz), trim it, store it as `refs/<char>-ref.flac` and record its prompt
and transcript in `lines.json` (`voice`, `clone`).

## What went wrong before (2026-11-03 diagnosis)

- **Brutile read male** although her raw takes were female (P(female) 0.93-0.995 on two
  classifiers): the old chain pitch-shifted every line down to a 250 Hz target, clamped at
  q = 0.80, with ffmpeg rubberband ("formant preserved"). On a 300-400 Hz voice the formant
  preservation fails and the timbre follows the pitch down: the shift alone turned P(female)
  from 0.94-0.98 into 0.001-0.08 (ablation; the FX layers did not change the class).
- **Shouted, shrill men:** Qwen VoiceDesign renders exclaimed lines of male voices at 220-400 Hz;
  the old chain kept them (sad lines ranged 100-270 Hz) and pulled them down with the same
  pitch shifter, which added warble (pitch-contour wobble 0.096 -> 0.127 on sad move-1).
- **Harsh highs:** presence boosts (+2..3 dB at 2.6-3.5 kHz), a high-passed saturated "rasp"
  layer, saturation and a 6-bit crusher raised the 2-8 kHz energy by about 2-3 dB and the 5-10 kHz
  sibilance peaks by about 5 dB over the raw takes (brutile median: harshness -10.8 -> -7.6 dB,
  sibilance -9.7 -> -4.3 dB).
- **Clipped endings:** reverbs were truncated 0.08-0.2 s after the speech and then faded in 40 ms;
  the last 100 ms sat only 27-40 dB below the peak (tails now decay 55+ dB before the clip ends).
- **Baby imp:** insaner's reference sat at 500-700 Hz.

## Character treatment (`post_voice.py`)

No line is pitch-shifted; the register comes from the reference voice and from what the TTS is
asked to say (`say`: exclamation marks make Qwen shout male voices up to 200-400 Hz, so sad's and
walk's exclaimed lines are spoken with a period; the caption keeps the '!'). Per take:

1. leading silence trimmed (15 ms pre-roll, 8 ms fade-in); internal pauses > 0.4 s tightened to 0.3 s;
2. a smooth downward expander removes TTS breath / hiss below -38 dB (relative) in pauses and tails;
3. a split-band de-esser (above 4.5 kHz, per-character threshold, max 12 dB) and an adaptive broad
   3.5 kHz cut that brings the 2-8 kHz / 0.1-2 kHz energy ratio toward the character's target,
   before and after the FX;
4. the character FX below; reverb tails rendered in full, the clip ends only after it has decayed
   55 dB below its peak, with a >= 150 ms cosine fade;
5. -16 LUFS with a smooth look-ahead true-peak limiter (-2 dBTP), AAC encode, and the *decoded*
   file is re-checked: <= -1 dBTP and within 0.2 LU of -16 (AAC padding shifts short clips).

| Character | Art-derived target | Voice source (reference) | Post-processing (`fx_*`) |
| --- | --- | --- | --- |
| sad (paladin) | young-adult knight, stoic: warm, clear, confident baritone, never shouted | clone of a calm-heroic VoiceDesign take (163 Hz); exclaimed lines are *spoken* with '.' (`say`) and takes near 160 Hz are preferred (`f0_target`) | HP 70 Hz, +1.5 dB warmth at 180 Hz, gentle 2:1 compression, 1.3 s hall at 12 % wet |
| marki (minotaur) | massive armoured bull: thick, guttural bass, still intelligible | clone of a deep VoiceDesign take (~86 Hz) | sub-octave WORLD double (envelope x0.85, 32 Hz flutter, saturated, LP 1.4 kHz) at 42 % under the voice, light saturation, +2.5 dB low shelf, -2.5 dB above 5 kHz, LP 8 kHz, 0.8 s dark room |
| walk (shield soldier) | scrappy shield fighter: brave like sad but rougher, lower, steadier | clone of a gravelly "veteran" VoiceDesign take (100 Hz) - the "young soldier" prompt only produced shouted 150-330 Hz takes | HP 80 Hz, +1 dB body at 300 Hz, 20 % soft-clip grit, 3:1 compression, 0.6 s small room |
| insaner (imp) | small purple imp with a manic grin: evil creature, real demonic modulation | clone of a sly male creature VoiceDesign take (153 Hz) - no longer the 500-700 Hz "baby" voice | main voice formants +10 % (smaller creature, pitch unchanged), octave-down WORLD demon double (envelope x0.78, 47 Hz growl flutter, saturated, 12 ms late) at 75 %, 10 % ring modulation at 92 Hz, light flanger, dark 1.5 s tail (LP 2.5 kHz) |
| brutile (witch) | green-skinned fanged witch: unmistakably female, aged, raspy, sneering, cackling | clone of an elderly-witch VoiceDesign take (167 Hz, raspy); takes gated on P(female) | never pitch-shifted (that is what made her male before), subtle slow 9 ms chorus, +1 dB low shelf, 2.5:1 compression, 1.2 s dark hall at 12 % wet |
| michelle (gloomy girl) | little girl with bangs over her eyes and a doll: quiet, soft, slightly breathy, eerie; never cute, babyish or shrill | clone of a hushed "gloomy ten-year-old" VoiceDesign take (269 Hz, narrow 240-295 Hz range); `f0_target` 265; takes gated on P(female) | **never pitch-shifted**; HP 100 Hz, a whispered double of the same words (WORLD resynthesis with fully aperiodic excitation at the original pitch and envelope, band 0.7-5.5 kHz, 28 ms late, level drifting at 0.45 Hz, about -18 dB under the voice), +1 dB low shelf, 2:1 compression, 0.55 s small room at 11 % wet |
| picker (frontier drifter) | lone cowboy, about 30, with a lasso: laconic, low, dry drawl, calm and confident, never shouted | clone of a "laconic frontier cowboy" VoiceDesign take (108 Hz, the sigh the model added before the line cut off); `f0_target` 105; takes gated on P(female) <= 0.4 | HP 65 Hz, +1.5 dB warmth at 200 Hz, -0.8 dB at 450 Hz (no boxiness), 10 % soft saturation, 2.5:1 compression, a dry wooden "saloon": four early reflections (6.5-23 ms, LP 3.2 kHz) plus a 0.45 s dark tail at 7 % wet |
| rakaeli (fallen angel), base form | blindfolded pale youth, late teens: soft, calm, melancholic pretty-boy voice, elegant, quiet, sorrowful | clone of a "delicate, pretty young man of about seventeen ... light tenor" VoiceDesign take (160 Hz, warble 0.024, HNR 17.9 dB); `f0_target` 155; takes gated on P(female) <= 0.4 | never pitch-shifted; HP 80 Hz, +0.8 dB at 220 Hz, 2:1 compression, 0.85 s cool chapel hall (LP 5 kHz, HP 300 Hz) at 13 % wet |
| rakaeli, transformed form (타천, lines with `"fx": "rakaeli-awake"`) | the same young man, deeper and colder, speaking as two (demonic) | the same cloned takes | main voice -2 semitones with formants -6 % (rubberband, as insaner's formant step); a detuned double (WORLD resynthesis +22 cents, envelope x0.95, 17 ms late, about -7 dB); a cold octave-down shadow (WORLD, envelope x0.8, LP 1.1 kHz, no flutter or ring modulation) at about -15 dB; 18 % soft saturation; +1.5 dB below 140 Hz, -1.5 dB at 420 Hz (hollow, cold), -2.5 dB above 5.5 kHz; 3:1 compression; 1.0 s dark cathedral tail (LP 2.6 kHz) at 17 % wet |

Take selection (`post_voice.py`): every raw take is transcribed; the best `--shortlist` (3) per line
by CER, distance from the character's pitch target (`f0_target`, else the median of its
intelligible takes; rejects shouted takes) and length are fully processed, encoded, decoded and
judged again on Whisper CER, pitch distance, length, warble (fast pitch-contour wobble above
0.12 st is penalised), brightness that survives the de-esser (harshness more than 2 dB above the
character's target and sibilance above -9 dB cost a little, so a duller equal take wins; added
2026-11-04) and - for `"gender": "female"` / `"male"` - a wav2vec2 gender classifier (QA model,
never shipped). If AAC overshoots on one transient (decoded true peak well above the PCM peak), the
encoder loop limits that transient harder instead of turning the whole clip below -16 LUFS.

## QA metrics (`voice_qa.py`, recorded per clip in `qa-voice.json`)

`dur`, `lufs`, `tp_db` (true peak), `f0` (+ p10/p90), `f1..f3` (LPC formants), `centroid`,
`harsh_db` (2-8 kHz vs 0.1-2 kHz energy), `sib_db` (5-10 kHz peaks), `tail_db` (last 100 ms vs
loudest 50 ms: <= -40 means a natural decay, near 0 a cut), `end_db`, `lead_ms`/`trail_ms`, and
artefact proxies: `hf_flat` (3-8 kHz spectral flatness), `hiss_db` (4-11 kHz noise floor in the
quietest frames), `jitter`, `warble`, `shimmer`, `hnr_db`; `female_p` from the QA gender model;
`cer` of the decoded file against the line (`asr` field shows the transcript).

## Results of the 2026-11-03 recast (medians per character, decoded .m4a; before -> after)

| Character | F0 Hz | harsh dB | sib dB | tail dB | hiss dB | warble st | CER | P(female) w2v / ECAPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sad | 187 -> 171 | -7.7 -> -13.2 | -9.3 -> -15.1 | -35.6 -> -60.2 | -39.9 -> -58.0 | 0.085 -> 0.085 | 0 -> 0 | male both times |
| marki | 92 -> 90 | -11.1 -> -11.1 | -11.7 -> -13.7 | -39.4 -> -60.1 | -41.7 -> -41.5 | 0.124 -> 0.078 | 0 -> 0 | male both times |
| walk | 136 -> 96 | -6.4 -> -13.9 | -5.7 -> -13.3 | -30.8 -> -58.9 | -36.7 -> -47.5 | 0.091 -> 0.071 | 0 -> 0 | male both times |
| insaner | 561 -> 83 (demon layer) | -4.3 -> -12.9 | -7.0 -> -11.4 | -36.1 -> -60.1 | -33.9 -> -62.6 | 0.040 -> 0.087 | 0 -> 0.143 | 0.64 / 0.96 -> 0.001 / 0.004 |
| brutile | 254 -> 172 | -7.6 -> -14.1 | -4.3 -> -12.6 | -34.5 -> -60.0 | -42.2 -> -48.6 | 0.079 -> 0.072 | 0 -> 0 | 0.17 / 0.006 -> 0.995 / 0.987 |

All 52 clips: -15.99..-16.74 LUFS, true peak <= -1.07 dBTP, tail <= -48.7 dB; every brutile clip is classified female
by both QA models (min 0.96 / 0.93). `public/audio/vo` grew from 637 KB to 847 KB (longer, natural
reverb tails). Insaner's CER (0.14 median) comes from Whisper writing the homophones 내/네 and from
the non-lexical "키힉"; insaner's lower HNR / higher warble is the intended growl and ring-mod texture.

## Michelle and Picker (2026-11-04)

Two new voices, made with the same pipeline (references in `refs/`, prompts and take provenance in
`lines.json`). Lines: the standard set (select x2, move x2, capture x3, death, victory) plus trait
lines keyed by new events: michelle `trap-set` (a doll trap is laid) and `trap-sprung` (a trap
catches a piece), picker `hop-multi` (one hop captures several pieces). `write_manifest.py` now
reads the character list from the `CharacterId` union in `src/engine/types.ts` and quotes the
hyphenated event keys.

**References.** 8 VoiceDesign takes of two lines per character, scored on CER, F0, harshness,
WORLD aperiodicity and both gender classifiers (`score_refs`-style run):
- michelle: takes ranged 204-350 Hz. The 330-350 Hz takes were rejected as too childish/bright,
  the 200-215 Hz ones as too adult. Kept seed 11 take 7: 269 Hz, flat 240-295 Hz contour, warble
  0.016, HNR 16.9 dB, P(female) 0.94 / 0.95. A 1.0 s pause after "인형이…" was cut to 0.4 s.
- picker: takes ranged 71-108 Hz. The 71-86 Hz takes were creaky (HNR -3..9 dB) and as deep as
  marki. Kept take 7 at 108 Hz (CER 0, warble 0.043, P(female) 0.001 / 0.006) after cutting off
  a sigh the model had added before the line.

**Takes.** 6 cloned takes per line; every take fully processed and judged (`--shortlist 6`).
Results on the decoded .m4a (`qa-voice.json`; `female_p` = wav2vec2, `female_p_ecapa` = ECAPA):

| Character | clips | dur s | F0 Hz | harsh dB | sib dB | tail dB | hiss dB | warble st | HNR dB | CER | P(female) w2v / ECAPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| michelle (median) | 11 | 2.18 (0.90-2.69) | 244 (212-286) | -16.1 | -14.5 | -58.5 | -49.9 | 0.048 | 11.0 | 0 (all) | 0.95 / 0.95 (min 0.68 / 0.77) |
| picker (median) | 10 | 1.20 (0.81-2.48) | 107 (88-114) | -14.1 | -13.3 | -60.2 | -43.2 | 0.071 | 4.6 | 0 (all) | 0.001 / 0.004 (max 0.001 / 0.007) |

All 21 clips: -16.00..-16.19 LUFS, true peak <= -1.16 dBTP, tail <= -54.5 dB, 7.5-23.0 KB.

- The whisper layer is subtle by measurement. An ablation on the reference changed the noise floor
  by +0.6 dB (hiss -42.8 -> -42.2) and HNR by -4.2 dB (the intended breath); harshness and
  sibilance did not rise.
- picker `death-1` was written "여기까진가…", but the model said "여기까지인가" in 6/6 takes. The
  caption now follows the audio; `say` keeps what was fed to the TTS.
- Whisper writes michelle's "인형" as "인영" on some takes. That is the normal ㅎ-weakening in the
  pronunciation, not a TTS error; the shipped takes transcribe exactly.
- The reverb IR is drawn from a shared RNG, so a re-render of the same take differs slightly. On
  michelle `trap-set-1` (same take) the wav2vec2 P(female) moved from 0.92 to 0.68 between two
  runs (ECAPA 0.97). Both readings are female, but this is the least robust clip of the set.

**SFX.** `gen_sfx.py` gained 9 effects, appended after `waste-death` so the shared RNG leaves every
earlier sound sample-identical (checked: max difference 0.0 on all 23). Michelle and Picker have no
skill, so they get no `skill` effect; their trait events have their own:

| File | Concept | dur s | LUFS | peak dBFS | bytes |
| --- | --- | --- | --- | --- | --- |
| michelle-select | three slow, slightly flat music-box notes + a faint doll squeak | 1.045 | -17.14 | -3.11 | 9560 |
| michelle-move | two small soft footsteps + dress rustle | 0.469 | -17.67 | -1.83 | 4895 |
| michelle-capture | scissor snip (two blade clicks), muffled cloth thump, a sinking music-box note | 1.045 | -16.96 | -1.62 | 9561 |
| michelle-trap-set | wind-up ratchet clicks slowing, creaky spring settling, one music-box note | 1.024 | -17.07 | -2.18 | 9512 |
| michelle-trap-sprung | sharp wooden toy snap, string pulled tight (rising creak), small thump | 0.597 | -17.02 | -1.92 | 6006 |
| picker-select | spur jingle + lasso rope sliding through the hand | 0.597 | -17.09 | -3.84 | 5955 |
| picker-move | two boot steps on sand with faint spur rings | 0.512 | -17.58 | -2.22 | 5192 |
| picker-capture | lasso twirl (two whoosh turns), thin high-passed whip-tip crack (no low body, never a gunshot), rope pulled taut, sand thud | 0.917 | -16.96 | -2.41 | 8609 |
| picker-hop-multi | three springy boings rising in pitch, each landing with a light tap, then a spur jingle | 0.896 | -17.03 | -3.75 | 8448 |

**Budget.** vo + sfx = 1,424,699 B (vo 1,153,610 + sfx 271,089). The test budget was raised by the
lead from 1.2 MiB to 1.5 MiB (1,572,864 B) because the roster grew from 5 to 7 characters
(0.24 -> 0.21 MiB per character); headroom 148,165 B.

## Rakaeli (2026-11-04)

The 8th character, an epic with two forms (spec: `docs/design/new-character-rakaeli.md`). His
transformed form ("타천") is the same cloned voice through a second chain (`fx_rakaeli_awake`),
selected per line by `"fx": "rakaeli-awake"` in `lines.json`; `post_voice.py` now takes the FX
chain, de-esser threshold and harshness target from that key, and the AAC bitrate from the
character's `"bitrate"` (rakaeli: `48k`, every other character `64k`).

Events: base `select` x2, `move` x2, `capture` x3, `skill` (the transform cast), `death`,
`victory`; transformed `awake-select` x2, `awake-move` x2, `awake-capture` x2, `awake-death`, and
`awake-end` (turning back, spoken with the base chain because he has already reverted).
`write_manifest.py` emits the `awake-*` names in `CharAudioEvent`; `src/audio/voice.ts` falls each
back to the base event (`awake-end` to `move`).

**Reference.** 32 VoiceDesign takes over three prompts. The first prompt ("soft, calm ... young
male voice ... never deep") gave only 77-125 Hz takes, deeper than picker, and was dropped; so were
the takes of the "eighteen-year-old ... light, soft young tenor" prompt (85-155 Hz). Kept: the
"delicate, pretty young man of about seventeen ... light tenor in a medium-high pitch" prompt,
seed 11 take 4 of `눈을 가려도… 길은 보여요.`: 160 Hz (130-211), warble 0.024, HNR 17.9 dB,
harshness -21.9 dB, CER 0, P(female) 0.001 / 0.015. A 1.6 s pause with a breath was cut to 0.4 s.

**Takes.** 8 cloned takes per line, 6 (the replaced line: 8) fully processed and judged. The first
`awake-move-2`, `재를 밟고 간다.`, was heard as the homophone 쟤 (or 죄를 받고) in every take
(best CER 0.17), so it was replaced by `불길 속을 걷는다.` (7/8 takes CER 0). Over all processed
transformed-form takes of the shipped lines, 37 of 44 had CER <= 0.14; the misses were `타 버려라` heard as `다 버려라`
(4/6) and `구원은` heard as `구호는` (3/6); the shipped take of each line has CER 0. Results on
the decoded .m4a (`qa-voice.json`):

| Form | clips | dur s | F0 Hz | F2 Hz | centroid Hz | harsh dB | sib dB | tail dB | warble st | HNR dB | CER | P(female) w2v / ECAPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base (median, incl. awake-end) | 11 | 2.26 (1.54-2.65) | 151 (145-162) | 1831 | 1623 | -15.5 | -15.0 | -59.3 | 0.056 | 10.1 | 0 (all) | 0.001 / 0.003 (max 0.013 / 0.009) |
| transformed (median) | 7 | 1.75 (1.28-2.09) | 112 (102-139) | 1474 | 1448 | -15.6 | -18.2 | -60.8 | 0.091 | 3.5 | 0 (all) | 0.001 / 0.002 (max 0.001 / 0.007) |

All 18 clips: -16.02..-16.15 LUFS, true peak <= -1.44 dBTP, tail <= -51.4 dB, 8.9-17.1 KB.
The transformed form measures about 5 semitones lower in median F0 (the tracker partly follows the
octave-down shadow; the shift on the main voice is 2 semitones), with a lower F2 (deeper vocal
tract) and a much lower HNR (the doubled, detuned voice; the intended texture, not noise: hiss
-58.3 dB vs -53.9 dB base). Base lines are 2.1-2.6 s with their tails: his `…` pauses are kept
(the pipeline only tightens pauses over 0.4 s). `move-2` has the highest warble of the set (0.104,
under the 0.12 penalty).

**SFX.** Appended after picker in `gen_sfx.py` (all 32 earlier effects checked sample-identical,
max difference 0.0). New building blocks: `feather_flap` (a falling air band with a fast 24-44 Hz
feather flutter, a low air push and quill ticks), `halo_glint` (a dim, cracked glassy ring: two
partials 1.1 % apart beating), `ember_crackle` (thinning pops) and `flame_roar` (turbulent
low fire). There is no awake-select effect (it falls back to select).

| File | Concept | dur s | LUFS | peak dBFS | bytes |
| --- | --- | --- | --- | --- | --- |
| rakaeli-select | folded wings stir (small feather rustle) under the faint ring of the cracked halo | 0.640 | -17.06 | -3.36 | 6276 |
| rakaeli-move | two soft feathered wing flaps, then a quill settles | 0.597 | -17.03 | -2.12 | 6056 |
| rakaeli-capture | a pale strike: feather-edged air slash, a cold glass-like strike with a soft low body, a falling minor-second halo sigh (no metal, no fire) | 0.853 | -17.05 | -1.53 | 8045 |
| rakaeli-skill | 타천: the blindfold burns (rising sizzle + flare whoosh), the halo snaps, two big wing strokes unfurl over a dark choir swell gliding down (a fall), a crimson flame bloom at the peak | 1.195 | -17.12 | -2.26 | 10687 |
| rakaeli-awake-move | one heavy flame-wing beat: deep downstroke whump, fire roaring along the wing, shaken embers | 0.725 | -17.05 | -2.20 | 6976 |
| rakaeli-awake-capture | dark-flame impact: air sucked in (reversed swell), a heavy blow with a low out-of-tune bell (the broken crimson halo), a fire bloom and trailing embers | 0.960 | -17.13 | -3.76 | 8973 |
| rakaeli-awake-end | turning back: embers pop and thin out over a fading glow, a soft smoky exhale (breathy band falling 1.8 kHz -> 380 Hz), one faint halo ring | 1.003 | -17.12 | -2.68 | 9295 |

Distinctness (a coarse proxy, not a listening test): the cosine similarity of z-scored log-mel
spectrograms to the nearest effect of another character is 0.79-0.94 (capture 0.79, select 0.81,
skill 0.89, awake-end 0.92, move / awake-move 0.93, awake-capture 0.94 to marki-capture); for
comparison the existing effects' nearest-neighbour similarity is 0.83 median, 0.97 max. The
measure mostly sees broadband noise and low impacts, so heavy impacts score alike.

**Budget.** vo + sfx = 1,717,578 B (vo 1,390,181 + sfx 327,397). Rakaeli alone is 292,879 B (vo
236,571 at 48 kbps for 18 lines, sfx 56,308 for 7 effects), about 1.4x a one-form character. The
test budget was raised from 1.5 MiB to 1.75 MiB (1,835,008 B, 0.21 MiB per character for 8
characters); headroom 117,430 B. Nobody has listened to these files; every statement above is a
measurement.

## Rampid, Larhen and Volkonov (2026-11-05)

Characters 9-11. Lines: the standard set (select x2, move x2, capture x3, death, victory); volkonov
also has `skill` x2 for 선율 (his music gives every ally +1 orthogonal move range). Rampid and
Larhen have no active skill, so no skill line or effect.

**ElevenLabs was tried first and dropped.** The owner asked for ElevenLabs library voices this time
(the brief assumed the Qwen models could not be downloaded; they were already in the scratch
directory from earlier runs). Chosen by preview measurements (F0, centroid, HNR): "taemin"
`Ir7oQcBXWiq4oFGROCfj` (rampid), "Min-jun - Calm and composed" `7ZVPKvVmVZZERLd1Q6BS` (larhen),
"Deok - Energetic Korean Narrator" `wisKdlUQEBMjkKqNAa3c` (volkonov), model `eleven_v4`. Of 14
generation calls, 9 were refused before starting ("free generations are busy", nothing charged), 5
started 7 generations (5 rampid lines), and then ElevenLabs disabled free-tier access for the
workspace ("unusual activity", the same block as on 2026-11-03). Nothing from it ships: the takes
are free-tier output (non-commercial) in real voice actors' voices, and one character must not
mix two engines. See `public/audio/LICENSES.md`.

**References** (Qwen3-TTS VoiceDesign, measured with `voice_qa.py` + Whisper + both gender models):
- rampid: 16 takes over two prompts. The "light, bright young tenor in a medium-high pitch" prompt
  gave 6/8 takes classified female (285-473 Hz); the "voice has already broken ... medium pitch"
  prompt gave male takes but noisier ones. Kept seed 11 take 3 of the first prompt: 249 Hz,
  CER 0, warble 0.027, HNR 15.9 dB, P(female) 0.019 (w2v) / 0.29 (ECAPA). `f0_target` 235.
- larhen: 16 takes over two prompts, all 69-113 Hz and mostly creaky (HNR -3.6..3.6 dB) even when
  the prompt asked for "no rasp, no vocal fry". Kept the cleanest: 92 Hz, HNR 6.5 dB, warble 0.066.
  The take says 끊는다 where the script said 끝낸다; the clone `text` follows the audio.
- volkonov: 8 takes, 140-295 Hz, all male. Kept the warmest, 140 Hz with a wide melodic range
  (95-193 Hz), harshness -16.3 dB. `f0_target` 145.

**Takes.** 6 cloned takes per line, all 6 fully processed and judged (`--shortlist 6`). Character
chains (`post_voice.py`): rampid HP 90 Hz, +0.8 dB at 200 Hz, 2.5:1, a cool 0.6 s rink room (LP 6 kHz,
HP 400 Hz) at 9 %; larhen HP 70 Hz, +1.2 dB at 160 Hz, -1 dB above 6 kHz, 3:1, a dry dark 0.4 s room
at 6 % (close and quiet); volkonov HP 75 Hz, +1.2 dB at 220 Hz, 2:1, a warm 1.1 s stage hall at 14 %.
Results on the decoded .m4a (`qa-voice.json`):

| Character | clips | dur s | F0 Hz | harsh dB | sib dB | warble st | HNR dB | CER | P(female) w2v / ECAPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rampid (median) | 9 | 1.79 (1.15-2.26) | 237 (208-302) | -12.6 | -15.1 | 0.047 (max 0.091) | 11.4 | 0 (death-1: 0.14, 으앗 heard as 으아) | see below |
| larhen (median) | 9 | 1.02 (0.81-1.15) | 88 (82-93) | -12.2 | -12.5 | 0.078 (max 0.127) | 6.4 | 0 (all) | 0.001 / 0.002-0.004 |
| volkonov (median) | 11 | 1.83 (1.02-2.35) | 136 (112-175) | -16.5 | -18.6 | 0.084 (max 0.131) | 5.6 | 0 (all) | 0.001 / 0.002-0.015 |

All 29 clips: -15.86..-16.18 LUFS, true peak <= -1.34 dBTP, tail <= -52.2 dB, 7.1-20.2 KB
(386,729 B in all).

- **Rampid reads androgynous to the classifiers** (a 15-year-old at 210-300 Hz). wav2vec2 says
  female on select-1 (0.85), move-1 (0.99) and move-2 (0.97); ECAPA says male on all nine (max 0.51
  on capture-2, 0.36-0.38 on the two moves). No clip is female on both. Every take of move-1 and
  move-2 measured the same on wav2vec2, so a lower take was not available. Listen to these three.
- Larhen sits at 88 Hz, in marki's (90) and walk's (96) register; the difference is texture (quiet,
  close, dry room, no growl layer or grit). His raw takes are breathy/creaky (HNR 6.4 dB median),
  which suits a murmur but is a measurement, not a listening verdict.
- `larhen:capture-2` was re-run alone (`--only-line`) because the first pass ended at -17.4 LUFS
  (the encoder loop ran out of rounds on a peaky 0.8 s clip); the re-run picked another take
  (-16.18 LUFS, warble 0.127, HNR -1.9 dB: the creakiest shipped clip).

**SFX.** Appended after rakaeli in `gen_sfx.py` (all 39 earlier effects regenerated and checked
sample-identical, max difference 0.0; the shipped .m4a of all 39 are byte-identical). New building
blocks: `skate_scrape` (a narrow, bright swept band for the blade edge plus a lower carve band and
ice-chip grain), `ice_tinkle`, `ice_stop`, `blade_whoosh` (a short high-Q swept band), `steel_shing`
(scrape + two beating steel partials), `lute_pluck` (Karplus-Strong, computed one delay period at a
time, with a small wooden body and a 3 ms attack) and `strum`.

| File | Concept | dur s | LUFS | peak dBFS | bytes |
| --- | --- | --- | --- | --- | --- |
| rampid-select | a short skate carve into a shaved-ice stop, a sparkle of frost | 0.576 | -17.17 | -2.30 | 5714 |
| rampid-move | two fast skating strides (the second higher), a short glide hiss | 0.555 | -17.24 | -3.29 | 5688 |
| rampid-capture | a speed rush, a glassy ice-shatter strike with a small body, shards and frost | 0.853 | -16.98 | -2.17 | 8144 |
| larhen-select | twin daggers drawn one after the other (scrape + thin ring) | 0.704 | -16.16 | -3.88 | 6714 |
| larhen-move | a coat flick, air rushing up (the leap), a near-silent landing | 0.683 | -17.12 | -1.94 | 6639 |
| larhen-capture | two lightning cross slashes, a crisp steel tsing on the cut, a muted body | 0.661 | -17.02 | -2.76 | 6506 |
| volkonov-select | a rolled D-major lute strum and a playful high answer | 0.875 | -17.08 | -1.17 | 8294 |
| volkonov-move | two light plucks stepping up a fourth over a cloak swish | 0.661 | -17.06 | -3.16 | 6400 |
| volkonov-capture | a fast run down the scale, a snapped low string, a sly resolving note | 0.917 | -17.16 | -2.01 | 8405 |
| volkonov-skill | 선율: an accelerating rising D-major arpeggio over a warm swelling pad, a bright chime and sparkle | 1.515 | -17.05 | -3.63 | 13522 |

Two fixes found by measurement: a click with a 0.2 ms attack in larhen-capture and the instant
onset of the first Karplus-Strong plucks made the AAC encoder overshoot (by ~5 dB on volkonov-move),
so `encode_checked` turned the whole clip 1.4-2.5 dB under target; both now have 1-3 ms attacks.
Rampid's effects are the brightest of the roster by centroid (4.5-5.5 kHz vs <= 4.4 kHz for the
rest) after a lower carve band was added (they were 5.8-6.9 kHz).

**Budget.** vo + sfx = 2,180,333 B (vo + 386,729 for 29 lines, sfx + 76,026 for 10 effects), over the
test's 1.75 MiB budget (1,835,008 B). The three new characters take 0.15 MiB each, under the
roster's 0.21 MiB per character; 2.25 MiB (2,359,296 B) for 11 characters would leave 178,963 B.
Nobody has listened to these files; every statement above is a measurement.

## Verish (2026-11-05)

The 12th character, a rare: a pink-haired young woman (about 20) on high-tech power boots who
slides and pierces through every enemy in her lane (trait 관통, no active skill). Lines: the
standard set (select x2, move x2, capture x3, death, victory) plus `hop-multi` x1, played when one
slide captures two or more pieces (the event Picker already uses; `voice.ts` falls it back to
`capture`). No skill line or effect. Same pipeline as the three characters above (Qwen3-TTS only).

**Reference.** 24 VoiceDesign takes over three prompts, all female on both QA models (P 0.85-0.99
wav2vec2 / 0.93-0.99 ECAPA) but high: the "medium-high" / "mid-to-high" prompts gave 326-492 Hz
medians with mostly shouted '!' reads, and the 400+ Hz takes read childish. The third prompt ("a
natural medium pitch, not high-pitched ... never a little girl") gave the only sub-300 Hz take,
kept: 294 Hz (228-473), CER 0, warble 0.066, HNR 13.1 dB, hiss -58.4 dB, P(female) 0.949 / 0.976.
It is bright (harshness -8.0 dB, sibilance -7.9 dB; "crisp", left to the de-esser). Runner-up:
326 Hz, duller (-13.9 dB), with a drawn-out, creaky 없어. `f0_target` 290.

**Takes.** 6 cloned takes per line, all fully processed and judged (`--shortlist 6`). Chain
`fx_verish`: HP 100 Hz, +0.6 dB at 220 Hz, +1 dB air shelf at 10 kHz, 2.5:1, a short bright
0.7 s space (LP 7 kHz, HP 450 Hz) at 10 %; harshness target -9 dB, de-esser threshold 0.28. Two lines
were replaced after the first takes: `capture-3` `한 방에 관통!` (Whisper heard 한 방의 관통 in 6/6
takes) became `정면 돌파!`, and `death-1` `앗… 부츠가… 방전됐어…` (부츠 heard as 부추/부치/구치,
best CER 0.12) became `앗… 여기서 멈추다니…`. Results on the decoded .m4a (`qa-voice.json`):

| Character | clips | dur s | F0 Hz | harsh dB | sib dB | tail dB | hiss dB | warble st | HNR dB | CER | P(female) w2v / ECAPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| verish (median) | 10 | 1.81 (1.07-2.90) | 279 (269-386) | -9.2 | -11.8 | -58.9 | -46.1 | 0.046 (max 0.104) | 9.9 | 0 (victory-1: 0.27) | 0.948 / 0.962 (min 0.72 / 0.92) |

All 10 clips: -15.98..-16.19 LUFS, true peak <= -1.05 dBTP, tail <= -48.9 dB, 9.2-24.9 KB
(166,279 B in all).

- `victory-1` CER 0.27 is Whisper's spelling, the same in all 6 takes: 고린 for 골인 (the linked
  pronunciation) and the digit 1등 for 일등.
- `hop-multi-1` is the highest clip (386 Hz): the two takes that said 꿰뚫었어 were both excited
  (390-395 Hz); the lower takes said 깨뜨렸어 or 꽤 뚫었어.
- `move-1` has the lowest wav2vec2 P(female) (0.72; ECAPA 0.99) and the highest noise floor of the
  set (hiss -35.6 dB vs -46 median). Listen to these two first.

**SFX.** Appended after volkonov in `gen_sfx.py` (all 49 earlier effects regenerated and checked
sample-identical, max difference 0.0; the 169 shipped .m4a of the other characters are byte-identical
by md5). New building blocks: `servo_whine` (the boots spinning up or down: a gliding tone with a
fast small vibrato), `electric_arc` (a jittery high-passed buzz flickering over fine crackle, soft
edges), `boot_slide` (a falling friction sweep with a grainy texture) and `pierce_hit` (a rising
zip, a 1.5 ms snap, a falling 'thwip' and a punchy low body with a 2 ms attack).

| File | Concept | dur s | LUFS | peak dBFS | bytes |
| --- | --- | --- | --- | --- | --- |
| verish-select | boots power up: servo spin-up, two electric ticks, a rising-fifth "ready" ping | 0.704 | -16.81 | -4.17 | 6816 |
| verish-move | power-boot slide: thrust whoosh, the whine dropping as she glides, an electric skid | 0.555 | -17.10 | -2.41 | 5638 |
| verish-capture | a punchy pierce: zip, snap and low body, static burst, the air closing behind her | 0.683 | -17.24 | -1.14 | 6579 |
| verish-hop-multi | three rapid pierces rising in pitch over one zip, an electric discharge, a short skid stop | 0.853 | -17.26 | -2.34 | 8099 |

The capture first ended at -17.35 LUFS. The cause was not AAC overshoot: the hit had an 18 dB
crest, so the -2 dBFS limiter could not bring it up to -17 LUFS. A longer static/air tail and a
little saturation fixed it. The low body uses its own 2 ms attack instead of `thud()`'s 0.5 ms
click. Distinctness proxy (log-mel cosine to the nearest effect of another character): select 0.78,
move 0.93, capture 0.93, hop-multi 0.92 (insaner/brutile capture); as noted above, the measure
mostly sees broadband noise.

**Budget.** vo + sfx = 2,373,744 B (vo 1,943,189 + sfx 430,555). Verish adds 193,411 B (vo 166,279
+ sfx 27,132), 14,448 B over the 2.25 MiB budget, which was raised to 2.5 MiB (2,621,440 B, 0.21 MiB per
character for 12); headroom 247,696 B. Nobody has listened to these files; every statement above is
a measurement.

## 미도스 Midos (`midos`): 2026-11-06

**Voice.** A ghost assassin of living shadow (see `lines.json` `concept`): a cool, cold, low male
voice, never shouting. Reference: VoiceDesign, 12 takes over two prompts (`clone._from` in
`lines.json`); prompt A ("deep, hollow ... sinister whisper") gave 69-87 Hz takes, all creaky
(HNR -6.7..0.5 dB); prompt B gave the kept take (95.5 Hz, warble 0.093, the lowest of the 12).
11 lines x 5 Base-clone takes (seed 11). `fx_midos`: his own voice (never pitch-shifted), a
whispered WORLD double 22 ms behind (about -13 dB, drifting), a faint cold octave-down shadow
(about -20 dB, low-passed at 900 Hz), a scooped low-mid, a darker top and a dark hall with a 40 ms
predelay.

| Character | clips | dur s | F0 Hz | harsh dB | sib dB | tail dB | hiss dB | warble st | HNR dB | CER | P(female) w2v |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| midos (median) | 11 | 1.92 (1.07-3.03) | 94.5 (84-102) | -10.4 | -11.9 | -58.7 (max -51.5) | -48.0 (max -43.6) | 0.084 (max 0.150) | 0.9 | 0 (select-1: 0.083) | <= 0.001 |

All 11 clips: -15.88..-16.17 LUFS, true peak <= -1.57 dBTP, 9.9-26.2 KB (193,599 B in all).

- `select-1` CER 0.083 is the 네/내 homophone (Whisper writes 내 곁에 for 네 곁에 in every take;
  the reference clip has the same pair).
- `capture-3` (끝이다, 1.07 s) has the highest warble (0.150) and the lowest voicing (0.22): a short,
  breathy line. Listen to it first.

**SFX.** Appended after verish in `gen_sfx.py` (the shared rng is consumed in order, so earlier
effects are unchanged; the shipped .m4a of the other characters are byte-identical by md5). New
building blocks: `claw_snikt` (three detuned steel blades springing out with a 2 ms lock click),
`ghost_moan` (a hollow airy breath through a dark formant), `void_suck` (air rushing into a point)
and `void_pop` (a deep soft implosion thump, 2 ms attack).

| File | Concept | dur s | LUFS | peak dBFS | bytes |
| --- | --- | --- | --- | --- | --- |
| midos-select | a cold ghost breath, then the claws spring out ('snikt') | 0.939 | -17.05 | -2.50 | 8753 |
| midos-move | a low ghost glide: a soft whoosh of shadow and a breathy tail, no steps | 0.747 | -17.10 | -1.98 | 7223 |
| midos-capture | three claws raking in quick succession, a steel 'tsing', a deep void thump | 0.789 | -17.06 | -1.84 | 7382 |
| midos-skill | 그림자 도약: air rushing into nothing, a shimmer, a void pop elsewhere, the claws | 1.451 | -17.05 | -2.71 | 13048 |

**Budget.** vo + sfx = 2,603,749 B on disk after Midos (vo 193,599 + sfx 36,406 = 230,005 B
added), under the 2.5 MiB budget (2,621,440 B) with 17,691 B headroom: no raise this time, but the
next character needs one. Nobody has listened to these files; every statement above is a
measurement.

## 해먼트 Hammont, 베노아 Venoa, 글라시아 Glacia (2026-11-06)

**Voices.** One VoiceDesign reference each (6 takes, `clone._from` in `lines.json`), then 5
Base-clone takes per line (seed 11). FX: `fx_hammont` (extra chest, firm compression, a short
wooden workshop room), `fx_venoa` (close and quiet, a damp short space), `fx_glacia` (a little air,
a bright glassy hall). Nobody pitch-shifted.

| Character | clips | dur s | F0 Hz | harsh dB | sib dB | tail dB | hiss dB | warble st | HNR dB | CER | P(female) w2v |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hammont (median) | 11 | 1.75 (0.81-2.90) | 114 (95-142) | -14.0 | -15.9 | -59.3 (max -50.2) | -52.4 (max -37.5) | 0.056 (max 0.124) | 5.4 | 0 | 0.001-0.013 |
| venoa (median) | 9 | 1.45 (0.73-1.96) | 179 (170-196) | -20.1 | -18.4 | -59.6 (max -53.0) | -43.4 (max -39.2) | 0.051 (max 0.086) | 13.0 | 0 | 0.993-0.996 |
| glacia (median) | 11 | 1.79 (1.32-2.22) | 202 (171-265) | -23.4 | -20.9 | -62.7 (max -58.7) | -49.7 (max -42.0) | 0.068 (max 0.113) | 8.6 | 0 | 0.976-0.996 |

All 31 clips: -15.96..-16.20 LUFS, true peak <= -1.39 dBTP (447,598 B in all).

- Hammont `capture-2` was first '쇳물 맛 좀 봐라'; Whisper heard 샘물 (CER 0.17), so it became
  '뜨거운 맛 좀 봐라' (CER 0). His 'skill' lines play on his knock-back hit (he has no active skill).
- Venoa has no 'skill' lines: her shots are captures.
- Highest warble: hammont `capture-1` (0.124) and glacia `capture-3` / `select-1` (0.113 / 0.102):
  listen to these first. The highest hiss is a hammont clip at -37.5 dB.

**SFX.** Appended after midos in `gen_sfx.py` (earlier effects unchanged; the shipped .m4a of the
other characters are byte-identical by md5). New building blocks: `anvil_clang`, `forge_roar`,
`bow_draw`, `bow_twang`, `arrow_hiss`, `venom_hiss`, `ice_glide`, `ice_crack`. 11 files, 89,604 B,
-16.74..-17.24 LUFS.

**Budget.** vo + sfx = 3,140,951 B on disk; the budget went from 2.5 to 3.25 MiB (lead decision,
see `tests/voice.test.ts`); headroom 266,921 B. Nobody has listened to these files; every
statement above is a measurement.
