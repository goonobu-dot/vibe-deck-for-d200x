#!/usr/bin/env python3
"""Codex Micro–inspired status tiles: color + glyph + clear Japanese label."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 144
HOME = Path.home()
ROOT = Path(__file__).resolve().parents[1]

FONT_PATHS = [
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"),
    Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
]

THEMES = {
    "idle": {
        "bg": (245, 246, 248),
        "fg": (55, 60, 70),
        "soft": (210, 214, 220),
        "label": "Idle",
        "kind": "idle",
    },
    "thinking": {
        "bg": (37, 99, 235),
        "fg": (255, 255, 255),
        "soft": (147, 197, 253),
        "label": "Thinking",
        "kind": "think",
    },
    "done": {
        "bg": (22, 163, 74),
        "fg": (255, 255, 255),
        "soft": (134, 239, 172),
        "label": "Done",
        "kind": "check",
    },
    "needs_input": {
        "bg": (245, 158, 11),
        "fg": (255, 255, 255),
        "soft": (253, 230, 138),
        "label": "Input",
        "kind": "ask",
    },
    "error": {
        "bg": (239, 68, 68),
        "fg": (255, 255, 255),
        "soft": (254, 202, 202),
        "label": "Error",
        "kind": "error",
    },
    "empty": {
        # Unused lane — shown as Ready (not "Empty") so slots stay useful.
        "bg": (58, 58, 62),
        "fg": (190, 190, 196),
        "soft": (90, 90, 96),
        "label": "Ready",
        "kind": "empty",
    },
}

OUTS = [
    ROOT / "assets" / "icons",
    ROOT / "plugin" / "com.vibe.deck.status.ulanziPlugin" / "Images",
    HOME
    / "Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.vibe.deck.status.ulanziPlugin/Images",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_PATHS:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size, index=0)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded_bg(color: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=26, fill=(*color, 255))
    # frosted top gloss
    gloss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gloss)
    gdraw.rounded_rectangle((2, 2, SIZE - 3, 48), radius=22, fill=(255, 255, 255, 38))
    img = Image.alpha_composite(img, gloss)
    return img


def draw_glyph(draw: ImageDraw.ImageDraw, kind: str, fg, soft) -> None:
    cx, cy = 72, 54
    if kind == "idle":
        draw.rounded_rectangle((cx - 18, cy - 16, cx - 6, cy + 16), radius=4, fill=fg)
        draw.rounded_rectangle((cx + 6, cy - 16, cx + 18, cy + 16), radius=4, fill=fg)
    elif kind == "think":
        # orbiting spark — Codex Micro "alive" cue
        draw.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), outline=soft, width=5)
        draw.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), fill=fg)
        draw.ellipse((cx + 16, cy - 20, cx + 26, cy - 10), fill=fg)
        draw.ellipse((cx - 28, cy + 8, cx - 20, cy + 16), fill=soft)
    elif kind == "check":
        # thick check
        pts = [(40, 58), (62, 78), (108, 34)]
        draw.line(pts, fill=fg, width=10, joint="curve")
    elif kind == "ask":
        draw.rounded_rectangle((cx - 30, cy - 26, cx + 30, cy + 12), radius=16, fill=fg)
        draw.polygon([(cx - 8, cy + 10), (cx + 10, cy + 10), (cx - 2, cy + 28)], fill=fg)
        qfont = load_font(36)
        qb = draw.textbbox((0, 0), "?", font=qfont)
        qw, qh = qb[2] - qb[0], qb[3] - qb[1]
        draw.text((cx - qw / 2, cy - 18 - qh / 2), "?", font=qfont, fill=soft)
    elif kind == "error":
        draw.polygon([(cx, cy - 28), (cx + 30, cy + 22), (cx - 30, cy + 22)], fill=fg)
        draw.rectangle((cx - 4, cy - 10, cx + 4, cy + 6), fill=soft)
        draw.ellipse((cx - 4, cy + 10, cx + 4, cy + 18), fill=soft)
    elif kind == "empty":
        draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), outline=fg, width=4)
        draw.line((cx - 12, cy, cx + 12, cy), fill=fg, width=4)


def render(theme: dict) -> Image.Image:
    img = rounded_bg(theme["bg"])
    draw = ImageDraw.Draw(img)
    draw_glyph(draw, theme["kind"], theme["fg"], theme["soft"])

    font = load_font(22)
    label = theme["label"]
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (SIZE - tw) / 2
    y = SIZE - 28 - th / 2
    # Single English label only (no shadow / no JP) — Studio title is cleared separately.
    draw.text((x, y), label, font=font, fill=theme["fg"])

    # subtle outer edge
    edge = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle((1, 1, SIZE - 2, SIZE - 2), radius=25, outline=(255, 255, 255, 35), width=2)
    return Image.alpha_composite(img, edge)


def render_nav(kind: str, bg: tuple[int, int, int], fg: tuple[int, int, int]) -> Image.Image:
    img = rounded_bg(bg)
    draw = ImageDraw.Draw(img)
    cx, cy = SIZE // 2, SIZE // 2 - 6
    if kind in ("nav-prev", "page-prev"):
        draw.polygon([(cx + 18, cy - 28), (cx - 22, cy), (cx + 18, cy + 28)], fill=fg)
    else:
        draw.polygon([(cx - 18, cy - 28), (cx + 22, cy), (cx - 18, cy + 28)], fill=fg)
    label = {
        "nav-prev": "Prev",
        "nav-next": "Next",
        "page-prev": "Pg-",
        "page-next": "Pg+",
    }[kind]
    font = load_font(20)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, SIZE - 34), label, font=font, fill=fg)
    return img


def main() -> None:
    for d in OUTS:
        d.mkdir(parents=True, exist_ok=True)
    for name, theme in THEMES.items():
        img = render(theme)
        for d in OUTS:
            path = d / f"agent-{name}.png"
            img.save(path, format="PNG")
            print("wrote", path)
        if name == "thinking":
            for d in OUTS[1:]:
                img.save(d / "plugin.png")
        if name == "done":
            for d in OUTS[1:]:
                img.save(d / "category.png")

    nav_specs = {
        "nav-prev": ((30, 41, 59), (226, 232, 240)),
        "nav-next": ((30, 41, 59), (226, 232, 240)),
        "page-prev": ((15, 23, 42), (147, 197, 253)),
        "page-next": ((15, 23, 42), (147, 197, 253)),
    }
    for name, (bg, fg) in nav_specs.items():
        img = render_nav(name, bg, fg)
        for d in OUTS:
            path = d / f"{name}.png"
            img.save(path, format="PNG")
            print("wrote", path)
    print("done")


if __name__ == "__main__":
    main()
