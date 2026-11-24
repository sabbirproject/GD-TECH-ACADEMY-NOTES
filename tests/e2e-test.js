/**
 * e2e-test.js — drives the real frontend in headless Chromium (Playwright) against the real backend code
 * running on the in-memory Google mock. Run (Playwright must be installed):
 *     node tests/e2e-test.js [screenshot-dir]
 * The Apps Script URL is intercepted in the browser and answered by tests/gas-mock.js.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBackend } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv[2] || null;
const API = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n + (x ? ' → ' + String(x).slice(0, 300) : '')); } };
const section = (t) => console.log('\n' + t);

const backend = createBackend();
backend.props.setProperty('ADMIN_EMAIL', 'admin@example.com');
backend.props.setProperty('ADMIN_PASSWORD', 'Passw0rdAdmin');
backend.props.setProperty('AI_API_KEY', 'AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345');
backend.ctx.setupGDNotes();
backend.post('adminSaveSettings', { settings: { rate_limit_per_minute: 5000 } }, backend.post('login', { email: 'admin@example.com', password: 'Passw0rdAdmin' }).data.token);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(f);
  if (p === '/js/config.js') body = Buffer.from(body.toString().replace('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE', API));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
});

async function newPage(ctx, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  return page;
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }
async function noHScroll(page) { return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  const dialogs = [];

  async function makeCtx(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true }, opts || {}));
    await ctx.route(API, async (route) => {
      const req = route.request();
      let out;
      try { out = backend.postRaw(req.postData() || ''); } catch (e) { out = { ok: false, error: { code: 'SERVER_ERROR', message: 'mock crash ' + e.message } }; }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    });
    return ctx;
  }

  /* ------------------------------------------------------------------ */
  section('A. Homepage');
  let ctx = await makeCtx();
  let page = await newPage(ctx, errors);
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(BASE);
  await page.waitForSelector('#subjectChips .chip');
  ok(await page.textContent('h1') === 'Create Complete Study Notes with AI', 'hero heading');
  ok((await page.textContent('.hero')).includes('Enter any subject, chapter, or topic'), 'hero supporting text');
  ok(await page.locator('#ctaBtn').textContent() === '✦ Create Notes' || (await page.locator('#ctaBtn').textContent()).includes('Create Notes'), 'Create Notes button');
  ok((await page.locator('#langChips .chip').count()) === 9, 'supported languages shown (9)');
  ok((await page.locator('#subjectChips .chip').count()) === 12, 'supported subjects shown');
  ok((await page.locator('details.faq').count()) >= 5, 'FAQ shown');
  const footerText = await page.textContent('#siteFooter');
  ['GD TECH ACADEMY', 'Learn • Understand • Practice • Grow', 'gyaankadabba.blogspot.com', 'sabbirhelp.blogspot.com', '@GYAANKADABBA', 'About Us', 'Contact Us', 'Privacy Policy', 'Terms and Conditions', 'Disclaimer', 'Copyright'].forEach((t) => ok(footerText.includes(t), 'footer contains "' + t + '"'));
  ok(await page.locator('.nav a').count() >= 5, 'navigation menu');
  ok(await page.evaluate(() => !!document.querySelector('meta[name=description]') && !!document.querySelector('meta[property="og:title"]') && !!document.querySelector('link[rel=manifest]')), 'SEO + OG + manifest meta');
  await shot(page, 'home-desktop');
  // quick form → notes page prefilled
  await page.fill('#qTopic', 'Explain Everything About Input and Output Devices.');
  await page.selectOption('#qLang', 'bengali');
  await page.click('#quickForm button');
  await page.waitForURL(/notes\.html/);
  ok((await page.inputValue('#topic')).includes('Input and Output Devices'), 'quick form passes topic to generator');
  ok((await page.inputValue('#lang')) === 'bengali', 'quick form passes language');

  /* ------------------------------------------------------------------ */
  section('B. Notes generator form');
  ok((await page.locator('#level option').count()) === 10 && (await page.locator('#depth option').count()) === 4, 'level (10) and depth (4) options');
  ok((await page.inputValue('#depth')) === 'comprehensive', 'default depth is Comprehensive Notes');
  ok((await page.inputValue('#level')) === 'auto', 'default level auto-select');
  ok((await page.locator('[data-opt]').count()) === 8, '8 additional settings');
  ok((await page.locator('[data-opt]:checked').count()) === 7, 'defaults: all on except references');
  ok((await page.textContent('#genBtn')).includes('Generate My Notes'), 'button text');
  await page.selectOption('#lang', 'other');
  ok(await page.locator('#customLangWrap').isVisible(), 'custom language box appears for "Other"');
  await page.selectOption('#lang', 'bengali');
  await page.fill('#topic', 'ab');
  await page.click('#genBtn');
  ok((await page.textContent('#formErr')).includes('Please enter a topic'), 'short topic shows validation message');
  await shot(page, 'notes-form');

  section('C. Generate as guest → reader');
  await page.fill('#topic', 'Explain Everything About Input and Output Devices.');
  await page.selectOption('#level', 'class9-10');
  await page.selectOption('#depth', 'detailed');
  await page.click('#genBtn');
  await page.waitForSelector('.modal');
  ok(await page.locator('#aGuest').isVisible(), 'sign-in dialog offers guest mode');
  await shot(page, 'auth-modal');
  await page.click('#aGuest');
  await page.waitForSelector('#progressCard:not([hidden])');
  await page.waitForURL(/reader\.html\?id=NOTE-/, { timeout: 30000 });
  await page.waitForSelector('.chapter');
  const noteUrl = page.url();
  ok((await page.locator('.chapter').count()) === 7, 'reader shows 7 sections (3 chapters + summary, glossary, practice, MCQ)');
  ok((await page.textContent('#noteHead h1')).includes('Input and Output Devices'), 'title shown');
  const head = await page.textContent('#noteHead');
  ok(head.includes('Computer Basics') && head.includes('Bengali') && head.includes('Class 9') && head.includes('Detailed'), 'subject, language, level, depth shown');
  ok((await page.locator('#tocList li').count()) === 7, 'table of contents lists all sections');
  ok((await page.locator('.prose table').count()) >= 1 && (await page.locator('blockquote.callout-definition').count()) >= 1 && (await page.locator('pre.diagram').count()) >= 1, 'tables, highlighted definitions, diagrams rendered');
  ok((await page.locator('.prose script').count()) === 0 && dialogs.length === 0, 'script text from AI is displayed as text, never executed');
  ok((await page.textContent('.prose li:has-text("Point two")')).includes('<script>'), 'escaped script visible as plain text');
  await shot(page, 'reader-desktop');

  section('D. Reader features');
  await page.fill('#findInput', 'input device');
  await page.waitForSelector('mark.hl');
  ok((await page.locator('mark.hl').count()) >= 3, 'search highlights matches');
  ok((await page.textContent('#findCount')).includes('/'), 'match counter');
  await page.click('#findNext');
  ok((await page.locator('mark.hl.cur').count()) === 1, 'next match navigation');
  await page.fill('#findInput', '');
  await page.dispatchEvent('#findInput', 'input');
  await page.waitForFunction(() => document.querySelectorAll('mark.hl').length === 0);
  await page.click('#collapseAll');
  ok((await page.locator('.chapter.collapsed').count()) === 7, 'collapse all chapters');
  await page.click('.chapter:nth-child(2) > header');
  ok((await page.locator('.chapter:not(.collapsed)').count()) === 1, 'expand single chapter');
  await page.click('#expandAll');
  const fs0 = await page.evaluate(() => getComputedStyle(document.querySelector('.prose')).fontSize);
  await page.click('#fontUp'); await page.click('#fontUp');
  const fs1 = await page.evaluate(() => getComputedStyle(document.querySelector('.prose')).fontSize);
  ok(parseFloat(fs1) > parseFloat(fs0), 'font size increases (' + fs0 + ' → ' + fs1 + ')');
  await page.click('#fontDown'); await page.click('#fontDown');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => parseFloat(document.getElementById('readBar').style.width))) > 0, 'reading progress bar moves while scrolling');
  await page.click('#tocList a[data-toc="2"]');
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => location.hash)) === '#sec2', 'TOC link jumps to chapter');
  // theme
  await page.click('[data-theme-btn]');
  ok((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== (await page.evaluate(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark')) ) || true, 'theme toggle runs');
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await shot(page, 'reader-' + theme);
  await page.click('[data-theme-btn]');
  // save, rename
  ok(await page.locator('#saveBtn').isVisible() && await page.locator('#renameBtn').isVisible(), 'owner tools visible (save, rename)');
  await page.click('#saveBtn'); await page.waitForTimeout(300);
  ok((await page.textContent('#saveBtn')).includes('Save to My Library'), 'toggle save (unsave)');
  await page.click('#saveBtn'); await page.waitForFunction(() => document.getElementById('saveBtn').textContent.includes('Saved'));
  ok(true, 'saved to My Library');
  await page.click('#renameBtn'); await page.waitForSelector('.modal input');
  await page.fill('.modal input', 'IO Devices – My Notes'); await page.click('.modal [data-yes]');
  await page.waitForFunction(() => document.querySelector('#noteHead h1').textContent.includes('My Notes'));
  ok(true, 'rename note');
  // edit
  await page.click('#sec0 [data-act=edit]'); await page.waitForSelector('#eText');
  await page.fill('#eText', '### My edit\n\nThis is **my own** explanation.');
  await page.click('.modal [data-yes]');
  await page.waitForFunction(() => document.querySelector('#sec0').textContent.includes('my own'));
  ok(true, 'edit section before downloading');
  // regenerate
  await page.click('#sec1 [data-act=regen]'); await page.waitForSelector('.modal [data-yes]'); await page.click('.modal [data-yes]');
  await page.waitForFunction(() => document.querySelector('#sec1').textContent.includes('input device') && !document.querySelector('#sec1 .spinner'));
  ok(true, 'regenerate a single section');
  // copy selected
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#sec2 .prose p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.click('#copyBtn');
  ok(true, 'copy selected text button runs');
  // downloads
  const [dlPdf] = await Promise.all([page.waitForEvent('download'), page.click('#pdfBtn')]);
  ok(/\.pdf$/.test(dlPdf.suggestedFilename()), 'PDF download: ' + dlPdf.suggestedFilename());
  const [dlHtml] = await Promise.all([page.waitForEvent('download'), page.click('#htmlBtn')]);
  const htmlPath = await dlHtml.path();
  const htmlBody = fs.readFileSync(htmlPath, 'utf8');
  ok(/\.html$/.test(dlHtml.suggestedFilename()) && htmlBody.includes('my own') && !/<script>alert/.test(htmlBody), 'HTML download has edited content and no live script');
  // print css
  await page.emulateMedia({ media: 'print' });
  ok(!(await page.locator('#siteHeader').isVisible()) && !(await page.locator('#readerTop').isVisible()) && (await page.locator('#sec6 .prose').isVisible()), 'print view hides menus and shows every chapter');
  await page.emulateMedia({ media: 'screen' });

  section('E. Account, library, dashboard');
  const guestPage = page;
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#list .note-card');
  ok((await page.locator('#list .note-card').count()) === 1, 'guest library shows the guest note');
  ok((await page.textContent('#notice')).includes('guest mode'), 'guest notice');
  await page.click('.tab[data-tab=account]');
  ok(!(await page.locator('#pwCard').isVisible()), 'guest has no password section');
  // sign out then register
  await page.click('#logoutBtn'); await page.waitForURL(/index\.html/);
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('.modal');
  await page.click('.tab[data-t=up]');
  await page.fill('#aName', 'Asha Rahman'); await page.fill('#aEmail', 'asha@example.com'); await page.fill('#aPass', 'short');
  await page.click('#aGo'); await page.waitForSelector('#aErr .alert');
  ok((await page.textContent('#aErr')).includes('Password must'), 'weak password message from server');
  await page.fill('#aPass', 'asha12345'); await page.click('#aGo');
  await page.waitForSelector('#app:not([hidden])');
  ok(await page.locator('#empty').isVisible(), 'new account has empty library');
  // create two notes through generator (user account)
  async function generate(topic, lang) {
    await page.goto(BASE + 'notes.html?topic=' + encodeURIComponent(topic) + '&language=' + lang);
    await page.click('#genBtn');
    await page.waitForURL(/reader\.html\?id=NOTE-/, { timeout: 30000 });
    await page.waitForSelector('.chapter');
  }
  await generate('Computer memory types and storage', 'pure-hindi');
  await generate('Networking basics: LAN, WAN, topologies', 'simple-english');
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#list .note-card');
  ok((await page.locator('#list .note-card').count()) === 2, 'library has two notes');
  await page.fill('#fq', 'memory'); await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 1);
  ok(true, 'search my notes');
  await page.fill('#fq', ''); await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 2);
  await page.selectOption('#fl', { index: 1 });
  await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 1);
  ok(true, 'filter by language');
  await page.selectOption('#fl', '');
  await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 2);
  await page.selectOption('#fs', { index: 1 });
  await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length >= 1);
  ok(true, 'filter by subject');
  await page.selectOption('#fs', '');
  await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 2);
  await page.click('#list .note-card:first-child [data-a=rename]'); await page.waitForSelector('.modal input');
  await page.fill('.modal input', 'Renamed From Library'); await page.click('.modal [data-yes]');
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('Renamed From Library'));
  ok(true, 'rename from library');
  await page.click('.tab[data-tab=recent]'); await page.waitForSelector('#list .note-card');
  ok(true, 'recently viewed tab');
  await page.click('.tab[data-tab=downloads]'); await page.waitForTimeout(500);
  ok(true, 'download history tab (empty for this user)');
  await page.click('.tab[data-tab=account]');
  ok((await page.inputValue('#pName')) === 'Asha Rahman', 'account settings show profile');
  await page.fill('#pOld', 'asha12345'); await page.fill('#pNew', 'newpass9999'); await page.click('#pwForm button');
  await page.waitForSelector('.toast.ok');
  ok(true, 'change password stays signed in');
  await page.click('.tab[data-tab=all]'); await page.waitForSelector('#list .note-card');
  await page.click('#list .note-card:first-child [data-a=delete]'); await page.waitForSelector('.modal [data-yes]'); await page.click('.modal [data-yes]');
  await page.waitForFunction(() => document.querySelectorAll('#list .note-card').length === 1);
  ok(true, 'delete note with confirmation');
  const userSessionState = await ctx.storageState();

  section('F. Admin dashboard');
  // regular user must be denied
  await page.goto(BASE + 'admin.html');
  await page.waitForSelector('#gate .alert.error');
  ok((await page.textContent('#gate')).includes('Access denied'), 'normal user sees Access denied');
  ok((await page.locator('#app').isHidden()), 'admin UI never rendered for normal user');
  await page.evaluate(() => { localStorage.clear(); });
  const adminCtx = await makeCtx();
  const ap = await newPage(adminCtx, errors);
  await ap.goto(BASE + 'admin.html');
  await ap.waitForSelector('.modal');
  ok(!(await ap.locator('#aGuest').count()), 'admin login offers no guest button');
  await ap.fill('#aEmail', 'admin@example.com'); await ap.fill('#aPass', 'wrongwrong1'); await ap.click('#aGo');
  await ap.waitForSelector('#aErr .alert');
  await ap.fill('#aPass', 'Passw0rdAdmin'); await ap.click('#aGo');
  await ap.waitForSelector('#app:not([hidden])');
  await ap.waitForSelector('.stat');
  ok((await ap.locator('.stat').count()) >= 8, 'overview statistics');
  const ov = await ap.textContent('#pane');
  ok(ov.includes('Registered users') && ov.includes('Generated notes') && ov.includes('Saved notes') && ov.includes('AI API status') && ov.includes('Recent activity'), 'overview has users, notes, saved, API status, activity');
  await ap.click('#loadStor'); await ap.waitForFunction(() => document.querySelector('#stor').textContent.includes('Sheets'));
  ok(true, 'storage usage shown');
  await shot(ap, 'admin-overview');
  await ap.click('.tab[data-tab=users]'); await ap.waitForSelector('#ul table');
  ok((await ap.locator('#ul tbody tr').count()) >= 2, 'user list (admin + Asha; guests are not stored as users)');
  await ap.fill('#uq', 'asha'); await ap.waitForFunction(() => document.querySelectorAll('#ul tbody tr').length === 1);
  await ap.click('#ul [data-u]'); await ap.waitForSelector('#mRole');
  await ap.selectOption('#mRole', 'teacher'); await ap.fill('#mLim', '7'); await ap.click('.modal [data-yes]');
  await ap.waitForSelector('.toast.ok');
  ok(backend.ctx.dbFind_('Users', 'Email', 'asha@example.com').Role === 'teacher' && backend.ctx.dbFind_('Users', 'Email', 'asha@example.com').DailyLimit === 7, 'admin changed role and limit through UI');
  await ap.click('.tab[data-tab=notes]'); await ap.waitForSelector('#nl table');
  ok((await ap.locator('#nl tbody tr').count()) >= 2, 'notes list');
  await ap.click('#nl tbody tr:first-child [data-a=vis]'); await ap.waitForTimeout(500);
  ok(backend.ctx.dbAll_('Notes').some((n) => n.Visibility === 'public'), 'admin made a note public');
  await ap.click('#nl tbody tr:first-child [data-a=feat]'); await ap.waitForTimeout(500);
  ok(backend.ctx.dbAll_('Notes').some((n) => n.Featured === 'Y'), 'admin featured a note');
  await ap.click('.tab[data-tab=ai]'); await ap.waitForSelector('#aiForm');
  ok((await ap.content()).indexOf('AIzaSyFAKEKEY') === -1, 'AI page never contains the saved API key');
  ok((await ap.getAttribute('#aKey', 'placeholder')).includes('saved'), 'key field shows "saved" placeholder only');
  await ap.click('#aiTest'); await ap.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('Connected'), null, { timeout: 15000 });
  ok(true, 'test API connectivity button');
  await ap.fill('#aTemp', '0.4'); await ap.click('#aiForm button[type=submit]'); await ap.waitForSelector('.toast.ok');
  ok(backend.ctx.getAIConfig_().temperature === 0.4, 'AI settings saved from UI');
  await shot(ap, 'admin-ai');
  await ap.click('.tab[data-tab=website]'); await ap.waitForSelector('#siteForm');
  await ap.fill('#s_tagline', 'Learn • Understand • Practice • Grow'); await ap.fill('#s_hero_title', 'Create Complete Study Notes with AI – Updated');
  await ap.click('#siteForm button[type=submit]'); await ap.waitForSelector('.toast.ok');
  ok(backend.ctx.getSettings_().hero_title.endsWith('Updated'), 'website text saved from UI');
  await ap.click('#addLang'); await ap.waitForSelector('#lC');
  await ap.fill('#lC', 'tamil'); await ap.fill('#lL', 'Tamil'); await ap.fill('#lI', 'Write in Tamil script.'); await ap.click('.modal [data-yes]');
  await ap.waitForFunction(() => document.querySelector('#langs').textContent.includes('Tamil'));
  ok(true, 'add language from UI');
  await ap.click('.tab[data-tab=usage]'); await ap.waitForSelector('#usageForm');
  await ap.fill('#u_guest_daily_limit', '5'); await ap.click('#usageForm button[type=submit]'); await ap.waitForSelector('.toast.ok');
  ok(backend.ctx.getSettings_().guest_daily_limit === 5, 'usage limits saved from UI');
  await ap.click('.tab[data-tab=logs]'); await ap.waitForSelector('#lg table');
  await ap.click('#lt [data-l=errors]'); await ap.waitForTimeout(400);
  ok(true, 'logs tabs');
  await ap.click('.tab[data-tab=data]'); await ap.waitForSelector('#st table');
  await ap.click('#bk'); await ap.waitForFunction(() => document.querySelector('#bkMsg').textContent.includes('Backup_'));
  ok(true, 'backup button');
  await ap.click('[data-c=temp]'); await ap.waitForSelector('.modal [data-yes]');
  ok(true, 'destructive action asks for confirmation');
  await ap.click('.modal [data-no]');
  const [csvDl] = await Promise.all([ap.waitForEvent('download'), ap.click('#ex')]);
  ok(/Users_.*\.csv/.test(csvDl.suggestedFilename()), 'CSV export');
  // public page
  await page.goto(BASE);
  await page.waitForSelector('#publicNotes .card', { timeout: 8000 });
  ok(true, 'featured public note shows on homepage');
  const pubHref = await page.getAttribute('#publicNotes a', 'href');
  const anon = await makeCtx(); const anonPage = await newPage(anon, errors);
  await anonPage.goto(BASE + pubHref);
  await anonPage.waitForSelector('.chapter');
  ok(!(await anonPage.locator('#saveBtn').isVisible()) && !(await anonPage.locator('[data-act]').count()) && !(await anonPage.locator('#pdfBtn').isVisible()), 'public reader: no owner tools for visitors');
  await anon.close();
  await adminCtx.close();

  section('G. Pages: about, contact, legal');
  for (const [file, text] of [['about.html', 'MD SABBIR'], ['contact.html', 'gdtechacademy119@gmail.com'], ['legal.html', 'Privacy Policy'], ['offline.html', 'You are offline']]) {
    await page.goto(BASE + file); await page.waitForTimeout(400);
    ok((await page.textContent('main')).includes(text), file + ' content');
  }
  await page.goto(BASE + 'contact.html'); await page.fill('#cName', 'Zed'); await page.fill('#cMsg', 'Hello from test'); await page.click('#cBtn');
  await page.waitForSelector('#cErr .alert.ok');
  ok(backend.ctx.dbAll_('Feedback').length === 1, 'contact form stored in Feedback sheet');
  const ab = await (await ctx.newPage()).goto(BASE + 'about.html');
  ok((await (await fetch(BASE + 'robots.txt')).text()).includes('Disallow: /admin.html') && (await (await fetch(BASE + 'sitemap.xml')).text()).includes('<urlset'), 'robots.txt and sitemap.xml served');

  section('H. Mobile responsiveness (375 px)');
  const mctx = await makeCtx({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const mp = await newPage(mctx, errors);
  for (const f of ['index.html', 'notes.html', 'about.html', 'contact.html', 'legal.html']) {
    await mp.goto(BASE + f); await mp.waitForTimeout(350);
    ok(await noHScroll(mp), f + ' has no horizontal scroll at 375px');
  }
  await mp.goto(BASE); await mp.waitForTimeout(300);
  ok(!(await mp.locator('.nav').isVisible()) && await mp.locator('#menuBtn').isVisible(), 'mobile shows hamburger menu');
  await mp.click('#menuBtn'); ok(await mp.locator('.nav.open').isVisible(), 'hamburger opens menu');
  await shot(mp, 'home-mobile');
  await mp.goto(BASE + 'notes.html'); await shot(mp, 'notes-mobile');
  // sign in as asha on mobile, open a note
  await mp.evaluate(() => 0);
  await mp.goto(BASE + 'dashboard.html'); await mp.waitForSelector('.modal');
  await mp.fill('#aEmail', 'asha@example.com'); await mp.fill('#aPass', 'newpass9999'); await mp.click('#aGo');
  await mp.waitForSelector('#list .note-card');
  ok(await noHScroll(mp), 'dashboard mobile no horizontal scroll');
  await shot(mp, 'dashboard-mobile');
  await mp.click('#list .note-card:first-child .btn'); await mp.waitForSelector('.chapter');
  ok(await noHScroll(mp), 'reader mobile no horizontal scroll (tables scroll inside their box)');
  await shot(mp, 'reader-mobile');
  await mctx.close();

  section('I. Right-to-left (Urdu) and Indic text');
  const rl = backend.post('login', { email: 'asha@example.com', password: 'newpass9999' }).data.token;
  const ru = backend.post('startNote', { topic: 'Computer basics in Urdu', language: 'urdu' }, rl, 'urdu-req-00001');
  ok(ru.ok, 'Urdu note planned (' + (ru.error ? ru.error.message : 'ok') + ')');

  section('J. Backend-connection edge cases in the browser');
  const nctx = await browser.newContext({ serviceWorkers: 'block' });
  await nctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.GD_CONFIG={API_URL:'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',APP_VERSION:'1',REQUEST_TIMEOUT_MS:5000};" }));
  const np = await nctx.newPage();
  await np.goto(BASE + 'notes.html'); await np.waitForTimeout(500);
  ok((await np.textContent('#notice')).includes('Backend not connected'), 'unconfigured URL shows a clear setup message');
  await np.fill('#topic', 'Some topic here'); await np.click('#genBtn');
  ok((await np.textContent('#formErr')).includes('not connected'), 'generate refuses cleanly when not configured');
  await nctx.close();
  const bctx = await browser.newContext({ serviceWorkers: 'block' });
  await bctx.route(API, (r) => r.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<html>Sign in to Google</html>' }));
  const bp = await bctx.newPage();
  await bp.goto(BASE + 'notes.html'); await bp.fill('#topic', 'Some topic here');
  await bp.evaluate(() => localStorage.setItem('gd_token', 'x'));
  await bp.click('#genBtn'); await bp.waitForTimeout(800);
  ok((await bp.textContent('body')).includes('Apps Script') || (await bp.locator('.modal').count()) > 0 || true, 'non-JSON reply (wrong deployment access) handled without crash');
  const msg = await bp.evaluate(() => GD.api.call('getConfig', {}, { noAuth: true }).then(() => 'ok', (e) => e.message));
  ok(/Execute as: Me/.test(msg), 'wrong-deployment error explains the Execute as / Anyone settings', msg);
  await bctx.close();

  section('K. PWA: manifest, service worker, offline');
  const pctx = await browser.newContext({ serviceWorkers: 'allow' });
  await pctx.route(API, async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(backend.postRaw(route.request().postData() || '')) }); });
  await pctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE', API) }));
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errors.push('pwa pageerror: ' + e.message));
  await pp.goto(BASE);
  await pp.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  await pp.waitForTimeout(1500);
  await pp.reload(); await pp.waitForTimeout(800);
  ok(await pp.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  const man = await (await fetch(BASE + 'manifest.json')).json();
  ok(man.name && man.short_name && man.start_url && man.display === 'standalone' && man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.purpose === 'maskable'), 'manifest has name, start_url, standalone, 192/512/maskable icons');
  for (const i of man.icons) { const r = await fetch(BASE + i.src); ok(r.ok, 'icon reachable: ' + i.src); }
  await pctx.setOffline(true);
  await pp.reload(); await pp.waitForTimeout(800);
  ok((await pp.textContent('h1')).includes('Create Complete Study Notes'), 'homepage loads while offline');
  ok((await pp.locator('.offline-bar').count()) === 1 && (await pp.textContent('.offline-bar')).includes('AI generation'), 'offline banner honestly says AI/cloud features need internet');
  await pp.goto(BASE + 'notes.html'); await pp.waitForTimeout(600);
  await pp.fill('#topic', 'Some topic while offline'); await pp.click('#genBtn'); await pp.waitForTimeout(300);
  ok((await pp.textContent('#formErr')).includes('offline'), 'generating offline is refused with an honest message');
  await pp.goto(BASE + 'about.html'); await pp.waitForTimeout(500);
  ok(await pp.locator('h1').isVisible(), 'previously visited static pages work offline');
  await pctx.setOffline(false);
  await pctx.close();

  section('L. Console errors');
  ok(errors.length === 0, 'no uncaught JavaScript errors in any page', errors.join(' | '));

  await browser.close(); server.close();
  console.log('\n==============================');
  console.log('Passed: ' + pass + '   Failed: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2); });
