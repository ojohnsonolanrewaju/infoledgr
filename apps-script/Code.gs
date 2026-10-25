/**
 * InfoLedgr — Google Apps Script backend
 * ------------------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of an empty
 * Google Sheet (or a standalone project at script.google.com — setup
 * then creates the Sheet for you), run `setup` once, then Deploy →
 * New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Sharing with friends: put this script in an EMPTY template Sheet
 * (don't run setup there) and share its "make a copy" link. Each copy
 * gets its own data and its own key; the InfoLedgr menu in the Sheet
 * walks them through setup and shows a one-tap connect link.
 *
 * The Sheet is the source of truth. The app keeps an offline copy
 * on each device and syncs through this script. Every request must
 * carry the secret API key that `setup` prints to the execution log.
 */

var SHEETS = {
  Transactions: ['id', 'date', 'type', 'amount', 'currency', 'rate', 'amountEUR', 'category', 'scope',
                 'payee', 'note', 'goalId', 'receiptUrl', 'source', 'hash', 'recurringId', 'updatedAt'],
  Categories:   ['id', 'name', 'type', 'group', 'icon', 'budget', 'order', 'archived', 'updatedAt'],
  Goals:        ['id', 'name', 'target', 'startAmount', 'deadline', 'icon', 'archived', 'updatedAt'],
  Recurring:    ['id', 'name', 'type', 'amount', 'currency', 'category', 'scope', 'payee', 'day',
                 'active', 'startMonth', 'lastPosted', 'updatedAt'],
  Rules:        ['id', 'pattern', 'category', 'updatedAt']
};

// Columns stored as numbers; everything else is forced to plain text so
// Sheets never turns "2026-10" into a date or "-50 refund" into a formula.
var NUMERIC = ['amount', 'rate', 'amountEUR', 'budget', 'order', 'target', 'startAmount', 'day', 'updatedAt'];

var DEFAULT_CURRENCIES = ['EUR', 'NGN', 'USD', 'GBP'];
var SCRIPT_VERSION = 3;

// Your hosted app address, e.g. 'https://infoledgr.pages.dev'. Used for the one-tap connect link.
var APP_URL = 'https://infoledgr.pages.dev';
var RECEIPT_FOLDER = 'InfoLedgr Receipts';

/* ── One-time setup ─────────────────────────────────────────── */

function setup() {
  var ss = getSpreadsheet_(true);
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(ss, name); });
  ensureRatesSheet_(ss);

  // Remove the empty starter tab ("Sheet1", "Tabellenblatt1", …)
  ss.getSheets().forEach(function (sh) {
    if (!SHEETS[sh.getName()] && sh.getName() !== 'Rates' && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  var props = PropertiesService.getScriptProperties();
  // A key belongs to one Sheet. If this script was copied from a Sheet where setup already ran,
  // make a fresh key so the copy can't share the original's. Older installs keep their key.
  var keySheet = props.getProperty('KEY_SHEET_ID');
  if (!props.getProperty('API_KEY') || (keySheet && keySheet !== ss.getId())) {
    props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
    props.deleteProperty('WEB_APP_URL');
  }
  props.setProperty('KEY_SHEET_ID', ss.getId());
  Logger.log('✅ Setup complete. Your data Sheet: ' + ss.getUrl());
  Logger.log('Your InfoLedgr API key: ' + props.getProperty('API_KEY'));
  Logger.log('Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
}

/**
 * The Sheet that holds the data. Works whether this script was created from
 * a Sheet (Extensions → Apps Script) or standalone at script.google.com —
 * in the standalone case `setup` creates an "InfoLedgr Data" Sheet in your Drive.
 */
function getSpreadsheet_(createIfMissing) {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted or no access — fall through */ }
  }
  if (!createIfMissing) throw new Error('No data Sheet found. Open Apps Script and run setup again.');
  var ss = SpreadsheetApp.create('InfoLedgr Data');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

/* ── Sheet menu (no code editor needed) ─────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('InfoLedgr')
    .addItem('1. Set up this Sheet', 'menuSetup')
    .addItem('2. Show connection details', 'showConnection')
    .addSeparator()
    .addItem('Help: how to deploy', 'showDeployHelp')
    .addToUi();
}

function menuSetup() {
  setup();
  SpreadsheetApp.getUi().alert('✅ Your InfoLedgr Sheet is ready.\n\nNext: Extensions → Apps Script → Deploy → New deployment → Web app ' +
    '(Execute as: Me, Who has access: Anyone). Then come back and choose InfoLedgr → 2. Show connection details.');
}

function showDeployHelp() {
  SpreadsheetApp.getUi().alert('How to deploy (once):\n\n' +
    '1. Extensions → Apps Script\n2. Deploy (blue button) → New deployment\n3. Gear icon → Web app\n' +
    '4. Execute as: Me · Who has access: Anyone\n5. Deploy → Authorize access → choose your account\n' +
    '   If Google says "app isn\'t verified": Advanced → Go to InfoLedgr (it\'s your own copy)\n' +
    '6. Back in the Sheet: InfoLedgr → 2. Show connection details');
}

function showConnection() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) return ui.alert('Run InfoLedgr → 1. Set up this Sheet first.');
  var url = getWebAppUrl_();
  if (!url) return;
  var link = APP_URL ? APP_URL.replace(/\/+$/, '') + '/#connect?u=' + encodeURIComponent(url) + '&k=' + encodeURIComponent(key) : '';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  var box = function (label, value) {
    return '<p style="margin:14px 0 4px;font-weight:600">' + label + '</p>' +
      '<textarea readonly onclick="this.select()" style="width:100%;height:58px;font:12px monospace">' + esc(value) + '</textarea>';
  };
  var html = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#0A0F1E">' +
    (link ? '<p><b>Easiest:</b> open this link on each phone and laptop, then tap <b>Connect &amp; sync</b>. ' +
      'Send it to yourself (e.g. email or WhatsApp to yourself). Keep it private: it unlocks your data.</p>' + box('One-tap connect link', link) +
      '<p style="margin-top:18px;color:#5C6589">Or enter these in InfoLedgr → Settings → Connect Google Sheet:</p>' : '<p>Enter these in InfoLedgr → Settings → Connect Google Sheet:</p>') +
    box('Web app URL', url) + box('API key', key) + '</div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(link ? 470 : 300), 'Connect InfoLedgr');
}

/**
 * The deployed /exec address. Google's getUrl() sometimes returns the /dev test address,
 * whose id doesn't work with /exec, so in that case we ask once and remember the answer.
 */
function getWebAppUrl_() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('WEB_APP_URL');
  if (saved) return saved;
  var auto = '';
  try { auto = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed yet */ }
  if (/\/exec$/.test(auto)) return auto;
  var res = ui.prompt('One more step',
    'Paste your Web app URL.\n\nFind it in Extensions → Apps Script → Deploy → Manage deployments ' +
    '(it starts with https://script.google.com/macros/s/ and ends with /exec).\n\n' +
    "Haven't deployed yet? Click Cancel and see InfoLedgr → Help: how to deploy.",
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return '';
  var url = res.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    ui.alert('That doesn\'t look like a Web app URL. It should start with https://script.google.com/macros/s/ and end with /exec. Please try again.');
    return '';
  }
  props.setProperty('WEB_APP_URL', url);
  return url;
}

/** Run this if you ever create a new deployment (new URL), then show connection details again. */
function forgetWebAppUrl() {
  PropertiesService.getScriptProperties().deleteProperty('WEB_APP_URL');
}

/** Run this if you lose your key. */
function showApiKey() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('API_KEY'));
}

/** Run this to invalidate the old key (e.g. a lost phone). Re-enter the new key on your devices. */
function rotateApiKey() {
  var key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('New API key: ' + key);
}

function ensureSheet_(ss, name) {
  var headers = SHEETS[name];
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var existing = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  // Append any missing columns so older Sheets upgrade in place
  headers.forEach(function (h) {
    if (existing.indexOf(h) === -1) {
      existing.push(h);
      sh.getRange(1, existing.length).setValue(h);
    }
  });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, existing.length).setFontWeight('bold').setBackground('#0A0F1E').setFontColor('#FFFFFF');
  existing.forEach(function (h, i) {
    if (NUMERIC.indexOf(h) === -1) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return sh;
}

function ensureRatesSheet_(ss) {
  var sh = ss.getSheetByName('Rates');
  if (sh) return sh;
  sh = ss.insertSheet('Rates');
  sh.getRange(1, 1, 1, 3).setValues([['currency', 'perEUR', 'note']])
    .setFontWeight('bold').setBackground('#0A0F1E').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  DEFAULT_CURRENCIES.forEach(function (c) { addRateRow_(sh, c); });
  return sh;
}

function addRateRow_(sh, code) {
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1).setValue(code);
  if (code === 'EUR') {
    sh.getRange(row, 2).setValue(1);
  } else {
    sh.getRange(row, 2).setFormula('=IFERROR(GOOGLEFINANCE("CURRENCY:EUR' + code + '"), "")');
  }
  sh.getRange(row, 3).setValue('Units of ' + code + ' per 1 EUR. Overwrite with a number to fix a rate.');
}

/* ── Web app entry points ───────────────────────────────────── */

function doGet() {
  return json_({ ok: true, app: 'InfoLedgr', message: 'Backend is running. Use the app to connect.' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!key || req.key !== key) return json_({ ok: false, error: 'unauthorized' });

    switch (req.action) {
      case 'ping':        return json_({ ok: true, now: Date.now(), scriptVersion: SCRIPT_VERSION });
      case 'pull':        return json_({ ok: true, data: pull_(), scriptVersion: SCRIPT_VERSION });
      case 'push':        return json_(push_(req.ops || []));
      case 'upload':      return json_(upload_(req));
      case 'addCurrency': return json_(addCurrency_(req.code));
      default:            return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ── Actions ────────────────────────────────────────────────── */

function pull_() {
  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();
  var out = {};
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    out[name] = sh ? readRows_(sh, tz) : [];
  });
  out.Rates = readRates_(ss);
  return out;
}

function readRows_(sh, tz) {
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === '' || values[r][0] === null) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = values[r][c];
      if (v instanceof Date) {
        // Someone typed a date by hand — normalise it back to text
        var h = headers[c];
        v = Utilities.formatDate(v, tz, (h === 'lastPosted' || h === 'startMonth') ? 'yyyy-MM' : 'yyyy-MM-dd');
      }
      obj[headers[c]] = v;
    }
    rows.push(obj);
  }
  return rows;
}

function readRates_(ss) {
  var sh = ensureRatesSheet_(ss);
  var values = sh.getDataRange().getValues();
  var rates = {};
  for (var r = 1; r < values.length; r++) {
    var code = String(values[r][0]).trim().toUpperCase();
    var rate = Number(values[r][1]);
    if (code && rate > 0) rates[code] = rate;
  }
  rates.EUR = 1;
  return rates;
}

/**
 * ops: [{ op: 'upsert' | 'delete', sheet: 'Transactions', row: {...} }]
 * Last write wins per row, decided by `updatedAt`.
 */
function push_(ops) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = getSpreadsheet_();
    var bySheet = {};
    ops.forEach(function (o) {
      if (!SHEETS[o.sheet] || !o.row || !o.row.id) return;
      (bySheet[o.sheet] = bySheet[o.sheet] || {})[o.row.id] = o; // collapse to last op per id
    });

    var applied = 0;
    Object.keys(bySheet).forEach(function (name) {
      applied += applySheetOps_(ss.getSheetByName(name) || ensureSheet_(ss, name), bySheet[name]);
    });
    return { ok: true, applied: applied };
  } finally {
    lock.releaseLock();
  }
}

function applySheetOps_(sh, opsById) {
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idCol = headers.indexOf('id');
  var updCol = headers.indexOf('updatedAt');
  var lastRow = sh.getLastRow();
  var data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  var index = {};
  data.forEach(function (row, i) { index[row[idCol]] = i; });

  var toRow = function (obj) {
    return headers.map(function (h) {
      var v = obj[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v;
    });
  };

  var appends = [], deletes = [], changed = {}, applied = 0;
  Object.keys(opsById).forEach(function (id) {
    var o = opsById[id];
    var i = index[id];
    if (o.op === 'delete') {
      if (i !== undefined) { deletes.push(i); applied++; }
      return;
    }
    if (i !== undefined) {
      var existingUpd = Number(data[i][updCol]) || 0;
      if (existingUpd > (Number(o.row.updatedAt) || 0)) return; // newer version already stored
      data[i] = toRow(o.row);
      changed[i] = true;
    } else {
      appends.push(toRow(o.row));
    }
    applied++;
  });

  var changedRows = Object.keys(changed).map(Number);
  if (changedRows.length > 25) {
    sh.getRange(2, 1, data.length, lastCol).setValues(data);
  } else {
    changedRows.forEach(function (i) { sh.getRange(i + 2, 1, 1, lastCol).setValues([data[i]]); });
  }
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, lastCol).setValues(appends);

  deletes.sort(function (a, b) { return b - a; }).forEach(function (i) { sh.deleteRow(i + 2); });
  return applied;
}

function upload_(req) {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('RECEIPT_FOLDER_ID');
  var folder;
  try { folder = folderId && DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  if (!folder) {
    folder = DriveApp.createFolder(RECEIPT_FOLDER);
    props.setProperty('RECEIPT_FOLDER_ID', folder.getId());
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', req.name || 'receipt.jpg');
  var file = folder.createFile(blob);
  return { ok: true, id: file.getId(), url: file.getUrl() };
}

function addCurrency_(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: 'Currency must be a 3-letter code' };
  var ss = getSpreadsheet_();
  var sh = ensureRatesSheet_(ss);
  var codes = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).toUpperCase(); });
  if (codes.indexOf(code) === -1) addRateRow_(sh, code);
  SpreadsheetApp.flush();
  return { ok: true, rates: readRates_(ss) };
}
