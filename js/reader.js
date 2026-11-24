/**
 * reader.js — notes viewer: TOC, collapse, search, progress, font size, edit, regenerate,
 * continue generating, save, rename, publish, print, PDF/HTML download.
 */
(function () {
  var GD = window.GD, $ = GD.$;
  var params = new URLSearchParams(location.search);
  var noteId = params.get('id') || '', publicId = params.get('public') || '';
  var data = null;            // { note, isOwner, sections, ... }
  var busy = {};              // per-section busy flags
  var matches = [], cur = -1;
  var fontScale = GD.store.get('gd_font', 1);

  function setFont(v) {
    fontScale = Math.max(.8, Math.min(1.6, v));
    document.documentElement.style.setProperty('--font-scale', fontScale);
    GD.store.set('gd_font', fontScale);
  }
  setFont(fontScale);

  function isRtl() { return data && /urdu/i.test(data.languageInfo.code); }

  function showState(html) { $('#state').hidden = false; $('#state').innerHTML = html; $('#reader').hidden = true; $('#readerTop').hidden = true; }

  /* ---------- load ---------- */
  function load() {
    if (!noteId && !publicId) return showState('<p>No note selected.</p><a class="btn" href="dashboard.html">Go to My Library</a>');
    if (!GD.api.configured()) return showState('<div class="alert warn">The backend is not connected yet (js/config.js).</div>');
    var go = function () {
      var call = publicId ? GD.api.call('getPublicNote', { noteId: publicId }, { noAuth: true }) : GD.api.call('getNote', { noteId: noteId });
      call.then(function (r) { data = r; render(); if (params.get('continue') === '1' && r.isOwner) continueGen(); },
        function (e) {
          if (e.code === 'UNAUTHORIZED') return GD.auth.open({ title: 'Sign in to open your notes' }).then(function (u) { u ? location.reload() : showState('<p>Please sign in to view this note.</p>'); });
          showState('<div class="alert error">' + GD.esc(e.message) + '</div><a class="btn" href="dashboard.html">Go to My Library</a>');
        });
    };
    if (publicId) go(); else GD.session.token() ? go() : GD.auth.open({ title: 'Sign in to open your notes' }).then(function (u) { u ? location.reload() : showState('<p>Please sign in to view this note.</p>'); });
  }

  /* ---------- render ---------- */
  function secHtml(s) {
    var rtl = isRtl() ? ' rtl' : '';
    if (s.status === 'done') {
      var h = '<div class="prose' + rtl + '">' + mdToHtml(s.markdown) + '</div>';
      if (s.truncated) h += '<div class="alert warn">This section may be incomplete. Use “Regenerate” to rewrite it.</div>';
      return h;
    }
    if (s.status === 'failed') return '<div class="pending-box">⚠️ This section could not be generated. ' + GD.esc(s.error || '') + '</div>';
    if (s.status === 'generating') return '<div class="pending-box"><span class="spinner"></span> Writing this section…</div>';
    return '<div class="pending-box">⏳ This section has not been generated yet.</div>';
  }

  function secTools(s) {
    if (!data.isOwner) return '';
    var b = '';
    if (s.status === 'done') b += '<button class="btn sm secondary" data-act="edit" data-i="' + s.index + '">✎ Edit</button><button class="btn sm secondary" data-act="regen" data-i="' + s.index + '">↻ Regenerate</button>';
    else b += '<button class="btn sm" data-act="regen" data-i="' + s.index + '">Generate this section</button>';
    return '<div class="sec-tools no-print">' + b + '</div>';
  }

  function render() {
    var n = data.note;
    document.title = n.title + ' – GD TECH ACADEMY';
    $('#state').hidden = true; $('#reader').hidden = false; $('#readerTop').hidden = false;
    $('#noteHead').innerHTML = '<h1>' + GD.esc(n.title) + '</h1><div class="chips"><span class="chip">Subject: ' + GD.esc(n.subject) + '</span><span class="chip teal">' + GD.esc(n.language) + '</span><span class="chip">' + GD.esc(n.level) + '</span><span class="chip teal">' + GD.esc(n.depth) + '</span></div>' +
      '<p class="small muted" style="margin:10px 0 0">Created ' + GD.esc(GD.fmtDate(n.createdAt)) + ' · ' + n.sectionsDone + ' of ' + n.sectionsTotal + ' sections ready' + (n.visibility === 'public' ? ' · <strong>Public</strong>' : '') + '</p>';
    $('#tocList').innerHTML = data.sections.map(function (s) { return '<li><a href="#sec' + s.index + '" data-toc="' + s.index + '">' + GD.esc(s.title) + (s.status !== 'done' ? ' ⏳' : '') + '</a></li>'; }).join('');
    $('#chapters').innerHTML = data.sections.map(function (s) {
      return '<section class="chapter" id="sec' + s.index + '" data-i="' + s.index + '"><header tabindex="0" role="button" aria-expanded="true"><span class="caret">▾</span><h2>' + (s.index + 1) + '. ' + GD.esc(s.title) + '</h2></header><div class="body">' + secTools(s) + '<div data-content>' + secHtml(s) + '</div></div></section>';
    }).join('');

    var owner = data.isOwner;
    $('#saveBtn').hidden = !owner; $('#renameBtn').hidden = !owner; $('#shareBtn').hidden = !owner;
    $('#htmlBtn').hidden = !owner; $('#pdfBtn').hidden = !owner;
    if (owner) { updateSaveBtn(); updateShareBtn(); }
    renderContinue();
    bindChapters();
    $('#disclaimer').hidden = false;
    updateProgress();
  }

  function renderContinue() {
    var missing = data.sections.filter(function (s) { return s.status !== 'done'; }).length;
    var box = $('#contBox');
    if (!data.isOwner || !missing) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="alert info no-print"><strong>' + missing + ' section(s) still to generate.</strong> <button class="btn sm" id="contBtn" style="margin-left:8px">Continue generating</button><div id="contMsg" class="small" style="margin-top:6px"></div></div>';
    $('#contBtn').onclick = continueGen;
  }

  function bindChapters() {
    GD.$$('.chapter > header').forEach(function (h) {
      function tog() { var c = h.parentNode; c.classList.toggle('collapsed'); h.setAttribute('aria-expanded', !c.classList.contains('collapsed')); }
      h.onclick = tog; h.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } };
    });
    GD.$$('[data-act]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.i; b.dataset.act === 'edit' ? editSection(i) : regen(i, b); };
    });
    GD.$$('[data-toc]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); var c = $('#sec' + a.dataset.toc); c.classList.remove('collapsed'); c.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#sec' + a.dataset.toc); };
    });
  }

  function refreshSection(i) {
    var s = data.sections[i];
    var c = $('#sec' + i);
    c.querySelector('[data-content]').innerHTML = secHtml(s);
    var old = c.querySelector('.sec-tools'); if (old) old.remove();
    c.querySelector('.body').insertAdjacentHTML('afterbegin', secTools(s));
    GD.$$('[data-act]', c).forEach(function (b) { b.onclick = function () { b.dataset.act === 'edit' ? editSection(i) : regen(i, b); }; });
    var t = $('[data-toc="' + i + '"]'); if (t) t.textContent = s.title + (s.status !== 'done' ? ' ⏳' : '');
  }

  function applyResult(r) {
    var s = data.sections[r.section.index];
    s.status = r.section.status; s.markdown = r.section.markdown; s.truncated = r.section.truncated; s.error = r.section.error || ''; s.title = r.section.title;
    data.note.sectionsDone = r.progress.sectionsDone; data.note.status = r.progress.status;
    refreshSection(r.section.index);
    $('#noteHead p').innerHTML = $('#noteHead p').innerHTML.replace(/\d+ of \d+ sections ready/, r.progress.sectionsDone + ' of ' + r.progress.sectionsTotal + ' sections ready');
    renderContinue();
  }

  /* ---------- generation ---------- */
  function regen(i, btn) {
    if (busy[i] || busy.all) return;
    var s = data.sections[i];
    var go = s.status === 'done' ? GD.confirm('Rewrite “' + s.title + '” with AI? The current text of this section will be replaced (including your edits).', { okText: 'Regenerate', title: 'Regenerate section' }) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      busy[i] = true;
      s.status = 'generating'; var keep = s.markdown; refreshSection(i);
      GD.api.call('regenerateSection', { noteId: data.note.id, index: i }, { requestId: GD.newId(), timeoutMs: 330000 }).then(function (r) {
        busy[i] = false; applyResult(r); GD.toast('Section updated', 'ok');
      }, function (e) {
        busy[i] = false; s.status = keep ? 'done' : 'failed'; s.markdown = keep; s.error = e.message; refreshSection(i); GD.toast(e.message, 'error');
      });
    });
  }

  function continueGen() {
    if (busy.all) return;
    busy.all = true;
    var btn = $('#contBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    var msg = function (t) { var m = $('#contMsg'); if (m) m.textContent = t; };
    var idx = 0, retries = 0;
    function step() {
      while (idx < data.sections.length && data.sections[idx].status === 'done') idx++;
      if (idx >= data.sections.length) { busy.all = false; renderContinue(); GD.toast('All sections are ready 🎉', 'ok'); return; }
      var s = data.sections[idx]; s.status = 'generating'; refreshSection(idx);
      msg('Writing: ' + s.title + '…');
      GD.api.call('generateSection', { noteId: data.note.id, index: idx }, { requestId: GD.newId(), timeoutMs: 330000 }).then(function (r) {
        retries = 0; applyResult(r); msg(''); idx++; step();
      }, function (e) {
        if ((e.code === 'BUSY_SECTION' || e.code === 'DUPLICATE_REQUEST') && retries < 6) { retries++; s.status = 'pending'; return setTimeout(step, 6000); }
        if ((e.code === 'AI_QUOTA' || e.code === 'AI_UNAVAILABLE' || e.network) && retries < 2) { retries++; s.status = 'pending'; msg('The AI is busy. Retrying in 20 seconds…'); return setTimeout(step, 20000); }
        s.status = 'failed'; s.error = e.message; refreshSection(idx);
        busy.all = false; renderContinue();
        var m = $('#contMsg'); if (m) m.innerHTML = '<span style="color:var(--danger)">' + GD.esc(e.message) + '</span>';
      });
    }
    step();
  }

  /* ---------- editing ---------- */
  function editSection(i) {
    var s = data.sections[i];
    var m = GD.modal('<h3>Edit section</h3><div class="field"><label for="eTitle">Title</label><input id="eTitle" type="text" maxlength="140" value="' + GD.esc(s.title) + '"></div><div class="field editor"><label for="eText">Content (Markdown)</label><textarea id="eText" spellcheck="true"></textarea><div class="hint">Use ### for headings, - for bullets, **bold**, and | tables |. HTML is not allowed.</div></div><div id="eErr"></div><div class="actions"><button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>Save changes</button></div>', { wide: true, label: 'Edit section', persistent: true });
    var ta = GD.$('#eText', m.el); ta.value = s.markdown; if (isRtl()) ta.dir = 'rtl';
    GD.$('[data-no]', m.el).onclick = function () { m.close(null); };
    GD.$('[data-yes]', m.el).onclick = function () {
      var b = GD.$('[data-yes]', m.el);
      if (!ta.value.trim()) { GD.$('#eErr', m.el).innerHTML = '<div class="alert error">The content cannot be empty.</div>'; return; }
      GD.setBusy(b, true, 'Saving…');
      GD.api.call('updateSection', { noteId: data.note.id, index: i, markdown: ta.value, title: GD.$('#eTitle', m.el).value }).then(function (r) {
        applyResult(r); m.close(true); GD.toast('Saved', 'ok');
      }, function (e) { GD.setBusy(b, false); GD.$('#eErr', m.el).innerHTML = '<div class="alert error">' + GD.esc(e.message) + '</div>'; });
    };
  }

  /* ---------- toolbar actions ---------- */
  function updateSaveBtn() { $('#saveBtn').textContent = data.note.saved ? '★ Saved in My Library' : '☆ Save to My Library'; }
  function updateShareBtn() { $('#shareBtn').textContent = data.note.visibility === 'public' ? '🔒 Make private' : '🌐 Publish'; }

  function exportFile(fmt, btn) {
    if (!navigator.onLine) return GD.toast('Downloads need an internet connection.', 'error');
    var unfinished = data.sections.some(function (s) { return s.status !== 'done'; });
    if (unfinished) GD.toast('Only finished sections are included in the download.');
    GD.setBusy(btn, true, fmt === 'pdf' ? 'Making PDF…' : 'Preparing…');
    GD.api.call('exportNote', { noteId: data.note.id, format: fmt }, { requestId: GD.newId(), timeoutMs: 120000 }).then(function (r) {
      GD.setBusy(btn, false);
      GD.download(GD.b64ToBlob(r.base64, r.mimeType), r.fileName);
      GD.toast('Download started', 'ok');
    }, function (e) { GD.setBusy(btn, false); GD.toast(e.message, 'error'); });
  }

  function bindToolbar() {
    $('#fontUp').onclick = function () { setFont(fontScale + .1); };
    $('#fontDown').onclick = function () { setFont(fontScale - .1); };
    $('#expandAll').onclick = function () { GD.$$('.chapter').forEach(function (c) { c.classList.remove('collapsed'); }); };
    $('#collapseAll').onclick = function () { GD.$$('.chapter').forEach(function (c) { c.classList.add('collapsed'); }); };
    $('#copyBtn').onclick = function () {
      var t = String(window.getSelection()).trim();
      if (!t) return GD.toast('Select some text in the notes first.');
      GD.copyText(t).then(function () { GD.toast('Copied', 'ok'); }, function () { GD.toast('Could not copy. Press Ctrl+C instead.', 'error'); });
    };
    $('#printBtn').onclick = function () {
      GD.$$('.chapter').forEach(function (c) { c.classList.remove('collapsed'); });
      if (data.isOwner && navigator.onLine) GD.api.call('logDownload', { noteId: data.note.id, format: 'print' }).catch(function () { });
      setTimeout(function () { window.print(); }, 150);
    };
    $('#pdfBtn').onclick = function () { exportFile('pdf', this); };
    $('#htmlBtn').onclick = function () { exportFile('html', this); };
    $('#saveBtn').onclick = function () {
      var want = !data.note.saved;
      GD.api.call('setSaved', { noteId: data.note.id, saved: want }).then(function () { data.note.saved = want; updateSaveBtn(); GD.toast(want ? 'Saved to My Library' : 'Removed from saved notes', 'ok'); }, function (e) { GD.toast(e.message, 'error'); });
    };
    $('#renameBtn').onclick = function () {
      GD.prompt('Rename notes', data.note.title).then(function (t) {
        if (t === null) return;
        GD.api.call('renameNote', { noteId: data.note.id, title: t }).then(function (r) { data.note.title = r.title; render(); GD.toast('Renamed', 'ok'); }, function (e) { GD.toast(e.message, 'error'); });
      });
    };
    $('#shareBtn').onclick = function () {
      var vis = data.note.visibility === 'public' ? 'private' : 'public';
      var q = vis === 'public' ? GD.confirm('Publishing makes these notes readable by anyone who has the link (and they can appear in featured notes if the administrator chooses). Your topic text stays private. Publish?', { okText: 'Publish' }) : Promise.resolve(true);
      q.then(function (ok) {
        if (!ok) return;
        GD.api.call('setNoteVisibility', { noteId: data.note.id, visibility: vis }).then(function () {
          data.note.visibility = vis; updateShareBtn();
          if (vis === 'public') { var link = location.origin + location.pathname + '?public=' + encodeURIComponent(data.note.id); GD.copyText(link).then(function () { GD.toast('Published. Link copied.', 'ok'); }, function () { GD.toast('Published. Link: ' + link, 'ok'); }); }
          else GD.toast('Notes are private again', 'ok');
        }, function (e) { GD.toast(e.message, 'error'); });
      });
    };
    $('#tocHead').onclick = function () { $('#toc').classList.toggle('collapsed'); };
    bindFind();
    window.addEventListener('scroll', GD.debounce(updateProgress, 30), { passive: true });
  }

  /* ---------- search ---------- */
  function clearMarks() {
    GD.$$('mark.hl').forEach(function (m) { var p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); });
    matches = []; cur = -1; $('#findCount').textContent = '';
  }
  function runFind() {
    clearMarks();
    var q = $('#findInput').value.trim();
    if (q.length < 2) return;
    var ql = q.toLowerCase();
    GD.$$('.prose').forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
      while ((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(function (node) {
        var text = node.nodeValue, low = text.toLowerCase(), pos = 0, idx, frag = null, last = 0;
        while ((idx = low.indexOf(ql, pos)) > -1) {
          frag = frag || document.createDocumentFragment();
          frag.appendChild(document.createTextNode(text.slice(last, idx)));
          var mk = document.createElement('mark'); mk.className = 'hl'; mk.textContent = text.slice(idx, idx + q.length);
          frag.appendChild(mk); matches.push(mk);
          last = idx + q.length; pos = last;
        }
        if (frag) { frag.appendChild(document.createTextNode(text.slice(last))); node.parentNode.replaceChild(frag, node); }
      });
    });
    $('#findCount').textContent = matches.length ? matches.length + ' found' : 'No match';
    if (matches.length) go(0);
  }
  function go(i) {
    if (!matches.length) return;
    if (cur > -1 && matches[cur]) matches[cur].classList.remove('cur');
    cur = (i + matches.length) % matches.length;
    var m = matches[cur]; m.classList.add('cur');
    var ch = m.closest('.chapter'); if (ch) ch.classList.remove('collapsed');
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('#findCount').textContent = (cur + 1) + ' / ' + matches.length;
  }
  function bindFind() {
    $('#findInput').addEventListener('input', GD.debounce(runFind, 250));
    $('#findInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); } });
    $('#findNext').onclick = function () { go(cur + 1); };
    $('#findPrev').onclick = function () { go(cur - 1); };
  }

  /* ---------- reading progress + active TOC ---------- */
  function updateProgress() {
    var art = $('#article'); if (!art || $('#reader').hidden) return;
    var r = art.getBoundingClientRect();
    var total = r.height - window.innerHeight * .6;
    var pct = total > 0 ? Math.min(100, Math.max(0, (-r.top / total) * 100)) : 100;
    $('#readBar').style.width = pct + '%';
    var active = null;
    GD.$$('.chapter').forEach(function (c) { if (c.getBoundingClientRect().top < 200) active = c.dataset.i; });
    GD.$$('[data-toc]').forEach(function (a) { a.classList.toggle('active', a.dataset.toc === active); });
  }

  GD.init({ page: 'reader' });
  bindToolbar();
  load();
})();
