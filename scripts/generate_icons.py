"""Generate PWA icons (192, 512, maskable) as a stylized soccer ball.

One-shot script used during initial scaffolding; not part of cron.
Run: python3 scripts/generate_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ICONS_DIR = Path(__file__).resolve().parent.parent / "icons"
ICONS_DIR.mkdir(parents=True, exist_ok=True)

BG = (31, 78, 120, 255)        # WC navy
BG_DARK = (13, 17, 23, 255)    # near-black for maskable safe zone
BALL = (250, 250, 250, 255)
PANEL_DARK = (20, 24, 30, 255)


def draw_ball(size: int, *, bg=BG, padding_ratio: float = 0.12) -> Image.Image:
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)
    radius = (size - 2 * pad) // 2
    cx = cy = size // 2

    # White ball
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=BALL,
        outline=PANEL_DARK,
        width=max(2, size // 96),
    )

    # Central pentagon
    pent_r = radius * 0.30
    pent = [
        (cx + pent_r * math.cos(math.radians(-90 + i * 72)),
         cy + pent_r * math.sin(math.radians(-90 + i * 72)))
        for i in range(5)
    ]
    draw.polygon(pent, fill=PANEL_DARK)

    # Outer hex panels (simplified as small triangles radiating)
    panel_r_inner = radius * 0.55
    panel_r_outer = radius * 0.85
    for i in range(5):
        ang_center = -90 + i * 72
        a1 = math.radians(ang_center - 18)
        a2 = math.radians(ang_center + 18)
        tri = [
            (cx + panel_r_inner * math.cos(a1), cy + panel_r_inner * math.sin(a1)),
            (cx + panel_r_inner * math.cos(a2), cy + panel_r_inner * math.sin(a2)),
            (cx + panel_r_outer * math.cos(math.radians(ang_center)),
             cy + panel_r_outer * math.sin(math.radians(ang_center))),
        ]
        draw.polygon(tri, fill=PANEL_DARK)

    return img


def main() -> None:
    for size in (192, 512):
        img = draw_ball(size)
        img.save(ICONS_DIR / f"icon-{size}.png")

    # Maskable: 20% safe zone inset, dark navy background for adaptive crop
    maskable = draw_ball(512, bg=BG_DARK, padding_ratio=0.22)
    maskable.save(ICONS_DIR / "icon-maskable.png")

    print("wrote:", ", ".join(sorted(p.name for p in ICONS_DIR.glob("*.png"))))


if __name__ == "__main__":
    main()
