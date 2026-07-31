# Vibe Deck for D200X

Turn your **Ulanzi D200X** into a live status monitor + control deck for **Claude Code**, **Codex (ChatGPT)**, and **Cursor** on macOS.

Inspired by OpenAI's Codex Micro — and built to go further: one unified layout for three AI coding tools, state-guarded keys that make misfires impossible, and five live agent lanes.

**Docs / Manual (EN·JA):** https://goonobu-dot.github.io/vibe-deck-for-d200x/

## Features

- **Unified layout (Vibe Deck OS)** — the same key always means the same thing across all three tools. Tool-specific keystrokes (Enter / `a` / ⌘⌫ …) are absorbed by a translation table inside the plugin; only the theme color changes (purple = Claude Code, teal = Codex, blue = Cursor).
- **5 dynamic lane cards** — each top-row key is a full-color card in the state color with knocked-out text: state label, elapsed time, session name, and — while orange — what is awaiting approval (e.g. `Bash: git push`). Thinking breathes, Input blinks, a finished turn pops a white check, and the lanes light up left to right at startup. Claude Code lanes cover desktop *and* CLI sessions.
- **Lane names that mean something** — Claude Code shows the session title, Codex shows the thread name (unnamed threads show the start time, e.g. `7/31 10:19` — name the thread and the name appears), Cursor shows the project folder name.
- **Press a lane to acknowledge + focus** — pressing a lane marks a finished turn as read (dark green / green → white) and focuses the tool. Cursor jumps straight to that project's window via a `cursor://` deep link (Claude / Codex, and Cursor when the path cannot be resolved, bring the app to the front).
- **State-guarded action keys** — Accept / Reject / Stop fire only when the agent state makes them meaningful. A guard-blocked press sends nothing — you get a warning sound and a red flash on the pressed key.
- **Approval flow via Claude Code hooks** — Notification / Stop hooks report to the bridge's `/event` endpoint, so a lane turns orange the moment approval is requested. While a lane is orange, the Accept key itself blinks orange (Armed).
- **Web dashboard** — `http://127.0.0.1:17823/dashboard` shows every tool's lanes live in a browser on the same Mac.
- **Auto-focus pipeline** — every action key activates the target app, verifies it is frontmost, then sends the keystroke. No manual focusing.
- **Three dials + a Tool key** — scroll, session/chat switching, and an autonomy-menu dial (inspired by Codex Micro's effort dial); a dedicated Tool key cycles Claude Code → Codex → Cursor.
- **Skills page** — 8 shared prompt starters (Plan / Implement / Review / Fix / Test / Explain / Commit / Summary).

## Status colors — see your agents' state at a glance

Each lane card changes color automatically as the agent works, so you can tell what every session is doing without looking at the screen:

| Color | Label | State | What you do |
|-------|-------|-------|-------------|
| ⚪ White | Idle | Waiting for instructions | Start a task (New / Skills) |
| 🔵 Blue | Thinking | Agent is working (breathing card; after 15 min it breathes about twice as fast — long-run alert) | Wait (or Stop) |
| 🟢 Green | Done | Turn just finished (white check pops) | Check the Diff, continue |
| 🟩 Dark green | Done | **Unacknowledged completion** — done for over 90 s, kept up to 30 min | Press the lane to mark it read (→ white) |
| 🟠 Orange | Input | **Waiting for your approval/input** (card blinks and shows what needs approval; Accept key blinks too) | Accept / Reject from the deck |
| 🔴 Red | Error | Something went wrong | Press the lane to inspect |
| ⚫ Gray | Ready | Unused lane | Press to focus the app |
| ⬛ Dark gray | OFFLINE | Bridge unreachable (shown on all lanes after 3 consecutive failed fetches) | Check the bridge; recovers automatically |

The colors update live (~150 ms paint loop) — e.g. white → blue when the agent starts, blue → orange when it needs your approval, then green when the turn completes.

## Layout

| Control | Action |
|---------|--------|
| Top row (all pages) | Agent lanes 1–5 (live status cards, press = mark read + focus) |
| Page 1 middle row | Accept / Reject / Stop / Diff / New |
| Page 1 bottom row | Voice / Terminal / Mode |
| Page 2 | 8 prompt starters (same on every tool) |
| Page 3 | Tool switch / Refresh / Settings / Help / Model + per-tool zone |
| Bottom hardware buttons | Page prev / next |
| Dials (L / M / R) | Scroll / Session switch / Autonomy menu |

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

**レーン＝動的カード**: 上段5キーは全面が状態色のカード（白抜き文字）で、状態ラベル・経過時間・セッション名・橙のときは承認内容（例 `Bash: git push`）を表示します。カード名は Claude Code=セッションタイトル / Codex=スレッド名（無名なら開始日時）/ Cursor=プロジェクトフォルダ名。

**状態が色でわかる**: 白=待機中（Idle）/ 青=作業中（Thinking・呼吸アニメ。15分超で呼吸が約2倍速になる長考アラート）/ 緑=ターン完了直後（Done・白チェックがポップ）/ **深緑=未確認の完了**（90秒後から最大30分保持。レーン押下で既読=白へ）/ **橙=承認・入力待ち（Input・点滅）**/ 赤=エラー（Error）/ 灰=空きレーン（Ready）/ 濃灰=OFFLINE（bridge に3回連続で取得失敗すると全レーン表示・自動復帰）。作業開始で白→青、承認が必要になると青→橙、完了で緑、と画面を見なくても手元で進行がわかります。

**承認フロー**: Claude Code の Notification / Stop フックが bridge の `/event` に通知し、承認要求の瞬間に確実に橙になります。橙の間は Accept キー自体がオレンジ点滅（Armed）。橙以外でのガード阻止時は送出せず、警告音＋キーの赤フラッシュで知らせます。レーン押下は既読化＋フォーカスで、Cursor は `cursor://` ディープリンクで該当プロジェクトのウィンドウへ直接ジャンプします。Web ダッシュボード（`http://127.0.0.1:17823/dashboard`）で全ツールのレーンをブラウザからもライブ表示できます。

- **導入**: `./scripts/install.sh` → Ulanzi Studio を完全再起動 → アクセシビリティ／オートメーションを許可
- **説明書**: [取扱説明書](docs/取扱説明書.md) / [クイックリファレンス](docs/クイックリファレンス.md)
- **ツール別操作ガイド**: [Claude Code](docs/操作ガイド-ClaudeCode.md) · [Codex](docs/操作ガイド-Codex.md) · [Cursor](docs/操作ガイド-Cursor.md)
- **Web版マニュアル（日英）**: https://goonobu-dot.github.io/vibe-deck-for-d200x/

## Disclaimer

Unofficial community project. Not affiliated with, endorsed by, or sponsored by Ulanzi, OpenAI, Anthropic, or Cursor (Anysphere). All product names, logos, and brands are trademarks of their respective owners.

非公式のコミュニティプロジェクトです。Ulanzi・OpenAI・Anthropic・Cursor とは無関係であり、各製品名は各社の商標です。

## License

[MIT](LICENSE)
