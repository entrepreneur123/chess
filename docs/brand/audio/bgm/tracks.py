"""
GRID CLASH scores (original compositions, 2026): one function per arena, plus the lobby/home theme,
returns a `Song`.

Shared production family:
  - The "Clash" leitmotif (MOTIF below), a four-bar minor-mode phrase that every arena quotes on a
    different lead voice (horn, low brass, shakuhachi, horns+choir, organ, brass tutti).
  - The same hall and room convolution reverbs, mastering chain and loudness target.
  - Taiko + synthesised sub boom as the percussion core, with arena-specific colour on top.
  - Every loop ends on a dominant or Phrygian bII so the jump back to bar 1 resolves.

Time unit: beats (quarter notes). `B(bar, beat)` uses 1-indexed bars.
"""
from __future__ import annotations

import itertools
import random

from bgm_lib import (
    GEN_FILTERFC,
    GEN_VOLENVATTACK,
    GEN_VOLENVRELEASE,
    Part,
    Song,
    anvil,
    p,
    sub_boom,
    swell,
    wind_bed,
)


def B(bar: float, beat: float = 0.0) -> float:
    return (bar - 1) * 4 + beat


# The Clash leitmotif: (beat offset, semitones from tonic, duration). Four bars, over i | i | bVI | V.
MOTIF = [
    (0, 0, 1.5), (1.5, 7, 0.5), (2, 8, 2.0),
    (4, 7, 1.0), (5, 5, 1.0), (6, 3, 2.0),
    (8, 8, 1.5), (9.5, 7, 0.5), (10, 5, 1.0), (11, 3, 1.0),
    (12, 2, 3.5),
]
# Answer phrase (second four bars): rises instead of falling, ends on the leading tone / 5th.
MOTIF_B = [
    (0, 0, 1.5), (1.5, 7, 0.5), (2, 8, 2.0),
    (4, 10, 1.0), (5, 8, 1.0), (6, 7, 2.0),
    (8, 8, 1.0), (9, 7, 1.0), (10, 5, 1.0), (11, 3, 1.0),
    (12, 7, 3.5),
]

QUAL = {
    '': [0, 4, 7], 'm': [0, 3, 7], 'sus4': [0, 5, 7], 'sus2': [0, 2, 7], 'maj7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], '7': [0, 4, 7, 10], 'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], 'dim': [0, 3, 6],
    '5': [0, 7], 'm6': [0, 3, 7, 9], 'maj7#11': [0, 4, 7, 11, 18],
}


def parse(ch: str) -> tuple[int, list[int]]:
    """'F#m' -> (6, [0,3,7]); root pitch class and intervals."""
    r = ch[0]
    i = 1
    if len(ch) > 1 and ch[1] in '#b':
        i = 2
    pc = p(ch[:i] + '0') % 12
    return pc, QUAL[ch[i:]]


def voice(prev: list[int] | None, ch: str, lo: int, hi: int, n: int = 4) -> list[int]:
    """Smooth voice leading: choose n notes in [lo, hi] covering the chord, nearest to prev."""
    pc, iv = parse(ch)
    pcs = [(pc + x) % 12 for x in iv]
    # Always include root, third (or sus), fifth; double root for 4 voices of a triad.
    want = pcs[:]
    while len(want) < n:
        want.append(pcs[0])
    want = want[:n] if len(pcs) <= n else pcs[:n]
    opts = [[k for k in range(lo, hi + 1) if k % 12 == q] for q in want]
    best, bc = None, 1e9
    for combo in itertools.product(*opts):
        s = sorted(combo)
        if len(set(s)) < len(s) or s[-1] - s[0] > 19:
            continue
        if prev:
            cost = sum(abs(a - b) for a, b in zip(s, sorted(prev)))
        else:
            cost = abs(sum(s) / len(s) - (lo + hi) / 2) * 2
        # Prefer spread over clusters in the bass.
        gaps = [b - a for a, b in zip(s, s[1:])]
        if gaps and min(gaps) < 3 and s[0] < 55:
            cost += 4
        if cost < bc:
            best, bc = s, cost
    return best or [pc + 48]


def root_note(ch: str, lo: int) -> int:
    pc, _ = parse(ch)
    k = lo
    while k % 12 != pc:
        k += 1
    return k


def pads(part: Part, prog: list[str], start_bar: int, vel: int, lo: int, hi: int, n: int = 4,
         bars_per: float = 1.0, legato: float = 0.3, vel_jit: int = 6, seed: int = 0) -> None:
    """Sustained chords with smooth voice leading; common tones are tied, not re-struck."""
    rng = random.Random(seed)
    prev = None
    open_: dict[int, int] = {}  # key -> index into part.notes of the note still sounding
    for i, chname in enumerate(prog):
        vs = voice(prev, chname, lo, hi, n)
        prev = vs
        b0 = B(start_bar) + i * 4 * bars_per
        nxt: dict[int, int] = {}
        for k in vs:
            if k in open_:
                j = open_[k]
                beat, key, dur, v = part.notes[j]
                part.notes[j] = (beat, key, b0 + 4 * bars_per + legato - beat, v)
                nxt[k] = j
            else:
                part.n(b0, k, 4 * bars_per + legato, vel + rng.randint(-vel_jit, vel_jit))
                nxt[k] = len(part.notes) - 1
        open_ = nxt


def bassline(part: Part, prog: list[str], start_bar: int, pattern: list[tuple[float, int, float, int]], lo: int) -> None:
    """pattern: (beat, semitone offset from root, dur, vel) per bar."""
    for i, chname in enumerate(prog):
        r = root_note(chname, lo)
        for beat, off, dur, vel in pattern:
            part.n(B(start_bar + i, beat), r + off, dur, vel)


def arp(part: Part, prog: list[str], start_bar: int, order: list[int], step: float, vel: int, lo: int,
        dur: float = 1.5, accent: int = 10, seed: int = 0, octaves: int = 2) -> None:
    rng = random.Random(seed)
    for i, chname in enumerate(prog):
        pc, iv = parse(chname)
        r = root_note(chname, lo)
        tones = []
        for o in range(octaves + 1):
            tones += [r + x + 12 * o for x in iv if x < 12]
        nsteps = int(4 / step)
        for s in range(nsteps):
            idx = order[s % len(order)]
            if idx < 0:
                continue
            v = vel + (accent if s % 4 == 0 else 0) + rng.randint(-5, 5)
            part.n(B(start_bar + i, s * step), tones[min(idx, len(tones) - 1)], dur, v)


def motif(part: Part, start_bar: int, tonic: int, phrase=MOTIF, vel: int = 85, swell_cc: bool = False,
          octave_double: bool = False, rng_seed: int = 0) -> None:
    rng = random.Random(rng_seed)
    for beat, semi, dur in phrase:
        v = vel + rng.randint(-4, 4) + (6 if dur >= 2 else 0)
        part.n(B(start_bar, beat), tonic + semi, dur + 0.05, v)
        if octave_double:
            part.n(B(start_bar, beat), tonic + semi + 12, dur + 0.05, v - 12)


def swing(phrase):
    """Move off-beat 8ths (x.5) onto the last triplet of the beat (x.667), for 12/8 grooves."""
    def m(t: float) -> float:
        whole = int(t)
        return whole + 2 / 3 if abs(t - whole - 0.5) < 1e-9 else t
    return [(m(b), s_, m(b + d) - m(b)) for b, s_, d in phrase]


def cc_section(part: Part, start_bar: int, end_bar: int, lo: int, hi: int, fade_in: float = 4, fade_out: float = 4) -> None:
    """CC11 envelope for a section: lo -> hi over fade_in beats, hold, hi -> lo over fade_out beats."""
    a = B(start_bar)
    b = B(end_bar + 1)
    part.cc(a, 11, lo)
    part.ramp(a, a + fade_in, 11, lo, hi)
    part.ramp(b - fade_out, b - 0.125, 11, hi, lo)


def taiko_hits(part: Part, boom, bar: int, pattern: list[tuple[float, str | int, int]], boom_vel: float = 0.0) -> None:
    for beat, key, vel in pattern:
        part.n(B(bar, beat), key, 1.5, vel)
        if boom is not None and boom_vel and vel >= 95:
            boom.hit(B(bar, beat), 0.0, boom_vel * vel / 127)


SLOW = {GEN_VOLENVATTACK: 11400, GEN_VOLENVRELEASE: 1200}
SLOWER = {GEN_VOLENVATTACK: 12000, GEN_VOLENVRELEASE: 1800}
SOFT_RELEASE = {GEN_VOLENVRELEASE: 1200}


# =============================================================================================
# 1. moonrune: D minor, 84 BPM, 24 bars. Low strings, harp, soft taiko; tense but calm.
# =============================================================================================


def moonrune() -> Song:
    s = Song('moonrune', 84, 24, 'D minor', hall_rt=3.4, seed=11)
    A = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'C', 'A']
    Bp = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Gm', 'Bb', 'A']
    C = ['Bb', 'F', 'Gm', 'Dm', 'Bb', 'Gm', 'Asus4', 'A']
    prog = A + Bp + C

    pad = s.part('pad', 49, gens={GEN_VOLENVATTACK: 2400, GEN_VOLENVRELEASE: 1500}, gain_db=-4, width=1.3, hall=0.45, hp=90, lp=6000)
    pads(pad, prog, 1, 62, 50, 72, 4, seed=1)
    pad.cc(0, 11, 100)

    cello = s.part('cello', 42, gens=SOFT_RELEASE, gain_db=-7, pan=-0.25, hall=0.3, hp=55, lp=3500)
    # Calm pulse: dotted figure on the root, rising to the fifth.
    pat = [(0, 0, 0.7, 72), (0.75, 0, 0.6, 52), (1.5, 7, 0.45, 58), (2, 0, 0.7, 66), (2.75, 0, 0.6, 50), (3.5, 12, 0.45, 56)]
    bassline(cello, A, 1, [(b, o, d, v - 8) for b, o, d, v in pat], 38)
    bassline(cello, Bp, 9, pat, 38)
    bassline(cello, C, 17, [(0, 0, 1.9, 60), (2, 7, 1.9, 54)], 38)

    cb = s.part('contrabass', 43, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1500}, gain_db=-9, hall=0.2, hp=30, lp=1200)
    bassline(cb, prog, 1, [(0, 0, 4.2, 70)], 26)

    harp = s.part('harp', 46, gain_db=-6, pan=0.3, width=1.2, hall=0.55, hp=120, lp=8000)
    up = [0, 1, 2, 3, 4, 5, 4, 3]
    arp(harp, A, 1, up, 0.5, 58, 50, dur=2.0, seed=2)
    arp(harp, Bp, 9, [0, 2, 4, 2, 3, 5, 4, 2], 0.5, 52, 50, dur=2.0, seed=3)
    arp(harp, C, 17, [0, -1, 2, -1, 4, -1, 5, 3], 0.5, 62, 50, dur=2.5, seed=4)

    horn = s.part('horn', 60, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1400}, gain_db=-3.5, pan=-0.1, hall=0.5, hp=110, lp=5000)
    motif(horn, 9, p('D4'), MOTIF, vel=74, rng_seed=5)
    motif(horn, 13, p('D4'), MOTIF_B, vel=78, rng_seed=6)

    choir = s.part('choir', 53, gens=SLOWER, gain_db=-7, width=1.4, hall=0.6, hp=150, lp=6000)
    pads(choir, C, 17, 60, 57, 76, 3, seed=7)
    cc_section(choir, 17, 24, 70, 112, fade_in=6, fade_out=6)

    cel = s.part('celesta', 8, gain_db=-12, pan=0.35, hall=0.7, hp=400, lp=9000)
    rng = random.Random(8)
    for bar in range(17, 25):
        for beat in (0.5, 2.0, 3.5):
            if rng.random() < 0.75:
                ch = prog[bar - 1]
                pc, iv = parse(ch)
                cel.n(B(bar, beat), root_note(ch, 74) + rng.choice(iv[:3]) + rng.choice([0, 12]), 1.5, 48 + rng.randint(0, 10))

    boom = s.synth('boom', sub_boom, gain_db=-11, hall=0.05, lp=180)
    tk = s.part('taiko', 116, gain_db=-5, room=0.35, hall=0.25, hp=35, lp=5000)
    for bar in range(1, 25):
        sec = (bar - 1) // 8
        if sec == 0:
            pat = [(0, 'D2', 100), (2.5, 'A2', 62)]
        elif sec == 1:
            pat = [(0, 'D2', 108), (1.5, 'A2', 58), (2.5, 'D2', 80), (3, 'A2', 66), (3.5, 'A2', 54)]
        else:
            pat = [(0, 'D2', 96)] + ([(2.5, 'A2', 58)] if bar % 2 == 0 else [])
        if bar == 24:
            pat = [(0, 'D2', 96), (2, 'A2', 70), (3, 'D2', 82), (3.5, 'A2', 90)]
        taiko_hits(tk, boom, bar, pat, boom_vel=0.9)

    s.synth('mist', wind_bed(250, 2200, seed=31, cycles=3), periodic=True, gain_db=-17, hall=0.4, hp=200)
    sw = s.synth('swell', swell, gain_db=-12, hall=0.6)
    sw.hit(B(9), 2.8, 0.8).hit(B(17), 2.8, 0.7)
    return s


# =============================================================================================
# 2. emberforge: C minor (Phrygian colour), 100 BPM, 32 bars. Anvils, low brass, driving drums.
# =============================================================================================


def emberforge() -> Song:
    s = Song('emberforge', 100, 32, 'C minor', hall_rt=2.6, seed=22)
    A = ['Cm', 'Cm', 'Db', 'Cm', 'Ab', 'Bb', 'Cm', 'G']
    Bp = ['Cm', 'Eb', 'Db', 'Cm', 'Ab', 'Fm', 'Db', 'G']
    C = ['Cm', 'Cm', 'Ab', 'G', 'Cm', 'Fm', 'Ab', 'G']
    D = ['Ab', 'Ab', 'Fm', 'Fm', 'Db', 'Db', 'G', 'G']
    prog = A + Bp + C + D

    # Forge ostinato on cello: driving 8ths, root-heavy with a falling tail.
    cel = s.part('cello', 42, gain_db=-5, pan=-0.2, hall=0.2, room=0.2, hp=50, lp=3800)
    ost = [(0, 0, 0.4, 92), (0.5, 0, 0.35, 64), (1, 7, 0.4, 76), (1.5, 0, 0.35, 66), (2, 3, 0.4, 84), (2.5, 0, 0.35, 64), (3, 2, 0.4, 76), (3.5, -2, 0.35, 70)]
    bassline(cel, A + Bp + C, 1, ost, 36)
    bassline(cel, D, 25, [(0, 0, 1.9, 74), (2, 7, 1.9, 64)], 36)

    cb = s.part('contrabass', 43, gens=SOFT_RELEASE, gain_db=-8, hall=0.15, hp=30, lp=1100)
    bassline(cb, prog, 1, [(0, 0, 1.8, 90), (2, 0, 1.8, 74)], 24)

    pad = s.part('strings', 48, gens=SLOW, gain_db=-8, width=1.3, hall=0.4, hp=120, lp=5500)
    pads(pad, prog, 1, 58, 55, 74, 3, seed=1)
    pad.cc(0, 11, 96)

    # Low brass riff: trombones + tuba on accented roots (enters bar 9).
    tbn = s.part('trombone', 57, gens={GEN_VOLENVRELEASE: 900, GEN_FILTERFC: -600}, gain_db=-4, pan=0.15, hall=0.35, room=0.15, hp=70, lp=4200)
    tuba = s.part('tuba', 58, gens=SOFT_RELEASE, gain_db=-8, hall=0.25, hp=30, lp=2000)
    riff = [(0, 0, 1.4, 96), (1.5, 0, 0.45, 80), (2, 7, 1.0, 88), (3, 3, 0.9, 84)]
    for i, ch in enumerate(Bp + C):
        r = root_note(ch, 41)
        for beat, off, dur, vel in riff:
            tbn.n(B(9 + i, beat), r + off, dur, vel)
            tbn.n(B(9 + i, beat), r + off + 7 if off == 0 else r + off + 5, dur, vel - 14)
        tuba.n(B(9 + i), r - 12, 1.8, 92)
        tuba.n(B(9 + i, 2), r - 12 + 7, 1.8, 80)
    for i, ch in enumerate(D):  # breakdown: long tones
        r = root_note(ch, 41)
        tbn.ch(B(25 + i), [r, r + 7], 3.9, 70)

    horn = s.part('horns', 60, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1400}, gain_db=-2.5, pan=-0.1, hall=0.45, hp=110, lp=5200)
    motif(horn, 17, p('C4'), MOTIF, vel=92, octave_double=False, rng_seed=3)
    motif(horn, 21, p('C4'), MOTIF_B, vel=96, rng_seed=4)

    choir = s.part('choir', 52, gens=SLOWER, gain_db=-8, width=1.4, hall=0.55, hp=140, lp=5500)
    pads(choir, C + D, 17, 66, 48, 67, 3, seed=5)
    cc_section(choir, 17, 32, 80, 115, fade_in=4, fade_out=8)

    timp = s.part('timpani', 47, gain_db=-6, hall=0.35, room=0.2, hp=40, lp=4000)
    for bar in (1, 9, 17, 25):
        timp.n(B(bar), root_note(prog[bar - 1], 36), 2, 110)
    for k in range(16):  # roll into the loop restart (bar 32 beats 0-4)
        timp.n(B(32, k * 0.25), root_note('G', 36), 0.3, 50 + k * 4)

    boom = s.synth('boom', sub_boom, gain_db=-9, hall=0.04, lp=180)
    tk = s.part('taiko', 116, gain_db=-3, room=0.4, hall=0.2, hp=35, lp=5000)
    bd = s.part('concert_bd', 116, bank=8, gain_db=-8, room=0.3, hall=0.3, hp=30, lp=3000)
    toms = s.part('toms', 0, drum=True, gain_db=-10, room=0.4, hall=0.25, hp=60, lp=3200, pan=0.1)
    drive = [(0, 'C2', 112), (0.5, 'G2', 60), (1, 'C2', 78), (1.5, 'G2', 92), (2, 'C2', 104), (2.75, 'G2', 70), (3, 'C2', 86), (3.5, 'G2', 74)]
    for bar in range(1, 33):
        if bar <= 24:
            pat = drive if bar > 4 else [x for x in drive if x[2] >= 86]
        else:  # half-time breakdown, building back
            pat = [(0, 'C2', 108), (2.5, 'G2', 70)] if bar < 31 else drive
        taiko_hits(tk, boom, bar, pat, boom_vel=0.85)
        bd.n(B(bar), 'C2', 2, 100 if bar % 2 else 86)
        if bar <= 24 and bar > 8:
            bd.n(B(bar, 2), 'C2', 2, 80)
        if bar % 4 == 0 and bar < 25:
            for k, key in enumerate([50, 48, 47, 45, 43, 41]):
                toms.n(B(bar, 2.5 + k * 0.25), key, 0.4, 70 + k * 6)
    for k in range(8):
        toms.n(B(31, 2 + k * 0.25), [45, 43, 41][k % 3], 0.4, 66 + k * 5)
    for k in range(8):
        toms.n(B(32, 2 + k * 0.25), [48, 47, 45, 43][k % 4], 0.4, 76 + k * 5)

    # Anvils on the backbeat: a bright main anvil and a duller second one answering.
    anv = s.synth('anvil', anvil, gain_db=-10, pan=0.35, hall=0.35, room=0.25, hp=300, lp=7000)
    anv2 = s.synth('anvil2', anvil, gain_db=-13, pan=-0.4, hall=0.35, room=0.25, hp=250, lp=6000)
    for bar in range(1, 33):
        if bar > 24 and bar < 31:
            anv.hit(B(bar, 1), 740, 0.6)
            continue
        anv.hit(B(bar, 1), 740, 0.9).hit(B(bar, 3), 740, 0.82)
        if bar > 8:
            anv2.hit(B(bar, 3.5), 523, 0.6)
        if bar % 2 == 0 and bar > 4:
            anv2.hit(B(bar, 1.75), 523, 0.45)

    s.synth('embers', wind_bed(120, 900, seed=41, cycles=4), periodic=True, gain_db=-18, hall=0.3, hp=100)
    sw = s.synth('swell', swell, gain_db=-11, hall=0.5)
    sw.hit(B(9), 2.4, 0.8).hit(B(17), 2.4, 0.9).hit(B(33), 2.4, 0.9)
    return s


# =============================================================================================
# 3. blightmire: F# Phrygian, 90 BPM, 24 bars. Plucked strings, eerie choir hum, hand drums.
# =============================================================================================


def blightmire() -> Song:
    s = Song('blightmire', 90, 24, 'F# Phrygian', hall_rt=3.0, seed=33, master_eq=[(260, -3.0, 0.9)])
    A = ['F#m', 'F#m', 'G', 'F#m', 'D', 'E', 'G', 'G']
    Bp = ['F#m', 'F#m', 'D', 'C#', 'F#m', 'Bm', 'D', 'C#']
    C = ['Bm', 'G', 'F#m', 'F#m', 'D', 'E', 'G', 'G']
    prog = A + Bp + C

    # Crooked pizzicato ostinato in 3+3+2.
    pizz = s.part('pizzicato', 45, gain_db=-5, pan=-0.3, hall=0.4, room=0.15, hp=70, lp=5000)
    ppat = [(0, 0, 0.5, 92), (0.75, 12, 0.4, 62), (1.5, 7, 0.5, 80), (2.25, 1, 0.4, 60), (3, 0, 0.5, 84), (3.5, 3, 0.4, 66)]
    bassline(pizz, prog, 1, ppat, 42)

    # Koto answers with a Phrygian turn (F# G A G F#) on the off-beats.
    koto = s.part('koto', 107, gain_db=-8, pan=0.35, hall=0.5, hp=150, lp=6500)
    turn = [0, 1, 3, 1, 0, -2, 0]
    rng = random.Random(3)
    for bar in range(1, 25):
        if bar in (1, 2, 9, 10, 17, 18):
            continue
        base = p('F#4') if bar <= 16 else p('C#5')
        for k, semi in enumerate(turn[: 4 + (bar % 3)]):
            koto.n(B(bar, 0.5 + k * 0.5), base + semi, 0.9, 60 + rng.randint(-6, 10))

    drone = s.part('drone', 44, gens=SLOWER, gain_db=-10, width=1.2, hall=0.4, hp=40, lp=2500)
    for bar in range(1, 25, 4):
        drone.ch(B(bar), [p('F#1'), p('C#2')], 16.2, 70)
    drone.cc(0, 11, 90)

    cb = s.part('contrabass', 43, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1500}, gain_db=-9, hall=0.25, hp=30, lp=1100)
    bassline(cb, prog, 1, [(0, 0, 4.1, 72)], 30)

    # Eerie hum: Ohh voices with a chromatic inner line (A - Bb - A, F# - G - F#).
    choir = s.part('choir_hum', 53, gens=SLOWER, gain_db=-5, width=1.5, hall=0.6, hp=140, lp=4800)
    pads(choir, prog, 1, 58, 52, 70, 3, seed=4)
    for bar in (4, 12, 20):
        choir.n(B(bar, 2), p('Bb3'), 2.2, 54)
        choir.n(B(bar + 1), p('A3'), 3.0, 50)
    choir.cc(0, 11, 104)

    glass = s.part('glass', 92, gens=SLOWER, gain_db=-14, width=1.6, hall=0.7, hp=200, lp=6000)
    pads(glass, C, 17, 50, 64, 79, 2, seed=5)

    shaku = s.part('shakuhachi', 77, gens=SOFT_RELEASE, gain_db=-5, pan=0.1, hall=0.6, hp=180, lp=6000)
    motif(shaku, 9, p('F#4'), MOTIF, vel=78, rng_seed=6)
    motif(shaku, 13, p('F#4'), [(b, (s_ - 1 if s_ == 2 else s_), d) for b, s_, d in MOTIF_B], vel=80, rng_seed=7)

    hand = s.part('hand_drums', 0, drum=True, gain_db=-6, room=0.45, hall=0.2, hp=60, lp=5500, width=1.3)
    shaker = s.part('shaker', 0, drum=True, gain_db=-21, room=0.3, hall=0.2, hp=2000, lp=9000, pan=0.4)
    tk = s.part('taiko', 116, gain_db=-7, room=0.3, hall=0.3, hp=35, lp=4500)
    boom = s.synth('boom', sub_boom, gain_db=-13, hall=0.05, lp=170)
    conga = [(0, 64, 96), (0.75, 62, 54), (1, 63, 72), (1.5, 64, 70), (2.25, 62, 50), (2.5, 63, 78), (3, 64, 84), (3.5, 61, 66), (3.75, 60, 52)]
    for bar in range(1, 25):
        sec = (bar - 1) // 8
        pat = conga if sec != 0 or bar > 2 else conga[:1] + conga[6:7]
        for beat, key, vel in pat:
            hand.n(B(bar, beat), key, 0.5, vel - (8 if sec == 2 else 0))
        if sec >= 1:
            for k in range(8):
                shaker.n(B(bar, k * 0.5 + 0.25), 70, 0.2, 40 + (12 if k % 2 else 0))
        taiko_hits(tk, boom, bar, [(0, 'F#2', 100 if bar % 2 else 84)] + ([(2.5, 'C#2', 70)] if sec == 1 else []), boom_vel=0.8)
    for k in range(6):  # fill into the loop
        hand.n(B(24, 2.5 + k * 0.25), [63, 62, 64, 63, 64, 64][k], 0.3, 70 + k * 5)

    s.synth('fog', wind_bed(140, 1100, seed=51, cycles=2), periodic=True, gain_db=-15, hall=0.4, hp=110)
    return s


# =============================================================================================
# 4. frostkeep: B minor (Lydian colour), 96 BPM, 28 bars. Glass bells, wide pads, war drums.
# =============================================================================================


def frostkeep() -> Song:
    s = Song('frostkeep', 96, 28, 'B minor', hall_rt=4.0, seed=44)
    A = ['Bmadd9', 'Gmaj7', 'D', 'A', 'Bmadd9', 'Gmaj7', 'Em', 'F#sus4']
    Bp = ['Bm', 'Bm', 'G', 'F#', 'Bm', 'Em', 'G', 'F#']
    C = ['G', 'D', 'A', 'Bm', 'G', 'D', 'Em', 'F#']
    D = ['Bm', 'Gmaj7', 'Em', 'F#']
    prog = A + Bp + C + D

    warm = s.part('warm_pad', 89, gens={GEN_VOLENVATTACK: 4000, GEN_VOLENVRELEASE: 1800}, gain_db=-6, width=1.6, hall=0.5, hp=80, lp=5000)
    pads(warm, prog, 1, 70, 50, 71, 4, seed=1)
    halo = s.part('halo', 94, gens={GEN_VOLENVRELEASE: 1800}, gain_db=-12, width=1.7, hall=0.6, hp=250, lp=7000)
    pads(halo, A, 1, 60, 62, 81, 3, seed=2)
    pads(halo, D, 25, 60, 62, 81, 3, seed=2)
    strings = s.part('strings', 49, gens={GEN_VOLENVATTACK: 2400, GEN_VOLENVRELEASE: 1500}, gain_db=-7, width=1.4, hall=0.45, hp=100, lp=6000)
    pads(strings, Bp + C, 9, 66, 54, 76, 4, seed=3)

    # Celesta ostinato: an icy 8th-note figure that turns on the 9th and #11.
    cel = s.part('celesta', 8, gain_db=-8, pan=0.25, width=1.2, hall=0.65, hp=300, lp=9000)
    fig = [0, 7, 14, 12, 7, 14, 19, 14]
    rng = random.Random(4)
    for bar in range(1, 29):
        r = root_note(prog[bar - 1], 71)
        pc, iv = parse(prog[bar - 1])
        third = iv[1]
        tones = [0, 7, 14, 12, 7, 12 + third, 19, 14]
        if bar in (9, 10, 11, 12, 13, 14, 15, 16):
            tones = fig
        for k in range(8):
            if bar > 24 and k % 2:
                continue
            cel.n(B(bar, k * 0.5), r + tones[k], 1.2, 54 + (10 if k == 0 else 0) + rng.randint(-5, 5))
    glock = s.part('glock', 9, gain_db=-16, pan=-0.3, hall=0.8, hp=800, lp=10000)
    for bar in range(17, 25):
        glock.n(B(bar, 0), root_note(prog[bar - 1], 83) + 7, 2, 50)
        glock.n(B(bar, 2.5), root_note(prog[bar - 1], 83) + 12, 2, 42)
    bells = s.part('tubular', 14, gain_db=-11, pan=-0.2, hall=0.7, hp=150, lp=6000)
    for bar in (1, 9, 17, 25):
        bells.n(B(bar), root_note(prog[bar - 1], 59), 4, 70)

    cb = s.part('contrabass', 43, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1500}, gain_db=-8, hall=0.25, hp=30, lp=1100)
    bassline(cb, prog, 1, [(0, 0, 4.1, 76)], 28)
    cello = s.part('cello', 42, gain_db=-7, pan=-0.2, hall=0.35, hp=50, lp=3500)
    bassline(cello, Bp + C, 9, [(0, 0, 0.9, 86), (1, 0, 0.45, 62), (1.5, 0, 0.45, 66), (2, 7, 0.9, 78), (3, 5, 0.45, 64), (3.5, 7, 0.45, 70)], 35)

    horn = s.part('horns', 60, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1400}, gain_db=-3, pan=-0.1, hall=0.55, hp=110, lp=5000)
    motif(horn, 9, p('B3'), MOTIF, vel=80, rng_seed=5)
    motif(horn, 13, p('B3'), MOTIF_B, vel=84, rng_seed=6)
    choir = s.part('choir', 52, gens=SLOWER, gain_db=-6, width=1.5, hall=0.65, hp=150, lp=5500)
    motif(choir, 17, p('B4'), [(b, s_, d) for b, s_, d in MOTIF], vel=74, rng_seed=7)
    motif(choir, 21, p('B4'), MOTIF_B, vel=78, rng_seed=8)

    boom = s.synth('boom', sub_boom, gain_db=-9, hall=0.05, lp=170)
    tk = s.part('war_drums', 116, gain_db=-3, room=0.35, hall=0.35, hp=35, lp=5000)
    bd = s.part('concert_bd', 116, bank=8, gain_db=-8, room=0.3, hall=0.35, hp=30, lp=3000)
    timp = s.part('timpani', 47, gain_db=-7, hall=0.4, room=0.2, hp=40, lp=4000)
    march = [(0, 'B1', 114), (1.5, 'F#2', 72), (2, 'B1', 98), (3, 'F#2', 84), (3.5, 'B1', 64), (3.75, 'B1', 72)]
    for bar in range(1, 29):
        if bar <= 8:
            if bar % 2 == 1:
                taiko_hits(tk, boom, bar, [(0, 'B1', 96)], boom_vel=0.7)
            continue
        if bar <= 24:
            taiko_hits(tk, boom, bar, march, boom_vel=0.9)
            bd.n(B(bar), 'B1', 2, 104)
            if bar > 16:
                bd.n(B(bar, 2), 'B1', 2, 86)
        else:
            taiko_hits(tk, boom, bar, [(0, 'B1', 100)] + ([(2.5, 'F#2', 66)] if bar < 28 else []), boom_vel=0.8)
    for k in range(16):  # timpani crescendo into the drums at bar 9, and into the loop restart
        timp.n(B(8, k * 0.25), root_note('F#', 40), 0.3, 44 + k * 4)
        timp.n(B(28, k * 0.25), root_note('F#', 40), 0.3, 40 + k * 3)
    for bar in (9, 17):
        timp.n(B(bar), root_note('B', 35), 2, 108)

    s.synth('ice_wind', wind_bed(600, 4800, seed=61, cycles=3), periodic=True, gain_db=-18, hall=0.5, hp=500)
    sw = s.synth('swell', swell, gain_db=-12, hall=0.7)
    sw.hit(B(9), 3.0, 0.8).hit(B(17), 3.0, 0.9).hit(B(29), 3.0, 0.6)
    return s


# =============================================================================================
# 5. madcrown: Bb minor (harmonic), 110 BPM, 32 bars. Organ, dark choir, a triplet (12/8) pulse.
# =============================================================================================


def madcrown() -> Song:
    s = Song('madcrown', 110, 32, 'Bb harmonic minor', hall_rt=3.8, seed=55)
    A = ['Bbm', 'Bbm', 'Gb', 'F', 'Bbm', 'Ebm', 'Gb', 'F']
    Bp = ['Bbm', 'Bbm', 'Gb', 'F', 'Bbm', 'Ebm', 'Gb', 'F']
    C = ['Ebm', 'Bbm', 'Gb', 'Db', 'Ebm', 'Bbm', 'B', 'F']
    D = ['Bbm', 'Gb', 'Bbm', 'Gb', 'Ebm', 'Ebm', 'F', 'F']
    prog = A + Bp + C + D

    organ = s.part('organ', 19, bank=8, gens={GEN_VOLENVATTACK: 11400, GEN_VOLENVRELEASE: 1600, GEN_FILTERFC: -1200}, gain_db=-6, width=1.3, hall=0.55, hp=70, lp=4500)
    pads(organ, prog, 1, 76, 46, 70, 4, seed=1)
    lead = s.part('organ_lead', 19, bank=8, gens={GEN_VOLENVRELEASE: 1200, GEN_FILTERFC: -900}, gain_db=-5, pan=0.15, hall=0.6, hp=150, lp=5000)
    motif(lead, 9, p('Bb4'), swing(MOTIF), vel=86, rng_seed=2)
    motif(lead, 13, p('Bb4'), swing(MOTIF_B), vel=88, rng_seed=3)

    choir = s.part('dark_choir', 52, gens=SLOWER, gain_db=-5, width=1.4, hall=0.6, hp=110, lp=5000)
    pads(choir, prog, 1, 70, 41, 62, 3, seed=4)
    choir.cc(0, 11, 92)
    choir.ramp(B(17), B(18), 11, 92, 120)
    choir.ramp(B(24, 2), B(25), 11, 120, 92)
    ohh = s.part('choir_high', 53, gens=SLOWER, gain_db=-9, width=1.5, hall=0.65, hp=200, lp=5500)
    motif(ohh, 17, p('Bb4'), swing(MOTIF), vel=70, rng_seed=5)
    motif(ohh, 21, p('Bb4'), swing(MOTIF_B), vel=74, rng_seed=6)

    trem = s.part('tremolo', 44, gens=SLOW, gain_db=-9, width=1.3, hall=0.4, hp=60, lp=3500)
    pads(trem, C + D, 17, 72, 46, 65, 3, seed=7)
    # Cello ostinato in triplets (a 12/8 lilt): a mad, swaying gallop no other arena has.
    cel = s.part('cello', 42, gain_db=-6, pan=-0.2, hall=0.25, room=0.15, hp=50, lp=3600)
    t3 = 1 / 3
    ost = [(0, 0, 0.3, 92), (t3, 7, 0.25, 58), (2 * t3, 12, 0.25, 66), (1, 0, 0.3, 76), (1 + t3, 7, 0.25, 56), (1 + 2 * t3, 6, 0.25, 64),
           (2, 0, 0.3, 86), (2 + t3, 7, 0.25, 58), (2 + 2 * t3, 12, 0.25, 66), (3, 3, 0.3, 76), (3 + t3, 1, 0.25, 60), (3 + 2 * t3, -1, 0.25, 70)]
    bassline(cel, A + Bp + C, 1, ost, 34)
    cb = s.part('contrabass', 43, gens=SOFT_RELEASE, gain_db=-8, hall=0.2, hp=30, lp=1100)
    bassline(cb, prog, 1, [(0, 0, 1.9, 90), (2, 0, 1.9, 74)], 22)

    tbn = s.part('trombones', 57, gens={GEN_VOLENVRELEASE: 900, GEN_FILTERFC: -600}, gain_db=-5, pan=0.2, hall=0.4, room=0.15, hp=70, lp=4000)
    for i, ch in enumerate(C):
        r = root_note(ch, 41)
        tbn.ch(B(17 + i), [r, r + 7], 1.4, 98)
        tbn.ch(B(17 + i, 2.5), [r, r + 7], 0.45, 82)
        tbn.ch(B(17 + i, 3), [r, r + 7], 0.9, 88)

    bell = s.part('church_bell', 14, bank=8, gain_db=-12, pan=-0.3, hall=0.75, hp=120, lp=4500)
    for bar in (1, 9, 17, 25):
        bell.n(B(bar), root_note(prog[bar - 1], 46), 4, 76)

    boom = s.synth('boom', sub_boom, gain_db=-10, hall=0.04, lp=170)
    tk = s.part('taiko', 116, gain_db=-4, room=0.4, hall=0.25, hp=35, lp=5000)
    bd = s.part('concert_bd', 116, bank=8, gain_db=-8, room=0.3, hall=0.3, hp=30, lp=3000)
    toms = s.part('toms', 0, drum=True, gain_db=-10, room=0.45, hall=0.3, hp=60, lp=3200, pan=-0.1)
    # Triplet "da-ga" pulse: strong hit on each beat, a lighter one on its last triplet.
    pulse = [(0, 'Bb1', 110), (2 * t3, 'F2', 62), (1, 'Bb1', 74), (1 + 2 * t3, 'F2', 66), (2, 'Bb1', 100), (2 + 2 * t3, 'F2', 58),
             (3, 'Bb1', 78), (3 + t3, 'F2', 56), (3 + 2 * t3, 'F2', 72)]
    for bar in range(1, 33):
        sec = (bar - 1) // 8
        if sec == 0:
            pat = [x for x in pulse if x[2] >= 74]
        elif sec == 3 and bar < 31:
            pat = [(0, 'Bb1', 106), (2, 'Bb1', 84)]
        else:
            pat = pulse
        taiko_hits(tk, boom, bar, pat, boom_vel=0.85)
        if sec in (1, 2) or bar >= 31:
            for q in range(4):
                bd.n(B(bar, q), 'Bb1', 1, 96 if q % 2 == 0 else 78)
        if sec == 2 and bar % 2 == 0:
            for k, key in enumerate([48, 47, 45, 43]):
                toms.n(B(bar, 2 + 2 * t3 + k * t3), key, 0.3, 72 + k * 6)
    for k in range(12):
        toms.n(B(32, k * t3), [43, 45, 47, 48][k % 4], 0.3, 52 + k * 4)

    s.synth('fire', wind_bed(90, 700, seed=71, cycles=4), periodic=True, gain_db=-17, hall=0.3, hp=80)
    sw = s.synth('swell', swell, gain_db=-11, hall=0.6)
    sw.hit(B(17), 2.2, 0.9).hit(B(33), 2.2, 0.8)
    return s


# =============================================================================================
# 6. apex: E minor with major lifts, 120 BPM, 36 bars. Full epic orchestra, triumphant but tense.
# =============================================================================================


def apex() -> Song:
    s = Song('apex', 120, 36, 'E minor / E major', hall_rt=3.2, seed=66)
    A = ['Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'B']
    Bp = ['Em', 'Em', 'C', 'B', 'Em', 'Am', 'C', 'B']
    C = ['C', 'G', 'D', 'Em', 'C', 'G', 'D', 'D']
    D = ['C', 'D', 'E', 'E', 'C', 'D', 'B', 'B']
    E = ['Em', 'C', 'Am', 'B']
    prog = A + Bp + C + D + E

    # String ostinato: driving staccato 8ths.
    vln = s.part('strings_ost', 48, gens={GEN_VOLENVRELEASE: 300}, gain_db=-5, pan=0.15, width=1.3, hall=0.35, room=0.1, hp=150, lp=6500)
    rng = random.Random(1)
    for bar in range(1, 37):
        ch = prog[bar - 1]
        r = root_note(ch, 64)
        pc, iv = parse(ch)
        fig = [0, 12, iv[2], 12, iv[1], 12, iv[2], 12] if bar % 2 else [0, iv[2], 12, iv[2], iv[1] + 12, iv[2], 12, iv[2]]
        for k in range(8):
            vel = 70 + (16 if k % 4 == 0 else 6 if k % 2 == 0 else 0) + rng.randint(-4, 4)
            if bar > 32:
                vel -= 10
            vln.n(B(bar, k * 0.5), r + fig[k], 0.38, vel)

    low = s.part('low_strings', 42, gain_db=-5, pan=-0.2, hall=0.3, room=0.15, hp=50, lp=3800)
    bassline(low, prog, 1, [(0, 0, 0.9, 96), (1, 0, 0.45, 70), (1.5, 0, 0.45, 76), (2, 0, 0.9, 88), (3, 7, 0.45, 74), (3.5, 0, 0.45, 80)], 40)
    cb = s.part('contrabass', 43, gens=SOFT_RELEASE, gain_db=-8, hall=0.2, hp=30, lp=1100)
    bassline(cb, prog, 1, [(0, 0, 1.9, 92), (2, 0, 1.9, 80)], 28)

    pad = s.part('strings_pad', 49, gens={GEN_VOLENVATTACK: 1200, GEN_VOLENVRELEASE: 1500}, gain_db=-8, width=1.4, hall=0.45, hp=120, lp=6000)
    pads(pad, prog, 1, 66, 55, 76, 4, seed=2)

    horn = s.part('horns', 60, gens={GEN_VOLENVATTACK: 10800, GEN_VOLENVRELEASE: 1400}, gain_db=-2.5, pan=-0.15, hall=0.5, hp=110, lp=5200)
    motif(horn, 9, p('E4'), MOTIF, vel=92, rng_seed=3)
    motif(horn, 13, p('E4'), MOTIF_B, vel=96, rng_seed=4)
    # Countermelody on horns under the brass tutti.
    pads(horn, C + D, 17, 72, 55, 67, 2, seed=5)

    brass = s.part('brass', 61, gens={GEN_VOLENVRELEASE: 1000, GEN_FILTERFC: -900}, gain_db=-4, pan=0.1, width=1.2, hall=0.45, hp=120, lp=5000)
    motif(brass, 17, p('E4'), MOTIF, vel=96, rng_seed=6)
    motif(brass, 21, p('E4'), MOTIF_B, vel=100, rng_seed=7)
    # Major lift over C - D - E - E: the motif's head, then a climb to the E-major third.
    lift = [(0, 0, 1.5), (1.5, 3, 0.5), (2, 8, 2.0), (4, 7, 1.0), (5, 10, 1.0), (6, 14, 2.0),
            (8, 4, 1.5), (9.5, 7, 0.5), (10, 12, 2.0), (12, 11, 1.0), (13, 12, 3.0)]
    motif(brass, 25, p('E4'), lift, vel=104, rng_seed=8)
    # C - D - B - B: settle on the dominant so the loop restart resolves to E minor.
    motif(brass, 29, p('E4'), [(0, 8, 2), (2, 7, 2), (4, 5, 1.5), (5.5, 7, 0.5), (6, 10, 2), (8, 11, 2), (10, 7, 2), (12, 2, 3.5)], vel=98, rng_seed=9)
    tpt = s.part('trumpet', 56, gens={GEN_VOLENVRELEASE: 900, GEN_FILTERFC: -1200}, gain_db=-9, pan=0.25, hall=0.55, hp=200, lp=5500)
    motif(tpt, 25, p('E4'), lift, vel=84, rng_seed=10)
    tbn = s.part('low_brass', 57, gens={GEN_VOLENVRELEASE: 900, GEN_FILTERFC: -600}, gain_db=-6, pan=0.2, hall=0.4, hp=60, lp=3800)
    for i, ch in enumerate(C + D):
        r = root_note(ch, 40)
        tbn.ch(B(17 + i), [r, r + 7], 1.4, 96)
        tbn.ch(B(17 + i, 2), [r, r + 7], 1.9, 84)

    choir = s.part('choir', 52, gens=SLOWER, gain_db=-6, width=1.5, hall=0.6, hp=140, lp=5500)
    pads(choir, Bp + C + D, 9, 72, 55, 76, 4, seed=11)
    choir.cc(0, 11, 80)
    choir.ramp(B(9), B(10), 11, 80, 100)
    choir.ramp(B(17), B(18), 11, 100, 124)
    choir.ramp(B(32, 2), B(33), 11, 124, 80)

    harp = s.part('harp', 46, gain_db=-11, pan=-0.35, hall=0.6, hp=200, lp=8000)
    for bar in (8, 16, 24, 32):
        ch = prog[bar - 1]
        r = root_note(ch, 55)
        pc, iv = parse(ch)
        tones = [r + x + 12 * o for o in range(3) for x in iv if x < 12]
        for k, t_ in enumerate(tones[:12]):
            harp.n(B(bar, 2 + k * (2 / 12)), t_, 1.5, 60 + k * 2)
    glock = s.part('glock', 9, gain_db=-17, pan=0.35, hall=0.8, hp=900, lp=10000)
    for bar in range(25, 33):
        glock.n(B(bar), root_note(prog[bar - 1], 76) + 12, 2, 56)

    boom = s.synth('boom', sub_boom, gain_db=-9, hall=0.04, lp=170)
    tk = s.part('taiko', 116, gain_db=-3, room=0.35, hall=0.3, hp=35, lp=5000)
    bd = s.part('concert_bd', 116, bank=8, gain_db=-8, room=0.3, hall=0.35, hp=30, lp=3000)
    timp = s.part('timpani', 47, gain_db=-6, hall=0.4, room=0.2, hp=40, lp=4000)
    cym = s.part('cymbals', 48, drum=True, gain_db=-16, hall=0.6, room=0.2, hp=400, lp=7000, width=1.4)
    groove = [(0, 'E2', 116), (0.75, 'B2', 64), (1, 'E2', 84), (1.5, 'B2', 74), (2, 'E2', 106), (2.5, 'B2', 70), (3, 'E2', 88), (3.25, 'B2', 62), (3.5, 'E2', 96)]
    for bar in range(1, 37):
        sec = (bar - 1) // 8
        if bar > 32:
            pat = [(0, 'E2', 104), (2, 'E2', 84)] if bar < 36 else groove
        elif sec == 0:
            pat = [x for x in groove if x[2] >= 84]
        else:
            pat = groove
        taiko_hits(tk, boom, bar, pat, boom_vel=0.9)
        bd.n(B(bar), 'E2', 2, 104 if sec >= 2 and bar <= 32 else 88)
        if sec >= 2 and bar <= 32:
            bd.n(B(bar, 2), 'E2', 2, 90)
    for bar in (9, 17, 25):
        cym.n(B(bar), 57, 4, 72)
        timp.n(B(bar), root_note(prog[bar - 1], 40), 2, 112)
    for bar in (8, 16, 24, 36):
        for k in range(16):
            timp.n(B(bar, k * 0.25), root_note('B', 35), 0.3, 50 + k * 4)
    for bar in range(17, 33):
        if bar % 2 == 1 and bar not in (17, 25):
            cym.n(B(bar), 59, 2, 52)

    sw = s.synth('swell', swell, gain_db=-11, hall=0.6)
    sw.hit(B(17), 2.0, 0.9).hit(B(25), 2.0, 1.0).hit(B(37), 2.0, 0.8)
    s.synth('sky_air', wind_bed(400, 3500, seed=81, cycles=3), periodic=True, gain_db=-20, hall=0.5, hp=350)
    return s


# =============================================================================================
# 7. lobby: Eb major, 104 BPM, 32 bars. The home base: warm, festive, a little playful. Not an
#    arena: it is the one major-key track and the only one with a drum-kit backbeat (snare + claps
#    on 2 and 4) and tambourine from the first beat, a bass-guitar line and marimba, so it is told
#    apart from every battle loop at once. Eb: a tonic no arena uses, and the key that shares the
#    fewest pitch classes with the arenas' openings (measured, see the README).
# =============================================================================================

# The Clash leitmotif in a major, heroic variant: the same contour (1 - 5 - 6 | 5 - 4 - 3 |
# 6 - 5 - 4 - 3 | 2) with a fanfare pickup on the tonic, over I | I | IV | V.
MOTIF_MAJ = [
    (0, 0, 0.75), (0.75, 0, 0.25), (1, 7, 1.0), (2, 9, 2.0),
    (4, 7, 1.0), (5, 5, 1.0), (6, 4, 1.5), (7.5, 5, 0.5),
    (8, 9, 1.5), (9.5, 7, 0.5), (10, 5, 1.0), (11, 4, 1.0),
    (12, 2, 2.5), (14.5, 7, 0.5), (15, 7, 0.5), (15.5, 7, 0.5),
]
# Answer (over I | vi | IV | V): climbs to the upper tonic and ends on the leading tone (the 3rd of
# V), which pulls into the next section's tonic.
MOTIF_MAJ_B = [
    (0, 0, 0.75), (0.75, 0, 0.25), (1, 7, 1.0), (2, 9, 2.0),
    (4, 12, 1.0), (5, 14, 0.5), (5.5, 12, 0.5), (6, 9, 2.0),
    (8, 5, 1.0), (9, 9, 0.5), (9.5, 12, 1.5), (11, 14, 1.0),
    (12, 12, 1.0), (13, 14, 1.0), (14, 11, 2.0),
]


def lobby() -> Song:
    s = Song('lobby', 104, 32, 'Eb major', hall_rt=2.3, seed=77)
    A = ['Eb', 'Eb', 'Ab', 'Bb', 'Eb', 'Cm', 'Ab', 'Bb']
    Bp = ['Eb', 'Eb', 'Ab', 'Bb', 'Eb', 'Cm', 'Ab', 'Bb']
    C = ['Ab', 'Bb', 'Gm', 'Cm', 'Fm', 'Bb', 'Eb', 'Bb']
    D = ['Eb', 'Gm', 'Ab', 'Bb', 'Eb', 'Cm', 'Fm', 'Bb']
    prog = A + Bp + C + D

    # Bouncy bass guitar: root, octave pops and the fifth, never a sustained drone.
    bass = s.part('bass', 32, gens={GEN_VOLENVRELEASE: 300}, gain_db=-5, hall=0.08, room=0.15, hp=35, lp=2600)
    bpat = [(0, 0, 0.45, 104), (1, 12, 0.3, 74), (1.5, 0, 0.4, 88), (2, 7, 0.45, 94), (3, 12, 0.3, 74), (3.5, 7, 0.35, 84)]
    bassline(bass, A, 1, [x for x in bpat if x[0] in (0, 1.5, 2, 3.5)], 27)
    bassline(bass, Bp + C + D, 9, bpat, 27)

    # Marimba hook: syncopated chord-tone 8ths with rests, the "bounce" of the theme.
    mar = s.part('marimba', 12, gain_db=-6, pan=0.25, width=1.2, hall=0.3, room=0.2, hp=180, lp=9000)
    hook = [0, 3, -1, 2, 4, 3, -1, 1]
    arp(mar, A + Bp, 1, hook, 0.5, 76, 63, dur=0.6, accent=12, seed=2)
    arp(mar, C, 17, [0, -1, 2, 3, -1, 2, 4, -1], 0.5, 64, 63, dur=0.6, accent=8, seed=3)
    arp(mar, D, 25, hook, 0.5, 80, 63, dur=0.6, accent=12, seed=4)

    # Warm strings bed with smooth voice leading, from bar 9: the opening is a dry, punchy groove
    # (no sustained pad), which keeps it far from every arena's pad-led opening.
    strings = s.part('strings', 48, gens={GEN_VOLENVATTACK: 1200, GEN_VOLENVRELEASE: 1300}, gain_db=-9, width=1.4, hall=0.4, hp=110, lp=7000)
    pads(strings, Bp + C + D, 9, 62, 55, 77, 4, seed=5)
    strings.cc(B(8, 2), 11, 92)
    strings.ramp(B(17), B(18), 11, 92, 108)
    strings.ramp(B(24, 2), B(25), 11, 108, 116)
    strings.ramp(B(32, 2), B(33) - 0.125, 11, 116, 80)

    # Brass: a tutti chord on the loop downbeat, anticipation stabs ("and" of 4), punches in C.
    brass = s.part('brass', 61, gens={GEN_VOLENVRELEASE: 700, GEN_FILTERFC: -500}, gain_db=-6, pan=-0.1, width=1.3, hall=0.4, room=0.15, hp=120, lp=6500)
    for bar in range(1, 33):
        ch = prog[bar - 1]
        nxt = prog[bar % 32]
        vs = voice(None, ch, 57, 76, 4)
        vn = voice(None, nxt, 57, 76, 4)
        if bar in (1, 9, 17, 25):
            brass.ch(B(bar), vs, 1.2, 100)
        if 17 <= bar <= 24:
            brass.ch(B(bar, 3), vs, 0.35, 82)
            brass.ch(B(bar, 3.5), vn, 0.45, 90)
        elif bar % 2 == 0 and bar != 32:
            brass.ch(B(bar, 3.5), vn, 0.5, 86)
    # Horns hold warm two-voice chords under the motif, then answer it in D.
    horns = s.part('horns', 60, gens={GEN_VOLENVATTACK: 9600, GEN_VOLENVRELEASE: 1300}, gain_db=-8, pan=0.2, hall=0.5, hp=100, lp=5000)
    pads(horns, Bp, 9, 70, 53, 65, 2, seed=6)
    pads(horns, D, 25, 76, 53, 65, 2, seed=7)

    # The leitmotif, major: trumpet over horns an octave down (B), then trumpets + brass tutti (D).
    tpt = s.part('trumpet', 56, gens={GEN_VOLENVRELEASE: 800, GEN_FILTERFC: -700}, gain_db=-4, pan=0.05, hall=0.45, room=0.1, hp=180, lp=6500)
    motif(tpt, 9, p('Eb4'), MOTIF_MAJ, vel=88, rng_seed=8)
    motif(tpt, 13, p('Eb4'), MOTIF_MAJ_B, vel=92, rng_seed=9)
    motif(tpt, 25, p('Eb4'), MOTIF_MAJ, vel=96, rng_seed=10)
    motif(tpt, 29, p('Eb4'), MOTIF_MAJ_B, vel=100, rng_seed=11)
    hlead = s.part('horn_lead', 60, gens={GEN_VOLENVRELEASE: 1100}, gain_db=-9, pan=-0.2, hall=0.5, hp=100, lp=5000)
    motif(hlead, 9, p('Eb3'), MOTIF_MAJ, vel=80, rng_seed=12)
    motif(hlead, 13, p('Eb3'), MOTIF_MAJ_B, vel=82, rng_seed=13)
    tbn = s.part('trombones', 57, gens={GEN_VOLENVRELEASE: 700, GEN_FILTERFC: -500}, gain_db=-8, pan=0.25, hall=0.35, room=0.15, hp=70, lp=4500)
    for i, ch in enumerate(D):
        r = root_note(ch, 41)
        tbn.ch(B(25 + i), [r, r + 7], 0.9, 92)
        tbn.ch(B(25 + i, 1.5), [r, r + 7], 0.45, 76)
        tbn.ch(B(25 + i, 2), [r + 7, r + 12], 0.9, 86)

    # C: a new playful tune on flute (written in F, sounding a tone lower), doubled an octave up on glockenspiel; brass punches answer.
    tune = [
        (17, 0, 'D5', 0.5), (17, 0.5, 'F5', 0.5), (17, 1, 'G5', 1.0), (17, 2, 'F5', 0.5), (17, 2.5, 'D5', 0.5), (17, 3, 'C5', 1.0),
        (18, 0, 'E5', 0.5), (18, 0.5, 'G5', 0.5), (18, 1, 'C6', 1.0), (18, 2, 'Bb5', 0.5), (18, 2.5, 'G5', 0.5), (18, 3, 'E5', 1.0),
        (19, 0, 'C5', 0.5), (19, 0.5, 'E5', 0.5), (19, 1, 'A5', 1.0), (19, 2, 'G5', 0.5), (19, 2.5, 'E5', 0.5), (19, 3, 'C5', 0.5), (19, 3.5, 'D5', 0.5),
        (20, 0, 'F5', 1.5), (20, 1.5, 'E5', 0.5), (20, 2, 'D5', 1.0), (20, 3, 'A4', 1.0),
        (21, 0, 'Bb4', 0.5), (21, 0.5, 'D5', 0.5), (21, 1, 'G5', 1.0), (21, 2, 'F5', 0.5), (21, 2.5, 'D5', 0.5), (21, 3, 'Bb4', 1.0),
        (22, 0, 'C5', 0.5), (22, 0.5, 'E5', 0.5), (22, 1, 'G5', 1.0), (22, 2, 'Bb5', 0.5), (22, 2.5, 'A5', 0.5), (22, 3, 'G5', 1.0),
        (23, 0, 'A5', 1.5), (23, 1.5, 'G5', 0.5), (23, 2, 'F5', 0.5), (23, 2.5, 'G5', 0.5), (23, 3, 'A5', 1.0),
        (24, 0, 'G5', 2.0), (24, 2, 'E5', 0.5), (24, 2.5, 'F5', 0.5), (24, 3, 'G5', 1.0),
    ]
    T = -2  # F -> Eb
    flute = s.part('flute', 73, gens={GEN_VOLENVRELEASE: 600}, gain_db=-6, pan=-0.2, hall=0.45, hp=250, lp=9000)
    glock = s.part('glock', 9, gain_db=-15, pan=0.3, hall=0.6, hp=900, lp=11000)
    rng = random.Random(14)
    for bar, beat, key, dur in tune:
        v = 84 + (8 if beat == int(beat) else 0) + rng.randint(-5, 5)
        flute.n(B(bar, beat), p(key) + T, dur * 0.9, v)
        if beat == int(beat):
            glock.n(B(bar, beat), p(key) + T + 12, 1.0, 58)
    for bar in range(25, 33):  # sparkle on the motif's downbeats in D
        glock.n(B(bar), root_note(prog[bar - 1], 81) + 7, 1.5, 54)

    # Drum kit (standard GM kit): the backbeat no arena has.
    kit = s.part('kit', 0, drum=True, gain_db=-6, room=0.35, hall=0.12, hp=35, lp=9000)
    claps = s.part('claps', 0, drum=True, gain_db=-12, room=0.4, hall=0.25, hp=300, lp=9000, width=1.3)
    hats = s.part('hats', 0, drum=True, gain_db=-17, room=0.25, hall=0.1, hp=3000, lp=12000, pan=0.3)
    tamb = s.part('tambourine', 0, drum=True, gain_db=-21, room=0.3, hall=0.2, hp=2500, lp=12000, pan=-0.35)
    cym = s.part('cymbals', 0, drum=True, gain_db=-15, room=0.2, hall=0.45, hp=400, lp=11000, width=1.4)
    for bar in range(1, 33):
        sec = (bar - 1) // 8
        kicks = [(0, 108), (1.5, 72), (2, 100), (2.5, 80)]
        for beat, v in kicks:
            kit.n(B(bar, beat), 36, 0.4, v)
        last = bar % 8 == 0
        for beat in (1, 3):
            if bar == 32 and beat == 3:
                continue
            kit.n(B(bar, beat), 38, 0.4, 92)
            claps.n(B(bar, beat), 39, 0.4, 88)
        for k in range(8):
            if bar == 32 and k >= 4:
                break
            hats.n(B(bar, k * 0.5), 42, 0.2, 66 if k % 2 else 50)
        if sec < 2:  # 8th-note tambourine in A and B, 16ths in C and D
            for k in range(8):
                if bar == 32 and k >= 4:
                    break
                tamb.n(B(bar, k * 0.5), 54, 0.2, 70 if k % 2 else 54)
        if sec >= 2:
            hats.n(B(bar, 3.5), 46, 0.45, 70)
            for k in range(16):
                if bar == 32 and k >= 8:
                    break
                tamb.n(B(bar, k * 0.25), 54, 0.2, (78 if k % 4 == 0 else 52) + (10 if k in (4, 12) else 0))
        if last and bar != 32:  # one-beat snare pickup into the next section
            for k in range(4):
                kit.n(B(bar, 3 + k * 0.25), 38, 0.2, 60 + k * 10)
    for k in range(8):  # snare roll into the loop restart
        kit.n(B(32, 2 + k * 0.25), 38, 0.2, 58 + k * 6)
    for k in range(4):
        claps.n(B(32, 3 + k * 0.25), 39, 0.2, 70 + k * 8)
    for bar in (1, 9, 17, 25):
        cym.n(B(bar), 49, 4, 96 if bar != 1 else 90)
    cym.n(B(21), 57, 3, 70)

    # Family core: taiko + sub boom under section downbeats, swells into each section.
    boom = s.synth('boom', sub_boom, gain_db=-12, hall=0.04, lp=170)
    tk = s.part('taiko', 116, gain_db=-9, room=0.35, hall=0.25, hp=35, lp=5000)
    for bar in (1, 9, 17, 25):
        taiko_hits(tk, boom, bar, [(0, 'Eb2', 108)], boom_vel=0.8)
    taiko_hits(tk, boom, 32, [(3, 'Bb1', 84), (3.5, 'Bb1', 96)], boom_vel=0.6)
    sw = s.synth('swell', swell, gain_db=-14, hall=0.5)
    sw.hit(B(9), 1.8, 0.7).hit(B(17), 1.8, 0.7).hit(B(25), 2.0, 0.8).hit(B(33), 2.0, 0.7)
    s.synth('sun_air', wind_bed(700, 6000, seed=91, cycles=4), periodic=True, gain_db=-24, hall=0.4, hp=600)
    return s


SONGS = {
    'moonrune': moonrune,
    'emberforge': emberforge,
    'blightmire': blightmire,
    'frostkeep': frostkeep,
    'madcrown': madcrown,
    'apex': apex,
    'lobby': lobby,
}
