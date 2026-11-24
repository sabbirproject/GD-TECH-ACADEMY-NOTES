/**
 * notes.js — the Notes Generator page.
 * Flow: startNote (plan) → generateSection for each pending section (one request each) → open reader.
 * A section request is never sent twice at once (busy flag + server-side idempotency requestId).
 */
(function () {
  var GD = window.GD, $ = GD.$;
  var OPTIONS = [
    ['diagrams', 'Include diagrams', true], ['examples', 'Include examples', true], ['tables', 'Include comparison tables', true],
    ['practice', 'Include practice questions', true], ['mcqs', 'Include MCQs', true], ['answers', 'Include answers and explanations', true],
    ['glossary', 'Include glossary', true], ['references', 'Include references / further reading', false]
  ];
  var running = false;
  var params = new URLSearchParams(location.search);

  function fill(sel, items, def) {
    sel.innerHTML = items.map(function (i) { return '<option value="' + GD.esc(i.code) + '"' + (i.code === def ? ' selected' : '') + '>' + GD.esc(i.label) + '</option>'; }).join('');
  }

  function build(cfg) {
    fill($('#lang'), cfg.languages, params.get('language') || GD.store.get('gd_pref_lang', 'simple-english'));
    fill($('#level'), cfg.levels, params.get('level') || GD.store.get('gd_pref_level', 'auto'));
    fill($('#depth'), cfg.depths, GD.store.get('gd_pref_depth', 'comprehensive'));
    if (!$('#depth').value) $('#depth').value = 'comprehensive';
    var saved = GD.store.get('gd_pref_opts', {});
    $('#switches').innerHTML = OPTIONS.map(function (o) {
      var on = saved[o[0]] !== undefined ? saved[o[0]] : o[2];
      return '<label class="switch"><span>' + GD.esc(o[1]) + '</span><span style="display:flex;gap:8px;align-items:center"><span class="yn">' + (on ? 'Yes' : 'No') + '</span><input type="checkbox" data-opt="' + o[0] + '"' + (on ? ' checked' : '') + '></span></label>';
    }).join('');
    GD.$$('[data-opt]').forEach(function (c) { c.onchange = function () { c.closest('.switch').querySelector('.yn').textContent = c.checked ? 'Yes' : 'No'; }; });
    $('#max').textContent = cfg.limits.maxInputChars;
    $('#topic').maxLength = cfg.limits.maxInputChars;
    toggleCustom();
  }
  function toggleCustom() { $('#customLangWrap').hidden = $('#lang').value !== 'other'; }

  function notice(cfg) {
    var n = $('#notice'), u = GD.session.user(), h = '';
    if (!GD.api.configured()) h += '<div class="alert warn"><strong>Backend not connected.</strong> The administrator must paste the Apps Script Web App URL into <code>js/config.js</code>. You can fill in the form, but generation will not work until then.</div>';
    if (cfg.flags && cfg.flags.maintenance) h += '<div class="alert warn">The generator is under maintenance. Please try again later.</div>';
    if (!navigator.onLine) h += '<div class="alert warn">You are offline. AI generation needs an internet connection.</div>';
    if (u && u.isGuest) h += '<div class="alert info">You are using guest mode. <a href="#" id="upLink">Create a free account</a> to keep your library across devices.</div>';
    n.innerHTML = h;
    var l = $('#upLink'); if (l) l.onclick = function (e) { e.preventDefault(); GD.auth.open({ noGuest: true }).then(function (x) { if (x) location.reload(); }); };
    if (u) $('#limitHint').textContent = 'Daily limit: ' + u.usageToday + ' of ' + u.dailyLimit + ' notes used today.';
  }

  function collect() {
    var opts = {};
    GD.$$('[data-opt]').forEach(function (c) { opts[c.dataset.opt] = c.checked; });
    return { topic: $('#topic').value.trim(), language: $('#lang').value, languageCustom: $('#langCustom').value.trim(), level: $('#level').value, depth: $('#depth').value, options: opts };
  }

  function showErr(msg) { $('#formErr').innerHTML = msg ? '<div class="alert error">' + GD.esc(msg) + '</div>' : ''; }

  function renderList(sections, activeIdx) {
    $('#pList').innerHTML = sections.map(function (s, i) {
      var st = s.status === 'done' ? '✅' : s.status === 'failed' ? '⚠️' : i === activeIdx ? '<span class="spinner"></span>' : '⏳';
      return '<li><span class="st">' + st + '</span><span>' + GD.esc(s.title) + '</span></li>';
    }).join('');
    var done = sections.filter(function (s) { return s.status === 'done'; }).length;
    var pct = Math.round(done / sections.length * 100);
    $('#pBar i').style.width = pct + '%';
    $('#pBar').setAttribute('aria-valuenow', pct);
    return done;
  }

  var MSGS = ['Reading your topic…', 'Planning the chapters…', 'Organising the table of contents…', 'Writing explanations…', 'Adding examples and key points…', 'Polishing the notes…'];

  function runSections(noteId, sections) {
    var i = 0, retries = 0, msgTimer = 0;
    var card = $('#progressCard');
    function next() {
      while (i < sections.length && sections[i].status === 'done') i++;
      if (i >= sections.length) return finish();
      renderList(sections, i);
      $('#pMsg').textContent = 'Writing: ' + sections[i].title + ' (' + (i + 1) + ' of ' + sections.length + ')';
      GD.api.call('generateSection', { noteId: noteId, index: i }, { requestId: GD.newId(), timeoutMs: 330000 }).then(function (r) {
        sections[i].status = 'done';
        retries = 0; i++;
        next();
      }, function (e) {
        if (e.code === 'BUSY_SECTION' || e.code === 'DUPLICATE_REQUEST') { return setTimeout(next, 6000); }
        if ((e.code === 'AI_QUOTA' || e.code === 'AI_UNAVAILABLE' || e.network) && retries < 2) {
          retries++;
          $('#pMsg').textContent = 'The AI is busy. Retrying in 20 seconds… (' + retries + '/2)';
          return setTimeout(next, 20000);
        }
        sections[i].status = 'failed';
        stop(e, noteId, sections);
      });
    }
    next();
  }

  function stop(e, noteId, sections) {
    running = false;
    var done = renderList(sections, -1);
    $('#pTitle').textContent = 'Generation paused';
    $('#pMsg').innerHTML = '<span class="alert error" style="display:block">' + GD.esc(e.message) + '</span>' + (done ? 'Your ' + done + ' finished section(s) are saved.' : '');
    $('#pActions').innerHTML = '<a class="btn" href="reader.html?id=' + encodeURIComponent(noteId) + '&continue=1">Continue generating</a>' + (done ? '<a class="btn secondary" href="reader.html?id=' + encodeURIComponent(noteId) + '">Read what is ready</a>' : '');
    $('#genBtn').disabled = false;
  }

  function finish() {
    running = false;
    $('#pBar i').style.width = '100%';
    $('#pTitle').textContent = 'Your notes are ready! 🎉';
    $('#pMsg').textContent = 'Opening the reader…';
    var id = $('#progressCard').dataset.noteId;
    setTimeout(function () { location.href = 'reader.html?id=' + encodeURIComponent(id); }, 700);
  }

  function submit(e) {
    e.preventDefault();
    if (running) return;
    showErr('');
    var d = collect();
    if (d.topic.length < 3) { showErr('Please enter a topic, subject or chapter name.'); $('#topic').focus(); return; }
    if (d.language === 'other' && d.languageCustom.length < 2) { showErr('Please type the name of the language you want.'); $('#langCustom').focus(); return; }
    if (!navigator.onLine) { showErr('You are offline. AI generation needs an internet connection.'); return; }
    if (!GD.api.configured()) { showErr('The backend is not connected yet. Ask the administrator to set the Web App URL in js/config.js.'); return; }

    GD.auth.ensure({ title: 'Sign in to generate notes', message: 'Create a free account, or continue as a guest, to start.' }).then(function (user) {
      if (!user) return;
      running = true;
      $('#genBtn').disabled = true;
      GD.store.set('gd_pref_lang', d.language); GD.store.set('gd_pref_level', d.level); GD.store.set('gd_pref_depth', d.depth); GD.store.set('gd_pref_opts', d.options);
      var card = $('#progressCard');
      card.hidden = false; $('#pActions').innerHTML = ''; $('#pList').innerHTML = ''; $('#pBar i').style.width = '3%';
      $('#pTitle').textContent = 'Generating your notes…';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var mi = 0; $('#pMsg').textContent = MSGS[0];
      var timer = setInterval(function () { if (!running) return clearInterval(timer); if (!card.dataset.noteId) { mi = Math.min(mi + 1, 2); $('#pMsg').textContent = MSGS[mi]; } }, 4000);

      GD.api.call('startNote', d, { requestId: GD.newId(), timeoutMs: 120000 }).then(function (r) {
        card.dataset.noteId = r.note.id;
        var u = GD.session.user(); if (u) { u.usageToday = (u.usageToday || 0) + 1; GD.session.setUser(u); }
        runSections(r.note.id, r.sections);
      }, function (er) {
        running = false; clearInterval(timer);
        card.hidden = true; $('#genBtn').disabled = false;
        showErr(er.message);
        if (er.code === 'UNAUTHORIZED') GD.auth.open();
      });
    });
  }

  window.addEventListener('beforeunload', function (e) { if (running) { e.preventDefault(); e.returnValue = ''; } });

  GD.init({ page: 'notes' }).then(function (cfg) {
    build(cfg); notice(cfg);
    if (GD.session.token() && GD.api.configured()) GD.api.call('me').then(function (r) { GD.session.setUser(r.user); notice(cfg); }, function () { });
  });
  build(GD.cfg);
  if (params.get('topic')) $('#topic').value = params.get('topic').slice(0, 6000);
  $('#count').textContent = $('#topic').value.length;
  $('#topic').addEventListener('input', function () { $('#count').textContent = this.value.length; });
  $('#lang').addEventListener('change', toggleCustom);
  $('#genForm').addEventListener('submit', submit);
})();
