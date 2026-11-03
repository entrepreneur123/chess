"""Post-process generated backdrop sources into 1080x1920 masters + WebP for public/bg/.

usage (from the repo root):
  python3 docs/brand/bg/process-bg.py lobby docs/brand/bg/generated/lobby-raw.jpg /tmp/lobby 88 "28,1028;1052,1028"
  python3 docs/brand/bg/process-bg.py match docs/brand/bg/generated/match-raw.jpg /tmp/match 88
  python3 docs/brand/bg/process-bg.py mm    docs/brand/bg/generated/matchmaking-raw.jpg /tmp/matchmaking 88
writes <out_prefix>.png (lossless master) and <out_prefix>.webp; copy them to docs/brand/bg/ and public/bg/.
The optional 5th argument places gold flame accents (x,y in the 1080x1920 frame; lobby only).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

W, H = 1080, 1920
NIGHT0 = np.array([0x07, 0x0a, 0x12], np.float32) / 255.0
NIGHT1 = np.array([0x0d, 0x13, 0x22], np.float32) / 255.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid():
    v, u = np.mgrid[0:H, 0:W].astype(np.float32)
    return u / (W - 1), v / (H - 1)


def soft_rect(u, v, cx, cy, rx, ry, p=4.0, feather=0.35):
    """1 inside a superellipse of radii (rx, ry), fading to 0 over `feather` (relative)."""
    d = (np.abs(u - cx) / rx) ** p + (np.abs(v - cy) / ry) ** p
    d = d ** (1.0 / p)
    return 1.0 - smoothstep(1.0 - feather, 1.0 + feather, d)


def load(src):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    scale = W / w
    nh = round(h * scale)
    if nh < H:
        scale = H / h
    nw, nh = round(w * scale), round(h * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    l, t = (nw - W) // 2, (nh - H) // 2
    im = im.crop((l, t, l + W, t + H))
    # Gentle sharpening to offset the ~1.4x upscale.
    im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=40, threshold=2))
    return im


def to_f(im):
    return np.asarray(im, np.float32) / 255.0


def lum(a):
    return a[..., 0:1] * 0.2126 + a[..., 1:2] * 0.7152 + a[..., 2:3] * 0.0722


def grade(a, desat=0.15, tint=(0.80, 0.86, 1.18), tint_amt=0.35, warm_keep=0.6):
    """Pull toward cool blue/violet, but keep bright warm highlights (candles, torches) gold."""
    L = lum(a)
    sat_mix = a * (1 - desat) + L * desat
    tinted = sat_mix * np.array(tint, np.float32)
    # Protect warm, bright pixels (gold accents) from the cool tint.
    warm = np.clip((a[..., 0:1] - a[..., 2:3]) * 4.0, 0, 1) * smoothstep(0.25, 0.6, L)
    amt = tint_amt * (1 - warm * warm_keep)
    return np.clip(sat_mix * (1 - amt) + tinted * amt, 0, 1)


def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    return to_f(im.filter(ImageFilter.GaussianBlur(r)))


def lift(a, floor=NIGHT0):
    return floor + a * (1 - floor)


def vignette(a, u, v, amt=0.45, start=0.45, end=1.05):
    r = np.sqrt(((u - 0.5) / 0.5) ** 2 * 0.85 + ((v - 0.5) / 0.5) ** 2 * 0.6)
    return a * (1 - amt * smoothstep(start, end, r))[..., None]


def finish(a, out, q, grain=0.9, seed=7):
    rng = np.random.default_rng(seed)
    # Fine luminance grain hides 8-bit banding in the long dark gradients.
    n = rng.normal(0, grain / 255.0, (H, W, 1)).astype(np.float32)
    a = np.clip(a + n, 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')
    im.save(out + '.png', optimize=True)
    im.save(out + '.webp', 'WEBP', quality=q, method=6)
    return im


# ---------------------------------------------------------------------------------------------
def warm_mask(a):
    L = lum(a)
    return np.clip((a[..., 0:1] - a[..., 2:3]) * 5.0, 0, 1) * smoothstep(0.30, 0.65, L)


def preset_lobby(a, u, v):
    keep = a.copy()          # ungraded: flames keep their own gold
    wm = warm_mask(a)
    a = grade(a, desat=0.18, tint_amt=0.40)
    # Calm the middle band (UI panels) and the lower third (big gold CTA) - flatten detail first.
    calm = np.maximum(soft_rect(u, v, 0.5, 0.60, 0.46, 0.22, p=3, feather=0.5) * 0.55,
                      smoothstep(0.58, 0.82, v))
    a = a * (1 - calm[..., None] * 0.6) + blur(a, 10) * (calm[..., None] * 0.6)
    dark = 0.38 * soft_rect(u, v, 0.5, 0.57, 0.48, 0.20, p=3, feather=0.6) + 0.50 * smoothstep(0.62, 1.0, v)
    a = a * (1 - np.clip(dark, 0, 0.7))[..., None]
    a = vignette(a, u, v, amt=0.50)
    # Restore the small candle/torch flames (and their halo) that the darkening swallowed.
    halo = blur(wm.repeat(3, axis=2), 18)[..., 0:1]
    glow = np.array([0.95, 0.68, 0.28], np.float32) * np.clip(halo * 3.0, 0, 1) * 0.10
    a = a * (1 - wm * 0.9) + keep * (wm * 0.9) + glow
    for (fx, fy) in FLAMES:
        a = gold_flame(a, u, v, fx, fy)
    return lift(np.clip(a, 0, 1))


# Brazier flame positions in the 1080x1920 frame of lobby-d (hand-placed accents).
FLAMES = []
GOLD = np.array([0xf2, 0xc1, 0x4e], np.float32) / 255.0


def gold_flame(a, u, v, fx, fy, core=16, halo=70):
    d = np.sqrt(((u * (W - 1)) - fx) ** 2 + ((v * (H - 1)) - fy) ** 2)
    mc = np.exp(-(d / core) ** 2)[..., None]
    mh = np.exp(-(d / halo) ** 2)[..., None]
    L = lum(a)
    a = a * (1 - mc * 0.85) + np.clip(L * 1.25 + 0.05, 0, 1) * GOLD * (mc * 0.85)
    return a + GOLD * mh * 0.07


def preset_match(a, u, v):
    a = grade(a, desat=0.25, tint_amt=0.35)
    # Board band: ~70% width x 45% height, centred slightly above middle. Make it flat and dark.
    band = soft_rect(u, v, 0.5, 0.46, 0.40, 0.26, p=4, feather=0.30)
    a = a * (1 - band[..., None] * 0.75) + blur(a, 14) * (band[..., None] * 0.75)
    a = a * (1 - 0.50 * band)[..., None]
    # Lower the overall contrast so nothing competes with tokens.
    m = a.mean(axis=(0, 1), keepdims=True)
    a = m + (a - m) * 0.82
    a = vignette(a, u, v, amt=0.50, start=0.5)
    return lift(a)


def preset_mm(a, u, v):
    a = grade(a, desat=0.10, tint_amt=0.12, warm_keep=1.0)
    mid = soft_rect(u, v, 0.5, 0.5, 0.42, 0.14, p=3, feather=0.6)
    a = a * (1 - 0.25 * mid)[..., None]
    # Tone down the bright rune discs that sit on the left/right edges at mid height.
    sides = smoothstep(0.30, 0.48, np.abs(u - 0.5)) * soft_rect(u, v, 0.5, 0.5, 1.0, 0.16, p=2, feather=0.6)
    a = a * (1 - 0.35 * sides)[..., None]
    a = vignette(a, u, v, amt=0.45)
    return lift(a)


PRESETS = {'lobby': preset_lobby, 'match': preset_match, 'mm': preset_mm}

if __name__ == '__main__':
    preset, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    if len(sys.argv) > 5:  # optional flame list "x,y;x,y"
        FLAMES[:] = [tuple(map(float, p.split(','))) for p in sys.argv[5].split(';')]
    q = int(sys.argv[4]) if len(sys.argv) > 4 else 80
    u, v = grid()
    a = to_f(load(src))
    a = PRESETS[preset](a, u, v)
    finish(a, out, q)
    import os
    print(out, os.path.getsize(out + '.webp') // 1024, 'KB webp')
