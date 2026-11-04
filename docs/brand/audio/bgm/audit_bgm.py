"""
Distinctness audit of the shipped BGM loops (QA only, not a build step).

Usage: python docs/brand/audio/bgm/audit_bgm.py

Audio part (decoded .m4a, mono 22.05 kHz), over the first 10 s of the loop and the whole loop. Five
feature groups, each divided by the median arena-arena value of that group (1.0 = a typical arena
pair), then averaged into one score (higher = more different):
  timbre  : Euclidean distance of mean MFCC 1-13 (40 mel bands, 40 Hz - 10 kHz)
  bright  : |log2 centroid ratio| + |delta energy above 2 kHz (dB)| / 6
  tempo   : |log2 BPM ratio| (declared BPM; an onset-autocorrelation estimate is printed as a check)
  rhythm  : 1 - correlation of the bar-folded onset pattern (48 slots per bar: 16ths and triplets
            both land on the grid; low < 400 Hz and high bands)
  tonal   : 1 - chroma correlation, + 1 if the Krumhansl-Kessler key estimates differ in mode
Score part: Jaccard overlap of the sounding voices per track (GM program/bank; drum parts by GM drum
key; synthesised layers by function), first 10 s and whole loop.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.fft import dct

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, HERE)
FS = 22050
loops = json.load(open(f'{REPO}/docs/brand/audio/bgm/loops.json'))
IDS = ['moonrune', 'emberforge', 'blightmire', 'frostkeep', 'madcrown', 'apex', 'lobby']
KS_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(FS), '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def mel_fb(f, n=40, fmin=40, fmax=10000):
    m = lambda hz: 2595 * np.log10(1 + hz / 700); im = lambda mm: 700 * (10 ** (mm / 2595) - 1)
    pts = im(np.linspace(m(fmin), m(fmax), n + 2)); fb = np.zeros((n, len(f)))
    for i in range(n):
        a, b, c = pts[i:i + 3]; fb[i] = np.clip(np.minimum((f - a) / (b - a), (c - f) / (c - b)), 0, None)
    return fb

def feats(x, bpm):
    f, t, Z = signal.stft(x, FS, nperseg=4096, noverlap=4096 - 512, boundary=None, padded=False)
    M = np.abs(Z); P = M ** 2
    cen = float(np.median((f[:, None] * P).sum(0) / (P.sum(0) + 1e-12)))
    high = float(10 * np.log10(P[f > 2000].sum() / P.sum()))
    mfcc = dct(np.log(mel_fb(f) @ P + 1e-10), axis=0, norm='ortho')[1:14].mean(1)
    sel = (f > 60) & (f < 4000); pc = np.round(69 + 12 * np.log2(f[sel] / 440)).astype(int) % 12
    ch = np.array([P[sel][pc == k].sum() for k in range(12)]); ch /= ch.sum()
    best = max(((np.corrcoef(ch, np.roll(prof, r))[0, 1], NAMES[r], mode) for mode, prof in (('major', KS_MAJ), ('minor', KS_MIN)) for r in range(12)))
    # Onsets: finer hop for rhythm.
    f2, t2, Z2 = signal.stft(x, FS, nperseg=2048, noverlap=2048 - 256, boundary=None, padded=False)
    L = np.log1p(1000 * np.abs(Z2)); pat = []
    slot = 60 / bpm / 12
    fl_all = np.maximum(0, np.diff(L, axis=1)).sum(0)
    for band in (f2 < 400, f2 >= 400):
        fl = np.maximum(0, np.diff(L[band], axis=1)).sum(0)
        idx = np.round(t2[1:] / slot).astype(int) % 48
        h = np.array([fl[idx == k].mean() for k in range(48)])
        pat.append((h - h.mean()) / (h.std() + 1e-9))
    env = fl_all - signal.medfilt(fl_all, 31)
    pk, _ = signal.find_peaks(env, height=np.percentile(env, 80), distance=int(0.09 * FS / 256))
    e = np.maximum(env, 0) - np.maximum(env, 0).mean(); ac = np.correlate(e, e, 'full')[len(e) - 1:]
    lag = np.arange(len(ac)); bp = 60 * FS / 256 / np.maximum(lag, 1); ok = (bp >= 70) & (bp <= 180)
    w = ac * np.exp(-0.5 * (np.log2(bp / 110) / 0.9) ** 2)
    return dict(cen=cen, high=high, mfcc=mfcc, chroma=ch, key=f'{best[1]} {best[2]}', mode=best[2], key_r=best[0],
                rhythm=np.concatenate(pat), onsets=len(pk) / (len(x) / FS), tempo_est=float(bp[ok][np.argmax(w[ok])]), bpm=bpm)

def groups(a, b):
    return dict(timbre=float(np.linalg.norm(a['mfcc'] - b['mfcc'])),
                bright=abs(np.log2(a['cen'] / b['cen'])) + abs(a['high'] - b['high']) / 6,
                tempo=abs(np.log2(a['bpm'] / b['bpm'])),
                rhythm=1 - float(np.corrcoef(a['rhythm'], b['rhythm'])[0, 1]),
                tonal=1 - float(np.corrcoef(a['chroma'], b['chroma'])[0, 1]) + (1.0 if a['mode'] != b['mode'] else 0.0))

F = {}
for tid in IDS:
    lp = loops[tid]; x = decode(f'{REPO}/public/audio/bgm/{tid}.m4a')
    a = round(lp['loopStart'] * FS); n = round(lp['loopSamples'] / 48000 * FS); loop = x[a:a + n]
    F[tid] = {'first10': feats(loop[:10 * FS], lp['bpm']), 'whole': feats(loop, lp['bpm'])}

print('Per track (whole loop | first 10 s)')
print(f"{'track':11s} {'BPM':>4s} {'est.BPM':>7s} {'est.key':10s} {'r':>4s} {'centroid':>8s} {'>2kHz dB':>8s} {'onsets/s':>8s} | {'key':10s} {'centroid':>8s} {'>2kHz':>6s} {'ons/s':>6s}")
for t in IDS:
    w, f10 = F[t]['whole'], F[t]['first10']
    print(f"{t:11s} {w['bpm']:4d} {w['tempo_est']:7.0f} {w['key']:10s} {w['key_r']:4.2f} {w['cen']:8.0f} {w['high']:8.1f} {w['onsets']:8.2f} | {f10['key']:10s} {f10['cen']:8.0f} {f10['high']:6.1f} {f10['onsets']:6.2f}")

for scope in ('first10', 'whole'):
    G = {(a, b): groups(F[a][scope], F[b][scope]) for a in IDS for b in IDS if a != b}
    arena = [a for a in IDS if a != 'lobby']
    med = {g: float(np.median([G[(a, b)][g] for a in arena for b in arena if a < b])) for g in G[(IDS[0], IDS[1])]}
    S = {k: float(np.mean([v[g] / med[g] for g in v])) for k, v in G.items()}
    print(f'\n[{scope}] distinctness score (1.0 = median arena pair; higher = more different). Group medians: ' + ', '.join(f'{g} {v:.3f}' for g, v in med.items()))
    print(' ' * 11 + ''.join(f'{k[:6]:>7s}' for k in IDS) + '   nearest')
    for a in IDS:
        row = [S[(a, b)] if a != b else 0 for b in IDS]
        nb = min((S[(a, b)], b) for b in IDS if b != a)
        print(f'{a:11s}' + ''.join(f'{v:7.2f}' for v in row) + f'   {nb[1]} {nb[0]:.2f}')
    print('  rhythm corr: ' + ', '.join(f'{a[:5]}/{b[:5]} {1 - G[(a, b)]["rhythm"]:.2f}' for a in IDS for b in IDS if a < b and 1 - G[(a, b)]['rhythm'] > 0.6))

# Score-level instrument overlap.
import tracks  # noqa: E402

def voices(song, limit_s=None):
    spb = 60 / song.bpm; out = set()
    for pt in song.parts:
        for beat, key, dur, vel in pt.notes:
            if limit_s is None or beat * spb < limit_s:
                out.add(('drum', key) if pt.drum else ('prog', pt.bank, pt.program))
    for sy in song.synths:
        if sy.periodic or any(limit_s is None or b * spb < limit_s for b, _, _ in sy.hits):
            out.add(('synth', sy.fn.__name__ if hasattr(sy.fn, '__name__') else sy.name))
    return out
S = {t: tracks.SONGS[t]() for t in IDS}
for lim, lab in ((10, 'first 10 s'), (None, 'whole loop')):
    V = {t: voices(S[t], lim) for t in IDS}
    print(f'\nJaccard instrument overlap, {lab} (1 = same instruments)')
    print(' ' * 11 + ''.join(f'{k[:6]:>7s}' for k in IDS) + '   max')
    for a in IDS:
        row = [len(V[a] & V[b]) / len(V[a] | V[b]) for b in IDS]
        print(f'{a:11s}' + ''.join(f'{v:7.2f}' for v in row) + f'   {max(r for r, b in zip(row, IDS) if b != a):.2f}')
    print('lobby voices only it uses:', sorted(V['lobby'] - set().union(*(V[t] for t in IDS if t != 'lobby'))))
