# Vibe Deck OS — 統一レイアウト実装計画（承認済み・source of truth）

Date: 2026-07-23 / 承認: ユーザー（チャットにて）

## 目的

Claude Code / Codex / Cursor の3ツールで**操作端を完全共通化**する。
同じ位置のキー＝同じ意味。ツール差（キーストローク）はプラグイン内の翻訳テーブルが吸収。
ツールの識別は背景テーマ色のみ（紫=Claude / 黒ティール=Codex / 青=Cursor）。

設計原則:
1. 位置＝意味の完全固定（全ツール・全ページ）
2. 色テーマだけがツール表示
3. 押して安全（自動Focus→状態検証→送出。needs_input 以外で Accept は不発）
4. 上段エージェントレーンは全ページ常時表示

## ハードウェア仕様（確定値）

- LCDキー: 5列×3行。キー座標 `x_y` で x=0..4, y=0..2（`3_2` `4_2` 含む。計15枠だが実機は14キー。`4_2` が存在しない場合は使用しない — wire 時に現状プロファイルの既存キー枠を確認して合わせる）
- 物理ボタン: `0_3`（左）`1_3`（右）→ **Studio標準の page.prev / page.next のまま維持**
- ダイヤル(Encoder): `2_3`（左）`3_3`（中）`4_3`（右）
- 対象プロファイル（ProfilesV2 内・実機インストール済み）: `Vibe · Claude Code` / `Codex_D200X` / `Vibe · Cursor`

## 統一レイアウト

### 全ページ共通・上段 y=0 — エージェントレーン

`0_0`〜`4_0`: `com.vibe.deck.status.agent` slot=1..5, tool=<プロファイルのツール>
（状態色表示。押すと該当ツールのアプリを前面化。既存プラグイン動作）

### Page 1 — CONTROL

| キー | 機能 | 実装 |
|------|------|------|
| 0_1 | Accept | plugin verb `accept` |
| 1_1 | Reject | plugin verb `reject` |
| 2_1 | Stop | plugin verb `stop` |
| 3_1 | Diff | plugin verb `diff` |
| 4_1 | New | plugin verb `new` |
| 0_2 | Voice | plugin verb `voice` |
| 1_2 | Terminal | plugin verb `terminal` |
| 2_2 | Mode | plugin verb `mode` |
| 3_2 | （小窓予約） | `smallwindow.window`（ハードの細長バー=時計ウィジェットと重なるため、全ページで Background 予約。キーは置かない） |

※ページ移動は下段の物理ボタン（0_3/1_3）で行う（→Skills キーは小窓と重なるため廃止）。

### Page 2 — SKILLS（system.text プロンプト・全ツール同一）

| キー | 名前 | プロンプト |
|------|------|-----------|
| 0_1 | Plan | "Plan this feature before coding: " |
| 1_1 | Implement | "Implement this: " |
| 2_1 | Review | "Review this code: " |
| 3_1 | Fix | "Fix this bug: " |
| 4_1 | Test | "Write tests for: " |
| 0_2 | Explain | "Explain this: " |
| 1_2 | Commit | "Write a commit message for: " |
| 2_2 | Summary | "Summarize the diff: " |
| 3_2 | （小窓予約） | Background |

（上段はレーン。Enter は送らない＝ユーザーが続きを入力する）

### Page 3 — SYSTEM

| キー | 機能 | 実装 |
|------|------|------|
| 0_1 | Focus | system.open → ツールの .app |
| 1_1 | Refresh | `com.vibe.deck.status.refresh` |
| 2_1 | Settings | hotkey ⌘, |
| 3_1 | Help | ツール別 help（cursor ⇧⌘P / codex ⇧⌘/ / claude ⌘/） |
| 4_1 | Model | ツール別モデルメニュー（cursor ⌘/ / codex ⇧⌘P / claude ⇧⌘I）— 位置と意味は共通 |
| 0_2〜2_2 | ツール固有ゾーン | 下表（唯一ツールで変わる行。隔離を明示） |
| 3_2 | （小窓予約） | Background |

ツール固有ゾーン（Page3 下段 0_2〜2_2 の3キー）:
- cursor: Composer ⌘I / Context ⇧⌘L / Inline ⌘K
- codex: Plan(text "/plan"+Enter) / Fast(text "/fast"+Enter) / Quick ⌘⌥N
- claude: Browser ⇧⌘B / SideChat ⌘; / Effort ⇧⌘E

### ダイヤル（全ページ共通。Encoder Actions に配線）

| ダイヤル | 回転 | 押し込み | 実装 |
|----------|------|----------|------|
| 左 2_3 | ツール切替（AI 3プロファイルのみ巡回） | 現ツールのアプリ前面化 | plugin `com.vibe.deck.status.dial.tool` |
| 中 3_3 | レーン選択（選択レーンを点滅＋セッション名を macOS 通知表示） | 選択セッションのツールを前面化 | plugin `com.vibe.deck.status.dial.lane` |
| 右 4_3 | 自律軸（左=速く/右=深く） | 現在モードUIを開く（=verb `mode`） | plugin `com.vibe.deck.status.dial.autonomy` |

ツール切替リングは `profile-ring.json` に3プロファイル名を書いて限定する
（`Vibe · Claude Code` / `Codex_D200X` / `Vibe · Cursor`。wire-deck が書き出す）。

## 翻訳テーブル（plugin.js 内に一元化。キーは osascript System Events keystroke/key code で送出）

| verb | claude | codex | cursor |
|------|--------|-------|--------|
| accept | Return | "a" | Return |
| reject | Esc | "d" | ⌘⌫ |
| stop | Esc | Esc | ⌘⇧⌫ |
| diff | ⇧⌘D | ⌘⌥B | ⌘E |
| new | ⌘N | ⌘N | ⌘N |
| voice | ⇪(不安定なら F5 相当は不可→⇪のまま) | ⌃⇧D | ⌘⇧Space |
| terminal | ⌃` | ⌃` | ⌃` |
| mode | ⇧⌘M | text "/permissions"+Return | ⌘. |
| autonomy_fast(左回転) | ⇧⌘E(メニュー開く) | text "/fast"+Return | ⌘/(モデルメニュー) |
| autonomy_deep(右回転) | ⇧⌘E | text "/plan"+Return | ⌘/ |

対象アプリ: claude=Claude.app / codex=ChatGPT.app / cursor=Cursor.app

## プラグイン新機能（plugin.js）

1. **verb アクション** `com.vibe.deck.status.verb`（ActionParam: `{ verb, tool }`）
   処理: ①bridge `/status?tool=` で状態取得 → ②ガード判定 → ③対象アプリを activate（自動Focus、~250ms待ち）→ ④frontmost 検証 → ⑤翻訳テーブルのキーを osascript で送出
2. **状態ガード**:
   - accept / reject: 状態が `needs_input`（cursor は `done` も許可=変更の一括承認/棄却）以外なら**送出しない**（ログのみ）
   - stop: `thinking` / `needs_input` 以外なら送出しない
   - その他 verb: ガードなし（ただし自動Focusは行う）
   - bridge 不達時: ガード不能 → 安全側（accept/reject/stop は送出しない）
3. **ダイヤル3種**（dial.tool / dial.lane / dial.autonomy）: 上表どおり
4. 翻訳・ガードのロジックは `app/verbs.js` に分離し、`node --test` でユニットテスト可能にする
5. plugin の manifest.json に新アクション（verb / dial.*）を宣言する（既存 agent / refresh の宣言形式に合わせる）

## 配線（wire-deck.mjs 全面改修）

- レイアウト定義を上記の単一スペックオブジェクトに書き換え（ツール別 CONTROL_COMMANDS / TOOL_EXTRAS の廃止。Page3 固有ゾーンのみツール別）
- verb キーは `vibeAction("com.vibe.deck.status.verb", ...)` + ActionParam `{ verb, tool }` で配線
- Encoder 2_3/3_3/4_3 に dial アクションを配線（restoreStandardBottomControls の「カスタムを剥がす」対象から新 dial アクションを除外）
- 3_2 の Background(smallwindow) は廃止し →Skills / Summary / ツール固有キーに置換
- profile-ring.json を3プロファイル名で書き出す
- アイコン: 新規 id（plan / refactor / mode / skills / lane 系）を generate-tool-themes.py に追加して3テーマ分生成。既存 id は流用

## QA（納品前必須）

1. `node --check` 全 .mjs/.js、`bridge: npm test`、`plugin: node --test`（verbs.js）
2. サンドボックス HOME（fixture の ProfilesV2 を用意）で wire-deck.mjs 実行 → 生成 JSON 構造検証（キー座標・ActionParam・レイアウトが本仕様と一致するか機械照合）
3. 3プロファイル×3ページすべてで「同一座標＝同一 verb」であることの照合スクリプト
4. 実機適用（本番 HOME で generate-icons → generate-tool-themes → wire-deck）は QA 通過後

## 制約・置いた前提

- 下段物理ボタン(0_3/1_3)は Studio 標準 page nav を維持（変更しない）
- Codex の verb は ChatGPT.app（デスクトップ）前提
- 中ダイヤルの「レーン選択」はMVP: 点滅＋通知表示＋押しでアプリ前面化（セッション単位の切替は将来課題）
- Claude の Voice（⇪）は環境依存で不安定（既知）。配置は維持
- docs/（取扱説明書・クイックリファレンス等）は実装確定後にリーダーが改訂
