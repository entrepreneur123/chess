"""Generate raw voice-line candidates with Qwen3-TTS VoiceDesign (Apache-2.0).

Usage:
  python -I gen_voice.py --model <dir of Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign> \
      --lines lines.json --out <raw dir> [--seeds 3] [--only sad:capture-1,...]

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
    model = Qwen3TTSModel.from_pretrained(a.model, device_map="cpu", dtype=dtype)

    for char, c in spec["characters"].items():
        os.makedirs(os.path.join(a.out, char), exist_ok=True)
        for line in c["lines"]:
            key = f"{char}:{line['id']}"
            if only and key not in only:
                continue
            instruct = f"{c['voice']} {line['style']}"
            # All takes of a line are sampled in one batch (decoding is memory-bound on CPU, so a
            # batch of N costs little more than one take). File names carry the batch seed + index.
            seed = a.seed_base
            paths = [os.path.join(a.out, char, f"{line['id']}_s{seed}-{k}.wav") for k in range(a.seeds)]
            if all(os.path.exists(p) for p in paths):
                continue
            torch.manual_seed(seed)
            t0 = time.time()
            wavs, sr = model.generate_voice_design(
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
