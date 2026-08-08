#!/usr/bin/env python3
"""Generate the Sophos geometric icon (sharp Sigma + green accent dot) as PNG/ICO.

Draws at 4x supersample then downscales with LANCZOS for crisp edges.
Writes the Tauri icon set into src-tauri/icons/ and a 512px master into
resources/icon.png.
"""
import os
from PIL import Image, ImageDraw

BG = (14, 14, 14)          # #0e0e0e
FG = (244, 244, 244)       # #f4f4f4
GREEN = (133, 237, 117)    # #85ed75

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "src-tauri", "icons")
RES = os.path.join(ROOT, "resources")


def draw_master(size):
    """Return a size x size RGBA image of the icon (supersampled 4x)."""
    ss = size * 4
    img = Image.new("RGBA", (ss, ss), BG + (255,))
    d = ImageDraw.Draw(img)
    # Geometry in 512-space, scaled to ss.
    s = ss / 512.0
    def R(x, y, w, h):
        return [x * s, y * s, (x + w) * s, (y + h) * s]
    # Sigma top bar
    d.rectangle(R(96, 128, 320, 48), fill=FG + (255,))
    # Sigma diagonal (parallelogram)
    d.polygon(
        [(416 * s, 128 * s), (416 * s, 176 * s), (96 * s, 384 * s), (96 * s, 336 * s)],
        fill=FG + (255,),
    )
    # Sigma bottom bar
    d.rectangle(R(96, 336, 320, 48), fill=FG + (255,))
    # Green accent dot
    d.rectangle(R(416, 64, 40, 40), fill=GREEN + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(RES, exist_ok=True)

    # Tauri icon set
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "256x256.png": 256,
        "icon.png": 512,
    }
    for name, size in sizes.items():
        draw_master(size).save(os.path.join(ICONS, name), "PNG")
        print("wrote", os.path.join(ICONS, name), size)

    # Multi-size ICO
    ico = Image.new("RGBA", (256, 256), BG + (255,))
    ico_sizes = [16, 32, 48, 64, 128, 256]
    frames = [draw_master(sz) for sz in ico_sizes]
    ico.save(
        os.path.join(ICONS, "icon.ico"),
        format="ICO",
        sizes=[(sz, sz) for sz in ico_sizes],
        append_images=frames[1:],
    )
    print("wrote", os.path.join(ICONS, "icon.ico"))

    # 512px master in resources/
    draw_master(512).save(os.path.join(RES, "icon.png"), "PNG")
    print("wrote", os.path.join(RES, "icon.png"), 512)


if __name__ == "__main__":
    main()
