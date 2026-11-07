"""Cut seamless game loops out of the ElevenLabs eleven_music_v2_5 renders and master them.

Usage (from anywhere):
  python -I make_loops.py --gens gens.tsv --raw <dir of <id>_<generation id>.mp3> --work <dir> [--out <public/audio/bgm>] [--only id,...]

Per track every take (2 per track) is analysed and the best loop of any take is shipped:
  1. Beat tracking (librosa, seeded with the prompt tempo). Loop candidates run from a beat in the
     first 25 s to a beat 56-82 s later, a whole number of 4-beat bars apart.
  2. Score = how well the music right AFTER the loop end matches the music right after the loop
     start (that is what the ear hears at the jump: 2 s of normalised log-mel + chroma features),
     plus the bar before each point and the level difference. Lower is better.
  3. The exact end sample is then refined to the frame-aligned position (loop length a multiple of
     1024 samples, as the earlier FluidSynth loops) whose waveform best correlates with the start
     over 40 ms, so the player's 40 ms seam blend (src/audio/music.ts) works on aligned phase.
  4. The loop's last 1.5 s are equal-power crossfaded into the bar that leads into the loop start, so
     the jump continues the waveform; the file is [0.512 s before][the loop][0.512 s of the music
     after the start], continuous across both loop points,
     mastered to -20 LUFS integrated with a -1.6 dBFS true-peak ceiling (32 Hz high-pass), encoded
     AAC-LC 48 kHz stereo at min(80 kb/s, 5300 kbit / duration), exactly like the previous set, so
     `MUSIC_GAIN`, `loopStart` (0.512 s) and the player's blend need no change.
Writes loops.json (next to this script) with the loop points, tempo, chosen take and seam score; the
pre-encode masters land in --work as <id>.wav so docs/brand/audio/bgm/measure_bgm.py can QA the
decoded files (BGM_WORK=<work>).
"""
import argparse
import json
import os
import subprocess
import sys

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "v4"))
import master_v4 as V  # noqa: E402

SR = 48000
PAD = 24576
FRAME = 1024
HOP = 512
TARGET_LUFS = -20.0
TP_CEILING_DB = -1.6
SIZE_BUDGET_KBIT = 5300
MAX_KBPS = 80
MIN_LOOP_S, MAX_LOOP_S = 60.5, 82.0  # tests/music.test.ts wants 60-90 s
START_MAX_S = 25.0
LEVEL_WEIGHT = float(os.environ.get("LOOP_LEVEL_WEIGHT", "0.08"))  # weight of the level-continuity terms (dB) in the score
PROMPTS = {  # tempo / key as prompted (the key is documentary; the tempo seeds the beat tracker)
    "moonrune": (84, "D minor"), "emberforge": (100, "C minor"), "blightmire": (90, "F# Phrygian"),
    "frostkeep": (96, "B minor"), "madcrown": (110, "Bb harmonic minor"), "apex": (120, "E minor / E major"),
    "lobby": (104, "Eb major"),
}


def load(path: str) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y.astype(np.float32)


def features(mono: np.ndarray) -> np.ndarray:
    mel = librosa.power_to_db(librosa.feature.melspectrogram(y=mono, sr=SR, n_fft=2048, hop_length=HOP, n_mels=48), ref=np.max)
    mel = (mel - mel.mean(axis=1, keepdims=True)) / (mel.std(axis=1, keepdims=True) + 1e-6)
    chroma = librosa.feature.chroma_stft(y=mono, sr=SR, n_fft=4096, hop_length=HOP)
    return np.vstack([mel, 4.0 * chroma])  # (features, frames)


def beats(mono: np.ndarray, bpm_hint: float) -> tuple:
    onset = librosa.onset.onset_strength(y=mono, sr=SR, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP, start_bpm=bpm_hint, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    # The tracker sometimes locks on half / double time: pull it to the prompted octave.
    while tempo < bpm_hint / 1.5:
        tempo *= 2
    while tempo > bpm_hint * 1.5:
        tempo /= 2
    return tempo, np.asarray(frames)


def choose(mono: np.ndarray, bpm_hint: float) -> dict:
    F = features(mono)
    rms = librosa.feature.rms(y=mono, hop_length=HOP)[0]
    tempo, bt = beats(mono, bpm_hint)
    n_frames = F.shape[1]
    w_after = int(2.0 * SR / HOP)
    w_before = int(1.0 * SR / HOP)
    best = None
    starts = [b for b in bt if 2.0 * SR / HOP <= b <= START_MAX_S * SR / HOP]
    for i, s in enumerate(starts):
        js = np.where(bt == s)[0][0]
        for je in range(js + 4, len(bt), 4):  # whole 4-beat bars
            e = bt[je]
            L = (e - s) * HOP / SR
            if L < MIN_LOOP_S:
                continue
            if L > MAX_LOOP_S or e + w_after >= n_frames:
                break
            d_after = np.mean(np.abs(F[:, e:e + w_after] - F[:, s:s + w_after]))
            d_before = np.mean(np.abs(F[:, e - w_before:e] - F[:, s - w_before:s]))
            def db(a, b):
                return 20 * np.log10(rms[a:b].mean() + 1e-9)
            # Level continuity: after the jump (e -> s), and across the crossfaded tail (the bar that
            # leads into s must not be much quieter than the loop's own end or the music after s).
            lvl = abs(db(e, e + w_after) - db(s, s + w_after)) + abs(db(s - w_before, s) - db(e - w_before, e)) \
                + abs(db(s - w_before, s) - db(s, s + w_before))
            score = d_after + 0.5 * d_before + LEVEL_WEIGHT * lvl
            if best is None or score < best["score"]:
                best = {"score": float(score), "s_frame": int(s), "e_frame": int(e), "tempo": tempo, "beats": je - js,
                        "lead_db": float(db(s - w_before, s) - db(s, s + w_before))}
    if best is None:
        raise SystemExit("no loop candidate (track too short?)")
    return best


def refine(mono: np.ndarray, s: int, e: int) -> tuple:
    """Frame-aligned loop end near `e` whose 40 ms waveform best matches the start's."""
    s = int(round(s / FRAME)) * FRAME  # the start also sits on a frame so that PAD stays frame-aligned
    w = int(0.04 * SR)
    ref = mono[s - w:s + w]
    best_e, best_c = None, -2.0
    base = int(round((e - s) / FRAME))
    for k in range(base - 8, base + 9):
        L = k * FRAME
        cand = mono[s + L - w:s + L + w]
        if len(cand) < 2 * w or s + L + PAD > len(mono):
            continue
        c = float(np.dot(ref, cand) / (np.linalg.norm(ref) * np.linalg.norm(cand) + 1e-9))
        if c > best_c:
            best_c, best_e = c, s + L
    return s, best_e, best_c


XFADE_S = 1.5


def loop_file(y: np.ndarray, s: int, e: int) -> np.ndarray:
    """[PAD before s][loop s..e whose last XFADE_S morph into the music just before s][PAD of the music after s].

    Both cut points sit on bar lines, so the equal-power crossfade of the loop's tail with the bar
    that leads into the start is rhythmically coherent; after it the loop's last samples are the
    samples just before `s`, so the jump e -> s continues the waveform, and the player's own 40 ms
    blend (src/audio/music.ts) finds identical audio on both sides. The trailing pad is the music
    that really follows the jump, so the file is continuous across loopEnd as well (measure_bgm.py's
    seam checks against the file's own continuation stay meaningful).
    """
    L = e - s
    X = min(int(XFADE_S * SR), L // 4)
    loop = y[:, s:e].copy()
    w = np.sin(0.5 * np.pi * np.linspace(0.0, 1.0, X, endpoint=False, dtype=np.float32)) ** 2  # 0 -> 1
    tail = loop[:, L - X:]
    lead = y[:, s - X:s]
    loop[:, L - X:] = tail * np.sqrt(1.0 - w) + lead * np.sqrt(w)
    return np.concatenate([y[:, s - PAD:s], loop, y[:, s:s + PAD]], axis=1)


def master_segment(seg: np.ndarray, wav_path: str, m4a_path: str) -> dict:
    tmp = wav_path + ".in.wav"
    sf.write(tmp, np.ascontiguousarray(seg.T), SR, subtype="FLOAT")
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(seg.T.astype(np.float64))
    gain = TARGET_LUFS - lufs
    af = f"highpass=f=32,volume={gain:.2f}dB,alimiter=limit={10 ** (TP_CEILING_DB / 20):.4f}:level=false:attack=3:release=120"
    V.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-af", af, "-c:a", "pcm_f32le", wav_path])
    os.remove(tmp)
    y, _ = sf.read(wav_path, dtype="float32")
    lufs2 = meter.integrated_loudness(y.astype(np.float64))
    tp = max(V.true_peak_db(y[:, 0], SR), V.true_peak_db(y[:, 1], SR))
    dur = len(y) / SR
    kbps = min(MAX_KBPS, int(SIZE_BUDGET_KBIT / dur))
    V.run(["ffmpeg", "-y", "-v", "error", "-i", wav_path, "-c:a", "aac", "-b:a", f"{kbps}k", "-ar", str(SR),
           "-movflags", "+faststart", "-map_metadata", "-1", m4a_path])
    return {"lufs": round(float(lufs2), 2), "tp_db": round(float(tp), 2), "gain_db": round(float(gain), 2), "kbps": kbps,
            "size": os.path.getsize(m4a_path), "dur": round(dur, 3)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "audio", "bgm"))
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}
    os.makedirs(args.work, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    takes: dict = {}
    for ln in open(args.gens, encoding="utf-8"):
        if ln.strip():
            tid, _sess, gen = ln.rstrip("\n").split("\t")
            takes.setdefault(tid, []).append(gen)
    loops_path = os.path.join(HERE, "loops.json")
    loops = json.load(open(loops_path, encoding="utf-8")) if os.path.exists(loops_path) else {}
    for tid, gens in takes.items():
        if only and tid not in only:
            continue
        bpm_hint, key = PROMPTS[tid]
        cands = []
        for g in gens:
            y = load(os.path.join(args.raw, f"{tid}_{g}.mp3"))
            mono = y.mean(axis=0)
            c = choose(mono, bpm_hint)
            s, e, corr = refine(mono, c["s_frame"] * HOP, c["e_frame"] * HOP)
            cands.append({**c, "gen": g, "y": y, "s": s, "e": e, "corr": corr})
            print(f"  {tid} take {g}: score {c['score']:.3f} loop {(e - s) / SR:.2f}s from {s / SR:.2f}s "
                  f"({c['beats']} beats, {c['tempo']:.1f} BPM) seam corr {corr:.2f} lead-in {c['lead_db']:+.1f} dB")
        pick = min(cands, key=lambda c: c["score"])
        s, e, y = pick["s"], pick["e"], pick["y"]
        seg = loop_file(y, s, e)
        res = master_segment(seg, os.path.join(args.work, f"{tid}.wav"), os.path.join(args.out, f"{tid}.m4a"))
        L = int(e - s)
        bars = int(pick["beats"]) // 4
        # The tempo that makes the loop exactly `bars` bars (the test checks bars * 4 beats against the length).
        bpm = round(bars * 4 * 60 * SR / L, 3)
        loops[tid] = {
            "bpm": bpm, "bars": bars, "key": key,
            "loopStart": PAD / SR, "loopEnd": (PAD + L) / SR, "loopSamples": L, "sampleRate": SR, "kbps": res["kbps"],
            "trackedBpm": round(float(pick["tempo"]), 2), "take": pick["gen"], "seamScore": round(float(pick["score"]), 3),
            "seamCorr": round(float(pick["corr"]), 3), "sourceStartS": round(int(s) / SR, 3),
            "lufs": res["lufs"], "truePeakDb": res["tp_db"], "bytes": int(res["size"]),
        }
        print(f"== {tid}: take {pick['gen']}  loop {L / SR:.3f}s  {res['lufs']} LUFS  {res['tp_db']} dBTP  {res['kbps']} kb/s  {res['size']} B")
        json.dump(loops, open(loops_path, "w", encoding="utf-8"), indent=2)


if __name__ == "__main__":
    main()
