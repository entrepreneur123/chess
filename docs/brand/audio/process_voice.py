"""Pick the best TTS take per line, give each character its voice treatment, normalise, encode, QA.

Usage:
  python -I process_voice.py --lines lines.json --raw <raw dir from gen_voice.py> \
      --asr <faster-whisper model dir> --out ../../../public/audio/vo --qa qa-voice.json

Pipeline per line:
  1. ASR every candidate take (faster-whisper, language=ko), score = character error rate
     + penalties for over-long takes and pitch far from the character's typical pitch.
  2. Trim silence, then pitch/formant/tempo transform with ffmpeg (asetrate shifts formants,
     rubberband with formant=preserved fixes the pitch) towards a per-character target F0.
  3. Character effects (numpy/scipy): EQ, reverb, growl layer, bitcrush, chorus...
  4. Loudness -16 LUFS (pyloudnorm), peak limit -1 dBFS, 5 ms fade-in / 30 ms fade-out.
  5. Encode AAC-LC mono .m4a, decode it again and run ASR + objective stats on what ships.
"""
import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np
import pyloudnorm as pyln
import pyworld as pw
from faster_whisper import WhisperModel
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 24000
rng = np.random.default_rng(7)

# Per-character voice treatment.
#   f0: target median pitch (Hz) after processing.   formant: spectral-envelope scale (<1 = bigger body).
#   tempo: duration ratio (<1 = faster).             pull: how far each line is pulled to the target (0..1).
CHAR = {
    "sad": dict(f0=150.0, formant=0.95, tempo=1.0, pull=0.45),
    "marki": dict(f0=92.0, formant=0.84, tempo=1.04, pull=0.45),
    "walk": dict(f0=128.0, formant=0.98, tempo=0.96, pull=0.5),
    "insaner": dict(f0=470.0, formant=1.13, tempo=0.9, pull=0.4),
}
MAX_DUR = {"death": 1.9, "victory": 1.9, "skill": 1.7}
DEFAULT_MAX_DUR = 1.6
TARGET_LUFS = -16.0
PEAK_DB = -1.5  # leaves room for AAC overshoot; decoded files are checked against -1 dBFS


# ------------------------------------------------------------------------------------------------
# I/O helpers
# ------------------------------------------------------------------------------------------------

def load(path: str, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def ffilter(x: np.ndarray, af: str, sr: int = SR) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-af", af,
                        "-f", "f32le", "-ar", str(sr), "-ac", "1", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def encode_m4a(x: np.ndarray, path: str, bitrate: str = "48k", sr: int = SR) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
                    "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", "-map_metadata", "-1", path],
                   input=x.astype(np.float32).tobytes(), check=True)


# ------------------------------------------------------------------------------------------------
# Analysis
# ------------------------------------------------------------------------------------------------

def f0_stats(x: np.ndarray, sr: int = SR):
    f0, _ = pw.harvest(x, sr, f0_floor=55, f0_ceil=1000, frame_period=5)
    v = f0[f0 > 0]
    return (float(np.median(v)) if len(v) else 0.0), len(v) / max(1, len(f0))


def lufs(x: np.ndarray, sr: int = SR) -> float:
    dur = len(x) / sr
    if dur < 0.45:
        x = np.concatenate([x, x[::-1]])  # mirrored padding keeps level, satisfies the 400 ms block
        dur *= 2
    m = pyln.Meter(sr, block_size=min(0.4, dur * 0.95))
    return float(m.integrated_loudness(x))


def edge_silence_ms(x: np.ndarray, sr: int = SR, thr_db: float = -45.0):
    idx = np.where(np.abs(x) > 10 ** (thr_db / 20))[0]
    if not len(idx):
        return len(x) / sr * 1000, len(x) / sr * 1000
    return idx[0] / sr * 1000, (len(x) - 1 - idx[-1]) / sr * 1000


def centroid(x: np.ndarray, sr: int = SR) -> float:
    f, _, Z = signal.stft(x, sr, nperseg=1024)
    mag = np.abs(Z)
    e = mag.sum(axis=0)
    keep = e > e.max() * 0.05
    c = (mag[:, keep] * f[:, None]).sum(axis=0) / (mag[:, keep].sum(axis=0) + 1e-12)
    return float(np.median(c))


def norm_text(s: str) -> str:
    return "".join(ch for ch in s if ch.isalnum())


def cer(ref: str, hyp: str) -> float:
    r, h = norm_text(ref), norm_text(hyp)
    if not r:
        return 0.0
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / len(r)


class Asr:
    def __init__(self, model_dir: str):
        self.m = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)

    def __call__(self, x: np.ndarray, sr: int = SR) -> str:
        a = signal.resample_poly(x, 16000, sr).astype(np.float32)
        a = np.concatenate([np.zeros(4000, np.float32), a, np.zeros(8000, np.float32)])
        segs, _ = self.m.transcribe(a, language="ko", beam_size=5, vad_filter=False,
                                    condition_on_previous_text=False, temperature=0.0)
        return "".join(s.text for s in segs).strip()


# ------------------------------------------------------------------------------------------------
# DSP
# ------------------------------------------------------------------------------------------------

def trim(x: np.ndarray, sr: int = SR, rel_db: float = -38.0, pre_ms: float = 12, post_ms: float = 45) -> np.ndarray:
    hop = int(0.005 * sr)
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (0, hop * 2)), hop * 2)[::hop]
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    thr = max(rms.max() * 10 ** (rel_db / 20), 10 ** (-55 / 20))
    on = np.where(rms > thr)[0]
    if not len(on):
        return x
    a = max(0, on[0] * hop - int(pre_ms / 1000 * sr))
    b = min(len(x), (on[-1] + 2) * hop + int(post_ms / 1000 * sr))
    return x[a:b].copy()


def edge_trim(x: np.ndarray, sr: int = SR, abs_db: float = -44.0, keep_ms: float = 10.0) -> np.ndarray:
    """After normalisation: drop leading/trailing samples quieter than abs_db (dBFS), keep a few ms."""
    idx = np.where(np.abs(x) > 10 ** (abs_db / 20))[0]
    if not len(idx):
        return x
    k = int(keep_ms / 1000 * sr)
    return x[max(0, idx[0] - k): min(len(x), idx[-1] + k)].copy()


def fades(x: np.ndarray, sr: int = SR, fin: float = 0.005, fout: float = 0.03) -> np.ndarray:
    x = x.copy()
    n1, n2 = int(fin * sr), min(int(fout * sr), len(x) // 3)
    x[:n1] *= np.linspace(0, 1, n1)
    x[-n2:] *= np.linspace(1, 0, n2) ** 1.5
    return x


def biquad(x, kind, f, gain_db=0.0, q=0.707, sr=SR):
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f / sr
    alpha = math.sin(w0) / (2 * q)
    c = math.cos(w0)
    if kind == "peak":
        b = [1 + alpha * A, -2 * c, 1 - alpha * A]
        a = [1 + alpha / A, -2 * c, 1 - alpha / A]
    elif kind == "lowshelf":
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
        a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
    elif kind == "highshelf":
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
        a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        a = [1 + alpha, -2 * c, 1 - alpha]
    elif kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
        a = [1 + alpha, -2 * c, 1 - alpha]
    else:
        raise ValueError(kind)
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def reverb(x, rt60, wet, predelay=0.02, lp=5000.0, tail=0.25, sr=SR):
    L = int(rt60 * sr)
    ir = rng.standard_normal(L) * np.exp(-6.91 * np.arange(L) / L)
    ir = biquad(biquad(ir, "lp", lp), "hp", 200)
    ir = np.concatenate([np.zeros(int(predelay * sr)), ir])
    ir /= np.sqrt((ir ** 2).sum()) + 1e-12
    y = signal.fftconvolve(x, ir)[: len(x) + int(tail * sr)]
    dry = np.concatenate([x, np.zeros(len(y) - len(x))])
    return dry + wet * y * (np.abs(x).max() / (np.abs(y).max() + 1e-12))


def compress(x, thr_db=-20.0, ratio=3.0, attack=0.004, release=0.08, sr=SR):
    env = np.abs(x)
    a_a, a_r = math.exp(-1 / (attack * sr)), math.exp(-1 / (release * sr))
    e = np.zeros_like(env)
    prev = 0.0
    for i, v in enumerate(env):
        coef = a_a if v > prev else a_r
        prev = coef * prev + (1 - coef) * v
        e[i] = prev
    lvl = 20 * np.log10(e + 1e-9)
    over = np.maximum(0, lvl - thr_db)
    gain = 10 ** (-(over - over / ratio) / 20)
    return x * gain


def chorus(x, depth_ms=2.5, base_ms=7.0, rate=0.7, mix=0.35, sr=SR):
    n = np.arange(len(x))
    d = (base_ms + depth_ms * np.sin(2 * math.pi * rate * n / sr)) / 1000 * sr
    idx = n - d
    y = np.interp(idx, n, x, left=0.0)
    return x * (1 - mix * 0.5) + mix * y


def bitcrush(x, bits=6, hold=3):
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    y = np.repeat(y[::hold], hold)[: len(x)]
    return y


def pitch_formant(x, q, r, s, sr=SR):
    """q: pitch ratio, r: formant ratio, s: duration ratio. asetrate scales pitch+formant+speed by r,
    rubberband (formant preserved) then fixes pitch to q and duration to s."""
    rate = int(round(sr * r))
    af = (f"asetrate={rate},aresample={sr}:resampler=soxr,"
          f"rubberband=pitch={q / r:.5f}:tempo={1 / (r * s):.5f}:formant=preserved:pitchq=quality:"
          f"transients=mixed:window=standard:phase=laminar")
    return ffilter(x, af, sr)


def limit(x, peak_db=PEAK_DB, look_ms=2.0, release=0.06, sr=SR):
    thr = 10 ** (peak_db / 20)
    g = np.minimum(1.0, thr / (np.abs(x) + 1e-12))
    g = minimum_filter1d(g, size=max(1, int(look_ms / 1000 * sr)) * 2 + 1)
    out = np.empty_like(g)
    a = math.exp(-1 / (release * sr))
    prev = 1.0
    for i, v in enumerate(g):
        prev = v if v < prev else a * prev + (1 - a) * v
        out[i] = prev
    return np.clip(x * out, -thr, thr)


def loudness_normalise(x, target=TARGET_LUFS):
    for _ in range(3):
        L = lufs(x)
        if not math.isfinite(L):
            break
        x = limit(x * 10 ** ((target - L) / 20))
    return x


# ------------------------------------------------------------------------------------------------
# Character chains
# ------------------------------------------------------------------------------------------------

def fx_sad(x):
    y = biquad(x, "hp", 75)
    y = biquad(y, "lowshelf", 220, 2.0)
    y = biquad(y, "peak", 2800, 2.0, 1.0)
    y = biquad(y, "peak", 7000, -2.0, 1.2)
    y = compress(y, -22, 2.5)
    return reverb(y, 1.25, 0.22, predelay=0.028, lp=5500, tail=0.28)


def fx_marki(x):
    # Growl: a sub-octave layer with 34 Hz roughness and saturation under the main voice.
    sub = ffilter(x, "rubberband=pitch=0.5:formant=preserved:pitchq=quality:transients=mixed")
    sub = sub[: len(x)] if len(sub) >= len(x) else np.pad(sub, (0, len(x) - len(sub)))
    t = np.arange(len(x)) / SR
    rough = 1 + 0.55 * np.sin(2 * math.pi * 34 * t + 0.6 * np.sin(2 * math.pi * 5 * t))
    sub = np.tanh(2.2 * sub / (np.abs(sub).max() + 1e-9)) * rough
    sub = biquad(sub, "lp", 1600)
    main = np.tanh(1.6 * x / (np.abs(x).max() + 1e-9)) * 0.75 + 0.25 * x / (np.abs(x).max() + 1e-9)
    y = main + 0.42 * sub
    y = biquad(y, "hp", 50)
    y = biquad(y, "lowshelf", 160, 4.0)
    y = biquad(y, "peak", 900, 1.5, 0.9)
    y = biquad(y, "highshelf", 4500, -4.0)
    y = biquad(y, "lp", 9000)
    y = compress(y, -20, 3.5)
    return reverb(y, 0.65, 0.12, predelay=0.012, lp=3500, tail=0.18)


def fx_walk(x):
    y = biquad(x, "hp", 100)
    y = biquad(y, "peak", 250, -1.5, 1.0)
    y = biquad(y, "peak", 2600, 3.0, 1.1)
    y = biquad(y, "highshelf", 6500, 1.0)
    y = compress(y, -24, 3.0, attack=0.003, release=0.06)
    return reverb(y, 0.35, 0.09, predelay=0.008, lp=6000, tail=0.1)


def fx_insaner(x):
    peak = np.abs(x).max() + 1e-9
    y = biquad(x, "hp", 180)
    # Sinister undertone: the same line an octave down, quiet, under the squeaky voice.
    low = ffilter(x, "rubberband=pitch=0.5:formant=shifted:pitchq=quality:transients=mixed")
    low = low[: len(x)] if len(low) >= len(x) else np.pad(low, (0, len(x) - len(low)))
    crushed = bitcrush(y / peak, bits=6, hold=2) * peak
    y = 0.82 * y + 0.18 * crushed + 0.12 * low
    y = np.tanh(1.4 * y / peak) * peak
    y = chorus(y, depth_ms=1.8, base_ms=5.0, rate=0.9, mix=0.32)
    y = biquad(y, "peak", 3200, 2.0, 1.0)
    y = biquad(y, "lp", 10500)
    y = compress(y, -22, 3.0)
    return reverb(y, 0.5, 0.12, predelay=0.01, lp=7000, tail=0.15)


FX = {"sad": fx_sad, "marki": fx_marki, "walk": fx_walk, "insaner": fx_insaner}


# ------------------------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--asr", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qa", required=True)
    ap.add_argument("--wav-out", default="", help="optional dir for the processed wavs (pre-encode)")
    ap.add_argument("--only-char", default="")
    a = ap.parse_args()
    spec = json.load(open(a.lines, encoding="utf-8"))
    asr = Asr(a.asr)
    os.makedirs(a.out, exist_ok=True)
    qa = json.load(open(a.qa, encoding="utf-8")) if os.path.exists(a.qa) else {}

    for char, c in spec["characters"].items():
        if a.only_char and char != a.only_char:
            continue
        P = CHAR[char]
        # Pass 1: analyse every candidate.
        cands = {}
        for line in c["lines"]:
            ref = line.get("asr", line["text"])
            files = sorted(f for f in os.listdir(os.path.join(a.raw, char)) if f.startswith(line["id"] + "_s"))
            lst = []
            for f in files:
                x = trim(load(os.path.join(a.raw, char, f)))
                hyp = asr(x)
                f0, vr = f0_stats(x)
                lst.append(dict(file=f, x=x, hyp=hyp, cer=cer(ref, hyp), dur=len(x) / SR, f0=f0, vr=vr))
            cands[line["id"]] = lst
        voiced = [k["f0"] for v in cands.values() for k in v if k["vr"] > 0.35 and k["f0"] > 0]
        raw_mean = float(np.exp(np.mean(np.log(voiced))))

        # Pass 2: choose a take per line.
        chosen = {}
        for line in c["lines"]:
            max_d = MAX_DUR.get(line["event"], DEFAULT_MAX_DUR)
            best, best_score = None, 1e9
            for k in cands[line["id"]]:
                d = k["dur"] * P["tempo"]
                score = k["cer"] + 0.6 * max(0.0, d - max_d) + 0.4 * max(0.0, 0.35 - d)
                if k["vr"] > 0.35 and k["f0"] > 0:
                    score += 0.15 * abs(math.log2(k["f0"] / raw_mean))
                if score < best_score:
                    best, best_score = k, score
            chosen[line["id"]] = best
        sel_f0 = [k["f0"] for k in chosen.values() if k["vr"] > 0.35 and k["f0"] > 0]
        char_mean = float(np.exp(np.mean(np.log(sel_f0))))

        # Pass 3: process, encode, QA.
        for line in c["lines"]:
            k = chosen[line["id"]]
            ref = line.get("asr", line["text"])
            lf0 = k["f0"] if (k["vr"] > 0.35 and k["f0"] > 0) else char_mean
            log_shift = math.log(P["f0"] / char_mean) + P["pull"] * math.log(char_mean / lf0)
            q = float(np.clip(math.exp(log_shift), 0.33, 2.4))
            max_d = MAX_DUR.get(line["event"], DEFAULT_MAX_DUR)
            s = P["tempo"]
            if k["dur"] * s > max_d:
                s = max(max_d / k["dur"], s * 0.8)
            y = pitch_formant(k["x"] / (np.abs(k["x"]).max() + 1e-9) * 0.7, q, P["formant"], s)
            y = FX[char](y)
            y = trim(y, rel_db=-45, pre_ms=8, post_ms=60)
            y = fades(edge_trim(loudness_normalise(y)), fout=0.04)
            name = f"{char}-{line['id']}"
            if a.wav_out:
                os.makedirs(a.wav_out, exist_ok=True)
                import soundfile as sf
                sf.write(os.path.join(a.wav_out, name + ".wav"), y.astype(np.float32), SR, subtype="FLOAT")
            path = os.path.join(a.out, name + ".m4a")
            encode_m4a(y, path)
            z = load(path)
            hyp = asr(z)
            f0, vr = f0_stats(z)
            lead, trail = edge_silence_ms(z)
            rec = dict(file=f"vo/{name}.m4a", character=char, event=line["event"], text=line["text"], ref=ref,
                       take=k["file"], take_asr=k["hyp"], take_cer=round(k["cer"], 3),
                       asr=hyp, cer=round(cer(ref, hyp), 3), dur=round(len(z) / SR, 3),
                       f0=round(f0, 1), voiced=round(vr, 2), centroid=round(centroid(z)),
                       lufs=round(lufs(z), 2), peak_db=round(20 * math.log10(np.abs(z).max() + 1e-12), 2),
                       lead_ms=round(lead), trail_ms=round(trail), bytes=os.path.getsize(path),
                       pitch_ratio=round(q, 3), tempo=round(s, 3))
            qa[name] = rec
            print(json.dumps(rec, ensure_ascii=False), flush=True)
        json.dump(qa, open(a.qa, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
