/**
 * InfoLedgr — Google Apps Script backend
 * ------------------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of an empty
 * Google Sheet, run `setup` once, then Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone).
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
var RECEIPT_FOLDER = 'InfoLedgr Receipts';

/* ── One-time setup ─────────────────────────────────────────── */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(ss, name); });
  ensureRatesSheet_(ss);

  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('✅ Setup complete.');
  Logger.log('Your InfoLedgr API key: ' + props.getProperty('API_KEY'));
  Logger.log('Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
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
      case 'ping':        return json_({ ok: true, now: Date.now() });
      case 'pull':        return json_({ ok: true, data: pull_() });
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureRatesSheet_(ss);
  var codes = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).toUpperCase(); });
  if (codes.indexOf(code) === -1) addRateRow_(sh, code);
  SpreadsheetApp.flush();
  return { ok: true, rates: readRates_(ss) };
}
