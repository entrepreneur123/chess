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
