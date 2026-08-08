#!/usr/bin/env python3
"""Generate the Prime Agent app icon — v2.

Design review of v1 found:
  - Bolt is well-centered (52% x 84% of tile) but thin, so it collapses to a
    thin line at 16px (poor small-size legibility).
  - Tile is a flat vertical gradient — reads as generic.

v2 improvements:
  - Bolder bolt (thicker stroke, wider silhouette) for small-size legibility.
  - Subtle radial glow behind the bolt for depth.
  - Slightly larger bolt footprint (better 16px presence).
  - Inner edge highlight on the tile for a premium, dimensional feel.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

BG_TOP = (127, 91, 213)      # accent #7f5bd5
BG_BOTTOM = (91, 59, 176)    # deeper violet
BOLT = (255, 255, 255)
GLOW = (147, 112, 232)       # accentHover
EDGE = (180, 150, 240)

def draw_icon(size: int) -> Image.Image:
    # ---- Tile: rounded square with vertical gradient ----
    radius = int(size * 0.22)
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    # ---- Inner edge highlight (premium dimensional feel) ----
    edge = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, outline=EDGE + (70,), width=max(1, int(size * 0.015)))
    img = Image.alpha_composite(img, edge)

    # ---- Radial glow behind the bolt ----
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd2 = ImageDraw.Draw(glow)
    glow_r = int(size * 0.42)
    gd2.ellipse([size//2 - glow_r, size//2 - glow_r, size//2 + glow_r, size//2 + glow_r], fill=GLOW + (70,))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.06))
    img = Image.alpha_composite(img, glow)

    # ---- Bolder lightning bolt ----
    # Wider, chunkier silhouette (0..100 space). Thicker segments.
    bolt = [
        (58, 6), (22, 58), (44, 58), (36, 94), (78, 38), (54, 38),
    ]
    pts = [(x / 100 * size, y / 100 * size) for x, y in bolt]
    d = ImageDraw.Draw(img)
    # Draw a slightly larger dark-violet outline first for a crisp edge.
    outline_pts = [(x / 100 * size, y / 100 * size) for x, y in bolt]
    d.polygon(outline_pts, fill=(70, 40, 140, 255))
    # Then the white bolt inset slightly for a bold, dimensional look.
    inset = [(x / 100 * size, y / 100 * size) for x, y in bolt]
    d.polygon(inset, fill=BOLT + (255,))

    return img

def main():
    master = draw_icon(1024)
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "256x256.png": 256,
        "icon.png": 512,
    }
    for name, s in sizes.items():
        master.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, name))
        print(f"wrote {name} ({s}x{s})")
    ico_sizes = [16, 32, 48, 256]
    ico_imgs = [master.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    ico_imgs[-1].save(os.path.join(OUT, "icon.ico"), format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_imgs[:-1])
    print("wrote icon.ico")

if __name__ == "__main__":
    main()
