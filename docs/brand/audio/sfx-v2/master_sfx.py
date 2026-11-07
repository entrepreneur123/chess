"""Master the ElevenLabs eleven_text_to_sound_v2 takes into the shipped character / generic effects.

Usage (from anywhere):
  python -I master_sfx.py --gens gens.tsv --raw <dir of <name>_<generation id>.mp3> --out <public/audio/sfx> [--only name,...]

gens.tsv: `<name>\t<session id>\t<generation id>` per take (two takes per effect). Both takes are
trimmed (same envelope rules as the voice lines) and measured; a take is rejected when it is clipped
(flat-topped), shorter than 0.3 s or quiet (raw peak under -14 dBFS or under -30 LUFS: the model
occasionally returns a near-empty render; such effects were re-rendered with reworded prompts). Among the rest, select / move take the shorter take (snappy
in play), everything else the longer one (more of the gesture). Mastering reuses the voice pipeline
(docs/brand/audio/v4/master_v4.py): -17 LUFS integrated (a hair under the -16 LUFS voice lines, as the
previous synthesised set), transient-aware limiter, decoded true peak re-checked under -1.5 dBTP,
AAC-LC 48 kHz mono 64 kb/s. A QA record per effect goes to qa-sfx-v2.json next to this script.
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "v4"))
import master_v4 as V  # noqa: E402

SR = 48000
SHORT = ("-select", "-move")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    V.TARGET_LUFS = -17.0
    V.OUT_SR = SR
    V.MAX_LIMIT_DB = 6.0  # impacts: a few dB more of sustained limiting is fine on an effect
    only = {s for s in args.only.split(",") if s}
    os.makedirs(args.out, exist_ok=True)
    qa_path = os.path.join(HERE, "qa-sfx-v2.json")
    qa = json.load(open(qa_path, encoding="utf-8")) if os.path.exists(qa_path) else {}
    takes: dict = {}
    for ln in open(args.gens, encoding="utf-8"):
        if ln.strip():
            name, _sess, gen = ln.rstrip("\n").split("\t")
            takes.setdefault(name, []).append(gen)
    total = written = 0
    for name, gens in takes.items():
        if only and name not in only:
            continue
        cands = []
        for g in gens:
            p = os.path.join(args.raw, f"{name}_{g}.mp3")
            if not os.path.exists(p):
                print(f"WARNING {name}: missing take {g}")
                continue
            x = V.trim(V.decode(p, SR), SR)
            m = V.measure(x, SR)
            cands.append({"gen": g, "x": x, "dur": len(x) / SR, "clipped": bool(V.clipped(x)),
                          "lufs": float(m["lufs"]) if np.isfinite(m["lufs"]) else None, "peak_db": float(m["peak_db"])})
        ok = [c for c in cands if c["dur"] >= 0.3 and not c["clipped"] and c["peak_db"] > -14 and (c["lufs"] is None or c["lufs"] > -30)]
        if not ok:
            ok = sorted([c for c in cands if c["dur"] >= 0.3] or cands, key=lambda c: -c["peak_db"])[:1]
            print(f"WARNING {name}: no full-level take, using the loudest render (peak {ok[0]['peak_db']:.1f} dBFS)")
        if not ok:
            raise SystemExit(f"{name}: no usable take")
        short = name.endswith(SHORT)
        ok.sort(key=lambda c: c["dur"] if short else -c["dur"])
        pick = ok[0]
        out_path = os.path.join(args.out, f"{name}.m4a")
        res = V.master(pick["x"], SR, "", "", out_path)
        total += res["size"]
        written += 1
        qa[name] = {"take": pick["gen"], "candidates": [{k: v for k, v in c.items() if k != "x"} for c in cands], **res}
        lufs_ok = not np.isfinite(res["lufs"]) or abs(res["lufs"] - V.TARGET_LUFS) <= 0.5 or res["quieter"]
        flag = "" if lufs_ok and res["tp_db"] <= V.TP_LIMIT_DB + 0.2 else "  <-- CHECK"
        if res["quieter"]:
            flag += f"  (peak-led: {res['lufs']:.1f} LUFS, limiter would need {res['limit_db']:.1f} dB)"
        print(f"{name:22s} take {pick['gen']}  {res['dur']:5.2f}s  {res['lufs']:6.2f} LUFS  {res['tp_db']:6.2f} dBTP  {res['size']:6d} B{flag}")
    json.dump(qa, open(qa_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {written} effects, {total} bytes")


if __name__ == "__main__":
    main()
