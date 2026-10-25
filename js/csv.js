/* InfoLedgr — bank statement CSV import (tuned for Deutsche Bank, works for most banks) */
(function (root) {
  const IL = (root.IL = root.IL || {});
  const U = IL.util;

  /** Decode bytes: UTF-8 if valid, otherwise Windows-1252 (Deutsche Bank's usual export). */
  function decode(buffer) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
    catch { return new TextDecoder('windows-1252').decode(buffer); }
  }

  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
    const count = (ch) => (sample.match(new RegExp('\\' + ch, 'g')) || []).length;
    return [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  }

  /** RFC-4180-ish parser with quoted fields and embedded newlines. */
  function parseRows(text, delim) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim()));
  }

  /** "1.234,56" / "-12,30" / "1,234.56" / "€ 12.30" → number */
  function parseAmount(s) {
    if (s == null) return NaN;
    let t = String(s).replace(/[^\d,.\-+]/g, '');
    if (!t || !/\d/.test(t)) return NaN;
    const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');      // German
    else t = t.replace(/,/g, '');                                              // English
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : NaN;
  }

  /** DD.MM.YYYY, DD.MM.YY, YYYY-MM-DD, MM/DD/YYYY (DD/MM when unambiguous) → YYYY-MM-DD */
  function parseDate(s) {
    s = String(s || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) return iso(year(m[3]), +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
      const a = +m[1], b = +m[2];
      return a > 12 ? iso(year(m[3]), b, a) : iso(year(m[3]), a, b);
    }
    return null;
  }
  const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  function iso(y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1990)) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const COLUMN_HINTS = {
    date:     /^(buchungstag|buchungsdatum|booking date|datum|date|transaction date)/i,
    payee:    /(begünstigter|beg.nstigter|auftraggeber|beneficiary|originator|empfänger|zahlungsempf|payee|counterparty|^name)/i,
    purpose:  /(verwendungszweck|payment details|purpose|description|buchungstext|reference|details)/i,
    amount:   /^(betrag|amount|original amount|umsatz(?!art))/i,
    debit:    /^(soll|debit)(\s*\(.*\))?$/i,
    credit:   /^(haben|credit)(\s*\(.*\))?$/i,
    currency: /^(währung|w.hrung|currency)/i,
    kind:     /^(umsatzart|transaction type|type)/i,
  };

  /** Locate the header row and guess which column is which. */
  function analyse(text) {
    const delim = detectDelimiter(text);
    const rows = parseRows(text, delim).filter((r) => r.some((c) => c));
    const headerIdx = rows.findIndex((r) => r.length >= 3 && r.some((c) => COLUMN_HINTS.date.test(c)) &&
      r.some((c) => COLUMN_HINTS.amount.test(c) || COLUMN_HINTS.debit.test(c) || COLUMN_HINTS.credit.test(c)));
    const headers = headerIdx >= 0 ? rows[headerIdx] : rows[0] || [];
    const map = {};
    for (const [key, re] of Object.entries(COLUMN_HINTS)) {
      const i = headers.findIndex((h, idx) => re.test(h) && !Object.values(map).includes(idx));
      if (i >= 0) map[key] = i;
    }
    return { delim, headers, map, body: rows.slice(headerIdx + 1) };
  }

  // Payment services that sit between you and the shop — the bank shows them, not the merchant
  const INTERMEDIARY = /\b(paypal|klarna|sofort|pay\.?pal)\b/i;
  const isIntermediary = (s) => INTERMEDIARY.test(String(s || ''));

  /**
   * Dig the real shop out of a PayPal/Klarna bank line, e.g.
   * "1043438966963 PP.4396.PP . Lieferando.de, Ihr Einkauf bei Lieferando.de" → "Lieferando.de"
   */
  function extractMerchant(payee, purpose) {
    const text = `${payee} ${purpose}`;
    if (!isIntermediary(text)) return null;
    const via = /klarna/i.test(text) ? 'Klarna' : /sofort/i.test(text) ? 'Sofort' : 'PayPal';
    const patterns = [
      /Ihr Einkauf bei\s+(.+?)\s*(?:,|$|\bAWV)/i,
      /Your purchase (?:at|with)\s+(.+?)\s*(?:,|$)/i,
      /PP\.\d+\.PP\s*\/?\s*\.\s*([^,]+?)\s*(?:,|$)/i, // needs the ". " separator before the shop
      /Einkauf bei\s+(.+?)\s*(?:,|$)/i,
    ];
    for (const re of patterns) {
      const m = purpose.match(re);
      const name = m && m[1].replace(/\s+/g, ' ').trim();
      if (name && name.length > 1 && !isIntermediary(name) && !/^\d+$/.test(name)) return { merchant: name, via };
    }
    return { merchant: '', via };
  }

  /** Turn parsed rows into transaction drafts using a column map. */
  function toDrafts(body, map, store) {
    const existing = new Set(store.data.tx.map((t) => t.hash).filter(Boolean));
    const seen = new Set();
    const out = [];
    // Your own past choices beat generic rules: latest category per payee and type
    const history = new Map();
    for (const t of [...store.data.tx].sort((a, b) => a.date.localeCompare(b.date))) {
      if (t.payee && !isIntermediary(t.payee)) history.set(t.type + '|' + t.payee.toUpperCase(), t.category);
    }
    for (const r of body) {
      const date = parseDate(r[map.date]);
      if (!date) continue; // footer lines such as "Kontostand" / "Account balance"
      let amt = NaN;
      if (map.amount != null && r[map.amount]) amt = parseAmount(r[map.amount]);
      if (!Number.isFinite(amt)) {
        const d = parseAmount(r[map.debit]), c = parseAmount(r[map.credit]);
        if (Number.isFinite(d) && d !== 0) amt = -Math.abs(d);
        else if (Number.isFinite(c) && c !== 0) amt = Math.abs(c);
      }
      if (!Number.isFinite(amt) || amt === 0) continue;

      const rawPayee = (r[map.payee] || '').replace(/\s+/g, ' ').trim();
      const purpose = (r[map.purpose] || '').replace(/\s+/g, ' ').trim();
      const currency = (/^[A-Z]{3}$/.test(r[map.currency] || '') ? r[map.currency] : store.base());
      const type = amt < 0 ? 'expense' : 'income';
      const hash = U.hash([date, amt.toFixed(2), rawPayee.toUpperCase(), purpose.toUpperCase()].join('|'));
      const mid = extractMerchant(rawPayee, purpose);
      const payee = mid ? (mid.merchant || mid.via) : rawPayee;
      // For PayPal & co. match on the merchant only, never on the word "PayPal"
      const text = mid ? (mid.merchant ? `${mid.merchant} ${purpose}` : '') : `${rawPayee} ${purpose} ${r[map.kind] || ''}`;
      const fromHistory = payee && !isIntermediary(payee) ? history.get(type + '|' + payee.toUpperCase()) : null;
      const fromRule = text ? store.matchRule(text, type) : null;
      const known = (fromHistory && store.cat(fromHistory) && fromHistory) || fromRule;
      const category = known || (type === 'income' ? catIdByName(store, 'Other Income') : catIdByName(store, 'Other'));

      // Same line twice in one file is legitimate (two coffees) — only flag repeats against stored history
      let h = hash, k = 1;
      while (seen.has(h)) h = hash + '-' + k++;
      seen.add(h);

      out.push({
        include: !existing.has(h), duplicate: existing.has(h), matched: !!known,
        via: mid ? mid.via : '', review: !!mid && !known,
        date, type, amount: Math.abs(amt), currency, payee: payee || purpose.slice(0, 40),
        note: mid ? `via ${mid.via} · ${purpose}` : purpose,
        category, scope: 'personal', hash: h,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  function catIdByName(store, name) {
    const c = store.data.cats.find((x) => x.name === name);
    return c ? c.id : (store.cats(name === 'Other Income' ? 'income' : 'expense')[0] || {}).id;
  }

  /** Export transactions as a CSV string (Excel/Sheets friendly). */
  function exportCsv(txs, store) {
    const head = ['Date', 'Type', 'Amount', 'Currency', `Amount ${store.base()}`, 'Category', 'Group', 'Scope', 'Payee', 'Note', 'Receipt'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = txs.map((t) => {
      const c = store.cat(t.category);
      return [t.date, t.type, t.amount, t.currency, t.amountBase, c?.name, c?.group, t.scope, t.payee, t.note,
        t.receiptUrl === 'local' ? '' : t.receiptUrl].map(q).join(',');
    });
    return '﻿' + [head.map(q).join(','), ...lines].join('\n');
  }

  IL.csv = { isIntermediary, extractMerchant, decode, detectDelimiter, parseRows, parseAmount, parseDate, analyse, toDrafts, exportCsv };
})(typeof window !== 'undefined' ? window : globalThis);
