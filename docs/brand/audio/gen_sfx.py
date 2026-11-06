"""Synthesize the per-character sound effects for GRID CLASH (pure numpy/scipy, no samples).

Usage:  python -I gen_sfx.py --out <dir>      (writes <dir>/<name>.wav, 48 kHz mono float)

Everything here is generated from oscillators and seeded noise, so the output is original work
with no third-party sample licence. Re-running with the same seed gives identical files.
"""
import argparse
import os

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
rng = np.random.default_rng(20261102)


# ------------------------------------------------------------------------------------------------
# Building blocks
# ------------------------------------------------------------------------------------------------

def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def silence(dur: float) -> np.ndarray:
    return np.zeros(int(dur * SR))


def place(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(at * SR)
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n] * gain


def env_ad(n: int, attack: float, decay: float, curve: float = 1.0) -> np.ndarray:
    """Attack (linear) then exponential-ish decay over the rest of n samples."""
    a = max(1, int(attack * SR))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    rest = n - a
    if rest > 0:
        tt = np.arange(rest) / SR
        e[a:] = np.exp(-tt / max(decay, 1e-4)) ** curve
    return e


def bell_env(n: int, peak: float = 0.5, sharp: float = 2.0) -> np.ndarray:
    x = np.linspace(0, 1, n)
    p = np.clip(peak, 0.05, 0.95)
    e = np.where(x < p, (x / p), ((1 - x) / (1 - p)))
    return np.clip(e, 0, 1) ** sharp


def noise(dur: float) -> np.ndarray:
    return rng.standard_normal(int(dur * SR))


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, min(f, SR / 2 - 100), btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def highpass(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f, btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def swept_band(x: np.ndarray, f_start: float, f_end: float, q: float = 2.0, block: int = 256) -> np.ndarray:
    """Time-varying band-pass (block-wise biquad with carried state): the core of every whoosh."""
    out = np.zeros_like(x)
    nblocks = int(np.ceil(len(x) / block))
    freqs = np.geomspace(f_start, f_end, nblocks)
    zi = np.zeros(2)
    for b in range(nblocks):
        f = freqs[b]
        w0 = 2 * np.pi * f / SR
        alpha = np.sin(w0) / (2 * q)
        bb = np.array([alpha, 0, -alpha])
        aa = np.array([1 + alpha, -2 * np.cos(w0), 1 - alpha])
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.lfilter(bb / aa[0], aa / aa[0], seg, zi=zi)
        out[b * block:b * block + len(seg)] = y
    return out


def whoosh(dur: float, f0: float, f1: float, q: float = 1.6, peak: float = 0.55) -> np.ndarray:
    x = swept_band(noise(dur), f0, f1, q)
    x *= bell_env(len(x), peak, 1.6)
    return x / (np.max(np.abs(x)) + 1e-9)


def sweep_tone(dur: float, f0: float, f1: float, wave: str = "sine", decay: float = 0.1, attack: float = 0.002) -> np.ndarray:
    t = t_axis(dur)
    f = np.geomspace(f0, f1, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if wave == "sine":
        y = np.sin(ph)
    elif wave == "tri":
        y = signal.sawtooth(ph, 0.5)
    elif wave == "saw":
        y = signal.sawtooth(ph)
    else:
        y = np.sign(np.sin(ph))
    return y * env_ad(len(t), attack, decay)


def metal(dur: float, f0: float, ratios=(1.0, 2.76, 5.40, 8.93, 13.34), decay: float = 0.35, bright: float = 0.6) -> np.ndarray:
    """Inharmonic struck-metal partials (bar/plate modes) with per-partial decay."""
    t = t_axis(dur)
    y = np.zeros_like(t)
    for k, r in enumerate(ratios):
        amp = bright ** k
        d = decay / (1 + 0.6 * k)
        det = 1 + rng.uniform(-0.004, 0.004)
        y += amp * np.sin(2 * np.pi * f0 * r * det * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
    return y / (np.max(np.abs(y)) + 1e-9)


def thud(dur: float, f0: float = 110, f1: float = 38, decay: float = 0.12) -> np.ndarray:
    body = sweep_tone(dur, f0, f1, "sine", decay, 0.001)
    click = lowpass(noise(dur), 900) * env_ad(int(dur * SR), 0.0005, 0.018)
    y = body + 0.5 * click / (np.max(np.abs(click)) + 1e-9)
    return y / (np.max(np.abs(y)) + 1e-9)


def crackle(dur: float, density: float = 400, decay: float = 0.004) -> np.ndarray:
    """Sparse random clicks (fire / sizzle / debris)."""
    n = int(dur * SR)
    y = np.zeros(n)
    count = int(density * dur)
    for _ in range(count):
        L = int(rng.uniform(40, 400))
        i = int(rng.integers(0, max(1, n - L)))
        L = min(L, n - i)
        g = rng.uniform(0.2, 1.0)
        y[i:i + L] += g * rng.standard_normal(L) * np.exp(-np.arange(L) / (decay * SR))
    return y / (np.max(np.abs(y)) + 1e-9)


def chime(freq: float, dur: float, decay: float = 0.35) -> np.ndarray:
    t = t_axis(dur)
    y = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t / (decay * 0.4))
         + 0.18 * np.sin(2 * np.pi * freq * 3.01 * t) * np.exp(-t / (decay * 0.25)))
    return y * env_ad(len(t), 0.002, decay)


def saturate(x: np.ndarray, drive: float) -> np.ndarray:
    return np.tanh(drive * x) / np.tanh(drive)


def room(x: np.ndarray, rt60: float, wet: float, predelay: float = 0.012, lp: float = 6000, tail: float = None) -> np.ndarray:
    """Convolution with a synthetic exponentially decaying noise IR."""
    L = int(rt60 * SR)
    ir = rng.standard_normal(L) * np.exp(-6.91 * np.arange(L) / L)
    ir = lowpass(ir, lp)
    ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    w = signal.fftconvolve(x, ir)[: len(x) + int((tail if tail is not None else rt60 * 0.6) * SR)]
    dry = np.concatenate([x, np.zeros(len(w) - len(x))])
    return dry * (1 - wet) + w * wet * 1.8


def finish(x: np.ndarray, peak_db: float = -1.0, fade_out: float = 0.03) -> np.ndarray:
    x = highpass(x, 28, 2)
    # Trim trailing near-silence (keep a short tail).
    a = np.abs(x)
    thr = np.max(a) * 10 ** (-50 / 20)
    idx = np.where(a > thr)[0]
    if len(idx):
        x = x[: min(len(x), idx[-1] + int(0.01 * SR))]
        start = idx[0]
        x = x[start:]
    n = int(fade_out * SR)
    if len(x) > n:
        x[-n:] *= np.linspace(1, 0, n) ** 2
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)


def mix(dur: float, *layers) -> np.ndarray:
    buf = silence(dur)
    for x, at, g in layers:
        place(buf, x, at, g)
    return buf


# ------------------------------------------------------------------------------------------------
# Characters
# ------------------------------------------------------------------------------------------------

def holy_shimmer(dur: float, base: float = 1046.5) -> np.ndarray:
    """Major-chord sine cluster with slow attack, tremolo and airy noise: a 'holy' glow."""
    t = t_axis(dur)
    y = np.zeros_like(t)
    for r, g in ((1.0, 1.0), (1.26, 0.7), (1.5, 0.75), (2.0, 0.5), (3.0, 0.25)):
        for d in (-0.003, 0.003):
            y += g * np.sin(2 * np.pi * base * r * (1 + d) * t + rng.uniform(0, 6.28))
    y *= 1 + 0.25 * np.sin(2 * np.pi * 9 * t)
    air = highpass(noise(dur), 7000) * 0.08
    y = (y / np.max(np.abs(y))) + air
    return y * bell_env(len(t), 0.18, 1.3)


def sad_select() -> np.ndarray:
    # Sword drawn from a scabbard: rising metallic scrape + ringing blade.
    scrape = swept_band(noise(0.22), 2500, 7000, 3.0) * bell_env(int(0.22 * SR), 0.7, 1.2)
    ring = metal(0.5, 1180, (1.0, 2.41, 3.9, 6.1), decay=0.22, bright=0.5)
    return finish(room(mix(0.65, (scrape / np.max(np.abs(scrape)), 0, 0.5), (ring, 0.17, 0.5),
                           (holy_shimmer(0.4, 1568), 0.18, 0.12)), 0.6, 0.18))


def armour_step(heavy: float = 1.0) -> np.ndarray:
    step = thud(0.16, 140 * heavy, 60 * heavy, 0.05)
    jingle = metal(0.14, 2300 + rng.uniform(-200, 200), (1.0, 1.7, 2.9, 4.3), decay=0.05, bright=0.7)
    return mix(0.2, (step, 0, 0.8), (jingle, 0.004, 0.22))


def sad_move() -> np.ndarray:
    return finish(room(mix(0.5, (armour_step(), 0, 1.0), (armour_step(1.05), 0.19, 0.85),
                           (whoosh(0.3, 500, 1400, 1.0), 0.0, 0.12)), 0.4, 0.12))


def sad_capture() -> np.ndarray:
    swing = whoosh(0.2, 700, 4200, 1.8, 0.75)
    clang = metal(0.7, 620, decay=0.4, bright=0.62)
    hit = thud(0.25, 170, 60, 0.07)
    spark = highpass(crackle(0.18, 300, 0.002), 3000)
    shimmer = holy_shimmer(0.7, 1318.5)
    y = mix(1.0, (swing, 0, 0.55), (hit, 0.17, 0.85), (clang, 0.17, 0.6), (spark, 0.17, 0.25), (shimmer, 0.24, 0.22))
    return finish(room(y, 1.1, 0.2, 0.02, 6500, 0.35))


def sad_skill() -> np.ndarray:
    # Holy invocation: swelling major chord + rising shimmer + a bright strike at the end.
    t = t_axis(1.0)
    swell = np.zeros_like(t)
    for f, g in ((261.63, 0.6), (329.63, 0.5), (392.0, 0.5), (523.25, 0.45), (783.99, 0.25)):
        for d in (-0.004, 0.0, 0.004):
            swell += g * signal.sawtooth(2 * np.pi * f * (1 + d) * t + rng.uniform(0, 6.28), 0.5)
    swell = lowpass(swell, 2400) * (np.clip(t / 0.75, 0, 1) ** 1.6) * np.exp(-np.clip(t - 0.8, 0, None) / 0.12)
    rise = whoosh(0.8, 800, 6000, 2.0, 0.9)
    strike = metal(0.6, 1046.5, (1.0, 2.0, 3.0, 4.2), decay=0.35, bright=0.5)
    y = mix(1.45, (swell / np.max(np.abs(swell)), 0, 0.45), (rise, 0, 0.18), (holy_shimmer(1.0, 1046.5), 0.15, 0.25),
            (strike, 0.8, 0.5), (holy_shimmer(0.6, 2093), 0.8, 0.2))
    return finish(room(y, 1.4, 0.25, 0.03, 7000, 0.4))


def snort(dur: float = 0.32, pitch: float = 1.0) -> np.ndarray:
    n = noise(dur)
    nasal = bandpass(n, 350 * pitch, 1100 * pitch, 2) + 0.5 * bandpass(n, 1600 * pitch, 2600 * pitch, 2)
    flutter = 1 + 0.5 * np.sin(2 * np.pi * 38 * t_axis(dur))
    e = env_ad(len(n), 0.02, dur * 0.35)
    return nasal * e * flutter / (np.max(np.abs(nasal * e * flutter)) + 1e-9)


def hoof(weight: float = 1.0) -> np.ndarray:
    body = thud(0.3, 95 * weight, 34, 0.11)
    knock = bandpass(noise(0.05), 400, 1800) * env_ad(int(0.05 * SR), 0.0005, 0.01)
    debris = lowpass(crackle(0.2, 120, 0.003), 3000) * 0.3
    return mix(0.32, (body, 0, 1.0), (knock / (np.max(np.abs(knock)) + 1e-9), 0, 0.35), (debris, 0.01, 0.4))


def marki_select() -> np.ndarray:
    return finish(room(mix(0.55, (snort(0.22, 0.9), 0, 0.9), (snort(0.28, 0.8), 0.2, 1.0),
                           (thud(0.3, 70, 40, 0.1), 0.2, 0.25)), 0.35, 0.1))


def marki_move() -> np.ndarray:
    rumble = lowpass(noise(0.6), 160, 4) * bell_env(int(0.6 * SR), 0.3, 1.0)
    y = mix(0.7, (hoof(1.0), 0, 1.0), (hoof(0.92), 0.26, 0.95), (rumble / np.max(np.abs(rumble)), 0, 0.3))
    return finish(saturate(room(y, 0.5, 0.12), 1.4))


def marki_capture() -> np.ndarray:
    swing = whoosh(0.28, 220, 1500, 1.2, 0.8)
    smash = thud(0.6, 120, 30, 0.2)
    crunch = bandpass(crackle(0.35, 900, 0.006), 300, 5000)
    debris = lowpass(crackle(0.6, 160, 0.004), 4000) * bell_env(int(0.6 * SR), 0.15, 1.2)
    axe = metal(0.35, 330, (1.0, 2.3, 4.1), decay=0.15, bright=0.5)
    y = mix(1.15, (swing, 0, 0.5), (smash, 0.24, 1.0), (crunch / np.max(np.abs(crunch)), 0.24, 0.45),
            (axe, 0.24, 0.25), (debris, 0.3, 0.35), (snort(0.3, 0.75), 0.62, 0.35))
    return finish(saturate(room(y, 0.7, 0.14, 0.01, 4000, 0.3), 1.8))


def marki_skill() -> np.ndarray:
    # Charge: snort, accelerating stampede, rising rumble.
    y = silence(1.4)
    place(y, snort(0.3, 0.8), 0, 0.8)
    at, gap = 0.28, 0.2
    w = 0.85
    while at < 1.2:
        place(y, hoof(1.0 + rng.uniform(-0.05, 0.05)), at, w)
        at += gap
        gap *= 0.82
        w = min(1.0, w + 0.03)
    rumble = lowpass(noise(1.2), 140, 4) * np.clip(t_axis(1.2) / 1.1, 0, 1) ** 1.5
    place(y, rumble / np.max(np.abs(rumble)), 0.2, 0.45)
    place(y, whoosh(0.6, 200, 900, 1.0, 0.8), 0.7, 0.25)
    return finish(saturate(room(y, 0.6, 0.12), 1.5))


def shield_thump(f: float = 180) -> np.ndarray:
    body = thud(0.3, f, f * 0.45, 0.06)
    plate = metal(0.3, 480, (1.0, 1.6, 2.3, 3.4, 4.9), decay=0.09, bright=0.7)
    wood = bandpass(noise(0.08), 300, 1500) * env_ad(int(0.08 * SR), 0.0005, 0.02)
    return mix(0.32, (body, 0, 1.0), (plate, 0, 0.35), (wood / (np.max(np.abs(wood)) + 1e-9), 0, 0.4))


def walk_select() -> np.ndarray:
    tap = shield_thump(240)
    ring = metal(0.35, 960, (1.0, 2.2, 3.6), decay=0.12, bright=0.5)
    return finish(room(mix(0.45, (tap, 0, 0.8), (ring, 0.002, 0.25), (armour_step(1.2), 0.12, 0.35)), 0.35, 0.1))


def walk_move() -> np.ndarray:
    y = mix(0.5, (armour_step(1.1), 0, 0.9), (armour_step(1.15), 0.16, 0.8), (whoosh(0.25, 600, 1800, 1.2), 0.0, 0.1))
    return finish(room(y, 0.3, 0.08))


def walk_capture() -> np.ndarray:
    swing = whoosh(0.16, 400, 2600, 1.5, 0.75)
    bash = shield_thump(150)
    impact = thud(0.35, 130, 45, 0.1)
    y = mix(0.8, (swing, 0, 0.45), (bash, 0.13, 1.0), (impact, 0.13, 0.7), (armour_step(0.9), 0.34, 0.4))
    return finish(saturate(room(y, 0.45, 0.12), 1.3))


def walk_skill() -> np.ndarray:
    up = whoosh(0.35, 400, 3200, 1.4, 0.6)
    tone = sweep_tone(0.3, 260, 700, "sine", 0.2, 0.01) * 0.3
    land = thud(0.4, 120, 40, 0.13)
    clank = metal(0.4, 520, (1.0, 1.6, 2.3, 3.4), decay=0.12, bright=0.65)
    dust = lowpass(noise(0.3), 1200) * env_ad(int(0.3 * SR), 0.005, 0.08)
    y = mix(1.0, (up, 0, 0.5), (tone, 0, 1.0), (land, 0.45, 1.0), (clank, 0.45, 0.45),
            (dust / np.max(np.abs(dust)), 0.45, 0.25), (armour_step(1.1), 0.6, 0.3))
    return finish(room(y, 0.45, 0.12))


def demon_growl(dur: float, f: float = 70) -> np.ndarray:
    t = t_axis(dur)
    y = sum(signal.sawtooth(2 * np.pi * f * (1 + d) * t + rng.uniform(0, 6.28)) for d in (-0.02, 0.0, 0.017))
    y = lowpass(saturate(y / 3, 3.0), 900)
    return y * (1 + 0.6 * np.sin(2 * np.pi * 23 * t)) * bell_env(len(t), 0.25, 1.2)


def fire_burst(dur: float) -> np.ndarray:
    roar = lowpass(noise(dur), 1800, 2) * env_ad(int(dur * SR), 0.008, dur * 0.3)
    sizzle = highpass(crackle(dur, 900, 0.0025), 2500) * env_ad(int(dur * SR), 0.01, dur * 0.45)
    y = roar / np.max(np.abs(roar)) + 0.6 * sizzle
    return y / np.max(np.abs(y))


def sparkle(dur: float, base: float = 2600, n: int = 7) -> np.ndarray:
    y = silence(dur)
    for _ in range(n):
        f = base * rng.uniform(1.0, 2.2)
        place(y, chime(f, 0.18, 0.06), rng.uniform(0, dur - 0.18), rng.uniform(0.2, 0.5))
    return y


def insaner_select() -> np.ndarray:
    pop = sweep_tone(0.12, 700, 1800, "tri", 0.05, 0.002)
    y = mix(0.45, (pop, 0, 0.5), (sparkle(0.35, 2400, 6), 0.03, 0.6), (whoosh(0.2, 1500, 5000, 2.0), 0, 0.15))
    return finish(room(y, 0.5, 0.18))


def insaner_move() -> np.ndarray:
    w = whoosh(0.4, 600, 3800, 2.2, 0.5)
    fizz = highpass(crackle(0.4, 500, 0.002), 3500) * bell_env(int(0.4 * SR), 0.5, 1.0)
    return finish(room(mix(0.5, (w, 0, 0.7), (fizz, 0, 0.3), (sparkle(0.3, 3000, 3), 0.15, 0.3)), 0.4, 0.15))


def insaner_capture() -> np.ndarray:
    w = whoosh(0.25, 900, 5000, 2.0, 0.8)
    burst = fire_burst(0.55)
    growl = demon_growl(0.5, 62)
    zap = sweep_tone(0.25, 1800, 220, "saw", 0.08, 0.001)
    y = mix(0.95, (w, 0, 0.45), (burst, 0.2, 0.9), (growl, 0.2, 0.35), (lowpass(zap, 5000), 0.2, 0.25),
            (thud(0.3, 130, 50, 0.08), 0.2, 0.5), (sparkle(0.4, 2000, 5), 0.32, 0.25))
    return finish(room(y, 0.6, 0.18))


def insaner_skill() -> np.ndarray:
    # Absorb: reversed whoosh that gets sucked in, rising warble, and a closing 'gulp' pop.
    w = whoosh(0.6, 500, 4500, 2.0, 0.92)
    t = t_axis(0.6)
    warble = np.sin(2 * np.pi * np.cumsum(np.geomspace(180, 900, len(t)) * (1 + 0.12 * np.sin(2 * np.pi * 14 * t))) / SR)
    warble *= np.clip(t / 0.55, 0, 1) ** 2
    gulp = sweep_tone(0.12, 900, 160, "sine", 0.05, 0.001)
    y = mix(1.0, (w, 0, 0.6), (warble, 0, 0.3), (demon_growl(0.6, 55), 0, 0.2), (gulp, 0.6, 0.8),
            (thud(0.2, 160, 70, 0.05), 0.6, 0.4), (sparkle(0.3, 2600, 4), 0.62, 0.25))
    return finish(room(y, 0.5, 0.15))


def insaner_chain() -> np.ndarray:
    notes = (1318.5, 1568.0, 1975.5, 2637.0)
    y = silence(0.9)
    for i, f in enumerate(notes):
        place(y, chime(f, 0.5, 0.25), i * 0.055, 0.45)
    place(y, chime(2637.0, 0.6, 0.35), 0.24, 0.3)
    place(y, sparkle(0.5, 3200, 6), 0.1, 0.3)
    return finish(room(y, 0.8, 0.22))


def death() -> np.ndarray:
    # Disintegrate: a short hit, then crumbling grains thinning out, a falling tone and dust sparkle.
    dur = 1.0
    y = silence(dur + 0.1)
    place(y, thud(0.3, 160, 55, 0.07), 0, 0.6)
    n = int(dur * SR)
    grains = np.zeros(n)
    for k in range(260):
        tpos = rng.uniform(0, 1) ** 1.8 * (dur - 0.05)
        L = int(rng.uniform(80, 700))
        i = int(tpos * SR)
        g = (1 - tpos / dur) * rng.uniform(0.3, 1.0)
        grains[i:i + L] += g * bandpass(rng.standard_normal(L + 64), 600, 6000)[64:] * np.hanning(L)
    place(y, grains / np.max(np.abs(grains)), 0.02, 0.55)
    fall = sweep_tone(0.8, 520, 70, "tri", 0.3, 0.01)
    place(y, lowpass(fall, 2000), 0.03, 0.3)
    place(y, sparkle(0.6, 1800, 5), 0.15, 0.2)
    return finish(room(y, 0.6, 0.15))


def bubbles(dur: float, rate: float = 40, lo: float = 280, hi: float = 1100, decay: float = 0.03) -> np.ndarray:
    """Poison bubbling: random short sine 'blips' whose pitch rises as each bubble pops (Minnaert-like)."""
    y = silence(dur)
    for _ in range(int(rate * dur)):
        f = rng.uniform(lo, hi)
        L = rng.uniform(0.025, 0.07)
        t = t_axis(L)
        ph = 2 * np.pi * np.cumsum(f * (1 + 2.2 * (t / L) ** 2)) / SR
        b = np.sin(ph) * env_ad(len(t), 0.002, decay)
        place(y, b, rng.uniform(0, max(0.0, dur - L)), rng.uniform(0.3, 1.0))
    return y / (np.max(np.abs(y)) + 1e-9)


def hiss(dur: float, lo: float = 2500, peak: float = 0.15) -> np.ndarray:
    """Acid sizzle: bright noise with a crackle layer, quick swell then long decay."""
    h = highpass(noise(dur), lo, 2) * (1 + 0.35 * np.sin(2 * np.pi * 27 * t_axis(dur)))
    h = h / (np.max(np.abs(h)) + 1e-9) + 0.5 * highpass(crackle(dur, 700, 0.002), lo)
    return h * bell_env(len(h), peak, 1.4) / 1.5


def choir(dur: float, notes=(110.0, 130.81, 155.56, 220.0), rise: float = 1.06, vowel=(700, 1220, 2600)) -> np.ndarray:
    """Dark 'aah' choir: detuned saw cluster through vowel formant band-passes, slowly gliding up."""
    t = t_axis(dur)
    glide = np.geomspace(1.0, rise, len(t))
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t)
    src = np.zeros_like(t)
    for f in notes:
        for d in (-0.006, 0.0, 0.0055):
            src += signal.sawtooth(2 * np.pi * np.cumsum(f * (1 + d) * glide * vib) / SR + rng.uniform(0, 6.28))
    y = sum(g * bandpass(src, fc * 0.85, fc * 1.15, 2) for fc, g in zip(vowel, (1.0, 0.55, 0.25)))
    return y / (np.max(np.abs(y)) + 1e-9)


def cloak_swish(dur: float = 0.32) -> np.ndarray:
    """Heavy fabric swish: low-mid swept noise with a fluttering amplitude."""
    w = swept_band(noise(dur), 350, 1600, 1.1) * bell_env(int(dur * SR), 0.45, 1.3)
    w *= 1 + 0.45 * np.sin(2 * np.pi * 21 * t_axis(dur) + 1.0)
    return w / (np.max(np.abs(w)) + 1e-9)


def witch_chime(dur: float = 0.6) -> np.ndarray:
    """Eerie bell: a tritone pair with a slow vibrato, the upper note slightly flat."""
    t = t_axis(dur)
    vib = 1 + 0.008 * np.sin(2 * np.pi * 6 * t)
    y = np.zeros_like(t)
    for f, g, at in ((880.0, 1.0, 0.0), (1244.5 * 0.995, 0.8, 0.07), (1760.0, 0.35, 0.07)):
        n0 = int(at * SR)
        tt = t[: len(t) - n0]
        tone = (np.sin(2 * np.pi * np.cumsum(f * vib[: len(tt)]) / SR)
                + 0.3 * np.sin(2 * np.pi * np.cumsum(2.01 * f * vib[: len(tt)]) / SR) * np.exp(-tt / 0.08))
        y[n0:] += g * tone * env_ad(len(tt), 0.003, 0.28)
    return y / (np.max(np.abs(y)) + 1e-9)


def brutile_select() -> np.ndarray:
    y = mix(0.75, (witch_chime(0.6), 0, 0.6), (whoosh(0.3, 3000, 900, 2.0, 0.4), 0.0, 0.12),
            (sparkle(0.4, 1900, 5), 0.06, 0.35), (bubbles(0.35, 30, 400, 900), 0.12, 0.12))
    return finish(room(y, 0.9, 0.25, 0.02, 5500, 0.3))


def brutile_move() -> np.ndarray:
    y = mix(0.55, (cloak_swish(0.34), 0, 0.85), (sparkle(0.32, 2100, 5), 0.1, 0.35),
            (bubbles(0.3, 25, 350, 800), 0.12, 0.12))
    return finish(room(y, 0.45, 0.14))


def brutile_capture() -> np.ndarray:
    # Curse blast: a sucking whoosh, a sizzling green-fire burst and a low dark boom with a dissonant sting.
    w = whoosh(0.22, 800, 4200, 1.8, 0.85)
    boom = thud(0.7, 85, 28, 0.25)
    sting = sum(sweep_tone(0.45, f, f * 0.94, "saw", 0.15, 0.002) for f in (233.1, 329.6, 349.2))
    y = mix(1.05, (w, 0, 0.45), (boom, 0.2, 1.0), (fire_burst(0.6), 0.2, 0.7), (hiss(0.7, 2500, 0.1), 0.22, 0.4),
            (demon_growl(0.55, 48), 0.2, 0.35), (lowpass(sting / 3, 2600), 0.2, 0.22),
            (bubbles(0.45, 35, 260, 900), 0.4, 0.2))
    return finish(saturate(room(y, 0.8, 0.18, 0.012, 5000, 0.3), 1.4))


def brutile_skill() -> np.ndarray:
    # Wasteland cast: rising dark choir + drone, a ground crack at the climax, then bubbling poison.
    choir_l = choir(1.0) * (np.clip(t_axis(1.0) / 0.8, 0, 1) ** 1.5)
    drone = lowpass(sum(signal.sawtooth(2 * np.pi * 55 * (1 + d) * t_axis(1.0)) for d in (-0.01, 0.0, 0.012)), 400)
    drone = drone / np.max(np.abs(drone)) * np.clip(t_axis(1.0) / 0.6, 0, 1)
    crack = mix(0.5, (thud(0.5, 95, 30, 0.18), 0, 1.0), (bandpass(crackle(0.4, 1500, 0.004), 300, 6000), 0, 0.6),
                (lowpass(crackle(0.5, 200, 0.006), 2500), 0.03, 0.4))
    y = mix(1.55, (choir_l, 0, 0.45), (drone, 0, 0.3), (whoosh(0.8, 300, 3000, 1.5, 0.92), 0.05, 0.15),
            (crack / np.max(np.abs(crack)), 0.85, 1.0), (bubbles(0.65, 45, 220, 950), 0.88, 0.35),
            (hiss(0.6, 3000, 0.1), 0.86, 0.22))
    return finish(room(y, 1.0, 0.2, 0.02, 5000, 0.3))


def waste_death() -> np.ndarray:
    # A piece dissolving in poison: acid hiss + bubbling, a falling gurgle; generic (any character).
    gurgle = lowpass(sweep_tone(0.7, 300, 55, "tri", 0.3, 0.01) * (1 + 0.5 * np.sin(2 * np.pi * 17 * t_axis(0.7))), 1200)
    y = mix(1.15, (thud(0.25, 120, 50, 0.06), 0, 0.45), (hiss(0.95, 2200, 0.12), 0.0, 0.75),
            (bubbles(1.0, 55, 220, 1000), 0.04, 0.6), (gurgle, 0.05, 0.35), (bubbles(0.5, 20, 150, 400), 0.4, 0.3))
    return finish(room(y, 0.5, 0.12))


# --- michelle (gloomy girl with a doll; lays doll traps) ------------------------------------------

def music_box_note(f: float, dur: float = 0.6, decay: float = 0.32, flat: float = 0.996) -> np.ndarray:
    """A worn music-box tine: pure fundamental, a quick inharmonic 'ping' partial, a slight
    sagging vibrato (an old, slow-running mechanism) and slightly flat tuning for unease."""
    t = t_axis(dur)
    wob = flat * (1 + 0.004 * np.sin(2 * np.pi * 4.6 * t + rng.uniform(0, 6.28)))
    ph = 2 * np.pi * np.cumsum(f * wob) / SR
    y = (np.sin(ph) + 0.16 * np.sin(2 * ph) * np.exp(-t / (decay * 0.5))
         + 0.12 * np.sin(5.43 * ph) * np.exp(-t / 0.03))
    return y * env_ad(len(t), 0.0008, decay)


def doll_squeak(dur: float = 0.14, f0: float = 950) -> np.ndarray:
    """Squeezed rubber doll: a reedy tone that bends up and back down with a fast flutter."""
    t = t_axis(dur)
    f = f0 * (1 + 0.55 * np.sin(np.pi * t / dur) ** 1.5) * (1 + 0.03 * np.sin(2 * np.pi * 34 * t))
    y = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR, 0.3)
    y = bandpass(y, 700, 4200, 2) * bell_env(len(t), 0.35, 1.2)
    return y / (np.max(np.abs(y)) + 1e-9)


def soft_step(weight: float = 1.0) -> np.ndarray:
    """A small, soft footstep (slipper on a wooden floor)."""
    pad = lowpass(noise(0.09), 700 * weight) * env_ad(int(0.09 * SR), 0.005, 0.02)
    body = thud(0.1, 190 * weight, 95 * weight, 0.03)
    y = mix(0.11, (pad / (np.max(np.abs(pad)) + 1e-9), 0, 0.8), (body, 0.001, 0.45))
    return y / (np.max(np.abs(y)) + 1e-9)


def tick(f: float = 3600, decay: float = 0.004) -> np.ndarray:
    """A small mechanical click: a noise snap with a short resonant ping."""
    n = int(0.04 * SR)
    snap = bandpass(noise(0.04), 1800, 7000) * env_ad(n, 0.0002, decay)
    ping = np.sin(2 * np.pi * f * t_axis(0.04)) * env_ad(n, 0.0002, decay * 2.5)
    y = snap / (np.max(np.abs(snap)) + 1e-9) + 0.35 * ping
    return y / (np.max(np.abs(y)) + 1e-9)


def spring_boing(f0: float = 260, dur: float = 0.35, depth: float = 0.35, rate: float = 9.0) -> np.ndarray:
    """A coil spring settling: a tone whose pitch wobbles and dies down, with a metallic 2nd partial."""
    t = t_axis(dur)
    f = f0 * (1 + depth * np.exp(-t / 0.09) * np.sin(2 * np.pi * rate * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.35 * np.sin(2.02 * ph) + 0.12 * np.sin(3.1 * ph)) * env_ad(len(t), 0.002, dur * 0.35)
    return y / (np.max(np.abs(y)) + 1e-9)


def michelle_select() -> np.ndarray:
    # Three slow, slightly flat music-box notes (a falling minor figure) and a faint doll squeak.
    y = mix(0.9, (music_box_note(1318.5), 0, 0.5), (music_box_note(1046.5), 0.11, 0.42),
            (music_box_note(880.0, 0.7, 0.4), 0.22, 0.45), (doll_squeak(0.13, 900), 0.3, 0.12))
    return finish(room(y, 0.6, 0.2, 0.01, 5000, 0.25))


def michelle_move() -> np.ndarray:
    # Two small soft footsteps and a faint dress rustle; no metal, no weight.
    y = mix(0.5, (soft_step(1.0), 0, 0.9), (soft_step(1.08), 0.2, 0.75), (cloak_swish(0.3), 0.02, 0.22))
    return finish(room(y, 0.35, 0.12, 0.008, 4500, 0.15))


def michelle_capture() -> np.ndarray:
    # A stitched snip (two scissor blade clicks around a short blade slide), a muffled cloth thump
    # and a lone music-box note sinking flat.
    slide = bandpass(noise(0.05), 3000, 8000) * bell_env(int(0.05 * SR), 0.6, 1.2)
    snip = mix(0.12, (tick(4200, 0.003), 0, 0.7), (slide / (np.max(np.abs(slide)) + 1e-9), 0.012, 0.25),
               (tick(3400, 0.004), 0.06, 0.9))
    cloth = lowpass(thud(0.3, 140, 55, 0.07), 900)
    t = t_axis(0.8)
    sink = np.sin(2 * np.pi * np.cumsum(1046.5 * np.geomspace(1.0, 0.94, len(t))) / SR) * env_ad(len(t), 0.001, 0.3)
    y = mix(0.95, (snip, 0, 0.7), (cloth, 0.07, 0.9), (cloak_swish(0.22), 0.05, 0.2), (sink, 0.12, 0.22))
    return finish(room(y, 0.5, 0.16, 0.01, 4500, 0.25))


def michelle_trap_set() -> np.ndarray:
    # A wind-up toy being set: four ratchet clicks slowing down, then a creaky spring settles,
    # and one soft music-box note.
    y = silence(1.0)
    at, gap = 0.0, 0.055
    for k in range(4):
        place(y, tick(3000 + 250 * k, 0.003), at, 0.55 + 0.08 * k)
        at += gap
        gap *= 1.22
    creak = lowpass(sweep_tone(0.22, 160, 230, "saw", 0.12, 0.01) * (1 + 0.6 * np.sin(2 * np.pi * 37 * t_axis(0.22))), 1800)
    place(y, creak / (np.max(np.abs(creak)) + 1e-9), at - 0.02, 0.18)
    place(y, spring_boing(240, 0.4, 0.3, 8.0), at, 0.4)
    place(y, music_box_note(1568.0, 0.5, 0.25), at + 0.08, 0.2)
    return finish(room(y, 0.5, 0.16, 0.01, 5000, 0.25))


def michelle_trap_sprung() -> np.ndarray:
    # The trap catches: a sharp wooden toy snap, a string pulled tight (rising, creaking pitch)
    # and a small low thump.
    n = int(0.06 * SR)
    clack = (bandpass(noise(0.06), 1000, 6000) * env_ad(n, 0.0002, 0.004)
             + 0.5 * np.sin(2 * np.pi * 1850 * t_axis(0.06)) * env_ad(n, 0.0002, 0.012)
             + 0.3 * np.sin(2 * np.pi * 3150 * t_axis(0.06)) * env_ad(n, 0.0002, 0.008))
    t = t_axis(0.32)
    f = np.geomspace(190, 420, len(t))
    string = signal.sawtooth(2 * np.pi * np.cumsum(f * (1 + 0.01 * np.sin(2 * np.pi * 31 * t))) / SR)
    string = lowpass(string, 2600) * bell_env(len(t), 0.75, 1.0)
    fibre = lowpass(crackle(0.3, 500, 0.002), 3500) * bell_env(int(0.3 * SR), 0.7, 1.0)
    y = mix(0.8, (clack / (np.max(np.abs(clack)) + 1e-9), 0, 0.9), (thud(0.25, 150, 70, 0.05), 0.0, 0.35),
            (string / (np.max(np.abs(string)) + 1e-9), 0.05, 0.28), (fibre, 0.06, 0.15),
            (tick(2600, 0.003), 0.37, 0.3))
    return finish(room(y, 0.45, 0.14, 0.008, 5000, 0.2))


# --- picker (frontier drifter with a lasso; hops through every square) ----------------------------

def spur_jingle(n: int = 4, base: float = 3400) -> np.ndarray:
    """Spur rowels: a few small, quickly decaying metal rings in a short loose cluster."""
    y = silence(0.35)
    at = 0.0
    for k in range(n):
        f = base * rng.uniform(0.88, 1.12)
        place(y, metal(0.2, f, (1.0, 1.48, 2.21, 3.1), decay=0.07, bright=0.55), at, 0.9 * 0.8 ** k)
        at += rng.uniform(0.03, 0.06)
    return y / (np.max(np.abs(y)) + 1e-9)


def rope_rub(dur: float = 0.35, lo: float = 400, hi: float = 1300) -> np.ndarray:
    """Hemp rope sliding through a hand: fibrous mid-band friction noise with a grainy texture."""
    fric = swept_band(noise(dur), lo, hi, 1.4)
    grain = 0.55 + 0.45 * lowpass(np.abs(crackle(dur, 900, 0.003)), 60)
    y = fric * grain * bell_env(int(dur * SR), 0.45, 1.1)
    return y / (np.max(np.abs(y)) + 1e-9)


def sand_step(weight: float = 1.0) -> np.ndarray:
    """A boot on sand: a soft low heel thud plus a short granular crunch."""
    heel = thud(0.16, 115 * weight, 55 * weight, 0.04)
    crunch = bandpass(crackle(0.12, 2200, 0.0015), 1200, 7000) * env_ad(int(0.12 * SR), 0.004, 0.035)
    y = mix(0.18, (heel, 0, 0.75), (crunch / (np.max(np.abs(crunch)) + 1e-9), 0.003, 0.45))
    return y / (np.max(np.abs(y)) + 1e-9)


def whip_crack() -> np.ndarray:
    """A lasso tip snapping: a very short, thin, bright crack (high-passed, no low body, so it never
    reads as a gunshot) with a tiny falling chirp."""
    n = int(0.03 * SR)
    snap = highpass(noise(0.03), 1800, 2) * env_ad(n, 0.0002, 0.0025)
    chirp = sweep_tone(0.012, 7000, 2500, "sine", 0.004, 0.0002)
    y = mix(0.03, (snap / (np.max(np.abs(snap)) + 1e-9), 0, 1.0), (chirp, 0, 0.3))
    return y / (np.max(np.abs(y)) + 1e-9)


def hop_boing(f0: float = 300) -> np.ndarray:
    """A light springy hop: a quick downward pitch glide with a little wobble (cartoon spring)."""
    t = t_axis(0.16)
    f = f0 * (1 + 0.9 * np.exp(-t / 0.035)) * (1 + 0.05 * np.sin(2 * np.pi * 15 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * env_ad(len(t), 0.002, 0.06)
    return y / (np.max(np.abs(y)) + 1e-9)


def picker_select() -> np.ndarray:
    # Spur jingle as he shifts his weight, then the lasso coil slides through his hand.
    y = mix(0.75, (spur_jingle(4, 3400), 0, 0.5), (rope_rub(0.4, 350, 1100), 0.12, 0.6),
            (sand_step(0.9), 0.0, 0.25))
    return finish(room(y, 0.3, 0.08, 0.006, 3500, 0.12))


def picker_move() -> np.ndarray:
    # Two unhurried boot steps on sand, each with a faint spur ring.
    y = mix(0.6, (sand_step(1.0), 0, 0.9), (spur_jingle(2, 3600), 0.005, 0.12),
            (sand_step(0.95), 0.25, 0.8), (spur_jingle(2, 3300), 0.255, 0.1))
    return finish(room(y, 0.3, 0.07, 0.006, 3500, 0.12))


def picker_capture() -> np.ndarray:
    # Lasso twirl (two whoosh turns), the tip cracks, then the rope is pulled taut (rising friction
    # and a creak) and the target lands with a soft sand thud.
    creak_t = t_axis(0.25)
    creak = lowpass(sweep_tone(0.25, 120, 190, "saw", 0.15, 0.01) * (1 + 0.7 * np.sin(2 * np.pi * 42 * creak_t)), 1500)
    y = mix(1.1, (whoosh(0.2, 400, 1300, 1.3, 0.55), 0, 0.3), (whoosh(0.2, 500, 1700, 1.3, 0.6), 0.16, 0.42),
            (whip_crack(), 0.36, 0.85), (rope_rub(0.35, 500, 1600), 0.4, 0.55),
            (creak / (np.max(np.abs(creak)) + 1e-9), 0.45, 0.16), (sand_step(1.15), 0.68, 0.55),
            (spur_jingle(2, 3200), 0.7, 0.1))
    return finish(room(y, 0.35, 0.09, 0.006, 4500, 0.15))


def picker_hop_multi() -> np.ndarray:
    # Hop-hop-hop through the line: three springy boings rising in pitch, each landing with a light
    # tap on sand, then a final spur jingle.
    y = silence(1.0)
    for k, f in enumerate((280.0, 340.0, 410.0)):
        at = 0.19 * k
        place(y, hop_boing(f), at, 0.55)
        tap = bandpass(noise(0.03), 900, 5000) * env_ad(int(0.03 * SR), 0.0003, 0.005)
        place(y, tap / (np.max(np.abs(tap)) + 1e-9), at + 0.11, 0.35)
        place(y, sand_step(1.25), at + 0.11, 0.3)
    place(y, spur_jingle(3, 3500), 0.62, 0.2)
    return finish(room(y, 0.3, 0.08, 0.006, 4000, 0.12))


# --- rakaeli (blindfolded fallen angel; transforms into a flame-winged demon, "타천") ---------------

def feather_flap(dur: float = 0.24, lo: float = 420, hi: float = 1500, flutter: float = 38.0,
                 weight: float = 1.0) -> np.ndarray:
    """One feathered wing stroke: a downward-swept air band (the stroke pushes air down), a fast
    feather-vane flutter on its amplitude, a soft low air push and a few dry quill ticks. Unlike
    cloak_swish (one slow 21 Hz fabric swish) the flutter is fast and the band falls."""
    n = int(dur * SR)
    t = t_axis(dur)
    air = swept_band(noise(dur), hi, lo, 1.3) * bell_env(n, 0.3, 1.4)
    air *= 1 + 0.5 * np.sin(2 * np.pi * flutter * t + rng.uniform(0, 6.28)) * np.exp(-t / (dur * 0.6))
    push = lowpass(noise(dur), 260 * weight, 2) * env_ad(n, 0.02, dur * 0.3)
    quills = highpass(crackle(dur, 140, 0.0012), 3500) * bell_env(n, 0.35, 1.0)
    y = (air / (np.max(np.abs(air)) + 1e-9) + 0.45 * weight * push / (np.max(np.abs(push)) + 1e-9)
         + 0.08 * quills)
    y = lowpass(y, 5000)  # soft feathers, not a hiss
    return y / (np.max(np.abs(y)) + 1e-9)


def halo_glint(f: float = 1975.5, dur: float = 0.55, crack: float = 1.0) -> np.ndarray:
    """A dimmed, cracked halo: a thin glassy ring whose two near-unison partials beat against each
    other (the crack), a dark low-passed body, and a tiny fracture tick at the onset."""
    t = t_axis(dur)
    y = (np.sin(2 * np.pi * f * t) + 0.8 * np.sin(2 * np.pi * f * 1.011 * t + 1.0)
         + 0.25 * np.sin(2 * np.pi * f * 2.37 * t) * np.exp(-t / 0.05))
    y = lowpass(y * env_ad(len(t), 0.003, dur * 0.35), 5000)
    y = y / (np.max(np.abs(y)) + 1e-9)
    if crack:
        place(y, tick(5200, 0.002), 0.0, 0.3 * crack)
    return y / (np.max(np.abs(y)) + 1e-9)


def ember_crackle(dur: float, density: float = 60, thin: float = 1.0) -> np.ndarray:
    """Sparse glowing embers: small pops whose density thins out over time (thin > 0)."""
    n = int(dur * SR)
    y = np.zeros(n)
    for _ in range(int(density * dur)):
        tpos = rng.uniform(0, 1) ** (1 + thin) * dur
        L = int(rng.uniform(60, 500))
        i = min(n - L - 1, int(tpos * SR))
        y[i:i + L] += rng.uniform(0.2, 1.0) * rng.standard_normal(L) * np.exp(-np.arange(L) / (0.0018 * SR))
    return bandpass(y, 1200, 9000) / (np.max(np.abs(bandpass(y, 1200, 9000))) + 1e-9)


def flame_roar(dur: float, lo: float = 120, hi: float = 1400, peak: float = 0.4) -> np.ndarray:
    """Low, wide fire roar: band-limited noise with slow turbulent amplitude, swelling then falling."""
    t = t_axis(dur)
    r = bandpass(noise(dur), lo, hi, 2)
    turb = lowpass(rng.standard_normal(len(t)), 18, 2)
    turb = 1 + 0.35 * turb / (np.std(turb) + 1e-9)
    y = r * np.clip(turb, 0.2, 2.0) * bell_env(len(t), peak, 1.2)
    return y / (np.max(np.abs(y)) + 1e-9)


def rakaeli_select() -> np.ndarray:
    # Folded wings stir (a small feather rustle) under the faint ring of the cracked halo.
    y = mix(0.6, (feather_flap(0.2, 600, 2200, 44, 0.5), 0, 0.55), (halo_glint(1975.5, 0.45), 0.05, 0.38),
            (halo_glint(2959.0, 0.35, 0.0), 0.09, 0.12))
    return finish(room(y, 0.6, 0.2, 0.015, 5500, 0.15))


def rakaeli_move() -> np.ndarray:
    # Two soft feathered wing flaps, the second a touch lighter, then a quill settles.
    y = mix(0.62, (feather_flap(0.26, 380, 1400, 36, 1.0), 0, 0.9), (feather_flap(0.24, 440, 1600, 41, 0.8), 0.22, 0.72),
            (highpass(crackle(0.1, 120, 0.001), 4000), 0.46, 0.06))
    return finish(room(y, 0.4, 0.1, 0.01, 4500, 0.15))


def rakaeli_capture() -> np.ndarray:
    # A pale strike: a quick feather-edged slash of air, a cold glass-like strike with a soft low
    # body, and a falling minor-second halo sigh (no metal clang, no fire).
    slash = whoosh(0.16, 1200, 5200, 2.2, 0.8)
    t = t_axis(0.62)
    glass = sum(g * np.sin(2 * np.pi * 1396.9 * r * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
                for r, g, d in ((1.0, 1.0, 0.22), (2.32, 0.5, 0.09), (4.25, 0.3, 0.04), (6.63, 0.15, 0.02)))
    glass = glass * env_ad(len(t), 0.0006, 0.5)
    body = lowpass(thud(0.3, 150, 70, 0.06), 1200)
    sigh = sum(np.sin(2 * np.pi * np.cumsum(f * np.geomspace(1.0, 0.95, len(t))) / SR) for f in (1046.5, 1108.7))
    sigh = lowpass(sigh, 3000) * bell_env(len(t), 0.2, 1.4)
    y = mix(0.85, (slash, 0, 0.4), (glass / (np.max(np.abs(glass)) + 1e-9), 0.12, 0.6), (body, 0.12, 0.6),
            (feather_flap(0.2, 500, 1800, 40, 0.4), 0.1, 0.25), (sigh / (np.max(np.abs(sigh)) + 1e-9), 0.18, 0.16))
    return finish(room(y, 0.7, 0.2, 0.02, 6000, 0.18))


def rakaeli_skill() -> np.ndarray:
    # 타천 (the transform): the blindfold burns (a rising sizzle + flare whoosh), the cracked halo
    # snaps, the wings unfurl in two big accelerating strokes as a dark choir swells - gliding DOWN,
    # a fall from heaven - and a crimson flame bloom opens at the peak.
    dur = 1.0
    burn = mix(0.42, (highpass(crackle(0.42, 700, 0.002), 2800) * np.clip(t_axis(0.42) / 0.38, 0, 1) ** 1.5, 0, 0.5),
               (whoosh(0.42, 900, 6000, 2.0, 0.85), 0, 0.6))
    choir_l = choir(dur, notes=(73.42, 110.0, 146.83, 174.61, 207.65), rise=0.94, vowel=(520, 880, 2450))
    choir_l *= np.clip(t_axis(dur) / 0.6, 0, 1) ** 1.4 * np.exp(-np.clip(t_axis(dur) - 0.82, 0, None) / 0.1)
    sub = lowpass(np.sin(2 * np.pi * np.cumsum(np.geomspace(55, 41, int(dur * SR))) / SR), 200)
    sub *= np.clip(t_axis(dur) / 0.7, 0, 1) ** 2 * np.exp(-np.clip(t_axis(dur) - 0.82, 0, None) / 0.1)
    y = mix(dur, (burn / (np.max(np.abs(burn)) + 1e-9), 0, 0.6), (halo_glint(1975.5, 0.3), 0.3, 0.35),
            (feather_flap(0.3, 260, 1300, 30, 1.2), 0.33, 0.75), (feather_flap(0.28, 220, 1100, 27, 1.4), 0.56, 0.85),
            (choir_l, 0.0, 0.42), (sub, 0.0, 0.3), (flame_roar(0.36, 150, 1800, 0.25), 0.64, 0.55),
            (ember_crackle(0.3, 80, 1.0), 0.68, 0.22))
    return finish(room(y, 0.9, 0.2, 0.02, 4500, 0.22))


def rakaeli_awake_move() -> np.ndarray:
    # One heavy flame-wing beat: a deep downstroke whump, the fire roaring along the wing edge and
    # a few embers shaken loose.
    y = mix(0.75, (feather_flap(0.38, 160, 900, 24, 1.6), 0, 0.85), (thud(0.4, 75, 38, 0.12), 0.07, 0.6),
            (flame_roar(0.5, 110, 1500, 0.3), 0.02, 0.55), (ember_crackle(0.45, 70, 1.0), 0.12, 0.2))
    return finish(saturate(room(y, 0.6, 0.14, 0.012, 3500, 0.2), 1.3))


def rakaeli_awake_capture() -> np.ndarray:
    # A dark-flame impact: the air is sucked in (reversed swell), then a heavy blow with a low,
    # out-of-tune bell strike (the broken crimson halo), a fire bloom and a trail of embers.
    inhale = whoosh(0.3, 300, 2600, 1.6, 0.95)
    boom = thud(0.6, 95, 30, 0.2)
    t = t_axis(0.65)
    bell = sum(g * np.sin(2 * np.pi * 207.65 * r * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
               for r, g, d in ((1.0, 1.0, 0.45), (1.41, 0.6, 0.3), (2.93, 0.35, 0.15), (4.1, 0.2, 0.08)))
    bell = lowpass(bell * env_ad(len(t), 0.001, 0.35), 2400)
    y = mix(0.95, (inhale, 0, 0.45), (boom, 0.26, 1.0), (bell / (np.max(np.abs(bell)) + 1e-9), 0.26, 0.4),
            (flame_roar(0.5, 140, 2200, 0.15), 0.26, 0.8), (ember_crackle(0.5, 90, 1.2), 0.3, 0.3))
    return finish(saturate(room(y, 0.6, 0.16, 0.012, 4000, 0.18), 1.6))


def rakaeli_awake_end() -> np.ndarray:
    # Turning back: the last embers pop and thin out over a fading glow, and the smoke leaves in a
    # soft exhale (a breathy band whose filter falls), then a single faint halo ring returns.
    dur = 0.9
    glow = flame_roar(0.7, 90, 700, 0.1) * np.exp(-t_axis(0.7) / 0.25)
    t = t_axis(0.75)
    breath = swept_band(noise(0.75), 1800, 380, 0.9) * bell_env(len(t), 0.3, 1.5)
    y = mix(dur + 0.05, (lowpass(ember_crackle(0.8, 55, 2.0), 6000), 0, 0.28), (glow / (np.max(np.abs(glow)) + 1e-9), 0, 0.4),
            (breath / (np.max(np.abs(breath)) + 1e-9), 0.1, 0.6), (halo_glint(1975.5, 0.35, 0.0), 0.5, 0.1))
    return finish(room(y, 0.6, 0.16, 0.015, 4000, 0.15))


# --- rampid (teenage ice skater; fast forward dasher) ---------------------------------------------

def skate_scrape(dur: float = 0.22, lo: float = 2600, hi: float = 7500, grit: float = 1.0) -> np.ndarray:
    """A skate blade carving ice: a bright, narrow swept band (the blade edge) with a grainy ice-chip
    texture and a faint high whistle of the blade itself. Brighter and thinner than a whoosh."""
    n = int(dur * SR)
    t = t_axis(dur)
    edge = swept_band(noise(dur), lo, hi, 3.2)
    carve = swept_band(noise(dur), lo * 0.33, hi * 0.3, 1.4)  # the body of the stroke, so it is not all hiss
    chips = highpass(crackle(dur, 1600, 0.0009), 3500)
    whistle = np.sin(2 * np.pi * np.cumsum(np.geomspace(hi * 0.9, hi * 1.15, n)) / SR) * np.exp(-t / (dur * 0.6))
    y = (edge / (np.max(np.abs(edge)) + 1e-9) + 0.9 * carve / (np.max(np.abs(carve)) + 1e-9)
         + 0.3 * grit * chips + 0.05 * whistle) * bell_env(n, 0.35, 1.3)
    return lowpass(y, 10000) / (np.max(np.abs(y)) + 1e-9)


def ice_tinkle(dur: float = 0.4, n: int = 6, base: float = 3000) -> np.ndarray:
    """Frost: tiny glassy ice-crystal pings (inharmonic, very short) scattered over a crisp crackle."""
    y = silence(dur)
    for _ in range(n):
        f = base * rng.uniform(0.85, 1.9)
        place(y, metal(0.12, f, (1.0, 2.31, 3.87), decay=0.035, bright=0.45), rng.uniform(0, dur - 0.12),
              rng.uniform(0.25, 0.6))
    fizz = bandpass(crackle(dur, 900, 0.0008), 3500, 9000) * bell_env(int(dur * SR), 0.2, 1.2)
    y = y / (np.max(np.abs(y)) + 1e-9) + 0.25 * fizz
    return y / (np.max(np.abs(y)) + 1e-9)


def ice_stop(dur: float = 0.3) -> np.ndarray:
    """A hockey-style stop: a broadband spray of shaved ice that bursts and decays fast."""
    n = int(dur * SR)
    spray = bandpass(noise(dur), 900, 8000) * env_ad(n, 0.012, dur * 0.28)
    grain = 0.6 + 0.4 * lowpass(np.abs(crackle(dur, 1200, 0.002)), 90)
    y = spray * grain
    return y / (np.max(np.abs(y)) + 1e-9)


def rampid_select() -> np.ndarray:
    # A quick skate stop (spray of shaved ice) and a sparkle of frost: "ready!"
    y = mix(0.6, (skate_scrape(0.12, 3000, 6000), 0, 0.45), (ice_stop(0.28), 0.06, 0.8),
            (ice_tinkle(0.4, 6, 3200), 0.12, 0.3))
    return finish(room(y, 0.45, 0.14, 0.008, 8000, 0.15))


def rampid_move() -> np.ndarray:
    # Two fast skating strides (bright blade carves, the second higher and longer) and a short glide hiss.
    glide = highpass(noise(0.25), 5000) * np.exp(-t_axis(0.25) / 0.08)
    y = mix(0.55, (skate_scrape(0.16, 2400, 5600), 0, 0.85), (skate_scrape(0.22, 2800, 7800), 0.13, 0.95),
            (whoosh(0.3, 900, 3600, 1.4, 0.45), 0.05, 0.25), (glide, 0.3, 0.12))
    return finish(room(y, 0.35, 0.1, 0.006, 8000, 0.12))


def rampid_capture() -> np.ndarray:
    # Speed dash into an icy hit: a fast rising rush, a glassy ice-shatter strike with a small low
    # body, shards scattering, and frost crackling over the tail.
    rush = whoosh(0.22, 1200, 7000, 2.0, 0.85)
    t = t_axis(0.5)
    shatter = sum(g * np.sin(2 * np.pi * 2350 * r * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
                  for r, g, d in ((1.0, 1.0, 0.12), (1.47, 0.7, 0.08), (2.63, 0.45, 0.05), (3.91, 0.3, 0.03)))
    shatter = shatter * env_ad(len(t), 0.0004, 0.3)
    burst = bandpass(crackle(0.35, 2500, 0.0015), 1500, 8000) * env_ad(int(0.35 * SR), 0.001, 0.07)
    y = mix(0.95, (rush, 0, 0.5), (skate_scrape(0.1, 3200, 8000), 0.12, 0.35),
            (shatter / (np.max(np.abs(shatter)) + 1e-9), 0.2, 0.45), (burst, 0.2, 0.6),
            (thud(0.25, 170, 75, 0.05), 0.2, 0.55), (ice_tinkle(0.5, 9, 2900), 0.26, 0.35))
    return finish(room(y, 0.6, 0.16, 0.01, 8000, 0.2))


# --- larhen (professional assassin; twin daggers, high leaps) -------------------------------------

def blade_whoosh(dur: float = 0.12, f0: float = 1500, f1: float = 6500) -> np.ndarray:
    """A thin dagger cutting air: a fast, narrow (high-Q) swept band, much shorter than a sword swing."""
    x = swept_band(noise(dur), f0, f1, 4.0)
    x *= bell_env(len(x), 0.7, 2.0)
    return x / (np.max(np.abs(x)) + 1e-9)


def steel_shing(f: float = 2650, dur: float = 0.55, scrape: float = 0.18) -> np.ndarray:
    """A dagger drawn from its sheath: a short rising steel scrape, then a thin, clean, long ring
    (two close partials beating slowly for the 'shing')."""
    n = int(scrape * SR)
    scr = swept_band(noise(scrape), 3000, 8500, 3.5) * bell_env(n, 0.85, 1.1)
    t = t_axis(dur)
    ring = (np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 1.004 * t + 0.7)
            + 0.3 * np.sin(2 * np.pi * f * 2.71 * t) * np.exp(-t / 0.06)
            + 0.15 * np.sin(2 * np.pi * f * 4.95 * t) * np.exp(-t / 0.03))
    ring = ring * env_ad(len(t), 0.0005, dur * 0.4)
    y = mix(scrape + dur, (scr / (np.max(np.abs(scr)) + 1e-9), 0, 0.5), (ring / (np.max(np.abs(ring)) + 1e-9), scrape * 0.85, 0.6))
    return y / (np.max(np.abs(y)) + 1e-9)


def larhen_select() -> np.ndarray:
    # Twin daggers drawn, one after the other (the second a touch higher), in a quiet, dry space.
    y = mix(0.85, (steel_shing(2650, 0.5, 0.14), 0, 0.7), (steel_shing(2980, 0.45, 0.12), 0.11, 0.6),
            (cloak_swish(0.18), 0.0, 0.12))
    return finish(room(y, 0.4, 0.1, 0.008, 6000, 0.15))


def larhen_move() -> np.ndarray:
    # A high leap: a coat flick, the air rushing up past him, and a near-silent light landing.
    rise = whoosh(0.3, 500, 3000, 1.5, 0.6)
    fall = whoosh(0.18, 2600, 900, 1.6, 0.4)
    land = lowpass(soft_step(1.1), 1500)
    y = mix(0.75, (cloak_swish(0.2), 0, 0.5), (rise, 0.03, 0.6), (fall, 0.33, 0.3), (land, 0.5, 0.45))
    return finish(room(y, 0.35, 0.08, 0.008, 5000, 0.12))


def larhen_capture() -> np.ndarray:
    # Two lightning-fast cross slashes, a crisp steel 'tsing' on the cut, a muted body, then silence.
    t = t_axis(0.4)
    tsing = (np.sin(2 * np.pi * 3150 * t) + 0.5 * np.sin(2 * np.pi * 3150 * 2.76 * t) * np.exp(-t / 0.03)) * env_ad(len(t), 0.001, 0.12)
    # The cut is a soft-edged (1 ms attack, band-limited) snap: a sharper click made the AAC encoder
    # overshoot and turned the whole clip 2 dB down.
    cut = bandpass(noise(0.03), 2500, 9000) * env_ad(int(0.03 * SR), 0.001, 0.006)
    y = mix(0.75, (blade_whoosh(0.11, 1400, 6800), 0, 0.75), (blade_whoosh(0.1, 1700, 7600), 0.075, 0.8),
            (cut / (np.max(np.abs(cut)) + 1e-9), 0.15, 0.6), (tsing / (np.max(np.abs(tsing)) + 1e-9), 0.15, 0.35),
            (lowpass(thud(0.22, 130, 60, 0.05), 900), 0.155, 0.55), (steel_shing(2800, 0.3, 0.06), 0.32, 0.12))
    return finish(saturate(room(y, 0.45, 0.1, 0.008, 6000, 0.15), 1.5))


# --- volkonov (bard with closed, smiling eyes; buffs allies with music) ---------------------------

def lute_pluck(f: float, dur: float = 0.8, bright: float = 0.5, damp: float = 0.996) -> np.ndarray:
    """A plucked gut string (Karplus-Strong, computed one delay period at a time) through a small
    wooden body (two resonances), with a soft pick click. bright 0..1 shapes the pluck noise."""
    n = int(dur * SR)
    N = max(2, int(round(SR / f)))
    y = np.zeros(n + N + 1)
    exc = rng.uniform(-1, 1, N + 1)
    exc = lowpass(exc, 1200 + 7000 * bright, 1)
    y[: N + 1] = exc
    i = N + 1
    while i < len(y):
        L = min(N, len(y) - i)
        y[i:i + L] = damp * 0.5 * (y[i - N:i - N + L] + y[i - N - 1:i - N - 1 + L])
        i += L
    y = y[:n]
    body = bandpass(y, 180, 420, 1) * 0.5 + bandpass(y, 1400, 3200, 1) * 0.3
    y = y + body
    # A 3 ms attack: a pluck that starts at full level in one sample made the AAC encoder overshoot
    # by ~5 dB (and the encode loop then turned the whole clip down).
    y *= env_ad(n, 0.003, dur * 0.45)
    pick = bandpass(noise(0.01), 2000, 6000) * env_ad(int(0.01 * SR), 0.001, 0.002)
    place(y, pick / (np.max(np.abs(pick)) + 1e-9), 0, 0.08)
    return y / (np.max(np.abs(y)) + 1e-9)


# D major / D Mixolydian palette for the bard: warm and bright, never minor.
NOTE = {"D3": 146.83, "A3": 220.0, "D4": 293.66, "E4": 329.63, "F#4": 369.99, "G4": 392.0, "A4": 440.0,
        "B4": 493.88, "C5": 523.25, "D5": 587.33, "E5": 659.26, "F#5": 739.99, "A5": 880.0, "D6": 1174.66}


def strum(notes, at_gap: float = 0.028, dur: float = 0.9, bright: float = 0.5) -> np.ndarray:
    y = silence(dur + at_gap * len(notes))
    for k, nm in enumerate(notes):
        place(y, lute_pluck(NOTE[nm], dur, bright), k * at_gap, 0.75 + 0.05 * k)
    return y / (np.max(np.abs(y)) + 1e-9)


def volkonov_select() -> np.ndarray:
    # A quick, friendly rolled D-major strum and a playful little high answer.
    y = mix(1.0, (strum(("D4", "A4", "D5", "F#5"), 0.03, 0.75, 0.5), 0, 0.8),
            (lute_pluck(NOTE["A5"], 0.45, 0.6), 0.3, 0.3), (lute_pluck(NOTE["D6"], 0.4, 0.6), 0.4, 0.22))
    return finish(room(y, 0.7, 0.16, 0.012, 6000, 0.2))


def volkonov_move() -> np.ndarray:
    # Walking to the beat: two light plucks stepping up a fourth, a soft cloak swish under them.
    y = mix(0.75, (lute_pluck(NOTE["A4"], 0.45, 0.45), 0, 0.7), (lute_pluck(NOTE["D5"], 0.5, 0.5), 0.17, 0.75),
            (cloak_swish(0.26), 0.02, 0.15))
    return finish(room(y, 0.55, 0.14, 0.01, 6000, 0.18))


def volkonov_capture() -> np.ndarray:
    # A flourish that ends the song: a fast run down the scale, a snapped low string (a percussive
    # damped 'thwack' on the body) and a sly resolving high note.
    y = silence(1.0)
    for k, nm in enumerate(("D6", "A5", "F#5", "E5", "D5")):
        place(y, lute_pluck(NOTE[nm], 0.25, 0.6, 0.993), k * 0.045, 0.5)
    snap = lute_pluck(NOTE["D3"], 0.25, 0.9, 0.985) * np.exp(-t_axis(0.25) / 0.05)
    place(y, snap, 0.25, 0.95)
    place(y, thud(0.2, 160, 80, 0.04), 0.25, 0.4)
    place(y, whoosh(0.16, 900, 3800, 1.6, 0.8), 0.12, 0.2)
    place(y, lute_pluck(NOTE["A5"], 0.55, 0.45), 0.42, 0.45)
    return finish(room(y, 0.7, 0.16, 0.012, 6000, 0.2))


def volkonov_skill() -> np.ndarray:
    # 선율 (the buff): an accelerating rising D-major arpeggio of lute plucks over a warm, chorused
    # pad that swells in, crowned with a bright two-note chime and a sparkle.
    dur = 1.25
    t = t_axis(dur)
    pad = np.zeros_like(t)
    for nm, g in (("D4", 1.0), ("F#4", 0.7), ("A4", 0.75), ("D5", 0.5)):
        for d in (-0.004, 0.0, 0.0045):
            pad += g * signal.sawtooth(2 * np.pi * NOTE[nm] * (1 + d) * t + rng.uniform(0, 6.28), 0.5)
    pad = lowpass(pad, 2200) * (1 + 0.15 * np.sin(2 * np.pi * 5.5 * t))
    pad *= np.clip(t / 0.85, 0, 1) ** 1.5 * np.exp(-np.clip(t - 0.95, 0, None) / 0.12)
    y = silence(dur + 0.2)
    place(y, pad / (np.max(np.abs(pad)) + 1e-9), 0, 0.32)
    at, gap = 0.0, 0.11
    for nm in ("D4", "F#4", "A4", "D5", "F#5", "A5", "D6"):
        place(y, lute_pluck(NOTE[nm], 0.6, 0.55), at, 0.55)
        at += gap
        gap *= 0.84
    place(y, chime(NOTE["D6"] * 2, 0.6, 0.3), at + 0.02, 0.18)
    place(y, chime(NOTE["A5"] * 2, 0.6, 0.3), at + 0.06, 0.14)
    place(y, sparkle(0.45, 2800, 6), at, 0.18)
    place(y, whoosh(0.7, 500, 4500, 1.5, 0.85), 0.1, 0.1)
    return finish(room(y, 1.0, 0.2, 0.015, 6500, 0.25))


# --- verish (pink-haired speedster on high-tech power boots; pierces through her whole lane) -------

def servo_whine(dur: float, f0: float, f1: float, wobble: float = 0.012) -> np.ndarray:
    """The power boots spinning up (or down): a clean gliding tone with a few harmonics and a fast
    small vibrato (a motor whine, not a musical note), swelling in and out."""
    t = t_axis(dur)
    f = np.geomspace(f0, f1, len(t)) * (1 + wobble * np.sin(2 * np.pi * 34 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.35 * np.sin(2 * ph + 0.4) + 0.18 * np.sin(3.01 * ph + 1.1)
    y *= bell_env(len(t), 0.6, 1.2)
    return y / (np.max(np.abs(y)) + 1e-9)


def electric_arc(dur: float, base: float = 118.0, density: float = 700, flicker: float = 0.6) -> np.ndarray:
    """An electric arc / static discharge: a jittery, high-passed buzz that flickers on and off,
    over fine crackle. Every edge is soft (a few ms), since hard clicks make AAC overshoot."""
    n = int(dur * SR)
    t = t_axis(dur)
    jit = 1 + 0.06 * lowpass(rng.standard_normal(n), 60) / 0.05
    ph = 2 * np.pi * np.cumsum(base * jit) / SR
    buzz = highpass(signal.sawtooth(ph) + 0.5 * signal.square(2.01 * ph), 900)
    gate = lowpass((rng.uniform(0, 1, n) < 0.004).astype(float), 25)  # random flicker bursts
    gate = (1 - flicker) + flicker * np.clip(gate / (np.max(gate) + 1e-9) * 2.5, 0, 1)
    fizz = bandpass(crackle(dur, density, 0.0012), 2500, 9000)
    y = (buzz / (np.max(np.abs(buzz)) + 1e-9) * gate + 0.7 * fizz) * bell_env(n, 0.25, 1.1)
    y *= np.clip(t / 0.003, 0, 1)
    return y / (np.max(np.abs(y)) + 1e-9)


def boot_slide(dur: float, f0: float = 2400, f1: float = 700, grit: float = 1.0) -> np.ndarray:
    """A hard power-boot skid on stone: a mid-band friction sweep falling in pitch as she brakes,
    roughened by a grainy amplitude texture (rubber and metal plates catching the floor)."""
    n = int(dur * SR)
    fr = swept_band(noise(dur), f0, f1, 2.2)
    g = lowpass(np.abs(crackle(dur, 1400, 0.002)), 120)
    grain = 0.4 + 0.6 * np.clip(g / (np.percentile(g, 95) + 1e-9), 0, 1.3)
    body = swept_band(noise(dur), f0 * 0.3, f1 * 0.35, 1.2)
    y = (fr / (np.max(np.abs(fr)) + 1e-9) * grain * grit
         + 0.5 * body / (np.max(np.abs(body)) + 1e-9)) * bell_env(n, 0.18, 1.3)
    return y / (np.max(np.abs(y)) + 1e-9)


def pierce_hit(pitch: float = 1.0, body: float = 1.0) -> np.ndarray:
    """One straight-through pierce: a very fast rising zip, a soft-edged (1.5 ms) snap, a short
    falling 'thwip' tone and a tight, punchy low body. ~0.3 s; the impact sits at 0.08 s."""
    y = silence(0.32)
    zip_ = swept_band(noise(0.09), 1400 * pitch, 7200 * pitch, 3.0) * bell_env(int(0.09 * SR), 0.88, 1.6)
    place(y, zip_ / (np.max(np.abs(zip_)) + 1e-9), 0.0, 0.55)
    snap = bandpass(noise(0.03), 1800, 7500) * env_ad(int(0.03 * SR), 0.0015, 0.006)
    place(y, snap / (np.max(np.abs(snap)) + 1e-9), 0.08, 0.45)
    thwip = sweep_tone(0.16, 2100 * pitch, 1150 * pitch, "tri", 0.045, 0.0015)
    place(y, lowpass(thwip, 7000), 0.08, 0.32)
    # The low body: thud()'s 0.5 ms click made the AAC encoder overshoot on this dense hit, so the
    # body and its knock both get a 2 ms attack.
    knock = lowpass(noise(0.22), 900) * env_ad(int(0.22 * SR), 0.002, 0.018)
    bod = sweep_tone(0.22, 210 * pitch, 72, "sine", 0.045, 0.002) + 0.45 * knock / (np.max(np.abs(knock)) + 1e-9)
    place(y, lowpass(bod, 1400) / (np.max(np.abs(bod)) + 1e-9), 0.079, 0.8 * body)
    return y / (np.max(np.abs(y)) + 1e-9)


def verish_select() -> np.ndarray:
    # The boots power up: a quick servo spin-up whine, two small electric ticks, a bright
    # two-note "ready" ping (a rising fifth: cheeky and upbeat).
    y = mix(0.75, (servo_whine(0.32, 380, 1500), 0, 0.5), (electric_arc(0.22, 140, 900, 0.7), 0.12, 0.22),
            (chime(1568.0, 0.3, 0.08), 0.27, 0.28), (chime(2349.3, 0.35, 0.1), 0.34, 0.24))
    return finish(room(y, 0.4, 0.1, 0.008, 7000, 0.15))


def verish_move() -> np.ndarray:
    # A fast power-boot slide: a thrust whoosh launching her forward, the boots' whine dropping
    # as she glides, and an electric skid (friction sweep + arc crackle) as she brakes.
    thrust = whoosh(0.3, 500, 3200, 1.6, 0.35)
    y = mix(0.75, (thrust, 0, 0.6), (servo_whine(0.4, 1300, 620, 0.02), 0.02, 0.36),
            (boot_slide(0.32, 2600, 800), 0.2, 0.6), (electric_arc(0.3, 112, 800, 0.6), 0.22, 0.3))
    return finish(room(y, 0.35, 0.09, 0.006, 7000, 0.12))


def verish_capture() -> np.ndarray:
    # A punchy pierce: she shoots through the target (one strong hit), a burst of static where the
    # boots strike and the rush of air closing behind her.
    y = mix(0.9, (whoosh(0.16, 700, 3600, 1.8, 0.8), 0, 0.18), (pierce_hit(1.0, 1.35), 0.06, 1.0),
            (electric_arc(0.45, 125, 1200, 0.5), 0.2, 0.24), (whoosh(0.4, 3000, 600, 1.5, 0.2), 0.18, 0.2))
    return finish(saturate(room(y, 0.5, 0.11, 0.008, 7000, 0.25), 1.4))


def verish_hop_multi() -> np.ndarray:
    # Straight through the whole lane: three pierces in a rapid burst (each a little higher), one
    # rising zip under them, a crackling electric discharge and a short skid to a stop.
    y = silence(1.15)
    place(y, whoosh(0.4, 600, 4200, 1.8, 0.75), 0.0, 0.25)
    for k, (p, g) in enumerate(((1.0, 0.85), (1.12, 0.85), (1.26, 1.0))):
        place(y, pierce_hit(p, 0.9), 0.05 + 0.105 * k, g)
    place(y, electric_arc(0.45, 130, 1400, 0.55), 0.3, 0.32)
    place(y, boot_slide(0.26, 2400, 900, 0.9), 0.5, 0.35)
    place(y, chime(2637.0, 0.3, 0.09), 0.42, 0.12)
    return finish(saturate(room(y, 0.5, 0.11, 0.008, 7000, 0.2), 1.3))


# --- midos (a ghost assassin of living shadow with three steel claws per hand; teleports) ----------

def claw_snikt(f: float = 3300, dur: float = 0.42) -> np.ndarray:
    """Three steel claws springing out of the knuckles at once: a very short metallic scrape up, a
    hard (2 ms) lock click and a thin, slightly detuned triple ring (three blades) that dies fast."""
    n = int(0.07 * SR)
    scr = swept_band(noise(0.07), 2600, 9000, 3.5) * bell_env(n, 0.9, 1.2)
    t = t_axis(dur)
    ring = sum(np.sin(2 * np.pi * f * k * t + ph) for k, ph in ((1.0, 0.0), (1.013, 0.9), (0.988, 2.1)))
    ring = ring + 0.25 * np.sin(2 * np.pi * f * 2.74 * t) * np.exp(-t / 0.04)
    ring = ring * env_ad(len(t), 0.002, dur * 0.28)
    lock = bandpass(noise(0.02), 1500, 6000) * env_ad(int(0.02 * SR), 0.002, 0.004)
    y = mix(0.07 + dur, (scr / (np.max(np.abs(scr)) + 1e-9), 0, 0.45), (lock / (np.max(np.abs(lock)) + 1e-9), 0.065, 0.55),
            (ring / (np.max(np.abs(ring)) + 1e-9), 0.066, 0.5))
    return y / (np.max(np.abs(y)) + 1e-9)


def ghost_moan(dur: float, f: float = 98.0, rise: float = 1.12, air: float = 0.6) -> np.ndarray:
    """A hollow, airy ghost breath: a low, slowly bending tone through a dark vowel formant, wrapped
    in breathy band noise that swells and fades (no words, no scream)."""
    t = t_axis(dur)
    fr = f * np.geomspace(1.0, rise, len(t)) * (1 + 0.012 * np.sin(2 * np.pi * 4.6 * t))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    tone = np.sin(ph) + 0.5 * np.sin(2 * ph + 0.3) + 0.25 * np.sin(3 * ph + 1.0)
    tone = bandpass(tone, 120, 900, 2)
    breath = bandpass(noise(dur), 300, 2400, 2)
    y = tone / (np.max(np.abs(tone)) + 1e-9) * (1 - air) + breath / (np.max(np.abs(breath)) + 1e-9) * air
    y *= bell_env(len(t), 0.4, 1.3)
    return y / (np.max(np.abs(y)) + 1e-9)


def void_suck(dur: float = 0.38) -> np.ndarray:
    """Air rushing INTO a point (the ghost folding into nothing): a reversed-feeling swell, a band
    sweeping up and narrowing, cut off clean at the end by a soft 4 ms fade."""
    n = int(dur * SR)
    x = swept_band(noise(dur), 300, 4200, 2.5)
    e = np.linspace(0, 1, n) ** 2.6
    e[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
    y = x / (np.max(np.abs(x)) + 1e-9) * e
    return y / (np.max(np.abs(y)) + 1e-9)


def void_pop(f0: float = 160, f1: float = 45) -> np.ndarray:
    """The ghost reappearing: a deep, soft implosion thump with a short dark noise puff (2 ms attack)."""
    body = sweep_tone(0.35, f0, f1, "sine", 0.09, 0.002)
    puff = lowpass(noise(0.25), 1400) * env_ad(int(0.25 * SR), 0.002, 0.05)
    y = mix(0.36, (body, 0, 0.9), (puff / (np.max(np.abs(puff)) + 1e-9), 0, 0.4))
    return y / (np.max(np.abs(y)) + 1e-9)


def midos_select() -> np.ndarray:
    # A cold ghost breath, then the claws spring out (the 'snikt'), in a hollow, dark space.
    y = mix(1.0, (ghost_moan(0.7, 92, 1.08, 0.7), 0, 0.42), (claw_snikt(3300, 0.45), 0.24, 0.75))
    return finish(room(y, 0.7, 0.18, 0.012, 5500, 0.25))


def midos_move() -> np.ndarray:
    # A low ghost glide: a soft rising-then-falling whoosh of shadow and a breathy tail, no steps.
    y = mix(0.8, (whoosh(0.5, 260, 1800, 1.3, 0.5), 0, 0.6), (ghost_moan(0.55, 104, 0.92, 0.85), 0.06, 0.32),
            (cloak_swish(0.24), 0.1, 0.22))
    return finish(room(y, 0.6, 0.15, 0.01, 5000, 0.2))


def midos_capture() -> np.ndarray:
    # Three claws raking through the target in quick succession (each a little higher), a steel
    # 'tsing' on the last cut and a deep void thump as the shadow swallows the victim.
    y = silence(1.0)
    for k, (f0, f1, g) in enumerate(((1300, 6200, 0.7), (1500, 6900, 0.75), (1700, 7600, 0.85))):
        place(y, blade_whoosh(0.1, f0, f1), 0.02 + 0.06 * k, g)
    t = t_axis(0.35)
    tsing = (np.sin(2 * np.pi * 3400 * t) + 0.5 * np.sin(2 * np.pi * 3440 * t + 1.0)) * env_ad(len(t), 0.002, 0.1)
    place(y, tsing / (np.max(np.abs(tsing)) + 1e-9), 0.17, 0.3)
    place(y, void_pop(150, 42), 0.18, 0.75)
    place(y, ghost_moan(0.45, 86, 0.85, 0.8), 0.25, 0.22)
    return finish(saturate(room(y, 0.6, 0.13, 0.01, 6000, 0.25), 1.3))


def midos_skill() -> np.ndarray:
    # "그림자 도약": the ghost folds into nothing (air rushing in), a beat of silence-ish shimmer,
    # then he bursts out elsewhere (a deep void pop) and the claws spring out.
    y = silence(1.5)
    place(y, ghost_moan(0.5, 110, 0.8, 0.75), 0.0, 0.3)
    place(y, void_suck(0.38), 0.0, 0.8)
    place(y, lowpass(chime(1244.5, 0.5, 0.2), 6000), 0.36, 0.12)
    place(y, void_pop(170, 40), 0.62, 1.0)
    place(y, whoosh(0.3, 2600, 500, 1.6, 0.2), 0.6, 0.35)
    place(y, claw_snikt(3500, 0.42), 0.8, 0.6)
    return finish(room(y, 0.8, 0.2, 0.012, 5500, 0.3))


SFX = {
    "sad-select": sad_select,
    "sad-move": sad_move,
    "sad-capture": sad_capture,
    "sad-skill": sad_skill,
    "marki-select": marki_select,
    "marki-move": marki_move,
    "marki-capture": marki_capture,
    "marki-skill": marki_skill,
    "walk-select": walk_select,
    "walk-move": walk_move,
    "walk-capture": walk_capture,
    "walk-skill": walk_skill,
    "insaner-select": insaner_select,
    "insaner-move": insaner_move,
    "insaner-capture": insaner_capture,
    "insaner-skill": insaner_skill,
    "insaner-chain": insaner_chain,
    "death": death,
    # Appended after the originals: the shared rng is consumed in this order, so earlier sounds stay byte-identical.
    "brutile-select": brutile_select,
    "brutile-move": brutile_move,
    "brutile-capture": brutile_capture,
    "brutile-skill": brutile_skill,
    "waste-death": waste_death,
    # 2026-11-04, appended for the same reason. Michelle and Picker have no skill: their trait
    # events (trap-set / trap-sprung, hop-multi) get their own effects instead.
    "michelle-select": michelle_select,
    "michelle-move": michelle_move,
    "michelle-capture": michelle_capture,
    "michelle-trap-set": michelle_trap_set,
    "michelle-trap-sprung": michelle_trap_sprung,
    "picker-select": picker_select,
    "picker-move": picker_move,
    "picker-capture": picker_capture,
    "picker-hop-multi": picker_hop_multi,
    # 2026-11-04, appended after picker for the same reason. Rakaeli's transformed form ("타천") has
    # its own move / capture effects and a revert effect (awake-end); awake-select falls back to select.
    "rakaeli-select": rakaeli_select,
    "rakaeli-move": rakaeli_move,
    "rakaeli-capture": rakaeli_capture,
    "rakaeli-skill": rakaeli_skill,
    "rakaeli-awake-move": rakaeli_awake_move,
    "rakaeli-awake-capture": rakaeli_awake_capture,
    "rakaeli-awake-end": rakaeli_awake_end,
    # 2026-11-05, appended after rakaeli for the same reason. Rampid and Larhen have no active
    # skill (no skill effect); Volkonov's skill is 선율 (the ally move buff).
    "rampid-select": rampid_select,
    "rampid-move": rampid_move,
    "rampid-capture": rampid_capture,
    "larhen-select": larhen_select,
    "larhen-move": larhen_move,
    "larhen-capture": larhen_capture,
    "volkonov-select": volkonov_select,
    "volkonov-move": volkonov_move,
    "volkonov-capture": volkonov_capture,
    "volkonov-skill": volkonov_skill,
    # 2026-11-05, appended after volkonov for the same reason. Verish has no active skill; her trait
    # (piercing straight through every enemy in her lane) has a hop-multi effect for multi-captures.
    "verish-select": verish_select,
    "verish-move": verish_move,
    "verish-capture": verish_capture,
    "verish-hop-multi": verish_hop_multi,
    # 2026-11-06, appended after verish for the same reason. Midos's skill is 그림자 도약 (teleport).
    "midos-select": midos_select,
    "midos-move": midos_move,
    "midos-capture": midos_capture,
    "midos-skill": midos_skill,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name, fn in SFX.items():
        y = fn().astype(np.float32)
        sf.write(os.path.join(a.out, f"{name}.wav"), y, SR, subtype="FLOAT")
        print(f"{name}: {len(y) / SR:.2f}s")


if __name__ == "__main__":
    main()
