// Run: node tests/apps-script.js — exercises Code.gs against an in-memory fake of the Apps Script APIs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeSheet(name) {
  const rows = []; // 2D array, row 0 = header
  const cell = (r, c) => (rows[r - 1] || [])[c - 1] ?? '';
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (rows[r + i - 1] = rows[r + i - 1] || [])[c + j - 1] = x; })); return this; },
    setValue: (x) => { (rows[r - 1] = rows[r - 1] || [])[c - 1] = x; return range(r, c, nr, nc); },
    setFormula: (f) => { (rows[r - 1] = rows[r - 1] || [])[c - 1] = f.includes('EURNGN') ? 1750 : f.includes('EURUSD') ? 1.09 : f.includes('EURGBP') ? 0.85 : ''; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; },
  });
  const lastRow = () => rows.filter((r) => r && r.some((x) => x !== '' && x != null)).length;
  return {
    rows, getName: () => name, getLastRow: lastRow, getMaxRows: () => 1000,
    getLastColumn: () => Math.max(0, ...rows.map((r) => (r ? r.length : 0))),
    getRange: range, setFrozenRows() {},
    getDataRange() { return range(1, 1, Math.max(1, lastRow()), Math.max(1, this.getLastColumn())); },
    deleteRow: (r) => rows.splice(r - 1, 1),
  };
}
function makeSpreadsheet(firstTab) {
  const sheets = [makeSheet(firstTab)];
  return {
    sheets, getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE', getId: () => 'FAKE', getSpreadsheetTimeZone: () => 'Europe/Berlin',
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => [...sheets],
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
}

function load({ bound, serviceUrl = '', promptAnswer = '', fetchAs = 'self' }) {
  const props = {}; const logs = []; let created = null; const ui = { alerts: [], prompts: 0, dialogs: [] };
  const bindingSS = bound ? makeSpreadsheet('Tabellenblatt1') : null;
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => bindingSS,
      openById: (id) => { if (created && id === 'FAKE') return created; throw new Error('not found'); },
      create: () => (created = makeSpreadsheet('Sheet1')),
      flush() {},
      getUi: () => ({
        alert: (m) => ui.alerts.push(m), showModalDialog: (h) => ui.dialogs.push(h.html),
        prompt: () => { ui.prompts++; return { getSelectedButton: () => 'OK', getResponseText: () => promptAnswer }; },
        ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'OK' },
      }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => serviceUrl }) },
    // 'self' → the URL reaches this script; 'other' → another Sheet's script; 'html' → sign-in page
    UrlFetchApp: { fetch: (url, o) => ({ getContentText: () =>
      fetchAs === 'html' ? '<html>Sign in</html>' : fetchAs === 'other' ? '{"ok":false,"error":"unauthorized"}' : api.doPost({ postData: { contents: o.payload } }).text }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setWidth() { return this; }, setHeight() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    Logger: { log: (m) => logs.push(m) },
    Utilities: { getUuid: () => 'uuid-' + Math.random().toString(36).slice(2), formatDate: () => '', newBlob: () => ({}), base64Decode: () => [] },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  let api;
  const fn = new Function(...Object.keys(ctx), src + '\nreturn { setup, doPost, doGet, showConnection };');
  api = fn(...Object.values(ctx));
  return { api, props, logs, ui, ss: () => bindingSS || created };
}

const post = (api, body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
let passed = 0;
const test = (name, f) => { f(); passed++; console.log('  ✓', name); };

for (const bound of [false, true]) {
  console.log(bound ? 'script bound to a Sheet' : 'standalone script (script.google.com)');
  const { api, props, logs, ss } = load({ bound });
  test('setup runs and creates tabs', () => {
    api.setup();
    const names = ss().sheets.map((s) => s.getName()).sort();
    assert.deepStrictEqual(names, ['Categories', 'Goals', 'Rates', 'Recurring', 'Rules', 'Settings', 'Transactions']);
    assert.ok(props.API_KEY);
    assert.ok(logs.some((l) => String(l).includes(props.API_KEY)));
    if (!bound) assert.strictEqual(props.SPREADSHEET_ID, 'FAKE');
  });
  const key = props.API_KEY;
  test('rejects a wrong key', () => assert.strictEqual(post(api, { key: 'nope', action: 'ping' }).error, 'unauthorized'));
  test('push, update, delete, pull', () => {
    const row = { id: 't1', date: '2026-10-18', type: 'expense', amount: 12.5, currency: 'EUR', rate: 1, amountEUR: 12.5, category: 'c1', updatedAt: 10 };
    assert.ok(post(api, { key, action: 'push', ops: [{ op: 'upsert', sheet: 'Transactions', row }, { op: 'upsert', sheet: 'Transactions', row: { ...row, id: 't2' } }] }).ok);
    post(api, { key, action: 'push', ops: [{ op: 'upsert', sheet: 'Transactions', row: { ...row, amount: 20, updatedAt: 20 } }] });
    post(api, { key, action: 'push', ops: [{ op: 'upsert', sheet: 'Transactions', row: { ...row, amount: 99, updatedAt: 5 } }] }); // stale → ignored
    post(api, { key, action: 'push', ops: [{ op: 'delete', sheet: 'Transactions', row: { id: 't2' } }] });
    const { data } = post(api, { key, action: 'pull' });
    assert.strictEqual(data.Transactions.length, 1);
    assert.strictEqual(data.Transactions[0].amount, 20);
    assert.strictEqual(data.Rates.NGN, 1750);
    assert.strictEqual(data.Rates.EUR, 1);
  });
  test('setup is safe to run twice', () => { api.setup(); assert.strictEqual(post(api, { key, action: 'pull' }).data.Transactions.length, 1); });
}
console.log('sharing safety');
test('existing install keeps its key when setup runs again', () => {
  const { api, props } = load({ bound: true });
  props.API_KEY = 'olumides-old-key'; // installed before KEY_SHEET_ID existed
  api.setup();
  assert.strictEqual(props.API_KEY, 'olumides-old-key');
  api.setup();
  assert.strictEqual(props.API_KEY, 'olumides-old-key');
});
test('a copy of a set-up Sheet gets its own key', () => {
  const { api, props } = load({ bound: true });
  props.API_KEY = 'original-key';
  props.KEY_SHEET_ID = 'SOMEONE-ELSES-SHEET'; // properties copied along with the Sheet
  api.setup();
  assert.notStrictEqual(props.API_KEY, 'original-key');
});
test('ping reports the script version', () => {
  const { api, props } = load({ bound: true });
  api.setup();
  assert.strictEqual(post(api, { key: props.API_KEY, action: 'ping' }).scriptVersion, 4);
});

test('a /dev address from Google is never turned into a fake /exec one', () => {
  const real = 'https://script.google.com/macros/s/AKfyREAL123/exec';
  const { api, props, ui } = load({ bound: true, serviceUrl: 'https://script.google.com/macros/s/AKfyHEAD999/dev', promptAnswer: real });
  api.setup();
  api.showConnection();
  assert.strictEqual(ui.prompts, 1, 'asks for the real URL');
  assert.strictEqual(props.WEB_APP_URL, real);
  assert.ok(ui.dialogs[0].includes(real) && !ui.dialogs[0].includes('AKfyHEAD999'));
  api.showConnection();
  assert.strictEqual(ui.prompts, 1, 'remembers it');
});
test('a wrong pasted address is rejected', () => {
  const { api, props, ui } = load({ bound: true, promptAnswer: 'https://docs.google.com/spreadsheets/d/x/edit' });
  api.setup(); api.showConnection();
  assert.ok(!props.WEB_APP_URL && ui.alerts.some((m) => m.includes("doesn't look like")));
});
test('a real /exec address is used without asking', () => {
  const { api, ui } = load({ bound: true, serviceUrl: 'https://script.google.com/macros/s/AKfyOK/exec' });
  api.setup(); api.showConnection();
  assert.strictEqual(ui.prompts, 0);
  assert.ok(ui.dialogs[0].includes('AKfyOK/exec'));
});

test('a URL from a different Sheet is caught before showing the link', () => {
  const { api, props, ui } = load({ bound: true, promptAnswer: 'https://script.google.com/macros/s/AKfyOTHER/exec', fetchAs: 'other' });
  api.setup(); api.showConnection();
  assert.strictEqual(ui.dialogs.length, 0, 'no wrong link handed out');
  assert.ok(ui.alerts.some((m) => m.includes('different InfoLedgr Sheet')));
  assert.ok(!props.WEB_APP_URL, 'forgets the wrong URL so it asks again');
});
test('an address the self-test cannot reach asks for the real one, then shows it with a note', () => {
  const pasted = 'https://script.google.com/macros/s/AKfyPASTED/exec';
  const { api, ui, props } = load({ bound: true, serviceUrl: 'https://script.google.com/macros/s/AKfyX/exec', promptAnswer: pasted, fetchAs: 'html' });
  api.setup(); api.showConnection();
  assert.strictEqual(ui.prompts, 1, 'asks instead of blocking');
  assert.strictEqual(ui.dialogs.length, 1, 'still shows the details');
  assert.ok(ui.dialogs[0].includes(pasted) && ui.dialogs[0].includes("Couldn't double-check"));
  assert.strictEqual(props.WEB_APP_URL, pasted);
});

test('older Sheets get new columns on push (amountBase) and keep the value', () => {
  const { api, props, ss } = load({ bound: true });
  api.setup();
  const tx = ss().getSheetByName('Transactions');
  // simulate an old Sheet without the amountBase column
  tx.rows[0] = tx.rows[0].filter((h) => h !== 'amountBase');
  post(api, { key: props.API_KEY, action: 'push', ops: [{ op: 'upsert', sheet: 'Transactions', row: { id: 'n1', date: '2026-10-25', amount: 5000, currency: 'NGN', amountBase: 5000, updatedAt: 1 } }] });
  const { data } = post(api, { key: props.API_KEY, action: 'pull' });
  assert.strictEqual(data.Transactions[0].amountBase, 5000);
  post(api, { key: props.API_KEY, action: 'push', ops: [{ op: 'upsert', sheet: 'Settings', row: { id: 'baseCurrency', value: 'NGN', updatedAt: 1 } }] });
  assert.strictEqual(post(api, { key: props.API_KEY, action: 'pull' }).data.Settings[0].value, 'NGN');
});

console.log(`\n${passed} tests passed`);
