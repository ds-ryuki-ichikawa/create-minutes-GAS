/**
 * 議事録づくり（Apps Script 版）— Google のサービスを使わない計算だけを集めたファイル。
 * パソコンのテスト（gas/test/run.mjs）からも読み込むので、ここでは SpreadsheetApp などを使わない。
 */

var APP_NAME = 'meeting-tasks Apps Script 版';
var APP_VERSION = '0.1.0（開発中）';
var JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ---------- ID・URL ----------

/** Google ドキュメントの URL か ID から ID を取り出す。取り出せなければ空文字 */
function parseDocId_(input) {
  var s = String(input || '').trim();
  var m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

/** Google ドライブのフォルダの URL か ID から ID を取り出す。取り出せなければ空文字 */
function parseFolderId_(input) {
  var s = String(input || '').trim();
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : '';
}

function docUrl_(id) {
  return id ? 'https://docs.google.com/document/d/' + id + '/edit' : '';
}

// ---------- 会議名とファイル名 ----------

/** タイトル末尾の「 - Gemini によるメモ」を外す */
function stripMemoSuffix_(title) {
  return String(title || '').replace(/\s*[-－]\s*Gemini\s*によるメモ\s*$/, '').trim();
}

/**
 * ファイル名に使う会議名（SKILL.md の Step 9 と同じ作り方）。
 * 例: 「MTG - 2026/10/02 14:29 JST - Gemini によるメモ」→「MTG」
 */
function sanitizeTitle_(title) {
  var t = stripMemoSuffix_(title);
  t = t.replace(/\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?/g, ' ')
    .replace(/(^|[^\d])\d{8}(?!\d)/g, '$1 ')
    .replace(/\d{1,2}\/\d{1,2}/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    .replace(/\b(JST|UTC|GMT([+\-]\d{1,2}(:?\d{2})?)?)\b/gi, ' ');
  // 空白・記号をアンダースコアに（長音「ー」は言葉の一部なので残す）
  t = t.replace(/[\s　!-\/:-@\[-`{-~、。，．・「」『』（）【】［］｛｝〈〉《》〔〕：；！？＝＋－―／＼＆＃％＄＠＊“”‘’〜～]+/g, '_');
  t = t.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return t || '会議';
}

/** タイトルに日付があれば YYYY-MM-DD で返す。なければ空文字 */
function meetingDateFromTitle_(title) {
  var s = String(title || '');
  var m = s.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!m) {
    var m8 = s.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m8) m = m8;
  }
  if (!m) return '';
  var ymd = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  return isYmd_(ymd) ? ymd : '';
}

/** タイトルに時刻があれば HH:mm で返す */
function meetingTimeFromTitle_(title) {
  var m = String(title || '').match(/(\d{1,2}):(\d{2})/);
  return m ? pad2_(m[1]) + ':' + m[2] : '';
}

/** 同じ名前のファイルがあれば _2、_3 … を付けて空いている名前にする */
function nextFreeName_(base, existingNames) {
  var used = {};
  (existingNames || []).forEach(function (n) { used[n] = true; });
  if (!used[base]) return base;
  for (var i = 2; ; i++) {
    if (!used[base + '_' + i]) return base + '_' + i;
  }
}

/**
 * 保存先フォルダのファイルから、前回の議事録を選ぶ。
 * {YYYY-MM-DD}_{会議名}（_2 などが付いたものも含む）のうち、今回の会議日より前で最も新しいもの。
 */
function findPrevMinutes_(files, sanitized, meetingDate) {
  var re = new RegExp('^(\\d{4}-\\d{2}-\\d{2})_' + escapeRegExp_(sanitized) + '(?:_(\\d+))?$');
  var best = null;
  (files || []).forEach(function (f) {
    var m = String(f.name || '').match(re);
    if (!m || m[1] >= meetingDate) return;
    var n = m[2] ? Number(m[2]) : 1;
    if (!best || m[1] > best.date || (m[1] === best.date && n > best.n)) {
      best = { file: f, date: m[1], n: n };
    }
  });
  return best ? { file: best.file, date: best.date } : null;
}

function escapeRegExp_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- 日付 ----------

function pad2_(n) {
  return ('0' + Number(n)).slice(-2);
}

/** 日時を日本時間の YYYY-MM-DD にする */
function jstYmd_(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日時を日本時間の YYYY-MM-DD HH:mm にする */
function jstDateTime_(date) {
  var iso = new Date(date.getTime() + JST_OFFSET_MS).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

function isYmd_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDaysYmd_(ymd, days) {
  var d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 期限を YYYY-MM-DD にそろえる。「未定」やわからないものは空文字 */
function normalizeDue_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return jstYmd_(v);
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (!m) return '';
  var ymd = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  return isYmd_(ymd) ? ymd : '';
}

// ---------- TODO ----------

function normalizeCategory_(v) {
  var s = String(v || '').trim();
  if (s.indexOf('社内') >= 0) return '社内';
  if (s.indexOf('社外') >= 0) return '社外';
  return '不明';
}

/** 名前の照合用。空白と敬称を外す */
function normalizeName_(s) {
  return String(s || '').replace(/[\s　]+/g, '').replace(/(さん|様|さま|くん|君|氏|殿)$/, '');
}

function isUndecidedName_(who) {
  var w = normalizeName_(who);
  return !w || w === '未定' || w === '不明';
}

/**
 * TODO の担当者を Backlog のプロジェクトユーザーと照合する。
 * 1 人に一致したらその人。名字だけで複数人に一致したときや、見つからないときは user が null。
 */
function matchAssignee_(who, users) {
  if (isUndecidedName_(who)) return { user: null, reason: '未定' };
  var w = normalizeName_(who);
  var list = users || [];
  var exact = list.filter(function (u) { return normalizeName_(u.name) === w; });
  if (exact.length === 1) return { user: exact[0], reason: '' };
  if (exact.length > 1) return { user: null, reason: '複数' };
  var prefix = list.filter(function (u) { return normalizeName_(u.name).indexOf(w) === 0; });
  if (prefix.length === 1) return { user: prefix[0], reason: '' };
  return { user: null, reason: prefix.length > 1 ? '複数' : '見つからない' };
}

/** 「（前回から継続）」が付いた TODO か */
function isContinued_(what) {
  return /（前回から継続）\s*$/.test(String(what || ''));
}

function stripContinued_(what) {
  return String(what || '').replace(/\s*（前回から継続）\s*$/, '');
}

/** 2 つの文の似ている度合い（2 文字ずつの重なり。0〜1） */
function similarity_(a, b) {
  var A = bigrams_(a), B = bigrams_(b);
  if (!A.length || !B.length) return 0;
  var inB = {};
  B.forEach(function (x) { inB[x] = true; });
  var common = A.filter(function (x) { return inB[x]; }).length;
  return common / Math.min(A.length, B.length);
}

function bigrams_(s) {
  var t = String(s || '').replace(/[\s　、。，．・「」『』（）()\[\]【】,.:：;；!?！？\-－_]/g, '');
  var set = {};
  for (var i = 0; i < t.length - 1; i++) set[t.substr(i, 2)] = true;
  return Object.keys(set);
}

/** 似た課題とみなす境目 */
var SIMILAR_THRESHOLD = 0.3;

/** 前回から継続の TODO に当たる、前回の課題を選ぶ */
function pickContinuedIssue_(what, prevIssues) {
  var base = stripContinued_(what);
  var best = null, bestScore = 0;
  (prevIssues || []).forEach(function (i) {
    var score = similarity_(base, i.summary);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return bestScore >= 0.5 ? best : null;
}

// ---------- TODO の重複 ----------

/** 同じ会議の中で同じ作業とみなす境目（2 文字ずつの重なり） */
var DUP_WITHIN_THRESHOLD = 0.6;
/** ほかの会議の TODO と同じ作業とみなす境目 */
var DUP_OTHER_THRESHOLD = 0.5;

/** items のうち what に最も似たもの。境目に届かなければ null */
function bestSimilar_(what, items, textOf, threshold) {
  var best = null, bestScore = 0;
  (items || []).forEach(function (it) {
    var score = similarity_(what, textOf(it));
    if (score > bestScore) { best = it; bestScore = score; }
  });
  return bestScore >= threshold ? best : null;
}

function issueLabel_(i) {
  return i.key + '「' + i.summary + '」（' + (i.status || '状態不明') + '）';
}

/**
 * TODO の重複を探す。次の 4 つを調べる。
 * 1. 同じ会議メモから、すでに Backlog に登録された課題（ほかの参加者が同じ会議で使った）… memoIssues
 * 2. 承認待ち・最近の、ほかの会議の TODO … otherRows
 * 3. Backlog の似た課題（TODO の「探す語句」で検索した結果） … foundByKeyword
 * 4. 同じ会議の中の TODO どうし
 * todos: [{ what, keyword }]（並び順 = No）
 * o: { memoIssues, foundByKeyword: { 語句: [課題] }, otherRows: [{ what, label, no }], ignoreKeys: [自分で登録した課題キー] }
 * 戻り値: TODO ごとに { within: 似ている前の行の位置 か -1, memoIssue, similarIssue, otherRow }
 */
function findDuplicates_(todos, o) {
  var ignore = {};
  (o.ignoreKeys || []).forEach(function (k) { if (k) ignore[k] = true; });
  var memo = (o.memoIssues || []).filter(function (i) { return !ignore[i.key]; });
  var memoKeys = {};
  memo.forEach(function (i) { memoKeys[i.key] = true; });
  var whats = todos.map(function (t) { return stripContinued_(t.what); });
  return todos.map(function (t, j) {
    var w = whats[j];
    var within = -1;
    for (var i = 0; i < j; i++) {
      if (similarity_(w, whats[i]) >= DUP_WITHIN_THRESHOLD) { within = i; break; }
    }
    var memoIssue = bestSimilar_(w, memo, function (x) { return x.summary; }, SIMILAR_THRESHOLD);
    var candidates = ((o.foundByKeyword || {})[t.keyword] || []).filter(function (x) { return !ignore[x.key] && !memoKeys[x.key]; });
    var similarIssue = memoIssue ? null : bestSimilar_(w, candidates, function (x) { return x.summary; }, SIMILAR_THRESHOLD);
    var otherRow = bestSimilar_(w, o.otherRows || [], function (r) { return stripContinued_(r.what); }, DUP_OTHER_THRESHOLD);
    return { within: within, memoIssue: memoIssue, similarIssue: similarIssue, otherRow: otherRow };
  });
}

/** 重複の注意の文。forBacklog が false のとき（Backlog に入れない TODO）は、Backlog の似た課題とほかの会議は出さない */
function dupNotes_(d, forBacklog) {
  var notes = [];
  if (d.within >= 0) notes.push('⚠ この会議の ' + (d.within + 1) + ' 番と似ている（同じ作業なら、どちらかの ☑ を外す）');
  if (d.memoIssue) notes.push('⚠ この会議の課題として、すでに Backlog にある：' + issueLabel_(d.memoIssue) + '。ほかの参加者が登録した可能性があり、登録すると重複する');
  if (forBacklog && d.similarIssue) notes.push('⚠ 似た課題あり：' + issueLabel_(d.similarIssue) + '。登録すると重複するおそれ');
  if (forBacklog && d.otherRow) notes.push('⚠ 別の会議（' + d.otherRow.label + ' の ' + d.otherRow.no + ' 番）の TODO と似ている');
  return notes;
}

/** 下書きを作るときの、登録先の初期値（SKILL.md の Step 7 と同じ考え方） */
function defaultFlags_(t, today) {
  var internal = t.category === '社内';
  var backlog = internal && !t.prevIssue;
  var calendar = backlog && !!t.due && t.due >= today;
  return { backlog: backlog, calendar: calendar };
}

/**
 * シートの 1 行（TODO）を、承認したときに何をするかに直す。確認画面と承認の両方で使う。
 * t: { category, who, what, due, backlog, calendar, prevIssue, backlogKey, calendarDone }
 * ctx: { today, backlogReady }
 */
function planTodo_(t, ctx) {
  var due = normalizeDue_(t.due);
  var notes = [];
  var wantBacklog = !!t.backlog && !t.backlogKey;
  var wantCalendar = !!t.calendar && !t.calendarDone;

  if (wantCalendar && !due) {
    wantCalendar = false;
    notes.push('⚠ 期限がないため、カレンダーには入れられません');
  }
  if (wantCalendar && due < ctx.today) notes.push('⚠ 期限が過ぎています（それでもカレンダーに入れます）');
  if (wantBacklog && t.category === '社外') notes.push('⚠ 社外の作業を Backlog に登録します');

  var manualBacklog = wantBacklog && !ctx.backlogReady;
  var doBacklog = wantBacklog && !manualBacklog;
  var doCalendar = wantCalendar;

  var parts = [];
  if (t.backlogKey) parts.push('Backlog 登録済み：' + t.backlogKey);
  if (t.calendarDone) parts.push('カレンダー登録済み');

  var label;
  if (manualBacklog) {
    label = 'Backlog に手で登録（Backlog が未設定）' + (doCalendar ? '・カレンダー' : '');
  } else if (doBacklog && doCalendar) {
    label = 'Backlog・カレンダー';
  } else if (doBacklog) {
    label = due ? 'Backlog だけ' : 'Backlog だけ（期限がないためカレンダーには入れない）';
  } else if (doCalendar) {
    label = 'カレンダーだけ';
  } else if (parts.length) {
    label = parts.join('・');
  } else if (t.prevIssue) {
    label = '前回の課題を継続：' + t.prevIssue;
  } else if (t.category === '社外') {
    label = '登録しない（社外の作業）';
  } else if (t.category === '不明') {
    label = '⚠ 区分が不明（社内の作業なら Backlog に ☑ を付けてください）';
  } else {
    label = '登録しない';
  }
  if (parts.length && (doBacklog || doCalendar || manualBacklog)) label = parts.join('・') + '／' + label;

  var lead = isUndecidedName_(t.who) || !due || t.category === '不明';
  return { doBacklog: doBacklog, doCalendar: doCalendar, manualBacklog: manualBacklog, label: label, notes: notes, lead: lead, due: due };
}

// ---------- メールアドレス・共有の範囲 ----------

function emailDomain_(email) {
  var m = String(email || '').trim().toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : '';
}

/** 「社内のドメイン」の設定（カンマ・空白区切り）を配列にする */
function parseDomains_(s) {
  return String(s || '').split(/[\s,、，]+/)
    .map(function (d) { return d.trim().toLowerCase().replace(/^@/, ''); })
    .filter(Boolean);
}

function isAllowedEmail_(email, domains) {
  var d = emailDomain_(email);
  return !!d && (domains || []).indexOf(d) >= 0;
}

/** 招待するメールの欄（カンマ・空白・改行区切り）を配列にする */
function parseEmails_(s) {
  return String(s || '').split(/[\s,、，;；]+/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
}

/**
 * フォルダの共有の範囲を確かめる。社外のアドレス・ドメインや、リンクを知っている全員に開かれていたら問題にする。
 * perms は Drive API の permissions（type・emailAddress・domain）。
 */
function checkSharing_(perms, domains) {
  var problems = [];
  var people = 0, wide = [];
  if (!domains || !domains.length) problems.push('設定シートの「社内のドメイン」が空です');
  (perms || []).forEach(function (p) {
    if (p.deleted) return;
    if (p.type === 'anyone') {
      problems.push('リンクを知っている全員（または一般公開）に共有されています');
    } else if (p.type === 'domain') {
      if ((domains || []).indexOf(String(p.domain || '').toLowerCase()) < 0) problems.push('社外のドメイン ' + p.domain + ' に共有されています');
      else wide.push(p.domain);
    } else if (p.type === 'user' || p.type === 'group') {
      if (!p.emailAddress) problems.push('アドレスのわからない相手に共有されています');
      else if (!isAllowedEmail_(p.emailAddress, domains)) problems.push('社外のアドレス ' + p.emailAddress + ' に共有されています');
      else people++;
    }
  });
  var summary = '社内の ' + people + ' 人・グループ' + (wide.length ? '、' + wide.join('・') + ' の全員' : '') + (problems.length ? '' : '（社外なし）');
  return { ok: problems.length === 0, problems: problems, summary: summary };
}

// ---------- 秘密の情報を表示に出さない ----------

function maskSecrets_(text, secrets) {
  var s = String(text || '').replace(/(apiKey|key|access_token)=([^&\s"']+)/gi, '$1=***');
  (secrets || []).forEach(function (k) {
    if (k && k.length >= 8) s = s.split(k).join('***');
  });
  return s;
}

// ---------- Google ドキュメントの中身を文字にする ----------

/** Docs API の documents.get（includeTabsContent=true）の結果を、タブごとの文字にする */
function docsToText_(doc) {
  var out = [];
  function paragraphText(p) {
    return (p.elements || []).map(function (e) { return e.textRun ? e.textRun.content : ''; }).join('').replace(/\n$/, '');
  }
  function contentText(content) {
    var lines = [];
    (content || []).forEach(function (el) {
      if (el.paragraph) {
        lines.push(paragraphText(el.paragraph));
      } else if (el.table) {
        (el.table.tableRows || []).forEach(function (row) {
          var cells = (row.tableCells || []).map(function (c) { return contentText(c.content).join(' ').trim(); });
          lines.push('| ' + cells.join(' | ') + ' |');
        });
      }
    });
    return lines;
  }
  function walkTabs(tabs) {
    (tabs || []).forEach(function (tab) {
      var title = tab.tabProperties && tab.tabProperties.title;
      out.push('# ' + (title || 'タブ'));
      var body = tab.documentTab && tab.documentTab.body;
      out = out.concat(contentText(body && body.content));
      out.push('');
      walkTabs(tab.childTabs);
    });
  }
  if (doc.tabs && doc.tabs.length) walkTabs(doc.tabs);
  else out = contentText(doc.body && doc.body.content);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- 使った記録の集計（scripts/meeting-log.mjs と同じ計算） ----------

function summarizeLog_(records, manualMinutes, perTodo) {
  var round1 = function (n) { return Math.round(n * 10) / 10; };
  var runs = records.filter(function (r) { return r.result === '承認'; });
  var cancelled = records.filter(function (r) { return r.result === 'やめた'; }).length;
  if (!runs.length) return ['集計できる記録がありません。本番で承認した回だけを集計します。'];
  var minutes = runs.map(function (r) { return Number(r.confirmMinutes); })
    .filter(function (n, i) { return runs[i].confirmMinutes !== '' && isFinite(n); });
  var sum = function (key) { return runs.reduce(function (a, r) { return a + Number(r[key] || 0); }, 0); };
  var dates = runs.map(function (r) { return r.meetingDate; }).filter(Boolean).sort();
  var todos = sum('todos'), backlog = sum('backlogRegistered');
  var flagged = sum('similarFlagged'), stopped = sum('similarStopped');
  var lines = [];
  lines.push('■ 集計');
  lines.push('・対象：本番で承認した ' + runs.length + ' 回（会議日 ' + (dates[0] || '不明') + '〜' + (dates[dates.length - 1] || '不明') + '）。途中でやめた回は ' + cancelled + ' 回');
  if (minutes.length) {
    var mean = minutes.reduce(function (a, b) { return a + b; }, 0) / minutes.length;
    var sorted = minutes.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    lines.push('・確認・承認の時間：平均 ' + round1(mean) + ' 分、中央値 ' + round1(median) + ' 分（最短 ' + sorted[0] + ' 分・最長 ' + sorted[sorted.length - 1] + ' 分）');
  }
  lines.push('・TODO：' + todos + ' 件（1 回平均 ' + round1(todos / runs.length) + ' 件）。Backlog に登録したのは ' + backlog + ' 件（1 回平均 ' + round1(backlog / runs.length) + ' 件）');
  lines.push('・「似た課題あり」：' + flagged + ' 件。そのうち登録をやめたのは ' + stopped + ' 件');
  lines.push('・修正：確認画面を開き直した回数は 1 回平均 ' + round1(sum('edits') / runs.length) + ' 回');
  if (!minutes.length) return lines;
  var toolMinutes = round1(minutes.reduce(function (a, b) { return a + b; }, 0) / minutes.length);
  var perRunBacklog = round1(backlog / runs.length);
  var manual = round1(manualMinutes + perTodo * perRunBacklog);
  var ratio = manual > 0 ? Math.round(((manual - toolMinutes) / manual) * 10) : 0;
  lines.push('');
  lines.push('■ Backlog の「試算」に貼る文');
  lines.push('・試算（実際に使った ' + runs.length + ' 回の記録から）');
  lines.push('　- このツール：確認と承認に平均 ' + toolMinutes + ' 分（実測。下書きを開いてから承認するまで）');
  lines.push('　- いまのやり方：清書に ' + manualMinutes + ' 分、Backlog への登録に 1 件 ' + perTodo + ' 分かかるとすると、' + manualMinutes + ' ＋ ' + perTodo + ' × ' + perRunBacklog + ' ＝ 約 ' + manual + ' 分（この 2 つは仮に置いた値で、実際に測ってはいない）');
  lines.push('　- 差：1 回あたり約 ' + round1(manual - toolMinutes) + ' 分' + (ratio > 0 ? '（約 ' + ratio + ' 割減）' : ''));
  lines.push('　- 「似た課題あり」で登録をやめた TODO：' + stopped + ' 件（' + flagged + ' 件のうち。二重登録を防いだ数）');
  return lines;
}
