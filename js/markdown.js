/**
 * markdown.js — small, safe Markdown → HTML renderer.
 * SAFETY: every piece of text is HTML-escaped BEFORE formatting is applied, so AI output or
 * user edits can never inject HTML or scripts. Only http(s) links are allowed.
 * This exact file is also used by the backend as Markdown.gs (keep the two identical).
 */
function mdToHtml(md) {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inline(t) {
    t = esc(t);
    var codes = [];
    t = t.replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\u0001(\d+)\u0001/g, function (m, i) { return '<code>' + codes[+i] + '</code>'; });
    return t;
  }
  function isTableSep(l) {
    return l.indexOf('-') > -1 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  }
  function cells(l) {
    l = l.trim();
    if (l.charAt(0) === '|') l = l.slice(1);
    if (l.charAt(l.length - 1) === '|') l = l.slice(0, -1);
    return l.split('|').map(function (c) { return c.trim(); });
  }
  function listItem(l) { return /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l); }

  var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  var i = 0;

  function parseList(indent) {
    var first = listItem(lines[i]);
    var ordered = /\d/.test(first[2]);
    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>';
    var open = false;
    while (i < lines.length) {
      var m = listItem(lines[i]);
      if (!m) break;
      var ind = m[1].replace(/\t/g, '    ').length;
      if (ind < indent) break;
      if (ind > indent) {
        if (!open) { html += '<li>'; open = true; }
        html += parseList(ind);
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      if (open) html += '</li>';
      html += '<li>' + inline(m[3]);
      open = true;
      i++;
    }
    if (open) html += '</li>';
    return html + '</' + tag + '>';
  }

  function isBlockStart(l, next) {
    return /^\s*```/.test(l) || /^#{1,6}\s+/.test(l) || /^\s*>/.test(l) || !!listItem(l) ||
      /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l) || (l.indexOf('|') > -1 && next !== undefined && isTableSep(next));
  }

  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    var fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      var buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      var lang = (fence[1] || 'text').toLowerCase();
      out.push('<pre class="code lang-' + esc(lang) + (lang === 'diagram' ? ' diagram' : '') + '"><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      var lv = Math.min(6, Math.max(3, h[1].length + 1));
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line) && !listItem(line)) { out.push('<hr>'); i++; continue; }

    if (/^\s*>/.test(line)) {
      var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      var inner = q.join('\n');
      var cm = /^\s*\*\*\s*(Definition|Example|Real[- ]?life Example|Important|Note|Tip|Common Mistakes?|Mistake|Remember|Formula|Key Point|Warning)/i.exec(inner);
      var cls = 'callout';
      if (cm) {
        var kind = cm[1].toLowerCase();
        if (kind.indexOf('example') > -1) kind = 'example';
        else if (kind.indexOf('mistake') > -1 || kind === 'warning') kind = 'mistake';
        else if (kind === 'key point' || kind === 'remember' || kind === 'note' || kind === 'tip') kind = 'important';
        cls += ' callout-' + kind.replace(/\s+/g, '-');
      }
      out.push('<blockquote class="' + cls + '">' + mdToHtml(inner) + '</blockquote>');
      continue;
    }

    if (line.indexOf('|') > -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      var head = cells(line);
      i += 2;
      var rows = [];
      while (i < lines.length && lines[i].indexOf('|') > -1 && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      var t = '<div class="table-wrap"><table><thead><tr>';
      head.forEach(function (c) { t += '<th>' + inline(c) + '</th>'; });
      t += '</tr></thead><tbody>';
      rows.forEach(function (r) {
        t += '<tr>';
        for (var c = 0; c < head.length; c++) t += '<td>' + inline(r[c] === undefined ? '' : r[c]) + '</td>';
        t += '</tr>';
      });
      out.push(t + '</tbody></table></div>');
      continue;
    }

    var lm = listItem(line);
    if (lm) { out.push(parseList(lm[1].replace(/\t/g, '    ').length)); continue; }

    var para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) { para.push(lines[i]); i++; }
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }
  return out.join('\n');
}

if (typeof module !== 'undefined') module.exports = { mdToHtml: mdToHtml };
