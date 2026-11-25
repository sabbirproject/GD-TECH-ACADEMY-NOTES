/**
 * admin.js — Admin Dashboard. Hiding the page is NOT security: every admin* action is re-checked on the
 * server against the Users sheet (role must be "admin"). Non-admins only see "Access denied".
 */
(function () {
  var GD = window.GD, $ = GD.$, pane = null;
  var E = GD.esc;
  var A = function (action, data, opts) { return GD.api.call(action, data || {}, opts); };

  function start() {
    pane = $('#pane');
    if (!GD.api.configured()) { $('#gate').innerHTML = '<div class="alert warn">The backend is not connected yet (js/config.js).</div>'; return; }
    GD.auth.ensure({ title: 'Administrator sign in', noGuest: true, message: 'Only administrators can open this page.' }).then(function (u) {
      if (!u) { $('#gate').innerHTML = '<p>Please sign in as administrator.</p><button class="btn" onclick="location.reload()">Sign in</button>'; return; }
      if (u.role !== 'admin') { $('#gate').innerHTML = '<div class="alert error">Access denied. This area is for administrators only.</div><a class="btn" href="index.html">Go home</a>'; return; }
      A('adminStats').then(function (s) {
        $('#gate').hidden = true; $('#app').hidden = false; GD.renderChrome('admin'); show('overview', s);
      }, function (e) { $('#gate').innerHTML = '<div class="alert error">' + E(e.message) + '</div>'; });
    });
  }

  function loading() { pane.innerHTML = '<p class="muted"><span class="spinner"></span> Loading…</p>'; }
  function err(e) { pane.innerHTML = '<div class="alert error">' + E(e.message) + '</div>'; }
  function stat(n, label) { return '<div class="card stat"><b>' + E(n) + '</b><span>' + E(label) + '</span></div>'; }
  function table(head, rows) {
    return '<div class="table-wrap"><table class="data-table"><thead><tr>' + head.map(function (h) { return '<th>' + E(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function toast(e) { GD.toast(e.message || String(e), 'error'); }

  var TABS = {
    overview: function (pre) { return pre ? Promise.resolve(overview(pre)) : (loading(), A('adminStats').then(overview, err)); },
    users: usersTab, notes: notesTab, ai: aiTab, website: websiteTab, usage: usageTab, logs: logsTab, data: dataTab
  };
  function show(t, pre) {
    GD.$$('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === t); });
    TABS[t](pre);
  }

  /* ---------- overview ---------- */
  function overview(s) {
    var ai = s.ai;
    var aiBadge = !s.aiKeySet ? '<span class="badge err">No API key</span>' : ai ? (ai.ok ? '<span class="badge ok">Connected</span>' : '<span class="badge err">Error</span>') : '<span class="badge warn">Not tested</span>';
    pane.innerHTML = '<div class="grid cols-4">' + stat(s.totalUsers, 'Registered users') + stat(s.totalNotes, 'Generated notes') + stat(s.savedNotes, 'Saved notes') + stat(s.notesToday, 'Notes today') +
      stat(s.dailyGenerations, 'AI generations today') + stat(s.monthlyGenerations, 'AI generations this month') + stat(s.globalUsedToday + ' / ' + s.globalLimit, 'Daily AI capacity used') + stat(s.errorsToday, 'AI errors today') + '</div>' +
      '<div class="grid cols-2" style="margin-top:16px"><div class="card"><h3>AI API status ' + aiBadge + '</h3><p class="small muted">' + (ai ? E(ai.provider + ' · ' + ai.model + ' · tested ' + GD.fmtDateTime(ai.at) + ' — ' + ai.message) : 'Open “AI Configuration” and press “Test connection”.') + '</p></div>' +
      '<div class="card"><h3>Storage</h3><div id="stor" class="small muted"><button class="btn sm secondary" id="loadStor">Check storage</button></div></div></div>' +
      '<div class="card" style="margin-top:16px"><h3>Recent activity</h3>' + table(['When', 'User', 'Action', 'Detail'], s.recentActivity.map(function (a) { return '<tr><td>' + E(GD.fmtDateTime(a.at)) + '</td><td>' + E(a.user || '—') + '</td><td>' + E(a.action) + '</td><td class="wrap">' + E(a.detail) + '</td></tr>'; })) + '</div>';
    $('#loadStor').onclick = function () {
      GD.setBusy(this, true, 'Checking…');
      A('adminStorage').then(function (r) { $('#stor').innerHTML = storageHtml(r); }, function (e) { $('#stor').textContent = e.message; });
    };
  }
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }
  function storageHtml(r) {
    var d = r.drive;
    return 'Drive: ' + mb(d.driveUsedBytes) + ' of ' + (d.driveLimitBytes ? (d.driveLimitBytes / 1073741824).toFixed(0) + ' GB' : 'quota') + ' used<br>App files: ' + d.appFiles + (d.capped ? '+' : '') + ' (' + mb(d.appBytes) + ')<br>Sheets: ' + (r.cellsUsed / 1000000).toFixed(2) + ' M of ' + (r.cellLimit / 1000000) + ' M cells<br><a href="' + E(r.spreadsheetUrl) + '" target="_blank" rel="noopener noreferrer">Open database spreadsheet</a>';
  }

  /* ---------- users ---------- */
  function usersTab() {
    pane.innerHTML = '<div class="card" style="margin-bottom:14px"><input type="search" id="uq" placeholder="Search by name, email or ID…" aria-label="Search users"></div><div id="ul"></div>';
    var run = function () {
      $('#ul').innerHTML = '<span class="spinner"></span>';
      A('adminListUsers', { q: $('#uq').value }).then(function (r) {
        $('#ul').innerHTML = '<p class="small muted">' + r.total + ' user(s)</p>' + table(['Name', 'Email', 'Role', 'Status', 'Today', 'Notes', 'Joined', ''], r.users.map(function (u) {
          return '<tr><td>' + E(u.name) + '</td><td>' + E(u.email) + '</td><td>' + E(u.role) + '</td><td><span class="badge ' + (u.status === 'active' ? 'ok' : 'err') + '">' + E(u.status) + '</span></td><td>' + u.usageToday + '</td><td>' + u.notesCount + '</td><td>' + E(GD.fmtDate(u.createdAt)) + '</td><td><button class="btn sm secondary" data-u="' + E(u.id) + '">Manage</button></td></tr>';
        }));
        GD.$$('[data-u]').forEach(function (b) { b.onclick = function () { userModal(b.dataset.u, r.roles); }; });
      }, err);
    };
    $('#uq').addEventListener('input', GD.debounce(run, 350)); run();
  }
  function userModal(id, roles) {
    A('adminUserDetail', { userId: id }).then(function (d) {
      var u = d.user;
      var m = GD.modal('<h3>' + E(u.name) + '</h3><p class="small muted">' + E(u.email) + ' · ' + E(u.id) + '<br>' + d.totalGenerations + ' AI generations in total · effective daily limit ' + d.effectiveLimit + '</p>' +
        '<div class="row two"><div class="field"><label for="mRole">Role</label><select id="mRole">' + roles.map(function (r) { return '<option value="' + E(r.role) + '"' + (r.role === u.role ? ' selected' : '') + '>' + E(r.role) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="mStatus">Status</label><select id="mStatus"><option value="active"' + (u.status === 'active' ? ' selected' : '') + '>Active</option><option value="disabled"' + (u.status !== 'active' ? ' selected' : '') + '>Deactivated</option></select></div></div>' +
        '<div class="field"><label for="mLim">Personal daily limit (0 = role default)</label><input id="mLim" type="number" min="0" max="1000" value="' + u.dailyLimit + '"></div>' +
        '<h4>Recent notes</h4><ul class="small">' + (d.notes.slice(0, 8).map(function (n) { return '<li>' + E(n.title) + ' <span class="muted">(' + E(n.status) + ')</span></li>'; }).join('') || '<li class="muted">None</li>') + '</ul><div id="mErr"></div>' +
        '<div class="actions"><button class="btn danger sm" data-pw>Reset password</button><button class="btn secondary" data-no>Close</button><button class="btn" data-yes>Save</button></div>', { wide: true, label: 'Manage user' });
      GD.$('[data-no]', m.el).onclick = function () { m.close(); };
      GD.$('[data-yes]', m.el).onclick = function () {
        A('adminUpdateUser', { userId: id, role: $('#mRole', m.el).value, status: $('#mStatus', m.el).value, dailyLimit: $('#mLim', m.el).value }).then(function () { m.close(); GD.toast('User updated', 'ok'); usersTab(); }, function (e) { GD.$('#mErr', m.el).innerHTML = '<div class="alert error">' + E(e.message) + '</div>'; });
      };
      GD.$('[data-pw]', m.el).onclick = function () {
        GD.confirm('Reset the password for ' + u.email + '? Their current sessions will end. A temporary password will be shown once.', { danger: true, okText: 'Reset password' }).then(function (ok) {
          if (!ok) return;
          A('adminResetPassword', { userId: id, confirm: true }).then(function (r) { GD.modal('<h3>Temporary password</h3><p>Give this to the user. It is shown only once:</p><p><code style="font-size:1.2rem;user-select:all">' + E(r.tempPassword) + '</code></p><div class="actions"><button class="btn" data-ok>Done</button></div>', { persistent: true }).el.querySelector('[data-ok]').onclick = function () { document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); }); }; }, toast);
        });
      };
    }, toast);
  }

  /* ---------- notes ---------- */
  function notesTab() {
    pane.innerHTML = '<div class="card" style="margin-bottom:14px"><input type="search" id="nq" placeholder="Search notes by title, subject, owner or ID…" aria-label="Search notes"></div><div id="nl"></div>';
    var run = function () {
      $('#nl').innerHTML = '<span class="spinner"></span>';
      A('adminListNotes', { q: $('#nq').value }).then(function (r) {
        $('#nl').innerHTML = '<p class="small muted">' + r.total + ' note(s)</p>' + table(['Title', 'Subject', 'Language', 'Status', 'Visibility', 'Featured', 'Created', ''], r.notes.map(function (n) {
          return '<tr data-id="' + E(n.id) + '"><td class="wrap">' + E(n.title) + '</td><td>' + E(n.subject) + '</td><td>' + E(n.language) + '</td><td>' + E(n.status) + '</td><td>' + E(n.visibility) + '</td><td>' + (n.featured ? '★' : '') + '</td><td>' + E(GD.fmtDate(n.createdAt)) + '</td>' +
            '<td style="white-space:nowrap"><button class="btn sm secondary" data-a="vis">' + (n.visibility === 'public' ? 'Make private' : 'Make public') + '</button> <button class="btn sm secondary" data-a="feat">' + (n.featured ? 'Unfeature' : 'Feature') + '</button> <button class="btn sm danger" data-a="del">Delete</button></td></tr>';
        }));
        GD.$$('#nl [data-a]').forEach(function (b) {
          b.onclick = function () {
            var id = b.closest('tr').dataset.id, n = r.notes.filter(function (x) { return x.id === id; })[0];
            if (b.dataset.a === 'del') GD.confirm('Delete “' + n.title + '” permanently from the library and Drive?', { danger: true, okText: 'Delete' }).then(function (ok) { if (ok) A('adminDeleteNote', { noteId: id, confirm: true }).then(function () { GD.toast('Deleted', 'ok'); run(); }, toast); });
            else A('adminSetNoteFlags', b.dataset.a === 'vis' ? { noteId: id, visibility: n.visibility === 'public' ? 'private' : 'public' } : { noteId: id, featured: !n.featured }).then(function () { run(); }, toast);
          };
        });
      }, err);
    };
    $('#nq').addEventListener('input', GD.debounce(run, 350)); run();
  }

  /* ---------- AI ---------- */
  function aiTab() {
    loading();
    A('adminGetAI').then(function (c) {
      pane.innerHTML = '<div class="card"><h3>AI provider</h3><form id="aiForm">' +
        '<div class="row two"><div class="field"><label for="aProv">Provider</label><select id="aProv"><option value="gemini"' + (c.provider === 'gemini' ? ' selected' : '') + '>Google Gemini — generateContent (default)</option><option value="gemini-interactions"' + (c.provider === 'gemini-interactions' ? ' selected' : '') + '>Google Gemini — Interactions API (newer, optional)</option><option value="openai"' + (c.provider === 'openai' ? ' selected' : '') + '>OpenAI-compatible (OpenAI, OpenRouter, Groq…)</option></select></div>' +
        '<div class="field"><label for="aModel">Model name</label><input id="aModel" type="text" list="modelList" maxlength="100" value="' + E(c.model) + '"><datalist id="modelList"></datalist><div class="hint"><a href="#" id="loadModels">Load available models</a> <span id="modelMsg"></span></div></div></div>' +
        '<div class="field"><label for="aEnd">API endpoint</label><input id="aEnd" type="url" value="' + E(c.endpoint) + '"><div class="hint">Both Gemini options: https://generativelanguage.googleapis.com/v1beta · OpenAI-compatible: e.g. https://api.openai.com/v1</div></div>' +
        '<div class="field"><label for="aKey">API key</label><input id="aKey" type="password" autocomplete="off" placeholder="' + (c.hasKey ? '•••••••• saved — type a new key to replace it' : 'Paste your API key') + '"><div class="hint">Stored only in Apps Script Script Properties. It is never sent back to this page.' + (c.hasKey ? ' <a href="#" id="rmKey">Remove saved key</a>' : '') + '</div></div>' +
        '<div class="row three"><div class="field"><label for="aTemp">Temperature (0–2)</label><input id="aTemp" type="number" step="0.1" min="0" max="2" value="' + c.temperature + '"></div>' +
        '<div class="field"><label for="aTok">Max output tokens</label><input id="aTok" type="number" min="256" max="65536" value="' + c.maxOutputTokens + '"></div>' +
        '<div class="field"><label for="aRet">Retries (1–5)</label><input id="aRet" type="number" min="1" max="5" value="' + c.retries + '"></div></div>' +
        '<div class="field"><label for="aSys">System prompt (master prompt)</label><textarea id="aSys" style="min-height:240px;font-family:ui-monospace,Menlo,monospace;font-size:.85rem">' + E(c.systemPrompt) + '</textarea><div class="hint"><a href="#" id="rstPrompt">Reset to the default master prompt</a></div></div>' +
        '<div id="aiMsg"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save AI settings</button><button class="btn secondary" type="button" id="aiTest">Test connection</button></div></form>' +
        '<div id="aiStatus" class="small" style="margin-top:12px">' + statusHtml(c.status, c.hasKey) + '</div></div>';
      $('#aiForm').onsubmit = function (e) {
        e.preventDefault();
        var b = GD.$('button[type=submit]', this); GD.setBusy(b, true, 'Saving…');
        var d = { provider: $('#aProv').value, model: $('#aModel').value, endpoint: $('#aEnd').value, temperature: $('#aTemp').value, maxOutputTokens: $('#aTok').value, retries: $('#aRet').value, systemPrompt: $('#aSys').value, apiKey: $('#aKey').value };
        A('adminSaveAI', d).then(function () { GD.toast('AI settings saved', 'ok'); aiTab(); }, function (er) { GD.setBusy(b, false); $('#aiMsg').innerHTML = '<div class="alert error">' + E(er.message) + '</div>'; });
      };
      $('#loadModels').onclick = function (e) {
        e.preventDefault();
        $('#modelMsg').textContent = 'Asking Google…';
        A('adminListModels', {}, { timeoutMs: 60000 }).then(function (r) {
          $('#modelList').innerHTML = r.models.map(function (m) { return '<option value="' + E(m.id) + '">' + E(m.name) + '</option>'; }).join('');
          $('#modelMsg').innerHTML = r.models.length ? '— ' + r.models.length + ' models found. Click the Model name box and choose one (for example a recent <b>flash</b> model). Current: <code>' + E(r.current) + '</code>' : '— none returned';
          $('#aModel').focus(); $('#aModel').select();
        }, function (er) { $('#modelMsg').innerHTML = '<span style="color:var(--danger)">' + E(er.message) + '</span>'; });
      };
      $('#aiTest').onclick = function () {
        var b = this; GD.setBusy(b, true, 'Testing…');
        A('adminTestAI', {}, { timeoutMs: 120000 }).then(function (s) { GD.setBusy(b, false); $('#aiStatus').innerHTML = statusHtml(s, true); }, function (er) { GD.setBusy(b, false); toast(er); });
      };
      var rk = $('#rmKey'); if (rk) rk.onclick = function (e) { e.preventDefault(); GD.confirm('Remove the saved API key? AI generation will stop working until you add a new one.', { danger: true, okText: 'Remove key' }).then(function (ok) { if (ok) A('adminSaveAI', { removeKey: true }).then(function () { aiTab(); }, toast); }); };
      $('#rstPrompt').onclick = function (e) { e.preventDefault(); GD.confirm('Reset the system prompt to the default?', { okText: 'Reset' }).then(function (ok) { if (ok) A('adminResetPrompt').then(function () { aiTab(); }, toast); }); };
    }, err);
  }
  function statusHtml(s, hasKey) {
    if (!hasKey) return '<span class="badge err">No API key saved</span>';
    if (!s) return '<span class="badge warn">Not tested yet</span>';
    return '<span class="badge ' + (s.ok ? 'ok' : 'err') + '">' + (s.ok ? 'Connected' : 'Failed') + '</span> ' + E(s.provider + ' · ' + s.model + ' · ' + s.ms + ' ms · ' + GD.fmtDateTime(s.at)) + '<br>' + E(s.message);
  }

  /* ---------- website ---------- */
  function websiteTab() {
    loading();
    A('adminGetSettings').then(function (r) {
      var s = r.settings;
      function inp(id, label, val, type) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + E(val) + '"></div>'; }
      pane.innerHTML = '<form id="siteForm"><div class="card"><h3>Brand and homepage</h3>' + inp('s_site_name', 'Brand name', s.site_name) + inp('s_tagline', 'Tagline', s.tagline) + inp('s_hero_title', 'Homepage heading', s.hero_title) +
        '<div class="field"><label for="s_hero_text">Homepage supporting text</label><textarea id="s_hero_text" style="min-height:80px">' + E(s.hero_text) + '</textarea></div>' +
        '<div class="field"><label for="s_about_text">Academy introduction (About)</label><textarea id="s_about_text" style="min-height:100px">' + E(s.about_text) + '</textarea></div>' +
        '<div class="field"><label>Logo</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><img id="logoPrev" src="' + E(s.logo_url || 'icons/logo.svg') + '" alt="Current logo" width="48" height="48" style="border-radius:10px;background:var(--surface-2)"><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" aria-label="Upload logo"></div><div class="hint">PNG, JPG or WebP, up to about 1 MB. The logo file (only) is shared by link from Drive so it can show on the website.</div></div></div>' +
        '<div class="card" style="margin-top:14px"><h3>Owner, contact and footer</h3>' + inp('s_owner_name', 'Owner / proprietor', s.owner_name) + inp('s_brand_url', 'Brand website URL', s.brand_url, 'url') + inp('s_owner_url', 'Owner website URL', s.owner_url, 'url') + inp('s_social_handle', 'Social media handle', s.social_handle) +
        inp('s_contact_email', 'Contact email (verified only)', s.contact_email, 'email') + inp('s_contact_phone', 'Contact phone (leave blank if none)', s.contact_phone) + inp('s_contact_address', 'Contact address (leave blank if none)', s.contact_address) + inp('s_footer_text', 'Footer text', s.footer_text) + inp('s_copyright_text', 'Copyright text', s.copyright_text) +
        '<div class="field"><label for="s_social_links">Social media links (one per line: Label | https://url)</label><textarea id="s_social_links" style="min-height:80px">' + E((s.social_links || []).map(function (l) { return l.label + ' | ' + l.url; }).join('\n')) + '</textarea></div></div>' +
        '<div class="card" style="margin-top:14px"><h3>Subjects shown on homepage</h3><div class="field"><label for="s_subjects">One subject per line</label><textarea id="s_subjects" style="min-height:120px">' + E(s.subjects.join('\n')) + '</textarea></div></div>' +
        '<div class="card" style="margin-top:14px"><h3>FAQ</h3><div class="field"><label for="s_faq">Format: Question ? Answer — separate items with a blank line. Put the question on the first line and the answer on the following lines.</label><textarea id="s_faq" style="min-height:200px">' + E(s.faq.map(function (f) { return f.q + '\n' + f.a; }).join('\n\n')) + '</textarea></div></div>' +
        '<div class="card" style="margin-top:14px"><h3>Educational levels</h3><div class="field"><label for="s_levels">One per line: code | Label | instruction for the AI</label><textarea id="s_levels" style="min-height:200px;font-size:.85rem">' + E(s.levels.map(function (l) { return l.code + ' | ' + l.label + ' | ' + l.instruction; }).join('\n')) + '</textarea></div></div>' +
        '<div id="siteMsg"></div><p><button class="btn lg" type="submit">Save website settings</button></p></form>' +
        '<div class="card" style="margin-top:14px"><h3>Languages</h3><div id="langs"></div><p><button class="btn secondary" id="addLang">+ Add language</button></p></div>';
      renderLangs(r.languages);
      $('#addLang').onclick = function () { langModal(null); };
      $('#logoFile').onchange = function () {
        var f = this.files[0]; if (!f) return;
        if (f.size > 1000000) return GD.toast('The image is larger than 1 MB.', 'error');
        var rd = new FileReader();
        rd.onload = function () {
          var b64 = String(rd.result).split(',')[1];
          A('adminUploadLogo', { mimeType: f.type, base64: b64 }, { timeoutMs: 90000 }).then(function (x) { $('#logoPrev').src = x.logoUrl; GD.store.set('gd_cfg_cache', null); GD.toast('Logo updated', 'ok'); }, toast);
        };
        rd.readAsDataURL(f);
      };
      $('#siteForm').onsubmit = function (e) {
        e.preventDefault();
        var v = function (id) { return $('#s_' + id).value; };
        var lines = function (id) { return v(id).split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
        var settings = {
          site_name: v('site_name'), tagline: v('tagline'), hero_title: v('hero_title'), hero_text: v('hero_text'), about_text: v('about_text'),
          owner_name: v('owner_name'), brand_url: v('brand_url'), owner_url: v('owner_url'), social_handle: v('social_handle'), contact_email: v('contact_email'),
          contact_phone: v('contact_phone'), contact_address: v('contact_address'), footer_text: v('footer_text'), copyright_text: v('copyright_text'),
          subjects: lines('subjects'),
          social_links: lines('social_links').map(function (l) { var p = l.split('|'); return { label: (p[0] || '').trim(), url: (p.slice(1).join('|') || '').trim() }; }),
          faq: v('faq').split(/\n\s*\n/).map(function (b) { var p = b.trim().split('\n'); return { q: (p.shift() || '').trim(), a: p.join(' ').trim() }; }),
          levels: lines('levels').map(function (l) { var p = l.split('|'); return { code: (p[0] || '').trim(), label: (p[1] || '').trim(), instruction: p.slice(2).join('|').trim() }; })
        };
        var b = GD.$('button[type=submit]', this); GD.setBusy(b, true, 'Saving…');
        A('adminSaveSettings', { settings: settings }).then(function () { GD.setBusy(b, false); GD.store.set('gd_cfg_cache', null); GD.toast('Website settings saved', 'ok'); $('#siteMsg').innerHTML = ''; }, function (er) { GD.setBusy(b, false); $('#siteMsg').innerHTML = '<div class="alert error">' + E(er.message) + '</div>'; });
      };
    }, err);
  }
  function renderLangs(list) {
    $('#langs').innerHTML = table(['Order', 'Code', 'Label', 'Active', ''], list.map(function (l) {
      return '<tr><td>' + l.order + '</td><td>' + E(l.code) + '</td><td>' + E(l.label) + '</td><td>' + (l.active ? '✅' : '—') + '</td><td><button class="btn sm secondary" data-l="' + E(l.code) + '">Edit</button> <button class="btn sm danger" data-d="' + E(l.code) + '">Delete</button></td></tr>';
    }));
    GD.$$('[data-l]').forEach(function (b) { b.onclick = function () { langModal(list.filter(function (x) { return x.code === b.dataset.l; })[0]); }; });
    GD.$$('[data-d]').forEach(function (b) { b.onclick = function () { GD.confirm('Delete language “' + b.dataset.d + '”?', { danger: true, okText: 'Delete' }).then(function (ok) { if (ok) A('adminDeleteLanguage', { code: b.dataset.d, confirm: true }).then(function (r) { renderLangs(r.languages); GD.store.set('gd_cfg_cache', null); }, toast); }); }; });
  }
  function langModal(l) {
    l = l || { code: '', label: '', instruction: '', active: true, order: 99 };
    var m = GD.modal('<h3>' + (l.code ? 'Edit' : 'Add') + ' language</h3><div class="field"><label for="lC">Code (letters, numbers, dashes)</label><input id="lC" type="text" maxlength="30" value="' + E(l.code) + '"' + (l.code ? ' readonly' : '') + '></div><div class="field"><label for="lL">Label shown to users</label><input id="lL" type="text" maxlength="60" value="' + E(l.label) + '"></div><div class="field"><label for="lI">Instruction for the AI</label><textarea id="lI" style="min-height:90px">' + E(l.instruction) + '</textarea><div class="hint">Example: Write entirely in Tamil using Tamil script. Keep common technical terms in English in brackets.</div></div><div class="row two"><div class="field"><label for="lO">Order</label><input id="lO" type="number" min="1" max="999" value="' + l.order + '"></div><label class="switch" style="margin-top:26px"><span>Active</span><input type="checkbox" id="lA"' + (l.active ? ' checked' : '') + '></label></div><div id="lE"></div><div class="actions"><button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>Save</button></div>', { label: 'Language' });
    GD.$('[data-no]', m.el).onclick = function () { m.close(); };
    GD.$('[data-yes]', m.el).onclick = function () {
      A('adminSaveLanguage', { code: $('#lC', m.el).value, label: $('#lL', m.el).value, instruction: $('#lI', m.el).value, order: $('#lO', m.el).value, active: $('#lA', m.el).checked }).then(function (r) { m.close(); renderLangs(r.languages); GD.store.set('gd_cfg_cache', null); GD.toast('Language saved', 'ok'); }, function (e) { $('#lE', m.el).innerHTML = '<div class="alert error">' + E(e.message) + '</div>'; });
    };
  }

  /* ---------- usage & limits ---------- */
  function usageTab() {
    loading();
    A('adminGetSettings').then(function (r) {
      var s = r.settings;
      function num(id, label, val, hint) { return '<div class="field"><label for="u_' + id + '">' + label + '</label><input id="u_' + id + '" type="number" min="0" value="' + val + '">' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }
      function sw(id, label, val) { return '<label class="switch"><span>' + label + '</span><input type="checkbox" id="u_' + id + '"' + (val ? ' checked' : '') + '></label>'; }
      pane.innerHTML = '<form id="usageForm"><div class="card"><h3>Access</h3><div class="switches">' + sw('allow_guest', 'Allow guest use (no account)', s.allow_guest) + sw('registration_open', 'Allow new registrations', s.registration_open) + sw('public_notes_enabled', 'Allow public notes', s.public_notes_enabled) + sw('maintenance_mode', 'Maintenance mode (stops generation)', s.maintenance_mode) + '</div></div>' +
        '<div class="card" style="margin-top:14px"><h3>Limits</h3><div class="row two">' + num('guest_daily_limit', 'Guest: notes per day', s.guest_daily_limit) + num('user_daily_limit', 'Default user: notes per day', s.user_daily_limit, 'Per-user and per-role limits override this (Users tab / User_Roles sheet).') +
        num('global_daily_section_limit', 'Whole site: AI requests per day', s.global_daily_section_limit, 'Protects your free AI quota. One note uses about 1 + (sections) requests.') + num('rate_limit_per_minute', 'Requests per minute per user', s.rate_limit_per_minute) +
        num('max_input_chars', 'Maximum input size (characters)', s.max_input_chars) + num('max_chapters', 'Maximum chapters per note', s.max_chapters) + num('max_section_chars', 'Maximum characters per section', s.max_section_chars) + '</div></div><div id="usMsg"></div><p style="margin-top:14px"><button class="btn lg" type="submit">Save limits</button></p></form>';
      $('#usageForm').onsubmit = function (e) {
        e.preventDefault();
        var settings = {};
        ['allow_guest', 'registration_open', 'public_notes_enabled', 'maintenance_mode'].forEach(function (k) { settings[k] = $('#u_' + k).checked; });
        ['guest_daily_limit', 'user_daily_limit', 'global_daily_section_limit', 'rate_limit_per_minute', 'max_input_chars', 'max_chapters', 'max_section_chars'].forEach(function (k) { settings[k] = $('#u_' + k).value; });
        A('adminSaveSettings', { settings: settings }).then(function () { GD.store.set('gd_cfg_cache', null); GD.toast('Limits saved', 'ok'); }, function (er) { $('#usMsg').innerHTML = '<div class="alert error">' + E(er.message) + '</div>'; });
      };
    }, err);
  }

  /* ---------- logs ---------- */
  function logsTab() {
    pane.innerHTML = '<div class="tabs" id="lt"><button class="tab" data-l="usage" aria-selected="true">Usage</button><button class="tab" data-l="errors" aria-selected="false">API / server errors</button><button class="tab" data-l="activity" aria-selected="false">Activity</button><button class="tab" data-l="feedback" aria-selected="false">Feedback</button></div><div id="lg"></div>';
    function load(t) {
      GD.$$('#lt .tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.l === t); });
      $('#lg').innerHTML = '<span class="spinner"></span>';
      A('adminListLogs', { type: t, limit: 150 }).then(function (r) {
        if (!r.rows.length) return $('#lg').innerHTML = '<p class="muted">Nothing logged yet.</p>';
        var cols = Object.keys(r.rows[0]);
        $('#lg').innerHTML = '<p class="small muted">Showing the latest ' + r.rows.length + ' of ' + r.total + '</p>' + table(cols, r.rows.map(function (row) { return '<tr>' + cols.map(function (c) { return '<td class="wrap">' + E(row[c]) + '</td>'; }).join('') + '</tr>'; }));
      }, function (e) { $('#lg').innerHTML = '<div class="alert error">' + E(e.message) + '</div>'; });
    }
    GD.$$('#lt .tab').forEach(function (b) { b.onclick = function () { load(b.dataset.l); }; });
    load('usage');
  }

  /* ---------- data ---------- */
  function dataTab() {
    pane.innerHTML = '<div class="grid cols-2"><div class="card"><h3>Storage monitoring</h3><div id="st" class="small"><span class="spinner"></span></div></div>' +
      '<div class="card"><h3>Backup</h3><p class="small muted">Copies the database spreadsheet into the Application_Backups folder (keeps the newest 10).</p><button class="btn" id="bk">Back up database now</button><div id="bkMsg" class="small" style="margin-top:8px"></div></div>' +
      '<div class="card"><h3>Export records (CSV)</h3><div class="field"><label for="exS">Sheet</label><select id="exS"><option>Users</option><option>Notes</option><option>Note_Sections</option><option>Usage_Logs</option><option>Activity_Logs</option><option>Feedback</option><option>Error_Logs</option><option>Languages</option><option>App_Settings</option></select></div><button class="btn secondary" id="ex">Export</button></div>' +
      '<div class="card"><h3>Clean old files</h3><p class="small muted">Each option asks for confirmation first.</p><div style="display:flex;flex-direction:column;gap:8px"><button class="btn secondary" data-c="temp">Clear temporary files</button><button class="btn secondary" data-c="exports">Delete PDF/HTML exports older than 30 days</button><button class="btn danger" data-c="deleted_notes">Permanently remove deleted-note records older than 30 days</button></div></div></div>';
    A('adminStorage').then(function (r) {
      $('#st').innerHTML = storageHtml(r) + '<br><br>' + table(['Sheet', 'Rows'], r.sheets.map(function (s) { return '<tr><td>' + E(s.name) + '</td><td>' + s.rows + '</td></tr>'; }));
    }, function (e) { $('#st').textContent = e.message; });
    $('#bk').onclick = function () { var b = this; GD.setBusy(b, true, 'Backing up…'); A('adminBackup', {}, { timeoutMs: 120000 }).then(function (r) { GD.setBusy(b, false); $('#bkMsg').innerHTML = 'Saved as <a href="' + E(r.url) + '" target="_blank" rel="noopener noreferrer">' + E(r.name) + '</a>'; }, function (e) { GD.setBusy(b, false); toast(e); }); };
    $('#ex').onclick = function () { var b = this; GD.setBusy(b, true, 'Exporting…'); A('adminExport', { sheet: $('#exS').value }, { timeoutMs: 120000 }).then(function (r) { GD.setBusy(b, false); GD.download(GD.b64ToBlob(r.base64, r.mimeType), r.fileName); GD.toast(r.rows + ' rows exported', 'ok'); }, function (e) { GD.setBusy(b, false); toast(e); }); };
    GD.$$('[data-c]').forEach(function (b) {
      b.onclick = function () {
        GD.confirm('This will remove files or records and cannot be undone. Continue?', { danger: true, okText: 'Yes, clean up', title: 'Confirm cleanup' }).then(function (ok) { if (ok) A('adminCleanup', { kind: b.dataset.c, days: 30, confirm: true }, { timeoutMs: 120000 }).then(function (r) { GD.toast(r.cleaned + ' item(s) cleaned', 'ok'); }, toast); });
      };
    });
  }

  GD.init({ page: 'admin' });
  GD.$$('.tab[data-tab]').forEach(function (b) { b.onclick = function () { show(b.dataset.tab); }; });
  start();
})();
