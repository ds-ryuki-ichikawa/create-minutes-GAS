// Apps Script 版のテスト。パソコンの Node.js で動く（node gas/test/run.mjs）。
//
// 1. Google のサービスを使わない計算（ファイル名・照合・登録先・共有の範囲・Markdown の書き直しなど）
// 2. スプレッドシート・ドライブ・Gemini・Backlog・カレンダーの「にせもの」を使った、下書き → 承認 → 登録の通しの動き
//
// にせものは本物の API の形をまねているだけなので、Google の中での本当の動きは、README の「実際の環境で試す項目」で確かめる。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildFiles } from "../tools/build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "src");
const gsFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs")).sort();

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`✖ ${name}\n  ${e.stack.split("\n").slice(0, 4).join("\n  ")}`);
  }
}

// ---------- にせものの Google ----------

function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const DUE1 = addDays(TODAY, 6);
const DUE2 = addDays(TODAY, 8);

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const v = row[this.c - 1 + j];
      return v === undefined ? "" : v;
    }));
  }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  getRow() { return this.r; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setWrap() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setVerticalAlignment() { return this; }
  setHorizontalAlignment() { return this; }
  setNote() { return this; }
  setRichTextValue(rt) { this.sheet.set(this.r, this.c, rt.text); this.sheet.links[`${this.r},${this.c}`] = rt.url; return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.activeRow = 1; this.links = {}; this.rules = []; }
  getName() { return this.name; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    this.data[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if ((this.data[i - 1] || []).some((v) => v !== "" && v !== undefined)) return i;
    return 0;
  }
  getMaxRows() { return 1000; }
  getRange(a, b, c, d) {
    if (typeof a === "string") {
      const col = a.charCodeAt(0) - 64;
      return new FakeRange(this, 1, col, 1000, 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  appendRow(row) { this.data.splice(this.getLastRow(), 0, row.slice()); this.data.length = Math.max(this.data.length, this.getLastRow()); }
  getActiveRange() { return { getRow: () => this.activeRow }; }
  hideColumns() {}
  setFrozenRows() {}
  setFrozenColumns() {}
  setTabColor() {}
  setConditionalFormatRules(rules) { this.rules = rules; }
  linkAt(r, col) { return this.links[`${r},${this.data[0].indexOf(col) + 1}`]; }
  setColumnWidth() {}
}

function makeEnv(opts = {}) {
  const sheets = new Map();
  let active = null;
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
    setActiveSheet: (s) => { active = s; },
    getActiveSheet: () => active || [...sheets.values()][0],
    getUrl: () => "https://docs.google.com/spreadsheets/d/MANAGE/edit",
    toast: () => {},
    moveActiveSheet: () => {},
  };
  const alerts = [];
  const dialogs = [];
  const validation = { requireValueInList() { return this; }, requireCheckbox() { return this; }, build() { return {}; } };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ss,
    getUi: () => ({
      alert: (...a) => alerts.push(a.filter((x) => typeof x === "string").join(" / ")),
      ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL" },
      showModalDialog: (html, title) => dialogs.push({ title, html }),
      Button: { OK: "OK" },
    }),
    newDataValidation: () => validation,
    newConditionalFormatRule: () => {
      const rule = {};
      const b = { whenTextEqualTo: (t) => { rule.text = t; return b; }, whenTextContains: (t) => { rule.contains = t; return b; },
        whenFormulaSatisfied: (f) => { rule.formula = f; return b; }, setBackground: () => b, setFontColor: () => b, setRanges: () => b, build: () => rule };
      return b;
    },
    newRichTextValue: () => {
      const v = {};
      const b = { setText: (t) => { v.text = t; return b; }, setLinkUrl: (u) => { v.url = u; return b; }, build: () => v };
      return b;
    },
  };

  // ドライブ
  const files = new Map();
  let nextId = 1;
  const newId = (p) => `${p}${String(nextId++).padStart(24, "0")}`;
  const addFile = (f) => { files.set(f.id, { trashed: false, createdTime: new Date().toISOString(), modifiedTime: new Date(Date.now() - 3600e3).toISOString(), ...f, webViewLink: `https://drive.google.com/${f.id}` }); return files.get(f.id); };
  const permissions = new Map();

  // 会議メモ（Google ドライブにあるもの）
  const sample = buildFiles()["gas/src/Sample.gs"];
  const memoText = JSON.parse(sample.match(/SAMPLE_MEMO_TEXT = (".*");/)[1]);
  const memoTitle = "サンプル定例 - 2026/11/05 14:00 JST - Gemini によるメモ";
  addFile({ id: "MEMO0000000000000000000001", name: memoTitle, mimeType: "application/vnd.google-apps.document", parents: ["SOMEONE"], text: memoText });

  // Gemini の返事
  const geminiResult = {
    meeting_date: "2026-11-05",
    minutes_markdown: [
      "> **社外共有不可**（金額を含むため）", "", "## 会議情報", "| 項目 | 情報 |", "|------|------|", "| 開催日時 | 2026-11-05 14:00 |", "",
      "## まとめ", "- 受注画面はスプレッドシートと GAS で作ることにした", "",
      "## 決まったこと", "1. 受注画面はスプレッドシートと GAS で作る（費用を抑えるため）", "",
      "## TODO", "| 誰が | 何を | いつまで | 区分 |", "|---|---|---|---|", "| 架空 一郎 | 2 段階に分けた見積書を作り直して送る | x | 社内 |", "",
      "## 決まっていないこと", "- なし", "",
      "## 話し合いの記録", "### 作り方", "- 結論：スプレッドシートと GAS", "",
    ].join("\n"),
    todos: [
      { who: "サンプル商事様 山田様", what: "受注表のサンプルを送る", due: DUE1, category: "社外", keyword: "受注表" },
      { who: "架空 一郎", what: "2 段階に分けた見積書を作り直して送る", due: DUE1, category: "社内", keyword: "見積書" },
      { who: "未定", what: "主要画面のイメージを作る", due: DUE2, category: "社内", keyword: "画面" },
      { who: "見本 花子", what: "次回の定例の日程を調整する", due: "未定", category: "社内", keyword: "日程" },
    ],
    private_info: ["金額（120 万円・80 万円）"],
    to_confirm: ["見積書の期限が 11/10 か 11/12 か"],
  };

  const calls = { gemini: [], backlogPosts: [], calendarInserts: [], trashed: [], mails: [] };
  const fail = { backlogPostAt: 0 };
  let backlogPostCount = 0;
  const calendar = [];

  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const qsOf = (url) => Object.fromEntries(new URL(url).searchParams);

  // 本物のドキュメントの Markdown 書き出しに近づける（箇条書きは「*」、アンダースコアはエスケープ）
  const exportLike = (md) => md.split("\n").map((l) => l.replace(/^(\s*)- /, "$1* ").replace(/_/g, "\\_")).join("\n");

  function drive(method, url, params) {
    const u = new URL(url);
    const q = qsOf(url);
    if (u.pathname.startsWith("/upload/drive/v3/files")) {
      const body = params.payload.toString("utf8");
      const parts = body.split(/--mt[0-9a-f]+/);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1]);
      const md = parts[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
      if (!files.has(meta.parents[0])) return res(404, { error: { message: "File not found" } });
      const f = addFile({ id: newId("DOC"), name: meta.name, mimeType: meta.mimeType, parents: meta.parents, md });
      return res(200, { id: f.id, name: f.name, webViewLink: f.webViewLink });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files(?:\/([^/]+))?(?:\/(export|permissions))?$/);
    const [, id, sub] = m;
    if (!id && method === "get") {
      let list = [...files.values()].filter((f) => !f.trashed);
      const query = q.q;
      const par = query.match(/'([^']+)' in parents/);
      if (par) list = list.filter((f) => (f.parents || []).includes(par[1]));
      const name = query.match(/name contains '((?:[^'\\]|\\.)*)'/);
      if (name) list = list.filter((f) => f.name.includes(name[1].replace(/\\(.)/g, "$1")));
      const mime = query.match(/mimeType = '([^']+)'/);
      if (mime) list = list.filter((f) => f.mimeType === mime[1]);
      const ct = query.match(/createdTime > '([^']+)'/);
      if (ct) list = list.filter((f) => new Date(f.createdTime) > new Date(ct[1]));
      return res(200, { files: list.map(({ id, name, createdTime, modifiedTime, webViewLink }) => ({ id, name, createdTime, modifiedTime, webViewLink })) });
    }
    if (!id && method === "post") {
      const meta = JSON.parse(params.payload);
      const f = addFile({ id: newId("FOLDER"), name: meta.name, mimeType: meta.mimeType, parents: meta.parents || ["root"] });
      return res(200, { id: f.id, name: f.name, webViewLink: `https://drive.google.com/drive/folders/${f.id}` });
    }
    const f = files.get(id);
    if (!f) return res(404, { error: { message: "File not found" } });
    if (sub === "export") return res(200, q.mimeType === "text/markdown" ? exportLike(f.md) : f.text);
    if (sub === "permissions") return res(200, { permissions: permissions.get(id) || [{ type: "user", role: "owner", emailAddress: "ryuki@example.co.jp" }] });
    if (method === "patch") { const body = JSON.parse(params.payload); if (body.trashed) { f.trashed = true; calls.trashed.push(id); } return res(200, {}); }
    return res(200, { id: f.id, name: f.name, createdTime: f.createdTime, mimeType: f.mimeType, trashed: f.trashed, webViewLink: f.webViewLink });
  }

  function docs(url) {
    const id = new URL(url).pathname.split("/").pop();
    const f = files.get(id);
    if (!f) return res(404, { error: { message: "not found" } });
    const [memoPart, transcript] = f.text.split("# 文字起こし");
    const para = (t) => ({ paragraph: { elements: [{ textRun: { content: t + "\n" } }] } });
    return res(200, {
      title: f.name,
      tabs: [
        { tabProperties: { title: "メモ" }, documentTab: { body: { content: memoPart.split("\n").map(para) } } },
        { tabProperties: { title: "文字起こし" }, documentTab: { body: { content: transcript.split("\n").map(para) } } },
      ],
    });
  }

  function gemini(url, params) {
    const body = JSON.parse(params.payload);
    calls.gemini.push({ url, headers: params.headers, body });
    return res(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "考え中", thought: true }, { text: JSON.stringify(geminiResult) }] } }] });
  }

  function backlog(method, url, params) {
    const u = new URL(url);
    assert.ok(u.searchParams.get("apiKey"), "Backlog の API キーが付いている");
    const p = u.pathname;
    if (p === "/api/v2/projects/IB_TASK") return res(200, { id: 10, projectKey: "IB_TASK" });
    if (p === "/api/v2/projects/10/users") return res(200, [{ id: 1, name: "架空 一郎" }, { id: 2, name: "見本 花子" }]);
    if (p === "/api/v2/projects/10/issueTypes") return res(200, [{ id: 100, name: "バグ" }, { id: 101, name: "タスク" }]);
    if (p === "/api/v2/priorities") return res(200, [{ id: 2, name: "高" }, { id: 3, name: "中" }]);
    if (p === "/api/v2/users/myself") return res(200, { id: 1, name: "架空 一郎" });
    if (p === "/api/v2/issues" && method === "get") {
      const k = u.searchParams.get("keyword");
      return res(200, k === "見積書" ? [{ issueKey: "IB_TASK-130", summary: "見積書の再提出", status: { name: "処理済み" }, description: "" }] : []);
    }
    if (p === "/api/v2/issues" && method === "post") {
      backlogPostCount++;
      if (fail.backlogPostAt && backlogPostCount === fail.backlogPostAt) return res(500, { errors: [{ message: "一時的なエラー" }] });
      const key = `IB_TASK-${200 + calls.backlogPosts.length}`;
      calls.backlogPosts.push({ ...params.payload, key });
      return res(201, { issueKey: key });
    }
    return res(404, { errors: [{ message: "not found " + p }] });
  }

  function cal(method, url, params) {
    if (method === "get") {
      const q = qsOf(url);
      const day = q.timeMin.slice(0, 10);
      return res(200, { items: calendar.filter((e) => e.start.date === day).map((e) => ({ summary: e.summary })) });
    }
    const ev = JSON.parse(params.payload);
    calendar.push(ev);
    calls.calendarInserts.push({ ev, sendUpdates: qsOf(url).sendUpdates });
    return res(200, { id: "EV" + calendar.length });
  }

  const UrlFetchApp = {
    fetch(url, params = {}) {
      const method = (params.method || "get").toLowerCase();
      if (url.startsWith("https://www.googleapis.com/drive/") || url.startsWith("https://www.googleapis.com/upload/drive/")) return drive(method, url, params);
      if (url.startsWith("https://docs.googleapis.com/")) return docs(url);
      if (url.includes("generativelanguage.googleapis.com") || url.includes("aiplatform.googleapis.com")) return gemini(url, params);
      if (url.startsWith("https://example.backlog.jp/")) return backlog(method, url, params);
      if (url.startsWith("https://www.googleapis.com/calendar/")) return cal(method, url, params);
      throw new Error("想定していない URL: " + url);
    },
  };

  const props = new Map();
  const context = {
    console: { log() {}, error() {}, warn() {} },
    JSON, Math, Date, String, Number, Array, Object, RegExp, Error, isNaN, isFinite, encodeURIComponent, decodeURIComponent, parseInt,
    SpreadsheetApp, UrlFetchApp,
    ScriptApp: { getOAuthToken: () => "TOKEN", getProjectTriggers: () => [] },
    Utilities: { getUuid: () => crypto.randomUUID(), sleep() {}, newBlob: (s) => ({ getBytes: () => Buffer.from(s, "utf8") }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    Session: { getActiveUser: () => ({ getEmail: () => "ryuki@example.co.jp" }) },
    MailApp: { sendEmail: (...a) => calls.mails.push(a) },
    HtmlService: {
      createHtmlOutput: (content) => { const o = { content, setWidth: () => o, setHeight: () => o }; return o; },
      createTemplateFromFile: (name) => { const t = { name, evaluate: () => { const o = { name, data: t.dataJson, setWidth: () => o, setHeight: () => o }; return o; } }; return t; },
    },
  };
  vm.createContext(context);
  for (const f of gsFiles) vm.runInContext(fs.readFileSync(path.join(srcDir, f), "utf8"), context, { filename: f });

  const g = context;
  return {
    g, ss, sheets, files, permissions, calls, fail, alerts, dialogs, props, geminiResult,
    setting(label, value) {
      const sh = sheets.get("設定");
      const i = sh.data.findIndex((r) => r[0] === label);
      sh.data[i][1] = value;
    },
    rows(name) {
      const sh = sheets.get(name);
      const [head, ...rest] = sh.data.slice(0, sh.getLastRow());
      return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? "" : r[i]])));
    },
    setCell(name, rowIndex, col, value) {
      const sh = sheets.get(name);
      const head = sh.data[0];
      sh.data[rowIndex + 1][head.indexOf(col)] = value;
    },
  };
}

/** 最初の設定を済ませ、Backlog と Vertex AI（本番の設定）を入れた状態 */
function readyEnv({ vertex = true, dryRun = "しない" } = {}) {
  const env = makeEnv();
  env.g.setupSheets();
  env.props.set("BACKLOG_API_KEY", "backlog-secret-key-123");
  env.props.set("GEMINI_API_KEY", "gemini-secret-key-456");
  env.setting("Backlog のスペース", "https://example.backlog.jp/");
  env.setting("Backlog のプロジェクトキー", "IB_TASK");
  env.setting("お試し実行", dryRun);
  if (vertex) {
    env.setting("AI の呼び方", "Vertex AI");
    env.setting("Vertex AI のプロジェクト ID", "company-minutes");
  }
  return env;
}

// ---------- 1. 計算 ----------

const { g: u } = makeEnv();

test("会議名からファイル名を作る（SKILL.md と同じ例）", () => {
  assert.equal(u.sanitizeTitle_("MTG - 2026/10/02 14:29 JST - Gemini によるメモ"), "MTG");
  assert.equal(u.sanitizeTitle_("サンプル定例 - 2026/11/05 14:00 JST - Gemini によるメモ"), "サンプル定例");
  assert.equal(u.sanitizeTitle_("週次ミーティング（営業）20261030"), "週次ミーティング_営業");
  assert.equal(u.sanitizeTitle_("2026-10-02 - Gemini によるメモ"), "会議");
});

test("URL から ID を取り出す", () => {
  assert.equal(u.parseDocId_("https://docs.google.com/document/d/1AbC_dEf-123456789012345/edit?tab=t.0"), "1AbC_dEf-123456789012345");
  assert.equal(u.parseDocId_("ただの文字"), "");
  assert.equal(u.parseFolderId_("https://drive.google.com/drive/folders/0AbCdEfGh12345"), "0AbCdEfGh12345");
});

test("タイトルの日付と、期限の形をそろえる", () => {
  assert.equal(u.meetingDateFromTitle_("定例 - 2026/1/5 9:00 JST"), "2026-01-05");
  assert.equal(u.meetingDateFromTitle_("定例 20261105"), "2026-11-05");
  assert.equal(u.meetingDateFromTitle_("定例"), "");
  assert.equal(u.normalizeDue_("2026/11/5"), "2026-11-05");
  assert.equal(u.normalizeDue_("未定"), "");
  assert.equal(u.normalizeDue_("2026-02-30"), "");
  assert.equal(u.normalizeDue_(new Date("2026-11-05T15:00:00Z")), "2026-11-06");
});

test("担当者の照合（空白・敬称を無視、名字だけは 1 人に決まるときだけ）", () => {
  const users = [{ id: 1, name: "架空 一郎" }, { id: 2, name: "見本 花子" }, { id: 3, name: "見本 次郎" }];
  assert.equal(u.matchAssignee_("架空一郎さん", users).user.id, 1);
  assert.equal(u.matchAssignee_("架空", users).user.id, 1);
  assert.equal(u.matchAssignee_("見本", users).reason, "複数");
  assert.equal(u.matchAssignee_("山田", users).reason, "見つからない");
  assert.equal(u.matchAssignee_("未定", users).reason, "未定");
});

test("登録先の判定（SKILL.md の Step 7・8 と同じ）", () => {
  const ctx = { today: "2026-11-06", backlogReady: true };
  const p = (t) => u.planTodo_({ who: "架空 一郎", category: "社内", due: "2026-11-12", backlog: true, calendar: true, ...t }, ctx);
  assert.equal(p({}).label, "Backlog・カレンダー");
  assert.equal(p({ calendar: false, due: "" }).label, "Backlog だけ（期限がないためカレンダーには入れない）");
  assert.match(p({ due: "" }).notes[0], /期限がないため/);
  assert.equal(p({ category: "社外", backlog: false, calendar: false }).label, "登録しない（社外の作業）");
  assert.match(p({ category: "不明", backlog: false, calendar: false }).label, /区分が不明/);
  assert.equal(p({ backlog: false, calendar: false, prevIssue: "IB_TASK-1（処理中）" }).label, "前回の課題を継続：IB_TASK-1（処理中）");
  assert.equal(p({ backlogKey: "IB_TASK-9", calendarDone: true }).label, "Backlog 登録済み：IB_TASK-9・カレンダー登録済み");
  assert.equal(p({ backlogKey: "IB_TASK-9" }).doBacklog, false);
  const manual = u.planTodo_({ who: "a", category: "社内", due: "2026-11-12", backlog: true, calendar: false }, { today: "2026-11-06", backlogReady: false });
  assert.equal(manual.manualBacklog, true);
  assert.equal(manual.doBacklog, false);
  assert.equal(p({ who: "未定" }).lead, true);
});

test("登録先の初期値（社内だけ、期限が過ぎたものはカレンダーに入れない）", () => {
  assert.deepEqual({ ...u.defaultFlags_({ category: "社内", due: "2026-11-12" }, "2026-11-06") }, { backlog: true, calendar: true });
  assert.deepEqual({ ...u.defaultFlags_({ category: "社内", due: "2026-11-01" }, "2026-11-06") }, { backlog: true, calendar: false });
  assert.deepEqual({ ...u.defaultFlags_({ category: "社外", due: "2026-11-12" }, "2026-11-06") }, { backlog: false, calendar: false });
  assert.deepEqual({ ...u.defaultFlags_({ category: "社内", due: "2026-11-12", prevIssue: "X-1" }, "2026-11-06") }, { backlog: false, calendar: false });
});

test("保存先フォルダの共有の範囲を確かめる", () => {
  const d = ["example.co.jp"];
  assert.equal(u.checkSharing_([{ type: "user", emailAddress: "a@example.co.jp" }, { type: "domain", domain: "example.co.jp" }], d).ok, true);
  assert.equal(u.checkSharing_([{ type: "anyone" }], d).ok, false);
  assert.match(u.checkSharing_([{ type: "user", emailAddress: "x@other.com" }], d).problems[0], /社外のアドレス/);
  assert.match(u.checkSharing_([{ type: "domain", domain: "other.com" }], d).problems[0], /社外のドメイン/);
  assert.equal(u.checkSharing_([{ type: "user", emailAddress: "a@example.co.jp" }], []).ok, false);
});

test("招待してよいアドレス", () => {
  assert.equal(u.isAllowedEmail_("A@Example.co.jp", ["example.co.jp"]), true);
  assert.equal(u.isAllowedEmail_("a@example.co.jp.evil.com", ["example.co.jp"]), false);
  assert.deepEqual([...u.parseEmails_("a@x.jp, b@y.jp\nだめ")], ["a@x.jp", "b@y.jp"]);
});

test("同じ名前があれば _2 を付け、前回の議事録は会議日より前で最も新しいものを選ぶ", () => {
  assert.equal(u.nextFreeName_("2026-11-05_定例", ["2026-11-05_定例", "2026-11-05_定例_2"]), "2026-11-05_定例_3");
  const files = ["2026-10-29_定例", "2026-10-29_定例_2", "2026-11-05_定例", "2026-10-22_定例", "2026-10-30_定例B"].map((name) => ({ name }));
  const prev = u.findPrevMinutes_(files, "定例", "2026-11-05");
  assert.equal(prev.file.name, "2026-10-29_定例_2");
  assert.equal(u.findPrevMinutes_(files, "定例", "2026-10-01"), null);
});

test("秘密の情報を表示に出さない", () => {
  const s = u.maskSecrets_("Request failed for https://x.backlog.jp/api/v2/issues?apiKey=abcdefgh123&count=1 key abcdefgh123", ["abcdefgh123"]);
  assert.doesNotMatch(s, /abcdefgh123/);
});

test("Google ドキュメントのタブを文字にする", () => {
  const p = (t) => ({ paragraph: { elements: [{ textRun: { content: t + "\n" } }] } });
  const text = u.docsToText_({
    tabs: [
      { tabProperties: { title: "メモ" }, documentTab: { body: { content: [p("概要"), { table: { tableRows: [{ tableCells: [{ content: [p("a")] }, { content: [p("b")] }] }] } }] } } },
      { tabProperties: { title: "文字起こし" }, documentTab: { body: { content: [p("00:01 発言")] } }, childTabs: [] },
    ],
  });
  assert.equal(text, "# メモ\n概要\n| a | b |\n\n# 文字起こし\n00:01 発言");
});

test("Gemini の返事を読み取る（考え中の部分は除く・形をそろえる）", () => {
  const text = u.extractGeminiText_({ candidates: [{ content: { parts: [{ text: "x", thought: true }, { text: '{"a":1}' }] } }] });
  assert.equal(text, '{"a":1}');
  assert.throws(() => u.extractGeminiText_({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }), /途中で切れました/);
  const r = u.normalizeMinutesResult_(JSON.stringify({
    meeting_date: "2026-11-05", minutes_markdown: "## 会議情報",
    todos: [{ who: "", what: "社外の作業", due: "未定", category: "社外" }, { who: "A", what: "社内の作業", due: "2026/11/12", category: "社内" }, { what: "" }],
    private_info: ["なし"], to_confirm: [],
  }));
  assert.deepEqual(r.todos.map((t) => t.what), ["社内の作業", "社外の作業"]);
  assert.equal(r.todos[1].who, "未定");
  assert.equal(r.todos[0].due, "2026-11-12");
  assert.equal(r.privateInfo.length, 0);
  assert.throws(() => u.normalizeMinutesResult_('{"minutes_markdown":""}'), /本文がありません/);
});

test("下書きを確定版にする（TODO の表を差し替え・要確認事項を移す・確認用のメモを消す）", () => {
  const draft = u.buildDraftMarkdown_({
    title: "定例", createdDate: "2026-11-06",
    minutesMd: "# 定例 議事録\n\n## 決まったこと\n1. A\n\n## TODO\n| 誰が | 何を | いつまで | 区分 |\n|--|--|--|--|\n| x | 古い | 未定 | 社内 |\n\n## 決まっていないこと\n- なし\n\n## 話し合いの記録\n### 議題\n- 結論：B",
    todos: [{ who: "A", what: "作業 1", due: "2026-11-12", category: "社内" }],
    privateInfo: ["金額"], toConfirm: ["期限が 11/10 か 11/12 か", "担当者"],
  });
  assert.equal((draft.match(/定例 議事録/g) || []).length, 1, "AI が書いたタイトル行は外す");
  assert.match(draft, /表示用です/);
  // 人が下書きを直した（要確認事項を 1 つ消した）あと、Google ドキュメントから書き出した形
  const edited = draft.replace("- 担当者\n", "").replace(/^- /gm, "* ").replace(/_/g, "\\_");
  const fin = u.finalizeMarkdown_(edited, { title: "定例", todos: [{ who: "B", what: "作業 1", due: "", category: "社内" }], approvalLine: "*承認*" });
  assert.deepEqual([...fin.unresolved], ["期限が 11/10 か 11/12 か"]);
  assert.doesNotMatch(fin.md, /確認用のメモ|非公開情報|表示用です|古い/);
  assert.match(fin.md, /\| B \| 作業 1 \| 未定 \| 社内 \|/);
  assert.match(fin.md, /## 決まっていないこと\n\n- 期限が 11\/10 か 11\/12 か（要確認）\n/);
  assert.doesNotMatch(fin.md, /^\* なし$/m);
  assert.match(fin.md, /### 議題/);
  assert.match(fin.md, /\n---\n\n\*承認\*\n$/);
  assert.throws(() => u.finalizeMarkdown_("## 確認用のメモ\n本文だけ", { title: "定例", todos: [], approvalLine: "" }), /タイトルの行/);
});

test("決まっていないことに、すでに項目があれば後ろに足す", () => {
  const lines = u.addUndecided_(["## 決まっていないこと", "", "- 補助金 → A 社様が決める", "", "## 次"], ["期限"]);
  assert.deepEqual([...lines], ["## 決まっていないこと", "", "- 補助金 → A 社様が決める", "- 期限（要確認）", "", "## 次"]);
});

test("下書きから確認用のメモと前回からの変更を読む", () => {
  const md = "## 確認用のメモ（承認すると消えます）\n\n### 非公開情報\n\n* 金額\n\n### 要確認事項\n\n* なし\n\n---\n\n# 定例 議事録\n\n## 前回からの変更\n前回：2026-10-29\n\n**決まったことの変更**\n- なし\n\n## 話し合いの記録";
  const n = u.readDraftNotes_(md, "定例");
  assert.deepEqual([...n.privateInfo], ["金額"]);
  assert.deepEqual([...n.toConfirm], []);
  assert.deepEqual([...n.prevChanges], ["前回：2026-10-29", "決まったことの変更", "- なし"]);
  assert.equal(n.hasTitle, true);
});

test("使った記録の集計（meeting-log.mjs と同じ計算）", () => {
  const recs = [
    { result: "承認", meetingDate: "2026-11-01", confirmMinutes: 10, todos: 4, backlogRegistered: 2, similarFlagged: 1, similarStopped: 1, edits: 1 },
    { result: "承認", meetingDate: "2026-11-05", confirmMinutes: 20, todos: 2, backlogRegistered: 2, similarFlagged: 0, similarStopped: 0, edits: 0 },
    { result: "やめた", meetingDate: "2026-11-06", confirmMinutes: "" },
  ];
  const text = u.summarizeLog_(recs, 30, 3).join("\n");
  assert.match(text, /承認した 2 回（会議日 2026-11-01〜2026-11-05）。途中でやめた回は 1 回/);
  assert.match(text, /平均 15 分/);
  assert.match(text, /30 ＋ 3 × 2 ＝ 約 36 分/);
});

test("書き方の指示とサンプルが、元のファイルと同じ（node gas/tools/build.mjs を実行済み）", () => {
  for (const [file, content] of Object.entries(buildFiles())) {
    assert.equal(fs.readFileSync(path.join(here, "..", "..", file), "utf8"), content, `${file} が古い`);
  }
});

test("最初の設定で、シートの見た目（状態の色・注意の強調・終わった会議を薄く）を付ける。何度実行しても値は消えない", () => {
  const env = readyEnv();
  const ms = env.sheets.get("会議"), ts = env.sheets.get("TODO");
  assert.deepEqual(Array.from(ms.rules, (r) => r.text),["確認待ち", "登録中", "作成中", "登録済み", "エラー", "やめた", "お試し済み"]);
  assert.ok(ts.rules[0].formula.startsWith('=SUM(COUNTIFS(INDIRECT("会議!A:A"),$A2,INDIRECT("会議!D:D"),"登録済み")'), ts.rules[0].formula);
  assert.equal(ts.rules[1].contains, "⚠");
  assert.equal(env.sheets.get("会議").data[0][3], "状態", "会議シートの D 列が状態（式が前提にしている）");
  env.g.setupSheets();
  assert.equal(env.g.getSettings_().backlogProject, "IB_TASK");
});

// ---------- 2. 通しの動き（にせものの Google） ----------

test("開発用の設定（AI Studio）では、本物の会議メモを AI に送らない", () => {
  const env = readyEnv({ vertex: false });
  assert.throws(() => env.g.createDraftFromMemo("MEMO0000000000000000000001"), /本物の会議メモは AI に送れません/);
  assert.equal(env.calls.gemini.length, 0);
  assert.equal(env.g.listRecentMemos().aiStudio, true);
});

test("サンプルで試す：下書きを作り、承認しても保存・登録はしない", () => {
  const env = readyEnv({ vertex: false, dryRun: "する" });
  const r = env.g.createSampleDraft();
  assert.match(r.draftUrl, /drive\.google\.com/);
  const call = env.calls.gemini[0];
  assert.equal(call.headers["x-goog-api-key"], "gemini-secret-key-456");
  assert.match(call.body.systemInstruction.parts[0].text, /^# 議事録変換プロンプト/);
  assert.match(call.body.contents[0].parts[0].text, /# 会議メモ（ここから）\n（これはお試し用の架空の会議メモです/);
  const draft = [...env.files.values()].find((f) => f.name.startsWith("【お試し】"));
  assert.ok(draft, "【お試し】の下書きができる");
  const m = env.rows("会議")[0];
  assert.equal(m["状態"], "確認待ち");
  assert.equal(m["お試し"], true);
  const out = env.g.approveMeeting(m["会議ID"]);
  assert.equal(out.ok, true);
  assert.match(out.lines[0], /お試し実行/);
  assert.equal(env.rows("会議")[0]["状態"], "お試し済み");
  assert.equal(env.calls.backlogPosts.length, 0);
  assert.equal(env.calls.calendarInserts.length, 0);
  assert.equal(env.calls.trashed.length, 0);
});

test("開発中：サンプルでも「お試し実行」を「しない」にすれば、テスト用の Backlog とカレンダーへの登録まで試せる", () => {
  const env = readyEnv({ vertex: false, dryRun: "しない" });
  env.g.createSampleDraft();
  const id = env.rows("会議")[0]["会議ID"];
  const out = env.g.approveMeeting(id);
  assert.equal(out.ok, true, out.lines.join("\n"));
  const final = [...env.files.values()].find((f) => f.name === "2026-11-05_サンプル定例");
  assert.match(final.md, /元メモ：お試し用のサンプル/);
  assert.equal(env.calls.backlogPosts.length, 3);
  assert.doesNotMatch(env.calls.backlogPosts[0].description, /元メモ/);
});

test("本番の流れ：会議メモ → 下書き → 確認 → 承認 → 保存・Backlog・カレンダー", () => {
  const env = readyEnv();
  const list = env.g.listRecentMemos();
  assert.equal(list.candidates.length, 1);
  assert.equal(list.candidates[0].name, "サンプル定例");
  assert.equal(list.candidates[0].when, "2026-11-05 14:00");

  const r = env.g.createDraftFromMemo("https://docs.google.com/document/d/MEMO0000000000000000000001/edit");
  assert.match(r.message, /下書きができました/);
  assert.match(env.calls.gemini[0].url, /^https:\/\/asia-northeast1-aiplatform\.googleapis\.com\/v1\/projects\/company-minutes\/locations\/asia-northeast1\/publishers\/google\/models\/gemini-flash-latest:generateContent$/);
  assert.equal(env.calls.gemini[0].headers.Authorization, "Bearer TOKEN");
  assert.match(env.calls.gemini[0].body.contents[0].parts[0].text, /# メモ\n/, "タブごとに読んでいる");

  const settings = env.g.getSettings_();
  const draft = [...env.files.values()].find((f) => f.name === "【下書き】2026-11-05_サンプル定例");
  assert.ok(draft, "下書きの名前");
  assert.deepEqual(draft.parents, [settings.draftFolderId], "下書きは本人だけのフォルダに作る");
  assert.match(draft.md, /^## 確認用のメモ/);
  assert.match(draft.md, /\n# サンプル定例 - 2026\/11\/05 14:00 JST 議事録\n/, "タイトルはいまの版と同じ（日時を残す）");

  const todos = env.rows("TODO");
  assert.deepEqual(todos.map((t) => t["何を"]), ["2 段階に分けた見積書を作り直して送る", "主要画面のイメージを作る", "次回の定例の日程を調整する", "受注表のサンプルを送る"]);
  assert.deepEqual(todos.map((t) => [t["Backlog"], t["カレンダー"]]), [[true, true], [true, true], [true, false], [false, false]]);
  assert.match(todos[0]["似た課題"], /IB_TASK-130/);
  assert.match(todos[1]["注意"], /担当者が未定/);

  // 人が直す：似た課題があるものは Backlog に入れない・担当者を決める・招待するメール（社外のアドレスは入れても招待しない）
  env.setCell("TODO", 0, "Backlog", false);
  env.setCell("TODO", 1, "誰が", "見本 花子");
  env.setCell("TODO", 1, "招待するメール", "hanako@example.co.jp, someone@other.com");

  const id = env.rows("会議")[0]["会議ID"];
  const data = env.g.buildConfirmData_(id);
  assert.equal(data.canApprove, true);
  assert.equal(data.items[0].label, "カレンダーだけ");
  assert.equal(data.items[1].label, "Backlog・カレンダー");
  assert.ok(data.items[1].notes.some((n) => /社外のアドレスは招待しません：someone@other\.com/.test(n)));
  assert.equal(data.items[3].label, "登録しない（社外の作業）");
  assert.deepEqual([...data.toConfirm], ["見積書の期限が 11/10 か 11/12 か"]);
  assert.match(data.save.text, /2026-11-05_サンプル定例$/);

  const out = env.g.approveMeeting(id);
  assert.equal(out.ok, true, out.lines.join("\n"));

  const final = [...env.files.values()].find((f) => f.name === "2026-11-05_サンプル定例");
  assert.deepEqual(final.parents, [settings.saveFolderId], "確定版は保存先フォルダに作る");
  assert.doesNotMatch(final.md, /確認用のメモ|金額（120 万円/);
  assert.match(final.md, /見積書の期限が 11\/10 か 11\/12 か（要確認）/);
  assert.match(final.md, /\| 見本 花子 \| 主要画面のイメージを作る \|/);
  assert.match(final.md, /ryuki@example\.co\.jp が .* に確認・承認しました/);
  assert.ok(env.calls.trashed.includes(draft.id), "下書きはゴミ箱へ");

  assert.deepEqual(env.calls.backlogPosts.map((p) => p.summary), ["主要画面のイメージを作る", "次回の定例の日程を調整する"]);
  assert.equal(env.calls.backlogPosts[0].assigneeId, 2);
  assert.equal(env.calls.backlogPosts[0].issueTypeId, 101);
  assert.equal(env.calls.backlogPosts[0].priorityId, 3);
  assert.equal(env.calls.backlogPosts[0].dueDate, DUE2);
  assert.match(env.calls.backlogPosts[0].description, /開催日: 2026-11-05\n元メモ: https:\/\/docs\.google\.com\/document\/d\/MEMO/);
  assert.equal(env.calls.backlogPosts[1].dueDate, undefined);

  assert.equal(env.calls.calendarInserts.length, 2);
  const [c1, c2] = env.calls.calendarInserts;
  assert.equal(c1.ev.summary, "【期限】2 段階に分けた見積書を作り直して送る");
  assert.deepEqual(c1.ev.start, { date: DUE1 });
  assert.deepEqual(c1.ev.end, { date: addDays(DUE1, 1) });
  assert.equal(c1.ev.visibility, "private");
  assert.equal(c1.ev.transparency, "transparent");
  assert.deepEqual(c1.ev.reminders.overrides, [{ method: "popup", minutes: 900 }]);
  assert.equal(c1.ev.attendees, undefined, "本人（架空 一郎）は招待しない");
  assert.equal(c1.sendUpdates, "none");
  assert.deepEqual(c2.ev.attendees, [{ email: "hanako@example.co.jp" }], "社内のアドレスだけ招待");
  assert.match(c2.ev.description, /Backlog: https:\/\/example\.backlog\.jp\/view\/IB_TASK-200/);

  assert.equal(env.rows("会議")[0]["状態"], "登録済み");
  assert.equal(env.rows("TODO")[1]["Backlog の課題"], "IB_TASK-200");
  // シートには URL の代わりに短いリンクを書く
  const ms = env.sheets.get("会議"), ts = env.sheets.get("TODO");
  assert.equal(env.rows("会議")[0]["下書き"], "下書きを開く");
  assert.equal(ms.linkAt(2, "下書き"), draft.webViewLink);
  assert.equal(env.rows("会議")[0]["議事録"], "議事録を開く");
  assert.equal(ms.linkAt(2, "議事録"), final.webViewLink);
  assert.ok(ms.linkAt(2, "元メモ").includes("/document/d/MEMO"), "元メモのリンク");
  assert.equal(ts.linkAt(3, "Backlog の課題"), "https://example.backlog.jp/view/IB_TASK-200");
  // 二度押ししても、もう一度は登録しない
  assert.equal(env.g.approveMeeting(id).ok, false);
  assert.equal(env.calls.backlogPosts.length, 2);
  // 同じ会議メモは二重に処理しない
  assert.throws(() => env.g.createDraftFromMemo("MEMO0000000000000000000001"), /下書きはもうあります/);
});

test("Backlog の登録が途中で止まっても、続きから登録する（二重に登録しない）", () => {
  const env = readyEnv();
  env.g.createDraftFromMemo("MEMO0000000000000000000001");
  const id = env.rows("会議")[0]["会議ID"];
  env.fail.backlogPostAt = 2;
  const out = env.g.approveMeeting(id);
  assert.equal(out.ok, false);
  assert.match(out.lines.join("\n"), /続きから登録します/);
  assert.equal(env.rows("会議")[0]["状態"], "登録中");
  assert.equal(env.calls.backlogPosts.length, 1);
  env.fail.backlogPostAt = 0;
  const again = env.g.approveMeeting(id);
  assert.equal(again.ok, true, again.lines.join("\n"));
  assert.equal(env.calls.backlogPosts.length, 3, "1 件目はもう一度登録しない");
  assert.equal(new Set(env.calls.backlogPosts.map((p) => p.summary)).size, 3);
  assert.equal([...env.files.values()].filter((f) => f.name.startsWith("2026-11-05_サンプル定例")).length, 1, "確定版も 1 つだけ");
});

test("保存先が社外にも共有されていたら、承認できない", () => {
  const env = readyEnv();
  env.g.createDraftFromMemo("MEMO0000000000000000000001");
  const id = env.rows("会議")[0]["会議ID"];
  env.permissions.set(env.g.getSettings_().saveFolderId, [{ type: "anyone", role: "reader" }]);
  const data = env.g.buildConfirmData_(id);
  assert.equal(data.canApprove, false);
  const out = env.g.approveMeeting(id);
  assert.equal(out.ok, false);
  assert.match(out.lines[0], /共有の範囲に問題がある/);
  assert.equal(env.calls.backlogPosts.length, 0);
});

test("確認して承認する：承認待ちが複数なら一覧から選ぶ。1 件だけ・行を選んでいればすぐ確認画面", () => {
  const env = readyEnv({ vertex: false, dryRun: "する" });
  env.g.menuApprove();
  assert.match(env.alerts.at(-1), /承認を待っている会議はありません/);
  env.g.createSampleDraft();
  env.g.menuApprove();
  assert.equal(env.dialogs.at(-1).title, "内容を確認して承認する");
  env.g.createSampleDraft();
  env.g.createSampleDraft();
  env.g.menuApprove();
  assert.equal(env.dialogs.at(-1).title, "確認する会議を選ぶ");
  assert.match(env.dialogs.at(-1).html.content, /承認を待っている会議が 3 件あります/);
  // 一覧で選ぶと確認画面が出て、開いた回数が増える
  const id = env.rows("会議")[1]["会議ID"];
  env.g.showConfirmFor(id);
  assert.equal(env.dialogs.at(-1).title, "内容を確認して承認する");
  assert.equal(JSON.parse(env.dialogs.at(-1).html.data).id, id);
  assert.equal(env.rows("会議")[1]["確認画面を開いた回数"], 1);
  // 「会議」シートで行を選んでいれば、その会議
  const ms = env.sheets.get("会議");
  env.ss.setActiveSheet(ms);
  ms.activeRow = 4;
  env.g.menuApprove();
  assert.equal(JSON.parse(env.dialogs.at(-1).html.data).id, env.rows("会議")[2]["会議ID"]);
  // 承認待ちでない会議は開けない
  env.g.approveMeeting(id);
  assert.throws(() => env.g.showConfirmFor(id), /お試し済み/);
});

test("やめる：何も登録せず、下書きをゴミ箱へ", () => {
  const env = readyEnv();
  env.g.createDraftFromMemo("MEMO0000000000000000000001");
  const id = env.rows("会議")[0]["会議ID"];
  const out = env.g.cancelMeeting(id);
  assert.equal(out.ok, true);
  assert.equal(env.rows("会議")[0]["状態"], "やめた");
  assert.equal(env.calls.trashed.length, 1);
  assert.equal(env.calls.backlogPosts.length, 0);
});

test("使った記録を残す設定のとき、承認したら 1 行残す", () => {
  const env = readyEnv();
  env.setting("使った記録を残す", "する");
  env.g.createDraftFromMemo("MEMO0000000000000000000001");
  const id = env.rows("会議")[0]["会議ID"];
  env.setCell("会議", 0, "確認を始めた時刻", new Date(Date.now() - 12 * 60000));
  env.setCell("会議", 0, "確認画面を開いた回数", 2);
  env.g.approveMeeting(id);
  const log = env.rows("記録");
  assert.equal(log.length, 1);
  assert.equal(log[0]["結果"], "承認");
  assert.equal(log[0]["修正の回数"], 1);
  assert.equal(log[0]["TODO数"], 4);
  assert.equal(log[0]["Backlog登録数"], 3);
  assert.equal(log[0]["似た課題あり数"], 1);
  assert.ok(log[0]["確認・承認の分"] >= 12);
});

test("Gemini が混み合っている（503）ときは、時間をおいてやり直し、だめなら予備のモデルで試す", () => {
  const env = readyEnv({ vertex: false, dryRun: "する" });
  const original = env.g.UrlFetchApp.fetch;
  const tried = [];
  env.g.UrlFetchApp.fetch = (url, params) => {
    if (url.includes("generativelanguage")) {
      tried.push(url.match(/models\/([^:]+)/)[1]);
      if (url.includes("gemini-flash-latest")) return { getResponseCode: () => 503, getContentText: () => JSON.stringify({ error: { message: "high demand" } }) };
    }
    return original(url, params);
  };
  env.g.createSampleDraft();
  assert.deepEqual(tried, ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-latest", "gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest"]);
  assert.equal(env.rows("会議")[0]["状態"], "確認待ち");

  // 予備のモデルも混み合っていたら、わかりやすく知らせる
  env.g.UrlFetchApp.fetch = (url, params) => {
    if (url.includes("generativelanguage")) return { getResponseCode: () => 503, getContentText: () => "{}" };
    return original(url, params);
  };
  assert.throws(() => env.g.createSampleDraft(), /混み合っていて、返事をもらえませんでした（503）。数分おいてから/);
});

test("Gemini のエラーは、秘密の情報を消して「エラー」にする", () => {
  const env = readyEnv({ vertex: false });
  const original = env.g.UrlFetchApp.fetch;
  env.g.UrlFetchApp.fetch = (url, params) => {
    if (url.includes("generativelanguage")) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: "API key gemini-secret-key-456 not valid" } }) };
    return original(url, params);
  };
  assert.throws(() => env.g.createSampleDraft(), (e) => /エラーになりました（400）/.test(e.message) && !/gemini-secret-key-456/.test(e.message));
  const m = env.rows("会議")[0];
  assert.equal(m["状態"], "エラー");
  assert.doesNotMatch(m["結果"], /gemini-secret-key-456/);
});

// ---------- 結果 ----------

if (failures.length) {
  console.error(failures.join("\n\n"));
  console.error(`\n${passed} 件成功、${failures.length} 件失敗`);
  process.exit(1);
}
console.log(`すべて成功（${passed} 件）`);
