/**
 * TODO の重複を探すための材料を集める（判定は Util.gs の findDuplicates_）。
 * 下書きを作るとき・確認画面を開くとき・承認の直前に使う。
 */

var MAX_KEYWORD_SEARCHES = 20;
var OTHER_MEETING_DAYS = 30;

/**
 * o: { todos: [{ what, keyword }], ctx: Backlog の準備（なければ null）, docId, meetingName, meetingId, ignoreKeys }
 * 戻り値: { dups: TODO ごとの結果, memoIssues: 同じ会議メモから登録済みの課題（自分のものを除く） }
 */
function checkDuplicates_(o) {
  var memoIssues = [], foundByKeyword = {};
  if (o.ctx) {
    memoIssues = backlogMemoIssues_(o.ctx, o.meetingName, o.docId);
    var keywords = [];
    o.todos.forEach(function (t) { if (t.keyword && keywords.indexOf(t.keyword) < 0) keywords.push(t.keyword); });
    keywords.slice(0, MAX_KEYWORD_SEARCHES).forEach(function (k) {
      try { foundByKeyword[k] = backlogSearch_(o.ctx, k, 10); } catch (e) { foundByKeyword[k] = []; }
    });
  }
  var ignore = o.ignoreKeys || [];
  var dups = findDuplicates_(o.todos, {
    memoIssues: memoIssues, foundByKeyword: foundByKeyword, otherRows: otherMeetingRows_(o.meetingId), ignoreKeys: ignore
  });
  return { dups: dups, memoIssues: memoIssues.filter(function (i) { return ignore.indexOf(i.key) < 0; }) };
}

/** ほかの会議（承認待ち・登録中・最近登録したもの）の TODO */
function otherMeetingRows_(meetingId) {
  var since = Date.now() - OTHER_MEETING_DAYS * 24 * 60 * 60 * 1000;
  var ok = {};
  readRows_(SHEET_MEETINGS, MEETING_COLS).forEach(function (m) {
    if (m['会議ID'] === meetingId) return;
    if ([STATUS.WAITING, STATUS.REGISTERING, STATUS.DONE].indexOf(m['状態']) < 0) return;
    if (m['作成日時'] instanceof Date && m['作成日時'].getTime() < since) return;
    ok[m['会議ID']] = true;
  });
  return readRows_(SHEET_TODOS, TODO_COLS).filter(function (r) { return ok[r['会議ID']]; })
    .map(function (r) { return { what: String(r['何を'] || ''), label: r['会議'], no: r['No'] }; });
}

/** 保存先フォルダに、同じ会議の議事録（同じ名前）がすでにあるか */
function existingMinutesNames_(s, base) {
  return driveNamesInFolder_(s.saveFolderId, base).filter(function (n) { return n === base || n.indexOf(base + '_') === 0; });
}
