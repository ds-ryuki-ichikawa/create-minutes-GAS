/**
 * 使った記録（テスト用）。設定シートの「使った記録を残す」が「する」のときだけ、「記録」シートに 1 回ずつ残す。
 * 会議の中身は残さず、会議名と数だけを残す。
 */

/** m: 会議の行、result: '承認' か 'やめた'、todos: todoFromRow_ の配列 */
function appendRunLog_(m, result, todos, approvedAt) {
  var shown = m['確認を始めた時刻'] instanceof Date ? m['確認を始めた時刻'] : null;
  var minutes = shown && approvedAt && approvedAt >= shown ? Math.round(((approvedAt - shown) / 60000) * 10) / 10 : '';
  var flagged = todos.filter(function (t) { return t.similar; });
  var rec = {
    recordedAt: new Date(), meetingDate: m['会議日'], meetingTitle: m['会議名'], result: result,
    confirmShownAt: shown || '', approvedAt: approvedAt || '', confirmMinutes: minutes,
    edits: Math.max(0, Number(m['確認画面を開いた回数'] || 0) - 1),
    todos: todos.length,
    internalTodos: todos.filter(function (t) { return t.category === '社内'; }).length,
    backlogRegistered: todos.filter(function (t) { return t.backlogKey; }).length,
    similarFlagged: flagged.length,
    similarStopped: flagged.filter(function (t) { return !t.backlogKey; }).length,
    calendarRegistered: todos.filter(function (t) { return t.calendarDone; }).length
  };
  requireSheet_(SHEET_LOG).appendRow(LOG_KEYS.map(function (k) { return rec[k]; }));
}

function menuSummarizeLog() {
  var s = getSettings_();
  var sh = requireSheet_(SHEET_LOG);
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, LOG_KEYS.length).getValues() : [];
  var records = rows.map(function (r) {
    var o = {};
    LOG_KEYS.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    if (o.meetingDate && /^\d{4}-\d{2}-\d{2}T/.test(o.meetingDate)) o.meetingDate = jstYmd_(new Date(o.meetingDate));
    return o;
  });
  var lines = summarizeLog_(records, Number(s.manualMinutes) || 30, Number(s.perTodo) || 3);
  var html = HtmlService.createHtmlOutput('<pre style="white-space:pre-wrap;font:14px/1.7 sans-serif"></pre><script>document.querySelector("pre").textContent = ' +
    JSON.stringify(lines.join('\n')).replace(/</g, '\\u003c') + ';</script>').setWidth(720).setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, '使った記録の集計');
}
