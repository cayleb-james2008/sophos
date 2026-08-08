"""Render a proof sheet of the regenerated icons (on white + dark) for visual evidence."""
import os
from PIL import Image

ICONS = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
OUT = os.path.join(os.path.dirname(__file__), "icons-proof.png")

files = ["icon.png", "128x128.png", "32x32.png", "256x256.png"]
tile = 160
margin = 16
cols = len(files) * 2  # light + dark
rows = 1
sheet = Image.new("RGBA", (cols * tile + margin * (cols + 1), rows * tile + margin * 2), (30, 30, 36, 255))
bg_colors = [(255, 255, 255, 255), (18, 18, 24, 255)]
for f in files:
    img = Image.open(os.path.join(ICONS, f)).convert("RGBA")
    img.thumbnail((tile - 24, tile - 24), Image.LANCZOS)
    for bi, bg in enumerate(bg_colors):
        col = files.index(f) * 2 + bi
        x = margin + col * (tile + margin)
        y = margin
        # paste on a tile background
        tile_bg = Image.new("RGBA", (tile, tile), bg)
        sheet.paste(tile_bg, (x, y))
        ox = x + (tile - img.width) // 2
        oy = y + (tile - img.height) // 2
        sheet.paste(img, (ox, oy), img)
sheet.save(OUT)
print("wrote", OUT, sheet.size)
