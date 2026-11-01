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
FACE = {
    'sad': (0.22, 0.04, 0.82, 0.49),
    'marki': (0.12, 0.05, 0.84, 0.59),
    'walk': (0.14, 0.04, 0.76, 0.50),
}
for f in sorted(SRC.glob('illust-*.jpg')):
    name = f.stem.replace('illust-', '')  # sad-lv1
    cid = name.split('-')[0]
    im = Image.open(f).convert('RGB')
    w, h = im.size
    card = im.resize((540, 720), Image.LANCZOS)
    card.save(OUT / f'{name}.jpg', quality=80, optimize=True, progressive=True)
    l, t, r, b = FACE[cid]
    box = (int(w * l), int(h * t), int(w * r), int(h * b))
    face = im.crop(box)
    side = min(face.size)
    fw, fh = face.size
    face = face.crop(((fw - side) // 2, 0, (fw - side) // 2 + side, side))
    face = face.resize((320, 320), Image.LANCZOS)
    face.save(OUT / f'{name}-face.jpg', quality=82, optimize=True, progressive=True)
    print('wrote', name, card.size, face.size)
