/* InfoLedgr — shared helpers (no DOM access here, so tests can run in Node) */
(function (root) {
  const IL = (root.IL = root.IL || {});

  const CURRENCY_SYMBOLS = { EUR: '€', NGN: '₦', USD: '$', GBP: '£', CHF: 'CHF ', CAD: 'C$', ZAR: 'R ', GHS: 'GH₵', KES: 'KSh ' };

  const pad = (n) => String(n).padStart(2, '0');

  const util = {
    uid(prefix = '') {
      const r = Math.random().toString(36).slice(2, 8);
      return prefix + Date.now().toString(36) + r;
    },

    /* ── Dates (always local YYYY-MM-DD strings, never Date objects in data) ── */
    today() { return util.isoDate(new Date()); },
    isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    ym(dateStr) { return String(dateStr).slice(0, 7); },
    currentYm() { return util.today().slice(0, 7); },
    addMonths(ym, n) {
      let [y, m] = ym.split('-').map(Number);
      m += n;
      y += Math.floor((m - 1) / 12);
      m = ((m - 1) % 12 + 12) % 12 + 1;
      return `${y}-${pad(m)}`;
    },
    daysInMonth(ym) {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    },
    monthLabel(ym, opts = { month: 'long', year: 'numeric' }) {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-GB', opts);
    },
    dayLabel(dateStr) {
      const t = util.today();
      if (dateStr === t) return 'Today';
      const y = new Date(); y.setDate(y.getDate() - 1);
      if (dateStr === util.isoDate(y)) return 'Yesterday';
      const [yy, mm, dd] = dateStr.split('-').map(Number);
      return new Date(yy, mm - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    },

    /* ── Money ── */
    symbol(cur) { return CURRENCY_SYMBOLS[cur] || cur + ' '; },
    round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },
    fmt(amount, cur = 'EUR', opts = {}) {
      const n = Number(amount) || 0;
      const abs = Math.abs(n);
      const digits = opts.decimals ?? (abs >= 1000 && opts.compact !== false ? 0 : 2);
      let s;
      if (opts.compact && abs >= 10000) {
        s = (abs >= 1e6 ? (abs / 1e6).toFixed(1) + 'M' : (abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + 'k');
      } else {
        s = abs.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      }
      const sign = n < 0 ? '−' : (opts.sign && n > 0 ? '+' : '');
      return sign + util.symbol(cur) + s;
    },
    /** rate = units of `cur` per 1 EUR */
    toEUR(amount, rate) { return util.round2((Number(amount) || 0) / (Number(rate) || 1)); },

    /* ── Parsing ── */
    num(v) {
      if (typeof v === 'number') return v;
      const n = parseFloat(String(v ?? '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    },
    bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; },

    /* ── Misc ── */
    hash(str) {
      // FNV-1a 32-bit, hex — stable fingerprint for duplicate detection
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    },
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    debounce(fn, ms) {
      let t;
      return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    },
    groupBy(arr, keyFn) {
      const out = {};
      for (const x of arr) (out[keyFn(x)] = out[keyFn(x)] || []).push(x);
      return out;
    },
    sum(arr, fn = (x) => x) { return arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0); },
  };

  IL.util = util;
  IL.CURRENCY_SYMBOLS = CURRENCY_SYMBOLS;
})(typeof window !== 'undefined' ? window : globalThis);
