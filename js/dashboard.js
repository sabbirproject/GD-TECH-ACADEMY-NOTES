/**
 * dashboard.js — user dashboard (My Library): list/search/filter, rename, delete, saved,
 * recently viewed, download history, account settings.
 */
(function () {
  var GD = window.GD, $ = GD.$;
  var tab = 'all', notes = [], loaded = false;

  function start() {
    if (!GD.api.configured()) { $('#gate').innerHTML = '<div class="alert warn">The backend is not connected yet (js/config.js).</div>'; return; }
    GD.auth.ensure({ title: 'Sign in to open My Library', message: 'Your notes are private to your account.' }).then(function (user) {
      if (!user) { $('#gate').innerHTML = '<p>Please sign in to see your library.</p><button class="btn" id="si">Sign in</button>'; $('#si').onclick = function () { location.reload(); }; return; }
      $('#gate').hidden = true; $('#app').hidden = false;
      GD.renderChrome('dashboard');
      account(user);
      loadNotes();
    });
  }

  function account(user) {
    var guest = user.isGuest;
    $('#notice').innerHTML = guest ? '<div class="alert info">You are using guest mode. Notes made as a guest stay on this sign-in only. <a href="#" id="upLink">Create a free account</a> to keep them across devices.</div>' : '';
    var l = $('#upLink'); if (l) l.onclick = function (e) { e.preventDefault(); GD.auth.open({ noGuest: true, title: 'Create your account' }).then(function (u) { if (u) location.reload(); }); };
    $('#acctInfo').textContent = guest ? 'Guest account' : (user.email + ' · role: ' + user.role);
    $('#pName').value = guest ? '' : user.name; $('#pName').disabled = guest; $('#pwCard').hidden = guest;
    $('#usage').textContent = user.usageToday + ' of ' + user.dailyLimit + ' notes used today.';
    $('#usageBar').style.width = Math.min(100, Math.round(user.usageToday / Math.max(1, user.dailyLimit) * 100)) + '%';
  }

  function loadNotes() {
    var p = { q: $('#fq').value.trim(), subject: $('#fs').value, language: $('#fl').value, saved: tab === 'saved', sort: tab === 'recent' ? 'recent' : 'created' };
    $('#list').innerHTML = '<p class="muted"><span class="spinner"></span> Loading…</p>';
    GD.api.call('listNotes', p).then(function (r) {
      notes = r.notes;
      if (!loaded) {
        $('#fs').innerHTML = '<option value="">All subjects</option>' + r.subjects.map(function (s) { return '<option>' + GD.esc(s) + '</option>'; }).join('');
        $('#fl').innerHTML = '<option value="">All languages</option>' + r.languages.map(function (s) { return '<option>' + GD.esc(s) + '</option>'; }).join('');
        loaded = true;
      }
      renderList();
    }, function (e) { $('#list').innerHTML = '<div class="alert error">' + GD.esc(e.message) + '</div>'; });
  }

  function renderList() {
    var list = tab === 'recent' ? notes.slice(0, 12) : notes;
    $('#empty').hidden = list.length > 0;
    $('#list').innerHTML = list.map(function (n) {
      var status = n.status === 'complete' ? '<span class="badge ok">Complete</span>' : '<span class="badge warn">' + n.sectionsDone + '/' + n.sectionsTotal + ' ready</span>';
      return '<article class="card note-card" data-id="' + GD.esc(n.id) + '"><h3><a href="reader.html?id=' + encodeURIComponent(n.id) + '" style="color:inherit">' + GD.esc(n.title) + '</a></h3>' +
        '<div class="meta"><span class="badge">' + GD.esc(n.subject) + '</span><span class="badge">' + GD.esc(n.language) + '</span><span class="badge">' + GD.esc(n.level) + '</span>' + status + (n.visibility === 'public' ? '<span class="badge">Public</span>' : '') + '</div>' +
        '<p class="small muted" style="margin:0">Created ' + GD.esc(GD.fmtDate(n.createdAt)) + (tab === 'recent' && n.lastViewedAt ? ' · viewed ' + GD.esc(GD.fmtDateTime(n.lastViewedAt)) : '') + '</p>' +
        '<div class="actions"><a class="btn sm" href="reader.html?id=' + encodeURIComponent(n.id) + '">' + (n.status === 'complete' ? 'Open' : 'Open / continue') + '</a>' +
        '<button class="btn sm secondary" data-a="save">' + (n.saved ? '★ Saved' : '☆ Save') + '</button>' +
        '<button class="btn sm secondary" data-a="rename">Rename</button><button class="btn sm secondary" data-a="delete">Delete</button></div></article>';
    }).join('');
    GD.$$('#list [data-a]').forEach(function (b) {
      b.onclick = function () {
        var id = b.closest('.note-card').dataset.id, n = notes.filter(function (x) { return x.id === id; })[0];
        if (b.dataset.a === 'rename') rename(n);
        else if (b.dataset.a === 'delete') del(n);
        else toggleSave(n);
      };
    });
  }

  function rename(n) {
    GD.prompt('Rename notes', n.title).then(function (t) {
      if (t === null) return;
      GD.api.call('renameNote', { noteId: n.id, title: t }).then(function (r) { n.title = r.title; renderList(); GD.toast('Renamed', 'ok'); }, function (e) { GD.toast(e.message, 'error'); });
    });
  }
  function del(n) {
    GD.confirm('Delete “' + n.title + '”? This removes the notes and their files from your library and cannot be undone.', { danger: true, okText: 'Delete notes', title: 'Delete notes' }).then(function (ok) {
      if (!ok) return;
      GD.api.call('deleteNote', { noteId: n.id }).then(function () { notes = notes.filter(function (x) { return x.id !== n.id; }); renderList(); GD.toast('Deleted', 'ok'); }, function (e) { GD.toast(e.message, 'error'); });
    });
  }
  function toggleSave(n) {
    var want = !n.saved;
    GD.api.call('setSaved', { noteId: n.id, saved: want }).then(function () { n.saved = want; if (tab === 'saved' && !want) notes = notes.filter(function (x) { return x.id !== n.id; }); renderList(); }, function (e) { GD.toast(e.message, 'error'); });
  }

  function loadDownloads() {
    $('#dlBody').innerHTML = '<tr><td colspan="3"><span class="spinner"></span></td></tr>';
    GD.api.call('listDownloads').then(function (r) {
      $('#dlEmpty').hidden = r.downloads.length > 0;
      $('#dlBody').innerHTML = r.downloads.map(function (d) { return '<tr><td>' + GD.esc(GD.fmtDateTime(d.at)) + '</td><td class="wrap">' + (d.noteId ? '<a href="reader.html?id=' + encodeURIComponent(d.noteId) + '">' + GD.esc(d.title || d.noteId) + '</a>' : GD.esc(d.title)) + '</td><td>' + GD.esc((d.format || '').toUpperCase()) + '</td></tr>'; }).join('');
    }, function (e) { $('#dlBody').innerHTML = '<tr><td colspan="3">' + GD.esc(e.message) + '</td></tr>'; });
  }

  function setTab(t) {
    tab = t;
    GD.$$('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === t); });
    $('#paneNotes').hidden = !(t === 'all' || t === 'saved' || t === 'recent');
    $('#paneDownloads').hidden = t !== 'downloads';
    $('#paneAccount').hidden = t !== 'account';
    if (t === 'all' || t === 'saved' || t === 'recent') loadNotes();
    if (t === 'downloads') loadDownloads();
  }

  GD.init({ page: 'dashboard' });
  GD.$$('.tab').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  var deb = GD.debounce(loadNotes, 350);
  $('#fq').addEventListener('input', deb); $('#fs').addEventListener('change', loadNotes); $('#fl').addEventListener('change', loadNotes);
  $('#profileForm').onsubmit = function (e) {
    e.preventDefault();
    GD.api.call('updateProfile', { name: $('#pName').value }).then(function (r) { GD.session.setUser(r.user); GD.toast('Name saved', 'ok'); GD.renderChrome('dashboard'); }, function (er) { GD.toast(er.message, 'error'); });
  };
  $('#pwForm').onsubmit = function (e) {
    e.preventDefault();
    GD.api.call('changePassword', { oldPassword: $('#pOld').value, newPassword: $('#pNew').value }).then(function (r) { GD.session.setToken(r.token); $('#pwForm').reset(); GD.toast('Password changed', 'ok'); }, function (er) { GD.toast(er.message, 'error'); });
  };
  $('#logoutBtn').onclick = GD.auth.logout;
  start();
})();
