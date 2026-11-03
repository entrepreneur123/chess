"""Post-process arena art into public/arenas/<id>/bg.webp and card.webp.

usage (from the repo root):
  python3 docs/brand/arenas/process-arena.py <out_dir> [arena ...]
  python3 docs/brand/arenas/process-arena.py /tmp/arena-out            # all six
  python3 docs/brand/arenas/process-arena.py /tmp/arena-out apex       # one arena

For every arena it writes <out_dir>/<id>/bg.png + bg.webp (1080x1920) and card.png + card.webp
(1080x900). The PNGs are the lossless masters; the WebPs are what ships. Copy the WebPs to
public/arenas/<id>/. The script is deterministic: the same raw files give the same bytes.

It reuses the helpers of docs/brand/bg/process-bg.py (resize/crop, superellipse masks, blur,
vignette, black-point lift) so the arena art and the original backdrops share one pipeline.
"""
import importlib.util
import io
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('process_bg', os.path.join(HERE, '..', 'bg', 'process-bg.py'))
bg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bg)

W, H = bg.W, bg.H            # 1080x1920 backdrop
CW, CH = 1080, 900           # card, 6:5 (shown at about 360x300 CSS px, 3x on the densest phones)
BG_BUDGET = 250 * 1024
CARD_BUDGET = 200 * 1024
GEN = os.path.join(HERE, 'generated')
BG_GEN = os.path.join(HERE, '..', 'bg', 'generated')

# Per-arena sources and the few knobs that differ. Everything else is shared.
#   bg/card: raw generation (JPEG as returned by the tool)
#   card_x/card_y: where the 6:5 card window sits in the raw frame (0 = left/top, 1 = right/bottom)
#   knee: luminance above which highlights are compressed (lower = calmer bright edges)
#   zoom: optional card window size relative to the largest 6:5 window (< 1 frames tighter)
#   bg_exposure / card_exposure / bottom_dim: optional levelling for arenas that came out brighter
ARENAS = {
    'moonrune':   dict(bg=os.path.join(BG_GEN, 'match-raw.jpg'), card=os.path.join(BG_GEN, 'lobby-raw.jpg'),
                       card_x=0.5, card_y=0.06, knee=0.55),
    'emberforge': dict(bg='emberforge-bg-c.jpg', card='emberforge-card-a.jpg', card_x=0.5, card_y=0.0, knee=0.42),
    'blightmire': dict(bg='blightmire-bg-c.jpg', card='blightmire-card-a.jpg', card_x=0.5, card_y=0.0, knee=0.45),
    'frostkeep':  dict(bg='frostkeep-bg-b.jpg', card='frostkeep-card-a.jpg', card_x=0.6, card_y=0.0, knee=0.45,
                       bg_exposure=0.75, card_exposure=0.85),
    'madcrown':   dict(bg='madcrown-bg-c.jpg', card='madcrown-card-a.jpg', card_x=0.5, card_y=0.0, knee=0.45),
    'apex':       dict(bg='apex-bg-d.jpg', card='apex-card-a.jpg', card_x=0.98, card_y=0.3, zoom=0.82, knee=0.50,
                       bottom_dim=0.30),
}

lum, smoothstep, soft_rect, blur, lift, vignette = bg.lum, bg.smoothstep, bg.soft_rect, bg.blur, bg.lift, bg.vignette
NIGHT1 = bg.NIGHT1


def src_path(p):
    return p if os.path.isabs(p) else os.path.join(GEN, p)


def unify(a, desat, navy):
    """Shared grade: a little desaturation, and the deepest shadows pulled toward night-1 navy,
    so every arena's blacks match the navy board and UI panels while mid-tones keep their hue."""
    L = lum(a)
    a = a * (1 - desat) + L * desat
    w = navy * (1 - smoothstep(0.0, 0.22, L))
    return a * (1 - w) + NIGHT1 * w


def compress_highlights(a, knee, slope=0.45):
    """Soft-clip luminance above `knee` (hue kept), so lava/ice/flames at the edges glow but never
    outshine the board, tokens and HUD."""
    L = np.maximum(lum(a), 1e-4)
    target = np.where(L > knee, knee + (L - knee) * slope, L)
    return np.clip(a * (target / L), 0, 1)


def grid(w, h):
    v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    return u / (w - 1), v / (h - 1)


# ---------------------------------------------------------------------------------------------
def make_bg(cfg):
    u, v = bg.grid()
    a = bg.to_f(bg.load(src_path(cfg['bg'])))
    a = unify(a, desat=0.12, navy=0.30)
    a = compress_highlights(a, cfg['knee'])
    # Board band (the CSS shows this layer at "center 46% / cover"): flatten and darken it.
    band = soft_rect(u, v, 0.5, 0.46, 0.42, 0.27, p=4, feather=0.30)
    a = a * (1 - band[..., None] * 0.75) + blur(a, 14) * (band[..., None] * 0.75)
    a = a * (1 - 0.45 * band)[..., None]
    # Lower the overall contrast so nothing competes with tokens.
    m = a.mean(axis=(0, 1), keepdims=True)
    a = m + (a - m) * 0.85
    a = vignette(a, u, v, amt=0.45, start=0.5)
    # Per-arena levelling so all six sit at about the same brightness (measured, see README).
    a = a * cfg.get('bg_exposure', 1.0) * (1 - cfg.get('bottom_dim', 0.0) * smoothstep(0.70, 1.0, v))[..., None]
    return lift(np.clip(a, 0, 1))


def load_card(cfg):
    im = Image.open(src_path(cfg['card'])).convert('RGB')
    w, h = im.size
    # Largest 6:5 window inside the raw frame (the moonrune lobby raw is portrait: use full width).
    cw = round(min(w, round(h * CW / CH)) * cfg.get('zoom', 1.0))
    ch = round(cw * CH / CW)
    l = round((w - cw) * cfg['card_x'])
    t = round((h - ch) * cfg['card_y'])
    im = im.crop((l, t, l + cw, t + ch)).resize((CW, CH), Image.LANCZOS)
    if cw < CW:  # upscaled (moonrune, zoomed apex): offset the softening like process-bg.py does
        im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=40, threshold=2))
    return bg.to_f(im)


def make_card(cfg):
    u, v = grid(CW, CH)
    a = load_card(cfg)
    a = unify(a, desat=0.06, navy=0.20)
    a = compress_highlights(a, max(cfg['knee'], 0.55), slope=0.6)
    # Darker lower third for the arena name, and a light top shade for the frame brackets.
    dark = 0.62 * smoothstep(0.52, 1.0, v) + 0.22 * (1 - smoothstep(0.0, 0.16, v))
    a = a * (1 - dark)[..., None]
    a = vignette(a, u, v, amt=0.35, start=0.55)
    a = a * cfg.get('card_exposure', 1.0)
    return lift(np.clip(a, 0, 1))


# ---------------------------------------------------------------------------------------------
def encode(a, out, budget, seed=7, q_max=90, q_min=50):
    """Grain + PNG master + WebP at the highest quality (step 2) that fits the budget."""
    h, w = a.shape[:2]
    rng = np.random.default_rng(seed)
    a = np.clip(a + rng.normal(0, 0.9 / 255.0, (h, w, 1)).astype(np.float32), 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')
    im.save(out + '.png', optimize=True)
    for q in range(q_max, q_min - 1, -2):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= budget:
            break
    with open(out + '.webp', 'wb') as f:
        f.write(buf.getvalue())
    return q, buf.tell()


if __name__ == '__main__':
    out_dir = sys.argv[1]
    ids = sys.argv[2:] or list(ARENAS)
    for aid in ids:
        cfg = ARENAS[aid]
        d = os.path.join(out_dir, aid)
        os.makedirs(d, exist_ok=True)
        qb, sb = encode(make_bg(cfg), os.path.join(d, 'bg'), BG_BUDGET)
        qc, sc = encode(make_card(cfg), os.path.join(d, 'card'), CARD_BUDGET)
        print(f'{aid:11s} bg q{qb} {sb / 1024:6.1f} KB   card q{qc} {sc / 1024:6.1f} KB')
