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
        1: (0.27, 0.11, 0.67, 0.41),
        2: (0.25, 0.17, 0.75, 0.55),
        3: (0.24, 0.10, 0.76, 0.49),
    },
}
for f in sorted(SRC.glob('illust-*.jpg')):
    name = f.stem.replace('illust-', '')  # sad-lv1
    cid = name.split('-')[0]
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
