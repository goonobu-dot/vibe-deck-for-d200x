# Vibe Deck for D200X

Turn your **Ulanzi D200X** into a live status monitor + control deck for **Claude Code**, **Codex (ChatGPT)**, and **Cursor** on macOS.

Inspired by OpenAI's Codex Micro — and built to go further: one unified layout for three AI coding tools, state-guarded keys that make misfires impossible, and five live agent lanes.

**Docs / Manual (EN·JA):** https://goonobu-dot.github.io/vibe-deck-for-d200x/

## Features

- **Unified layout (Vibe Deck OS)** — the same key always means the same thing across all three tools. Tool-specific keystrokes (Enter / `a` / ⌘⌫ …) are absorbed by a translation table inside the plugin; only the theme color changes (purple = Claude Code, teal = Codex, blue = Cursor).
- **5 agent lanes** — the top row shows up to five parallel sessions as live status colors (Idle / Thinking / Done / **Needs input** / Error). Claude Code lanes cover desktop *and* CLI sessions.
- **State-guarded action keys** — Accept / Reject / Stop fire only when the agent state makes them meaningful. Pressing Accept while nothing awaits approval does nothing, by design.
- **Auto-focus pipeline** — every action key activates the target app, verifies it is frontmost, then sends the keystroke. No manual focusing.
- **Three dials** — tool switcher (cycles the three profiles), lane selector (blink + session-name notification), and an autonomy dial (fast ⇔ deep reasoning), inspired by Codex Micro's effort dial.
- **Skills page** — 8 shared prompt starters (Plan / Implement / Review / Fix / Test / Explain / Commit / Summary).

## Layout

| Control | Action |
|---------|--------|
| Top row (all pages) | Agent lanes 1–5 (live status, press = focus) |
| Page 1 middle row | Accept / Reject / Stop / Diff / New |
| Page 1 bottom row | Voice / Terminal / Mode |
| Page 2 | 8 prompt starters (same on every tool) |
| Page 3 | Focus / Refresh / Settings / Help / Model + per-tool zone |
| Bottom hardware buttons | Page prev / next |
| Dials (L / M / R) | Tool switch / Lane select / Autonomy |

## Requirements

- Ulanzi D200X (USB) + Ulanzi Studio 3.1+ (Apple Silicon)
- macOS 12+, Node.js 20+, Python 3 (+ Pillow, installed automatically)
- Target apps: Claude.app, ChatGPT.app (Codex), Cursor.app

## Quick start

```bash
./scripts/install.sh
```

Then fully quit and restart Ulanzi Studio, and allow **Accessibility** and **Automation (System Events)** for Ulanzi Studio in System Settings → Privacy & Security (a one-time dialog appears on first key press).

## Demo mode

```bash
cd bridge && VIBE_DECK_DEMO=1 node dist/index.js
```

All lanes cycle through every status color every 2.5 s.

## Rewire after profile changes

```bash
python3 scripts/generate-icons.py
python3 scripts/generate-tool-themes.py
node scripts/wire-deck.mjs
```

---

## 日本語

Ulanzi D200X を Claude Code / Codex / Cursor の**エージェント監視＋手元操作デッキ**にする macOS 用ツールです。3ツールで「同じ位置のキー＝同じ意味」の統一レイアウト、状態ガードによる誤爆防止、並列5セッションのライブ表示が特徴です。

- **導入**: `./scripts/install.sh` → Ulanzi Studio を完全再起動 → アクセシビリティ／オートメーションを許可
- **説明書**: [取扱説明書](docs/取扱説明書.md) / [クイックリファレンス](docs/クイックリファレンス.md)
- **ツール別操作ガイド**: [Claude Code](docs/操作ガイド-ClaudeCode.md) · [Codex](docs/操作ガイド-Codex.md) · [Cursor](docs/操作ガイド-Cursor.md)
- **Web版マニュアル（日英）**: https://goonobu-dot.github.io/vibe-deck-for-d200x/

## Disclaimer

Unofficial community project. Not affiliated with, endorsed by, or sponsored by Ulanzi, OpenAI, Anthropic, or Cursor (Anysphere). All product names, logos, and brands are trademarks of their respective owners.

非公式のコミュニティプロジェクトです。Ulanzi・OpenAI・Anthropic・Cursor とは無関係であり、各製品名は各社の商標です。

## License

[MIT](LICENSE)
