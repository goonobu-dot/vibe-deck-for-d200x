#!/usr/bin/env python3
"""Vibe Deck — lane card renderer (Phase B, resident daemon).

Protocol (line oriented, one request per line):
  stdin : {"state": "thinking", "title": "セッション名", "elapsed": 12,
           "detail": "Bash: git push", "frames": "pop"}
  stdout: <base64 PNG or GIF> on success (single line),
          {"error": "..."} JSON on bad input (single line).

The daemon NEVER exits on bad input — every request is answered.
It exits only on EOF / broken stdout (parent died).

Animated states ship as looping 2-frame GIFs (Studio type:3), static
states as PNG (Studio type:1). The caller detects the format from the
base64 prefix ("R0lGOD" = GIF, "iVBORw" = PNG).

Card design follows scripts/generate-icons.py: dark slate card, the
Phase A state palette as a top status bar, Japanese-capable fonts.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover — install.sh installs Pillow
    sys.stdout.write(json.dumps({"error": "pillow_not_installed"}) + "\n")
    sys.stdout.flush()
    sys.exit(1)

SIZE = 144

# --- palette (matches generate-icons.py THEMES / ANIM_THEMES) ---------------
CARD_BG = (26, 32, 44)          # dark slate card body
CARD_EDGE = (255, 255, 255, 30)
TITLE_FG = (235, 238, 245)
TITLE_FG_DIM = (150, 158, 172)
DETAIL_FG = (253, 230, 138)     # amber — approval detail
DETAIL_FG_DIM = (128, 104, 62)

# Full-card solid color per state (user request): the whole key IS the state
# color, text is knocked out on top. Idle stays white (color language) with
# dark text; every other state uses white text.
STATES = {
    "idle":        {"bar": (224, 227, 234), "bar_fg": (28, 32, 42),    "label": "IDLE"},
    "thinking":    {"bar": (37, 99, 235),   "bar_fg": (255, 255, 255), "label": "THINK"},
    "done":        {"bar": (22, 163, 74),   "bar_fg": (255, 255, 255), "label": "DONE"},
    # 未確認の完了: done のまま 90 秒超えたレーン（深緑・押下で既読）。
    "done_old":    {"bar": (16, 90, 50),    "bar_fg": (255, 255, 255), "label": "DONE"},
    "needs_input": {"bar": (245, 158, 11),  "bar_fg": (255, 255, 255), "label": "INPUT"},
    "error":       {"bar": (239, 68, 68),   "bar_fg": (255, 255, 255), "label": "ERROR"},
    "empty":       {"bar": (58, 58, 62),    "bar_fg": (190, 190, 196), "label": "READY"},
    # bridge 不達: 濃灰・タイトルは維持して表示。
    "offline":     {"bar": (45, 48, 55),    "bar_fg": (255, 255, 255), "label": "OFFLINE"},
}
# Dim variants for the 2nd animation frame (breathing / blink-off).
DIM_BAR = {
    "thinking": (16, 44, 106),
    # 長考アラート: 色相は同じ青のまま明暗差だけ強める。
    "thinking_urgent": (8, 22, 58),
    "needs_input": (128, 82, 6),
}

THINKING_FRAME_MS = 800   # half of the Phase A 1600ms breathing period
THINKING_URGENT_FRAME_MS = 350  # 長考アラート: 呼吸を速める
NEEDS_INPUT_FRAME_MS = 250  # half of the Phase A 500ms blink period
POP_FRAME_MS = 600
POP_REST_MS = 1400

MAX_TITLE_LINES = 2
MAX_DETAIL_LINES = 2
MAX_INPUT_CHARS = 200  # defensive clamp on every incoming string

FONT_PATHS = [
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"),
    Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
]
# Latin labels/elapsed get SF Compact Rounded for the friendly look (design A).
ROUNDED_FONT = Path("/System/Library/Fonts/SFCompactRounded.ttf")

_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}


def load_font(size: int, rounded: bool = False):
    cached = _font_cache.get((size, rounded))
    if cached is not None:
        return cached
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont | None = None
    paths = ([ROUNDED_FONT] if rounded else []) + FONT_PATHS
    for path in paths:
        if path.exists():
            try:
                font = ImageFont.truetype(str(path), size=size, index=0)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()
    _font_cache[(size, rounded)] = font
    return font


def draw_state_glyph(draw, state: str, cx: float, cy: float, k: float, fg, soft):
    """Design-A badge glyph (ports the original cute icon set, scaled by k)."""
    if state == "thinking":
        w = max(3, int(5 * k))
        draw.ellipse((cx - 26 * k, cy - 26 * k, cx + 26 * k, cy + 26 * k), outline=soft, width=w)
        draw.ellipse((cx - 9 * k, cy - 9 * k, cx + 9 * k, cy + 9 * k), fill=fg)
        draw.ellipse((cx + 16 * k, cy - 20 * k, cx + 26 * k, cy - 10 * k), fill=fg)
    elif state == "needs_input":
        draw.rounded_rectangle(
            (cx - 30 * k, cy - 26 * k, cx + 30 * k, cy + 12 * k), radius=int(16 * k), fill=fg
        )
        draw.polygon(
            [(cx - 8 * k, cy + 10 * k), (cx + 10 * k, cy + 10 * k), (cx - 2 * k, cy + 28 * k)],
            fill=fg,
        )
        qfont = load_font(max(12, int(36 * k)), rounded=True)
        qb = draw.textbbox((0, 0), "?", font=qfont)
        draw.text(
            (cx - (qb[2] - qb[0]) / 2, cy - 18 * k - (qb[3] - qb[1]) / 2 - 2),
            "?",
            font=qfont,
            fill=soft,
        )
    elif state in ("done", "done_old"):
        pts = [(cx - 24 * k, cy), (cx - 6 * k, cy + 16 * k), (cx + 28 * k, cy - 18 * k)]
        draw.line(pts, fill=fg, width=max(5, int(9 * k)), joint="curve")
    elif state == "idle":
        draw.rounded_rectangle(
            (cx - 18 * k, cy - 16 * k, cx - 6 * k, cy + 16 * k), radius=int(4 * k), fill=fg
        )
        draw.rounded_rectangle(
            (cx + 6 * k, cy - 16 * k, cx + 18 * k, cy + 16 * k), radius=int(4 * k), fill=fg
        )
    elif state == "error":
        draw.polygon(
            [(cx, cy - 26 * k), (cx + 28 * k, cy + 20 * k), (cx - 28 * k, cy + 20 * k)], fill=fg
        )
        draw.rectangle((cx - 4 * k, cy - 10 * k, cx + 4 * k, cy + 6 * k), fill=soft)
        draw.ellipse((cx - 4 * k, cy + 9 * k, cx + 4 * k, cy + 17 * k), fill=soft)
    elif state in ("empty", "offline"):
        draw.ellipse(
            (cx - 22 * k, cy - 22 * k, cx + 22 * k, cy + 22 * k), outline=fg, width=max(3, int(4 * k))
        )
        draw.line((cx - 11 * k, cy, cx + 11 * k, cy), fill=fg, width=max(3, int(4 * k)))


def text_width(draw: ImageDraw.ImageDraw, text: str, font) -> float:
    try:
        return draw.textlength(text, font=font)
    except (AttributeError, TypeError):  # very old Pillow / bitmap font
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]


def wrap_text(
    draw: ImageDraw.ImageDraw, text: str, font, max_width: int, max_lines: int
) -> list[str]:
    """Greedy per-character wrap (works for CJK, no word boundaries needed)."""
    lines: list[str] = []
    current = ""
    for ch in text:
        if ch in "\r\n":
            ch = " "
        candidate = current + ch
        if text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue
        lines.append(current)
        current = ch
        if len(lines) == max_lines:
            break
    if len(lines) < max_lines and current:
        lines.append(current)
    if not lines:
        return []
    # Did everything fit? If not, ellipsize the last kept line.
    consumed = sum(len(l) for l in lines)
    if consumed < len(text.replace("\r", " ").replace("\n", " ")) or len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and text_width(draw, last + "…", font) > max_width:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines[:max_lines]


def format_elapsed(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes}m"
    hours, rest = divmod(minutes, 60)
    return f"{hours}h{rest:02d}m"


def draw_card(
    state: str,
    title: str,
    elapsed_min: int,
    detail: str,
    *,
    bar_override: tuple[int, int, int] | None = None,
    dim_body: bool = False,
    pop_check: bool = False,
) -> Image.Image:
    """Render one card frame. Flattened to RGB (opaque, GIF-safe)."""
    spec = STATES[state]
    bg = bar_override or spec["bar"]
    fg = spec["bar_fg"]

    def scale(color, k):
        return tuple(max(0, min(255, int(c * k))) for c in color)

    img = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    # the whole card is the state color
    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=22, fill=bg)

    # design A: glyph badge top-right — the cute icon set, kept small
    glyph_fg = scale(fg, 0.8) if dim_body else fg
    glyph_soft = scale(spec["bar"], 0.55) if state != "idle" else (150, 156, 170)
    draw_state_glyph(draw, state, SIZE - 30, 30, 0.55, glyph_fg, glyph_soft)

    bar_font = load_font(16, rounded=True)
    draw.text((10, 10), spec["label"], font=bar_font, fill=fg)
    elapsed_font = load_font(15, rounded=True)
    draw.text((10, 32), format_elapsed(elapsed_min), font=elapsed_font, fill=scale(fg, 0.9))

    # session title — up to 2 lines, Japanese OK, knocked out on the color
    title_font = load_font(20)
    title_fg = scale(fg, 0.75) if dim_body else fg
    y = 58
    for line in wrap_text(draw, title, title_font, SIZE - 20, MAX_TITLE_LINES):
        draw.text((10, y), line, font=title_font, fill=title_fg)
        y += 25

    # approval detail — needs_input only (dark on orange for contrast)
    if state == "needs_input" and detail:
        detail_font = load_font(14)
        detail_fg = (70, 45, 0) if not dim_body else (46, 30, 0)
        y = 108
        for line in wrap_text(draw, detail, detail_font, SIZE - 20, MAX_DETAIL_LINES):
            draw.text((10, y), line, font=detail_font, fill=detail_fg)
            y += 17

    if pop_check:
        # done-pop: oversized white check across the green body
        base = [(40, 78), (64, 100), (112, 52)]
        draw.line(base, fill=(255, 255, 255), width=13, joint="curve")

    # subtle outer edge
    edge = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle((1, 1, SIZE - 2, SIZE - 2), radius=21, outline=CARD_EDGE, width=2)
    return Image.alpha_composite(img.convert("RGBA"), edge).convert("RGB")


def encode_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def encode_gif(frames: list[Image.Image], durations: list[int]) -> str:
    buf = io.BytesIO()
    frames[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=1,
    )
    return base64.b64encode(buf.getvalue()).decode("ascii")


def clamp_str(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:MAX_INPUT_CHARS]


def clamp_elapsed(value: object) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(0, min(n, 99 * 60 + 59))


def render_request(req: dict) -> str:
    state = clamp_str(req.get("state"))
    if state not in STATES:
        raise ValueError(f"unknown state: {state or '(empty)'}")
    title = clamp_str(req.get("title"))
    detail = clamp_str(req.get("detail"))
    elapsed = clamp_elapsed(req.get("elapsed"))
    frames_hint = clamp_str(req.get("frames"))
    urgent = req.get("urgent") is True  # hostile / missing → False

    if state == "thinking":
        frame_ms = THINKING_URGENT_FRAME_MS if urgent else THINKING_FRAME_MS
        dim_bar = DIM_BAR["thinking_urgent"] if urgent else DIM_BAR["thinking"]
        bright = draw_card(state, title, elapsed, detail)
        dim = draw_card(
            state, title, elapsed, detail,
            bar_override=dim_bar, dim_body=True,
        )
        return encode_gif([bright, dim], [frame_ms, frame_ms])

    if state == "needs_input":
        on = draw_card(state, title, elapsed, detail)
        off = draw_card(
            state, title, elapsed, detail,
            bar_override=DIM_BAR["needs_input"], dim_body=True,
        )
        return encode_gif([on, off], [NEEDS_INPUT_FRAME_MS, NEEDS_INPUT_FRAME_MS])

    if state == "done" and frames_hint == "pop":
        pop = draw_card(state, title, elapsed, detail, pop_check=True)
        rest = draw_card(state, title, elapsed, detail)
        return encode_gif([pop, rest], [POP_FRAME_MS, POP_REST_MS])

    return encode_png(draw_card(state, title, elapsed, detail))


def respond(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main() -> int:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError("request must be a JSON object")
            respond(render_request(req))
        except BrokenPipeError:
            return 0  # parent is gone — nothing left to serve
        except Exception as exc:  # noqa: BLE001 — daemon must never die on input
            try:
                respond(json.dumps({"error": str(exc)[:200]}, ensure_ascii=False))
            except BrokenPipeError:
                return 0
            except Exception:  # noqa: BLE001 — last-resort: keep serving
                print("lane-renderer: failed to write error", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
