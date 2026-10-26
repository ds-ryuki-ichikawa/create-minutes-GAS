# create-minutes

Google Meet の「Gemini によるメモ」から議事録を作り、TODO を Backlog に課題登録するスキルです。Claude Code（VS Code・Claude Desktop の Code タブ）と Claude Desktop の Cowork のどちらでも使えます。

使い方だけ知りたい人は [GUIDE.md](GUIDE.md) を読んでください。

## できること

1. Google Drive から Gemini のメモ（メモ＋文字起こし）を読み込む
2. テンプレートに沿って議事録の下書きを作る
3. 担当者・期限・非公開情報・要確認事項を一覧で出し、チャットで修正する
4. 確定版をローカルに保存する（`~/Documents/minutes/`）
5. TODO を Backlog に課題登録する（社内の TODO だけ。お客様など社外の TODO は登録しない。登録前に確認あり）
6. TODO の期限を Google カレンダーにリマインド登録する（期限日の終日予定・前日 9:00 に通知。未接続時は手動登録用の一覧を表示）
7. Slack に Canvas 作成・予約送信する（任意・未検証。Slack 未接続時は手動投稿用のメッセージを表示）

> **Slack 連携は未検証です。** 今回の要件には含まれなかったため、Slack と接続しての動作確認はしていません（IB_TASK-114）。手順はスキルに残してあり、`--slack-channel` を指定したときだけ動きます。使う場合は、まず自分宛ての DM で動作を確認してください。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `skills/create-minutes/SKILL.md` | スキル本体（実行手順） |
| `skills/create-minutes/references/minutes-template.md` | 議事録の変換プロンプト（書き方の指示） |
| `.claude-plugin/plugin.json` | プラグインの情報（Cowork に入れるときに使う） |
| `GUIDE.md` | エンジニアでない人向けの使い方ガイド |

## セットアップ

### Claude Code で使う

1. `skills/create-minutes` フォルダを、フォルダごと `~/.claude/skills/create-minutes` にコピーする（`~` は各自のホームフォルダ。Windows なら `C:\Users\{ユーザー名}`）
   - 以前の版で `~/.claude/commands/create-minutes.md` と `~/.claude/templates/minutes-template.md` を置いていた場合は、その 2 つを消す

2. Claude Code で次のコネクタを使えるようにする
   - Google Drive（必須）
   - Backlog MCP（課題登録に必要）
   - Google Calendar（任意。未接続でも動く）
   - Slack（任意・未検証。未接続でも動く）

3. Claude Code を開き直すと `/create-minutes` が使えるようになる

Claude Desktop の Code タブも Claude Code なので、上の準備をしてあればそのまま `/create-minutes` が使えます（スキルと Backlog の設定を VS Code 版と共有します）。

### Claude Desktop（Cowork）で使う

Claude Desktop は公式サイト（https://claude.com/download）から入れてください。winget で入れると古い形式になり、Cowork が使えません。

1. このリポジトリの `.claude-plugin` と `skills` の 2 つのフォルダを zip にまとめる
2. Claude Desktop の「Customize」→「Plugins」→「Add」→「Upload plugin」で zip を選ぶ
3. 「Customize」→「Connectors」で Google Drive と Google Calendar を接続する
4. Backlog を使う場合は、Claude Desktop の設定ファイル（`%APPDATA%\Claude\claude_desktop_config.json`）に Backlog MCP を書き足し、Claude Desktop を再起動する。中身は下の「Backlog MCP が『Connection closed』でつながらない」の例と同じ（`type` の行は不要）。設定ファイルは Claude Desktop を終了してから編集する（開いたままだと上書きされることがある）。Backlog を設定しない場合は、登録する課題の一覧が出るので手で登録する
5. Cowork のタスクで「ドキュメント」の `minutes` フォルダを接続する。接続しないと、議事録を保存できず、前回の議事録も探せない
6. `/` で出るメニューから `create-minutes` を選ぶか、会議メモの URL を貼って「議事録を作って（お試し）」と頼む

アカウントに入れたプラグインは、Claude Code にも `/create-minutes:create-minutes` として自動で入ります。パソコンに入れたスキル（`/create-minutes`）と中身は同じなので、どちらを使ってもかまいません。

## 使い方

まずはお試し実行（保存・登録・送信を一切しない）で確認するのがおすすめです。

```
/create-minutes --doc-id {Google DocsのURLまたはID} --slack-channel {チャンネル名} --mention-users {名前} --send-at 明日9時 --dry-run
```

問題なければ `--dry-run` を外して本番実行します。

Slack に共有しない場合は、Slack の引数を省略できます。

```
/create-minutes --doc-id {Google DocsのURLまたはID}
```

### 主な引数

| 引数 | 必須 | 説明 |
|---|:---:|---|
| `--doc-id` | ✓ | Gemini によるメモの URL または ID |
| `--slack-channel` | — | 通知先チャンネル名または ID（省略すると Slack への共有をしない） |
| `--mention-users` | — | メンションする人（カンマ区切り） |
| `--send-at` | — | 送信予約日時（例: `明日9時`、`5/15 9:00`）。`--slack-channel` を指定したときは必須 |
| `--backlog-project` | — | 課題登録先のプロジェクトキー（省略時 `IB_TASK`） |
| `--canvas-id` | — | 更新する Slack Canvas の ID（省略時は新規作成） |
| `--prev` | — | 前回の議事録（ファイルパスか Google Docs の ID）。省略時は `~/Documents/minutes/` から同じ名前の会議を自動で探す。`none` で比較しない |
| `--dry-run` | — | お試し実行 |

詳しくは `skills/create-minutes/SKILL.md` を参照してください。

## 注意

- Backlog に登録した課題は、権限によっては削除できません。登録前の確認一覧をよく見てから「登録」してください
- Slack に送るメッセージには、議事録の「非公開情報」は含めません
- カレンダーの招待に使う担当者のメールアドレスは Backlog から取れないため、登録前の確認でチャットから伝えてください（伝えなければ招待なしで登録します）
- スキルを修正したら、`~/.claude/skills/create-minutes` とこのリポジトリの両方を更新してください。Cowork で使っている場合は、プラグインもアップロードし直してください

## 困ったとき

### Backlog MCP が「Connection closed」でつながらない

**原因**: VS Code から Node.js が見えていない（PATH が通っていない）。Node.js を入れる前から VS Code を起動していると起きる。VS Code を再起動しても直らないことがある。

**確かめ方**: VS Code のターミナルで `node -v` を実行し、「認識されません」と出たらこれが原因。

**直し方**: `~/.claude.json` の `mcpServers` → `backlog` → `env` に `PATH` を書き足し、`/mcp` で再接続する（だめなら VS Code の「Developer: Reload Window」）。

```json
"backlog": {
  "type": "stdio",
  "command": "C:\\Program Files\\nodejs\\npx.cmd",
  "args": ["-y", "backlog-mcp-server"],
  "env": {
    "PATH": "C:\\Program Files\\nodejs;C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    "BACKLOG_DOMAIN": "{スペース}.backlog.jp",
    "BACKLOG_API_KEY": "{自分の API キー}"
  }
}
```

### コネクタを許可したのに使えない

**原因**: claude.ai でコネクタ（Google Calendar など）を許可しても、開いている Claude Code には反映されない。

**直し方**: Claude Code を開き直す（VS Code の「Developer: Reload Window」など）。`/mcp` でそのコネクタが「connected」になっていれば使える。

### インストールしたコマンド（git など）が「認識されません」と出る

**原因**: Backlog MCP と同じで、インストール前から開いている VS Code には新しい PATH が反映されない。

**直し方**: VS Code をすべて閉じてから開き直す。

### カレンダーの招待で担当者のメールアドレスが入らない

**原因**: Backlog の API では、自分以外のユーザーのメールアドレスを取得できない。

**直し方**: カレンダー登録前の確認一覧で、招待したい人のメールアドレスをチャットで伝える。伝えなければ招待なしで登録する（担当者が自分のときは招待しない）。

### テストで Backlog に課題を登録してしまった

**原因**: 登録した課題は、権限によっては削除できない。

**直し方**: コメントを付けてクローズする。試すときは `--dry-run` を使い、本当に登録して確かめたいときは件名に「【テスト】」を付けて 1 件だけにする。

### Cowork を開くと「最新のインストーラーで Claude Desktop をインストールする必要があります」と出る

**原因**: winget などで古い形式の Claude Desktop を入れている。

**直し方**: Claude Desktop をアンインストールし、公式サイト（https://claude.com/download）からダウンロードして入れ直す。

### Cowork で「Backlog が接続されていないため…」と出る

**原因**: Backlog の設定は VS Code（Claude Code）の `~/.claude.json` にしかなく、Cowork からは見えない。

**直し方**: セットアップの「Claude Desktop（Cowork）で使う」の手順 4 のとおり、Claude Desktop の設定ファイルに Backlog MCP を書き足して再起動する。「設定」→「開発者」で backlog が「running」になっていれば使える。

### 登録前の一覧に「⚠ 似た課題あり」と出る

**原因**: 同じ作業の課題が Backlog にすでにある（完了済みも含む）。古い会議のメモで実行したときによく出る。

**直し方**: 重複する TODO は、登録前の確認で「◯番は除外」とチャットで伝える。
