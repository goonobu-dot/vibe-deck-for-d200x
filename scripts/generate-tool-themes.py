#!/usr/bin/env python3
"""Per-tool command-key icon themes for Codex / Cursor / Claude Code."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 144
ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home()
FONT_PATHS = [
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
]

# Distinct AI-tool looks (not shared terminal clone).
TOOL_THEMES = {
    "codex": {
        "bg": (10, 18, 22),
        "fg": (236, 253, 245),
        "accent": (45, 212, 191),
        "soft": (19, 78, 74),
        "motif": "chat",
    },
    "cursor": {
        "bg": (12, 16, 28),
        "fg": (241, 245, 249),
        "accent": (96, 165, 250),
        "soft": (30, 58, 138),
        "motif": "caret",
    },
    "claude": {
        "bg": (28, 20, 36),
        "fg": (255, 247, 237),
        "accent": (251, 146, 60),
        "soft": (120, 53, 15),
        "motif": "spark",
    },
}

COMMANDS = [
    ("accept", "Accept", "check"),
    ("reject", "Reject", "x"),
    ("new", "New", "plus"),
    ("stop", "Stop", "stop"),
    ("model", "Model", "sliders"),
    ("dictation", "Voice", "mic"),
    ("terminal", "Term", "term"),
    ("diff", "Diff", "diff"),
    ("composer", "Compose", "compose"),
    ("agent", "Agent", "bot"),
    ("design", "Design", "pen"),
    ("implement", "Build", "code"),
    ("review", "Review", "eye"),
    ("fix", "Fix", "wrench"),
    ("test", "Test", "flask"),
    ("explain", "Explain", "book"),
    ("commit", "Commit", "git"),
    ("summary", "Summary", "list"),
    ("refresh", "Refresh", "refresh"),
    ("settings", "Settings", "gear"),
    ("close", "Close", "x"),
    ("help", "Help", "ask"),
    ("profile", "Profile", "layers"),
    ("focus", "Focus", "focus"),
    # Unified layout (plan.md) additions
    ("plan", "Plan", "plan"),
    ("refactor", "Refactor", "cycle"),
    ("mode", "Mode", "toggle"),
    ("skills", "Skills", "arrow"),
    ("quick", "Quick", "bolt"),
    ("fast", "Fast", "bolt"),
    ("context", "Context", "context"),
    ("inline", "Inline", "inline"),
    ("sidechat", "SideChat", "sidechat"),
    ("effort", "Effort", "gauge"),
    ("browser", "Browser", "globe"),
    ("voice", "Voice", "mic"),
    ("lane", "Lane", "lanes"),
    ("autonomy", "Autonomy", "gauge"),
    ("tool", "Tool", "layers"),
    # Page 4 "Commands" additions
    ("goal", "Goal", "flag"),
    ("continue", "Cont", "play"),
    ("fixall", "FixAll", "wrench"),
    ("testall", "TestAll", "flask"),
    ("ship", "Ship", "rocket"),
    ("compact", "Compact", "compress"),
    ("session", "Session", "tabs"),
    ("pickel", "PickEl", "focus"),
    ("history", "History", "clock"),
    ("panel", "Panel", "panel"),
    ("hunknext", "NextDiff", "down"),
    ("hunkprev", "PrevDiff", "up"),
    ("queue", "Queue", "queue"),
]


def load_font(size: int):
    for path in FONT_PATHS:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size, index=0)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded(color):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=26, fill=(*color, 255))
    gloss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.rounded_rectangle((2, 2, SIZE - 3, 44), radius=20, fill=(255, 255, 255, 28))
    return Image.alpha_composite(img, gloss)


def draw_motif(draw, motif, accent, soft, fg):
    if motif == "chat":
        draw.rounded_rectangle((34, 28, 110, 78), radius=16, fill=soft, outline=accent, width=3)
        draw.polygon([(52, 78), (70, 78), (48, 98)], fill=soft)
        draw.ellipse((52, 48, 64, 60), fill=accent)
        draw.ellipse((72, 48, 84, 60), fill=accent)
        draw.ellipse((92, 48, 104, 60), fill=accent)
    elif motif == "caret":
        draw.rounded_rectangle((38, 30, 106, 96), radius=8, outline=accent, width=3)
        draw.line((52, 48, 92, 48), fill=soft, width=3)
        draw.line((52, 62, 80, 62), fill=soft, width=3)
        draw.polygon([(70, 70), (88, 88), (70, 88)], fill=accent)
    else:  # spark
        draw.ellipse((48, 36, 96, 84), outline=accent, width=4)
        draw.line((72, 28, 72, 40), fill=accent, width=4)
        draw.line((72, 80, 72, 100), fill=accent, width=4)
        draw.line((36, 60, 48, 60), fill=accent, width=4)
        draw.line((96, 60, 108, 60), fill=accent, width=4)
        draw.ellipse((66, 54, 78, 66), fill=fg)


def draw_glyph(draw, kind, fg, accent, soft=(100, 100, 100)):
    cx, cy = 72, 52
    if kind == "check":
        draw.line([(40, 56), (62, 76), (108, 34)], fill=fg, width=9)
    elif kind == "x":
        draw.line([(48, 34), (96, 82)], fill=fg, width=8)
        draw.line([(96, 34), (48, 82)], fill=fg, width=8)
    elif kind == "plus":
        draw.line([(72, 30), (72, 78)], fill=fg, width=8)
        draw.line([(48, 54), (96, 54)], fill=fg, width=8)
    elif kind == "stop":
        draw.rounded_rectangle((50, 34, 94, 78), radius=6, fill=fg)
    elif kind == "sliders":
        for x, y in ((50, 40), (72, 55), (94, 35)):
            draw.line([(x, 30), (x, 80)], fill=accent, width=4)
            draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=fg)
    elif kind == "mic":
        draw.rounded_rectangle((62, 28, 82, 62), radius=10, fill=fg)
        draw.arc((50, 48, 94, 90), 0, 180, fill=accent, width=5)
        draw.line([(72, 90), (72, 104)], fill=accent, width=4)
    elif kind == "term":
        draw.rounded_rectangle((34, 30, 110, 88), radius=8, outline=accent, width=3)
        draw.line([(48, 48), (64, 60), (48, 72)], fill=fg, width=5)
        draw.line([(70, 72), (96, 72)], fill=fg, width=5)
    elif kind == "diff":
        draw.line([(50, 36), (50, 84)], fill=accent, width=4)
        draw.ellipse((42, 40, 58, 56), fill=fg)
        draw.ellipse((42, 68, 58, 84), fill=fg)
        draw.line([(70, 44), (104, 44)], fill=(74, 222, 128), width=5)
        draw.line([(70, 72), (104, 72)], fill=(248, 113, 113), width=5)
    elif kind == "compose":
        draw.rounded_rectangle((40, 32, 104, 88), radius=10, outline=accent, width=3)
        draw.polygon([(78, 70), (104, 96), (70, 96)], fill=fg)
    elif kind == "bot":
        draw.rounded_rectangle((46, 40, 98, 86), radius=12, fill=accent)
        draw.ellipse((56, 52, 70, 66), fill=fg)
        draw.ellipse((74, 52, 88, 66), fill=fg)
        draw.rectangle((68, 28, 76, 40), fill=accent)
    elif kind == "pen":
        draw.line([(44, 84), (92, 36)], fill=fg, width=8)
        draw.polygon([(96, 32), (110, 46), (100, 50)], fill=accent)
    elif kind == "code":
        draw.line([(54, 40), (38, 58), (54, 76)], fill=fg, width=6)
        draw.line([(90, 40), (106, 58), (90, 76)], fill=fg, width=6)
    elif kind == "eye":
        draw.ellipse((40, 44, 104, 80), outline=accent, width=4)
        draw.ellipse((62, 50, 82, 70), fill=fg)
    elif kind == "wrench":
        draw.line([(48, 40), (92, 84)], fill=fg, width=8)
        draw.ellipse((40, 30, 64, 54), outline=accent, width=5)
    elif kind == "flask":
        draw.polygon([(58, 30), (86, 30), (100, 88), (44, 88)], outline=accent, width=4)
        draw.rectangle((52, 60, 92, 88), fill=accent)
    elif kind == "book":
        draw.rounded_rectangle((40, 32, 104, 92), radius=6, outline=accent, width=3)
        draw.line([(72, 32), (72, 92)], fill=fg, width=3)
    elif kind == "git":
        draw.line([(52, 36), (52, 90)], fill=accent, width=5)
        draw.ellipse((42, 30, 62, 50), fill=fg)
        draw.ellipse((42, 78, 62, 98), fill=fg)
        draw.line([(52, 60), (90, 40)], fill=accent, width=5)
        draw.ellipse((80, 30, 100, 50), fill=fg)
    elif kind == "list":
        for y in (40, 58, 76):
            draw.ellipse((40, y, 52, y + 12), fill=accent)
            draw.line([(60, y + 6), (104, y + 6)], fill=fg, width=4)
    elif kind == "refresh":
        draw.arc((40, 34, 104, 90), 40, 300, fill=accent, width=7)
        draw.polygon([(96, 34), (112, 48), (90, 52)], fill=fg)
    elif kind == "gear":
        draw.ellipse((50, 42, 94, 86), outline=accent, width=8)
        draw.ellipse((64, 56, 80, 72), fill=fg)
    elif kind == "ask":
        draw.ellipse((48, 30, 96, 78), outline=fg, width=5)
        draw.ellipse((66, 84, 78, 96), fill=fg)
    elif kind == "layers":
        draw.polygon([(72, 30), (108, 48), (72, 66), (36, 48)], outline=accent, width=3)
        draw.polygon([(72, 50), (108, 68), (72, 86), (36, 68)], outline=fg, width=3)
    elif kind == "plan":
        # clipboard with checklist
        draw.rounded_rectangle((44, 32, 100, 92), radius=8, outline=accent, width=4)
        draw.rounded_rectangle((62, 24, 82, 38), radius=5, fill=accent)
        for y in (50, 64, 78):
            draw.ellipse((52, y, 60, y + 8), fill=accent)
            draw.line([(66, y + 4), (92, y + 4)], fill=fg, width=4)
    elif kind == "cycle":
        # two arrows chasing each other (refactor loop)
        draw.arc((44, 34, 100, 90), 300, 120, fill=fg, width=6)
        draw.arc((44, 34, 100, 90), 120, 300, fill=accent, width=6)
        draw.polygon([(94, 30), (108, 42), (90, 46)], fill=fg)
        draw.polygon([(50, 94), (36, 82), (54, 78)], fill=accent)
    elif kind == "toggle":
        # mode switch pill with knob
        draw.rounded_rectangle((38, 46, 106, 78), radius=16, outline=accent, width=4)
        draw.ellipse((76, 50, 102, 76), fill=fg)
    elif kind == "arrow":
        # bold right arrow (→ Skills page)
        draw.line([(38, 62), (92, 62)], fill=fg, width=9)
        draw.polygon([(84, 42), (110, 62), (84, 82)], fill=accent)
    elif kind == "bolt":
        # lightning bolt (quick / fast)
        draw.polygon(
            [(78, 26), (50, 66), (68, 66), (60, 98), (94, 54), (74, 54)],
            fill=fg,
            outline=accent,
        )
    elif kind == "context":
        # braces with a plus (add context)
        draw.arc((36, 34, 60, 90), 90, 270, fill=accent, width=5)
        draw.arc((84, 34, 108, 90), 270, 90, fill=accent, width=5)
        draw.line([(72, 46), (72, 78)], fill=fg, width=6)
        draw.line([(56, 62), (88, 62)], fill=fg, width=6)
    elif kind == "inline":
        # text lines with an insertion caret on the middle line
        draw.line([(40, 42), (104, 42)], fill=soft, width=4)
        draw.line([(40, 82), (104, 82)], fill=soft, width=4)
        draw.line([(40, 62), (66, 62)], fill=fg, width=5)
        draw.line([(84, 62), (104, 62)], fill=fg, width=5)
        draw.line([(75, 48), (75, 76)], fill=accent, width=5)
        draw.line([(68, 48), (82, 48)], fill=accent, width=4)
        draw.line([(68, 76), (82, 76)], fill=accent, width=4)
    elif kind == "sidechat":
        # editor window with side panel + chat dot
        draw.rounded_rectangle((36, 32, 108, 90), radius=8, outline=accent, width=3)
        draw.line([(82, 32), (82, 90)], fill=accent, width=3)
        draw.line([(44, 48), (72, 48)], fill=soft, width=4)
        draw.line([(44, 62), (66, 62)], fill=soft, width=4)
        draw.ellipse((88, 54, 102, 68), fill=fg)
    elif kind == "gauge":
        # effort / autonomy gauge with needle
        draw.arc((38, 40, 106, 108), 180, 360, fill=accent, width=6)
        draw.line([(72, 74), (94, 52)], fill=fg, width=6)
        draw.ellipse((66, 68, 78, 80), fill=fg)
    elif kind == "globe":
        # browser globe
        draw.ellipse((42, 32, 102, 92), outline=fg, width=4)
        draw.ellipse((58, 32, 86, 92), outline=accent, width=3)
        draw.line([(42, 62), (102, 62)], fill=accent, width=3)
        draw.arc((42, 8, 102, 68), 40, 140, fill=accent, width=3)
        draw.arc((42, 56, 102, 116), 220, 320, fill=accent, width=3)
    elif kind == "lanes":
        # three vertical lanes, middle one selected
        for i, x in enumerate((42, 64, 86)):
            fill = fg if i == 1 else None
            draw.rounded_rectangle(
                (x, 32, x + 16, 92),
                radius=6,
                fill=fill,
                outline=accent,
                width=3,
            )
    elif kind == "flag":
        # goal flag on a pole
        draw.line([(50, 30), (50, 96)], fill=fg, width=5)
        draw.polygon([(54, 32), (102, 42), (54, 58)], fill=accent)
    elif kind == "play":
        # play triangle + end bar (continue to the finish)
        draw.polygon([(48, 32), (92, 60), (48, 88)], fill=fg)
        draw.line([(102, 32), (102, 88)], fill=accent, width=6)
    elif kind == "rocket":
        # ship it
        draw.polygon([(72, 24), (88, 56), (84, 86), (60, 86), (56, 56)], fill=fg)
        draw.ellipse((65, 46, 79, 60), fill=accent)
        draw.polygon([(56, 66), (40, 90), (60, 84)], fill=accent)
        draw.polygon([(88, 66), (104, 90), (84, 84)], fill=accent)
    elif kind == "compress":
        # two arrows squeezing onto a bar (/compact)
        draw.line([(40, 61), (104, 61)], fill=accent, width=4)
        draw.polygon([(58, 32), (86, 32), (72, 52)], fill=fg)
        draw.polygon([(58, 90), (86, 90), (72, 70)], fill=fg)
    elif kind == "tabs":
        # two stacked session windows
        draw.rounded_rectangle((36, 42, 92, 90), radius=6, outline=accent, width=3)
        draw.rounded_rectangle((52, 30, 108, 78), radius=6, outline=fg, width=3)
        draw.line([(60, 42), (100, 42)], fill=fg, width=3)
    elif kind == "clock":
        # history clock
        draw.ellipse((44, 32, 100, 88), outline=accent, width=4)
        draw.line([(72, 60), (72, 42)], fill=fg, width=5)
        draw.line([(72, 60), (86, 68)], fill=fg, width=5)
    elif kind == "panel":
        # window with a bottom panel
        draw.rounded_rectangle((36, 32, 108, 90), radius=8, outline=accent, width=3)
        draw.line([(36, 66), (108, 66)], fill=accent, width=3)
        draw.line([(46, 76), (84, 76)], fill=fg, width=4)
        draw.line([(46, 46), (72, 46)], fill=soft, width=4)
    elif kind == "down":
        # next diff hunk
        draw.line([(72, 28), (72, 68)], fill=fg, width=8)
        draw.polygon([(52, 62), (92, 62), (72, 92)], fill=accent)
    elif kind == "up":
        # previous diff hunk
        draw.line([(72, 92), (72, 52)], fill=fg, width=8)
        draw.polygon([(52, 58), (92, 58), (72, 28)], fill=accent)
    elif kind == "queue":
        # queued messages feeding downward
        draw.rounded_rectangle((40, 30, 104, 42), radius=5, fill=accent)
        draw.rounded_rectangle((40, 48, 104, 60), radius=5, fill=soft)
        draw.rounded_rectangle((40, 66, 104, 78), radius=5, fill=soft)
        draw.polygon([(60, 84), (84, 84), (72, 100)], fill=fg)
    elif kind == "focus":
        draw.ellipse((44, 34, 100, 90), outline=accent, width=5)
        draw.line([(72, 28), (72, 44)], fill=fg, width=5)
        draw.line([(72, 80), (72, 96)], fill=fg, width=5)
        draw.line([(38, 62), (54, 62)], fill=fg, width=5)
        draw.line([(90, 62), (106, 62)], fill=fg, width=5)
        draw.ellipse((66, 56, 78, 68), fill=fg)
    else:
        draw.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=accent)


def render_command(tool: str, key: str, label: str, glyph: str) -> Image.Image:
    t = TOOL_THEMES[tool]
    img = rounded(t["bg"])
    draw = ImageDraw.Draw(img)
    # small motif watermark
    draw_motif(draw, t["motif"], t["accent"], t["soft"], t["fg"])
    # darken center for glyph readability
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((28, 20, 116, 96), fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)
    draw_glyph(draw, glyph, t["fg"], t["accent"], t["soft"])
    font = load_font(18)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, SIZE - 31), label, font=font, fill=t["fg"])
    return img


def render_profile_badge(tool: str, title: str) -> Image.Image:
    t = TOOL_THEMES[tool]
    img = rounded(t["bg"])
    draw = ImageDraw.Draw(img)
    draw_motif(draw, t["motif"], t["accent"], t["soft"], t["fg"])
    font = load_font(22)
    bbox = draw.textbbox((0, 0), title, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, SIZE - 36), title, font=font, fill=t["fg"])
    return img


def main() -> None:
    out_root = ROOT / "assets" / "themes"
    for tool in TOOL_THEMES:
        d = out_root / tool
        d.mkdir(parents=True, exist_ok=True)
        for key, label, glyph in COMMANDS:
            img = render_command(tool, key, label, glyph)
            path = d / f"{key}.png"
            img.save(path)
            print("wrote", path)
        badge = render_profile_badge(
            tool, {"codex": "Codex", "cursor": "Cursor", "claude": "Claude"}[tool]
        )
        badge.save(d / "badge.png")
        print("wrote", d / "badge.png")
    print("done themes")


if __name__ == "__main__":
    main()
