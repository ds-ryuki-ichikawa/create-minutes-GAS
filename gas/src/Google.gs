/**
 * Google ドライブ・ドキュメント・カレンダーを、本人のログイン（OAuth）で呼ぶ。
 *
 * 権限を絞るため、DriveApp・DocumentApp・CalendarApp は使わない（これらはドライブ全体・カレンダー全体の権限を求める）。
 * 代わりに appsscript.json に書いた権限だけで REST API を呼ぶ:
 *   - 会議メモ・前回の議事録は読むだけ（drive.readonly・documents.readonly）
 *   - 書き込みは、このツールが作ったファイル・フォルダだけ（drive.file）
 *   - カレンダーは予定だけ（calendar.events）
 */

var DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
var DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
var DOCS_API = 'https://docs.googleapis.com/v1/documents/';
var CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
var DOC_MIME = 'application/vnd.google-apps.document';
var FOLDER_MIME = 'application/vnd.google-apps.folder';

// ---------- 通信（やり直しつき） ----------

/**
 * 一時的なエラー（429・5xx・つながらない）のときは、時間をおいて数回やり直す。
 * retryOn5xx を false にすると、5xx ではやり直さない（登録の二重実行を防ぐため）。
 */
function fetchWithRetry_(url, params, label, retryOn5xx, waitList) {
  var waits = waitList || [2000, 5000, 10000];
  params.muteHttpExceptions = true;
  for (var i = 0; ; i++) {
    var res;
    try {
      res = UrlFetchApp.fetch(url, params);
    } catch (e) {
      if (i < waits.length && retryOn5xx !== false) { Utilities.sleep(waits[i]); continue; }
      throw new Error(label + ' につながりませんでした：' + maskSecrets_(e.message, allSecrets_()));
    }
    var code = res.getResponseCode();
    var retry = code === 429 || (code >= 500 && retryOn5xx !== false);
    if (retry && i < waits.length) { Utilities.sleep(waits[i]); continue; }
    return res;
  }
}

function errorDetail_(res) {
  var text = res.getContentText();
  try {
    var j = JSON.parse(text);
    var msg = (j.error && (j.error.message || j.error.status)) || (j.errors && j.errors[0] && j.errors[0].message) || text;
    return maskSecrets_(String(msg).slice(0, 300), allSecrets_());
  } catch (e) {
    return maskSecrets_(text.slice(0, 300), allSecrets_());
  }
}

/** Google の API を呼んで JSON を返す */
function gApi_(method, url, opts) {
  opts = opts || {};
  var params = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (opts.json !== undefined) { params.contentType = 'application/json'; params.payload = JSON.stringify(opts.json); }
  if (opts.payload !== undefined) { params.payload = opts.payload; params.contentType = opts.contentType; }
  var label = opts.label || 'Google';
  var res = fetchWithRetry_(url, params, label, opts.retryOn5xx);
  var code = res.getResponseCode();
  if (code >= 300) {
    var err = new Error(label + ' でエラーになりました（' + code + '）：' + errorDetail_(res));
    err.code = code;
    throw err;
  }
  if (opts.raw) return res;
  var text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

function qs_(params) {
  return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
}

/** Drive の検索で使う文字列のエスケープ */
function qEscape_(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------- ドライブ ----------

/** ドライブを検索する（共有ドライブ・共有されたファイルも含む。最後のページまで取る） */
function driveSearch_(q, orderBy) {
  var files = [], token = '';
  do {
    var url = DRIVE_API + '?' + qs_({
      q: q, pageSize: 100, pageToken: token, orderBy: orderBy || '',
      fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,webViewLink)',
      corpora: 'allDrives', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true'
    });
    var j = gApi_('get', url, { label: 'Google ドライブ' });
    files = files.concat(j.files || []);
    token = j.nextPageToken || '';
  } while (token);
  return files;
}

function driveGetFile_(id, fields) {
  return gApi_('get', DRIVE_API + '/' + encodeURIComponent(id) + '?' + qs_({ fields: fields || 'id,name,webViewLink,trashed', supportsAllDrives: 'true' }), { label: 'Google ドライブ' });
}

function driveCreateFolder_(name, parentId) {
  var meta = { name: name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  return gApi_('post', DRIVE_API + '?' + qs_({ fields: 'id,name,webViewLink', supportsAllDrives: 'true' }), { json: meta, label: 'Google ドライブ' });
}

/** Markdown から Google ドキュメントを作る（ドライブが Google ドキュメントに変換する） */
function driveCreateDocFromMarkdown_(name, md, parentId) {
  var boundary = 'mt' + Utilities.getUuid().replace(/-/g, '');
  var meta = { name: name, mimeType: DOC_MIME, parents: [parentId] };
  var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + boundary + '\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n' + md +
    '\r\n--' + boundary + '--';
  var url = DRIVE_UPLOAD_API + '?' + qs_({ uploadType: 'multipart', supportsAllDrives: 'true', fields: 'id,name,webViewLink' });
  return gApi_('post', url, {
    payload: Utilities.newBlob(body).getBytes(), contentType: 'multipart/related; boundary=' + boundary,
    label: 'Google ドライブ', retryOn5xx: false
  });
}

/** Google ドキュメントを Markdown で書き出す */
function driveExportMarkdown_(id) {
  var res = gApi_('get', DRIVE_API + '/' + encodeURIComponent(id) + '/export?' + qs_({ mimeType: 'text/markdown' }), { raw: true, label: 'Google ドライブ' });
  return res.getContentText('UTF-8');
}

function driveTrash_(id) {
  return gApi_('patch', DRIVE_API + '/' + encodeURIComponent(id) + '?' + qs_({ supportsAllDrives: 'true' }), { json: { trashed: true }, label: 'Google ドライブ' });
}

function driveListPermissions_(id) {
  var url = DRIVE_API + '/' + encodeURIComponent(id) + '/permissions?' + qs_({
    supportsAllDrives: 'true', fields: 'permissions(type,role,emailAddress,domain,deleted)'
  });
  return gApi_('get', url, { label: 'Google ドライブ（共有の範囲）' }).permissions || [];
}

/** フォルダの中で、名前が base で始まる Google ドキュメントの名前の一覧 */
function driveNamesInFolder_(folderId, base) {
  var q = "'" + qEscape_(folderId) + "' in parents and trashed = false and mimeType = '" + DOC_MIME + "' and name contains '" + qEscape_(base) + "'";
  return driveSearch_(q).map(function (f) { return f.name; });
}

/** 保存先フォルダの共有の範囲を確かめる */
function checkFolderSharing_(s) {
  var folder = driveGetFile_(s.saveFolderId, 'id,name,webViewLink');
  var result = checkSharing_(driveListPermissions_(s.saveFolderId), s.domainList);
  result.folderName = folder.name;
  result.folderUrl = folder.webViewLink;
  return result;
}

// ---------- 会議メモを読む ----------

/** 会議メモ（Google ドキュメント）を、タブ（メモ・文字起こし）ごと文字で読む */
function readMemo_(docId) {
  var meta;
  try {
    meta = driveGetFile_(docId, 'id,name,createdTime,mimeType,trashed');
  } catch (e) {
    if (e.code === 404 || e.code === 403) throw new Error('会議メモを開けませんでした。自分のアカウントで開けるか、主催者に共有してもらっているかを確かめてください');
    throw e;
  }
  if (meta.mimeType !== DOC_MIME) throw new Error('「' + meta.name + '」は Google ドキュメントではありません');
  var text;
  try {
    var doc = gApi_('get', DOCS_API + encodeURIComponent(docId) + '?' + qs_({ includeTabsContent: 'true' }), { label: 'Google ドキュメント' });
    text = docsToText_(doc);
  } catch (e) {
    // Docs API で読めないときは、ドライブの書き出しで読む
    text = gApi_('get', DRIVE_API + '/' + encodeURIComponent(docId) + '/export?' + qs_({ mimeType: 'text/plain' }), { raw: true, label: 'Google ドライブ' }).getContentText('UTF-8');
  }
  if (!String(text || '').trim()) throw new Error('会議メモの中身が空でした');
  return { title: meta.name, text: text, createdTime: meta.createdTime };
}

/** 最近の会議メモ（Gemini によるメモ）を探す。since は ISO 8601 の日時 */
function searchMemos_(since) {
  var q = "name contains 'Gemini によるメモ' and mimeType = '" + DOC_MIME + "' and trashed = false and createdTime > '" + since + "'";
  return driveSearch_(q, 'createdTime desc');
}

// ---------- カレンダー ----------

/** 期限日の終日予定のタイトル一覧（【期限】を含むもの） */
function calendarTitlesOn_(ymd) {
  var url = CALENDAR_API + '?' + qs_({
    timeMin: ymd + 'T00:00:00+09:00', timeMax: addDaysYmd_(ymd, 1) + 'T00:00:00+09:00',
    q: '【期限】', singleEvents: 'true', maxResults: 100, fields: 'items(summary)'
  });
  return (gApi_('get', url, { label: 'Google カレンダー' }).items || []).map(function (e) { return e.summary; });
}

/** 期限のリマインド（終日・非公開・空き時間のまま・前日 9:00 に通知）を作る */
function calendarCreateDeadline_(o) {
  var event = {
    summary: o.title,
    description: o.description,
    start: { date: o.date },
    end: { date: addDaysYmd_(o.date, 1) },
    transparency: 'transparent',
    visibility: 'private',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] }
  };
  if (o.attendees && o.attendees.length) event.attendees = o.attendees.map(function (e) { return { email: e }; });
  var url = CALENDAR_API + '?' + qs_({ sendUpdates: event.attendees ? 'all' : 'none' });
  return gApi_('post', url, { json: event, label: 'Google カレンダー', retryOn5xx: false });
}
