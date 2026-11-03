# Character audio pipeline (voices + SFX)

Generates the files in `public/audio/` and the manifest `src/audio/voiceManifest.ts`.
Licences and sources: `public/audio/LICENSES.md`. Large models are never committed.
Audition every shipped line at `/audio/audition.html` (`public/audio/audition.html`).

| File | Purpose |
| --- | --- |
| `lines.json` | Voice script: per character the art-derived `concept`, the VoiceDesign prompt of its reference, the clone reference, and every line (text, event). |
| `refs/*-ref.flac` | One clone reference per character, each a Qwen3-TTS VoiceDesign take (designed voice, no real person). |
| `gen_voice.py` | Qwen3-TTS: N sampled takes per line (CPU). Base-model voice cloning of the character's reference (VoiceDesign for characters without one). |
| `post_voice.py` | Take selection (Whisper CER, pitch, length, gender gate), de-essing / adaptive de-harsh, per-character FX, natural tails, -16 LUFS / -1 dBTP, AAC encode, QA. |
| `voice_qa.py` | Objective measurements (loudness, true peak, F0, formants, brightness, sibilance, tail decay, artefact proxies, optional gender classifier). Also a CLI. |
| `write_audition.py` | Writes `public/audio/audition.html` from `lines.json` + `qa-voice.json`. |
| `process_voice.py` | The previous post-processor (pitch-shifting); kept only because `post_voice.py` reuses its helpers. Do not use it to ship. |
| `gen_sfx.py`, `encode_sfx.py` | Pure numpy/scipy synthesis of every character SFX; -17 LUFS normalisation and encode. |
| `write_manifest.py` | Writes `src/audio/voiceManifest.ts` from `lines.json` + files present on disk. |
| `qa-voice.json`, `qa-sfx.json` | Objective QA of the shipped files. |

## Setup (CPU only, ~11 GB disk)

```bash
W=/some/scratch/dir           # outside the repo
uv venv -p 3.12 $W/venv
VIRTUAL_ENV=$W/venv uv pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
VIRTUAL_ENV=$W/venv uv pip install qwen-tts==0.1.1 pyworld pyloudnorm faster-whisper scipy numpy soundfile
$W/venv/bin/hf download Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign --local-dir $W/qwen-vd
$W/venv/bin/hf download Qwen/Qwen3-TTS-12Hz-1.7B-Base --local-dir $W/qwen-base
$W/venv/bin/hf download Systran/faster-whisper-medium --local-dir $W/fw-medium
# QA only (gender plausibility gate for brutile), Apache-2.0:
$W/venv/bin/hf download prithivMLmods/Common-Voice-Gender-Detection config.json model.safetensors preprocessor_config.json --local-dir $W/gender-w2v
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

Take selection (`post_voice.py`): every raw take is transcribed; the best `--shortlist` (3) per line
by CER, distance from the character's pitch target (`f0_target`, else the median of its
intelligible takes; rejects shouted takes) and length are fully processed, encoded, decoded and
judged again on Whisper CER, pitch distance, length, warble (fast pitch-contour wobble above
0.12 st is penalised) and - for `"gender": "female"` - a wav2vec2 gender classifier (QA model,
never shipped).

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
