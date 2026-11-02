# meeting-tasks（議事録作成）

Google Meet の「Gemini によるメモ」から議事録を作り、TODO を Backlog に課題登録するスキルです。Claude Code（VS Code・Claude Desktop の Code タブ）と Claude Desktop の Cowork のどちらでも使えます。

使い方だけ知りたい人は [GUIDE.md](GUIDE.md)、動作環境と、入れてから動かすまでの手順は [INSTALL.md](INSTALL.md) を読んでください。

## できること

1. Google Drive から Gemini のメモ（メモ＋文字起こし）を読み込む。URL を渡さなければ、最近の会議メモを探して候補を出す
2. テンプレートに沿って議事録の下書きを作る
3. 担当者・期限・非公開情報・要確認事項と、保存・登録する内容（TODO ごとの登録先）を 1 つの画面で見せ、承認を 1 回だけもらう。修正はチャットで伝える（Claude Code では「承認する／修正する／やめる」をボタンで選べる）
4. 承認されたら、確定版を保存する（保存先の Google ドライブのフォルダを設定していればそこに、なければパソコンの `~/Documents/minutes/` に）
5. TODO を Backlog に課題登録する（社内の TODO だけ。お客様など社外の TODO は登録しない）
6. TODO の期限を Google カレンダーにリマインド登録する（期限日の終日予定・前日 9:00 に通知。未接続時は手動登録用の一覧を表示）

人が操作するのは、会議メモを選ぶ（URL を渡さなかったとき）ことと、確認・承認の 1 回だけです。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `skills/meeting-tasks/SKILL.md` | スキル本体（実行手順） |
| `skills/meeting-tasks/references/minutes-template.md` | 議事録の変換プロンプト（書き方の指示） |
| `skills/meeting-tasks/references/settings.md` | 組織の初期値（Backlog のプロジェクト・議事録の保存先）。リポジトリでは空 |
| `.claude-plugin/plugin.json` | プラグインの情報（ユーザー設定の項目と Backlog MCP の設定を含む） |
| `.claude-plugin/marketplace.json` | Claude Code でプラグインとして入れるときに使う（Cowork 用の zip には入れない） |
| `scripts/build-cowork-zip.sh` | Cowork にアップロードする zip を作る |
| `skills/meeting-tasks/scripts/backlog-mcp.mjs` | Backlog の接続（Backlog MCP）を、Windows・Mac に合わせて起動する |
| `skills/meeting-tasks/scripts/meeting-log.mjs` | 使った記録（確認・承認の時間、TODO の数、似た課題で止めた数）を残し、集計する |
| `GUIDE.md` | エンジニアでない人向けの使い方ガイド |
| `INSTALL.md` | 導入・操作手順書（動作環境、Claude Code・Cowork への入れ方、操作手順） |
| `MAC-CHECK.md` | Mac で動かすときに確かめる項目（チェックリスト） |

## 設定（Backlog のプロジェクト・保存先・API キー）

使う人や組織によって違う値は、コマンドに書かなくても設定で決められます。次の順に探し、最初に見つかったものを使います。

| 項目 | 1. 引数 | 2. ユーザー設定（Claude Code のプラグインだけ） | 3. 組織の初期値 | どこにもないとき |
|---|---|---|---|---|
| Backlog のプロジェクト | `--backlog-project` | `backlog_project` | `references/settings.md` | 登録の前に聞く |
| 議事録の保存先（Google ドライブのフォルダ） | `--save-folder` | `save_folder` | `references/settings.md` | パソコンの `~/Documents/minutes/` に保存 |

- **ユーザー設定**：Claude Code でプラグインとして入れたときに、各自が入力する。Cowork と Web 版には入力する画面がないため、組織の初期値か引数を使う
- **組織の初期値**：`skills/meeting-tasks/references/settings.md` の `：` の後ろに書く。プラグインを入れた全員に同じ値が配られるので、組織やお客様に配る前にその組織の値を書いておく。リポジトリでは空にしてある
- **Backlog の API キー**：引数と `settings.md` には書かない（全員に配られてしまう）。Claude Code ではユーザー設定の `backlog_api_key` に入れる（安全な保管場所に保存され、画面には出ない）。Cowork では Claude Desktop の設定ファイルに入れる
- **保存先を Google ドライブにすると**、どの環境（VS Code・Desktop・Web 版）で作っても同じフォルダに残り、前回の議事録もそのフォルダから探せる。フォルダの URL（`https://drive.google.com/drive/folders/…`）をそのまま書いてよい

## セットアップ

### Claude Code で使う

プラグインとして入れると、上のユーザー設定を使えます。

1. このリポジトリを手元に置き、ターミナルで次を実行する

   ```
   claude plugin marketplace add {このリポジトリのフォルダ}
   claude plugin install meeting-tasks@meeting-tasks-local
   ```

2. Claude Code を開き、`/plugin configure meeting-tasks@meeting-tasks-local` で設定を入力する
   - `backlog_project`：Backlog のプロジェクトキー（例: `IB_TASK`）
   - `save_folder`：議事録を保存する Google ドライブのフォルダの URL（空ならパソコンに保存）
   - `backlog_domain`：Backlog のドメイン（例: `xxx.backlog.jp`）
   - `backlog_api_key`：Backlog の「個人設定」→「API」で発行したキー

3. Claude Code で次のコネクタを使えるようにする
   - Google Drive（必須）
   - Google Calendar（任意。未接続でも動く）

4. Claude Code を開き直すと `/meeting-tasks:meeting-tasks` が使えるようになる

Backlog の接続（Backlog MCP）はプラグインに入っていて、上の `backlog_domain` と `backlog_api_key` で動きます。Node.js が入っていれば（ターミナルで `node -v` が動けば）、`skills/meeting-tasks/scripts/backlog-mcp.mjs` が Windows・Mac に合わせて起動します。Mac ではまだ動かしていません（確かめる項目は [MAC-CHECK.md](MAC-CHECK.md)）。すでに自分で Backlog MCP を設定してある場合は、同じ内容のものは二重に起動されず、自分の設定がそのまま使われます。

スキルのフォルダだけをコピーして使うこともできます（`skills/meeting-tasks` をフォルダごと `~/.claude/skills/meeting-tasks` にコピーすると `/meeting-tasks` で動く）。この場合はユーザー設定が使えないので、引数か `settings.md` で決めます。Backlog MCP も自分で設定します（下の「Backlog MCP が『Connection closed』でつながらない」を参照）。以前の版で `~/.claude/commands/create-minutes.md` と `~/.claude/templates/minutes-template.md` を置いていた場合は、その 2 つを消してください。以前の名前（`create-minutes`・`task-get`）で `~/.claude/skills/` に入れていた場合も、そのフォルダを消してください。

Claude Desktop の Code タブも Claude Code なので、上の準備をしてあればそのまま使えます（スキルと Backlog の設定を VS Code 版と共有します）。

### Claude Desktop（Cowork）で使う

Claude Desktop は公式サイト（https://claude.com/download）から入れてください。winget で入れると古い形式になり、Cowork が使えません。

1. 組織の初期値を決める場合は、`skills/meeting-tasks/references/settings.md` に Backlog のプロジェクトキーと保存先のフォルダの URL を書く（Cowork にはユーザー設定の画面がないため、ここに書いた値が使われる）
2. コミットしてから、Git Bash で次を実行して zip を作る

   ```
   scripts/build-cowork-zip.sh
   ```

   - zip の `plugin.json` からは、プラグインの Backlog の接続（`mcpServers`）とユーザー設定の項目（`userConfig`）を外している。Cowork ではユーザー設定を入力できないため、入れたままだと Backlog の接続が必ず失敗し、「Backlog の接続に失敗しています」と出る
   - `settings.md` に書いた値をコミットしたくない場合は、値を書いた `settings.md` を別の場所に置き、`scripts/build-cowork-zip.sh {出力する zip} {その settings.md}` とする
3. Claude Desktop の「Customize」→「Plugins」→「Add」→「Upload plugin」で zip を選ぶ。以前の名前（`create-minutes`・`task-get`）のプラグインを入れている場合は、別のプラグインとして並ぶので、古いほうを削除する
4. 「Customize」→「Connectors」で Google Drive と Google Calendar を接続する
5. Backlog を使う場合は、Claude Desktop の設定ファイル（Windows は `%APPDATA%\Claude\claude_desktop_config.json`、Mac は `~/Library/Application Support/Claude/claude_desktop_config.json`）に Backlog MCP を書き足し、Claude Desktop を再起動する。中身は下の「Backlog MCP が『Connection closed』でつながらない」の例と同じ（`type` の行は不要）。設定ファイルは Claude Desktop を終了してから編集する（開いたままだと上書きされることがある）。Backlog を設定しない場合は、登録する課題の一覧が出るので手で登録する
6. 保存先の Google ドライブのフォルダを決めていない場合は、Cowork のタスクで「ドキュメント」の `minutes` フォルダを接続する。接続しないと、議事録を保存できず、前回の議事録も探せない
7. `/` で出るメニューから `meeting-tasks` を選ぶか、「議事録を作って（お試し）」と頼む（最近の会議メモが候補として出るので、番号で選ぶ。会議メモの URL を貼ってもよい）

アカウントに入れたプラグインは、Claude Code にも `/meeting-tasks:meeting-tasks` として自動で入ります。ただし、Claude Code で同じ名前のプラグインを入れている場合は、Claude Code で入れたほうが使われます。

### Web 版（claude.ai/new・claude.ai/code）で使う

アカウントに入れたプラグインは、Web 版のチャット（claude.ai/new）と Web 版 Claude Code（claude.ai/code）でも使えます。ただし、次の 2 点が Desktop と違うため、議事録を残す用途には Desktop をおすすめします。

- **Backlog は使えない**：Backlog の接続はパソコンの中で動くため、Web 版からは届かない。登録する課題の一覧が出るので手で登録する
- **パソコンに保存されない**：議事録はクラウドの一時的な場所に作られる。ダウンロードできるファイルとして出るので、必要なら保存する。保存先の Google ドライブのフォルダを `settings.md` か `--save-folder` で決めておけば、Web 版でもそのフォルダに保存される

| 使う場所 | 議事録の保存先（Google ドライブのフォルダを決めていない場合） | Backlog |
|---|---|---|
| VS Code・Desktop の Code タブ | パソコンの `~/Documents/minutes/` | 使える |
| Desktop の Cowork | つないだ `minutes` フォルダ | 使える（設定ファイルに追加した場合） |
| claude.ai/new | クラウドの一時的な場所（ダウンロードして保存） | 使えない |
| claude.ai/code | クラウドの一時的な場所（時間がたつと消える） | 使えない |

保存先の Google ドライブのフォルダを決めている場合は、どの場所で使ってもそのフォルダに保存されます。

## 使い方

いちばん簡単な使い方は、引数なしで実行することです。最近の会議メモが候補として出るので、選ぶだけで始められます。

```
/meeting-tasks
```

Cowork や Web 版では、「議事録を作って」と頼むだけで同じように動きます。「10/2 の西川さんとの MTG」のように会議名・日付・参加者を添えると、その会議メモを探します。

まずはお試し実行（保存・登録を一切しない）で確認するのがおすすめです。

```
/meeting-tasks --dry-run
```

問題なければ `--dry-run` を外して本番実行します。会議メモを決めて実行したいときは、引数で指定します。

```
/meeting-tasks --doc-id {Google DocsのURLまたはID}
```

### 主な引数

| 引数 | 必須 | 説明 |
|---|:---:|---|
| `--doc-id` | — | Gemini によるメモの URL または ID（省略すると、最近の会議メモから選ぶ） |
| `--backlog-project` | — | 課題登録先のプロジェクトキー（省略時は「設定」に従う。どこにもなければ登録の前に聞く） |
| `--save-folder` | — | 議事録を保存する Google ドライブのフォルダの URL または ID（省略時は「設定」に従う。どこにもなければパソコンに保存） |
| `--prev` | — | 前回の議事録（ファイルパスか Google Docs の ID）。省略時は保存先（Google ドライブのフォルダか `~/Documents/minutes/`）から同じ名前の会議を自動で探す。`none` で比較しない |
| `--dry-run` | — | お試し実行 |

詳しくは `skills/meeting-tasks/SKILL.md` を参照してください。

## 使った記録と試算

本番で使うたびに、次を記録ファイル（`~/Documents/minutes/meeting-tasks-log.csv`。Cowork ではつないだ `minutes` フォルダの中）に 1 行ずつ残します。お試し実行は記録しません。

| 記録すること | 測り方 |
|---|---|
| 確認・承認にかかった時間 | 確認の画面を初めて出したときから、承認するまで（修正の指示と、画面を出し直す待ち時間を含む） |
| TODO の数 | 抜き出した TODO の数と、そのうち社内の数・Backlog に登録した数・カレンダーに入れた数 |
| 「似た課題あり」で止めた数 | 「⚠ 似た課題あり」になった TODO の数と、そのうち Backlog に登録しなかった数 |
| 修正の回数 | 確認の画面を出し直した回数 |

途中で「やめる」を選んだ回も、「やめた」として残します（集計には入れません）。CSV なので、Excel でも開けます。

ある程度たまったら、このリポジトリのフォルダで次を実行すると、集計と、Backlog の「試算」にそのまま貼れる文が出ます。

```
node skills/meeting-tasks/scripts/meeting-log.mjs summary
```

- いまのやり方の時間は測れないので、仮の値（清書 30 分、Backlog への登録 1 件 3 分）で出します。値を変えるときは `--manual-minutes 20 --per-todo 2` のように付けます
- 記録ファイルの場所が違うときは `--file {記録ファイルのパス}` を付けます
- 記録ファイルには会議名が入ります。集計の結果には会議名は出ません

## 注意

- Backlog に登録した課題は、権限によっては削除できません。承認すると Backlog とカレンダーにまとめて登録されるので、確認の画面をよく見てから承認してください
- カレンダーの招待に使う担当者のメールアドレスは Backlog から取れないため、確認の画面でチャットから伝えてください（伝えなければ招待なしで登録します）
- スキルを修正したら、`.claude-plugin/plugin.json` の `version` を上げてから、Claude Code では `claude plugin update meeting-tasks@meeting-tasks-local` で入れ直してください（スキルのフォルダをコピーして使っている場合は、コピーし直す）。Cowork で使っている場合は、プラグインもアップロードし直してください
- `settings.md` に API キーやパスワードを書かないでください。プラグインを入れた全員に配られます

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

上の例は Windows 用です。Mac では `command` を `npx` にし、`PATH` の行を消します（Mac では確かめていません）。プラグインとして入れた Backlog の接続も、Node.js が見えていないと同じエラーになります。そのときは VS Code をすべて閉じてから開き直してください。

### コネクタを許可したのに使えない

**原因**: claude.ai でコネクタ（Google Calendar など）を許可しても、開いている Claude Code には反映されない。

**直し方**: Claude Code を開き直す（VS Code の「Developer: Reload Window」など）。`/mcp` でそのコネクタが「connected」になっていれば使える。

### インストールしたコマンド（git など）が「認識されません」と出る

**原因**: Backlog MCP と同じで、インストール前から開いている VS Code には新しい PATH が反映されない。

**直し方**: VS Code をすべて閉じてから開き直す。

### カレンダーの招待で担当者のメールアドレスが入らない

**原因**: Backlog の API では、自分以外のユーザーのメールアドレスを取得できない。

**直し方**: 確認の画面で、招待したい人のメールアドレスをチャットで伝える。伝えなければ招待なしで登録する（担当者が自分のときは招待しない）。

### テストで Backlog に課題を登録してしまった

**原因**: 登録した課題は、権限によっては削除できない。

**直し方**: コメントを付けてクローズする。試すときは `--dry-run` を使い、本当に登録して確かめたいときは件名に「【テスト】」を付けて 1 件だけにする。

### Cowork を開くと「最新のインストーラーで Claude Desktop をインストールする必要があります」と出る

**原因**: winget などで古い形式の Claude Desktop を入れている。

**直し方**: Claude Desktop をアンインストールし、公式サイト（https://claude.com/download）からダウンロードして入れ直す。

### Cowork で「Backlog が接続されていないため…」と出る

**原因**: Backlog の設定は VS Code（Claude Code）の `~/.claude.json` にしかなく、Cowork からは見えない。

**直し方**: セットアップの「Claude Desktop（Cowork）で使う」の手順 4 のとおり、Claude Desktop の設定ファイルに Backlog MCP を書き足して再起動する。「設定」→「開発者」で backlog が「running」になっていれば使える。

### 確認の画面に「⚠ 似た課題あり」と出る

**原因**: 同じ作業の課題が Backlog にすでにある（完了済みも含む）。古い会議のメモで実行したときによく出る。

**直し方**: 重複する TODO は、承認する前に「◯番は Backlog に入れない」とチャットで伝える。

### 会議メモの候補に、目当ての会議が出てこない

**原因**: 候補に出すのは、今日（1 件もなければここ 7 日）に作られた「Gemini によるメモ」の新しいもの 4 件だけ。主催者が自分でない場合は、メモが共有されていないと見つからない。

**直し方**: 会議名や日付（例：「10/2 の MTG」）を送ると、その条件で探し直す。見つからなければ会議メモの URL を送る。共有されていなければ、主催者に共有してもらう。
