/**
 * 議事録の Markdown を組み立てる・書き直す（Google のサービスを使わない）。
 *
 * 下書きの形:
 *   ## 確認用のメモ（承認すると消えます）  … 非公開情報・要確認事項
 *   ---
 *   # {会議名} 議事録                       … ここから下が議事録の本文
 *
 * 承認すると、Google ドキュメントから Markdown で書き出した下書きを finalizeMarkdown_ で確定版にする。
 */

var CHECK_MEMO_HEADING = '確認用のメモ（承認すると消えます）';
var TODO_DRAFT_NOTE = '（下書きのあいだ、この表は表示用です。直すときは管理シートの「TODO」で直してください）';

function splitLines_(md) {
  return String(md || '').replace(/\r\n?/g, '\n').split('\n');
}

/** Markdown の飾り（太字・エスケープ・見出しの ID）を外した文字 */
function cleanMd_(s) {
  return String(s || '')
    .replace(/\{#[^}]*\}\s*$/, '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, '$1')
    .replace(/\*\*|__/g, '')
    .trim();
}

function parseHeading_(line) {
  var m = String(line).match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
  return m ? { level: m[1].length, text: cleanMd_(m[2]) } : null;
}

function isRule_(line) {
  return /^\s*([-*_])(\s*\1){2,}\s*$/.test(String(line));
}

function listItemText_(line) {
  var m = String(line).match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
  return m ? cleanMd_(m[1]) : null;
}

/** 議事録のタイトルの行（# {会議名} 議事録）の位置。なければ -1 */
function findTitleLine_(lines, expectedTitle) {
  var want = cleanMd_(expectedTitle);
  for (var i = 0; i < lines.length; i++) {
    var h = parseHeading_(lines[i]);
    if (h && h.text === want) return i;
  }
  for (var j = 0; j < lines.length; j++) {
    var h1 = parseHeading_(lines[j]);
    if (h1 && h1.level === 1 && h1.text !== cleanMd_(CHECK_MEMO_HEADING)) return j;
  }
  return -1;
}

/** 見出し（title）のセクションの範囲。見出しの行 start と、次の同じか上の見出しの行 end */
function findSection_(lines, title) {
  for (var i = 0; i < lines.length; i++) {
    var h = parseHeading_(lines[i]);
    if (!h || h.text !== title) continue;
    var end = lines.length;
    for (var j = i + 1; j < lines.length; j++) {
      var h2 = parseHeading_(lines[j]);
      if ((h2 && h2.level <= h.level) || isRule_(lines[j])) { end = j; break; }
    }
    return { start: i, end: end, level: h.level };
  }
  return null;
}

/** セクションの中身を差し替える。セクションがなければ最後に足す */
function replaceSection_(lines, title, bodyLines) {
  var sec = findSection_(lines, title);
  if (!sec) return trimBlankEnd_(lines).concat(['', '## ' + title, ''], bodyLines, ['']);
  return lines.slice(0, sec.start + 1).concat([''], bodyLines, ['']).concat(lines.slice(sec.end));
}

function sectionBody_(lines, title) {
  var sec = findSection_(lines, title);
  return sec ? lines.slice(sec.start + 1, sec.end) : [];
}

function trimBlankEnd_(lines) {
  var out = lines.slice();
  while (out.length && !String(out[out.length - 1]).trim()) out.pop();
  return out;
}

/** 見出しに word を含むセクションの箇条書きを取り出す（「なし」は除く） */
function listUnderHeading_(lines, word) {
  var items = [], on = false;
  lines.forEach(function (l) {
    var h = parseHeading_(l);
    if (h) { on = h.text.indexOf(word) >= 0; return; }
    if (isRule_(l)) { on = false; return; }
    if (!on) return;
    var t = listItemText_(l);
    if (t && t !== 'なし') items.push(t);
  });
  return items;
}

function escapeCell_(s) {
  return String(s || '').replace(/\|/g, '｜').replace(/\r?\n/g, ' ').trim();
}

/** TODO の表（議事録の「TODO」セクションの中身） */
function buildTodoTableMd_(todos) {
  if (!todos || !todos.length) return 'なし';
  var rows = ['| 誰が | 何を | いつまで | 区分 |', '|------|------|----------|------|'];
  todos.forEach(function (t) {
    rows.push('| ' + [escapeCell_(t.who) || '未定', escapeCell_(t.what), normalizeDue_(t.due) || '未定', escapeCell_(t.category)].join(' | ') + ' |');
  });
  return rows.join('\n');
}

function bulletList_(items) {
  return (items && items.length ? items : ['なし']).map(function (t) { return '- ' + String(t).replace(/\r?\n/g, ' '); });
}

/**
 * 下書きの Markdown を作る。
 * o: { title, createdDate, minutesMd, todos, privateInfo, toConfirm, sample }
 */
function buildDraftMarkdown_(o) {
  var out = ['## ' + CHECK_MEMO_HEADING, ''];
  if (o.sample) out.push('これはお試し用の架空の会議メモから作った下書きです。', '');
  out.push('議事録には載りません。解決した項目は、その行を消してください。残った要確認事項は、承認すると「決まっていないこと」に入ります。TODO の担当者・期限・登録先は、管理シートの「TODO」で直してください。', '');
  out.push('### 非公開情報', '');
  out = out.concat(bulletList_(o.privateInfo));
  out.push('', '### 要確認事項', '');
  out = out.concat(bulletList_(o.toConfirm));
  out.push('', '---', '');
  out.push('# ' + o.title + ' 議事録', '', '**作成日**: ' + o.createdDate, '');

  var body = splitLines_(o.minutesMd);
  // AI がタイトル行を書いてしまった場合は外す（タイトルはこちらで付ける）
  var firstText = body.findIndex(function (l) { return String(l).trim(); });
  if (firstText >= 0) {
    var h = parseHeading_(body[firstText]);
    if (h && h.level === 1) body.splice(firstText, 1);
  }
  body = replaceSection_(body, 'TODO', [TODO_DRAFT_NOTE, ''].concat(splitLines_(buildTodoTableMd_(o.todos))));
  return trimBlankEnd_(out.concat(body)).join('\n') + '\n';
}

/** 下書きから、確認用のメモ（非公開情報・要確認事項）と「前回からの変更」を読み取る */
function readDraftNotes_(md, title) {
  var lines = splitLines_(md);
  var t = findTitleLine_(lines, title + ' 議事録');
  var head = t < 0 ? lines : lines.slice(0, t);
  var body = t < 0 ? [] : lines.slice(t);
  var prev = sectionBody_(body, '前回からの変更').map(cleanMd_).filter(Boolean);
  return {
    privateInfo: listUnderHeading_(head, '非公開情報'),
    toConfirm: listUnderHeading_(head, '要確認事項'),
    prevChanges: prev,
    hasTitle: t >= 0
  };
}

/**
 * 下書きを確定版にする。
 * - 確認用のメモを外す（残った要確認事項は「決まっていないこと」に入れる）
 * - TODO の表を、管理シートの内容で書き直す
 * - 最後に承認の行を足す
 * o: { title, todos, approvalLine }
 */
function finalizeMarkdown_(draftMd, o) {
  var lines = splitLines_(draftMd);
  var t = findTitleLine_(lines, o.title + ' 議事録');
  if (t < 0) throw new Error('下書きにタイトルの行（「' + o.title + ' 議事録」）が見つかりません。タイトルの行は消さないでください');
  var unresolved = listUnderHeading_(lines.slice(0, t), '要確認事項');
  var body = lines.slice(t);
  body = replaceSection_(body, 'TODO', splitLines_(buildTodoTableMd_(o.todos)));
  if (unresolved.length) body = addUndecided_(body, unresolved);
  var md = trimBlankEnd_(body).join('\n') + '\n\n---\n\n' + o.approvalLine + '\n';
  return { md: md, unresolved: unresolved };
}

/** 残った要確認事項を「決まっていないこと」に足す（「なし」だけなら置き換える） */
function addUndecided_(lines, items) {
  var title = '決まっていないこと';
  var adds = items.map(function (t) { return '- ' + (/（要確認）$/.test(t) ? t : t + '（要確認）'); });
  var sec = findSection_(lines, title);
  if (!sec) return replaceSection_(lines, title, adds);
  var body = lines.slice(sec.start + 1, sec.end);
  var texts = body.map(function (l) { var x = listItemText_(l); return x === null ? cleanMd_(l) : x; }).filter(Boolean);
  var onlyNone = texts.every(function (x) { return x === 'なし'; });
  var newBody = onlyNone ? adds : trimBlankEnd_(body).concat(adds);
  while (newBody.length && !String(newBody[0]).trim()) newBody.shift();
  return lines.slice(0, sec.start + 1).concat([''], newBody, ['']).concat(lines.slice(sec.end));
}

/** 確定版の最後に入れる、承認の行 */
function buildApprovalLine_(o) {
  var src = o.sourceUrl ? '[元メモ](' + o.sourceUrl + ')' : '元メモ：お試し用のサンプル';
  return '*AI（Gemini）が下書きし、' + o.approver + ' が ' + o.at + ' に確認・承認しました。' + src + '｜' + APP_NAME + ' ' + APP_VERSION + '*';
}
