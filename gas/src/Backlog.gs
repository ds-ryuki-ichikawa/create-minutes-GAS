/**
 * Backlog の API を直接呼ぶ（パソコンで Backlog MCP を起動しなくてよい）。
 * API キーは本人のユーザー プロパティから読み、表示やログには出さない。
 */

function backlogUrl_(c, path, params) {
  var q = 'apiKey=' + encodeURIComponent(c.key);
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    (Array.isArray(v) ? v : [v]).forEach(function (x) {
      if (x !== undefined && x !== '') q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(x);
    });
  });
  return 'https://' + c.space + path + '?' + q;
}

function backlogCall_(c, method, path, params, form) {
  var opts = { method: method };
  if (form) opts.payload = form; // オブジェクトを渡すとフォームの形で送られる
  // 課題の登録（post）は、5xx でやり直すと二重に登録されるおそれがあるため、やり直さない
  var res = fetchWithRetry_(backlogUrl_(c, path, params), opts, 'Backlog', method === 'get');
  var code = res.getResponseCode();
  if (code >= 300) {
    var detail = errorDetail_(res);
    if (code === 401) detail = 'API キーが正しくないか、使えなくなっています';
    throw new Error('Backlog でエラーになりました（' + code + '）：' + detail);
  }
  return JSON.parse(res.getContentText());
}

/**
 * Backlog の準備（プロジェクト・メンバー・種別・優先度・自分）。使えなければ ctx は null で、reason に理由。
 */
function backlogContext_(s) {
  if (!s.backlogSpace || !s.backlogProject) return { ctx: null, reason: '設定シートに Backlog のスペースかプロジェクトキーがありません' };
  var key = getSecret_('BACKLOG_API_KEY');
  if (!key) return { ctx: null, reason: 'Backlog の API キーが入っていません（メニュー「議事録」→「設定」）' };
  var c = { space: s.backlogSpace, key: key };
  try {
    var project = backlogCall_(c, 'get', '/api/v2/projects/' + encodeURIComponent(s.backlogProject));
    var users = backlogCall_(c, 'get', '/api/v2/projects/' + project.id + '/users');
    var types = backlogCall_(c, 'get', '/api/v2/projects/' + project.id + '/issueTypes');
    var priorities = backlogCall_(c, 'get', '/api/v2/priorities');
    var myself = backlogCall_(c, 'get', '/api/v2/users/myself');
    var type = types.filter(function (t) { return t.name === 'タスク'; })[0] || types[0];
    var priority = priorities.filter(function (p) { return p.name === '中'; })[0] || priorities.filter(function (p) { return p.id === 3; })[0] || priorities[0];
    if (!type || !priority) return { ctx: null, reason: 'Backlog の種別か優先度が見つかりません' };
    return {
      ctx: {
        c: c, projectId: project.id, projectKey: project.projectKey,
        users: users.map(function (u) { return { id: u.id, name: u.name }; }),
        issueTypeId: type.id, priorityId: priority.id, myself: { id: myself.id, name: myself.name }
      },
      reason: ''
    };
  } catch (e) {
    return { ctx: null, reason: 'Backlog につながりません：' + maskSecrets_(e.message, [key]) };
  }
}

function backlogIssueUrl_(ctx, key) {
  return 'https://' + ctx.c.space + '/view/' + key;
}

function backlogSearch_(ctx, keyword, count) {
  var list = backlogCall_(ctx.c, 'get', '/api/v2/issues', { 'projectId[]': ctx.projectId, keyword: keyword, count: count || 10, sort: 'updated' });
  return list.map(function (i) {
    return { key: i.issueKey, summary: i.summary, status: i.status && i.status.name, description: i.description || '' };
  });
}

/** 前回の TODO の課題（説明に「開催日: {前回の開催日}」を含むもの） */
function backlogPrevIssues_(ctx, meetingName, prevDate) {
  return backlogSearch_(ctx, meetingName, 20).filter(function (i) {
    return i.description.indexOf('開催日: ' + prevDate) >= 0;
  });
}

/**
 * 同じ会議メモから登録された課題（説明の「元メモ: …」にこの会議メモの ID を含むもの）。
 * ほかの参加者が同じ会議でこのツール（か Claude 版）を使ったときに見つかる。
 */
function backlogMemoIssues_(ctx, meetingName, docId) {
  if (!docId) return [];
  var byKey = {};
  [meetingName, docId].forEach(function (k) {
    if (!k) return;
    try {
      backlogSearch_(ctx, k, 100).forEach(function (i) { if (i.description.indexOf(docId) >= 0) byKey[i.key] = i; });
    } catch (e) { /* 探せなくても先に進む（確認画面と承認の直前にもう一度探す） */ }
  });
  return Object.keys(byKey).map(function (k) { return byKey[k]; });
}

function backlogCreateIssue_(ctx, o) {
  var form = {
    projectId: ctx.projectId, summary: o.summary, issueTypeId: ctx.issueTypeId, priorityId: ctx.priorityId, description: o.description
  };
  if (o.assigneeId) form.assigneeId = o.assigneeId;
  if (o.dueDate) form.dueDate = o.dueDate;
  var issue = backlogCall_(ctx.c, 'post', '/api/v2/issues', {}, form);
  return { key: issue.issueKey, url: backlogIssueUrl_(ctx, issue.issueKey) };
}
