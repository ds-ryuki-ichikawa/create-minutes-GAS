// 議事録づくりの記録（確認・承認にかかった時間、TODO の数、「似た課題あり」で止めた数）を残し、集計する。
//
// 使い方:
//   node meeting-log.mjs add '<JSON>'     … 1 回分の記録を足す（スキルの Step 13 から呼ぶ。JSON は標準入力からでもよい）
//   node meeting-log.mjs summary         … 記録を集計し、Backlog の「試算」に貼れる文を出す
//
// オプション:
//   --file <パス>          記録ファイル（省略時は ~/Documents/minutes/meeting-tasks-log.csv）
//   --manual-minutes <分>  集計のとき、いまのやり方の清書にかかる時間の仮の値（省略時は 30）
//   --per-todo <分>        集計のとき、いまのやり方で Backlog に 1 件登録する時間の仮の値（省略時は 3）
//
// add の JSON の項目:
//   meetingDate, meetingTitle, result（"承認" か "やめた"）, confirmShownAt, approvedAt（ISO 8601 の日時）,
//   edits, todos, internalTodos, backlogRegistered, similarFlagged, similarStopped, calendarRegistered
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COLUMNS = [
  ["recordedAt", "記録日時"],
  ["meetingDate", "会議日"],
  ["meetingTitle", "会議名"],
  ["result", "結果"],
  ["confirmShownAt", "確認画面を出した時刻"],
  ["approvedAt", "承認した時刻"],
  ["confirmMinutes", "確認・承認の分"],
  ["edits", "修正の回数"],
  ["todos", "TODO数"],
  ["internalTodos", "社内TODO数"],
  ["backlogRegistered", "Backlog登録数"],
  ["similarFlagged", "似た課題あり数"],
  ["similarStopped", "似た課題で止めた数"],
  ["calendarRegistered", "カレンダー登録数"],
];
const NUMBER_KEYS = ["edits", "todos", "internalTodos", "backlogRegistered", "similarFlagged", "similarStopped", "calendarRegistered"];

function parseArgs(argv) {
  const opts = { file: path.join(os.homedir(), "Documents", "minutes", "meeting-tasks-log.csv"), manualMinutes: 30, perTodo: 3 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") opts.file = argv[++i];
    else if (a === "--manual-minutes") opts.manualMinutes = Number(argv[++i]);
    else if (a === "--per-todo") opts.perTodo = Number(argv[++i]);
    else rest.push(a);
  }
  return { opts, rest };
}

const quote = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// ダブルクォートで囲んだ値（中のカンマ・改行・"" を含む）にも対応する
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const index = Object.fromEntries(COLUMNS.map(([key, label]) => [key, header.indexOf(label)]));
  return rows.map((r) => Object.fromEntries(COLUMNS.map(([key]) => [key, index[key] >= 0 ? r[index[key]] : ""])));
}

function add(opts, json) {
  // JSON を引数で渡しにくいシェル（PowerShell など）のために、"-" か省略なら標準入力から読む
  const text = json && json !== "-" ? json : fs.readFileSync(0, "utf8");
  if (!text.trim()) throw new Error("記録する内容（JSON）を渡してください");
  const input = JSON.parse(text);
  const record = { ...input, recordedAt: new Date().toISOString() };
  for (const key of NUMBER_KEYS) record[key] = Number(input[key] ?? 0);
  const shown = Date.parse(input.confirmShownAt), approved = Date.parse(input.approvedAt);
  record.confirmMinutes = Number.isFinite(shown) && Number.isFinite(approved) && approved >= shown
    ? Math.round(((approved - shown) / 60000) * 10) / 10
    : "";

  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  // Excel で開いても文字化けしないように、新しく作るときは BOM 付きの UTF-8 にする
  if (!fs.existsSync(opts.file)) fs.writeFileSync(opts.file, "﻿" + COLUMNS.map(([, label]) => quote(label)).join(",") + "\r\n");
  fs.appendFileSync(opts.file, COLUMNS.map(([key]) => quote(record[key])).join(",") + "\r\n");
  console.log(`記録しました：${opts.file}（確認・承認 ${record.confirmMinutes === "" ? "不明" : record.confirmMinutes + " 分"}）`);
}

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summary(opts) {
  const all = readRecords(opts.file);
  const runs = all.filter((r) => r.result === "承認");
  if (runs.length === 0) {
    console.log(`集計できる記録がありません（${opts.file}）。本番で承認した回だけを集計します。`);
    return;
  }
  const minutes = runs.filter((r) => r.confirmMinutes !== "").map((r) => Number(r.confirmMinutes)).filter(Number.isFinite);
  const sum = (key) => runs.reduce((a, r) => a + Number(r[key] || 0), 0);
  const dates = runs.map((r) => r.meetingDate).filter(Boolean).sort();
  const todos = sum("todos"), backlog = sum("backlogRegistered");
  const flagged = sum("similarFlagged"), stopped = sum("similarStopped");
  const cancelled = all.filter((r) => r.result === "やめた").length;

  console.log(`■ 集計（${opts.file}）`);
  console.log(`・対象：本番で承認した ${runs.length} 回（会議日 ${dates[0] ?? "不明"}〜${dates.at(-1) ?? "不明"}）。途中でやめた回は ${cancelled} 回`);
  if (minutes.length) {
    console.log(`・確認・承認の時間：平均 ${round1(mean(minutes))} 分、中央値 ${round1(median(minutes))} 分（最短 ${Math.min(...minutes)} 分・最長 ${Math.max(...minutes)} 分）`);
  }
  console.log(`・TODO：${todos} 件（1 回平均 ${round1(todos / runs.length)} 件）。Backlog に登録したのは ${backlog} 件（1 回平均 ${round1(backlog / runs.length)} 件）`);
  console.log(`・「似た課題あり」：${flagged} 件。そのうち登録をやめたのは ${stopped} 件`);
  console.log(`・修正の指示：1 回平均 ${round1(sum("edits") / runs.length)} 回`);

  if (!minutes.length) return;
  const toolMinutes = round1(mean(minutes));
  const perRunBacklog = round1(backlog / runs.length);
  const manual = round1(opts.manualMinutes + opts.perTodo * perRunBacklog);
  const ratio = manual > 0 ? Math.round(((manual - toolMinutes) / manual) * 10) : 0;

  console.log("");
  console.log("■ Backlog の「試算」に貼る文");
  console.log(`・試算（実際に使った ${runs.length} 回の記録から）`);
  console.log(`　- このツール：確認と承認に平均 ${toolMinutes} 分（実測。修正の指示や、AI が画面を出し直すまでの待ち時間も含む）`);
  console.log(`　- いまのやり方：清書に ${opts.manualMinutes} 分、Backlog への登録に 1 件 ${opts.perTodo} 分かかるとすると、${opts.manualMinutes} ＋ ${opts.perTodo} × ${perRunBacklog} ＝ 約 ${manual} 分（この 2 つは仮に置いた値で、実際に測ってはいない）`);
  console.log(`　- 差：1 回あたり約 ${round1(manual - toolMinutes)} 分${ratio > 0 ? `（約 ${ratio} 割減）` : ""}`);
  console.log(`　- 「似た課題あり」で登録をやめた TODO：${stopped} 件（${flagged} 件のうち。二重登録を防いだ数）`);
}

const [command, ...argv] = process.argv.slice(2);
const { opts, rest } = parseArgs(argv);
try {
  if (command === "add") add(opts, rest[0]);
  else if (command === "summary") summary(opts);
  else {
    console.error("使い方: node meeting-log.mjs add '<JSON>' | summary [--file <パス>] [--manual-minutes 30] [--per-todo 3]");
    process.exit(1);
  }
} catch (err) {
  console.error(`記録できませんでした: ${err.message}`);
  process.exit(1);
}
