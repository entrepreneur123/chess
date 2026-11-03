"""Post-process raw TTS takes (Qwen3-TTS wavs from gen_voice.py, or ElevenLabs mp3 downloads named
<line-id>_t<k>.mp3): pick the best take per line, light character treatment, natural endings,
-16 LUFS / -1 dBTP, AAC encode, objective QA. Replaces process_voice.py (kept for reference).

Usage:
  python -I post_voice.py --lines lines.json --raw <dir with <char>/<line-id>_*.{wav,mp3}> \
      --asr <faster-whisper dir> --out ../../../public/audio/vo --qa qa-voice.json \
      [--gender <wav2vec2 gender classifier dir>] [--only-char brutile] [--wav-out <dir>]

Per take:
  1. Decode to 24 kHz mono. Trim leading silence (15 ms pre-roll, 8 ms raised-cosine fade-in). The
     end of speech is found at -45 dB below the loudest 10 ms frame; everything after it is kept.
  2. Adaptive de-harsh: a split-band de-esser (4.5 kHz up, compressed only where it dominates the
     full band) and a broad 3.5 kHz cut whose depth depends on how bright the take measures
     (2-8 kHz vs 0.1-2 kHz energy) against the character's target. No bit-crushing anywhere.
  3. Character FX (fx_* below). Pitch is never shifted on the main voice. Extra layers (marki's
     sub-octave growl, insaner's octave-down demon double) are resynthesised with the WORLD vocoder.
  4. Reverb tails are rendered in full and the clip ends only where its level has fallen 55 dB
     below the peak, then gets a >= 150 ms cosine fade, so no tail is ever cut.
  5. Loudness -16 LUFS (BS.1770) with a 4x-oversampled true-peak limiter; after AAC encoding the
     decoded file is re-checked and re-encoded quieter until it is <= -1 dBTP.
  6. Every raw take is transcribed first; the best few per line (CER, closeness to the character's
     median pitch - shouted takes sit far above it - and length) are fully processed and judged on
     what actually ships (decoded .m4a): Whisper CER, pitch deviation, length, and for characters
     marked "gender": "female" a gate on the classifier's P(female) when --gender is given.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import pyworld as pw
from scipy import signal

import voice_qa as vq
from process_voice import Asr, biquad, cer, compress, encode_m4a, lufs

SR = vq.SR
TARGET_LUFS = -16.0
TP_LIMIT = -1.5   # limiter ceiling before encoding (dBTP); the decoded file must be <= -1.0 dBTP
TP_MAX = -1.0
rng = np.random.default_rng(11)


# ------------------------------------------------------------------------------------------------
# Edges
# ------------------------------------------------------------------------------------------------

def frame_rms(x: np.ndarray, hop: int):
    n = len(x) // hop
    return np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-14)


def trim_lead(x: np.ndarray, rel_db: float = -40.0, pre_ms: float = 15.0) -> np.ndarray:
    hop = int(0.005 * SR)
    r = frame_rms(x, hop)
    on = np.where(r > max(r.max() * 10 ** (rel_db / 20), 10 ** (-60 / 20)))[0]
    if not len(on):
        return x
    a = max(0, on[0] * hop - int(pre_ms / 1000 * SR))
    y = x[a:].copy()
    n = int(0.008 * SR)
    y[:n] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n))
    return y


def speech_end(x: np.ndarray, rel_db: float = -45.0) -> int:
    hop = int(0.01 * SR)
    r = frame_rms(x, hop)
    on = np.where(r > r.max() * 10 ** (rel_db / 20))[0]
    return int((on[-1] + 1) * hop) if len(on) else len(x)


def finish_tail(x: np.ndarray, end_hint: int, floor_db: float = -55.0, fade_s: float = 0.15) -> np.ndarray:
    """Cut where the signal (incl. any reverb tail) has decayed floor_db below its loudest 10 ms
    frame, never before end_hint + fade, then apply a cosine fade over the last fade_s seconds."""
    hop = int(0.01 * SR)
    r = frame_rms(x, hop)
    thr = r.max() * 10 ** (floor_db / 20)
    start = min(len(r) - 1, end_hint // hop)
    below = np.where(r[start:] < thr)[0]
    cut = (start + below[0]) * hop if len(below) else len(x)
    cut = min(len(x), max(cut, end_hint + int(fade_s * SR)))
    y = x[:cut].copy()
    n = min(int(fade_s * SR), len(y) // 2)
    y[-n:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, n))
    return y


# ------------------------------------------------------------------------------------------------
# Tone
# ------------------------------------------------------------------------------------------------

def envelope(x: np.ndarray, ms: float = 8.0) -> np.ndarray:
    n = max(1, int(ms / 1000 * SR))
    return np.sqrt(np.convolve(x ** 2, np.ones(n) / n, "same") + 1e-14)


def deess(x: np.ndarray, split: float = 4500.0, thr: float = 0.35, ratio: float = 4.0, max_gr: float = 9.0):
    """Split-band de-esser: the band above `split` is turned down only while it carries more than
    `thr` of the full-band envelope (sibilants, rasp spikes), so vowels keep their air."""
    sos = signal.butter(4, split, "highpass", fs=SR, output="sos")
    hi = signal.sosfiltfilt(sos, x)
    lo = x - hi
    ratio_db = 20 * np.log10(envelope(hi) / (thr * envelope(x)) + 1e-12)
    gr = np.clip(ratio_db * (1 - 1 / ratio), 0, max_gr)
    gr = signal.filtfilt(np.ones(int(0.004 * SR)) / int(0.004 * SR), [1.0], gr)
    return lo + hi * 10 ** (-gr / 20)


def deharsh(x: np.ndarray, target_db: float) -> np.ndarray:
    """Broad presence cut, deeper the brighter the take measures relative to target_db."""
    harsh, _, _ = vq.band_stats(x, SR)
    cut = float(np.clip(target_db - harsh, -6.0, 0.0))
    if cut < -0.3:
        x = biquad(x, "peak", 3500, cut, 0.6)
        x = biquad(x, "highshelf", 7500, cut * 0.5)
    return x


def hall(x: np.ndarray, rt60: float, wet: float, predelay: float = 0.02, lp: float = 4500.0, hp: float = 250.0):
    """Seeded noise-IR reverb, rendered with its full tail (len(x) + rt60)."""
    L = int(rt60 * SR)
    ir = rng.standard_normal(L) * np.exp(-6.91 * np.arange(L) / L)
    ir = biquad(biquad(ir, "lp", lp), "hp", hp)
    ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
    ir /= np.sqrt((ir ** 2).sum()) + 1e-12
    y = signal.fftconvolve(x, ir)
    dry = np.concatenate([x, np.zeros(len(y) - len(x))])
    return dry + wet * y * (np.sqrt((x ** 2).mean()) / (np.sqrt((y[: len(x)] ** 2).mean()) + 1e-12))


def pad(x: np.ndarray, n: int) -> np.ndarray:
    return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))


def world_layer(x: np.ndarray, pitch: float, formant: float) -> np.ndarray:
    """WORLD resynthesis of x with F0 * pitch and the spectral envelope scaled by `formant`
    (< 1 = bigger vocal tract). Used only for layers under the untouched main voice."""
    f0, t = pw.harvest(x, SR, f0_floor=55, f0_ceil=1000, frame_period=5)
    sp = pw.cheaptrick(x, f0, t, SR)
    ap = pw.d4c(x, f0, t, SR)
    nb = sp.shape[1]
    src = np.clip(np.arange(nb) / formant, 0, nb - 1)
    sp = np.stack([np.interp(src, np.arange(nb), row) for row in sp])
    ap = np.stack([np.interp(src, np.arange(nb), row) for row in ap])
    y = pw.synthesize(np.ascontiguousarray(f0 * pitch), np.ascontiguousarray(sp), np.ascontiguousarray(ap), SR, 5)
    return pad(y, len(x))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt((x ** 2).mean()) + 1e-12)


# ------------------------------------------------------------------------------------------------
# Character chains (input: trimmed, de-harshed take; output may be longer: reverb tail)
# ------------------------------------------------------------------------------------------------

def fx_sad(x):
    y = biquad(x, "hp", 70)
    y = biquad(y, "lowshelf", 180, 1.5)
    y = compress(y, -20, 2.0, attack=0.008, release=0.12)
    return hall(y, 1.3, 0.12, predelay=0.025, lp=4500)


def fx_walk(x):
    y = biquad(x, "hp", 80)
    y = biquad(y, "peak", 300, 1.0, 0.8)
    pk = np.abs(y).max() + 1e-9
    y = 0.8 * y + 0.2 * np.tanh(2.0 * y / pk) * pk  # a little grit for the veteran
    y = compress(y, -22, 3.0, attack=0.005, release=0.08)
    return hall(y, 0.6, 0.08, predelay=0.01, lp=4000)


def fx_marki(x):
    y = biquad(x, "hp", 45)
    # Growl: a sub-octave double with a bigger body, rough 32 Hz amplitude flutter and saturation.
    sub = world_layer(y, 0.5, 0.85)
    t = np.arange(len(y)) / SR
    sub *= 1 + 0.45 * np.sin(2 * math.pi * 32 * t + 0.8 * np.sin(2 * math.pi * 4 * t))
    pk = np.abs(sub).max() + 1e-9
    sub = biquad(np.tanh(2.0 * sub / pk) * pk, "lp", 1400)
    y = y + 0.42 * sub * rms(y) / rms(sub)
    pk = np.abs(y).max() + 1e-9
    y = 0.7 * y + 0.3 * np.tanh(1.8 * y / pk) * pk
    y = biquad(y, "lowshelf", 150, 2.5)
    y = biquad(y, "highshelf", 5000, -2.5)
    y = compress(y, -20, 3.0, attack=0.006, release=0.1)
    return hall(y, 0.8, 0.10, predelay=0.012, lp=3000)


def fx_insaner(x):
    """Evil imp: the small voice plus a strong octave-down demon double with a growl texture,
    a touch of ring modulation and flanging, and a dark tail."""
    y = biquad(x, "hp", 120)
    n = len(y)
    t = np.arange(n) / SR
    low = world_layer(y, 0.5, 0.78)
    low *= 1 + 0.5 * np.sin(2 * math.pi * 47 * t)            # growl flutter on the demon layer
    pk = np.abs(low).max() + 1e-9
    low = biquad(np.tanh(2.2 * low / pk) * pk, "lp", 2200)
    low = np.concatenate([np.zeros(int(0.012 * SR)), low])[:n]  # 12 ms behind: a second throat
    ring = y * np.sin(2 * math.pi * 92 * t)                   # metallic edge
    mix = y + 0.75 * low * rms(y) / rms(low) + 0.14 * ring
    # Flanger: 0.6-2.6 ms delay swept at 0.35 Hz, with feedback.
    d = (1.6 + 1.0 * np.sin(2 * math.pi * 0.35 * t)) / 1000 * SR
    fl = np.zeros(n)
    idx = np.arange(n) - d
    for _ in range(2):  # two passes of interpolated delay ~ feedback 0.4
        fl = np.interp(idx, np.arange(n), mix + 0.4 * fl, left=0.0)
    y = mix + 0.35 * fl
    y = biquad(y, "lowshelf", 220, 2.0)
    y = biquad(y, "lp", 8500)
    y = compress(y, -22, 3.0, attack=0.005, release=0.1)
    return hall(y, 1.5, 0.20, predelay=0.02, lp=2500, hp=150)


def fx_brutile(x):
    """Old witch: her own voice (never pitch-shifted, it is what keeps her female), a slow subtle
    chorus for an uncanny shimmer, and a dark hall."""
    y = biquad(x, "hp", 90)
    n = len(y)
    t = np.arange(n) / SR
    d = (9.0 + 1.5 * np.sin(2 * math.pi * 0.3 * t)) / 1000 * SR
    y = 0.9 * y + 0.18 * np.interp(np.arange(n) - d, np.arange(n), y, left=0.0)
    y = biquad(y, "lowshelf", 220, 1.0)
    y = compress(y, -22, 2.5, attack=0.006, release=0.12)
    return hall(y, 1.5, 0.15, predelay=0.03, lp=4000)


FX = {"sad": fx_sad, "marki": fx_marki, "walk": fx_walk, "insaner": fx_insaner, "brutile": fx_brutile}
# Brightness target (voice_qa harsh_db) for the adaptive presence cut; ElevenLabs takes measure
# about -6..-1 dB raw. Humans sit warmer, the witch keeps a little more rasp.
HARSH_TARGET = {"sad": -9.0, "marki": -11.0, "walk": -9.0, "insaner": -8.0, "brutile": -7.0}


# ------------------------------------------------------------------------------------------------
# Loudness / true peak / encoding
# ------------------------------------------------------------------------------------------------

def tp_limit(x: np.ndarray, ceil_db: float = TP_LIMIT, release: float = 0.05) -> np.ndarray:
    """Look-ahead gain limiter driven by the 4x-oversampled (true) peak envelope."""
    thr = 10 ** (ceil_db / 20)
    up = np.abs(signal.resample_poly(x, 4, 1)).reshape(-1, 4).max(axis=1)[: len(x)]
    up = np.pad(up, (0, len(x) - len(up)))
    g = np.minimum(1.0, thr / (up + 1e-12))
    look = int(0.002 * SR)
    g = np.minimum.reduce([np.roll(g, -k) for k in range(look + 1)])
    a = math.exp(-1 / (release * SR))
    out = np.empty_like(g)
    prev = 1.0
    for i, v in enumerate(g):
        prev = v if v < prev else a * prev + (1 - a) * v
        out[i] = prev
    return x * out


def normalise(x: np.ndarray) -> np.ndarray:
    for _ in range(3):
        L = lufs(x)
        if not math.isfinite(L):
            break
        x = tp_limit(x * 10 ** ((TARGET_LUFS - L) / 20))
    return x


def encode_tp(y: np.ndarray, path: str):
    """Encode, then re-encode quieter until the decoded file's true peak is <= TP_MAX."""
    for _ in range(5):
        encode_m4a(y, path, "64k", SR)
        z = vq.load(path)
        over = vq.true_peak_db(z) - TP_MAX
        if over <= 0:
            break
        y = y * 10 ** (-(over + 0.2) / 20)
    return y, z


def render(x: np.ndarray, char: str) -> np.ndarray:
    x = trim_lead(x)
    end = speech_end(x)
    x = x[: min(len(x), end + int(0.35 * SR))]  # keep the natural decay after the last word
    x = x / (np.abs(x).max() + 1e-9) * 0.7
    x = deess(x)
    x = deharsh(x, HARSH_TARGET[char])
    y = FX[char](x)
    y = finish_tail(y, end)
    return normalise(y)


# ------------------------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------------------------

def take_files(rawdir: str, line_id: str):
    """ElevenLabs downloads are <id>_t<k>.mp3, gen_voice.py writes <id>_s<seed>-<k>.wav."""
    return sorted(f for f in os.listdir(rawdir) if f.startswith(line_id + "_") and f.endswith((".wav", ".mp3")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--asr", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qa", required=True)
    ap.add_argument("--gender", default="", help="optional wav2vec2 gender classifier dir (QA + female gate)")
    ap.add_argument("--only-char", default="")
    ap.add_argument("--only-line", default="", help="comma list of char:line-id")
    ap.add_argument("--shortlist", type=int, default=3, help="takes per line that are fully processed")
    ap.add_argument("--wav-out", default="")
    ap.add_argument("--threads", type=int, default=3)
    a = ap.parse_args()
    spec = json.load(open(a.lines, encoding="utf-8"))
    asr = Asr(a.asr, a.threads)
    gender = vq.Gender(a.gender) if a.gender else None
    os.makedirs(a.out, exist_ok=True)
    qa = json.load(open(a.qa, encoding="utf-8")) if os.path.exists(a.qa) else {}
    only = {s.strip() for s in a.only_line.split(",") if s.strip()}

    for char, c in spec["characters"].items():
        if a.only_char and char != a.only_char:
            continue
        rawdir = os.path.join(a.raw, char)
        src = c.get("source", {})
        want_female = c.get("gender") == "female"
        # Pass 1: ASR + pitch of every raw take (speech part only).
        cands = {}
        for line in c["lines"]:
            if only and f"{char}:{line['id']}" not in only:
                continue
            ref = line.get("asr", line["text"])
            lst = []
            for f in take_files(rawdir, line["id"]):
                x = trim_lead(vq.load(os.path.join(rawdir, f)))
                x = x[: speech_end(x) + int(0.1 * SR)]
                f0 = vq.f0_track(x)
                v = f0[f0 > 0]
                hyp = asr(x)
                lst.append(dict(file=f, hyp=hyp, cer=cer(ref, hyp), dur=len(x) / SR,
                                f0=float(np.median(v)) if len(v) > 20 else 0.0))
            if lst:
                cands[line["id"]] = lst
            else:
                print(f"WARNING: no takes for {char}:{line['id']}", flush=True)
        good = [k["f0"] for v in cands.values() for k in v if k["cer"] <= 0.2 and k["f0"] > 0]
        med = float(np.median(good)) if good else 0.0
        print(f"{char}: median F0 of intelligible raw takes {med:.0f} Hz", flush=True)

        def dev(k):  # shouted / off-character takes sit far from the character's median pitch
            return abs(math.log2(k["f0"] / med)) if (med and k["f0"]) else 0.0

        # Pass 2: fully process the best few takes of each line, judge what ships.
        for line in c["lines"]:
            if line["id"] not in cands:
                continue
            ref = line.get("asr", line["text"])
            ranked = sorted(cands[line["id"]],
                            key=lambda k: k["cer"] + 0.3 * dev(k) + 0.3 * max(0.0, k["dur"] - 2.4))
            best = None
            for k in ranked[: a.shortlist]:
                y = render(vq.load(os.path.join(rawdir, k["file"])), char)
                tmp = os.path.join(a.out, f".tmp-{char}-{line['id']}.m4a")
                y, z = encode_tp(y, tmp)
                os.remove(tmp)
                hyp = asr(z)
                d = len(z) / SR
                score = cer(ref, hyp) + 0.3 * dev(k) + 0.15 * max(0.0, d - 2.6)
                fp = None
                if gender is not None and want_female:
                    fp = gender(z)
                    score += 2.0 * max(0.0, 0.6 - fp)
                print(f"  {char}:{line['id']} {k['file']} -> {hyp!r} cer={cer(ref, hyp):.2f} dur={d:.2f} "
                      f"f0={k['f0']:.0f} fem={fp} ({score:.3f})", flush=True)
                if best is None or score < best[0]:
                    best = (score, k, y, hyp)
            _, k, y, hyp = best
            name = f"{char}-{line['id']}"
            if a.wav_out:
                import soundfile as sf
                os.makedirs(a.wav_out, exist_ok=True)
                sf.write(os.path.join(a.wav_out, name + ".wav"), y.astype(np.float32), SR, subtype="FLOAT")
            path = os.path.join(a.out, name + ".m4a")
            y, z = encode_tp(y, path)
            rec = dict(file=f"vo/{name}.m4a", character=char, event=line["event"], text=line["text"], ref=ref,
                       source=src.get("engine", ""), voice=src.get("voice", ""),
                       take=k["file"], takes=len(cands[line["id"]]), take_asr=k["hyp"], take_cer=round(k["cer"], 3),
                       take_f0=round(k["f0"], 1), asr=hyp, cer=round(cer(ref, hyp), 3),
                       **vq.measure(z, SR, gender), bytes=os.path.getsize(path))
            qa[name] = rec
            print(json.dumps(rec, ensure_ascii=False), flush=True)
        json.dump(qa, open(a.qa, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
