/**
 * メニュー・最初の設定・API キー・自動で作る設定。
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('議事録')
    .addItem('議事録を作る…', 'menuCreateDraft')
    .addItem('確認して承認する…', 'menuApprove')
    .addSeparator()
    .addItem('サンプルの会議メモで試す', 'menuSample')
    .addSeparator()
    .addSubMenu(ui.createMenu('設定')
      .addItem('最初の設定', 'setupSheets')
      .addItem('Gemini（AI Studio）の API キーを入れる', 'menuSetGeminiKey')
      .addItem('Backlog の API キーを入れる', 'menuSetBacklogKey')
      .addSeparator()
      .addItem('自動で下書きを作る：オンにする', 'menuAutoOn')
      .addItem('自動で下書きを作る：オフにする', 'menuAutoOff'))
    .addItem('使った記録を集計する', 'menuSummarizeLog')
    .addItem('この版について', 'menuAbout')
    .addToUi();
}

// ---------- 議事録を作る ----------

function menuCreateDraft() {
  var html = HtmlService.createHtmlOutputFromFile('Pick').setWidth(720).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '議事録を作る');
}

function menuSample() {
  var ui = SpreadsheetApp.getUi();
  SpreadsheetApp.getActiveSpreadsheet().toast('架空のサンプルの会議メモから下書きを作っています（1〜2 分かかります）', '議事録', 120);
  try {
    var r = createSampleDraft();
    ui.alert('下書きができました（お試し）', r.message + '\n\n下書き：' + r.draftUrl, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('下書きを作れませんでした', e.message, ui.ButtonSet.OK);
  }
}

// ---------- 最初の設定 ----------

function setupSheets() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // シートを作り、見た目をかけ直す（何度実行しても、入っている値は変えない）
  var meetings = ensureSheet_(ss, SHEET_MEETINGS, MEETING_COLS);
  var todos = ensureSheet_(ss, SHEET_TODOS, TODO_COLS);
  var settings = ensureSheet_(ss, SHEET_SETTINGS, ['項目', '値', '説明']);
  var log = ensureSheet_(ss, SHEET_LOG, LOG_COLS);

  // 設定の行（足りないものだけ足す。入っている値は変えない）
  var have = settings.getLastRow() >= 2 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  SETTING_DEFS.forEach(function (d) {
    if (have.indexOf(d.label) >= 0) return;
    settings.appendRow([d.label, d.def, d.note]);
    if (d.options) {
      settings.getRange(settings.getLastRow(), 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(d.options, true).build());
    }
  });
  layoutMeetings_(meetings);
  layoutTodos_(todos);
  layoutSettings_(settings);
  layoutLog_(log);
  orderSheets_(ss);

  var s = getSettings_();
  var me = Session.getActiveUser().getEmail();
  if (!s.domains && me) setSetting_('domains', emailDomain_(me));

  // フォルダはこのツールで作る（このツールが作ったフォルダにだけ書き込める権限にしているため）
  var made = [];
  if (!s.draftFolderId) {
    var draft = driveCreateFolder_('議事録の下書き（meeting-tasks）');
    setSetting_('draftFolder', draft.webViewLink);
    made.push('下書きフォルダ：' + draft.name);
  }
  if (!s.saveFolderId) {
    var save = driveCreateFolder_('議事録（meeting-tasks・開発用）');
    setSetting_('saveFolder', save.webViewLink);
    made.push('保存先フォルダ：' + save.name);
  }
  ss.setActiveSheet(settings);
  ui.alert('最初の設定が終わりました',
    (made.length ? 'マイドライブに次のフォルダを作りました。\n' + made.join('\n') + '\n\n' : '') +
    '次に、メニュー「議事録」→「設定」で API キーを入れてください。\n' +
    '・開発中は「Gemini（AI Studio）の API キー」（aistudio.google.com で発行）\n' +
    '・Backlog を試すなら「Backlog の API キー」と、設定シートの Backlog のスペース・プロジェクトキー\n\n' +
    'このスプレッドシートは人と共有しないでください（編集できる人は、あなたの権限で動くプログラムを書き換えられるため）。',
    ui.ButtonSet.OK);
}

function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  // 最初からある「シート1」は、空なら消す
  var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  return sh;
}

// ---------- API キー ----------

function menuSetGeminiKey() {
  promptSecret_('GEMINI_API_KEY', 'Gemini（AI Studio）の API キー',
    'aistudio.google.com の「API キーを作成」で発行したキーを貼ってください。\n' +
    'キーはあなただけが読める場所（ユーザー プロパティ）に保存し、シートには書きません。\n' +
    '開発用です。本物の会議メモは送りません（架空のサンプルだけ）。\n空のまま OK で、いまのキーを消します。');
}

function menuSetBacklogKey() {
  promptSecret_('BACKLOG_API_KEY', 'Backlog の API キー',
    'Backlog の「個人設定」→「API」で発行したキーを貼ってください。\n' +
    'キーはあなただけが読める場所（ユーザー プロパティ）に保存し、シートには書きません。\n空のまま OK で、いまのキーを消します。');
}

function promptSecret_(name, title, message) {
  var ui = SpreadsheetApp.getUi();
  var has = !!getSecret_(name);
  var r = ui.prompt(title, message + '\n\nいまの状態：' + (has ? '入っています' : '入っていません'), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim();
  setSecret_(name, v);
  ui.alert(v ? '保存しました' : '消しました');
}

// ---------- 自動で作る ----------

function menuAutoOn() {
  var ui = SpreadsheetApp.getUi();
  var s = getSettings_();
  if (isAiStudio_(s)) { ui.alert('開発用の設定（AI Studio）では、本物の会議メモを AI に送らないため、自動では作れません。'); return; }
  if (!String(s.autoTitles || '').trim()) { ui.alert('先に、設定シートの「自動で下書きを作る会議名」に、対象の会議名に含まれる言葉（例：定例）を書いてください。'); return; }
  removeAutoTriggers_();
  ScriptApp.newTrigger('autoCreateDrafts').timeBased().everyMinutes(15).create();
  ui.alert('オンにしました。15 分ごとに「' + s.autoTitles + '」を名前に含む新しい会議メモを探し、下書きができたらメールで知らせます。');
}

function menuAutoOff() {
  var n = removeAutoTriggers_();
  SpreadsheetApp.getUi().alert(n ? 'オフにしました' : 'もともとオフです');
}

function removeAutoTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoCreateDrafts') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function menuAbout() {
  var s = getSettings_();
  SpreadsheetApp.getUi().alert(APP_NAME,
    '版：' + APP_VERSION + '\nAI の呼び方：' + s.aiMode + '（モデル：' + s.model + '）\nお試し実行：' + s.dryRun +
    '\n\nソース：create-minutes リポジトリの gas/ フォルダ', SpreadsheetApp.getUi().ButtonSet.OK);
}
