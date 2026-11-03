"""
QA for the shipped BGM loops: loudness, true peak, duration and loop-seam checks, on the decoded
AAC files (what the game plays), plus spectrogram PNGs.

Usage: python docs/brand/audio/bgm/measure_bgm.py [id ...] [--png DIR]
Writes docs/brand/audio/bgm/qa-bgm.json.

Seam checks (all on the decoded .m4a). R is the loop buffer the game plays: [loopStart, loopEnd)
with its last 40 ms blended into the audio just before loopStart (see `blended`); `raw_jump`
repeats the checks for a plain loopStart/loopEnd jump without the blend.
  - align_offset: lag between the decoded file and the pre-encode master (0 = encoder priming was
    trimmed by the decoder via the MP4 edit list).
  - seam_residual_db: R's last 250 ms + R's first 250 ms (what the player produces at the loop
    jump) versus the file's own continuous audio across loopEnd (the periodic continuation). Level
    of the difference relative to the signal; the pre-encode master gives the floor of the method.
  - step_ratio: |R[0] - R[-1]| (the sample step at the jump) divided by the 99.9th percentile of
    sample-to-sample steps inside R. Below 1 means the jump is smaller than ordinary steps.
  - hf_click_db: 8 kHz high-passed energy in a 6 ms window centred on the jump versus the median
    of 6 ms windows in the surrounding 500 ms (a click shows up as a positive spike).
    hf_click_ref_db is the same measure on the file's continuous audio across loopEnd: when the two
    match, the spike is the music (the bar-1 downbeat), not the jump.
  - codec_residual_db: decoded loop region versus the pre-encode master (AAC coding noise).
  - seam_vs_master_db: the 500 ms the player produces around the jump versus the master's own
    continuous audio there (the ideal). local_codec_residual_db is the same comparison for the
    file's continuous audio over that window (no jump). When the two match, the seam adds nothing
    beyond the coding noise of that material. (seam_residual_db compares two independent codings, so it
    sits about 3 dB above the codec noise by construction.)
  - hf_click_ref_start_db: hf_click measured on the file's continuous audio across loopStart. The
    played seam reproduces this exactly (the blend ends in that audio), so hf_click_db should match
    it rather than hf_click_ref_db.
  - rms_before/after: RMS (dBFS) of the 50 ms before and after the jump.
  - band_diff_db: max |difference| of octave-band levels (63 Hz - 8 kHz) between the last and first
    500 ms of R (musical continuity of the tails, not an identity test).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
SR = 48000


def decode(path: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


def ebur128(path: str) -> dict:
    r = subprocess.run(['ffmpeg', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    tail = r.stderr[r.stderr.rfind('Summary:'):]
    g = lambda pat: float(re.search(pat, tail, re.S).group(1))  # noqa: E731
    return {'I_lufs': g(r'I:\s+(-?[\d.]+) LUFS'), 'LRA_lu': g(r'LRA:\s+(-?[\d.]+) LU'),
            'true_peak_dbtp': g(r'True peak:\s+Peak:\s+(-?[\d.]+) dBFS')}


def db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2)))


def octave_levels(x: np.ndarray) -> list[float]:
    m = x.mean(axis=0)
    out = []
    for fc in [63, 125, 250, 500, 1000, 2000, 4000, 8000]:
        sos = signal.butter(2, [fc / np.sqrt(2) / (SR / 2), min(fc * np.sqrt(2), SR / 2 - 1) / (SR / 2)], 'band', output='sos')
        out.append(db(rms(signal.sosfilt(sos, np.concatenate([np.zeros(4800), m]))[4800:])))
    return out


SEAM_BLEND_S = 0.04  # must match SEAM_BLEND_S in src/audio/music.ts


def blended(dec: np.ndarray, a: int, b: int) -> np.ndarray:
    """The loop buffer src/audio/music.ts builds: R with its last 40 ms faded into the audio that
    precedes loopStart, so R[-1] -> R[0] continues the decoded waveform exactly."""
    R = dec[:, a:b].copy()
    x = int(SEAM_BLEND_S * SR)
    w = np.linspace(0, 1, x, endpoint=False) + 1 / x
    R[:, -x:] = R[:, -x:] * (1 - w) + dec[:, a - x: a] * w
    return R


def seam(dec: np.ndarray, a: int, b: int, R: np.ndarray | None = None, master: np.ndarray | None = None) -> dict:
    if R is None:
        R = dec[:, a:b]
    N = int(0.25 * SR)
    looped = np.concatenate([R[:, -N:], R[:, :N]], axis=1)
    ref = dec[:, b - N: b + N]
    res = db(rms(looped - ref)) - db(rms(ref))
    extra = {}
    if master is not None:
        # The ideal: the pre-encode master's own continuous audio across loopEnd.
        ideal = master[:, b - N: b + N]
        extra['seam_vs_master_db'] = round(db(rms(looped - ideal)) - db(rms(ideal)), 1)
        # Same window, no jump: the decoder's own error on this material (swells code loosely).
        extra['local_codec_residual_db'] = round(db(rms(ref - ideal)) - db(rms(ideal)), 1)
    steps = np.abs(np.diff(R, axis=1))
    p999 = float(np.percentile(steps, 99.9))
    jump = float(np.max(np.abs(R[:, 0] - R[:, -1])))
    def hf_spike(x: np.ndarray) -> float:
        hp = signal.sosfilt(signal.butter(4, 8000 / (SR / 2), 'high', output='sos'), x, axis=-1)
        w = int(0.006 * SR)
        e = np.array([rms(hp[:, i: i + w]) for i in range(0, x.shape[1] - w, w // 2)])
        centre = (N - w // 2) // (w // 2)
        around = np.median(np.delete(e, range(max(0, centre - 2), centre + 3)))
        return db(e[max(0, centre - 2): centre + 3].max()) - db(around)

    click = hf_spike(looped)
    click_ref = hf_spike(ref)
    # The file's own continuous audio across loopStart (what a straight play-through sounds like).
    click_ref_start = hf_spike(dec[:, a - N: a + N])
    w50 = int(0.05 * SR)
    lv_end = octave_levels(R[:, -SR // 2:])
    lv_start = octave_levels(R[:, : SR // 2])
    return {
        'seam_residual_db': round(res, 1),
        'step_ratio': round(jump / max(p999, 1e-12), 3),
        'hf_click_db': round(click, 1),
        'hf_click_ref_db': round(click_ref, 1),
        'hf_click_ref_start_db': round(click_ref_start, 1),
        'rms_before_dbfs': round(db(rms(R[:, -w50:])), 1),
        'rms_after_dbfs': round(db(rms(R[:, :w50])), 1),
        'band_diff_db': round(max(abs(x - y) for x, y in zip(lv_end, lv_start)), 1),
        **extra,
    }


def spectrogram(dec: np.ndarray, a: int, b: int, title: str, png: str) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    m = dec.mean(axis=0)
    R = m[a:b]
    looped = np.concatenate([R[-2 * SR:], R[: 2 * SR]])
    fig, ax = plt.subplots(2, 1, figsize=(12, 7))
    for axi, x, ttl in ((ax[0], R, f'{title}: full loop'), (ax[1], looped, f'{title}: 2 s before / after the loop jump (t = 2 s)')):
        f, t, S = signal.spectrogram(x, SR, nperseg=2048, noverlap=1536)
        axi.pcolormesh(t, f, 10 * np.log10(S + 1e-14), shading='auto', vmin=-130, vmax=-40, cmap='magma')
        axi.set_yscale('symlog', linthresh=200)
        axi.set_ylim(30, 20000)
        axi.set_title(ttl)
        axi.set_ylabel('Hz')
    ax[1].axvline(2.0, color='cyan', lw=0.8)
    fig.tight_layout()
    fig.savefig(png, dpi=80)
    plt.close(fig)


def main() -> None:
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    png_dir = None
    if '--png' in sys.argv:
        png_dir = sys.argv[sys.argv.index('--png') + 1]
        args = [x for x in args if x != png_dir]
        os.makedirs(png_dir, exist_ok=True)
    work = os.environ.get('BGM_WORK', '/tmp/bgm-work')
    loops = json.load(open(os.path.join(HERE, 'loops.json')))
    ids = args or list(loops)
    qa_path = os.path.join(HERE, 'qa-bgm.json')
    qa = json.load(open(qa_path)) if os.path.exists(qa_path) else {}
    for tid in ids:
        lp = loops[tid]
        m4a = os.path.join(REPO, 'public', 'audio', 'bgm', f'{tid}.m4a')
        dec = decode(m4a)
        a = round(lp['loopStart'] * SR)
        b = a + lp['loopSamples']
        res = {'file_kib': round(os.path.getsize(m4a) / 1024, 1), 'file_seconds': round(dec.shape[1] / SR, 3),
               'loop_seconds': round(lp['loopSamples'] / SR, 3)}
        res.update(ebur128(m4a))
        import pyloudnorm
        res['loop_region_lufs'] = round(pyloudnorm.Meter(SR).integrated_loudness(dec[:, a:b].T), 2)
        res['loop_region_peak_dbfs'] = round(db(np.abs(dec[:, a:b]).max()), 2)
        wav = os.path.join(work, f'{tid}.wav')
        if os.path.exists(wav):
            src = sf.read(wav, always_2d=True)[0].T
            n = min(src.shape[1], dec.shape[1], 4 * SR)
            xc = signal.correlate(dec[0, :n], src[0, :n], mode='full', method='fft')
            lag = int(np.argmax(np.abs(xc[n - 1 - 4096: n - 1 + 4096]))) - 4096
            res['align_offset_samples'] = lag
            res['master_seam_residual_db'] = seam(src, a, b)['seam_residual_db']
            d = dec[:, a + lag: b + lag] if lag >= 0 else dec[:, a:b]
            s_ = src[:, a:b] if lag >= 0 else src[:, a - lag: b - lag]
            res['codec_residual_db'] = round(db(rms(d - s_)) - db(rms(s_)), 1)
        master = src if os.path.exists(wav) and res.get('align_offset_samples') == 0 else None
        res['raw_jump'] = seam(dec, a, b, master=master)
        res.update(seam(dec, a, b, blended(dec, a, b), master=master))
        qa[tid] = res
        print(tid, json.dumps(res))
        if png_dir:
            spectrogram(dec, a, b, tid, os.path.join(png_dir, f'{tid}.png'))
    json.dump(qa, open(qa_path, 'w'), indent=2)


if __name__ == '__main__':
    main()
