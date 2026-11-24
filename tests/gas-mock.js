/**
 * gas-mock.js — an in-memory imitation of the Google Apps Script services used by the backend
 * (SpreadsheetApp, DriveApp, PropertiesService, CacheService, LockService, UrlFetchApp, Utilities …),
 * so the REAL backend code in /apps-script can be executed and tested locally with Node.
 *
 * IMPORTANT: this is a test double. It proves the application logic (routing, auth, limits, data flow,
 * error handling). It does NOT prove Google quotas, permissions or the live Gemini API — those must be
 * checked once on your real deployment (see docs/TESTING.md).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const toU = (arr) => Buffer.from(arr.map((x) => x & 255));
const toS = (buf) => Array.from(buf).map((x) => (x > 127 ? x - 256 : x));

function createBackend(opts) {
  opts = opts || {};
  const log = [];
  const state = { aiCalls: [], aiMode: { type: 'ok' }, now: Date.now() };

  /* ---------- Properties / Cache / Lock ---------- */
  const propStore = {};
  const props = {
    getProperty: (k) => (k in propStore ? propStore[k] : null),
    setProperty: (k, v) => { propStore[k] = String(v); },
    deleteProperty: (k) => { delete propStore[k]; }
  };
  const cacheStore = new Map();
  const cache = {
    get: (k) => { const e = cacheStore.get(k); if (!e) return null; if (e.exp < Date.now()) { cacheStore.delete(k); return null; } return e.v; },
    put: (k, v, ttl) => { cacheStore.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
    remove: (k) => { cacheStore.delete(k); },
    clear: () => cacheStore.clear()
  };
  let lockHeld = false;
  const lock = {
    tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
    releaseLock: () => { lockHeld = false; }
  };

  /* ---------- Blob / Utilities ---------- */
  function Blob(buf, mime, name) { this.buf = buf; this.mime = mime || 'application/octet-stream'; this.name = name || ''; }
  Blob.prototype.getBytes = function () { return toS(this.buf); };
  Blob.prototype.getDataAsString = function () { return this.buf.toString('utf8'); };
  Blob.prototype.setName = function (n) { this.name = n; return this; };
  Blob.prototype.getName = function () { return this.name; };
  Blob.prototype.getAs = function (mime) { return new Blob(Buffer.from('%PDF-1.4 mock ' + this.buf.toString('utf8').length), mime, this.name); };
  Blob.prototype.getContentType = function () { return this.mime; };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    getUuid: () => crypto.randomUUID(),
    newBlob: (data, mime, name) => new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : toU(data), mime, name),
    base64Encode: (b) => (typeof b === 'string' ? Buffer.from(b) : toU(b)).toString('base64'),
    base64Decode: (s) => toS(Buffer.from(s, 'base64')),
    base64EncodeWebSafe: (b) => (typeof b === 'string' ? Buffer.from(b) : toU(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => toS(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    computeDigest: (alg, v) => toS(crypto.createHash('sha256').update(typeof v === 'string' ? Buffer.from(v) : toU(v)).digest()),
    computeHmacSha256Signature: (v, key) => toS(crypto.createHmac('sha256', key).update(v).digest()),
    sleep: () => { },
    formatDate: (d, tz, fmt) => {
      const p = (n) => String(n).padStart(2, '0');
      const iso = new Date(d).toISOString();
      return fmt.replace('yyyy', iso.slice(0, 4)).replace('MM', iso.slice(5, 7)).replace('dd', iso.slice(8, 10)).replace('HH', iso.slice(11, 13)).replace('mm', iso.slice(14, 16));
    }
  };

  /* ---------- Spreadsheet ---------- */
  function Range(sheet, r, c, nr, nc) { this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = (this.sheet.rows[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
      out.push(row);
    }
    return out;
  };
  Range.prototype.setValues = function (vals) {
    for (let i = 0; i < vals.length; i++) {
      const rr = this.r - 1 + i;
      while (this.sheet.rows.length <= rr) this.sheet.rows.push([]);
      for (let j = 0; j < vals[i].length; j++) {
        let v = vals[i][j];
        if (v instanceof Date) v = v.toISOString();
        this.sheet.rows[rr][this.c - 1 + j] = v === '' || v === null || v === undefined ? '' : String(v); // text format "@"
      }
    }
    return this;
  };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor'].forEach((m) => { Range.prototype[m] = function () { return this; }; });
  Range.prototype.createTextFinder = function (text) {
    const rng = this; let entire = false, matchCase = false;
    const f = {
      matchEntireCell(b) { entire = b; return f; }, matchCase(b) { matchCase = b; return f; },
      findNext() {
        for (let i = 0; i < rng.nr; i++) for (let j = 0; j < rng.nc; j++) {
          let v = (rng.sheet.rows[rng.r - 1 + i] || [])[rng.c - 1 + j];
          if (v === undefined || v === '') continue;
          let a = String(v), b = String(text);
          if (!matchCase) { a = a.toLowerCase(); b = b.toLowerCase(); }
          if (entire ? a === b : a.indexOf(b) >= 0) return { getRow: () => rng.r + i };
        }
        return null;
      }
    };
    return f;
  };
  function Sheet(name) { this.name = name; this.rows = []; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1; return 0; };
  Sheet.prototype.getLastColumn = function () { let m = 0; this.rows.forEach((r) => (r || []).forEach((v, j) => { if (v !== '' && v !== undefined) m = Math.max(m, j + 1); })); return m; };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.rows.length); };
  Sheet.prototype.getMaxColumns = function () { return 26; };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.setFrozenRows = function () { };
  Sheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); };

  function Spreadsheet(name) { this.id = 'SS' + crypto.randomBytes(6).toString('hex'); this.name = name; this.sheets = [new Sheet('Sheet1')]; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find((s) => s.name === n) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { const s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter((x) => x !== s); };
  const spreadsheets = {};

  /* ---------- Drive ---------- */
  const items = {};
  let nextId = 1;
  function File(name, buf, mime, parent) {
    this.id = 'F' + (nextId++) + crypto.randomBytes(4).toString('hex'); this.name = name; this.buf = buf; this.mime = mime; this.parent = parent;
    this.trashed = false; this.created = new Date(state.now + nextId * 1000); this.sharing = null; this.kind = 'file'; items[this.id] = this;
  }
  File.prototype.getId = function () { return this.id; };
  File.prototype.getName = function () { return this.name; };
  File.prototype.isTrashed = function () { return this.trashed; };
  File.prototype.setTrashed = function (t) { this.trashed = t; return this; };
  File.prototype.getBlob = function () { return new Blob(this.buf, this.mime, this.name); };
  File.prototype.setContent = function (s) { this.buf = Buffer.from(s, 'utf8'); return this; };
  File.prototype.getSize = function () { return this.buf.length; };
  File.prototype.getDateCreated = function () { return this.created; };
  File.prototype.setSharing = function (a, p) { this.sharing = a + ':' + p; return this; };
  File.prototype.moveTo = function (f) { this.parent = f; return this; };
  File.prototype.makeCopy = function (name, folder) { return new File(name, Buffer.from(this.buf), this.mime, folder || this.parent); };
  File.prototype.getUrl = function () { return 'https://drive.google.com/file/d/' + this.id; };
  function Folder(name, parent) { this.id = 'D' + (nextId++) + crypto.randomBytes(4).toString('hex'); this.name = name; this.parent = parent; this.trashed = false; this.kind = 'folder'; items[this.id] = this; }
  Folder.prototype.getId = function () { return this.id; };
  Folder.prototype.isTrashed = function () { return this.trashed; };
  Folder.prototype.getUrl = function () { return 'https://drive.google.com/drive/folders/' + this.id; };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  Folder.prototype.getFolders = function () { return iter(Object.values(items).filter((x) => x.kind === 'folder' && x.parent === this && !x.trashed)); };
  Folder.prototype.getFoldersByName = function (n) { return iter(Object.values(items).filter((x) => x.kind === 'folder' && x.parent === this && x.name === n && !x.trashed)); };
  Folder.prototype.createFolder = function (n) { return new Folder(n, this); };
  Folder.prototype.getFiles = function () { return iter(Object.values(items).filter((x) => x.kind === 'file' && x.parent === this && !x.trashed)); };
  Folder.prototype.createFile = function (a, b, c) {
    if (a && a.buf) return new File(a.name || 'file', a.buf, a.mime, this);
    return new File(a, Buffer.from(String(b), 'utf8'), c || 'text/plain', this);
  };
  const myDrive = new Folder('My Drive', null);
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    getFolderById: (id) => { const f = items[id]; if (!f || f.kind !== 'folder') throw new Error('No item with the given ID could be found, or you do not have permission to access it.'); return f; },
    getFileById: (id) => { const f = items[id]; if (!f || f.kind !== 'file') throw new Error('No item with the given ID could be found, or you do not have permission to access it.'); return f; },
    getFoldersByName: (n) => myDrive.getFoldersByName(n),
    createFolder: (n) => myDrive.createFolder(n),
    getStorageUsed: () => 123456, getStorageLimit: () => 15 * 1073741824
  };
  const SpreadsheetApp = {
    create: (name) => { const s = new Spreadsheet(name); spreadsheets[s.id] = s; const f = new File(name, Buffer.from('{}'), 'application/vnd.google-apps.spreadsheet', myDrive); f.id = s.id; items[s.id] = f; return s; },
    openById: (id) => { if (!spreadsheets[id]) throw new Error('Spreadsheet not found'); return spreadsheets[id]; }
  };

  /* ---------- UrlFetch (AI provider mock) ---------- */
  function resp(code, obj) { return { getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) }; }
  const SECTION_TEXT = '### What it is\n\nAn **input device** sends data *to* the computer.\n\n> **Definition:** An input device is hardware used to give data to a computer.\n\n| Device | Type |\n|---|---|\n| Keyboard | Input |\n| Monitor | Output |\n\n```diagram\n[User] --> [Keyboard] --> [CPU]\n```\n\n- Point one\n- Point two <script>alert(1)</script>\n';
  const UrlFetchApp = {
    fetch: (url, o) => {
      const p = JSON.parse(o.payload || '{}');
      const text = p.contents && p.contents[0].parts[0].text;
      const call = { url, headers: o.headers, prompt: text, system: p.systemInstruction && p.systemInstruction.parts[0].text, json: !!(p.generationConfig && p.generationConfig.responseMimeType === 'application/json'), count: 0 };
      state.aiCalls.push(call);
      const m = state.aiMode;
      if (m.type === 'http') return resp(m.code, { error: { message: m.message || 'mock error' } });
      if (m.type === 'throw') throw new Error(m.message || 'DNS error');
      if (m.type === 'flaky' && m.failures > 0) { m.failures--; return resp(429, { error: { message: 'Resource exhausted' } }); }
      if (m.type === 'empty') return resp(200, { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }] });
      if (m.type === 'blocked') return resp(200, { promptFeedback: { blockReason: 'SAFETY' } });
      if (call.json) {
        if (m.type === 'badplan') return resp(200, { candidates: [{ content: { parts: [{ text: 'not json at all' }] }, finishReason: 'STOP' }] });
        return resp(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 'Input and Output Devices', subject: 'Computer Basics', chapters: [{ title: 'Introduction to Devices', brief: 'What devices are' }, { title: 'Input Devices', brief: 'Keyboard, mouse' }, { title: 'Output Devices', brief: 'Monitor, printer' }] }) }] }, finishReason: 'STOP' }] });
      }
      if (m.type === 'truncate' && !/cut off/.test(text)) return resp(200, { candidates: [{ content: { parts: [{ text: 'First half of the text ' }] }, finishReason: 'MAX_TOKENS' }] });
      if (/cut off/.test(text)) return resp(200, { candidates: [{ content: { parts: [{ text: 'and the continuation.' }] }, finishReason: 'STOP' }] });
      return resp(200, { candidates: [{ content: { parts: [{ text: (m.text || SECTION_TEXT) }] }, finishReason: 'STOP' }] });
    }
  };

  const ContentService = { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return s; } }) };

  const sandbox = {
    console, Logger: { log: (m) => log.push(String(m)) }, Session: { getScriptTimeZone: () => 'UTC' },
    PropertiesService: { getScriptProperties: () => props }, CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => lock }, Utilities, SpreadsheetApp, DriveApp, UrlFetchApp, ContentService,
    Date, JSON, Math, Array, Object, String, Number, RegExp, Error, parseInt, isNaN, encodeURIComponent
  };
  const ctx = vm.createContext(sandbox);
  const dir = opts.dir || path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });

  function post(action, data, token, requestId) {
    const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, token: token || '', requestId: requestId || '', data: data || {} }) } });
    return JSON.parse(out.getContent());
  }
  function postRaw(contents) { return JSON.parse(ctx.doPost({ postData: { contents } }).getContent()); }

  return { ctx, post, postRaw, props, propStore, cacheStore, cache, state, log, items, spreadsheets, myDrive, DriveApp, Utilities };
}

module.exports = { createBackend };
