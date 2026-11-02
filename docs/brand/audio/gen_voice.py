"""Generate raw voice-line candidates with Qwen3-TTS (Apache-2.0).

Usage:
  python -I gen_voice.py --model <dir of Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign> \
      [--base-model <dir of Qwen/Qwen3-TTS-12Hz-1.7B-Base>] \
      --lines lines.json --out <raw dir> [--seeds 3] [--only sad:capture-1,...]

Characters with a "clone" entry in lines.json (reference clip + its transcript, itself a
VoiceDesign take kept in refs/) are voiced with the Base model's voice cloning instead: one fixed
timbre for every line. Used for the minotaur, whose VoiceDesign shouts came out far too high.

Writes <out>/<character>/<line-id>_s<seed>-<take>.wav (24 kHz mono float). Existing files are skipped,
so the script can be re-run after an interruption. CPU only is fine (~10-20 s per short line).
"""
import argparse
import json
import os
import time

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--base-model", default="", help="Qwen3-TTS Base model dir (needed for 'clone' characters)")
    ap.add_argument("--lines", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--seed-base", type=int, default=11)
    ap.add_argument("--only", default="", help="comma list of char:line-id to (re)generate")
    ap.add_argument("--dtype", choices=["bf16", "fp32"], default="bf16", help="bf16 is ~2x faster on CPUs with AMX/AVX512-BF16")
    ap.add_argument("--threads", type=int, default=0, help="torch threads (default: all cores; use fewer on a busy machine)")
    a = ap.parse_args()

    torch.set_num_threads(a.threads or os.cpu_count() or 4)
    spec = json.load(open(a.lines, encoding="utf-8"))
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    dtype = torch.bfloat16 if a.dtype == "bf16" else torch.float32
    here = os.path.dirname(os.path.abspath(a.lines))
    models = {}

    def get(kind: str) -> Qwen3TTSModel:
        if kind not in models:
            path = a.base_model if kind == "base" else a.model
            if not path:
                raise SystemExit("--base-model is required for characters with a 'clone' reference")
            models.clear()  # one 1.7B model in RAM at a time
            models[kind] = Qwen3TTSModel.from_pretrained(path, device_map="cpu", dtype=dtype)
        return models[kind]

    for char, c in spec["characters"].items():
        os.makedirs(os.path.join(a.out, char), exist_ok=True)
        clone = c.get("clone")
        clone_prompt = None
        for line in c["lines"]:
            key = f"{char}:{line['id']}"
            if only and key not in only:
                continue
            instruct = f"{c['voice']} {line['style']}"
            # All takes of a line are sampled in one batch (decoding is memory-bound on CPU, so a
            # batch of N costs little more than one take). File names carry the batch seed + index.
            seed = a.seed_base
            paths = [os.path.join(a.out, char, f"{line['id']}_s{seed}-{k}.wav") for k in range(a.seeds)]
            if os.path.exists(paths[0]):  # this line's batch was already generated (any --seeds)
                continue
            torch.manual_seed(seed)
            t0 = time.time()
            if clone:
                m = get("base")
                if clone_prompt is None:
                    clone_prompt = m.create_voice_clone_prompt(
                        ref_audio=os.path.join(here, clone["ref"]), ref_text=clone["text"])
                wavs, sr = m.generate_voice_clone(
                    text=[line["text"]] * a.seeds,
                    language=["Korean"] * a.seeds,
                    voice_clone_prompt=clone_prompt * a.seeds,
                    max_new_tokens=120,
                )
            else:
                wavs, sr = get("design").generate_voice_design(
                    text=[line["text"]] * a.seeds,
                    language=["Korean"] * a.seeds,
                    instruct=[instruct] * a.seeds,
                    max_new_tokens=120,
                )
            for p, w in zip(paths, wavs):
                sf.write(p, np.asarray(w, dtype=np.float32), sr)
            durs = ", ".join(f"{len(w) / sr:.2f}" for w in wavs)
            print(f"{key} seed={seed} takes=[{durs}]s in {time.time() - t0:.1f}s", flush=True)

if __name__ == "__main__":
    main()
