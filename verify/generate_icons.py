"""P6 icon regeneration: monotone black & white brand mark (a bold bolt glyph).

Produces, in src-tauri/icons/:
  - icon.png        (512)   black glyph on transparent
  - 32x32.png       (32)
  - 128x128.png     (128)
  - 128x128@2x.png  (256)
  - 256x256.png     (256)
  - icon.ico        multi-size 16/24/32/48/64/128/256  (what Tauri expects)

The mark is pure black (#000) on transparent. For dark backgrounds the
frontend uses a white chip with a black glyph (see SystemBar), which is the
"white variant for dark backgrounds" called out in the brief.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(HERE, "..", "src-tauri", "icons")
BLACK = (0, 0, 0, 255)


def draw_bolt(size):
    """Render a bold lightning-bolt glyph on a transparent canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    # Bolt polygon in normalized coords (x, y) then scaled.
    # A thick, slightly skewed bolt that fills most of the canvas.
    pts = [
        (0.62, 0.04), (0.14, 0.56), (0.42, 0.56), (0.36, 0.96),
        (0.88, 0.40), (0.58, 0.40), (0.66, 0.04),
    ]
    poly = [(x * s, y * s) for (x, y) in pts]
    d.polygon(poly, fill=BLACK)
    return img


def save_png(img, name):
    path = os.path.join(ICONS, name)
    img.save(path)
    print(f"  wrote {name} {img.size}")
    return path


def main():
    os.makedirs(ICONS, exist_ok=True)
    base = draw_bolt(512)
    save_png(base, "icon.png")
    save_png(base.resize((32, 32), Image.LANCZOS), "32x32.png")
    save_png(base.resize((128, 128), Image.LANCZOS), "128x128.png")
    save_png(base.resize((256, 256), Image.LANCZOS), "128x128@2x.png")
    save_png(base.resize((256, 256), Image.LANCZOS), "256x256.png")

    # Multi-size .ico (Tauri bundles whatever is present; include the common set).
    # Canonical Pillow approach: pass the base image + sizes; Pillow resizes internally.
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_path = os.path.join(ICONS, "icon.ico")
    base.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"  wrote icon.ico {[s[0] for s in ico_sizes]}")
    print("DONE")


if __name__ == "__main__":
    main()
