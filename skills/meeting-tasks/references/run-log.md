# 使った記録（テスト用）

試用期間に、使い方を見直すための記録を残す手順。`LOG_RUN` が true のときだけ行う（SKILL.md の「設定の決め方」を参照）。ふだんの議事録づくりには関係しない。

1 回ごとに、確認・承認にかかった時間、TODO の数、「似た課題あり」で止めた数を、記録ファイルに 1 行足す。

## Step 8 で控えること

現在時刻は、シェルで取る（例: `node -e "console.log(new Date().toISOString())"`）。

- `CONFIRM_SHOWN_AT`: 確認の画面を初めて表示する直前の現在時刻（修正のあとに出し直したときは更新しない）
- `EDIT_COUNT`: 修正の指示を受けて、確認の画面を出し直した回数
- `APPROVED_AT`: 承認の返事を受けた直後の現在時刻（ほかの処理より先に取る）。「やめる」が選ばれたときは空にする
- `SIMILAR_FLAGGED`: Step 7 で「⚠ 似た課題あり」になった TODO の数（あとで Backlog に入れないことにしたものも数える）
- `SIMILAR_STOPPED`: そのうち、承認の時点で Backlog に登録しないことになっていた TODO の数

「やめる」が選ばれたときも、何も保存・登録せずに下の「記録を残す」を行う。

## Step 12 で足すこと

完了報告の最後に、次の 1 行を足す。

```
⏱ 確認・承認     : {CONFIRM_SHOWN_AT から APPROVED_AT までの分}
```

## 記録を残す（Step 12 のあと）

承認したときは Step 12 のあとに、「やめる」が選ばれたときはその場で行う。ここではもう確認を求めない。

- 記録ファイル: `~/Documents/minutes/meeting-tasks-log.csv`（`SAVE_FOLDER` があっても、記録はパソコンに残す）。Cowork では、接続された `minutes` フォルダの中の `meeting-tasks-log.csv`
- このスキルのフォルダにある `scripts/meeting-log.mjs`（`${CLAUDE_SKILL_DIR}/scripts/meeting-log.mjs`）を、`node` で次のように呼ぶ。JSON は標準入力から渡す（引数で渡すと、シェルによっては引用符が崩れるため）

  ```
  node {スキルのフォルダ}/scripts/meeting-log.mjs add - --file {記録ファイル}
  ```

  標準入力に渡す JSON:

  ```json
  {
    "meetingDate": "{会議日 YYYY-MM-DD}",
    "meetingTitle": "{DOC_TITLE（「 - Gemini によるメモ」を除く）}",
    "result": "{承認 または やめた}",
    "confirmShownAt": "{CONFIRM_SHOWN_AT}",
    "approvedAt": "{APPROVED_AT。やめたときは空}",
    "edits": {EDIT_COUNT},
    "todos": {TODO_COUNT},
    "internalTodos": {社内の TODO の数},
    "backlogRegistered": {BACKLOG_COUNT。やめたときは 0},
    "similarFlagged": {SIMILAR_FLAGGED},
    "similarStopped": {SIMILAR_STOPPED},
    "calendarRegistered": {CALENDAR_COUNT。やめたときは 0}
  }
  ```

- `DRY_RUN` が true の場合は記録しない（お試しは、実際の使い方の記録に入れない）。「📝 記録の予定（お試しのため記録しません）」として、確認・承認にかかった時間だけを表示する
- `node` が使えない・記録ファイルに書けない（Web 版など）場合は、処理を止めずに「記録できませんでした」と伝え、上の JSON を表示する
- 記録の集計は、ユーザーがターミナルで `node {スキルのフォルダ}/scripts/meeting-log.mjs summary` を実行して行う（README の「使った記録と試算（テスト用）」を参照）
