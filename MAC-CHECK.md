# Mac での確認（チェックリスト）

Mac 用の手順は [INSTALL.md](INSTALL.md) に書いてありますが、まだ Mac で動かしていません。次回 Mac で動かすときに、この順に確かめます。A だけなら 15〜30 分ほどです。

Windows と違う動きをするのは、Backlog の接続の起動（`skills/meeting-tasks/scripts/backlog-mcp.mjs` と、Cowork の設定ファイル）だけです。ほかは Claude のアプリとコネクタの機能なので、Windows と同じに動くはずです。

## 用意するもの

- Mac（Claude の有料プランのアカウントでログインできるもの）
- Backlog の API キー（INSTALL.md の「必要なもの」を参照）
- Google ドライブにある「Gemini によるメモ」1 つ（7 日以内のものだと、候補に出る）

## A. Claude Code（先にこちら）

- [ ] 1. ターミナルで次を実行し、結果を下の「記録」に書く

  ```
  sw_vers
  node -v
  which node npx
  git --version
  ```

- [ ] 2. INSTALL.md の「A. Claude Code で使う」の 1〜5 を行う
- [ ] 3. VS Code を開き直し、Claude Code で `/mcp` と送る。`plugin:meeting-tasks:backlog` が connected になるか
  - ならないときは、出たエラーの文をそのまま記録する
  - VS Code をいったん終了し、ターミナルで `code .` と打って開き直してから、もう一度 `/mcp` を見る（アプリから Node.js が見えていないかどうかの切り分け）
- [ ] 4. `/meeting-tasks:meeting-tasks --dry-run` を送る
  - [ ] 会議メモの候補が出る
  - [ ] 選ぶと、確認の画面が出る（TODO の担当者が Backlog のユーザーと照合されていれば、Backlog につながっている）
  - [ ] 「承認する」を選ぶと、実行予定が出る。保存先が `/Users/{ユーザー名}/Documents/minutes/…` になっている
- [ ] 5. （できれば）本番で 1 回動かす
  - 確認の画面で、TODO を 1 件だけ残して「ほかは Backlog に入れない」と送り、残した 1 件の件名の頭に【テスト】と付けてもらう
  - [ ] 議事録が `~/Documents/minutes/` に保存される
  - [ ] Backlog に課題が 1 件登録される
  - [ ] Google カレンダーに予定が入る
  - 終わったら、課題にコメントを付けて完了にし、カレンダーの予定と議事録のファイルを消す

## B. Cowork（時間があれば）

- [ ] 6. INSTALL.md の「B. Claude Desktop の Cowork で使う」を、Mac の手順で行う。B-4 で、backlog が「running」になるか
- [ ] 7. Cowork の新しいタスクで「議事録を作って（お試し）」と送り、A の 4 と同じところまで進むか
- [ ] 8. ターミナルで、リポジトリの `C03-meeting-tasks` フォルダに移って `scripts/build-cowork-zip.sh` を実行し、zip ができるか（できなくても、Windows で作った zip を使えばよい）

## 記録

| 項目 | 結果 |
| --- | --- |
| 確かめた日・人 | |
| macOS の版（`sw_vers`）・チップ（Intel か Apple シリコン） | |
| Node.js の版と入れ方（公式インストーラー・Homebrew・nvm など） | |
| `which node` / `which npx` | |
| Git の版 | |
| Claude Code の版（`claude --version`） | |
| Claude Desktop の版（Cowork を試した場合） | |
| 3. `/mcp` で Backlog がつながったか | |
| 4. お試し実行 | |
| 5. 本番の 1 件 | |
| 6〜8. Cowork・zip | |
| 出たエラー（そのまま貼る） | |

## 終わったら

- 結果を IB_TASK-106 にコメントする
- 全部動いたら、INSTALL.md の「まだ動かしていない」と書いたところを直し、「動作を確かめた環境」に Mac の版を足す
- 動かなかったところは、エラーの文をもとに直す
