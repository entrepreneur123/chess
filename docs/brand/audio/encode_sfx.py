"""Loudness-normalise and encode the synthesized SFX (from gen_sfx.py) to .m4a.

Usage:  python -I encode_sfx.py --wav <dir from gen_sfx.py> --out ../../../public/audio/sfx --qa qa-sfx.json
        [--only brutile-,waste-death]   (name prefixes; QA entries of other files are kept)
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I: add our own dir explicitly
from process_voice import centroid, edge_silence_ms, edge_trim, encode_checked, fades, limit, lufs

SR = 48000
TARGET_LUFS = -17.0  # a hair under the voice lines (-16) so dialogue sits on top


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qa", required=True)
    ap.add_argument("--only", default="", help="comma list of name prefixes to (re)encode")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = tuple(p.strip() for p in a.only.split(",") if p.strip())
    qa = json.load(open(a.qa)) if only and os.path.exists(a.qa) else {}
    for f in sorted(os.listdir(a.wav)):
        if not f.endswith(".wav") or (only and not f.startswith(only)):
            continue
        x, sr = sf.read(os.path.join(a.wav, f))
        assert sr == SR
        for _ in range(3):
            L = lufs(x, SR)
            x = limit(x * 10 ** ((TARGET_LUFS - L) / 20), peak_db=-2.0, sr=SR)
        x = fades(edge_trim(x, SR, -44.0, 8.0), SR, fin=0.001, fout=0.03)
        name = f[:-4]
        path = os.path.join(a.out, name + ".m4a")
        x, z = encode_checked(x, path, bitrate="64k", sr=SR)  # decoded peak <= -1 dBFS
        lead, trail = edge_silence_ms(z, SR)
        qa[name] = dict(file=f"sfx/{name}.m4a", dur=round(len(z) / SR, 3), lufs=round(lufs(z, SR), 2),
                        peak_db=round(20 * math.log10(np.abs(z).max() + 1e-12), 2), centroid=round(centroid(z, SR)),
                        lead_ms=round(lead), trail_ms=round(trail), bytes=os.path.getsize(path))
        print(json.dumps(qa[name]))
    json.dump(dict(sorted(qa.items())), open(a.qa, "w"), indent=1)


if __name__ == "__main__":
    main()
