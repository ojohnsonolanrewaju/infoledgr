/* InfoLedgr — Google Sheets sync (via Apps Script), receipt storage, exchange rates */
(function (root) {
  const IL = (root.IL = root.IL || {});
  const { store, util: U } = IL;

  /* ── Tiny IndexedDB wrapper for receipt photos ── */
  const idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('infoledgr', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('receipts');
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async op(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('receipts', mode);
        const req = fn(tx.objectStore('receipts'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    get(k) { return this.op('readonly', (s) => s.get(k)); },
    put(k, v) { return this.op('readwrite', (s) => s.put(v, k)); },
    del(k) { return this.op('readwrite', (s) => s.delete(k)); },
  };

  const api = {
    async call(action, payload = {}, cfg = store.settings) {
      if (!cfg.apiUrl) throw new Error('Not connected');
      // text/plain body avoids a CORS preflight, which Apps Script can't answer
      const res = await fetch(cfg.apiUrl, { method: 'POST', body: JSON.stringify({ key: cfg.apiKey, action, ...payload }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let json;
      try { json = await res.json(); } catch { throw new Error('Unexpected response — check the Web App URL and that access is set to "Anyone"'); }
      if (!json.ok) throw new Error(json.error === 'unauthorized' ? 'Wrong API key' : json.error || 'Request failed');
      return json;
    },
  };

  function compact(ops) {
    const last = new Map();
    ops.forEach((o) => last.set(o.sheet + '|' + o.row.id, o));
    return [...last.values()];
  }

  const sync = {
    status: 'idle', // idle | syncing | offline | error | local
    running: null,
    configured() { return !!(store.settings.apiUrl && store.settings.apiKey); },

    setStatus(s, err = '') {
      this.status = s;
      store.settings.lastSyncError = err;
      store.saveSettings();
      store.emit('sync');
    },

    async run() {
      if (this.running) return this.running;
      this.running = this._run().finally(() => { this.running = null; });
      return this.running;
    },

    async _run() {
      if (!this.configured()) {
        this.setStatus('local');
        await this.refreshWebRates();
        return;
      }
      if (!navigator.onLine) return this.setStatus('offline');
      this.setStatus('syncing');
      try {
        await this.uploadReceipts();
        const n = store.queue.length;
        if (n) {
          const ops = compact(store.queue.slice(0, n));
          for (let i = 0; i < ops.length; i += 400) await api.call('push', { ops: ops.slice(i, i + 400) });
          store.queue.splice(0, n);
          store.save();
        }
        const { data } = await api.call('pull');
        store.applyRemote(data, store.queue);
        store.migrateSeeds();
        store.postRecurring();
        store.settings.lastSync = Date.now();
        this.setStatus('idle');
        store.emit('change');
        if (store.queue.length) this.schedule();
      } catch (e) {
        console.warn('Sync failed', e);
        this.setStatus(navigator.onLine ? 'error' : 'offline', String(e.message || e));
      }
    },

    schedule: null, // set below (debounced run)

    /** Connect a Sheet. `chooseMerge` is asked only when both sides hold data. */
    async connect(apiUrl, apiKey, chooseMerge) {
      const cfg = { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() };
      await api.call('ping', {}, cfg);
      const { data } = await api.call('pull', {}, cfg);
      Object.assign(store.settings, cfg);
      store.saveSettings();

      const remoteEmpty = !(data.Categories || []).length;
      const localHasTx = store.data.tx.length > 0;
      store.queue = [];
      if (remoteEmpty) {
        store.queueEverything(); // first device: upload categories, rules and any local history
      } else if (localHasTx && (await chooseMerge())) {
        // Merge: add only records the Sheet doesn't have, so its edits (budgets etc.) win
        const missing = [];
        for (const [coll, sheet] of Object.entries(IL.COLL_SHEET)) {
          const remoteIds = new Set((data[sheet] || []).map((r) => String(r.id)));
          for (const row of store.data[coll]) if (!remoteIds.has(row.id)) missing.push({ op: 'upsert', sheet, row });
        }
        store.applyRemote(data, missing);
        store.queue = missing;
        store.save();
      } else {
        store.applyRemote(data);
      }
      await this.run();
    },

    disconnect() {
      Object.assign(store.settings, { apiUrl: '', apiKey: '', lastSync: 0 });
      store.saveSettings();
      this.setStatus('local');
    },

    async addCurrency(code) {
      code = code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new Error('Use a 3-letter currency code, e.g. CHF');
      if (this.configured()) {
        const { rates } = await api.call('addCurrency', { code });
        Object.assign(store.data.rates, rates);
        if (!rates[code]) store.data.rates[code] = store.data.rates[code] || 1; // GOOGLEFINANCE may need a moment
      } else {
        store.data.rates[code] = store.data.rates[code] || 1;
        store.data.ratesAt = 0;
        await this.refreshWebRates();
      }
      store.save();
      store.emit('change');
    },

    /** Local-only mode: refresh rates from a free public API once a day. */
    async refreshWebRates() {
      if (Date.now() - (store.data.ratesAt || 0) < 864e5 || !navigator.onLine) return;
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/EUR');
        const j = await res.json();
        if (j.result !== 'success') return;
        for (const c of Object.keys(store.data.rates)) if (j.rates[c]) store.data.rates[c] = j.rates[c];
        store.data.ratesAt = Date.now();
        store.save();
        store.emit('change');
      } catch { /* offline or blocked — keep the last known rates */ }
    },

    /* ── Receipts ── */
    async saveReceipt(txId, dataUrl) {
      await idb.put(txId, dataUrl);
    },
    async getReceipt(txId) { return idb.get(txId); },
    async deleteReceipt(txId) { try { await idb.del(txId); } catch { /* ignore */ } },

    async uploadReceipts() {
      const pending = store.data.tx.filter((t) => t.receiptUrl === 'local');
      for (const t of pending) {
        const dataUrl = await idb.get(t.id);
        if (!dataUrl) continue;
        const [meta, b64] = dataUrl.split(',');
        const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
        const name = `${t.date} ${t.payee || store.catName(t.category)} ${t.amount}${t.currency}.jpg`.replace(/[\\/:*?"<>|]/g, '');
        const { url } = await api.call('upload', { data: b64, mime, name });
        store.upsert('tx', { ...t, receiptUrl: url }, { silent: true });
        await idb.del(t.id);
      }
      if (pending.length) store.save();
    },
  };

  /** Shrink a photo to a sensible JPEG before storing/uploading it. */
  sync.compressImage = function (file, maxSide = 1400, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  sync.schedule = U.debounce(() => sync.run(), 1500);

  IL.api = api;
  IL.sync = sync;
})(window);
