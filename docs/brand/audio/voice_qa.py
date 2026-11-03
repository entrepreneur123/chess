"""Objective voice-clip measurements shared by the voice pipeline and the diagnosis runs.

Usage as a script (prints one JSON object per file):
  python -I voice_qa.py [--asr <faster-whisper dir>] [--gender <wav2vec2 gender model dir>] FILE...

Measurements (all on the decoded file, 24 kHz mono):
  dur          duration (s)
  lufs         integrated loudness (ITU-R BS.1770, pyloudnorm)
  tp_db        true peak (dBTP, 4x oversampled)
  f0 / f0_p10 / f0_p90   median and spread of the voiced pitch (WORLD harvest)
  f1 / f2 / f3 median formant estimates over voiced frames (LPC root solving, order 2 + sr/1000)
  centroid     median spectral centroid of the loud frames (Hz)
  harsh_db     energy 2-8 kHz relative to 100 Hz-2 kHz (dB); higher = brighter / harsher
  sib_db       95th-percentile frame energy 5-10 kHz relative to the clip's mean 100 Hz-2 kHz energy
  tail_db      RMS of the last 100 ms relative to the loudest 50 ms window (dB); about -20 or lower
               means the clip has decayed, near 0 means it is cut off mid-sound
  end_db       peak of the final 10 ms relative to the clip peak (dB); abrupt cut if > about -30
  lead_ms / trail_ms   silence (below -45 dBFS) before the first and after the last sample
  female_p     P(female) from an optional wav2vec2 gender classifier (QA only, never shipped)
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
from scipy import signal
from scipy.linalg import solve_toeplitz

SR = 24000


def load(path: str, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def lufs(x: np.ndarray, sr: int = SR) -> float:
    dur = len(x) / sr
    if dur < 0.45:
        x = np.concatenate([x, x[::-1]])  # mirrored padding keeps level, satisfies the 400 ms block
        dur *= 2
    return float(pyln.Meter(sr, block_size=min(0.4, dur * 0.95)).integrated_loudness(x))


def true_peak_db(x: np.ndarray) -> float:
    return float(20 * math.log10(np.abs(signal.resample_poly(x, 4, 1)).max() + 1e-12))


def f0_track(x: np.ndarray, sr: int = SR):
    f0, _ = pw.harvest(x, sr, f0_floor=55, f0_ceil=1000, frame_period=5)
    return f0


def formants(x: np.ndarray, f0: np.ndarray, sr: int = SR, nform: int = 3):
    """Median F1..F3 over voiced, loud frames. Resampled to 10 kHz (formants of interest < 4.5 kHz)."""
    fs = 10000
    y = signal.resample_poly(x, fs, sr)
    y = np.append(y[0], y[1:] - 0.7 * y[:-1])  # pre-emphasis
    win, hop = int(0.025 * fs), int(0.005 * fs)
    order = 2 + fs // 1000
    rms_all = np.sqrt(np.mean(y ** 2)) + 1e-12
    out = [[] for _ in range(nform)]
    w = np.hamming(win)
    for i, st in enumerate(range(0, len(y) - win, hop)):
        if i >= len(f0) or f0[i] <= 0:
            continue
        fr = y[st:st + win] * w
        if np.sqrt(np.mean(fr ** 2)) < 0.5 * rms_all:
            continue
        r = np.correlate(fr, fr, "full")[win - 1:win + order]
        if r[0] <= 0:
            continue
        try:
            a = solve_toeplitz(r[:order], -r[1:order + 1])
        except Exception:
            continue
        roots = np.roots(np.concatenate([[1.0], a]))
        roots = roots[np.imag(roots) > 0]
        fr_hz = np.angle(roots) * fs / (2 * np.pi)
        bw = -fs / np.pi * np.log(np.abs(roots) + 1e-12)
        cand = np.sort(fr_hz[(fr_hz > 200) & (bw < 400)])
        for k in range(min(nform, len(cand))):
            out[k].append(cand[k])
    return [float(np.median(v)) if len(v) > 5 else 0.0 for v in out]


def band_stats(x: np.ndarray, sr: int = SR):
    f, _, Z = signal.stft(x, sr, nperseg=1024, noverlap=768)
    p = np.abs(Z) ** 2
    e = p.sum(axis=0)
    loud = e > e.max() * 0.01
    p = p[:, loud]

    def band(lo, hi):
        return p[(f >= lo) & (f < hi)].sum(axis=0)

    low = band(100, 2000)
    harsh = 10 * math.log10(band(2000, 8000).sum() / (low.sum() + 1e-20) + 1e-20)
    sib = 10 * math.log10(np.percentile(band(5000, 10000), 95) / (low.mean() + 1e-20) + 1e-20)
    mag = np.sqrt(p)
    cen = (mag * f[:, None]).sum(axis=0) / (mag.sum(axis=0) + 1e-12)
    return harsh, sib, float(np.median(cen))


def ending(x: np.ndarray, sr: int = SR):
    w = int(0.05 * sr)
    if len(x) < 3 * w:
        return 0.0, 0.0
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, "valid"))
    tail = np.sqrt(np.mean(x[-int(0.1 * sr):] ** 2))
    end = np.abs(x[-int(0.01 * sr):]).max()
    return (20 * math.log10(tail / (rms.max() + 1e-12) + 1e-12),
            20 * math.log10(end / (np.abs(x).max() + 1e-12) + 1e-12))


def edge_silence_ms(x: np.ndarray, sr: int = SR, thr_db: float = -45.0):
    idx = np.where(np.abs(x) > 10 ** (thr_db / 20))[0]
    if not len(idx):
        return len(x) / sr * 1000, len(x) / sr * 1000
    return idx[0] / sr * 1000, (len(x) - 1 - idx[-1]) / sr * 1000


class Gender:
    """wav2vec2 binary gender classifier (e.g. prithivMLmods/Common-Voice-Gender-Detection, Apache-2.0).
    Used for QA only; the model is never committed or shipped."""

    def __init__(self, model_dir: str):
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification
        self.torch = torch
        self.fe = Wav2Vec2FeatureExtractor.from_pretrained(model_dir)
        self.m = Wav2Vec2ForSequenceClassification.from_pretrained(model_dir).eval()
        labels = {int(k): v.lower() for k, v in self.m.config.id2label.items()}
        self.fem = next(k for k, v in labels.items() if v.startswith("f"))

    def __call__(self, x: np.ndarray, sr: int = SR) -> float:
        a = signal.resample_poly(x, 16000, sr).astype(np.float32)
        inp = self.fe(a, sampling_rate=16000, return_tensors="pt")
        with self.torch.no_grad():
            p = self.torch.softmax(self.m(**inp).logits, dim=-1)[0]
        return float(p[self.fem])


def measure(x: np.ndarray, sr: int = SR, gender: "Gender | None" = None) -> dict:
    f0 = f0_track(x, sr)
    v = f0[f0 > 0]
    f1, f2, f3 = formants(x, f0, sr)
    harsh, sib, cen = band_stats(x, sr)
    tail, end = ending(x, sr)
    lead, trail = edge_silence_ms(x, sr)
    rec = dict(dur=round(len(x) / sr, 3), lufs=round(lufs(x, sr), 2), tp_db=round(true_peak_db(x), 2),
               f0=round(float(np.median(v)), 1) if len(v) else 0.0,
               f0_p10=round(float(np.percentile(v, 10)), 1) if len(v) else 0.0,
               f0_p90=round(float(np.percentile(v, 90)), 1) if len(v) else 0.0,
               voiced=round(len(v) / max(1, len(f0)), 2), f1=round(f1), f2=round(f2), f3=round(f3),
               centroid=round(cen), harsh_db=round(harsh, 1), sib_db=round(sib, 1),
               tail_db=round(tail, 1), end_db=round(end, 1), lead_ms=round(lead), trail_ms=round(trail))
    if gender is not None:
        rec["female_p"] = round(gender(x, sr), 3)
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asr", default="")
    ap.add_argument("--gender", default="")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    g = Gender(a.gender) if a.gender else None
    for f in a.files:
        rec = dict(file=os.path.basename(f), **measure(load(f), SR, g))
        print(json.dumps(rec, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    sys.exit(main())
