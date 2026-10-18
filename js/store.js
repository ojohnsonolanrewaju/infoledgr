/* InfoLedgr — data store, seeds, recurring engine and analytics maths */
(function (root) {
  const IL = (root.IL = root.IL || {});
  const U = IL.util;

  const KEYS = { data: 'il_data_v1', queue: 'il_queue_v1', settings: 'il_settings_v1' };
  const COLL_SHEET = { tx: 'Transactions', cats: 'Categories', goals: 'Goals', rec: 'Recurring', rules: 'Rules' };

  // Fixed group order = fixed chart colour slot (colour follows the group, never its rank)
  const GROUPS = ['Essentials', 'Lifestyle', 'Sent Home', 'Financial'];

  /* ── Starter data (edit freely in the app or the Sheet) ── */
  const SEED_CATS = [
    ['Rent & Housing', 'expense', 'Essentials', '🏠'],
    ['Utilities & Internet', 'expense', 'Essentials', '💡'],
    ['Groceries', 'expense', 'Essentials', '🛒'],
    ['Transport', 'expense', 'Essentials', '🚆'],
    ['Insurance', 'expense', 'Essentials', '🛡️'],
    ['Health', 'expense', 'Essentials', '🩺'],
    ['Education', 'expense', 'Essentials', '🎓'],
    ['Dining & Cafés', 'expense', 'Lifestyle', '🍽️'],
    ['Shopping', 'expense', 'Lifestyle', '🛍️'],
    ['Subscriptions', 'expense', 'Lifestyle', '📺'],
    ['Personal Care', 'expense', 'Lifestyle', '💈'],
    ['Fitness & Sport', 'expense', 'Lifestyle', '💪'],
    ['Entertainment', 'expense', 'Lifestyle', '🎉'],
    ['Travel', 'expense', 'Lifestyle', '✈️'],
    ['Gifts & Donations', 'expense', 'Lifestyle', '🎁'],
    ['Family Support', 'expense', 'Sent Home', '🇳🇬'],
    ['Nigeria Investments', 'expense', 'Sent Home', '📈'],
    ['Fees & Charges', 'expense', 'Financial', '🏦'],
    ['Taxes', 'expense', 'Financial', '🧾'],
    ['Loan Refund', 'expense', 'Financial', '💳'],
    ['Other', 'expense', 'Financial', '📦'],
    ['Salary', 'income', 'Income', '💼'],
    ['Business Income', 'income', 'Income', '🏢'],
    ['Interest & Dividends', 'income', 'Income', '💶'],
    ['Refunds', 'income', 'Income', '↩️'],
    ['Other Income', 'income', 'Income', '➕'],
  ];

  // Payee/purpose text → category. Longest matching pattern wins.
  const SEED_RULES = [
    ['REWE', 'Groceries'], ['EDEKA', 'Groceries'], ['ALDI', 'Groceries'], ['LIDL', 'Groceries'],
    ['NETTO', 'Groceries'], ['PENNY', 'Groceries'], ['KAUFLAND', 'Groceries'], ['TEGUT', 'Groceries'],
    ['DM DROGERIE', 'Personal Care'], ['DM-DROGERIE', 'Personal Care'], ['ROSSMANN', 'Personal Care'], ['MUELLER', 'Personal Care'],
    ['MVV', 'Transport'], ['MVG', 'Transport'], ['DB VERTRIEB', 'Transport'], ['DEUTSCHE BAHN', 'Transport'],
    ['UBER', 'Transport'], ['BOLT', 'Transport'], ['FLIXBUS', 'Transport'], ['SHELL', 'Transport'], ['ARAL', 'Transport'],
    ['UBER EATS', 'Dining & Cafés'], ['LIEFERANDO', 'Dining & Cafés'], ['WOLT', 'Dining & Cafés'],
    ['MCDONALDS', 'Dining & Cafés'], ['STARBUCKS', 'Dining & Cafés'], ['BURGER KING', 'Dining & Cafés'],
    ['SWM', 'Utilities & Internet'], ['STADTWERKE', 'Utilities & Internet'], ['TELEKOM', 'Utilities & Internet'],
    ['VODAFONE', 'Utilities & Internet'], ['TELEFONICA', 'Utilities & Internet'], ['O2 ', 'Utilities & Internet'],
    ['BEITRAGSSERVICE', 'Utilities & Internet'], ['RUNDFUNK', 'Utilities & Internet'],
    ['NETFLIX', 'Subscriptions'], ['SPOTIFY', 'Subscriptions'], ['DISNEY', 'Subscriptions'], ['APPLE.COM/BILL', 'Subscriptions'],
    ['AMAZON PRIME', 'Subscriptions'], ['YOUTUBE', 'Subscriptions'], ['GOOGLE ONE', 'Subscriptions'], ['OPENAI', 'Subscriptions'],
    ['AMAZON', 'Shopping'], ['AMZN', 'Shopping'], ['ZALANDO', 'Shopping'], ['IKEA', 'Shopping'], ['MEDIAMARKT', 'Shopping'], ['SATURN', 'Shopping'],
    ['ALLIANZ', 'Insurance'], ['HUK', 'Insurance'], ['TECHNIKER', 'Insurance'], ['AOK', 'Insurance'], ['ERGO', 'Insurance'],
    ['APOTHEKE', 'Health'], ['PRAXIS', 'Health'],
    ['MCFIT', 'Fitness & Sport'], ['FITSTAR', 'Fitness & Sport'], ['URBAN SPORTS', 'Fitness & Sport'],
    ['LUFTHANSA', 'Travel'], ['RYANAIR', 'Travel'], ['EUROWINGS', 'Travel'], ['BOOKING.COM', 'Travel'], ['AIRBNB', 'Travel'],
    ['FAU ', 'Education'], ['ERLANGEN-NUERNBERG', 'Education'], ['STUDENTENWERK', 'Education'],
    ['WORLDREMIT', 'Family Support'], ['LEMFI', 'Family Support'], ['REMITLY', 'Family Support'], ['WESTERN UNION', 'Family Support'],
    ['DARLEHEN', 'Loan Refund'], ['TILGUNG', 'Loan Refund'], ['KREDITRATE', 'Loan Refund'], ['LOAN REPAYMENT', 'Loan Refund'],
    ['FINANZAMT', 'Taxes'], ['ENTGELT', 'Fees & Charges'], ['KONTOFUEHRUNG', 'Fees & Charges'], ['KONTOFÜHRUNG', 'Fees & Charges'],
    ['DELOITTE', 'Salary'], ['GEHALT', 'Salary'], ['LOHN', 'Salary'], ['ZINSEN', 'Interest & Dividends'], ['DIVIDENDE', 'Interest & Dividends'],
  ];

  // Starter items added after the first release, so existing installs get them too
  const SEED_VERSION = 2;
  const SEED_ADDITIONS = {
    2: { cats: ['Loan Refund'], rules: ['DARLEHEN', 'TILGUNG', 'KREDITRATE', 'LOAN REPAYMENT'] },
  };

  // Fallback rates (units per EUR) until the Sheet or the web provides live ones
  const FALLBACK_RATES = { EUR: 1, NGN: 1700, USD: 1.1, GBP: 0.86 };

  const DEFAULT_SETTINGS = {
    apiUrl: '', apiKey: '', lastSync: 0, lastSyncError: '',
    pinHash: '', pinSalt: '', lockAfterMin: 5, privacy: false,
    defaultCurrency: 'EUR', theme: 'auto', seeded: false, seedVersion: 1,
  };

  /* ── Normalisers: coerce Sheet strings back to typed values ── */
  const NORM = {
    tx: (r) => ({
      id: String(r.id), date: String(r.date).slice(0, 10), type: r.type || 'expense',
      amount: U.num(r.amount), currency: r.currency || 'EUR', rate: U.num(r.rate) || 1,
      amountEUR: r.amountEUR === '' || r.amountEUR == null ? U.toEUR(r.amount, r.rate) : U.num(r.amountEUR),
      category: String(r.category || ''), scope: r.scope || 'personal',
      payee: String(r.payee ?? ''), note: String(r.note ?? ''), goalId: String(r.goalId ?? ''),
      receiptUrl: String(r.receiptUrl ?? ''), source: r.source || 'manual', hash: String(r.hash ?? ''),
      recurringId: String(r.recurringId ?? ''), updatedAt: U.num(r.updatedAt),
    }),
    cats: (r) => ({
      id: String(r.id), name: String(r.name), type: r.type || 'expense', group: r.group || 'Other',
      icon: String(r.icon || '•'), budget: U.num(r.budget), order: U.num(r.order),
      archived: U.bool(r.archived), updatedAt: U.num(r.updatedAt),
    }),
    goals: (r) => ({
      id: String(r.id), name: String(r.name), target: U.num(r.target), startAmount: U.num(r.startAmount),
      deadline: String(r.deadline ?? '').slice(0, 10), icon: String(r.icon || '🎯'),
      archived: U.bool(r.archived), updatedAt: U.num(r.updatedAt),
    }),
    rec: (r) => ({
      id: String(r.id), name: String(r.name || r.payee || ''), type: r.type || 'expense',
      amount: U.num(r.amount), currency: r.currency || 'EUR', category: String(r.category || ''),
      scope: r.scope || 'personal', payee: String(r.payee ?? ''), day: Math.min(31, Math.max(1, U.num(r.day) || 1)),
      active: r.active === '' || r.active == null ? true : U.bool(r.active),
      startMonth: String(r.startMonth || '').slice(0, 7), lastPosted: String(r.lastPosted || '').slice(0, 7),
      updatedAt: U.num(r.updatedAt),
    }),
    rules: (r) => ({ id: String(r.id), pattern: String(r.pattern), category: String(r.category), updatedAt: U.num(r.updatedAt) }),
  };

  const emptyData = () => ({ tx: [], cats: [], goals: [], rec: [], rules: [], rates: { ...FALLBACK_RATES }, ratesAt: 0 });

  const ls = {
    get(k, d) { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.error('Storage full?', e); return false; } },
  };

  const store = {
    data: emptyData(),
    queue: [],
    settings: { ...DEFAULT_SETTINGS },
    _listeners: [],

    load() {
      this.data = Object.assign(emptyData(), ls.get(KEYS.data, {}));
      this.queue = ls.get(KEYS.queue, []);
      this.settings = Object.assign({ ...DEFAULT_SETTINGS }, ls.get(KEYS.settings, {}));
      if (!this.settings.seeded && !this.data.cats.length) this.seed();
      if (!this.settings.apiUrl) this.migrateSeeds(); // synced devices migrate after their first pull
    },
    save() { ls.set(KEYS.data, this.data); ls.set(KEYS.queue, this.queue); },
    saveSettings() { ls.set(KEYS.settings, this.settings); },

    on(fn) { this._listeners.push(fn); },
    emit(reason) { this._listeners.forEach((fn) => fn(reason)); },

    seed() {
      const now = Date.now();
      SEED_CATS.forEach(([name, type, group, icon], i) =>
        this.upsert('cats', { id: 'cat-' + U.hash(name), name, type, group, icon, budget: 0, order: i, archived: false, updatedAt: now }, { silent: true }));
      SEED_RULES.forEach(([pattern, catName]) =>
        this.upsert('rules', { id: 'rule-' + U.hash(pattern), pattern, category: 'cat-' + U.hash(catName), updatedAt: now }, { silent: true }));
      this.settings.seeded = true;
      this.settings.seedVersion = SEED_VERSION;
      this.saveSettings();
      this.save();
    },

    /** Add starter categories/rules introduced in later versions, once, without duplicating. */
    migrateSeeds() {
      const from = this.settings.seedVersion || 1;
      if (from >= SEED_VERSION) return 0;
      let added = 0;
      for (let v = from + 1; v <= SEED_VERSION; v++) {
        const add = SEED_ADDITIONS[v] || {};
        for (const name of add.cats || []) {
          const i = SEED_CATS.findIndex((c) => c[0] === name);
          const [, type, group, icon] = SEED_CATS[i];
          const id = 'cat-' + U.hash(name);
          if (this.data.cats.some((c) => c.id === id || c.name.toLowerCase() === name.toLowerCase())) continue;
          this.upsert('cats', { id, name, type, group, icon, budget: 0, order: i - 0.5, archived: false }, { silent: true });
          added++;
        }
        for (const pattern of add.rules || []) {
          const id = 'rule-' + U.hash(pattern);
          if (this.data.rules.some((r) => r.id === id || r.pattern === pattern)) continue;
          const catName = SEED_RULES.find((r) => r[0] === pattern)[1];
          this.upsert('rules', { id, pattern, category: 'cat-' + U.hash(catName) }, { silent: true });
          added++;
        }
      }
      this.settings.seedVersion = SEED_VERSION;
      this.saveSettings();
      if (added) { this.save(); this.emit('change'); }
      return added;
    },

    /* ── CRUD (every change is queued for the Sheet) ── */
    upsert(coll, obj, opts = {}) {
      const row = NORM[coll]({ ...obj, updatedAt: opts.keepTime && obj.updatedAt ? obj.updatedAt : Date.now() });
      const list = this.data[coll];
      const i = list.findIndex((x) => x.id === row.id);
      if (i >= 0) list[i] = row; else list.push(row);
      this.queue.push({ op: 'upsert', sheet: COLL_SHEET[coll], row });
      if (!opts.silent) { this.save(); this.emit('change'); }
      return row;
    },
    bulkUpsert(coll, rows) {
      rows.forEach((r) => this.upsert(coll, r, { silent: true }));
      this.save();
      this.emit('change');
    },
    remove(coll, id) {
      this.data[coll] = this.data[coll].filter((x) => x.id !== id);
      this.queue.push({ op: 'delete', sheet: COLL_SHEET[coll], row: { id } });
      this.save();
      this.emit('change');
    },

    /** Replace local data with the Sheet's, then replay changes made while syncing. */
    applyRemote(remote, pendingOps = []) {
      const d = emptyData();
      for (const [coll, sheet] of Object.entries(COLL_SHEET)) d[coll] = (remote[sheet] || []).map(NORM[coll]);
      d.rates = Object.assign({}, this.data.rates, remote.Rates || {});
      d.ratesAt = Date.now();
      const sheetToColl = Object.fromEntries(Object.entries(COLL_SHEET).map(([c, s]) => [s, c]));
      for (const op of pendingOps) {
        const coll = sheetToColl[op.sheet];
        const list = d[coll];
        const i = list.findIndex((x) => x.id === op.row.id);
        if (op.op === 'delete') { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = op.row; else list.push(op.row);
      }
      this.data = d;
      this.save();
    },

    /** Queue every local record — used when connecting a fresh Sheet. */
    queueEverything() {
      for (const [coll, sheet] of Object.entries(COLL_SHEET))
        for (const row of this.data[coll]) this.queue.push({ op: 'upsert', sheet, row });
      this.save();
    },

    /* ── Lookups ── */
    cat(id) { return this.data.cats.find((c) => c.id === id); },
    catName(id) { const c = this.cat(id); return c ? c.name : 'Uncategorised'; },
    cats(type, includeArchived = false) {
      return this.data.cats
        .filter((c) => (!type || c.type === type) && (includeArchived || !c.archived))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    },
    rate(cur) { return this.data.rates[cur] || FALLBACK_RATES[cur] || 1; },
    currencies() { return Object.keys(this.data.rates).sort((a, b) => (a === 'EUR' ? -1 : b === 'EUR' ? 1 : a.localeCompare(b))); },

    /* ── Recurring engine: posts due items once per month, idempotent across devices ── */
    postRecurring(todayStr = U.today()) {
      const nowYm = todayStr.slice(0, 7);
      const day = Number(todayStr.slice(8, 10));
      let posted = 0;
      for (const r of this.data.rec) {
        if (!r.active || !r.amount) continue;
        let ym = r.lastPosted ? U.addMonths(r.lastPosted, 1) : (r.startMonth || nowYm);
        let last = r.lastPosted;
        while (ym <= nowYm) {
          const dueDay = Math.min(r.day, U.daysInMonth(ym));
          if (ym === nowYm && dueDay > day) break;
          const id = `rec-${r.id}-${ym}`;
          if (!this.data.tx.some((t) => t.id === id)) {
            const rate = this.rate(r.currency);
            this.upsert('tx', {
              id, date: `${ym}-${String(dueDay).padStart(2, '0')}`, type: r.type, amount: r.amount,
              currency: r.currency, rate, amountEUR: U.toEUR(r.amount, rate), category: r.category,
              scope: r.scope, payee: r.payee || r.name, note: 'Recurring', source: 'recurring', recurringId: r.id,
            }, { silent: true });
            posted++;
          }
          last = ym;
          ym = U.addMonths(ym, 1);
        }
        if (last !== r.lastPosted) this.upsert('rec', { ...r, lastPosted: last }, { silent: true });
      }
      if (posted) { this.save(); this.emit('change'); }
      return posted;
    },

    /** Find the category for a bank-statement line using the rules table. */
    matchRule(text, type) {
      const T = String(text).toUpperCase();
      let best = null;
      for (const r of this.data.rules) {
        const p = String(r.pattern).toUpperCase();
        if (!p || !T.includes(p)) continue;
        const c = this.cat(r.category);
        if (!c || c.type !== type) continue;
        if (!best || p.length > best.pattern.length) best = r;
      }
      return best ? best.category : null;
    },
  };

  /* ── Analytics (pure functions over store.data) ── */
  const calc = {
    txs({ ym, scope = 'all', type } = {}) {
      return store.data.tx.filter((t) =>
        (!ym || t.date.startsWith(ym)) && (scope === 'all' || t.scope === scope) && (!type || t.type === type));
    },
    totals(ym, scope = 'all') {
      const list = calc.txs({ ym, scope });
      const income = U.sum(list.filter((t) => t.type === 'income'), (t) => t.amountEUR);
      const expense = U.sum(list.filter((t) => t.type === 'expense'), (t) => t.amountEUR);
      const saving = U.sum(list.filter((t) => t.type === 'saving'), (t) => t.amountEUR);
      return {
        income, expense, saving, net: income - expense,
        leftover: income - expense - saving,
        savingsRate: income > 0 ? (income - expense) / income : null,
        count: list.length,
      };
    },
    byCategory(ym, scope = 'all', type = 'expense') {
      const by = {};
      for (const t of calc.txs({ ym, scope, type })) by[t.category] = (by[t.category] || 0) + t.amountEUR;
      return Object.entries(by).map(([id, amount]) => ({ id, cat: store.cat(id), amount })).sort((a, b) => b.amount - a.amount);
    },
    byGroup(ym, scope = 'all') {
      const by = Object.fromEntries(GROUPS.map((g) => [g, 0]));
      for (const t of calc.txs({ ym, scope, type: 'expense' })) {
        const g = store.cat(t.category)?.group;
        by[GROUPS.includes(g) ? g : 'Financial'] += t.amountEUR;
      }
      return GROUPS.map((g, i) => ({ group: g, slot: i + 1, amount: by[g] }));
    },
    budgets(ym, todayStr = U.today()) {
      const spent = Object.fromEntries(calc.byCategory(ym, 'all').map((x) => [x.id, x.amount]));
      // Recurring payments (rent, passes) are fixed — only day-to-day spending is extrapolated
      const fixed = {};
      for (const t of calc.txs({ ym, type: 'expense' })) if (t.source === 'recurring') fixed[t.category] = (fixed[t.category] || 0) + t.amountEUR;
      const dim = U.daysInMonth(ym);
      const nowYm = todayStr.slice(0, 7);
      const elapsed = ym < nowYm ? dim : ym > nowYm ? 0 : Number(todayStr.slice(8, 10));
      return store.cats('expense').filter((c) => c.budget > 0 || spent[c.id]).map((c) => {
        const s = spent[c.id] || 0;
        const pct = c.budget > 0 ? s / c.budget : null;
        const f = fixed[c.id] || 0;
        const projected = elapsed > 0 ? f + ((s - f) / elapsed) * dim : 0;
        let status = 'none';
        if (c.budget > 0) status = s > c.budget + 0.005 ? 'over' : pct >= 0.8 ? 'warn' : projected > c.budget * 1.05 && elapsed >= 5 ? 'pace' : 'ok';
        return { cat: c, budget: c.budget, spent: s, pct, projected, remaining: c.budget - s, status };
      }).sort((a, b) => (b.budget > 0) - (a.budget > 0) || (b.pct ?? 0) - (a.pct ?? 0) || b.spent - a.spent);
    },
    series(endYm, n = 12, scope = 'all') {
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const ym = U.addMonths(endYm, -i);
        out.push({ ym, ...calc.totals(ym, scope) });
      }
      return out;
    },
    daily(ym, scope = 'all') {
      const dim = U.daysInMonth(ym);
      const days = Array.from({ length: dim }, (_, i) => ({ day: i + 1, amount: 0, count: 0 }));
      for (const t of calc.txs({ ym, scope, type: 'expense' })) {
        const d = days[Number(t.date.slice(8, 10)) - 1];
        if (d) { d.amount += t.amountEUR; d.count++; }
      }
      return days;
    },
    cumulative(ym, scope = 'all') {
      let run = 0;
      return calc.daily(ym, scope).map((d) => ({ day: d.day, value: (run += d.amount) }));
    },
    topPayees(ym, scope = 'all', n = 6) {
      const by = {};
      for (const t of calc.txs({ ym, scope, type: 'expense' })) {
        const k = (t.payee || store.catName(t.category)).trim();
        by[k] = by[k] || { name: k, amount: 0, count: 0 };
        by[k].amount += t.amountEUR;
        by[k].count++;
      }
      return Object.values(by).sort((a, b) => b.amount - a.amount).slice(0, n);
    },
    sentHome(year) {
      const ids = new Set(store.data.cats.filter((c) => c.group === 'Sent Home').map((c) => c.id));
      const list = store.data.tx.filter((t) => t.type === 'expense' && ids.has(t.category) && t.date.startsWith(String(year)));
      const months = Array.from({ length: 12 }, (_, i) => ({ ym: `${year}-${String(i + 1).padStart(2, '0')}`, amount: 0, ngn: 0 }));
      for (const t of list) {
        const m = months[Number(t.date.slice(5, 7)) - 1];
        m.amount += t.amountEUR;
        m.ngn += t.currency === 'NGN' ? t.amount : t.amountEUR * store.rate('NGN');
      }
      return { months, total: U.sum(months, (m) => m.amount), totalNGN: U.sum(months, (m) => m.ngn) };
    },
    goal(g) {
      const saved = g.startAmount + U.sum(store.data.tx.filter((t) => t.type === 'saving' && t.goalId === g.id), (t) => t.amountEUR);
      const pct = g.target > 0 ? Math.min(1, saved / g.target) : 0;
      let perMonth = null;
      if (g.deadline && saved < g.target) {
        const months = Math.max(1, (Number(g.deadline.slice(0, 4)) - Number(U.today().slice(0, 4))) * 12
          + Number(g.deadline.slice(5, 7)) - Number(U.today().slice(5, 7)));
        perMonth = (g.target - saved) / months;
      }
      return { saved, pct, perMonth, remaining: Math.max(0, g.target - saved) };
    },
  };

  IL.store = store;
  IL.calc = calc;
  IL.GROUPS = GROUPS;
  IL.COLL_SHEET = COLL_SHEET;
  IL.FALLBACK_RATES = FALLBACK_RATES;
})(typeof window !== 'undefined' ? window : globalThis);
