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

No line is pitch-shifted; the register comes from the reference voice. Every take is de-essed
(split band above 4.5 kHz, only where it dominates) and gets an adaptive broad 3.5 kHz cut that
brings its 2-8 kHz/0.1-2 kHz energy ratio toward the character's target, before and after FX.
Internal pauses longer than 0.4 s are tightened to 0.3 s. Reverb tails are rendered in full, the
clip ends 55 dB below its peak with a >= 150 ms cosine fade, then -16 LUFS with a smooth
look-ahead true-peak limiter (decoded files <= -1 dBTP).

TREATMENT_TABLE

Take selection (`post_voice.py`): every raw take is transcribed; the best `--shortlist` (3) per line
by CER, distance from the character's median pitch (rejects shouted takes) and length are fully
processed, encoded, decoded and judged again on Whisper CER, pitch distance, length and - for
`"gender": "female"` - a wav2vec2 gender classifier (QA model, never shipped).
