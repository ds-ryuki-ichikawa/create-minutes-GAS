/**
 * 確認画面と、承認したあとの保存・登録（SKILL.md の Step 8〜13 に当たる）。
 * 人が「承認する」を押すまでは、共有ドライブにも Backlog にもカレンダーにも何も書かない。
 */

// ---------- メニュー ----------

/**
 * 承認する会議を決めて、確認画面を出す。
 * 「会議」か「TODO」シートで承認待ちの会議の行を選んでいればその会議、承認待ちが 1 件だけならその会議、
 * 複数あれば一覧から選んでもらう。
 */
function menuApprove() {
  var open = openMeetings_();
  if (!open.length) {
    SpreadsheetApp.getUi().alert('承認を待っている会議はありません。先にメニュー「議事録」→「議事録を作る」で下書きを作ってください');
    return;
  }
  var selected = selectedMeetingId_();
  var hit = open.filter(function (r) { return r['会議ID'] === selected; })[0];
  if (hit || open.length === 1) {
    showConfirmFor((hit || open[0])['会議ID']);
    return;
  }
  showMeetingChooser_(open);
}

function openMeetings_() {
  return readRows_(SHEET_MEETINGS, MEETING_COLS).filter(function (r) {
    return [STATUS.WAITING, STATUS.REGISTERING].indexOf(r['状態']) >= 0;
  });
}

/** 「会議」か「TODO」シートで選んでいる行の会議 ID */
function selectedMeetingId_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if ([SHEET_MEETINGS, SHEET_TODOS].indexOf(sh.getName()) < 0 || !sh.getActiveRange()) return '';
  var row = sh.getActiveRange().getRow();
  return row >= 2 ? sh.getRange(row, 1).getValue() : '';
}

/** 承認待ちの会議が複数あるときに、どれを確認するか選ぶ画面 */
function showMeetingChooser_(open) {
  var items = open.slice().reverse().map(function (r) {
    return {
      id: r['会議ID'], label: r['会議日'] + '　' + r['会議名'], status: r['状態'],
      created: r['作成日時'] instanceof Date ? jstDateTime_(r['作成日時']) : '', dry: r['お試し'] === true
    };
  });
  var html = HtmlService.createHtmlOutput(
    '<style>body{font:14px/1.7 sans-serif;color:#1b2230;margin:0;padding:4px 8px}' +
    'button.item{display:block;width:100%;text-align:left;font:inherit;padding:8px 12px;margin:6px 0;border:1px solid #c4ccd8;border-radius:6px;background:#fff;cursor:pointer}' +
    'button.item:hover{background:#eef3f8}.sub{color:#5a6475;font-size:12px}.tag{font-size:12px;color:#6b4600;background:#ffe8a3;border-radius:4px;padding:0 6px;margin-left:6px}</style>' +
    '<div>承認を待っている会議が ' + items.length + ' 件あります。確認する会議を選んでください（新しい順）。</div><div id="list"></div><div id="msg" class="sub"></div>' +
    '<script>var ITEMS=' + JSON.stringify(items).replace(/</g, '\\u003c') + ';' +
    'ITEMS.forEach(function(x){var b=document.createElement("button");b.className="item";' +
    'var t=document.createElement("div");t.textContent=x.label;' +
    'if(x.status!=="確認待ち"){var s=document.createElement("span");s.className="tag";s.textContent=x.status;t.appendChild(s);}' +
    'if(x.dry){var d=document.createElement("span");d.className="tag";d.textContent="お試し";t.appendChild(d);}' +
    'var c=document.createElement("div");c.className="sub";c.textContent="下書きを作った日時："+(x.created||"不明");' +
    'b.appendChild(t);b.appendChild(c);b.onclick=function(){document.getElementById("msg").textContent="確認画面を開いています…";' +
    'google.script.run.withFailureHandler(function(e){document.getElementById("msg").textContent=e.message;}).showConfirmFor(x.id);};' +
    'document.getElementById("list").appendChild(b);});</script>'
  ).setWidth(560).setHeight(Math.min(160 + items.length * 70, 560));
  SpreadsheetApp.getUi().showModalDialog(html, '確認する会議を選ぶ');
}

/** 確認画面を出す（一覧の画面からも呼ぶ） */
function showConfirmFor(id) {
  var m = getMeeting_(id);
  if ([STATUS.WAITING, STATUS.REGISTERING].indexOf(m['状態']) < 0) throw new Error('この会議は「' + m['状態'] + '」なので、承認できません');
  // 確認・承認にかかった時間を測るため、初めて開いた時刻と、開いた回数を残す
  updateRow_(SHEET_MEETINGS, MEETING_COLS, m._row, {
    '確認を始めた時刻': m['確認を始めた時刻'] || new Date(),
    '確認画面を開いた回数': Number(m['確認画面を開いた回数'] || 0) + 1
  });
  var data;
  try {
    data = buildConfirmData_(m['会議ID']);
  } catch (e) {
    SpreadsheetApp.getUi().alert('確認画面を出せませんでした：' + maskSecrets_(e.message, allSecrets_()));
    return;
  }
  var t = HtmlService.createTemplateFromFile('Confirm');
  t.dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(780).setHeight(660), '内容を確認して承認する');
}

// ---------- 確認画面のデータ ----------

function buildConfirmData_(id) {
  var s = getSettings_();
  var m = getMeeting_(id);
  var d = m.data;
  var dry = m['お試し'] === true;
  var bl = backlogContext_(s);
  var me = Session.getActiveUser().getEmail();
  var ctx = { today: jstYmd_(new Date()), backlogReady: !!bl.ctx, domains: s.domainList };
  var todos = getTodos_(id).map(todoFromRow_);
  // 重複は、開くたびに探し直す（下書きを作ったあとに、ほかの人が登録したり、シートで書き換えたりするため）
  var check = checkDuplicates_({
    todos: todos, ctx: bl.ctx, docId: d.docId, meetingName: String(d.sanitized || '').replace(/_/g, ' '), meetingId: id,
    ignoreKeys: todos.map(function (t) { return t.backlogKey; })
  });
  var items = confirmItems_(todos, ctx, bl, me, check.dups);
  // シートの「注意」と「似た課題」も、いまの内容に合わせて書き直す
  items.forEach(function (x, i) {
    var similar = check.dups[i].memoIssue || check.dups[i].similarIssue;
    updateRow_(SHEET_TODOS, TODO_COLS, x.t.row, { '注意': x.notes.join('\n'), '似た課題': similar ? issueLabel_(similar) : '' });
  });
  var existing = dry || meetingUrl_(m, '議事録') ? [] : existingMinutesNames_(s, d.meetingDate + '_' + d.sanitized);

  var notes;
  try {
    notes = readDraftNotes_(driveExportMarkdown_(d.draftId), d.title);
  } catch (e) {
    throw new Error('下書きを読めませんでした。ゴミ箱に移していないか確かめてください（' + e.message + '）');
  }
  if (!notes.hasTitle) throw new Error('下書きにタイトルの行（「' + d.title + ' 議事録」）が見つかりません。タイトルの行は消さないでください');

  var save;
  if (meetingUrl_(m, '議事録')) {
    save = { ok: true, text: '作成済み：' + meetingUrl_(m, '議事録'), sub: '', problems: [] };
  } else if (dry) {
    save = { ok: true, text: 'お試しのため、保存先には置きません（下書きのまま残します）', sub: '', problems: [] };
  } else {
    var sharing = checkFolderSharing_(s);
    var base = d.meetingDate + '_' + d.sanitized;
    save = {
      ok: sharing.ok, text: sharing.folderName + ' ／ ' + nextFreeName_(base, driveNamesInFolder_(s.saveFolderId, base)),
      sub: '共有の範囲：' + sharing.summary, problems: sharing.problems
    };
  }

  return {
    id: id, title: d.title, date: d.meetingDate, status: m['状態'], dry: dry, draftUrl: meetingUrl_(m, '下書き'),
    backlogProject: s.backlogProject || '（未設定）', backlogNote: bl.ctx ? '' : bl.reason,
    items: items.map(function (x) {
      return { no: x.t.no, lead: x.p.lead, category: x.t.category, what: x.t.what, who: x.t.who, due: x.p.due || '未定', label: x.p.label, notes: x.notes };
    }),
    save: save, privateInfo: notes.privateInfo, toConfirm: notes.toConfirm, prevChanges: notes.prevChanges,
    prevUrl: meetingUrl_(m, '前回の議事録'), canApprove: save.ok,
    // 同じ会議メモから、ほかの人がすでに登録した課題・作った議事録
    memoIssues: check.memoIssues.map(issueLabel_), memoKeys: check.memoIssues.map(function (i) { return i.key; }),
    existingMinutes: existing
  };
}

/** TODO ごとに、登録先と注意を決める。dups は重複の結果（findDuplicates_）で、なければ重複の注意は出さない */
function confirmItems_(todos, ctx, bl, me, dups) {
  return todos.map(function (t, i) {
    var p = planTodo_(t, ctx);
    var notes = [];
    if (isUndecidedName_(t.who)) notes.push('⚠ 担当者が未定');
    if (!p.due) notes.push('⚠ 期限が未定');
    if (dups && !t.backlogKey) notes = notes.concat(dupNotes_(dups[i], p.doBacklog || p.manualBacklog));
    if (p.doBacklog && !isUndecidedName_(t.who) && !matchAssignee_(t.who, bl.ctx.users).user) {
      notes.push('⚠ Backlog の担当者が見つからない（' + t.who + '）。担当者なしで登録します');
    }
    var inv = invitees_(t, ctx.domains, me, bl);
    if (p.doCalendar) notes = notes.concat(inv.notes);
    return { t: t, p: p, notes: notes.concat(p.notes), invite: p.doCalendar ? inv.emails : [] };
  });
}

/** 招待する人（社内のアドレスだけ。自分は除く） */
function invitees_(t, domains, me, bl) {
  var given = parseEmails_(t.emails);
  var ok = [], notes = [];
  given.forEach(function (e) {
    if (me && e.toLowerCase() === me.toLowerCase()) return;
    if (!isAllowedEmail_(e, domains)) { notes.push('⚠ 社外のアドレスは招待しません：' + e); return; }
    ok.push(e);
  });
  var isMe = bl.ctx && !isUndecidedName_(t.who) && !!matchAssignee_(t.who, [bl.ctx.myself]).user;
  if (!given.length && !isUndecidedName_(t.who) && !isMe) {
    notes.push('⚠ カレンダーに招待しない（' + t.who + 'のメールアドレスが不明。招待するなら「招待するメール」に書く）');
  }
  return { emails: ok, notes: notes };
}

// ---------- 承認・やめる（確認画面から呼ぶ） ----------

/**
 * seenKeys: 確認画面に出した「同じ会議メモから登録済みの課題」の課題キー。
 * 承認の直前にもう一度探し、確認画面を開いたあとに増えていたら（ほかの参加者が登録した）、何もせずに止める。
 */
function approveMeeting(id, seenKeys) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, lines: ['ほかの処理が動いています。少し待ってから、もう一度「承認する」を押してください'] };
  try {
    return approveLocked_(id, seenKeys);
  } catch (e) {
    return {
      ok: false,
      lines: ['途中で止まりました：' + maskSecrets_(e.message, allSecrets_()),
        'ここまでに登録したものは「TODO」シートに書いてあります。原因を直してから、もう一度「確認して承認する」で承認すると、続きから登録します。']
    };
  } finally {
    lock.releaseLock();
  }
}

function approveLocked_(id, seenKeys) {
  var s = getSettings_();
  var m = getMeeting_(id);
  if ([STATUS.WAITING, STATUS.REGISTERING].indexOf(m['状態']) < 0) return { ok: false, lines: ['この会議は「' + m['状態'] + '」なので、承認できません'] };
  var d = m.data;
  var dry = m['お試し'] === true;
  var me = Session.getActiveUser().getEmail();
  var approvedAt = m['承認した時刻'] instanceof Date ? m['承認した時刻'] : new Date();
  var bl = backlogContext_(s);
  var ctx = { today: jstYmd_(new Date()), backlogReady: !!bl.ctx, domains: s.domainList };
  var todos = getTodos_(id).map(todoFromRow_);
  var items = confirmItems_(todos, ctx, bl, me);

  if (dry) {
    updateMeeting_(id, { '状態': STATUS.TRIED, '承認した時刻': approvedAt, '承認した人': me, '結果': 'お試し（保存・登録なし）' });
    var lines = ['🧪 お試し実行のため、保存・登録はしていません。本番なら次のとおりです。', '', '📄 議事録：保存先フォルダに確定版を作り、下書きはゴミ箱へ移す'];
    items.forEach(function (x) { lines.push('・' + x.t.no + '. ' + x.t.what + ' → ' + x.p.label); });
    lines.push('', '本番で使うときは、設定シートの「お試し実行」を「しない」にしてから下書きを作ってください。');
    return { ok: true, lines: lines };
  }

  // 承認の直前に、同じ会議メモの課題がほかの人に登録されていないか、もう一度確かめる（ここではまだ何も書いていない）
  if (bl.ctx && d.docId && Array.isArray(seenKeys)) {
    var own = todos.map(function (t) { return t.backlogKey; });
    var added = backlogMemoIssues_(bl.ctx, String(d.sanitized || '').replace(/_/g, ' '), d.docId).filter(function (i) {
      return own.indexOf(i.key) < 0 && seenKeys.indexOf(i.key) < 0;
    });
    if (added.length) {
      return {
        ok: false,
        lines: ['確認画面を開いたあとに、この会議の課題がほかの人によって Backlog に登録されました：' + added.map(issueLabel_).join('、'),
          '何も保存・登録していません。重複しないよう、確認画面を開き直して確かめてから承認してください。']
      };
    }
  }

  updateMeeting_(id, { '状態': STATUS.REGISTERING, '承認した時刻': approvedAt, '承認した人': me });
  var report = [];

  // 1. 確定版の議事録を保存先に作る（作成済みなら飛ばす）
  var finalUrl = meetingUrl_(m, '議事録');
  if (!finalUrl) {
    var sharing = checkFolderSharing_(s);
    if (!sharing.ok) throw new Error('保存先フォルダの共有の範囲に問題があるため、保存しませんでした：' + sharing.problems.join('、'));
    var fin = finalizeMarkdown_(driveExportMarkdown_(d.draftId), {
      title: d.title,
      todos: todos.map(function (t) { return { who: t.who, what: t.what, due: t.due, category: t.category }; }),
      approvalLine: buildApprovalLine_({ approver: me, at: jstDateTime_(approvedAt), sourceUrl: docUrl_(d.docId) })
    });
    var base = d.meetingDate + '_' + d.sanitized;
    var doc = driveCreateDocFromMarkdown_(nextFreeName_(base, driveNamesInFolder_(s.saveFolderId, base)), fin.md, s.saveFolderId);
    finalUrl = doc.webViewLink;
    setMeetingLink_(id, '議事録', finalUrl);
    try {
      driveTrash_(d.draftId);
    } catch (e) {
      report.push('⚠ 下書きをゴミ箱に移せませんでした。あとで手で消してください：' + meetingUrl_(m, '下書き'));
    }
  }

  // 2. Backlog（1 件ごとに課題キーをシートに書く。やり直したときは登録済みを飛ばす）
  var created = [], manual = [];
  items.forEach(function (x) {
    if (x.p.manualBacklog) manual.push(x);
    if (!x.p.doBacklog) return;
    var who = matchAssignee_(x.t.who, bl.ctx.users).user;
    var issue = backlogCreateIssue_(bl.ctx, {
      summary: x.t.what, assigneeId: who ? who.id : '', dueDate: x.p.due,
      description: ['会議: ' + d.title, '開催日: ' + d.meetingDate, d.docId ? '元メモ: ' + docUrl_(d.docId) : '', '議事録: ' + finalUrl, '（' + APP_NAME + 'により登録）']
        .filter(Boolean).join('\n')
    });
    x.t.backlogKey = issue.key;
    setLink_(SHEET_TODOS, TODO_COLS, x.t.row, 'Backlog の課題', issue.url, issue.key);
    created.push(issue.key);
  });

  // 3. カレンダー（同じタイトルの予定がもうあれば作らない）
  var calCount = 0;
  items.forEach(function (x) {
    if (!x.p.doCalendar) return;
    var title = '【期限】' + x.t.what;
    var mark = '登録済み';
    if (calendarTitlesOn_(x.p.due).indexOf(title) >= 0) {
      mark = '登録済み（前からあった）';
    } else {
      calendarCreateDeadline_({
        title: title, date: x.p.due, attendees: x.invite,
        description: ['担当者: ' + x.t.who, '会議: ' + d.title, x.t.backlogKey && bl.ctx ? 'Backlog: ' + backlogIssueUrl_(bl.ctx, x.t.backlogKey) : '',
          '議事録: ' + finalUrl, d.docId ? '元メモ: ' + docUrl_(d.docId) : '', '（' + APP_NAME + 'により登録）'].filter(Boolean).join('\n')
      });
      calCount++;
    }
    updateRow_(SHEET_TODOS, TODO_COLS, x.t.row, { 'カレンダーの予定': mark });
  });

  var summary = 'Backlog ' + created.length + ' 件・カレンダー ' + calCount + ' 件';
  updateMeeting_(id, { '状態': STATUS.DONE, '結果': summary + (created.length ? '（' + created.join(', ') + '）' : '') });

  var lines = ['✅ 承認して、保存・登録しました', '', '📄 議事録：' + finalUrl];
  lines.push('📝 Backlog：' + created.length + ' 件登録' + (created.length ? '（' + created.join(', ') + '）' : ''));
  if (manual.length) {
    lines.push('', '📝 Backlog が使えないため、次を ' + (s.backlogProject || 'Backlog') + ' に手で登録してください（' + bl.reason + '）');
    manual.forEach(function (x) { lines.push('  ・' + x.t.what + '｜担当：' + x.t.who + '｜期限：' + (x.p.due || 'なし')); });
  }
  lines.push('📅 カレンダー：' + calCount + ' 件のリマインドを登録');
  lines = lines.concat(report);
  if (created.length) lines.push('', '※ Backlog の課題は、権限によっては消せません。不要になったら、コメントを付けて閉じてください。');

  if (s.logRun === 'する') {
    appendRunLog_(getMeeting_(id), '承認', getTodos_(id).map(todoFromRow_), approvedAt);
  }
  return { ok: true, lines: lines };
}

function cancelMeeting(id) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, lines: ['ほかの処理が動いています。少し待ってからやり直してください'] };
  try {
    var m = getMeeting_(id);
    if (m['状態'] !== STATUS.WAITING) return { ok: false, lines: ['この会議は「' + m['状態'] + '」なので、やめられません（途中まで登録したものがあるときは、続きから承認してください）'] };
    var lines = ['何も保存・登録していません。'];
    try {
      if (m.data.draftId) { driveTrash_(m.data.draftId); lines.push('下書きはゴミ箱に移しました（30 日以内なら戻せます）。'); }
    } catch (e) {
      lines.push('⚠ 下書きをゴミ箱に移せませんでした。手で消してください：' + meetingUrl_(m, '下書き'));
    }
    updateMeeting_(id, { '状態': STATUS.CANCELLED });
    var s = getSettings_();
    if (s.logRun === 'する' && m['お試し'] !== true) appendRunLog_(getMeeting_(id), 'やめた', getTodos_(id).map(todoFromRow_), null);
    return { ok: true, lines: lines };
  } catch (e) {
    return { ok: false, lines: [maskSecrets_(e.message, allSecrets_())] };
  } finally {
    lock.releaseLock();
  }
}
