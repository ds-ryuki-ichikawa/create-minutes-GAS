# 議事録作成プラグイン 導入・操作手順書

Google Meet の「Gemini によるメモ」から議事録を作り、社内の TODO を Backlog の課題と Google カレンダーのリマインドに登録するプラグイン（`meeting-tasks`）を、実際に動かすまでの手順です。

- [1. 動作環境](#1-動作環境)
- [2. 導入する](#2-導入する)（A. Claude Code／B. Claude Desktop の Cowork）
- [3. 操作手順](#3-操作手順)
- [4. 困ったとき](#4-困ったとき)

Claude 専用です。Gemini・ChatGPT では、今の会社の契約では動かせません。

## 1. 動作環境

### 必要なもの

| 必要なもの | 内容 |
| --- | --- |
| Claude の有料プラン | Pro・Max・Team・Enterprise のいずれか |
| パソコン | Windows 10 以上、または Mac（Mac は手順を用意したが、まだ動かしていない。[Mac での確認](MAC-CHECK.md)を参照） |
| 使う場所（どちらか） | A. Claude Code（VS Code の拡張機能、または Claude Desktop の Code タブ）／B. Claude Desktop の Cowork |
| Node.js | LTS 版（20 以上）。Backlog につなぐときだけ必要 |
| Google アカウント | 会議メモのある Google ドライブと、Google カレンダーを使うもの |
| 会議メモ | Google Meet の「Gemini でメモを取る」で作られた「Gemini によるメモ」（Google ドキュメント）。「文字起こし」もオンにしておくと正確になる |
| Backlog | 登録先のプロジェクトと、自分の API キー（「個人設定」→「API」で発行） |
| Git | A で、リポジトリから入れるときだけ必要 |

### 使える場所と違い

| 使う場所 | 始め方 | 議事録の保存先 | Backlog | おすすめ |
| --- | --- | --- | --- | --- |
| A. Claude Code（VS Code・Desktop の Code タブ） | `/meeting-tasks:meeting-tasks` | `~/Documents/minutes/` | 使える（プラグインに接続が入っている） | 試すならこちらが早い |
| B. Claude Desktop の Cowork | 「議事録を作って」と頼む | つないだ `minutes` フォルダ | 使える（設定ファイルに書き足す） | エンジニアでない人が使うとき |
| ブラウザの Claude（claude.ai） | 「議事録を作って」と頼む | ダウンロードして保存 | 使えない（手で登録する一覧が出る） | 議事録を残す用途には向かない |

保存先を Google ドライブのフォルダにする設定もあります（`skills/meeting-tasks/references/settings.md` の「議事録の保存先」）。その場合は、どこで使っても同じフォルダに残ります。

### しくみ

```
Google ドライブ ──（Claude の Google Drive コネクタ）──▶ 会議メモを読む
                                                          │
                                         Claude が議事録と TODO を作る
                                                          │
                                         確認画面で人が 1 回だけ承認する
                                                          │
          ┌──────────────────────────────┼──────────────────────────────┐
          ▼                              ▼                              ▼
  議事録を保存する              Backlog に課題を登録する         Google カレンダーに
  （パソコンの minutes           （Backlog MCP。パソコンの中で      期限の予定を入れる
   フォルダか Google ドライブ）    動き、API キーで Backlog に接続）  （Google Calendar コネクタ）
```

- 会議メモの内容は、議事録を作るために Claude に送られます
- Backlog の接続（`backlog-mcp-server`）は、パソコンの中で Node.js（`npx`）を使って動きます
- 承認するまで、保存・登録は何もしません

### 動作を確かめた環境

| 項目 | 版 |
| --- | --- |
| OS | Windows 11 Pro |
| Claude Code | 2.1.302（VS Code の拡張機能） |
| Node.js | v24.20.0 |
| backlog-mcp-server | 0.23.3 |
| プラグイン（meeting-tasks） | 3.2.0 |

Mac では、まだ動かしていません。次回 Mac で確かめる予定で、確かめる項目を [MAC-CHECK.md](MAC-CHECK.md) にまとめています。

## 2. 導入する

A か B のどちらかを行います。試すだけなら A が早いです。

### A. Claude Code で使う

1. VS Code に「Claude Code」の拡張機能を入れ、Claude のアカウントでログインする
2. Node.js の LTS 版を <https://nodejs.org> から入れる。ターミナルで `node -v` が動けばよい
   - Mac では、公式サイトのインストーラー（`.pkg`）で入れるのがおすすめ。Homebrew や nvm で入れた Node.js は、アプリから見つからないことがある（見つからないときは「4. 困ったとき」を参照）
3. Google ドライブと Google カレンダーをつなぐ。ブラウザで <https://claude.ai> を開き、「設定」→「コネクタ」で「Google Drive」と「Google Calendar」を接続する（Claude Code は、アカウントでつないだコネクタを使う）
4. リポジトリを手元に置き、ターミナルで次を実行する。`{C03-meeting-tasks のフォルダ}` には、clone した中の `C03-meeting-tasks` フォルダのパスを入れる

   ```
   git clone https://github.com/dimageshare/ai-productivity-lab.git
   claude plugin marketplace add {C03-meeting-tasks のフォルダ}
   claude plugin install meeting-tasks@meeting-tasks-local
   ```

5. VS Code で Claude Code を開き、`/plugin configure meeting-tasks@meeting-tasks-local` と送って、次を入力する

   | 項目 | 入れるもの |
   | --- | --- |
   | `backlog_project` | 登録先の Backlog のプロジェクトキー（例：`IB_TASK`） |
   | `save_folder` | 空のままでよい（パソコンの `~/Documents/minutes/` に保存） |
   | `backlog_domain` | Backlog のドメイン（例：`xxx.backlog.jp`） |
   | `backlog_api_key` | Backlog の API キー（安全な保管場所に保存され、画面には出ない） |

6. VS Code を開き直す。Claude Code で `/mcp` と送り、`plugin:meeting-tasks:backlog` が connected になっていれば完了

すでに自分で Backlog MCP を設定している場合は、そちらがそのまま使われます。

### B. Claude Desktop の Cowork で使う

**B-1. Claude Desktop を入れる**

Claude Desktop は、必ず公式サイトから入れてください。ほかの方法（winget など）で入れたものでは、Cowork が使えません。

1. ブラウザで <https://claude.com/download> を開き、自分のパソコン用（Windows か Mac）をダウンロードする
2. インストールする
   - Windows：ダウンロードしたファイルを開く。「このアプリがデバイスに変更を加えることを許可しますか」と出たら「はい」を押す
   - Mac：ダウンロードした `.dmg` を開き、Claude のアイコンを「アプリケーション」フォルダにドラッグする。「アプリケーション」から Claude を開く
3. Claude Desktop が開いたら、Claude のアカウントでログインする
4. 画面の左側に「Cowork」が出ていれば完了

初めて Cowork を開くと、パソコンの準備（Windows では仮想化の機能）の確認が行われます。設定を求められたら、画面の案内に従ってください。

**B-2. プラグインを入れる**

zip ファイルを、解凍せずにそのままアップロードします。

1. `meeting-tasks-plugin.zip` を用意する。提供元から受け取るか、リポジトリの `C03-meeting-tasks` フォルダで `scripts/build-cowork-zip.sh` を実行して作る（Windows は Git Bash、Mac はターミナルで実行する）。zip の中身は Windows と Mac で同じなので、どちらで作ったものでも使える
2. Claude Desktop の左側で「Customize」→「Plugins」を開く
3. 「Add」→「Upload plugin」を選び、zip ファイルを選ぶ
4. プラグインの一覧に「議事録作成」が出ていれば完了

プラグインは Claude のアカウントに保存されるので、別のパソコンで同じアカウントにログインしても使えます。会社のプランによっては、管理者がプラグインの追加や Cowork を止めていることがあります。「Upload plugin」が見当たらない場合は、Claude の管理者に確認してください。

**B-3. Google ドライブと Google カレンダーをつなぐ**

1. Claude Desktop の左側で「Customize」→「Connectors」を開く
2. 「Google Drive」を選んで接続し、会議メモを開ける Google アカウントでログインして許可する
3. 「Google Calendar」も同じように接続する
4. どちらも「Connected」になっていれば完了

Google カレンダーをつながなくても議事録は作れます。その場合は、手でカレンダーに入れるための一覧が出ます。

**B-4. Backlog をつなぐ**

Backlog に登録しない場合は、この手順を飛ばしてかまいません（登録する課題の一覧が出るので、手で登録します）。

Windows と Mac で手順が違います。

**Windows の場合**

1. Node.js の LTS 版を <https://nodejs.org> から入れる（設定は変えずに「次へ」で進める）
2. Claude Desktop を完全に終了する。画面右下のタスクトレイの Claude のアイコンを右クリックし、「終了」を選ぶ（開いたままだと、書き足した内容が上書きされることがある）
3. エクスプローラーのアドレス欄に `%APPDATA%\Claude` と入力して Enter を押す
4. `claude_desktop_config.json` をメモ帳で開く。念のため、先にファイルをコピーして控えを取っておく
5. 1 行目の `{` のすぐ下に、次の内容を貼り付ける。`{スペースID}` と `{APIキー}` は自分のものに書き換え、`{ }` も消す

   ```json
     "mcpServers": {
       "backlog": {
         "command": "C:\\Program Files\\nodejs\\npx.cmd",
         "args": ["-y", "backlog-mcp-server"],
         "env": {
           "PATH": "C:\\Program Files\\nodejs;C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
           "BACKLOG_DOMAIN": "{スペースID}.backlog.jp",
           "BACKLOG_API_KEY": "{APIキー}"
         }
       }
     },
   ```

6. 上書き保存して、Claude Desktop を開く。「設定」→「開発者」で backlog が「running」になっていれば完了

**Mac の場合**（まだ動かしていない手順です）

1. Node.js の LTS 版を、<https://nodejs.org> の公式インストーラー（`.pkg`）で入れる
2. ターミナルを開き、`which npx` を実行する。出てきたパス（例：`/usr/local/bin/npx`）を控える
3. Claude Desktop を完全に終了する。画面上のメニューバーの「Claude」→「Claude を終了」を選ぶ（⌘Q でもよい）
4. Finder で、メニューバーの「移動」→「フォルダへ移動」を選び、`~/Library/Application Support/Claude` と入力して開く
5. `claude_desktop_config.json` をテキストエディットで開く。念のため、先にファイルを複製して控えを取っておく。ファイルがなければ、テキストエディットで `{` と `}` の 2 行だけのファイルを作り、この名前で保存する（「フォーマット」→「標準テキストにする」にしてから保存する）
6. 1 行目の `{` のすぐ下に、次の内容を貼り付ける。`{npx のパス}` には 2 で控えたパスを入れ、`{スペースID}` と `{APIキー}` は自分のものに書き換え、`{ }` も消す

   ```json
     "mcpServers": {
       "backlog": {
         "command": "{npx のパス}",
         "args": ["-y", "backlog-mcp-server"],
         "env": {
           "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
           "BACKLOG_DOMAIN": "{スペースID}.backlog.jp",
           "BACKLOG_API_KEY": "{APIキー}"
         }
       }
     },
   ```

7. 保存して、Claude Desktop を開く。「設定」→「開発者」で backlog が「running」になっていれば完了

`PATH` の行は、`npx` が Node.js を見つけるためのものです。Node.js を別の場所に入れている場合は、`which node` で出たフォルダを先頭に足してください。

スペース ID は、Backlog の URL の `https://` のすぐ後ろの部分です。すでに `"mcpServers"` がある場合は、その中に `"backlog": {…}` の部分だけを足してください。API キーはあなたの Backlog の権限で動くので、他の人に教えないでください。

**B-5. 議事録の保存フォルダをつなぐ**

Cowork は、つないだフォルダにしかファイルを保存できません。

1. 「ドキュメント」（Mac の Finder では「書類」）を開き、`minutes` という名前のフォルダを作る
2. Cowork で初めて議事録を作るときに、フォルダの接続を求められるので、1 で作った `minutes` フォルダを選ぶ

つながないと、議事録がフォルダに保存されず、前回の議事録とも比べられません。

## 3. 操作手順

### 3-1. お試しで動かす

最初は「お試し」で動かします。お試しでは、保存・登録の予定を見せるだけで、実際には何もしません。

1. 始める

   | 使う場所 | 送るもの |
   | --- | --- |
   | A. Claude Code | `/meeting-tasks:meeting-tasks --dry-run` |
   | B. Cowork | 新しいタスクで `議事録を作って（お試し）` |

2. 会議メモを選ぶ。今日の会議メモ（なければ 7 日以内）が新しい順に出るので、作りたい会議を選ぶ（Claude Code はボタン、Cowork は番号を送る）

   ```
   📄 最近の会議メモ（どれで議事録を作りますか？）

     1. 10/30（木）15:00　定例会議
     2. 10/29（水）10:00　MTG（議事録あり）
   ```

   目当ての会議が出ないときは、会議名や日付（例：「10/2 の MTG」）か、会議メモの URL を送ります。

3. しばらくすると、確認の画面が出る。登録先の Backlog のプロジェクトを聞かれたら、プロジェクトキーを送る

   ```
   📋 内容を確認してください（承認すると、議事録の保存と Backlog・カレンダーへの登録をまとめて行います）

   ■ TODO と登録先（Backlog：IB_TASK）
     1. [社内] 見積書を再提出する｜山田 太郎｜2026-10-28 → Backlog・カレンダー
     2. ⚠ [社内] 主要画面のイメージを作成する｜未定｜2026-10-30 → Backlog・カレンダー
     3. [社外] 現行の資料を送る｜〇〇様｜2026-10-27 → 登録しない（社外の作業）

   ■ 議事録の保存先
   ■ 非公開情報（社外に共有する前に伏せるか確認）
   ■ 前回からの変更
   ■ 要確認事項
   ```

   - ⚠ は、担当者か期限が決まっていないもの
   - 「⚠ 似た課題あり」は、同じ作業の課題が Backlog にもうあるもの
   - 社外（お客様など）の TODO は Backlog に登録しない

4. 直したいところがあれば、ふつうの言葉で送る。直すと、もう一度確認の画面が出る

   - 「2 番の担当は佐藤」
   - 「3 番は Backlog に入れない」
   - 「1 番は佐藤をカレンダーに招待して。sato@example.com」
   - 「要確認の 1 つ目は 1 営業日が正しい」

5. 「承認する／修正する／やめる」から「承認する」を選ぶ（Cowork では「1」を送る）
6. お試しでは、保存先・Backlog に登録する課題・カレンダーに入れる予定が「実行予定」として出て終わる

### 3-2. 本番で動かす

お試しで問題なければ、`--dry-run`（Cowork では「（お試し）」）を外して同じ手順で動かします。「承認する」を選ぶと、次をまとめて行い、最後に結果が出ます。

```
✅ 議事録作成完了

📄 保存先         : C:\Users\{ユーザー名}\Documents\minutes\2026-10-30_定例会議.md
📝 Backlog 課題   : 2 件登録（IB_TASK-201, IB_TASK-202）
📅 カレンダー     : 2 件のリマインドを登録
✅ TODO           : 3 件抽出（社内 2 件・社外 1 件）
🔗 前回の議事録   : なし
```

| 登録先 | 登録される内容 |
| --- | --- |
| 議事録 | `{会議日}_{会議名}.md`。まとめ → 決まったこと → TODO → 決まっていないこと → 話し合いの記録の順。非公開情報があると先頭に「社外共有不可」と出る |
| Backlog | 社内の TODO 1 件につき課題 1 件。件名は TODO の内容、種別「タスク」、優先度「中」、担当者と期限、詳細に会議名・開催日・元メモの URL |
| Google カレンダー | 期限が決まっている社内の TODO を、自分のカレンダーに期限日の終日予定「【期限】{TODO}」として入れる。前日 9:00 に通知。予定の空き状況はふさがない |

- 要確認事項が残ったまま承認すると、議事録の「決まっていないこと」に入れて保存します
- 同じ会議名の議事録が前にあれば、自動で比べて「前回からの変更」をまとめます。定例会議は毎回同じ会議名にしてください

### 3-3. 試したあとの片付け

- Backlog の課題は、権限によっては削除できません。試しに登録した課題は、コメントを付けて完了にするか、管理者に削除を頼んでください
- カレンダーの予定は、Google カレンダーから削除できます
- 議事録のファイルは、`minutes` フォルダから削除できます

### 3-4. 引数（Claude Code）

| 引数 | 説明 |
| --- | --- |
| `--dry-run` | お試し。保存・登録をしない |
| `--doc-id {URL}` | 会議メモを指定する（候補から選ばずに始める） |
| `--backlog-project {キー}` | 登録先の Backlog のプロジェクトをこの回だけ変える |
| `--save-folder {URL}` | 議事録を保存する Google ドライブのフォルダ |
| `--prev {ファイル}` | 比べる前回の議事録を指定する。`none` で比べない |

## 4. 困ったとき

| こんなとき | どうする |
| --- | --- |
| 候補に目当ての会議が出てこない | 会議名や日付、会議メモの URL を送る。主催者が自分でない場合は、メモを共有してもらう |
| 「ドキュメントが読み込めない」と出る | つないだ Google アカウントで、そのメモを開けるか確かめる |
| 「Backlog が接続されていないため…」と出る | A は `/mcp` で `plugin:meeting-tasks:backlog` を、B は「設定」→「開発者」で backlog を確かめる |
| Backlog が「Connection closed」でつながらない | A は `/plugin configure` で `backlog_domain` と `backlog_api_key` が入っているか、B は設定ファイルの書き間違い（カンマや `"` の抜け）を確かめる。どちらも `node -v` が動くか確かめる |
| Mac で、Backlog の接続に「node が見つからない」（`spawn node ENOENT` など）と出る | アプリから Node.js が見えていない。公式インストーラー（`.pkg`）で Node.js を入れ直すか、A ならターミナルで `code .` と打って VS Code を開き直す |
| 「最新のインストーラーで Claude Desktop をインストールする必要があります」と出る | Claude Desktop をアンインストールし、公式サイトから入れ直す |
| 担当者が「⚠ 未設定」のまま | Backlog のプロジェクトのメンバーにその名前がない。Backlog に登録されている名前で伝える |
| 議事録がフォルダに保存されない（Cowork） | B-5 の `minutes` フォルダをつなぐ |

もっと詳しい設定（組織の初期値、Google ドライブへの保存など）は [README.md](README.md) を、毎日の使い方は [GUIDE.md](GUIDE.md) を見てください。
