/**
 * 会議メモから下書きを作る（SKILL.md の Step 1〜7 に当たる）。
 * 下書きは本人だけのフォルダに作り、承認するまで共有ドライブには置かない。
 */

var SAMPLE_SOURCE = 'sample';

// ---------- 画面から呼ぶ ----------

/** 「議事録を作る」の画面に出す、最近の会議メモ */
function listRecentMemos() {
  var s = getSettings_();
  if (isAiStudio_(s)) return { aiStudio: true, message: AI_STUDIO_GUARD_MESSAGE, candidates: [] };
  var today = jstYmd_(new Date());
  var files = searchMemos_(today + 'T00:00:00+09:00');
  var range = '今日';
  if (!files.length) {
    files = searchMemos_(addDaysYmd_(today, -7) + 'T00:00:00+09:00');
    range = '7 日以内';
  }
  var known = {};
  readRows_(SHEET_MEETINGS, MEETING_COLS).forEach(function (r) {
    try { var d = JSON.parse(r['データ'] || '{}'); if (d.docId) known[d.docId] = r['状態']; } catch (e) { /* 読めない行は飛ばす */ }
  });
  var candidates = files.map(function (f) {
    var date = meetingDateFromTitle_(f.name) || jstYmd_(new Date(f.createdTime));
    var time = meetingTimeFromTitle_(f.name) || jstDateTime_(new Date(f.createdTime)).slice(11);
    return { id: f.id, name: displayName_(f.name), when: date + ' ' + time, url: f.webViewLink, state: known[f.id] || '' };
  }).sort(function (a, b) { return a.when < b.when ? 1 : -1; }).slice(0, 10);
  return { aiStudio: false, range: range, candidates: candidates, message: candidates.length ? '' : '最近の会議メモが見つかりませんでした。会議メモの URL を入れてください' };
}

/** 表示用の会議名（「 - Gemini によるメモ」と日時を除く） */
function displayName_(title) {
  return stripMemoSuffix_(title).replace(/\s*[-－]\s*\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}.*$/, '').trim() || stripMemoSuffix_(title);
}

/** 会議メモ（URL か ID）から下書きを作る */
function createDraftFromMemo(input) {
  var docId = parseDocId_(input);
  if (!docId) throw new Error('会議メモの URL か ID を読み取れませんでした');
  return runSafely_(function () { return createDraft_({ kind: 'drive', docId: docId }); });
}

/** 架空のサンプルの会議メモで下書きを作る（お試し） */
function createSampleDraft() {
  return runSafely_(function () { return createDraft_({ kind: SAMPLE_SOURCE }); });
}

/** 秘密の情報を消してからエラーを返す */
function runSafely_(fn) {
  try {
    return fn();
  } catch (e) {
    throw new Error(maskSecrets_(e.message, allSecrets_()));
  }
}

// ---------- 本体 ----------

/**
 * src: { kind: 'drive', docId } または { kind: 'sample' }
 * 戻り値: { meetingId, title, draftUrl, message }
 */
function createDraft_(src, opts) {
  opts = opts || {};
  var s = getSettings_();
  if (!s.draftFolderId || !s.saveFolderId) throw new Error('下書きフォルダか保存先フォルダが決まっていません。メニュー「議事録」→「設定」→「最初の設定」を実行してください');
  var isSample = src.kind === SAMPLE_SOURCE;
  if (!isSample && isAiStudio_(s)) throw new Error(AI_STUDIO_GUARD_MESSAGE);

  // 同じ会議メモを二重に処理しないよう、行を作るところまでは鍵をかける
  var meetingId, memo;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ほかの処理が動いています。少し待ってからやり直してください');
  try {
    if (!isSample) {
      var existing = findMeetingBySource_(src.docId);
      if (existing && [STATUS.ERROR, STATUS.CANCELLED].indexOf(existing['状態']) < 0) {
        throw new Error('この会議メモの下書きはもうあります（「会議」シートの ' + existing['会議日'] + ' ' + existing['会議名'] + '、状態：' + existing['状態'] + '）');
      }
    }
    memo = isSample ? { title: SAMPLE_MEMO_TITLE, text: SAMPLE_MEMO_TEXT, createdTime: null } : readMemo_(src.docId);
    meetingId = newMeetingId_();
    var dateGuess = meetingDateFromTitle_(memo.title) || (memo.createdTime ? jstYmd_(new Date(memo.createdTime)) : jstYmd_(new Date()));
    var row = MEETING_COLS.map(function (c) {
      return {
        '会議ID': meetingId, '会議日': dateGuess, '会議名': displayName_(memo.title), '状態': STATUS.CREATING,
        '元メモ': isSample ? '（サンプル）' : '', 'お試し': s.dryRun !== 'しない',
        '作成日時': new Date(), '確認画面を開いた回数': 0, 'データ': JSON.stringify({ docId: isSample ? '' : src.docId })
      }[c];
    }).map(function (v) { return v === undefined ? '' : v; });
    requireSheet_(SHEET_MEETINGS).appendRow(row);
    if (!isSample) setMeetingLink_(meetingId, '元メモ', docUrl_(src.docId));
  } finally {
    lock.releaseLock();
  }

  try {
    return buildDraft_(s, meetingId, memo, src, isSample);
  } catch (e) {
    updateMeeting_(meetingId, { '状態': STATUS.ERROR, '結果': maskSecrets_(e.message, allSecrets_()).slice(0, 500) });
    throw e;
  }
}

function buildDraft_(s, meetingId, memo, src, isSample) {
  var today = jstYmd_(new Date());
  var title = stripMemoSuffix_(memo.title);
  var sanitized = sanitizeTitle_(memo.title);
  var meetingDate = meetingDateFromTitle_(memo.title) || (memo.createdTime ? jstYmd_(new Date(memo.createdTime)) : today);

  // 前回の議事録（保存先フォルダから同じ会議名のものを探す）
  var prev = null;
  var prevFiles = driveSearch_("'" + qEscape_(s.saveFolderId) + "' in parents and trashed = false and mimeType = '" + DOC_MIME + "' and name contains '" + qEscape_(sanitized) + "'");
  var found = findPrevMinutes_(prevFiles, sanitized, meetingDate);
  if (found) prev = { md: driveExportMarkdown_(found.file.id), date: found.date, url: found.file.webViewLink };

  // Backlog（使えなければ、照合と似た課題の確認をせずに進む）
  var bl = backlogContext_(s);
  var prevIssues = [];
  if (prev && bl.ctx) {
    try { prevIssues = backlogPrevIssues_(bl.ctx, sanitized.replace(/_/g, ' '), prev.date); } catch (e) { prevIssues = []; }
  }

  // Gemini に書いてもらう
  var result = generateMinutes_(s, { today: today, title: memo.title, text: memo.text, prev: prev, prevIssues: prevIssues });
  if (!meetingDateFromTitle_(memo.title) && result.meetingDate) meetingDate = result.meetingDate;

  // 重複を探す（同じ会議メモの登録済みの課題・Backlog の似た課題・ほかの会議の TODO・同じ会議の中）
  var check = checkDuplicates_({
    todos: result.todos, ctx: bl.ctx, docId: isSample ? '' : src.docId, meetingName: sanitized.replace(/_/g, ' '), meetingId: meetingId
  });
  var todos = enrichTodos_(result.todos, { today: today, prevIssues: prevIssues, bl: bl, dups: check.dups });
  var existing = existingMinutesNames_(s, meetingDate + '_' + sanitized);

  // 下書きを本人だけのフォルダに作る
  var md = buildDraftMarkdown_({
    title: title, createdDate: today, minutesMd: result.minutesMd, todos: todos,
    privateInfo: result.privateInfo, toConfirm: result.toConfirm, sample: isSample
  });
  var name = (isSample ? '【お試し】' : '【下書き】') + meetingDate + '_' + sanitized;
  var doc = driveCreateDocFromMarkdown_(name, md, s.draftFolderId);

  var label = meetingDate.slice(5).replace('-', '/') + ' ' + displayName_(memo.title);
  appendTodoRows_(meetingId, label, todos);
  patchMeetingData_(meetingId, {
    docId: isSample ? '' : src.docId, title: title, sanitized: sanitized, meetingDate: meetingDate,
    draftId: doc.id, prevDate: prev ? prev.date : '', sample: isSample
  });
  setMeetingLink_(meetingId, '下書き', doc.webViewLink);
  if (prev) setMeetingLink_(meetingId, '前回の議事録', prev.url);
  // 状態は最後に変える（「確認待ち」になったら、すぐに承認できるため）
  updateMeeting_(meetingId, { '会議日': meetingDate, '状態': STATUS.WAITING });
  console.log('下書きを作りました: ' + meetingId + '（TODO ' + todos.length + ' 件）');
  return {
    meetingId: meetingId, title: title, draftUrl: doc.webViewLink,
    message: '下書きができました。下書きを直し、TODO を「TODO」シートで確かめてから、メニュー「議事録」→「確認して承認する」を選んでください。' +
      (bl.ctx || !s.backlogSpace ? '' : '（' + bl.reason + '）') +
      (check.memoIssues.length ? '

⚠ この会議の課題が、すでに Backlog に ' + check.memoIssues.length + ' 件あります。ほかの参加者が登録した可能性があるので、同じ TODO は「登録しない」にしてあります。' : '') +
      (existing.length ? '

⚠ 保存先に、同じ会議の議事録がすでにあります（' + existing.join('、') + '）。ほかの参加者が作った可能性があります。' : '')
  };
}

/**
 * TODO に、前回の課題・担当者の照合・重複・登録先の初期値を足す。
 * 同じ会議メモから登録済みの課題と同じもの、同じ会議の中で前の行と同じものは、初期値を「登録しない」にする。
 */
function enrichTodos_(todos, o) {
  var ctx = o.bl.ctx;
  var dups = o.dups || todos.map(function () { return { within: -1 }; });
  return todos.map(function (t, i) {
    var notes = [];
    var d = dups[i];
    var prevIssue = isContinued_(t.what) ? pickContinuedIssue_(t.what, o.prevIssues) : null;
    if (prevIssue) notes.push('前回の課題を継続：' + prevIssue.key + '（' + prevIssue.status + '）');
    if (isUndecidedName_(t.who)) notes.push('⚠ 担当者が未定');
    else if (ctx && t.category === '社内' && !matchAssignee_(t.who, ctx.users).user) notes.push('⚠ Backlog の担当者が見つからない（' + t.who + '）');
    if (!t.due) notes.push('⚠ 期限が未定');
    if (t.category === '不明') notes.push('⚠ 区分が不明（社内の作業なら Backlog に ☑ を付けてください）');
    var flags = defaultFlags_({ category: t.category, due: t.due, prevIssue: prevIssue ? prevIssue.key : '' }, o.today);
    if (!prevIssue) notes = notes.concat(dupNotes_(d, flags.backlog));
    if (d.within >= 0 || d.memoIssue) flags = { backlog: false, calendar: false };
    if (flags.backlog && t.due && t.due < o.today) notes.push('期限が過ぎているため、カレンダーには入れていません');
    var similar = d.memoIssue || d.similarIssue;
    return {
      who: t.who, what: t.what, due: t.due, category: t.category, keyword: t.keyword,
      prevIssue: prevIssue ? prevIssue.key + '（' + prevIssue.status + '）' : '',
      similar: similar ? issueLabel_(similar) : '', notes: notes, backlog: flags.backlog, calendar: flags.calendar
    };
  });
}

// ---------- 自動で作る ----------

/** 時間で動く（15 分ごと）。決めた会議名の新しい会議メモを 1 件ずつ処理し、メールで知らせる */
function autoCreateDrafts() {
  var s = getSettings_();
  if (isAiStudio_(s)) return; // 開発用の設定では、本物の会議メモを AI に送らない
  var words = String(s.autoTitles || '').split(/[,、，]/).map(function (w) { return w.trim(); }).filter(Boolean);
  if (!words.length) return;
  var since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  var stableBefore = Date.now() - 10 * 60 * 1000; // 作られてすぐのメモは、まだ書き足されていることがあるので待つ
  var files = searchMemos_(since).filter(function (f) {
    return words.some(function (w) { return f.name.indexOf(w) >= 0; }) && new Date(f.modifiedTime).getTime() < stableBefore;
  });
  var me = Session.getActiveUser().getEmail();
  for (var i = files.length - 1; i >= 0; i--) {
    if (findMeetingBySource_(files[i].id)) continue;
    try {
      var r = createDraft_({ kind: 'drive', docId: files[i].id });
      if (me) {
        MailApp.sendEmail(me, '[議事録] 下書きができました：' + r.title,
          '下書きができました。直してから、管理シートのメニュー「議事録」→「確認して承認する」で承認してください。\n\n' +
          '下書き：' + r.draftUrl + '\n管理シート：' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
      }
    } catch (e) {
      console.error('自動で下書きを作れませんでした: ' + maskSecrets_(e.message, allSecrets_()));
      if (me) MailApp.sendEmail(me, '[議事録] 下書きを作れませんでした', '管理シートの「会議」シートで、状態が「エラー」の行を確かめてください。\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
    }
    return; // 1 回に 1 件だけ（6 分の上限に収めるため）
  }
}
