# Character audio pipeline (voices + SFX)

Generates the files in `public/audio/` and the manifest `src/audio/voiceManifest.ts`.
Licences and sources: `public/audio/LICENSES.md`. Large models are never committed.

| File | Purpose |
| --- | --- |
| `lines.json` | Voice script: per-character timbre description + every line (text, event, style). |
| `gen_voice.py` | Qwen3-TTS VoiceDesign: N sampled takes per line (CPU, bf16). |
| `process_voice.py` | ASR-scored take selection, pitch/formant + character FX, -16 LUFS, AAC encode, QA. |
| `gen_sfx.py` | Pure numpy/scipy synthesis of every character SFX (seeded, reproducible). |
| `encode_sfx.py` | -17 LUFS normalisation, trim, AAC encode, QA for the SFX. |
| `write_manifest.py` | Writes `src/audio/voiceManifest.ts` from `lines.json` + files present on disk. |
| `qa-voice.json`, `qa-sfx.json` | Objective QA of the shipped files (duration, LUFS, peak, F0, ASR, CER...). |

## Setup (CPU only, ~10 GB disk)

```bash
W=/some/scratch/dir           # outside the repo
uv venv -p 3.12 $W/venv
VIRTUAL_ENV=$W/venv uv pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
VIRTUAL_ENV=$W/venv uv pip install qwen-tts==0.1.1 pyworld pyloudnorm faster-whisper scipy numpy soundfile
$W/venv/bin/hf download Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign --local-dir $W/qwen-vd
$W/venv/bin/hf download Systran/faster-whisper-medium --local-dir $W/fw-medium
```

ffmpeg with the `rubberband` filter must be on PATH (Ubuntu's ffmpeg 6.1 has it).

## Run

```bash
cd docs/brand/audio
PY="$W/venv/bin/python -I"
$PY gen_voice.py --model $W/qwen-vd --lines lines.json --out $W/raw --seeds 3
$PY process_voice.py --lines lines.json --raw $W/raw --asr $W/fw-medium \
    --out ../../../public/audio/vo --qa qa-voice.json
$PY gen_sfx.py --out $W/sfx_wav
$PY encode_sfx.py --wav $W/sfx_wav --out ../../../public/audio/sfx --qa qa-sfx.json
python3 write_manifest.py
```

`gen_voice.py` skips lines whose takes already exist; `--only sad:capture-1,walk:skill-1`
regenerates single lines (delete their old takes first) and `process_voice.py --only-char sad`
reprocesses one character. Takes are scored by Whisper character error rate, so a garbled take is
never picked when a better one exists; still check `qa-voice.json` (`cer`) after every run.

## Character treatment (process_voice.py `CHAR` / `fx_*`)

| Character | Target F0 | Formant | Tempo | Effects |
| --- | --- | --- | --- | --- |
| sad (paladin) | 150 Hz | 0.95 | 1.00 | warm low shelf, presence, gentle compression, 1.25 s hall |
| marki (minotaur) | 92 Hz | 0.84 | 1.04 | sub-octave growl layer with 34 Hz roughness, saturation, dark EQ, short dark room |
| walk (shield soldier) | 128 Hz | 0.98 | 0.96 | high-pass, crisp 2.6 kHz presence, tighter compression, small room |
| insaner (imp) | 470 Hz | 1.13 | 0.90 | 6-bit crush blend, quiet octave-down "demon" undertone, chorus, saturation |

Pitch: every line is shifted by the character's global offset and pulled part of the way
(`pull`) to the target, so lines stay expressive but sound like one actor.
