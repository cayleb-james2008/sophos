"""P6 verification: confirm all app icons are monotone black & white (no hue).

Prints, for each icon file, the distinct opaque colors found and flags any
that carry color (saturation above a small epsilon). Passes when no icon
contains a colored pixel (all are pure gray/black/white + alpha).
"""
import os
import sys
from PIL import Image

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
FILES = ["icon.ico", "icon.png", "32x32.png", "128x128.png", "128x128@2x.png", "256x256.png"]


def is_colorful(r, g, b):
    mx = max(r, g, b)
    mn = min(r, g, b)
    return (mx - mn) > 12  # saturation epsilon


def check(path):
    img = Image.open(path).convert("RGBA")
    colored = set()
    opaque = set()
    total = 0
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            total += 1
            if a > 0:
                opaque.add((r >> 4 << 4, g >> 4 << 4, b >> 4 << 4))
                if is_colorful(r, g, b):
                    colored.add((r, g, b))
    return total, opaque, colored


def main():
    fail = False
    for f in FILES:
        p = os.path.join(ICON_DIR, f)
        if not os.path.exists(p):
            print(f"  MISSING {f}")
            fail = True
            continue
        total, opaque, colored = check(p)
        status = "OK" if not colored else "COLOR FOUND"
        if colored:
            fail = True
        # Show a compact unique-opaque-color palette
        palette = ", ".join(f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in sorted(opaque)) or "transparent-only"
        print(f"  {f:<18} {img_size(p):<10} opaque_colors=[{palette}]  colored_pixels={len(colored)}  {status}")
    print("\nRESULT:", "FAIL — non-monochrome color detected" if fail else "PASS — all icons monotone black & white")
    return 1 if fail else 0


def img_size(path):
    im = Image.open(path)
    return f"{im.width}x{im.height}"


if __name__ == "__main__":
    sys.exit(main())
