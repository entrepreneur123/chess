"""Master the ElevenLabs eleven_v4 takes into the shipped voice clips.

Usage (from anywhere):
  python -I master_v4.py --gens <gens.tsv> --raw <dir of <generation_id>.mp3> [--out <public/audio/vo>]

gens.tsv: one line per voice line: `<char>\t<line id>\t<generation id>[\t<generation id>]` (a `-`
means no second take). For every line the takes are measured, one is chosen, and the chosen take is
trimmed, treated and mastered to -16 LUFS / -1.5 dBTP, then encoded as AAC-LC (32 kHz mono, 64 kb/s;
48 kb/s was measured to add up to 2.4 dB of peak overshoot and audible quantisation noise on breaths)
under `<out>/<char>-<id>.m4a`. A QA record per clip goes to qa-v4.json next to this script.

Take choice (2 takes per line): both are trimmed and measured; a take shorter than 0.45 s or with a
flat-topped peak (clipping) is rejected; among the rest the quicker events (select / move / capture /
skill / chain / trap / hop) take the shorter take (snappier in play, cut-ins stay in sync) and the
one-off moments (death / victory / awake-end) the longer one (more performance). Ties: the first.

Treatment is deliberately light: the v4 renders are the performance. Only the transformed Rakaeli
(lines with "fx": "rakaeli-awake") gets a demon layer, Michelle a +2 semitone lift (formant
preserved; the voice design filter refused a child register), Midos a short ghostly slap echo.
"""
import argparse
import io
import json
import os
import subprocess
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
LINES = os.path.join(HERE, "..", "lines.json")
SR = 44100
TARGET_LUFS = -16.0
TP_LIMIT_DB = -1.5
PRE_CEILING_DB = -3.0  # limiter ceiling before the AAC encoder (lowered per clip when the decode overshoots)
MAX_LIMIT_DB = 4.0        # most gain reduction the limiter may do on a sustained over
TRANSIENT_LIMIT_DB = 15.0  # ... and on consonant / plosive spikes (total time over the ceiling <= TRANSIENT_MS)
TRANSIENT_MS = 60.0
BITRATE = os.environ.get("VO_BITRATE", "64k")
OUT_SR = 32000  # shipped sample rate (sfx-v2/master_sfx.py sets 48000)
QUICK = {"select", "move", "capture", "skill", "chain", "trap-set", "trap-sprung", "hop-multi",
         "awake-select", "awake-move", "awake-capture"}


def run(cmd: list) -> bytes:
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode(errors="replace")[-2000:])
    return p.stdout


def decode(path: str, sr: int = SR) -> np.ndarray:
    out = run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "wav", "-"])
    x, _ = sf.read(io.BytesIO(out), dtype="float32")
    return x


def db(x: float) -> float:
    return 20 * np.log10(max(abs(x), 1e-9))


def envelope(x: np.ndarray, win: int) -> np.ndarray:
    n = len(x) // win
    return np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1))


def trim(x: np.ndarray, sr: int) -> np.ndarray:
    """Cut leading silence to 20 ms of pre-roll and the tail to 180 ms after the last sound."""
    win = int(0.005 * sr)
    env = envelope(x, win)
    peak = env.max() + 1e-9
    lead_thr = peak * 10 ** (-42 / 20)
    tail_thr = peak * 10 ** (-54 / 20)
    on = np.where(env > lead_thr)[0]
    off = np.where(env > tail_thr)[0]
    if len(on) == 0:
        return x
    start = max(0, on[0] * win - int(0.020 * sr))
    end = min(len(x), (off[-1] + 1) * win + int(0.180 * sr))
    y = x[start:end].copy()
    fi = min(len(y), int(0.008 * sr))
    y[:fi] *= np.linspace(0, 1, fi)
    fo = min(len(y), int(0.060 * sr))
    y[-fo:] *= np.linspace(1, 0, fo)
    return y


def clipped(x: np.ndarray) -> bool:
    """Flat-topped waveform: 4+ consecutive samples at the peak within 0.5 dB of full scale."""
    p = np.abs(x).max()
    if p < 0.94:
        return False
    hot = np.abs(x) >= p * 0.999
    run_len = 0
    for h in hot:
        run_len = run_len + 1 if h else 0
        if run_len >= 4:
            return True
    return False


def true_peak_db(x: np.ndarray, sr: int) -> float:
    """Inter-sample peak via 4x oversampling (ffmpeg aresample), a close proxy for dBTP."""
    buf = io.BytesIO()
    sf.write(buf, x, sr, format="WAV", subtype="FLOAT")
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-ar", str(sr * 4), "-f", "f32le", "-"],
                       input=buf.getvalue(), capture_output=True)
    y = np.frombuffer(p.stdout, dtype=np.float32)
    return float(db(np.abs(y).max() if len(y) else np.abs(x).max()))


def fx_chain(char: str, fx: str) -> str:
    """ffmpeg filter chain of the character treatment (after trimming, before loudness)."""
    if fx == "rakaeli-awake":
        # The transformed form: one semitone down (formants kept), a detuned +20 cent double 15 ms
        # late at -8 dB, and a dark 0.25 s tail.
        return ("asplit=2[a][b];[a]rubberband=pitch=0.94387:formant=preserved[a1];"
                "[b]rubberband=pitch=0.95486:formant=preserved,adelay=15|15,volume=-8dB,lowpass=f=3200[b1];"
                "[a1][b1]amix=inputs=2:normalize=0,aecho=0.9:0.35:60|120|250:0.22|0.14|0.08,lowpass=f=9000")
    if char == "michelle":
        return "rubberband=pitch=1.12246:formant=preserved"
    if char == "midos":
        return "aecho=0.92:0.3:85|170:0.18|0.09,lowpass=f=10000"
    return "anull"


def measure(x: np.ndarray, sr: int) -> dict:
    meter = pyln.Meter(sr)
    lufs = meter.integrated_loudness(x) if len(x) > sr * 0.4 else float("nan")
    return {"dur": round(len(x) / sr, 3), "lufs": round(float(lufs), 2), "peak_db": round(float(db(np.abs(x).max())), 2)}


def master(x: np.ndarray, sr: int, char: str, fx: str, out_path: str) -> dict:
    """Treat, normalise to -16 LUFS with a true-peak ceiling, encode AAC, verify the decoded file.

    The gain is computed from the treated but *unlimited* signal, so the limiter only ever catches
    the few peaks above the ceiling instead of acting as a compressor. The AAC encoder adds
    inter-sample / quantisation overshoot on top of the limiter ceiling (measured up to ~2.4 dB at
    48 kb/s), so the decoded file is measured and the ceiling lowered until it is under TP_LIMIT_DB.
    """
    tmp_in = out_path + ".in.wav"
    tmp_fx = out_path + ".fx.wav"
    sf.write(tmp_in, x, sr, subtype="FLOAT")
    chain = fx_chain(char, fx)
    run(["ffmpeg", "-y", "-v", "error", "-i", tmp_in, "-af", f"highpass=f=60,{chain}", "-c:a", "pcm_f32le", tmp_fx])
    z = decode(tmp_fx, sr)
    m0 = measure(z, sr)
    tp0 = true_peak_db(z, sr)
    if np.isfinite(m0["lufs"]):
        gain = TARGET_LUFS - m0["lufs"]
    else:
        # Too short or too sparse for a gated integrated loudness (some effects): peak-normalise instead.
        gain = (PRE_CEILING_DB - 1.0) - tp0
    # How much the limiter would have to take off the loudest peak, and for how long the signal sits
    # above the ceiling at that gain. In these takes the overs are consonant / plosive spikes of a few
    # ms (measured 5-30 ms per clip in total), which a 1.5 ms look-ahead limiter rounds off without an
    # audible trace, so those are allowed up to TRANSIENT_LIMIT_DB. Sustained overs (a held shout)
    # beyond MAX_LIMIT_DB would pump, so such a clip is left a little under target instead (flagged).
    y = z * 10 ** (gain / 20)
    over_ms = float(np.count_nonzero(np.abs(y) > 10 ** (PRE_CEILING_DB / 20)) / sr * 1000)
    gr = (tp0 + gain) - PRE_CEILING_DB
    allowed = TRANSIENT_LIMIT_DB if over_ms <= TRANSIENT_MS else MAX_LIMIT_DB
    if gr > allowed:
        gain -= gr - allowed
    ceiling_db = PRE_CEILING_DB

    def encode(g: float, c: float, attempt: int) -> dict:
        af = (f"volume={g:.2f}dB,"
              f"alimiter=limit={10 ** (c / 20):.4f}:level=false:attack=1.5:release=60,"
              f"aresample={OUT_SR}")
        run(["ffmpeg", "-y", "-v", "error", "-i", tmp_fx, "-af", af, "-ac", "1",
             "-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", out_path])
        y = decode(out_path, OUT_SR)
        m = measure(y, OUT_SR)
        return {**m, "tp_db": round(true_peak_db(y, OUT_SR), 2), "gain_db": round(g, 2),
                "limit_db": round(max(gr, 0.0), 2), "over_ms": round(over_ms, 1), "quieter": bool(gr > allowed),
                "ceiling_db": round(c, 2), "attempts": attempt, "size": os.path.getsize(out_path)}

    # Two knobs, re-measured on the decoded file: the ceiling comes down while the decode overshoots
    # TP_LIMIT_DB, the gain moves while the loudness is off target. The best compliant attempt (true
    # peak under the limit, loudness closest to target) is what ships, re-encoded if it was not the last.
    result = best = None
    for attempt in range(1, 9):
        result = encode(gain, ceiling_db, attempt)
        tp_ok = result["tp_db"] <= TP_LIMIT_DB + 0.2
        if tp_ok and (best is None or not np.isfinite(result["lufs"])
                      or abs(result["lufs"] - TARGET_LUFS) < abs(best["lufs"] - TARGET_LUFS)):
            best = result
        if not tp_ok:
            ceiling_db -= (result["tp_db"] - TP_LIMIT_DB) + 0.1
            continue
        if gr <= allowed and np.isfinite(result["lufs"]) and abs(result["lufs"] - TARGET_LUFS) > 0.4:
            gain += TARGET_LUFS - result["lufs"]
            gr = (tp0 + gain) - PRE_CEILING_DB
            continue
        break
    if best is not None and best is not result:
        result = encode(best["gain_db"], best["ceiling_db"], best["attempts"])
    os.remove(tmp_fx)
    os.remove(tmp_in)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "audio", "vo"))
    ap.add_argument("--only", default="", help="comma-separated char or char:id filters")
    args = ap.parse_args()
    spec = json.load(open(LINES, encoding="utf-8"))["characters"]
    meta = {}
    for char, c in spec.items():
        for l in c["lines"]:
            meta[(char, l["id"])] = l
    only = {s for s in args.only.split(",") if s}
    os.makedirs(args.out, exist_ok=True)
    qa_path = os.path.join(HERE, "qa-v4.json")
    qa = json.load(open(qa_path, encoding="utf-8")) if os.path.exists(qa_path) else {}
    rows = [ln.rstrip("\n").split("\t") for ln in open(args.gens, encoding="utf-8") if ln.strip()]
    total = 0
    written = 0
    for row in rows:
        char, lid = row[0], row[1]
        if only and char not in only and f"{char}:{lid}" not in only:
            continue
        line = meta.get((char, lid))
        if line is None:
            raise SystemExit(f"{char}:{lid} is not in lines.json")
        takes = [g for g in row[2:] if g and g != "-"]
        cands = []
        for g in takes:
            p = os.path.join(args.raw, f"{g}.mp3")
            if not os.path.exists(p):
                print(f"WARNING {char}:{lid}: missing take {g}")
                continue
            x = trim(decode(p), SR)
            cands.append({"gen": g, "x": x, "dur": len(x) / SR, "clipped": bool(clipped(x)), "raw": measure(x, SR)})
        ok = [c for c in cands if c["dur"] >= 0.45 and not c["clipped"]] or cands
        if not ok:
            raise SystemExit(f"{char}:{lid}: no usable take")
        quick = line["event"] in QUICK
        ok.sort(key=lambda c: c["dur"] if quick else -c["dur"])
        pick = ok[0]
        out_path = os.path.join(args.out, f"{char}-{lid}.m4a")
        res = master(pick["x"], SR, char, line.get("fx", ""), out_path)
        total += res["size"]
        written += 1
        qa[f"{char}:{lid}"] = {"take": pick["gen"], "candidates": [{"gen": c["gen"], "dur": round(c["dur"], 2), "clipped": c["clipped"]} for c in cands], **res}
        flag = "" if abs(res["lufs"] - TARGET_LUFS) <= 0.5 and res["tp_db"] <= TP_LIMIT_DB + 0.2 else "  <-- CHECK"
        if res["quieter"]:
            flag += f"  (sustained over: {res['limit_db']:.1f} dB above the ceiling for {res['over_ms']:.0f} ms, left quieter)"
        print(f"{char:9s} {lid:16s} take {pick['gen']}  {res['dur']:5.2f}s  {res['lufs']:6.2f} LUFS  {res['tp_db']:6.2f} dBTP  {res['size']:6d} B{flag}")
    json.dump(qa, open(qa_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {written} clips, {total} bytes")


if __name__ == "__main__":
    main()
