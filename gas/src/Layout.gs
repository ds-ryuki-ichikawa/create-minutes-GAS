/**
 * 管理シートの見た目（色・列の幅・隠す列・固定する列・説明）。
 * 「最初の設定」を実行するたびにかけ直す（入っている値は変えない）。
 */

var UI_COLOR = {
  head: '#eef1f5', headText: '#1b2230',
  editHead: '#ffe8a3', editCell: '#fffbea',
  muted: '#7a8394', warnBg: '#fff3dc', warnText: '#8a5300'
};

// ファイルは名前の順に読み込まれ、STATUS（Settings.gs）はまだないことがあるので、使うときに組み立てる
function statusStyle_() {
  return [
    [STATUS.WAITING, '#ffe8a3', '#6b4600'],
    [STATUS.REGISTERING, '#dbe9f6', '#1f5f8b'],
    [STATUS.CREATING, '#dbe9f6', '#1f5f8b'],
    [STATUS.DONE, '#dff2e7', '#1e6b43'],
    [STATUS.ERROR, '#fde2e1', '#b3261e'],
    [STATUS.CANCELLED, '#eef1f5', '#7a8394'],
    [STATUS.TRIED, '#eef1f5', '#7a8394']
  ];
}

var MEETING_HIDDEN = ['会議ID', '作成日時', '確認を始めた時刻', '確認画面を開いた回数', '承認した時刻', 'データ'];
var MEETING_WIDTHS = { '会議日': 96, '会議名': 260, '状態': 90, '下書き': 110, '議事録': 110, '元メモ': 110, '前回の議事録': 120, 'お試し': 56, '承認した人': 200, '結果': 320 };

var TODO_HIDDEN = ['会議ID', '前回の課題', '似た課題', '探す語句'];
var TODO_EDITABLE = ['区分', '誰が', 'いつまで', 'Backlog', 'カレンダー', '招待するメール'];
var TODO_WIDTHS = { '会議': 160, 'No': 40, '何を': 320, '区分': 64, '誰が': 150, 'いつまで': 100, 'Backlog': 72, 'カレンダー': 80, '招待するメール': 220, '注意': 360, 'Backlog の課題': 120, 'カレンダーの予定': 130 };
var TODO_NOTES = {
  '区分': '社内・社外・不明から選ぶ。社外の作業は、ふつうは登録しない',
  '誰が': 'Backlog の担当者になる。Backlog のメンバーの名前で書く（敬称は付けなくてよい）',
  'いつまで': 'YYYY-MM-DD か「未定」。Backlog の期限と、カレンダーの日付になる',
  'Backlog': '☑ を付けた TODO だけを、承認したときに Backlog に登録する',
  'カレンダー': '☑ を付けた TODO だけを、承認したときに期限の終日予定として自分のカレンダーに入れる',
  '招待するメール': 'カレンダーに招待する社内の人のアドレス（カンマ区切り）。社外のアドレスは招待しない',
  '注意': '確認画面を開くたびに書き直す。直す必要はない'
};

/** 終わった会議（登録済み・やめた・お試し済み）の TODO を薄く表示するための式 */
function todoDoneFormula_() {
  return '=SUM(' + [STATUS.DONE, STATUS.CANCELLED, STATUS.TRIED].map(function (st) {
    return 'COUNTIFS(INDIRECT("' + SHEET_MEETINGS + '!A:A"),$A2,INDIRECT("' + SHEET_MEETINGS + '!D:D"),"' + st + '")';
  }).join(',') + ')>0';
}

function colOf_(cols, name) {
  return cols.indexOf(name) + 1;
}

function styleHeader_(sh, cols, editable) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setFontColor(UI_COLOR.headText)
    .setBackground(UI_COLOR.head).setVerticalAlignment('middle');
  (editable || []).forEach(function (c) { sh.getRange(1, colOf_(cols, c)).setBackground(UI_COLOR.editHead); });
  sh.setFrozenRows(1);
}

function setWidths_(sh, cols, widths) {
  Object.keys(widths).forEach(function (c) { if (cols.indexOf(c) >= 0) sh.setColumnWidth(colOf_(cols, c), widths[c]); });
}

function hideCols_(sh, cols, names) {
  names.forEach(function (c) { if (cols.indexOf(c) >= 0) sh.hideColumns(colOf_(cols, c)); });
}

function layoutMeetings_(sh) {
  var n = sh.getMaxRows() - 1;
  styleHeader_(sh, MEETING_COLS, []);
  setWidths_(sh, MEETING_COLS, MEETING_WIDTHS);
  hideCols_(sh, MEETING_COLS, MEETING_HIDDEN);
  sh.getRange(2, 1, n, MEETING_COLS.length).setVerticalAlignment('top');
  sh.getRange(2, colOf_(MEETING_COLS, '会議日'), n, 1).setNumberFormat('@');
  ['作成日時', '確認を始めた時刻', '承認した時刻'].forEach(function (c) {
    sh.getRange(2, colOf_(MEETING_COLS, c), n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });
  sh.getRange(2, colOf_(MEETING_COLS, 'お試し'), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(2, colOf_(MEETING_COLS, '状態'), n, 1).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, colOf_(MEETING_COLS, '結果'), n, 1).setWrap(true);
  var status = sh.getRange(2, colOf_(MEETING_COLS, '状態'), n, 1);
  sh.setConditionalFormatRules(statusStyle_().map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(x[0]).setBackground(x[1]).setFontColor(x[2]).setRanges([status]).build();
  }));
  sh.setFrozenColumns(colOf_(MEETING_COLS, '会議名'));
  sh.setTabColor('#1f5f8b');
}

function layoutTodos_(sh) {
  var n = sh.getMaxRows() - 1;
  styleHeader_(sh, TODO_COLS, TODO_EDITABLE);
  Object.keys(TODO_NOTES).forEach(function (c) { sh.getRange(1, colOf_(TODO_COLS, c)).setNote(TODO_NOTES[c]); });
  setWidths_(sh, TODO_COLS, TODO_WIDTHS);
  hideCols_(sh, TODO_COLS, TODO_HIDDEN);
  sh.getRange(2, 1, n, TODO_COLS.length).setVerticalAlignment('top');
  TODO_EDITABLE.forEach(function (c) { sh.getRange(2, colOf_(TODO_COLS, c), n, 1).setBackground(UI_COLOR.editCell); });
  sh.getRange(2, colOf_(TODO_COLS, 'いつまで'), n, 1).setNumberFormat('@');
  sh.getRange(2, colOf_(TODO_COLS, 'No'), n, 1).setHorizontalAlignment('center');
  ['Backlog', 'カレンダー'].forEach(function (c) { sh.getRange(2, colOf_(TODO_COLS, c), n, 1).setHorizontalAlignment('center'); });
  ['何を', '注意', '招待するメール'].forEach(function (c) { sh.getRange(2, colOf_(TODO_COLS, c), n, 1).setWrap(true); });
  sh.getRange(2, colOf_(TODO_COLS, '会議'), n, 1).setFontColor(UI_COLOR.muted);
  var all = sh.getRange(2, 1, n, TODO_COLS.length);
  var notes = sh.getRange(2, colOf_(TODO_COLS, '注意'), n, 1);
  sh.setConditionalFormatRules([
    // 終わった会議の TODO は薄く（先に書いたルールが優先される）
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(todoDoneFormula_()).setFontColor('#a3abb8').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('⚠').setBackground(UI_COLOR.warnBg).setFontColor(UI_COLOR.warnText).setRanges([notes]).build()
  ]);
  sh.setFrozenColumns(colOf_(TODO_COLS, '何を'));
  sh.setTabColor('#d9a400');
}

function layoutSettings_(sh) {
  var n = sh.getMaxRows() - 1;
  styleHeader_(sh, ['項目', '値', '説明'], ['値']);
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 340);
  sh.setColumnWidth(3, 560);
  sh.getRange(2, 1, n, 3).setVerticalAlignment('top');
  sh.getRange(2, 1, n, 1).setFontWeight('bold');
  sh.getRange(2, 2, n, 1).setBackground(UI_COLOR.editCell);
  sh.getRange(2, 3, n, 1).setFontColor(UI_COLOR.muted).setWrap(true);
  sh.setTabColor('#7a8394');
}

function layoutLog_(sh) {
  styleHeader_(sh, LOG_COLS, []);
  sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setTabColor('#b0b7c3');
}

/** シートの並びを 会議 → TODO → 設定 → 記録 にする */
function orderSheets_(ss) {
  [SHEET_MEETINGS, SHEET_TODOS, SHEET_SETTINGS, SHEET_LOG].forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
}
