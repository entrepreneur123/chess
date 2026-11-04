"""
Render, master and encode the GRID CLASH music loops (the arena tracks and the lobby theme).

Usage (from any directory):
  python docs/brand/audio/bgm/build_bgm.py [id ...] [--work DIR]

Needs: libfluidsynth 2.x (`apt install fluidsynth`), the FluidR3_GM SoundFont
(`apt install fluid-soundfont-gm`, MIT), ffmpeg, and numpy/scipy/pyloudnorm/soundfile.

Writes public/audio/bgm/<id>.m4a and docs/brand/audio/bgm/loops.json (loop points), and keeps the
mastered float WAVs in the work directory for QA (measure_bgm.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from bgm_lib import PAD, SR, Fluid, render_song  # noqa: E402
from tracks import SONGS  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.path.join(REPO, 'public', 'audio', 'bgm')
# Per-track AAC bitrate: as high as fits a ~660 KB budget (the brief caps files at ~700 KB), max 80 kb/s.
SIZE_BUDGET_KBIT = 5300
MAX_KBPS = 80


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    work = os.environ.get('BGM_WORK', '/tmp/bgm-work')
    if '--work' in sys.argv:
        work = sys.argv[sys.argv.index('--work') + 1]
        args = [a for a in args if a != work]
    os.makedirs(work, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    ids = args or list(SONGS)
    loops_path = os.path.join(HERE, 'loops.json')
    loops = json.load(open(loops_path)) if os.path.exists(loops_path) else {}
    fluid = Fluid()
    for tid in ids:
        t0 = time.time()
        song = SONGS[tid]()
        print(f'== {tid}: {song.key}, {song.bpm} BPM, {song.bars} bars')
        seg, info = render_song(song, fluid)
        wav = os.path.join(work, f'{tid}.wav')
        sf.write(wav, seg.T.astype(np.float32), SR, subtype='FLOAT')
        m4a = os.path.join(OUT, f'{tid}.m4a')
        kbps = min(MAX_KBPS, int(SIZE_BUDGET_KBIT / (seg.shape[1] / SR)))
        subprocess.run(
            ['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', f'{kbps}k', '-ar', str(SR),
             '-movflags', '+faststart', '-map_metadata', '-1', '-metadata', f'title=GRID CLASH - {tid}', m4a],
            check=True,
        )
        loops[tid] = {
            'bpm': song.bpm,
            'bars': song.bars,
            'key': song.key,
            'loopStart': PAD / SR,
            'loopEnd': (PAD + info['loop_samples']) / SR,
            'loopSamples': info['loop_samples'],
            'sampleRate': SR,
            'kbps': kbps,
        }
        print(f'   loop {info["loop_seconds"]:.3f}s  TP(master) {info["true_peak_dbtp"]:.2f} dBTP  '
              f'size {os.path.getsize(m4a) / 1024:.0f} KiB  ({time.time() - t0:.0f}s)')
        json.dump(loops, open(loops_path, 'w'), indent=2)


if __name__ == '__main__':
    main()
