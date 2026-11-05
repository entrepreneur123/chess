"""Derive web-sized character art from the illustration masters in docs/brand/illust.
   python3 docs/brand/process-illust.py
   -> public/chars/{id}-lv{n}.jpg      540x720 card art
   -> public/chars/{id}-lv{n}-face.jpg 320x320 head-and-shoulders crop
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'docs/brand/illust'
OUT = ROOT / 'public/chars'
OUT.mkdir(parents=True, exist_ok=True)
# Face crop box as fractions of (w, h): left, top, right, bottom — heads sit in the upper-centre.
# A value may also be a {level: box} dict when the head moves between grades.
FACE = {
    'sad': (0.04, 0.03, 0.66, 0.46),
    'marki': (0.14, 0.06, 0.82, 0.56),
    'walk': (0.04, 0.06, 0.62, 0.46),
    'insaner': (0.12, 0.06, 0.70, 0.48),
    'brutile': {
        1: (0.326, 0.144, 0.728, 0.444),
        2: (0.343, 0.231, 0.744, 0.531),
        3: (0.312, 0.152, 0.714, 0.453),
    },
    # Grades 2-3 were generated from the grade-1 master as a reference, so the head stays put.
    'michelle': (0.285, 0.095, 0.775, 0.461),
    'picker': (0.26, 0.04, 0.72, 0.383),
    # Two forms with separate masters (illust-rakaeli-lv{n}, illust-rakaeli-awake-lv{n}).
    'rakaeli': (0.273, 0.017, 0.72, 0.36),
    'rakaeli-awake': (0.26, 0.017, 0.707, 0.36),
    # Grades 2-3 generated from the grade-1 master as a reference (2026-11-05).
    'rampid': (0.24, 0.06, 0.68, 0.39),
    'larhen': (0.28, 0.06, 0.70, 0.375),
    'volkonov': (0.30, 0.05, 0.72, 0.36),
    'verish': (0.23, 0.08, 0.61, 0.38),
}
for f in sorted(SRC.glob('illust-*.jpg')):
    name = f.stem.replace('illust-', '')  # sad-lv1
    cid = name.rsplit('-lv', 1)[0]  # sad, rakaeli-awake
    im = Image.open(f).convert('RGB')
    w, h = im.size
    card = im.resize((540, 720), Image.LANCZOS)
    card.save(OUT / f'{name}.jpg', quality=80, optimize=True, progressive=True)
    box = FACE[cid]
    if isinstance(box, dict):
        box = box[int(name.split('-lv')[1])]
    l, t, r, b = box
    box = (int(w * l), int(h * t), int(w * r), int(h * b))
    face = im.crop(box)
    side = min(face.size)
    fw, fh = face.size
    face = face.crop(((fw - side) // 2, 0, (fw - side) // 2 + side, side))
    face = face.resize((320, 320), Image.LANCZOS)
    face.save(OUT / f'{name}-face.jpg', quality=82, optimize=True, progressive=True)
    print('wrote', name, card.size, face.size)
