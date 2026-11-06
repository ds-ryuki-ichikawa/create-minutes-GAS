// 書き方の指示（skills/meeting-tasks/references/minutes-template.md）と、お試し用の会議メモ（samples/sample-meeting-memo.md）から、
// Apps Script 用のファイル（gas/src/Prompt.gs・gas/src/Sample.gs）を作る。
//
// 使い方（リポジトリのフォルダで）:
//   node gas/tools/build.mjs          … 作り直す
//   node gas/tools/build.mjs --check  … 作り直しが要るかだけ確かめる（要るなら終了コード 1）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

export function buildFiles() {
  const template = read("skills/meeting-tasks/references/minutes-template.md").trimEnd();
  const [title, ...rest] = read("samples/sample-meeting-memo.md").split("\n");
  const header = (src) =>
    `// このファイルは gas/tools/build.mjs が ${src} から作る。直接は直さず、元のファイルを直してから作り直す。\n`;
  return {
    "gas/src/Prompt.gs":
      header("skills/meeting-tasks/references/minutes-template.md") +
      `var PROMPT_TEMPLATE = ${JSON.stringify(template)};\n`,
    "gas/src/Sample.gs":
      header("samples/sample-meeting-memo.md") +
      `var SAMPLE_MEMO_TITLE = ${JSON.stringify(title.trim())};\n` +
      `var SAMPLE_MEMO_TEXT = ${JSON.stringify(rest.join("\n").trim())};\n`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes("--check");
  let stale = [];
  for (const [file, content] of Object.entries(buildFiles())) {
    const full = path.join(root, file);
    const now = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    if (now === content) continue;
    stale.push(file);
    if (!check) fs.writeFileSync(full, content);
  }
  if (check && stale.length) {
    console.error(`作り直しが必要です: ${stale.join(", ")}（node gas/tools/build.mjs を実行してください）`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? "古い" : "作り直しました"}: ${stale.join(", ")}` : "最新です");
}
