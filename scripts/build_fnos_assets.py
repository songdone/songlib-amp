"""Build deterministic fnOS icon assets from the existing SongLib mark."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend" / "public" / "icon-512.png"
PACKAGE = ROOT / "packaging" / "fnos" / "songlib-amp"


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build_icon(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    radius = round(canvas_size * 0.22)
    mask = rounded_mask(canvas_size, radius)

    background = Image.new("RGBA", (canvas_size, canvas_size), (9, 11, 16, 255))
    pixels = background.load()
    for y in range(canvas_size):
        for x in range(canvas_size):
            t = (x + y) / max(1, (canvas_size - 1) * 2)
            glow = max(0.0, 1.0 - (((x / canvas_size) - 0.22) ** 2 + ((y / canvas_size) - 0.14) ** 2) ** 0.5 * 2.5)
            pixels[x, y] = (
                round(10 + 15 * t + 10 * glow),
                round(12 + 10 * t + 7 * glow),
                round(18 + 16 * t + 2 * glow),
                255,
            )

    glass = Image.new("RGBA", background.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glass)
    inset = round(canvas_size * 0.035)
    gdraw.rounded_rectangle(
        (inset, inset, canvas_size - inset - 1, canvas_size - inset - 1),
        radius=max(1, radius - inset),
        outline=(255, 255, 255, 45),
        width=max(1, round(canvas_size * 0.008)),
    )
    gdraw.ellipse(
        (-canvas_size * 0.12, -canvas_size * 0.28, canvas_size * 0.86, canvas_size * 0.54),
        fill=(255, 255, 255, 16),
    )
    glass = glass.filter(ImageFilter.GaussianBlur(max(1, round(canvas_size * 0.018))))
    background.alpha_composite(glass)

    mark = Image.open(SOURCE).convert("RGBA")
    mark_size = round(canvas_size * 0.68)
    mark.thumbnail((mark_size, mark_size), Image.Resampling.LANCZOS)
    x = (canvas_size - mark.width) // 2
    y = (canvas_size - mark.height) // 2 + round(canvas_size * 0.015)

    shadow = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    shadow_alpha = mark.getchannel("A").filter(ImageFilter.GaussianBlur(max(2, round(canvas_size * 0.018))))
    shadow.putalpha(shadow_alpha.point(lambda value: round(value * 0.42)))
    background.alpha_composite(shadow, (x, y + round(canvas_size * 0.025)))
    background.alpha_composite(mark, (x, y))
    background.putalpha(mask)

    return background.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ui_dir = PACKAGE / "app" / "ui" / "images"
    ui_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        PACKAGE / "ICON.PNG": 64,
        PACKAGE / "ICON_256.PNG": 256,
        ui_dir / "icon_64.png": 64,
        ui_dir / "icon_256.png": 256,
    }
    for path, size in outputs.items():
        build_icon(size).convert("RGB").save(path, format="PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
