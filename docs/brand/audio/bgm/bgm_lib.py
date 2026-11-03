"""
GRID CLASH BGM engine: score data -> FluidSynth stems -> numpy mix/master -> seamless loop.

Pipeline (all offline, deterministic):
  1. A track script builds a `Song`: tempo, bar count and `Part`s holding note/CC events in beats.
  2. Every melodic/drum `Part` is rendered as its own stereo stem through libfluidsynth (ctypes,
     no Python binding needed) with the FluidR3_GM SoundFont (MIT). FluidSynth's own reverb and
     chorus are off; all space comes from our convolution reverbs, so every track shares one room.
  3. Synthesised layers (`Synth` parts: sub booms, anvil strikes, noise swells, wind beds) are
     plain numpy, original to this project.
  4. Stems are EQ'd, panned, summed with send reverbs, glued, limited and loudness-normalised.

Seamless loop construction:
  - The loop is `bars` bars long, L samples, L a multiple of 1024 (the AAC frame, and so of
    FluidSynth's 64-sample block; the tempo is nudged by < 0.02 % for this), and every event time is
    snapped to the 64-sample grid. FluidSynth therefore renders the identical
    sample-exact performance in each cycle.
  - The score is rendered four times back to back (cycles 0-3) and all processing (reverb,
    compression, limiting) runs on that continuous signal. Cycle 2 is cut out, so its start already
    contains cycle 1's ringing tails and reverb, exactly as the loop's own end will feed it (two
    warm-up cycles: very long bell releases interact with the next strike, so cycle 1 can still
    differ from cycle 2 by about -60 dB; cycle 2 is converged).
  - The shipped file is [PAD of audio before cycle 1][cycle 1][PAD after cycle 1]. The player loops
    the region [PAD, PAD + L]. The guard pads make the loop immune to AAC encoder priming/padding:
    if a decoder keeps the priming samples, both loop points shift by the same amount inside
    periodic material and the loop is still seamless.
"""
from __future__ import annotations

import ctypes
import math
import random
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from scipy import signal

SR = 48000
BLOCK = 64
AAC_FRAME = 1024
PAD = 24 * AAC_FRAME  # guard pad on each side of the loop region (24576 samples = 0.512 s)
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'

# SoundFont 2.01 generator ids (fluid_synth_set_gen).
GEN_FILTERFC = 8
GEN_FILTERQ = 9
GEN_VOLENVATTACK = 34
GEN_VOLENVHOLD = 35
GEN_VOLENVDECAY = 36
GEN_VOLENVSUSTAIN = 37
GEN_VOLENVRELEASE = 38

NOTE_NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def p(name: str) -> int:
    """'C4' -> 60, 'F#2' -> 42, 'Bb3' -> 58."""
    n = NOTE_NAMES[name[0]]
    i = 1
    while i < len(name) and name[i] in '#b':
        n += 1 if name[i] == '#' else -1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def chord(root: str, quality: str = 'm') -> list[int]:
    """Close-position triad/seventh from a root name ('D3', 'm' | 'M' | 'sus4' | 'm7' | '7' | 'dim')."""
    r = p(root)
    iv = {
        'm': [0, 3, 7], 'M': [0, 4, 7], 'sus4': [0, 5, 7], 'sus2': [0, 2, 7], 'm7': [0, 3, 7, 10],
        '7': [0, 4, 7, 10], 'dim': [0, 3, 6], 'M7': [0, 4, 7, 11], 'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14],
        '5': [0, 7], 'aug': [0, 4, 8],
    }[quality]
    return [r + i for i in iv]


# ---------------------------------------------------------------------------------------------
# Score model
# ---------------------------------------------------------------------------------------------


@dataclass
class Part:
    """One instrument stem. Times are in beats from the loop start."""

    name: str
    program: int = 0
    bank: int = 0
    drum: bool = False
    gens: dict[int, float] = field(default_factory=dict)
    gain_db: float = 0.0
    pan: float = 0.0  # -1 left .. +1 right (equal-power, applied in the mix)
    width: float = 1.0  # stereo width of the rendered stem (0 = mono)
    hall: float = 0.25  # send level into the shared hall reverb
    room: float = 0.0  # send level into the shared short room
    hp: float | None = 40.0  # high-pass corner (Hz)
    lp: float | None = None  # low-pass corner (Hz)
    tilt_db: float = 0.0  # +/- high shelf at 3 kHz
    humanize: float = 0.006  # timing jitter in beats (seeded, identical every cycle)
    notes: list[tuple[float, int, float, int]] = field(default_factory=list)
    ccs: list[tuple[float, int, int]] = field(default_factory=list)

    def n(self, beat: float, key: int | str, dur: float, vel: int = 90) -> 'Part':
        k = p(key) if isinstance(key, str) else key
        self.notes.append((beat, k, dur, max(1, min(127, int(vel)))))
        return self

    def ch(self, beat: float, keys: list[int], dur: float, vel: int = 80, spread: float = 0.0) -> 'Part':
        for i, k in enumerate(keys):
            self.n(beat + i * spread, k, dur, vel)
        return self

    def cc(self, beat: float, num: int, val: int) -> 'Part':
        self.ccs.append((beat, num, max(0, min(127, int(val)))))
        return self

    def ramp(self, b0: float, b1: float, num: int, v0: int, v1: int, step: float = 0.125, curve: float = 1.0) -> 'Part':
        """Linear (curve=1) or eased CC ramp from b0 to b1 inclusive."""
        steps = max(1, int(round((b1 - b0) / step)))
        for i in range(steps + 1):
            x = i / steps
            self.cc(b0 + (b1 - b0) * x, num, round(v0 + (v1 - v0) * (x ** curve)))
        return self


@dataclass
class Synth:
    """A numpy-synthesised layer: fn(n_samples, hits_in_samples) -> (2, n) float array."""

    name: str
    fn: Callable[[int, list[tuple[int, float, float]]], np.ndarray]
    hits: list[tuple[float, float, float]] = field(default_factory=list)  # (beat, param, vel 0..1)
    gain_db: float = 0.0
    pan: float = 0.0
    hall: float = 0.2
    room: float = 0.0
    hp: float | None = None
    lp: float | None = None
    periodic: bool = False  # fn renders exactly one loop period (tiled 3x) instead of using hits

    def hit(self, beat: float, param: float = 0.0, vel: float = 1.0) -> 'Synth':
        self.hits.append((beat, param, vel))
        return self


@dataclass
class Song:
    id: str
    bpm: float
    bars: int
    key: str
    beats_per_bar: int = 4
    parts: list[Part] = field(default_factory=list)
    synths: list[Synth] = field(default_factory=list)
    hall_rt: float = 3.0
    hall_mix: float = 1.0
    master_tilt_db: float = 0.0
    seed: int = 1

    def part(self, *a, **k) -> Part:
        pt = Part(*a, **k)
        self.parts.append(pt)
        return pt

    def synth(self, *a, **k) -> Synth:
        s = Synth(*a, **k)
        self.synths.append(s)
        return s

    @property
    def beats(self) -> int:
        return self.bars * self.beats_per_bar

    @property
    def loop_samples(self) -> int:
        # A multiple of the AAC frame (and so of BLOCK): loopStart and loopEnd then sit at the same
        # frame phase, so the encoder treats the material around both points alike.
        raw = self.beats * 60.0 / self.bpm * SR
        return int(round(raw / AAC_FRAME)) * AAC_FRAME

    @property
    def spb(self) -> float:
        """Samples per beat, adjusted so the loop is an exact multiple of BLOCK samples."""
        return self.loop_samples / self.beats

    def to_sample(self, beat: float) -> int:
        return int(round(beat * self.spb / BLOCK)) * BLOCK


# ---------------------------------------------------------------------------------------------
# FluidSynth (ctypes)
# ---------------------------------------------------------------------------------------------


class Fluid:
    def __init__(self, sf2: str = SF2):
        lib = ctypes.CDLL('libfluidsynth.so.3')
        vp = ctypes.c_void_p
        lib.new_fluid_settings.restype = vp
        lib.new_fluid_synth.restype = vp
        lib.new_fluid_synth.argtypes = [vp]
        lib.fluid_settings_setnum.argtypes = [vp, ctypes.c_char_p, ctypes.c_double]
        lib.fluid_settings_setint.argtypes = [vp, ctypes.c_char_p, ctypes.c_int]
        lib.fluid_synth_sfload.argtypes = [vp, ctypes.c_char_p, ctypes.c_int]
        lib.fluid_synth_program_select.argtypes = [vp, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        lib.fluid_synth_noteon.argtypes = [vp, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        lib.fluid_synth_noteoff.argtypes = [vp, ctypes.c_int, ctypes.c_int]
        lib.fluid_synth_cc.argtypes = [vp, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        lib.fluid_synth_set_gen.argtypes = [vp, ctypes.c_int, ctypes.c_int, ctypes.c_float]
        lib.fluid_synth_system_reset.argtypes = [vp]
        lib.fluid_synth_set_interp_method.argtypes = [vp, ctypes.c_int, ctypes.c_int]
        lib.fluid_synth_all_sounds_off.argtypes = [vp, ctypes.c_int]
        fp = ctypes.POINTER(ctypes.c_float)
        lib.fluid_synth_write_float.argtypes = [vp, ctypes.c_int, fp, ctypes.c_int, ctypes.c_int, fp, ctypes.c_int, ctypes.c_int]
        self.lib = lib
        s = lib.new_fluid_settings()
        lib.fluid_settings_setnum(s, b'synth.sample-rate', float(SR))
        lib.fluid_settings_setint(s, b'synth.reverb.active', 0)
        lib.fluid_settings_setint(s, b'synth.chorus.active', 0)
        lib.fluid_settings_setint(s, b'synth.polyphony', 512)
        lib.fluid_settings_setnum(s, b'synth.gain', 0.4)
        lib.fluid_settings_setint(s, b'synth.cpu-cores', 1)
        self.synth = lib.new_fluid_synth(s)
        self.sfid = lib.fluid_synth_sfload(self.synth, sf2.encode(), 1)
        if self.sfid < 0:
            raise RuntimeError(f'cannot load {sf2}')

    def render(self, part: Part, events: list[tuple[int, int, int, int, int]], n: int) -> np.ndarray:
        """events: (sample, order, kind, a, b) with kind 0=off 1=cc 2=on. Returns (2, n) float32."""
        lib, sy = self.lib, self.synth
        lib.fluid_synth_system_reset(sy)
        ch = 9 if part.drum else 0
        lib.fluid_synth_program_select(sy, ch, self.sfid, 128 if part.drum else part.bank, part.program)
        lib.fluid_synth_set_interp_method(sy, -1, 7)  # 7th-order sinc interpolation
        lib.fluid_synth_cc(sy, ch, 7, 127)
        lib.fluid_synth_cc(sy, ch, 10, 64)
        lib.fluid_synth_cc(sy, ch, 11, 127)
        lib.fluid_synth_cc(sy, ch, 91, 0)
        lib.fluid_synth_cc(sy, ch, 93, 0)
        for g, v in part.gens.items():
            lib.fluid_synth_set_gen(sy, ch, g, float(v))
        L = np.zeros(n, dtype=np.float32)
        R = np.zeros(n, dtype=np.float32)
        fp = ctypes.POINTER(ctypes.c_float)
        lp_, rp_ = L.ctypes.data_as(fp), R.ctypes.data_as(fp)
        pos = 0
        for t, _o, kind, a, b in events:
            t = min(t, n)
            if t > pos:
                lib.fluid_synth_write_float(sy, t - pos, lp_, pos, 1, rp_, pos, 1)
                pos = t
            if kind == 2:
                lib.fluid_synth_noteon(sy, ch, a, b)
            elif kind == 0:
                lib.fluid_synth_noteoff(sy, ch, a)
            else:
                lib.fluid_synth_cc(sy, ch, a, b)
        if pos < n:
            lib.fluid_synth_write_float(sy, n - pos, lp_, pos, 1, rp_, pos, 1)
        lib.fluid_synth_all_sounds_off(sy, -1)
        return np.stack([L, R]).astype(np.float64)


def part_events(song: Song, part: Part, cycles: int) -> list[tuple[int, int, int, int, int]]:
    """Expand a part over `cycles` loop repetitions on the 64-sample grid (identical each cycle)."""
    rng = random.Random(f'{song.seed}:{part.name}')
    Ls = song.loop_samples
    base: list[tuple[int, int, int, int, int]] = []
    # Note-on/off with per-note seeded jitter; overlapping same-key notes are truncated.
    notes = sorted(part.notes)
    jit = [rng.uniform(-1, 1) * part.humanize for _ in notes]
    per_key_end: dict[int, int] = {}
    ons = []
    for (beat, key, dur, vel), j in zip(notes, jit):
        t0 = song.to_sample(beat + (j if beat > 0 else abs(j)))
        t1 = max(t0 + BLOCK, song.to_sample(beat + dur + j * 0.5))
        ons.append([t0, t1, key, vel])
    ons.sort()
    for i, (t0, t1, key, vel) in enumerate(ons):
        # Truncate this note if the same key restarts before it ends.
        for t0b, _t1b, keyb, _vb in ons[i + 1:]:
            if keyb == key and t0b < t1:
                t1 = max(t0 + BLOCK, t0b - BLOCK)
                break
        base.append((t0, 2, 2, key, vel))
        base.append((t1, 0, 0, key, 0))
        per_key_end[key] = t1
    for beat, num, val in part.ccs:
        base.append((song.to_sample(beat), 1, 1, num, val))
    out = []
    for c in range(cycles):
        for t, o, k, a, b in base:
            out.append((t + c * Ls, o, k, a, b))
    out.sort()
    return out


# ---------------------------------------------------------------------------------------------
# DSP helpers
# ---------------------------------------------------------------------------------------------


def butter(x: np.ndarray, kind: str, f: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f / (SR / 2), btype=kind, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def shelf(x: np.ndarray, f: float, gain_db: float, high: bool = True) -> np.ndarray:
    """RBJ shelving biquad (S=1)."""
    if abs(gain_db) < 1e-3:
        return x
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / 2 * math.sqrt(2)
    sa = 2 * math.sqrt(A) * alpha
    if high:
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    else:
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


def peaking(x: np.ndarray, f: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f / SR
    alpha = math.sin(w0) / (2 * q)
    cw = math.cos(w0)
    b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
    a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


def pan_width(x: np.ndarray, pan: float, width: float) -> np.ndarray:
    m = (x[0] + x[1]) * 0.5
    s = (x[0] - x[1]) * 0.5 * width
    l, r = m + s, m - s
    th = (pan + 1) * math.pi / 4
    return np.stack([l * math.cos(th) * math.sqrt(2), r * math.sin(th) * math.sqrt(2)])


def make_ir(rt60: float, seconds: float, seed: int, predelay: float = 0.018, bright: float = 1.0,
            er: bool = True) -> np.ndarray:
    """Synthetic stereo hall IR: sparse early reflections + decorrelated, frequency-dependent tail."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    bands = [(20, 250, 1.15), (250, 1000, 1.0), (1000, 3500, 0.78), (3500, 8000, 0.55 * bright), (8000, 16000, 0.35 * bright)]
    for ch in range(2):
        tail = np.zeros(n)
        for lo, hi, rtk in bands:
            nz = rng.standard_normal(n)
            sos = signal.butter(2, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], btype='band', output='sos')
            nz = signal.sosfilt(sos, nz)
            rt = rt60 * rtk
            tail += nz * np.exp(-6.91 * t / rt)
        # Soft onset of the diffuse tail (builds over ~60 ms).
        tail *= 1 - np.exp(-t / 0.025)
        pd = int(predelay * SR)
        tail = np.concatenate([np.zeros(pd), tail[: n - pd]])
        if er:
            for _ in range(14):
                d = rng.uniform(0.006, 0.075)
                i = int((predelay * 0.4 + d) * SR)
                if i < n:
                    tail[i] += rng.choice([-1, 1]) * rng.uniform(0.25, 0.7) * math.exp(-d / 0.05) * 6
        out[ch] = tail
    out /= np.sqrt(np.sum(out ** 2) / 2)
    return out


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    y = np.stack([signal.oaconvolve(x[c], ir[c], mode='full')[: x.shape[1]] for c in range(2)])
    return y


def env_follow(level: np.ndarray, attack: float, release: float) -> np.ndarray:
    """One-pole attack/release follower (vectorised in two passes is not exact; use decimated loop)."""
    hop = 32
    lv = level[: len(level) // hop * hop].reshape(-1, hop).max(axis=1)
    out = np.empty_like(lv)
    a = math.exp(-hop / (attack * SR))
    r = math.exp(-hop / (release * SR))
    e = lv[0]
    for i, v in enumerate(lv):
        e = a * e + (1 - a) * v if v > e else r * e + (1 - r) * v
        out[i] = e
    full = np.repeat(out, hop)
    if len(full) < len(level):
        full = np.concatenate([full, np.full(len(level) - len(full), full[-1])])
    return full


def glue(x: np.ndarray, thresh_db: float = -18, ratio: float = 2.0, attack: float = 0.03, release: float = 0.3) -> np.ndarray:
    """Gentle RMS-ish bus compressor."""
    lvl = np.sqrt(signal.lfilter([1 - 0.999], [1, -0.999], (x ** 2).mean(axis=0)) + 1e-12)
    env = env_follow(lvl, attack, release)
    db = 20 * np.log10(env + 1e-12)
    over = np.maximum(0, db - thresh_db)
    gain = 10 ** (-over * (1 - 1 / ratio) / 20)
    return x * gain


def true_peak(x: np.ndarray) -> float:
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return float(np.max(np.abs(up)))


def limiter(x: np.ndarray, ceiling_db: float = -1.5, lookahead: float = 0.004, release: float = 0.12) -> np.ndarray:
    """Look-ahead peak limiter on a 4x-oversampled detector (true-peak aware)."""
    ceil = 10 ** (ceiling_db / 20)
    up = signal.resample_poly(x, 4, 1, axis=-1)
    pk = np.abs(up).max(axis=0).reshape(-1, 4).max(axis=1)[: x.shape[1]]
    if len(pk) < x.shape[1]:
        pk = np.concatenate([pk, np.zeros(x.shape[1] - len(pk))])
    la = int(lookahead * SR)
    # Required gain, held over the look-ahead window.
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    from scipy.ndimage import minimum_filter1d
    held = minimum_filter1d(need, size=2 * la + 1, mode='nearest')
    # Smooth: instant down (already held), exponential release up.
    hop = 16
    hv = held[: len(held) // hop * hop].reshape(-1, hop).min(axis=1)
    g = np.empty_like(hv)
    r = math.exp(-hop / (release * SR))
    e = 1.0
    for i, v in enumerate(hv):
        e = v if v < e else r * e + (1 - r) * v
        g[i] = e
    gf = np.repeat(g, hop)
    if len(gf) < x.shape[1]:
        gf = np.concatenate([gf, np.full(x.shape[1] - len(gf), gf[-1])])
    gf = signal.lfilter([1 - 0.9], [1, -0.9], gf)  # tiny ripple smoothing
    gf = np.minimum(gf, held)
    return x * gf


# ---------------------------------------------------------------------------------------------
# Synthesised layers (original to this project)
# ---------------------------------------------------------------------------------------------


def place(n: int, hits: list[tuple[int, float, float]], make: Callable[[float, float], np.ndarray]) -> np.ndarray:
    out = np.zeros((2, n))
    cache: dict[tuple[float, float], np.ndarray] = {}
    for t, prm, vel in hits:
        key = (prm, round(vel, 3))
        if key not in cache:
            cache[key] = make(prm, vel)
        s = cache[key]
        e = min(n, t + s.shape[1])
        if t < n:
            out[:, t:e] += s[:, : e - t]
    return out


def sub_boom(n: int, hits: list[tuple[int, float, float]]) -> np.ndarray:
    """Pitch-dropping sine thump that sits under taiko hits (param = start Hz, 0 -> 68)."""
    def mk(f0: float, vel: float) -> np.ndarray:
        f0 = f0 or 68.0
        d = int(0.9 * SR)
        t = np.arange(d) / SR
        f = 38 + (f0 - 38) * np.exp(-t / 0.07)
        ph = 2 * np.pi * np.cumsum(f) / SR
        a = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.28)
        y = np.sin(ph) * a * vel
        return np.stack([y, y])
    return place(n, hits, mk)


def anvil(n: int, hits: list[tuple[int, float, float]]) -> np.ndarray:
    """Modal anvil/hammer strike: inharmonic partials + a short filtered click (param = f0 Hz)."""
    rng = np.random.default_rng(7)

    def mk(f0: float, vel: float) -> np.ndarray:
        f0 = f0 or 740.0
        d = int(2.2 * SR)
        t = np.arange(d) / SR
        ratios = [1.0, 2.32, 4.25, 6.63, 9.38]
        decays = [1.1, 0.55, 0.32, 0.18, 0.1]
        amps = [1.0, 0.55, 0.35, 0.18, 0.08]
        y = np.zeros((2, d))
        for i, (r, dc, am) in enumerate(zip(ratios, decays, amps)):
            for c, det in enumerate((1.0, 1.0016)):
                y[c] += am * np.sin(2 * np.pi * f0 * r * det * t + i) * np.exp(-t / (dc * (0.6 + 0.4 * vel)))
        click = rng.standard_normal(int(0.012 * SR)) * np.exp(-np.arange(int(0.012 * SR)) / (0.002 * SR))
        click = signal.sosfilt(signal.butter(2, [1500 / (SR / 2), 6000 / (SR / 2)], 'band', output='sos'), click)
        y[:, : len(click)] += click * 0.6
        y *= (1 - np.exp(-t / 0.0008))
        y = signal.sosfilt(signal.butter(2, 7000 / (SR / 2), output='sos'), y, axis=-1)
        return y * vel * 0.5
    return place(n, hits, mk)


def swell(n: int, hits: list[tuple[int, float, float]]) -> np.ndarray:
    """Reverse-cymbal-like noise swell that peaks at its hit time (param = length in seconds)."""
    def mk(length: float, vel: float) -> np.ndarray:
        # Noise seeded by the hit's shape only: every cycle of the loop gets the identical swell.
        length = length or 2.0
        rng = np.random.default_rng(int(length * 1000) * 131 + int(vel * 1000))
        d = int(length * SR)
        nz = rng.standard_normal((2, d))
        nz = signal.sosfilt(signal.butter(2, [900 / (SR / 2), 9000 / (SR / 2)], 'band', output='sos'), nz, axis=-1)
        x = np.linspace(0, 1, d)
        env = x ** 3.2
        return nz * env * vel * 0.35
    out = np.zeros((2, n))
    for t, prm, vel in hits:
        s = mk(prm, vel)
        a = t - s.shape[1]
        b = t
        if a < 0:
            s = s[:, -a:]
            a = 0
        out[:, a:b] += s[:, : b - a]
    return out


def periodic_noise(n: int, lo: float, hi: float, seed: int, tilt: float = -1.0) -> np.ndarray:
    """Exactly n-periodic stereo band-limited noise built in the frequency domain (loops perfectly)."""
    rng = np.random.default_rng(seed)
    out = []
    f = np.fft.rfftfreq(n, 1 / SR)
    mag = np.where((f >= lo) & (f <= hi), 1.0, 0.0)
    # Soft band edges.
    mag = signal.convolve(mag, np.hanning(401) / np.hanning(401).sum(), mode='same')
    mag *= np.where(f > 0, (np.maximum(f, 1) / 1000.0) ** (tilt / 2), 0)
    for _ in range(2):
        ph = rng.uniform(0, 2 * np.pi, len(f))
        spec = mag * np.exp(1j * ph)
        y = np.fft.irfft(spec, n)
        out.append(y / (np.std(y) + 1e-12))
    return np.stack(out)


def periodic_lfo(n: int, cycles: int, phase: float = 0.0) -> np.ndarray:
    """0..1 raised-cosine LFO with an integer number of cycles per loop."""
    t = np.arange(n) / n
    return 0.5 - 0.5 * np.cos(2 * np.pi * (cycles * t) + phase)


def wind_bed(lo: float, hi: float, seed: int, cycles: int = 3) -> Callable[[int, list], np.ndarray]:
    def fn(n: int, _hits: list) -> np.ndarray:
        nz = periodic_noise(n, lo, hi, seed)
        m = 0.35 + 0.65 * periodic_lfo(n, cycles)
        m2 = 0.5 + 0.5 * periodic_lfo(n, cycles * 2 + 1, 1.3)
        return nz * np.stack([m * (0.7 + 0.3 * m2), m * (1.0 - 0.3 * m2)]) * 0.05
    return fn


# ---------------------------------------------------------------------------------------------
# Render + mix
# ---------------------------------------------------------------------------------------------

CYCLES = 4  # render cycles 0..3 and keep cycle 2: long bell/organ releases have fully converged
KEEP = 2
LP_SCALE = 1.4  # all stem low-pass corners are scaled by this (one knob for overall air)


def render_song(song: Song, fluid: Fluid, verbose: bool = True) -> tuple[np.ndarray, dict]:
    """Returns (loop_with_pads (2, PAD+L+PAD), info) mastered and loudness-normalised."""
    import pyloudnorm

    Ls = song.loop_samples
    n = Ls * CYCLES + int(SR * 1.0)
    hall_ir = make_ir(song.hall_rt, min(6.0, song.hall_rt * 1.8), seed=101, predelay=0.024)
    room_ir = make_ir(0.9, 1.6, seed=202, predelay=0.006, bright=0.9)
    dry = np.zeros((2, n))
    hall_send = np.zeros((2, n))
    room_send = np.zeros((2, n))
    stems = {}

    meter = pyloudnorm.Meter(SR)

    def post(x: np.ndarray, hp, lp, tilt, gain_db, pan, width) -> np.ndarray:
        if hp:
            x = butter(x, 'highpass', hp, 2)
        if lp:
            x = butter(x, 'lowpass', min(lp * LP_SCALE, SR / 2 - 2000), 2)
        if tilt:
            x = shelf(x, 3000, tilt, True)
        x = pan_width(x, pan, width)
        # Stem loudness normalisation: gain_db is the stem's loudness relative to -20 LUFS
        # (gated integrated loudness of cycle 1, so sparse parts are measured where they play).
        lu = meter.integrated_loudness(x[:, KEEP * Ls: (KEEP + 1) * Ls].T)
        if np.isfinite(lu):
            x = x * 10 ** ((-20.0 - lu) / 20)
        return x * 10 ** (gain_db / 20)

    for pt in song.parts:
        ev = part_events(song, pt, CYCLES)
        x = fluid.render(pt, ev, n)
        x = post(x, pt.hp, pt.lp, pt.tilt_db, pt.gain_db, pt.pan, pt.width)
        stems[pt.name] = x
        dry += x
        hall_send += x * pt.hall
        room_send += x * pt.room
        if verbose:
            print(f'  {pt.name:12s} notes={len(pt.notes):4d} peak={np.abs(x).max():.3f}')
    for sy in song.synths:
        if sy.periodic:
            one = sy.fn(Ls, [])
            x = np.concatenate([np.tile(one, (1, CYCLES)), one[:, : n - Ls * CYCLES]], axis=1)
        else:
            hits = []
            for c in range(CYCLES):
                for beat, prm, vel in sy.hits:
                    hits.append((song.to_sample(beat) + c * Ls, prm, vel))
            x = sy.fn(n, hits)
        x = post(x, sy.hp, sy.lp, 0.0, sy.gain_db, sy.pan, 1.0)
        stems[sy.name] = x
        dry += x
        hall_send += x * sy.hall
        room_send += x * sy.room
        if verbose:
            print(f'  {sy.name:12s} (synth) peak={np.abs(x).max():.3f}')

    wet_h = convolve(butter(hall_send, 'highpass', 160, 2), hall_ir) * song.hall_mix
    wet_r = convolve(butter(room_send, 'highpass', 120, 2), room_ir)
    mix = dry + wet_h + wet_r
    # Master tone (phone speakers, sits under voice): soften the 2.8 kHz honk of sampled brass,
    # open the top, and trim sub energy a phone cannot play anyway.
    mix = peaking(mix, 2800, -1.0, 1.2)
    mix = shelf(mix, 4000, 3.5 + song.master_tilt_db, True)
    mix = shelf(mix, 90, -3.0, False)
    mix = butter(mix, 'highpass', 32, 2)
    # Pre-normalise, glue, limit.
    mix /= np.abs(mix).max() + 1e-9
    mix *= 10 ** (-6 / 20)
    mix = glue(mix, thresh_db=-22, ratio=1.8)
    # Cut cycle KEEP with pads (all stateful processing has settled by then).
    a = KEEP * Ls - PAD
    b = (KEEP + 1) * Ls + PAD
    seg = mix[:, a:b].copy()
    loop = seg[:, PAD: PAD + Ls]
    lufs = meter.integrated_loudness(loop.T)
    target = -20.0
    seg *= 10 ** ((target - lufs) / 20)
    # Limit using the full 3-cycle context would be ideal; the limiter is short-memory (120 ms),
    # so limiting the padded segment is periodic inside the loop region except within 120 ms of
    # the outer pad edges, which are never played.
    seg = limiter(seg, ceiling_db=-1.6)
    loop = seg[:, PAD: PAD + Ls]
    lufs2 = meter.integrated_loudness(loop.T)
    seg *= 10 ** ((target - lufs2) / 20)
    info = {
        'loop_samples': Ls,
        'loop_seconds': Ls / SR,
        'lufs_pre_limit': lufs,
        'true_peak_dbtp': 20 * math.log10(true_peak(seg[:, PAD: PAD + Ls]) + 1e-12),
    }
    return seg, info
