/**
 * ui.js — shared interface: theme, header/footer, toasts, dialogs, sign-in modal, PWA install/update,
 * offline banner, configuration loading. Every page calls GD.init({ page: '...' }).
 */
(function () {
  var GD = window.GD = window.GD || {};

  /* ---------- helpers ---------- */
  GD.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  GD.$ = function (sel, root) { return (root || document).querySelector(sel); };
  GD.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  GD.fmtDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  GD.fmtDateTime = function (iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  GD.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  GD.safeParse = function (s, d) { try { return JSON.parse(s); } catch (e) { return d; } };
  GD.store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  GD.download = function (blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  GD.b64ToBlob = function (b64, mime) {
    var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  GD.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? res() : rej(new Error('copy failed')); } catch (e) { rej(e); } finally { t.remove(); }
    });
  };

  /* ---------- toast ---------- */
  GD.toast = function (msg, type, action) {
    var box = GD.$('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    if (action) {
      var b = document.createElement('button'); b.textContent = action.label;
      b.onclick = function () { action.run(); t.remove(); };
      t.appendChild(b);
    }
    box.appendChild(t);
    if (!action) setTimeout(function () { t.remove(); }, type === 'error' ? 6500 : 3500);
    return t;
  };

  /* ---------- modal ---------- */
  GD.modal = function (html, opts) {
    opts = opts || {};
    var prevFocus = document.activeElement;
    var ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + GD.esc(opts.label || 'Dialog') + '">' + html + '</div>';
    document.body.appendChild(ov);
    function close(v) { ov.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); if (opts.onClose) opts.onClose(v); }
    function onKey(e) { if (e.key === 'Escape' && !opts.persistent) close(null); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && !opts.persistent) close(null); });
    var first = GD.$('input, textarea, select, button', ov);
    if (first) first.focus();
    return { el: ov.firstChild, overlay: ov, close: close };
  };

  GD.confirm = function (message, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var m = GD.modal('<h3>' + GD.esc(o.title || 'Please confirm') + '</h3><p>' + GD.esc(message) + '</p><div class="actions"><button class="btn secondary" data-no>Cancel</button><button class="btn ' + (o.danger ? 'danger' : '') + '" data-yes>' + GD.esc(o.okText || 'Yes, continue') + '</button></div>', { label: 'Confirm', onClose: function (v) { resolve(v === true); } });
      GD.$('[data-no]', m.el).onclick = function () { m.close(false); };
      GD.$('[data-yes]', m.el).onclick = function () { m.close(true); };
    });
  };

  GD.prompt = function (title, value, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var m = GD.modal('<h3>' + GD.esc(title) + '</h3><div class="field"><input type="' + (o.type || 'text') + '" maxlength="' + (o.max || 150) + '" value="' + GD.esc(value || '') + '" aria-label="' + GD.esc(title) + '"></div><div class="actions"><button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>' + GD.esc(o.okText || 'Save') + '</button></div>', { label: title, onClose: function (v) { resolve(v); } });
      var inp = GD.$('input', m.el);
      inp.select();
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') m.close(inp.value); });
      GD.$('[data-no]', m.el).onclick = function () { m.close(null); };
      GD.$('[data-yes]', m.el).onclick = function () { m.close(inp.value); };
    });
  };

  GD.setBusy = function (btn, busy, text) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + GD.esc(text || 'Please wait…'); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  };

  /* ---------- theme ---------- */
  GD.theme = {
    get: function () { return GD.store.get('gd_theme', null) || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); },
    apply: function (t) { document.documentElement.setAttribute('data-theme', t); var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'dark' ? '#0b1220' : '#1d4ed8'); },
    toggle: function () { var t = GD.theme.get() === 'dark' ? 'light' : 'dark'; GD.store.set('gd_theme', t); GD.theme.apply(t); GD.$$('[data-theme-btn]').forEach(function (b) { b.textContent = t === 'dark' ? '☀️' : '🌙'; }); }
  };
  GD.theme.apply(GD.theme.get());

  /* ---------- configuration (public site content) ---------- */
  GD.FALLBACK_CFG = {
    site: {
      name: 'GD TECH ACADEMY', tagline: 'Learn • Understand • Practice • Grow', heroTitle: 'Create Complete Study Notes with AI',
      heroText: 'Enter any subject, chapter, or topic and generate detailed, easy-to-understand educational notes in your preferred language.',
      about: 'GD TECH ACADEMY (GD = Gyaan Ka Dabba) focuses on educational technology, computer application training, hardware and basic networking education, and beginner-friendly digital learning resources.',
      owner: 'MD SABBIR', brandUrl: 'https://gyaankadabba.blogspot.com', ownerUrl: 'https://sabbirhelp.blogspot.com', socialHandle: '@GYAANKADABBA', socialLinks: [],
      contactEmail: 'gdtechacademy119@gmail.com', contactPhone: '', contactAddress: '', logoUrl: '', footerText: 'Free learning resources by GD TECH ACADEMY.',
      copyright: 'GD TECH ACADEMY. All rights reserved.',
      subjects: ['Computer Basics', 'Computer Hardware', 'Networking', 'MS Office', 'Internet & Web', 'Programming', 'Science', 'Mathematics', 'Social Science', 'Languages', 'Commerce', 'General Knowledge'],
      faq: []
    },
    languages: [
      { code: 'simple-english', label: 'Simple English' }, { code: 'english-hinglish', label: 'English + Hinglish' }, { code: 'pure-hindi', label: 'Pure Hindi (हिंदी)' },
      { code: 'simple-hinglish', label: 'Simple Hinglish' }, { code: 'bengali', label: 'Bengali (বাংলা)' }, { code: 'english-bengali', label: 'English + Bengali' },
      { code: 'urdu', label: 'Urdu (اردو)' }, { code: 'english-urdu', label: 'English + Urdu' }, { code: 'other', label: 'Other language (specify)' }
    ],
    levels: [
      { code: 'auto', label: 'Auto-select (recommended)' }, { code: 'beginner', label: 'Beginner' }, { code: 'school', label: 'School Level' }, { code: 'class5-8', label: 'Class 5–8' },
      { code: 'class9-10', label: 'Class 9–10' }, { code: 'class11-12', label: 'Class 11–12' }, { code: 'college', label: 'College Level' },
      { code: 'competitive', label: 'Competitive Exam Preparation' }, { code: 'advanced', label: 'Advanced' }, { code: 'general', label: 'General Learning' }
    ],
    depths: [{ code: 'basic', label: 'Basic Notes' }, { code: 'detailed', label: 'Detailed Notes' }, { code: 'comprehensive', label: 'Comprehensive Notes' }, { code: 'advanced', label: 'Advanced Notes' }],
    limits: { maxInputChars: 6000, maxChapters: 12 },
    flags: { allowGuest: true, registrationOpen: true, maintenance: false, publicNotes: true },
    _fallback: true
  };
  var cfgPromise = null;
  GD.cfg = GD.store.get('gd_cfg', null) || GD.FALLBACK_CFG;

  GD.getConfig = function () {
    if (cfgPromise) return cfgPromise;
    var cached = GD.store.get('gd_cfg_cache', null);
    var fresh = cached && (Date.now() - cached.at < 10 * 60 * 1000);
    if (cached) GD.cfg = cached.cfg;
    var fetcher = GD.api.configured() && navigator.onLine
      ? GD.api.call('getConfig', {}, { noAuth: true, timeoutMs: 20000 }).then(function (c) { GD.cfg = c; GD.store.set('gd_cfg_cache', { at: Date.now(), cfg: c }); return c; })
      : Promise.resolve(GD.cfg);
    cfgPromise = fresh ? (fetcher.catch(function () { }), Promise.resolve(GD.cfg)) : fetcher.catch(function () { return GD.cfg; });
    return cfgPromise;
  };

  /* ---------- logo / chrome ---------- */
  function logoHtml(cfg) {
    var url = cfg.site.logoUrl;
    return url ? '<img src="' + GD.esc(url) + '" alt="" width="38" height="38" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src=\'icons/logo.svg\'">' : '<img src="icons/logo.svg" alt="" width="38" height="38">';
  }

  var NAV = [['index.html', 'Home', 'home'], ['notes.html', 'Create Notes', 'notes'], ['dashboard.html', 'My Library', 'dashboard'], ['about.html', 'About', 'about'], ['contact.html', 'Contact', 'contact']];

  GD.renderChrome = function (page) {
    var cfg = GD.cfg, s = cfg.site, user = GD.session.user();
    var header = GD.$('#siteHeader'), footer = GD.$('#siteFooter');
    if (header) {
      var links = NAV.map(function (n) { return '<a href="' + n[0] + '"' + (n[2] === page ? ' aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('');
      if (user && user.role === 'admin') links += '<a href="admin.html"' + (page === 'admin' ? ' aria-current="page"' : '') + '>Admin</a>';
      header.className = 'site-header';
      header.innerHTML = '<div class="container header-row" style="position:relative"><a class="brand" href="index.html" aria-label="' + GD.esc(s.name) + ' home">' + logoHtml(cfg) +
        '<span class="t"><span>' + GD.esc(s.name) + '</span><small>' + GD.esc(s.tagline) + '</small></span></a>' +
        '<nav class="nav" id="mainNav" aria-label="Main">' + links + '</nav>' +
        '<div class="header-tools"><button class="btn sm secondary" id="installBtn" hidden>⬇ Install App</button>' +
        '<button class="icon-btn" data-theme-btn aria-label="Toggle light or dark mode">' + (GD.theme.get() === 'dark' ? '☀️' : '🌙') + '</button>' +
        (user ? '<a class="btn sm" href="dashboard.html">' + GD.esc(user.isGuest ? 'Guest' : (user.name || 'Me').split(' ')[0]) + '</a>' : '<button class="btn sm" id="signInBtn">Sign in</button>') +
        '<button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="mainNav">☰</button></div></div>';
      var nav = GD.$('#mainNav'), mb = GD.$('#menuBtn');
      mb.onclick = function () { var o = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', o); };
      GD.$('[data-theme-btn]', header).onclick = GD.theme.toggle;
      var si = GD.$('#signInBtn'); if (si) si.onclick = function () { GD.auth.open().then(function (u) { if (u) location.reload(); }); };
      if (GD.installEvent) GD.$('#installBtn').hidden = false;
      GD.$('#installBtn').onclick = GD.promptInstall;
    }
    if (footer) {
      var social = s.socialHandle ? '<li>Social: <strong>' + GD.esc(s.socialHandle) + '</strong></li>' : '';
      (s.socialLinks || []).forEach(function (l) { social += '<li><a href="' + GD.esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + GD.esc(l.label) + '</a></li>'; });
      footer.className = 'site-footer';
      footer.innerHTML = '<div class="container"><div class="footer-grid">' +
        '<div><h4>' + GD.esc(s.name) + '</h4><p>' + GD.esc(s.tagline) + '</p><p class="small">' + GD.esc(s.footerText) + '</p></div>' +
        '<div><h4>Websites</h4><ul><li><a href="' + GD.esc(s.brandUrl) + '" target="_blank" rel="noopener noreferrer">' + GD.esc(s.brandUrl.replace('https://', '')) + '</a></li>' +
        '<li>Owner: <a href="' + GD.esc(s.ownerUrl) + '" target="_blank" rel="noopener noreferrer">' + GD.esc(s.ownerUrl.replace('https://', '')) + '</a></li>' + social + '</ul></div>' +
        '<div><h4>Quick links</h4><ul><li><a href="about.html">About Us</a></li><li><a href="contact.html">Contact Us</a></li><li><a href="legal.html#privacy">Privacy Policy</a></li><li><a href="legal.html#terms">Terms and Conditions</a></li><li><a href="legal.html#disclaimer">Disclaimer</a></li><li><a href="legal.html#copyright">Copyright</a></li></ul></div></div>' +
        '<div class="copy">© <span id="yr"></span> ' + GD.esc(s.copyright) + ' Proprietor: ' + GD.esc(s.owner) + '. AI-generated notes can contain mistakes — verify important facts.<br>Install this app: use your browser menu → “Install app” / “Add to Home screen”.</div></div>';
      GD.$('#yr').textContent = new Date().getFullYear();
    }
  };

  /* ---------- auth ---------- */
  GD.auth = {
    open: function (opts) {
      opts = opts || {};
      var f = GD.cfg.flags || {};
      return new Promise(function (resolve) {
        var tabsHtml = '<div class="tabs" role="tablist"><button class="tab" role="tab" data-t="in" aria-selected="true">Sign in</button>' +
          (f.registrationOpen !== false ? '<button class="tab" role="tab" data-t="up" aria-selected="false">Create account</button>' : '') + '</div>';
        var m = GD.modal(
          '<h3>' + GD.esc(opts.title || 'Welcome to ' + GD.cfg.site.name) + '</h3>' + (opts.message ? '<p class="muted">' + GD.esc(opts.message) + '</p>' : '') + tabsHtml +
          '<form id="authForm" novalidate><div class="field" data-f="name" hidden><label for="aName">Your name</label><input id="aName" type="text" autocomplete="name" maxlength="60"></div>' +
          '<div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="email" maxlength="120" required></div>' +
          '<div class="field"><label for="aPass">Password</label><input id="aPass" type="password" autocomplete="current-password" maxlength="100" required><div class="hint" data-f="phint" hidden>At least 8 characters with a letter and a number.</div></div>' +
          '<div id="aErr" role="alert"></div><button class="btn" style="width:100%" type="submit" id="aGo">Sign in</button></form>' +
          (f.allowGuest && !opts.noGuest ? '<p class="center small muted" style="margin:14px 0 6px">or</p><button class="btn secondary" style="width:100%" id="aGuest">Continue as guest</button><p class="hint center">Guests have a smaller daily limit and cannot manage a library across devices.</p>' : '') +
          '<div class="actions"><button class="btn ghost sm" id="aCancel">Cancel</button></div>',
          { label: 'Sign in', onClose: function (v) { resolve(v || null); } });
        var mode = 'in', el = m.el;
        function setMode(t) {
          mode = t;
          GD.$$('.tab', el).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.t === t); });
          GD.$('[data-f=name]', el).hidden = t !== 'up'; GD.$('[data-f=phint]', el).hidden = t !== 'up';
          GD.$('#aGo', el).textContent = t === 'up' ? 'Create account' : 'Sign in';
          GD.$('#aPass', el).setAttribute('autocomplete', t === 'up' ? 'new-password' : 'current-password');
          GD.$('#aErr', el).innerHTML = '';
        }
        GD.$$('.tab', el).forEach(function (b) { b.onclick = function () { setMode(b.dataset.t); }; });
        function done(res) { GD.session.set(res.token, res.user); m.close(res.user); }
        function err(e) { GD.$('#aErr', el).innerHTML = '<div class="alert error">' + GD.esc(e.message) + '</div>'; }
        GD.$('#authForm', el).onsubmit = function (ev) {
          ev.preventDefault();
          var email = GD.$('#aEmail', el).value.trim(), pass = GD.$('#aPass', el).value, name = GD.$('#aName', el).value.trim();
          if (!email || !pass) return err({ message: 'Please enter your email and password.' });
          if (mode === 'up' && name.length < 2) return err({ message: 'Please enter your name.' });
          var btn = GD.$('#aGo', el); GD.setBusy(btn, true, mode === 'up' ? 'Creating…' : 'Signing in…');
          GD.api.call(mode === 'up' ? 'register' : 'login', { email: email, password: pass, name: name }, { noAuth: true })
            .then(done, function (e) { GD.setBusy(btn, false); err(e); });
        };
        var g = GD.$('#aGuest', el);
        if (g) g.onclick = function () { GD.setBusy(g, true, 'Starting…'); GD.api.call('guestLogin', {}, { noAuth: true }).then(done, function (e) { GD.setBusy(g, false); err(e); }); };
        GD.$('#aCancel', el).onclick = function () { m.close(null); };
      });
    },
    ensure: function (opts) {
      if (GD.session.token()) {
        return GD.api.call('me').then(function (r) { GD.session.setUser(r.user); return r.user; }, function (e) {
          if (e.network || e.code === 'NOT_CONFIGURED') return GD.session.user();
          return GD.auth.open(opts);
        });
      }
      return GD.auth.open(opts);
    },
    logout: function () { GD.session.clear(); location.href = 'index.html'; }
  };

  /* ---------- PWA ---------- */
  GD.installEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); GD.installEvent = e;
    var b = GD.$('#installBtn'); if (b) b.hidden = false;
  });
  window.addEventListener('appinstalled', function () { GD.installEvent = null; var b = GD.$('#installBtn'); if (b) b.hidden = true; GD.toast('App installed 🎉', 'ok'); });
  GD.promptInstall = function () {
    if (!GD.installEvent) return GD.toast('Use your browser menu → “Install app” or “Add to Home screen”.');
    GD.installEvent.prompt();
    GD.installEvent.userChoice.then(function () { GD.installEvent = null; var b = GD.$('#installBtn'); if (b) b.hidden = true; });
  };

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('service-worker.js').then(function (reg) {
      function offerUpdate(worker) {
        GD.toast('A new version of the app is ready.', '', { label: 'Refresh', run: function () { worker.postMessage({ type: 'SKIP_WAITING' }); } });
      }
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
      });
      setInterval(function () { reg.update().catch(function () { }); }, 60 * 60 * 1000);
    }).catch(function () { /* SW is optional */ });
    // Reload only when an UPDATE takes over (a controller already existed) — not on the very first install.
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!hadController || reloaded) return; reloaded = true; location.reload(); });
  }

  function offlineBar() {
    var bar = null;
    function update() {
      if (!navigator.onLine && !bar) {
        bar = document.createElement('div'); bar.className = 'offline-bar'; bar.setAttribute('role', 'status');
        bar.textContent = 'You are offline. You can browse saved pages, but AI generation, saving and downloads from the cloud need internet.';
        document.body.insertBefore(bar, document.body.firstChild);
      } else if (navigator.onLine && bar) { bar.remove(); bar = null; }
      document.dispatchEvent(new CustomEvent('gd:connection', { detail: navigator.onLine }));
    }
    window.addEventListener('online', update); window.addEventListener('offline', update); update();
  }

  /* ---------- init ---------- */
  GD.init = function (opts) {
    opts = opts || {};
    GD.renderChrome(opts.page);
    offlineBar();
    registerSW();
    document.addEventListener('gd:signedout', function () { GD.toast('Your session ended. Please sign in again.'); GD.renderChrome(opts.page); });
    return GD.getConfig().then(function (cfg) { GD.renderChrome(opts.page); return cfg; });
  };
})();
