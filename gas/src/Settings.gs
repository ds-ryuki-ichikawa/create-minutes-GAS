/**
 * 管理シート（会議・TODO・設定・記録）と、API キーの読み書き。
 * API キーはシートに書かず、本人だけが読めるユーザー プロパティに置く。
 */

var SHEET_MEETINGS = '会議';
var SHEET_TODOS = 'TODO';
var SHEET_SETTINGS = '設定';
var SHEET_LOG = '記録';

var MEETING_COLS = ['会議ID', '会議日', '会議名', '状態', '下書き', '議事録', '元メモ', '前回の議事録', 'お試し',
  '作成日時', '確認を始めた時刻', '確認画面を開いた回数', '承認した時刻', '承認した人', '結果', 'データ'];
var TODO_COLS = ['会議ID', '会議', 'No', '何を', '区分', '誰が', 'いつまで', 'Backlog', 'カレンダー', '招待するメール',
  '注意', '前回の課題', '似た課題', 'Backlog の課題', 'カレンダーの予定', '探す語句'];
var LOG_COLS = ['記録日時', '会議日', '会議名', '結果', '確認画面を出した時刻', '承認した時刻', '確認・承認の分', '修正の回数',
  'TODO数', '社内TODO数', 'Backlog登録数', '似た課題あり数', '似た課題で止めた数', 'カレンダー登録数'];
var LOG_KEYS = ['recordedAt', 'meetingDate', 'meetingTitle', 'result', 'confirmShownAt', 'approvedAt', 'confirmMinutes', 'edits',
  'todos', 'internalTodos', 'backlogRegistered', 'similarFlagged', 'similarStopped', 'calendarRegistered'];

var STATUS = {
  CREATING: '作成中', WAITING: '確認待ち', REGISTERING: '登録中', DONE: '登録済み',
  TRIED: 'お試し済み', CANCELLED: 'やめた', ERROR: 'エラー'
};

var AI_STUDIO_MODE = 'AI Studio（開発用・サンプルだけ）';
var VERTEX_MODE = 'Vertex AI';

var SETTING_DEFS = [
  { key: 'aiMode', label: 'AI の呼び方', def: AI_STUDIO_MODE, options: [AI_STUDIO_MODE, VERTEX_MODE],
    note: '開発中は「AI Studio（開発用・サンプルだけ）」。このときは架空のサンプルの会議メモしか送れません。本物の会議は「Vertex AI」で使います' },
  { key: 'model', label: 'Gemini のモデル', def: 'gemini-flash-latest', note: '止まるときや、提供が終わったときに変えます' },
  { key: 'fallbackModel', label: 'Gemini の予備のモデル', def: 'gemini-flash-lite-latest', note: '上のモデルが混み合っているときに、1 回だけ使います。空なら使いません' },
  { key: 'vertexProject', label: 'Vertex AI のプロジェクト ID', def: '', note: '会社の Google Cloud プロジェクトの ID（Vertex AI のときだけ）' },
  { key: 'vertexLocation', label: 'Vertex AI の場所', def: 'asia-northeast1', note: 'asia-northeast1 は東京。新しいモデルが東京にないときは global' },
  { key: 'saveFolder', label: '議事録の保存先フォルダ', def: '', note: '承認した議事録を置くフォルダ。最初の設定で作ります' },
  { key: 'draftFolder', label: '下書きフォルダ', def: '', note: '本人だけのフォルダ。最初の設定で作ります。人と共有しないでください' },
  { key: 'domains', label: '社内のドメイン', def: '', note: 'カレンダーの招待と、保存先の共有の確認に使います。複数あるときはカンマ区切り' },
  { key: 'backlogSpace', label: 'Backlog のスペース', def: '', note: '例: xxx.backlog.jp。空なら Backlog には登録せず、手で登録する一覧を出します' },
  { key: 'backlogProject', label: 'Backlog のプロジェクトキー', def: '', note: '例: IB_TASK' },
  { key: 'dryRun', label: 'お試し実行', def: 'する', options: ['する', 'しない'],
    note: '「する」のあいだは、承認しても保存先に置かず、Backlog・カレンダーにも登録しません（登録する予定だけを表示）' },
  { key: 'autoTitles', label: '自動で下書きを作る会議名', def: '', note: 'この言葉を名前に含む会議メモだけを自動で処理します（カンマ区切り）。空なら自動では作りません' },
  { key: 'logRun', label: '使った記録を残す', def: 'しない', options: ['する', 'しない'], note: 'テスト用。「する」にすると「記録」シートに 1 回ずつ残します' },
  { key: 'manualMinutes', label: '試算：いまの清書の分', def: '30', note: '集計の試算に使う仮の値' },
  { key: 'perTodo', label: '試算：Backlog 1 件の登録の分', def: '3', note: '集計の試算に使う仮の値' }
];

// ---------- 設定 ----------

function getSettings_() {
  var sh = requireSheet_(SHEET_SETTINGS);
  var last = sh.getLastRow();
  var values = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  var byLabel = {};
  values.forEach(function (r) { byLabel[String(r[0]).trim()] = String(r[1] === null ? '' : r[1]).trim(); });
  var s = {};
  SETTING_DEFS.forEach(function (d) { s[d.key] = byLabel[d.label] !== undefined ? byLabel[d.label] : d.def; });
  s.saveFolderId = parseFolderId_(s.saveFolder);
  s.draftFolderId = parseFolderId_(s.draftFolder);
  s.domainList = parseDomains_(s.domains);
  s.backlogSpace = String(s.backlogSpace || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return s;
}

function setSetting_(key, value) {
  var def = SETTING_DEFS.filter(function (d) { return d.key === key; })[0];
  var sh = requireSheet_(SHEET_SETTINGS);
  var labels = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
  var i = labels.indexOf(def.label);
  if (i < 0) sh.appendRow([def.label, value, def.note]);
  else sh.getRange(i + 2, 2).setValue(value);
}

function isAiStudio_(s) {
  return String(s.aiMode || '').indexOf('Vertex') < 0;
}

var AI_STUDIO_GUARD_MESSAGE = 'いまは開発用の設定（AI Studio）なので、本物の会議メモは AI に送れません（送った内容が学習に使われるおそれがあるため）。' +
  'メニュー「議事録」→「サンプルの会議メモで試す」を使ってください。本物の会議で使うときは、設定シートの「AI の呼び方」を「Vertex AI」にします。';

// ---------- API キー（ユーザー プロパティ） ----------

function getSecret_(name) {
  return PropertiesService.getUserProperties().getProperty(name) || '';
}

function setSecret_(name, value) {
  var p = PropertiesService.getUserProperties();
  if (value) p.setProperty(name, value);
  else p.deleteProperty(name);
}

function allSecrets_() {
  return [getSecret_('GEMINI_API_KEY'), getSecret_('BACKLOG_API_KEY')];
}

// ---------- シート ----------

function requireSheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('「' + name + '」シートがありません。メニュー「議事録」→「設定」→「最初の設定」を実行してください');
  return sh;
}

function readRows_(name, cols) {
  var sh = requireSheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j]; });
    return o;
  });
}

function updateRow_(name, cols, row, obj) {
  var sh = requireSheet_(name);
  Object.keys(obj).forEach(function (k) {
    var j = cols.indexOf(k);
    if (j >= 0) sh.getRange(row, j + 1).setValue(obj[k]);
  });
}

function getMeeting_(id) {
  var m = readRows_(SHEET_MEETINGS, MEETING_COLS).filter(function (r) { return r['会議ID'] === id; })[0];
  if (!m) throw new Error('「会議」シートに、この会議（' + id + '）の行がありません');
  m.data = m['データ'] ? JSON.parse(m['データ']) : {};
  return m;
}

function updateMeeting_(id, obj) {
  var m = getMeeting_(id);
  updateRow_(SHEET_MEETINGS, MEETING_COLS, m._row, obj);
}

/** 会議の「データ」（隠し列の JSON）に項目を足す */
function patchMeetingData_(id, patch) {
  var m = getMeeting_(id);
  var d = m.data || {};
  Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
  updateRow_(SHEET_MEETINGS, MEETING_COLS, m._row, { 'データ': JSON.stringify(d) });
}

/** セルに、URL の代わりに短いリンク（「下書きを開く」など）を書く */
function setLink_(sheetName, cols, row, colName, url, label) {
  var cell = requireSheet_(sheetName).getRange(row, cols.indexOf(colName) + 1);
  if (!url) { cell.setValue(''); return; }
  cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(url).build());
}

var MEETING_LINKS = {
  '下書き': { key: 'draftUrl', label: '下書きを開く' },
  '議事録': { key: 'finalUrl', label: '議事録を開く' },
  '元メモ': { key: 'sourceUrl', label: '元メモを開く' },
  '前回の議事録': { key: 'prevUrl', label: '前回を開く' }
};

/** 会議の行のリンクを書き、URL は「データ」にも残す（セルには短い文字しか残らないため） */
function setMeetingLink_(id, colName, url) {
  var def = MEETING_LINKS[colName];
  var patch = {};
  patch[def.key] = url || '';
  patchMeetingData_(id, patch);
  setLink_(SHEET_MEETINGS, MEETING_COLS, getMeeting_(id)._row, colName, url, def.label);
}

/** 会議の行のリンクの URL（前の版で URL をそのまま書いた行にも対応する） */
function meetingUrl_(m, colName) {
  var key = MEETING_LINKS[colName].key;
  if (m.data && m.data[key]) return m.data[key];
  var v = String(m[colName] || '');
  return /^https?:\/\//.test(v) ? v : '';
}

function findMeetingBySource_(docId) {
  return readRows_(SHEET_MEETINGS, MEETING_COLS).filter(function (r) {
    if (!r['データ']) return false;
    try { return JSON.parse(r['データ']).docId === docId; } catch (e) { return false; }
  }).pop() || null;
}

function getTodos_(id) {
  return readRows_(SHEET_TODOS, TODO_COLS).filter(function (r) { return r['会議ID'] === id; });
}

/** シートの TODO の行を、計算に使う形にする */
function todoFromRow_(r) {
  return {
    row: r._row, no: r['No'], what: String(r['何を'] || ''), category: normalizeCategory_(r['区分']),
    who: String(r['誰が'] || '') || '未定', due: normalizeDue_(r['いつまで']),
    backlog: r['Backlog'] === true, calendar: r['カレンダー'] === true, emails: String(r['招待するメール'] || ''),
    prevIssue: String(r['前回の課題'] || ''), similar: String(r['似た課題'] || ''),
    backlogKey: String(r['Backlog の課題'] || ''), calendarDone: !!String(r['カレンダーの予定'] || ''),
    keyword: String(r['探す語句'] || '')
  };
}

function appendTodoRows_(meetingId, meetingLabel, todos) {
  if (!todos.length) return;
  var sh = requireSheet_(SHEET_TODOS);
  var start = sh.getLastRow() + 1;
  var rows = todos.map(function (t, i) {
    return [meetingId, meetingLabel, i + 1, t.what, t.category, t.who, t.due || '未定', t.backlog, t.calendar, '',
      (t.notes || []).join('\n'), t.prevIssue || '', t.similar || '', '', '', t.keyword || ''];
  });
  sh.getRange(start, 1, rows.length, TODO_COLS.length).setValues(rows);
  formatTodoRows_(sh, start, rows.length);
}

function formatTodoRows_(sh, start, n) {
  var col = function (name) { return TODO_COLS.indexOf(name) + 1; };
  sh.getRange(start, col('区分'), n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['社内', '社外', '不明'], true).build());
  sh.getRange(start, col('Backlog'), n, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(start, col('注意'), n, 1).setWrap(true);
}

function newMeetingId_() {
  return 'M' + jstYmd_(new Date()).replace(/-/g, '') + '-' + Utilities.getUuid().slice(0, 6);
}
