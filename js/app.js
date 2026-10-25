/* InfoLedgr — UI: views, forms, import flow, lock screen */
(function () {
  const IL = window.IL;
  const { util: U, store, calc, sync, charts, csv } = IL;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = U.esc;

  const SCRIPT_VERSION = 3; // Code.gs version this app expects
  const S = { view: 'home', ym: U.currentYm(), scope: 'all', q: '', type: '', cat: '', txScope: 'all', planTab: 'budgets' };
  const TITLES = { home: 'Home', activity: 'Activity', plan: 'Plan', insights: 'Insights', more: 'Settings' };

  /* ── Formatting helpers ── */
  const M = (v, cur = 'EUR', o = {}) => `<span class="money">${U.fmt(v, cur, o)}</span>`;
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const ICON = {
    sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  };
  const STATUS = {
    over: { icon: '!', cls: 'over', text: (b) => `Over by ${U.fmt(-b.remaining)}` },
    warn: { icon: '!', cls: 'warn', text: (b) => (b.remaining <= 0.005 ? 'Budget fully used' : `${pct(b.pct)} used · ${U.fmt(b.remaining)} left`) },
    pace: { icon: '↗', cls: 'pace', text: (b) => `On pace for ${U.fmt(b.projected, 'EUR', { decimals: 0 })}` },
    ok:   { icon: '✓', cls: 'ok', text: (b) => `${U.fmt(b.remaining)} left` },
    none: { icon: '·', cls: 'none', text: () => 'No budget set' },
  };

  /* ── Modal, confirm, toast ── */
  function modal({ title, body, wide = false, onMount, onClose }) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-h"><h2>${esc(title)}</h2><button class="modal-x" aria-label="Close">×</button></div>
      <div class="modal-b">${body}</div></div>`;
    $('#modal-root').appendChild(bg);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); charts.hideTip(); if (onClose) onClose(); };
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    bg.querySelector('.modal-x').onclick = close;
    document.addEventListener('keydown', onKey);
    const m = bg.querySelector('.modal');
    if (onMount) onMount(m, close);
    return close;
  }

  function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', danger = false, title = 'Are you sure?' } = {}) {
    return new Promise((resolve) => {
      let answer = false;
      modal({
        title,
        body: `<p style="color:var(--ink2);margin-bottom:18px">${message}</p>
          <div class="modal-actions"><button class="btn" data-a="no">${cancel}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${ok}</button></div>`,
        onMount(m, close) {
          m.querySelector('[data-a=no]').onclick = close;
          m.querySelector('[data-a=yes]').onclick = () => { answer = true; close(); };
        },
        onClose: () => resolve(answer),
      });
    });
  }

  let toastTimer;
  function toast(msg, { action, onAction, ms = 3200 } = {}) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
    if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); onAction(); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
  }

  /* ── Router & chrome ── */
  function go(view) {
    if (location.hash !== '#' + view) location.hash = view;
    else render();
  }
  function onHash() {
    const h = location.hash.slice(1);
    if (h === 'add') { history.replaceState(null, '', '#' + S.view); openTxForm(); return; }
    if (h.startsWith('connect?')) {
      // One-tap link from the Sheet's InfoLedgr menu: #connect?u=<web app url>&k=<key>
      const p = new URLSearchParams(h.slice(8));
      history.replaceState(null, '', '#more'); // don't leave the key in the address bar
      S.view = 'more'; render();
      connectModal({ url: p.get('u') || '', key: p.get('k') || '' });
      return;
    }
    S.view = TITLES[h] ? h : 'home';
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    charts.hideTip();
    $('#view-title').textContent = TITLES[S.view];
    $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    $('#month-switch').hidden = S.view === 'more' || (S.view === 'plan' && S.planTab !== 'budgets');
    $('#month-label').textContent = U.monthLabel(S.ym, { month: 'short', year: 'numeric' });
    VIEWS[S.view]();
    renderChrome();
  }

  function renderChrome() {
    const st = sync.status;
    const configured = sync.configured();
    const pending = store.queue.length;
    let dot = 'off', title = 'Local only — connect Google Sheets in Settings';
    if (configured) {
      if (st === 'error') { dot = 'err'; title = 'Sync error: ' + store.settings.lastSyncError; }
      else if (st === 'offline' || pending) { dot = 'warn'; title = st === 'offline' ? 'Offline — changes will sync later' : `${pending} change(s) waiting to sync`; }
      else { dot = 'ok'; title = 'Synced ' + ago(store.settings.lastSync); }
    }
    const btn = $('#sync-btn');
    btn.innerHTML = ICON.sync + `<span class="dot ${dot}"></span>`;
    btn.title = title;
    btn.classList.toggle('spin', st === 'syncing');
    $('#nav-sync').innerHTML = `<span class="dot ${dot}" style="display:inline-block;position:static;width:8px;height:8px;border:0;margin-right:6px"></span>${esc(configured ? (st === 'syncing' ? 'Syncing…' : title) : 'Local only')}`;
    const p = store.settings.privacy;
    $('#privacy-btn').innerHTML = p ? ICON.eyeOff : ICON.eye;
    $('#privacy-btn').title = p ? 'Show amounts' : 'Hide amounts';
    document.body.classList.toggle('privacy', p);
    window.IL.privacy = p;
  }

  function ago(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  /* ── Shared bits ── */
  function sortTx(list) {
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  }
  function goalOf(id) { return store.data.goals.find((g) => g.id === id); }

  function txRow(t) {
    const c = store.cat(t.category);
    const g = t.type === 'saving' ? goalOf(t.goalId) : null;
    const icon = g ? g.icon : c?.icon || '•';
    const label = t.type === 'saving' ? (g ? g.name : 'Savings') : c?.name || 'Uncategorised';
    const name = t.payee || label;
    const sign = t.type === 'income' ? 1 : -1;
    const cls = t.type === 'income' ? 'amt-in' : t.type === 'saving' ? 'amt-save' : '';
    const foreign = t.currency !== 'EUR';
    const sub = [t.payee ? label : '', t.note && t.note !== 'Recurring' ? t.note : '', t.source === 'recurring' ? '↻ recurring' : '']
      .filter(Boolean).join(' · ');
    return `<button class="tx" data-act="edit-tx" data-id="${esc(t.id)}">
      <span class="tx-ico">${icon}</span>
      <span class="tx-main"><span class="tx-name">${esc(name)}${t.scope === 'business' ? '<span class="badge biz">BIZ</span>' : ''}${t.receiptUrl ? ' 📎' : ''}</span>
      <span class="tx-sub">${esc(sub || U.dayLabel(t.date))}</span></span>
      <span class="tx-amt ${cls}">${M(sign * t.amount, t.currency, { sign: t.type === 'income' })}
      ${foreign ? `<small>${M(t.amountEUR, 'EUR')}</small>` : ''}</span></button>`;
  }

  function budgetRow(b) {
    const st = STATUS[b.status];
    const w = b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 100;
    return `<button class="budget" data-act="edit-budget" data-id="${b.cat.id}">
      <span class="budget-top"><span>${b.cat.icon}</span><span class="budget-name">${esc(b.cat.name)}</span>
      <span class="budget-amt"><b>${M(b.spent)}</b>${b.budget > 0 ? ` <span class="muted">/ ${M(b.budget, 'EUR', { decimals: 0 })}</span>` : ''}</span></span>
      <span class="bar"><b class="${st.cls}" style="width:${b.status === 'none' ? 0 : w}%"></b></span>
      <span class="budget-status"><span class="st-${st.cls}">${st.icon} ${esc(st.text(b))}</span>
      ${b.budget > 0 && b.status !== 'over' ? `<span>${pct(b.pct)}</span>` : ''}</span></button>`;
  }

  /* ════════════════════ VIEWS ════════════════════ */
  const VIEWS = {};

  VIEWS.home = function () {
    const ym = S.ym;
    const t = calc.totals(ym);
    const budgets = calc.budgets(ym);
    const budgeted = budgets.filter((b) => b.budget > 0);
    const totalBudget = U.sum(budgeted, (b) => b.budget);
    const spentBudgeted = U.sum(budgeted, (b) => b.spent);
    const dim = U.daysInMonth(ym), nowYm = U.currentYm();
    const elapsed = ym < nowYm ? dim : ym > nowYm ? 0 : Number(U.today().slice(8));
    const daysLeft = ym === nowYm ? dim - elapsed + 1 : 0;
    const alerts = budgets.filter((b) => ['over', 'warn', 'pace'].includes(b.status)).slice(0, 4);
    const family = calc.family(ym);
    const biz = calc.totals(ym, 'business');
    const top = calc.byCategory(ym)[0];
    const recent = sortTx(calc.txs({ ym })).slice(0, 6);
    const goals = store.data.goals.filter((g) => !g.archived).slice(0, 3);
    const empty = store.data.tx.length === 0;

    $('#view').innerHTML = `
      ${empty ? `<div class="card"><div class="card-h" style="display:block"><h2>Welcome to InfoLedgr 👋</h2>
        <p style="font-weight:500;margin-top:2px">Your personal income, expense &amp; budget tracker</p></div>
        <p class="sub" style="margin-bottom:14px">Start by adding a payment, importing your bank statement, or connecting your Google Sheet so your phone and laptop stay in sync.</p>
        <div class="onboard"><button class="btn primary" data-act="add">＋ Add a transaction</button>
        <button class="btn" data-act="import">⬆ Import bank CSV</button>
        <button class="btn" data-act="connect">🔗 Connect Google Sheet</button></div></div>` : ''}
      <div class="grid2">
        <div class="card hero">
          <div class="label">${U.monthLabel(ym)} · net</div>
          <div class="big money">${U.fmt(t.net, 'EUR', { sign: true })}</div>
          <div class="meta">${t.income <= 0 ? 'No income recorded yet this month' : t.net >= 0 ? `You kept ${pct(t.savingsRate)} of your income` : `Spending is ${U.fmt(-t.net, 'EUR', { decimals: 0 })} ahead of income so far`}</div>
          <div class="hero-row">
            <div class="hero-stat"><div class="k">Income</div><div class="v">${M(t.income)}</div></div>
            <div class="hero-stat"><div class="k">Spent</div><div class="v">${M(t.expense)}</div></div>
            <div class="hero-stat"><div class="k">Saved</div><div class="v">${M(t.saving)}</div></div>
          </div>
          ${totalBudget > 0 ? `<div class="pace">
            <div class="pace-bar"><b style="width:${Math.min(100, (spentBudgeted / totalBudget) * 100)}%"></b>${ym === nowYm ? `<i style="left:${(elapsed / dim) * 100}%" title="Today"></i>` : ''}</div>
            <div class="pace-txt"><span>${M(spentBudgeted)} of ${M(totalBudget, 'EUR', { decimals: 0 })} budget</span>
            <span>${daysLeft ? `${M(Math.max(0, (totalBudget - spentBudgeted) / daysLeft))}/day · ${daysLeft} days left` : totalBudget - spentBudgeted >= 0 ? 'Within budget ✓' : 'Over budget'}</span></div>
          </div>` : `<div class="pace-txt" style="margin-top:14px"><span>No budgets yet</span><button class="link" style="color:#9DB5FF" data-act="bulk-budgets">Set budgets →</button></div>`}
        </div>
        <div class="card">
          <div class="card-h"><h2>Budget alerts</h2><button class="link" data-go="plan">All budgets</button></div>
          ${alerts.length ? alerts.map((b) => `<button class="alert" style="width:100%;text-align:left" data-act="edit-budget" data-id="${b.cat.id}">
              <span class="ico ${STATUS[b.status].cls}">${STATUS[b.status].icon}</span>
              <span style="flex:1;min-width:0"><b style="font-weight:500">${b.cat.icon} ${esc(b.cat.name)}</b><br><span class="sub">${esc(STATUS[b.status].text(b))}</span></span>
              <span class="money" style="font-weight:600">${pct(b.pct)}</span></button>`).join('')
            : `<div class="alert"><span class="ico ok">✓</span><span>${budgeted.length ? 'All budgets on track.' : 'Set category budgets to get alerts here.'}</span></div>`}
        </div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">👪 Family &amp; giving</div><div class="v">${M(family)}</div><div class="d">${t.expense > 0 ? `${pct(family / t.expense)} of your spending` : '&nbsp;'}</div></div>
        <div class="tile"><div class="k">🏢 Business spend</div><div class="v">${M(biz.expense)}</div><div class="d">Income ${M(biz.income)}</div></div>
        <div class="tile"><div class="k">Top category</div><div class="v">${top ? `${top.cat?.icon || ''} ${M(top.amount)}` : '—'}</div><div class="d">${top ? esc(top.cat?.name || '') : 'No spending yet'}</div></div>
        <div class="tile"><div class="k">Transactions</div><div class="v num">${t.count}</div><div class="d">${t.expense > 0 && elapsed ? `${M(t.expense / elapsed)} / day avg` : '&nbsp;'}</div></div>
      </div>
      <div class="grid2">
        <div class="card">
          <div class="card-h"><h2>Recent</h2><button class="link" data-go="activity">See all</button></div>
          <div class="tx-list">${recent.map(txRow).join('') || '<p class="empty" style="padding:14px">No transactions this month.</p>'}</div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Savings goals</h2><button class="link" data-act="goal-new">＋ New</button></div>
          ${goals.length ? goals.map(goalRow).join('') : '<p class="empty">Create a goal — an emergency fund, a holiday, a new laptop.</p>'}
        </div>
      </div>`;
  };

  function goalRow(g) {
    const p = calc.goal(g);
    const sub = p.saved >= g.target ? 'Goal reached 🎉'
      : p.perMonth != null ? `${U.fmt(p.perMonth, 'EUR', { decimals: 0 })}/month to reach it by ${U.monthLabel(g.deadline.slice(0, 7), { month: 'short', year: 'numeric' })}`
      : `${U.fmt(p.remaining, 'EUR', { decimals: 0 })} to go`;
    return `<div class="goal">
      <div class="goal-top"><span class="goal-ico">${g.icon}</span>
        <button style="flex:1;text-align:left;min-width:0" data-act="goal-edit" data-id="${g.id}"><b style="font-weight:600">${esc(g.name)}</b><br>
        <span class="sub">${M(p.saved, 'EUR', { decimals: 0 })} of ${M(g.target, 'EUR', { decimals: 0 })}</span></button>
        <button class="btn sm" data-act="goal-add" data-id="${g.id}">＋ Add</button></div>
      <div class="bar"><b style="width:${p.pct * 100}%"></b></div>
      <div class="budget-status"><span>${esc(sub)}</span><span>${pct(p.pct)}</span></div></div>`;
  }

  /* ── Activity ── */
  VIEWS.activity = function () {
    const cats = store.cats(null, true);
    $('#view').innerHTML = `
      <div class="search">${ICON.search}<input id="q" type="search" placeholder="Search payee, note, category, amount…" value="${esc(S.q)}" autocomplete="off"></div>
      <div class="filters">
        ${[['', 'All'], ['expense', 'Spent'], ['income', 'Income'], ['saving', 'Saved']].map(([v, l]) => `<button class="chip${S.type === v ? ' on' : ''}" data-type="${v}">${l}</button>`).join('')}
        <select class="chip" id="f-scope" aria-label="Personal or business">
          <option value="all">Personal + Business</option><option value="personal"${S.txScope === 'personal' ? ' selected' : ''}>Personal</option>
          <option value="business"${S.txScope === 'business' ? ' selected' : ''}>Business</option></select>
        <select class="chip" id="f-cat" aria-label="Category"><option value="">All categories</option>
          ${cats.map((c) => `<option value="${c.id}"${S.cat === c.id ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="toolbar"><button class="btn sm" data-act="import">⬆ Import bank CSV</button><button class="btn sm" data-act="export">⬇ Export CSV</button></div>
      <div id="tx-results"></div>`;
    const q = $('#q');
    q.addEventListener('input', U.debounce(() => { S.q = q.value; renderTxList(); }, 150));
    $$('[data-type]').forEach((b) => b.addEventListener('click', () => { S.type = b.dataset.type; VIEWS.activity(); }));
    $('#f-scope').onchange = (e) => { S.txScope = e.target.value; renderTxList(); };
    $('#f-cat').onchange = (e) => { S.cat = e.target.value; renderTxList(); };
    renderTxList();
  };

  function filteredTx() {
    const q = S.q.trim().toLowerCase();
    return sortTx(store.data.tx.filter((t) => {
      if (!q && !t.date.startsWith(S.ym)) return false;
      if (S.type && t.type !== S.type) return false;
      if (S.txScope !== 'all' && t.scope !== S.txScope) return false;
      if (S.cat && t.category !== S.cat) return false;
      if (q) {
        const hay = `${t.payee} ${t.note} ${store.catName(t.category)} ${t.amount} ${t.date} ${t.currency}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    }));
  }

  function renderTxList() {
    const box = $('#tx-results');
    if (!box) return;
    const list = filteredTx();
    const shown = list.slice(0, 400);
    const inc = U.sum(list.filter((t) => t.type === 'income'), (t) => t.amountEUR);
    const out = U.sum(list.filter((t) => t.type === 'expense'), (t) => t.amountEUR);
    const days = U.groupBy(shown, (t) => t.date);
    box.innerHTML = `
      <p class="sub" style="padding:2px 4px">${list.length} transaction${list.length === 1 ? '' : 's'} ${S.q ? 'found across all months' : 'in ' + U.monthLabel(S.ym)}
        · <span class="amt-in">${M(inc, 'EUR', { sign: true })}</span> · ${M(-out)}</p>
      ${Object.entries(days).map(([d, txs]) => `
        <div class="tx-day"><span>${U.dayLabel(d)}${S.q ? ' ' + d.slice(0, 4) : ''}</span><span class="money">${((s) => (s ? U.fmt(-s) : ''))(U.sum(txs.filter((t) => t.type === 'expense'), (t) => t.amountEUR))}</span></div>
        <div class="tx-list">${txs.map(txRow).join('')}</div>`).join('') || '<div class="card"><p class="empty">No transactions match. Tap ＋ to add one.</p></div>'}
      ${list.length > shown.length ? `<p class="sub" style="text-align:center;padding:10px">Showing the newest 400 — refine your search to see more.</p>` : ''}`;
  }

  /* ── Plan: budgets, goals, recurring ── */
  VIEWS.plan = function () {
    const tabs = [['budgets', 'Budgets'], ['goals', 'Goals'], ['recurring', 'Recurring']];
    let body = '';
    if (S.planTab === 'budgets') {
      const all = calc.budgets(S.ym);
      const budgeted = all.filter((b) => b.budget > 0);
      const unbudgeted = all.filter((b) => !(b.budget > 0));
      const tb = U.sum(budgeted, (b) => b.budget), ts = U.sum(budgeted, (b) => b.spent);
      const status = ts > tb ? 'over' : ts > tb * 0.8 ? 'warn' : 'ok';
      body = `
        <div class="card">
          <div class="card-h"><h2>${U.monthLabel(S.ym)}</h2><button class="link" data-act="bulk-budgets">Edit all budgets</button></div>
          ${tb > 0 ? `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
              <div><span style="font-size:26px;font-weight:600" class="money">${U.fmt(ts)}</span> <span class="muted">of ${M(tb, 'EUR', { decimals: 0 })}</span></div>
              <span class="st-${status}" style="font-size:13px">${STATUS[status].icon} ${tb - ts >= 0 ? U.fmt(tb - ts) + ' left' : 'Over by ' + U.fmt(ts - tb)}</span></div>
            <div class="bar" style="height:10px"><b class="${status}" style="width:${Math.min(100, (ts / tb) * 100)}%"></b></div>`
            : `<p class="sub">Give each category a monthly limit. InfoLedgr warns you at 80%, when you're on pace to overspend, and when you go over.</p>
               <button class="btn primary" style="margin-top:12px" data-act="bulk-budgets">Set budgets</button>`}
        </div>
        ${budgeted.length ? `<div class="card">${budgeted.map(budgetRow).join('')}</div>` : ''}
        ${unbudgeted.length ? `<p class="section-title">Spending without a budget</p><div class="card">${unbudgeted.map(budgetRow).join('')}</div>` : ''}`;
    } else if (S.planTab === 'goals') {
      const goals = store.data.goals.filter((g) => !g.archived);
      body = `<div class="card"><div class="card-h"><h2>Savings goals</h2><button class="btn sm primary" data-act="goal-new">＋ New goal</button></div>
        ${goals.length ? goals.map(goalRow).join('') : '<p class="empty">No goals yet. Money you move towards a goal is logged as “Saved”, so it doesn’t count as spending.</p>'}</div>`;
    } else {
      const rec = [...store.data.rec].sort((a, b) => b.active - a.active || a.day - b.day);
      const fixedOut = U.sum(rec.filter((r) => r.active && r.type === 'expense'), (r) => U.toEUR(r.amount, store.rate(r.currency)));
      const fixedIn = U.sum(rec.filter((r) => r.active && r.type === 'income'), (r) => U.toEUR(r.amount, store.rate(r.currency)));
      body = `<div class="tiles" style="grid-template-columns:1fr 1fr">
          <div class="tile"><div class="k">Fixed costs / month</div><div class="v">${M(fixedOut)}</div></div>
          <div class="tile"><div class="k">Regular income / month</div><div class="v">${M(fixedIn)}</div></div></div>
        <div class="card"><div class="card-h"><h2>Recurring items</h2><button class="btn sm primary" data-act="rec-new">＋ New</button></div>
        ${rec.length ? rec.map((r) => {
          const c = store.cat(r.category);
          const next = nextRecDate(r);
          return `<div class="set-row"><span class="tx-ico">${c?.icon || '↻'}</span>
            <button class="t" data-act="rec-edit" data-id="${r.id}"><b>${esc(r.name)}</b>
            <small>${M(r.amount, r.currency)} · ${r.type} · day ${r.day}${r.active ? ` · next ${U.dayLabel(next)}` : ' · paused'}</small></button>
            <label class="switch" aria-label="Active"><input type="checkbox" data-act="rec-toggle" data-id="${r.id}"${r.active ? ' checked' : ''}><span></span></label></div>`;
        }).join('') : '<p class="empty">Add rent, salary, subscriptions and insurance once — they post automatically every month.</p>'}</div>`;
    }
    $('#view').innerHTML = `<div class="seg" role="tablist">${tabs.map(([k, l]) => `<button class="${S.planTab === k ? 'on' : ''}" data-plantab="${k}">${l}</button>`).join('')}</div>${body}`;
    $$('[data-plantab]').forEach((b) => b.addEventListener('click', () => { S.planTab = b.dataset.plantab; render(); }));
  };

  function nextRecDate(r) {
    let ym = r.lastPosted ? U.addMonths(r.lastPosted, 1) : (r.startMonth || U.currentYm());
    if (ym < U.currentYm()) ym = U.currentYm();
    return `${ym}-${String(Math.min(r.day, U.daysInMonth(ym))).padStart(2, '0')}`;
  }

  /* ── Insights ── */
  VIEWS.insights = function () {
    const ym = S.ym, sc = S.scope;
    const t = calc.totals(ym, sc), p = calc.totals(U.addMonths(ym, -1), sc);
    const nowYm = U.currentYm(), dim = U.daysInMonth(ym);
    const elapsed = ym < nowYm ? dim : ym > nowYm ? 0 : Number(U.today().slice(8));
    const delta = (a, b, upIsGood) => {
      if (!b) return '<span class="muted">no data last month</span>';
      const d = (a - b) / b;
      const up = d >= 0;
      return `<span class="${up === upIsGood ? 'up-good' : 'up-bad'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}%</span> vs last month`;
    };
    const groups = calc.byGroup(ym, sc);
    const cats = calc.byCategory(ym, sc);
    const year = ym.slice(0, 4);
    const fam = calc.familyYear(year, sc);
    const famNames = store.cats('expense').filter((c) => c.group === IL.FAMILY).map((c) => c.name).join(' + ');
    const pers = calc.totals(ym, 'personal'), biz = calc.totals(ym, 'business');

    $('#view').innerHTML = `
      <div class="seg">${[['all', 'Everything'], ['personal', 'Personal'], ['business', 'Business']].map(([k, l]) => `<button class="${sc === k ? 'on' : ''}" data-scope="${k}">${l}</button>`).join('')}</div>
      <div class="tiles">
        <div class="tile"><div class="k">Income</div><div class="v">${M(t.income)}</div><div class="d">${delta(t.income, p.income, true)}</div></div>
        <div class="tile"><div class="k">Spent</div><div class="v">${M(t.expense)}</div><div class="d">${delta(t.expense, p.expense, false)}</div></div>
        <div class="tile"><div class="k">Savings rate</div><div class="v">${t.savingsRate != null && t.savingsRate < 0 ? 'Below 0%' : pct(t.savingsRate)}</div><div class="d">${p.savingsRate != null ? `last month ${pct(p.savingsRate)}` : '&nbsp;'}</div></div>
        <div class="tile"><div class="k">Average per day</div><div class="v">${elapsed ? M(t.expense / elapsed) : '—'}</div><div class="d">${elapsed ? `over ${elapsed} days` : '&nbsp;'}</div></div>
      </div>
      <div class="grid2">
        <div class="card span2"><div class="card-h"><h2>Income vs spending</h2><span class="sub">last 12 months</span></div>
          <div class="chart" id="ch-12m"></div>
          <div class="legend"><span><i style="background:var(--s1)"></i>Income</span><span><i style="background:var(--s2)"></i>Spent</span></div></div>
        <div class="card"><div class="card-h"><h2>Spending pace</h2><span class="sub">cumulative</span></div>
          <div class="chart" id="ch-pace"></div>
          <div class="legend"><span><i style="background:var(--s1)"></i>${U.monthLabel(ym, { month: 'long' })}</span><span><i class="dash"></i>${U.monthLabel(U.addMonths(ym, -1), { month: 'long' })}</span></div></div>
        <div class="card"><div class="card-h"><h2>Where it went</h2><span class="sub">${U.monthLabel(ym, { month: 'long' })}</span></div>
          <div class="donut-wrap"><div id="ch-donut"></div>
          <div class="donut-legend">${groups.map((g) => `<div><i style="background:var(--s${g.slot})"></i><span>${g.group}</span><b class="money">${U.fmt(g.amount, 'EUR', { decimals: 0 })}</b></div>`).join('')}</div></div></div>
        <div class="card"><div class="card-h"><h2>By category</h2><span class="sub">tap to see payments</span></div><div id="ch-cats"></div></div>
        <div class="card"><div class="card-h"><h2>Daily spending</h2><span class="sub">tap a day</span></div><div id="ch-cal"></div></div>
        <div class="card"><div class="card-h"><h2>Top payees</h2></div><div id="ch-payees"></div></div>
        <div class="card"><div class="card-h"><h2>Personal vs business</h2><span class="sub">${U.monthLabel(ym, { month: 'long' })}</span></div>
          <div class="set-row"><span class="tx-ico">👤</span><span class="t"><b>Personal</b><small>Spent ${M(pers.expense)} · income ${M(pers.income)}</small></span><b class="money">${U.fmt(pers.net, 'EUR', { sign: true })}</b></div>
          <div class="set-row"><span class="tx-ico">🏢</span><span class="t"><b>Business / side hustle</b><small>Spent ${M(biz.expense)} · income ${M(biz.income)}</small></span><b class="money">${U.fmt(biz.net, 'EUR', { sign: true })}</b></div>
          <p class="sub" style="margin-top:8px">Mark a payment as Business when you add it. Handy for your tax return.</p></div>
        <div class="card span2"><div class="card-h"><h2>👪 Family &amp; giving in ${year}</h2><span class="sub">${esc(famNames || 'Categories in the “Family & Giving” group')}</span></div>
          <div style="display:flex;gap:22px;flex-wrap:wrap;margin-bottom:10px">
            <div><div class="sub">Total</div><div style="font-size:22px;font-weight:600" class="money">${U.fmt(fam.total)}</div></div>
            <div><div class="sub">Per month</div><div style="font-size:22px;font-weight:600" class="money">${U.fmt(fam.perMonth)}</div></div>
            <div><div class="sub">Share of spending</div><div style="font-size:22px;font-weight:600">${pct(fam.share)}</div></div>
          </div>
          <div class="chart" id="ch-fam"></div></div>
      </div>`;

    $$('[data-scope]').forEach((b) => b.addEventListener('click', () => { S.scope = b.dataset.scope; render(); }));
    drawInsights(ym, sc, groups, cats, fam);
  };

  function drawInsights(ym, sc, groups, cats, fam) {
    const series = calc.series(ym, 12, sc);
    charts.columns($('#ch-12m'), series.map((m) => ({
      label: U.monthLabel(m.ym, { month: 'narrow' }), sub: U.monthLabel(m.ym),
      values: { income: m.income, expense: m.expense },
      extra: `Net ${IL.privacy ? '••••' : U.fmt(m.net, 'EUR', { sign: true })}`,
    })), [{ key: 'income', label: 'Income', slot: 1 }, { key: 'expense', label: 'Spent', slot: 2 }], { label: 'Income and spending for the last 12 months' });

    const nowYm = U.currentYm();
    const cur = calc.cumulative(ym, sc);
    const curPts = ym === nowYm ? cur.slice(0, Number(U.today().slice(8))) : ym > nowYm ? [] : cur;
    const prevYm = U.addMonths(ym, -1);
    charts.lines($('#ch-pace'), [
      { label: U.monthLabel(prevYm, { month: 'short' }), slot: 2, dashed: true, points: calc.cumulative(prevYm, sc).map((d) => ({ x: d.day, y: d.value })) },
      { label: U.monthLabel(ym, { month: 'short' }), slot: 1, points: curPts.map((d) => ({ x: d.day, y: d.value })) },
    ], { xMax: 31, label: 'Cumulative spending this month versus last month', xLabel: (x, long) => (long ? `Day ${x}` : String(x)) });

    const total = U.sum(groups, (g) => g.amount);
    charts.donut($('#ch-donut'), groups.map((g) => ({ label: g.group, value: g.amount, slot: g.slot })),
      { center: IL.privacy ? '€••••' : U.fmt(total, 'EUR', { decimals: 0 }), centerSub: 'spent', label: 'Spending by group' });

    charts.ranked($('#ch-cats'), cats.slice(0, 10).map((c) => ({
      label: c.cat?.name || 'Uncategorised', icon: c.cat?.icon, value: c.amount, id: c.id,
      sub: c.cat?.budget > 0 ? `${pct(c.amount / c.cat.budget)} of ${U.fmt(c.cat.budget, 'EUR', { decimals: 0 })} budget` : '',
    })), { onPick: (it) => { Object.assign(S, { cat: it.id, q: '', type: '', txScope: sc }); go('activity'); } });

    charts.calendar($('#ch-cal'), calc.daily(ym, sc), ym, { onPick: (d) => { Object.assign(S, { q: d, cat: '', type: '' }); go('activity'); } });

    charts.ranked($('#ch-payees'), calc.topPayees(ym, sc).map((p) => ({ label: p.name, value: p.amount, sub: `${p.count} payment${p.count === 1 ? '' : 's'}` })),
      { onPick: (it) => { Object.assign(S, { q: it.label, cat: '', type: '' }); go('activity'); } });

    charts.columns($('#ch-fam'), fam.months.map((m) => ({
      label: U.monthLabel(m.ym, { month: 'narrow' }), sub: U.monthLabel(m.ym), values: { amount: m.amount },
      extra: IL.privacy || !m.spent ? '' : `${pct(m.amount / m.spent)} of spending`,
    })), [{ key: 'amount', label: 'Family & giving', slot: 3 }], { height: 180, label: 'Money for family and giving per month' });
  }

  /* ── Settings ── */
  VIEWS.more = function () {
    const s = store.settings, configured = sync.configured();
    const statusPill = !configured ? '<span class="pill">Local only</span>'
      : sync.status === 'error' ? '<span class="pill err">Error</span>' : '<span class="pill ok">Connected</span>';
    $('#view').innerHTML = `<div class="grid2">
      <div class="card">
        <div class="card-h"><h2>Google Sheets sync</h2>${statusPill}</div>
        ${configured ? `
          <div class="set-row"><span class="t"><b>Last sync</b><small>${ago(s.lastSync)}${store.queue.length ? ` · ${store.queue.length} change(s) waiting` : ''}</small></span></div>
          ${s.lastSyncError && sync.status === 'error' ? `<div class="set-row"><span class="t"><b style="color:var(--bad-text)">Error</b><small>${esc(s.lastSyncError)}</small></span></div>` : ''}
          ${s.scriptVersion && s.scriptVersion < SCRIPT_VERSION ? `<div class="set-row"><span class="t"><b>Sheet script update available</b><small>Optional. Adds the InfoLedgr menu in your Sheet. See “Updating the script” in the README.</small></span></div>` : ''}
          <div class="toolbar" style="margin-top:8px"><button class="btn sm primary" data-act="sync-now">Sync now</button><button class="btn sm danger" data-act="disconnect">Disconnect</button></div>`
        : `<p class="sub" style="margin-bottom:12px">Right now your data lives only in this browser. Connect a Google Sheet to sync between phone and laptop, keep a backup, and store receipt photos in Google Drive.</p>
           <button class="btn primary" data-act="connect">Connect Google Sheet</button>`}
      </div>
      <div class="card">
        <div class="card-h"><h2>Security & privacy</h2></div>
        <button class="set-row" data-act="pin"><span class="t"><b>PIN lock</b><small>${s.pinHash ? 'On — asked when the app opens' : 'Off'}</small></span><span class="chev">›</span></button>
        <div class="set-row"><span class="t"><b>Auto-lock</b><small>Lock again after the app has been in the background</small></span>
          <select class="chip" id="set-lock">${[[0, 'Immediately'], [1, '1 min'], [5, '5 min'], [15, '15 min'], [60, '1 hour']].map(([v, l]) => `<option value="${v}"${Number(s.lockAfterMin) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="set-row"><span class="t"><b>Hide amounts</b><small>Blur figures when using the app in public</small></span>
          <label class="switch"><input type="checkbox" id="set-privacy"${s.privacy ? ' checked' : ''}><span></span></label></div>
        <div class="set-row"><span class="t"><b>Theme</b></span>
          <select class="chip" id="set-theme">${[['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${s.theme === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Money</h2></div>
        <div class="set-row"><span class="t"><b>Default currency</b><small>Preselected when you add a payment</small></span>
          <select class="chip" id="set-cur">${store.currencies().map((c) => `<option${s.defaultCurrency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>

        <button class="set-row" data-act="currencies"><span class="t"><b>Currencies & exchange rates</b><small>${store.currencies().map((c) => c === 'EUR' ? 'EUR' : `${c} ${U.round2(store.rate(c))}`).join(' · ')}</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="categories"><span class="t"><b>Categories</b><small>${store.cats().length} active · icons, groups, budgets</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="rules"><span class="t"><b>Auto-categorise rules</b><small>${store.data.rules.length} rules for bank imports</small></span><span class="chev">›</span></button>
      </div>
      <div class="card">
        <div class="card-h"><h2>Data</h2></div>
        <button class="set-row" data-act="import"><span class="t"><b>Import bank statement</b><small>CSV export from your bank</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="export"><span class="t"><b>Export transactions</b><small>CSV for Excel or Sheets</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="backup"><span class="t"><b>Download backup</b><small>Everything as one JSON file</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="restore"><span class="t"><b>Restore from backup</b><small>Replaces the data on this device</small></span><span class="chev">›</span></button>
        <button class="set-row" data-act="wipe"><span class="t"><b style="color:var(--bad-text)">Erase this device</b><small>Removes local data and settings. Your Google Sheet is not touched.</small></span></button>
      </div>
      <p class="sub span2" style="text-align:center;padding:8px">InfoLedgr v1.1 · ${store.data.tx.length} transactions on this device</p>
    </div>`;
    $('#set-lock').onchange = (e) => { s.lockAfterMin = Number(e.target.value); store.saveSettings(); };
    $('#set-privacy').onchange = (e) => { s.privacy = e.target.checked; store.saveSettings(); renderChrome(); };
    $('#set-theme').onchange = (e) => { s.theme = e.target.value; store.saveSettings(); applyTheme(); };
    $('#set-cur').onchange = (e) => { s.defaultCurrency = e.target.value; store.saveSettings(); };
  };

  function applyTheme() {
    const t = store.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  /* ════════════════════ FORMS ════════════════════ */

  function catGrid(type, selected) {
    return store.cats(type).map((c) => `<button type="button" class="cat-opt${c.id === selected ? ' on' : ''}" data-cat="${c.id}">
      <span>${c.icon}</span><span>${esc(c.name)}</span></button>`).join('');
  }

  function openTxForm(existing, preset = {}) {
    const isEdit = !!existing;
    const t = existing ? { ...existing } : {
      type: 'expense', amount: '', currency: store.settings.defaultCurrency || 'EUR', date: U.today(), payee: '', note: '',
      scope: 'personal', category: '', goalId: '', receiptUrl: '', ...preset,
    };
    let receiptData = null; // new photo (data URL) chosen in this form
    let catTouched = isEdit;
    const originalCat = t.category;
    const payees = [...new Set(sortTx([...store.data.tx]).map((x) => x.payee).filter(Boolean))].slice(0, 200);
    const goals = store.data.goals.filter((g) => !g.archived);

    modal({
      title: isEdit ? 'Edit transaction' : 'New transaction',
      body: `<form class="form" id="txf" autocomplete="off">
        <div class="seg">${[['expense', 'Expense'], ['income', 'Income'], ['saving', 'Saving']].map(([k, l]) => `<button type="button" data-ttype="${k}" class="${t.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="amount-box"><input id="tx-amt" inputmode="decimal" placeholder="0.00" value="${t.amount || ''}" aria-label="Amount" required>
          <select id="tx-cur" aria-label="Currency">${store.currencies().map((c) => `<option${c === t.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="conv" id="tx-conv"></div>
        <div class="field" id="cat-field"><span class="lbl">Category</span><div class="cat-grid" id="cat-grid"></div></div>
        <div class="field" id="goal-field" hidden><label for="tx-goal">Goal</label>
          <select id="tx-goal">${goals.length ? goals.map((g) => `<option value="${g.id}"${g.id === t.goalId ? ' selected' : ''}>${g.icon} ${esc(g.name)}</option>`).join('') : '<option value="">Create a goal first (Plan → Goals)</option>'}</select></div>
        <div class="row">
          <div class="field"><label for="tx-payee" id="payee-lbl">Paid to</label><input id="tx-payee" list="payee-list" value="${esc(t.payee)}" placeholder="e.g. REWE">
            <datalist id="payee-list">${payees.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
          <div class="field"><label for="tx-date">Date</label><input id="tx-date" type="date" value="${t.date}" required></div>
        </div>
        <div class="seg" id="scope-seg">${[['personal', '👤 Personal'], ['business', '🏢 Business']].map(([k, l]) => `<button type="button" data-tscope="${k}" class="${t.scope === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><label for="tx-note">Note</label><input id="tx-note" value="${esc(t.note === 'Recurring' ? '' : t.note)}" placeholder="Optional"></div>
        <div class="field"><span class="lbl">Receipt</span><div class="receipt-row" id="rc-row">
          <label class="btn sm" for="tx-file">📷 ${t.receiptUrl ? 'Replace photo' : 'Add photo'}</label>
          <input id="tx-file" type="file" accept="image/*" capture="environment" hidden>
          <span id="rc-preview"></span></div></div>
        ${!isEdit ? `<label class="check"><input type="checkbox" id="tx-repeat"> Repeat every month on this day</label>` : ''}
        <div class="modal-actions">
          ${isEdit ? '<button type="button" class="btn danger" id="tx-del">Delete</button>' : ''}
          <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Add'}</button></div>
      </form>`,
      onMount(m, close) {
        const amt = m.querySelector('#tx-amt'), cur = m.querySelector('#tx-cur');
        const conv = () => {
          const a = U.num(amt.value), c = cur.value;
          m.querySelector('#tx-conv').textContent = c !== 'EUR' && a ? `≈ ${U.fmt(U.toEUR(a, store.rate(c)), 'EUR')} at ${U.round2(store.rate(c))} ${c}/€` : '';
        };
        const paintType = () => {
          m.querySelectorAll('[data-ttype]').forEach((b) => b.classList.toggle('on', b.dataset.ttype === t.type));
          const saving = t.type === 'saving';
          m.querySelector('#cat-field').hidden = saving;
          m.querySelector('#goal-field').hidden = !saving;
          m.querySelector('#payee-lbl').textContent = t.type === 'income' ? 'Received from' : saving ? 'Label' : 'Paid to';
          if (!saving) {
            const valid = store.cats(t.type).some((c) => c.id === t.category);
            if (!valid) t.category = '';
            m.querySelector('#cat-grid').innerHTML = catGrid(t.type, t.category);
          }
        };
        const paintReceipt = async () => {
          const box = m.querySelector('#rc-preview');
          if (receiptData) box.innerHTML = `<img class="receipt-thumb" src="${receiptData}" alt="New receipt photo">`;
          else if (t.receiptUrl === 'local') {
            const d = await sync.getReceipt(t.id);
            box.innerHTML = d ? `<img class="receipt-thumb" src="${d}" alt="Receipt photo" style="cursor:zoom-in" data-full>` : '';
            const img = box.querySelector('[data-full]');
            if (img) img.onclick = () => modal({ title: 'Receipt', body: `<img src="${d}" alt="Receipt photo" style="width:100%;border-radius:12px">` });
          } else if (t.receiptUrl) box.innerHTML = `<a href="${esc(t.receiptUrl)}" target="_blank" rel="noopener" class="link">View in Google Drive ↗</a>`;
        };
        paintType(); conv(); paintReceipt();
        if (!isEdit) setTimeout(() => amt.focus(), 250);

        amt.addEventListener('input', conv);
        cur.addEventListener('change', conv);
        m.querySelectorAll('[data-ttype]').forEach((b) => b.onclick = () => { t.type = b.dataset.ttype; paintType(); });
        m.querySelectorAll('[data-tscope]').forEach((b) => b.onclick = () => {
          t.scope = b.dataset.tscope;
          m.querySelectorAll('[data-tscope]').forEach((x) => x.classList.toggle('on', x === b));
        });
        m.querySelector('#cat-grid').addEventListener('click', (e) => {
          const b = e.target.closest('[data-cat]');
          if (!b) return;
          t.category = b.dataset.cat; catTouched = true;
          m.querySelectorAll('.cat-opt').forEach((x) => x.classList.toggle('on', x === b));
        });
        // Suggest a category from history or rules when the payee is known
        m.querySelector('#tx-payee').addEventListener('change', (e) => {
          if (catTouched || t.type === 'saving') return;
          const p = e.target.value.trim().toLowerCase();
          const prev = sortTx([...store.data.tx]).find((x) => x.payee.toLowerCase() === p && x.type === t.type);
          const sug = prev ? prev.category : store.matchRule(p, t.type);
          if (sug) { t.category = sug; if (prev) { t.scope = prev.scope; m.querySelectorAll('[data-tscope]').forEach((x) => x.classList.toggle('on', x.dataset.tscope === t.scope)); } paintType(); }
        });
        m.querySelector('#tx-file').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try { receiptData = await sync.compressImage(f); paintReceipt(); }
          catch { toast('Could not read that image'); }
        });
        if (isEdit) m.querySelector('#tx-del').onclick = async () => {
          if (!(await confirmDialog('Delete this transaction?', { ok: 'Delete', danger: true }))) return;
          store.remove('tx', t.id);
          sync.deleteReceipt(t.id);
          close();
          toast('Transaction deleted');
        };

        m.querySelector('#txf').addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = U.round2(Math.abs(U.num(amt.value)));
          if (!amount) { toast('Enter an amount'); amt.focus(); return; }
          if (t.type !== 'saving' && !t.category) { toast('Pick a category'); return; }
          if (t.type === 'saving' && !m.querySelector('#tx-goal').value) { toast('Create a goal first'); return; }
          const currency = cur.value;
          const rate = isEdit && currency === existing.currency && existing.rate ? existing.rate : store.rate(currency);
          const row = {
            ...t, id: t.id || U.uid('t'), amount, currency, rate, amountEUR: U.toEUR(amount, rate),
            date: m.querySelector('#tx-date').value || U.today(),
            payee: m.querySelector('#tx-payee').value.trim(), note: m.querySelector('#tx-note').value.trim(),
            goalId: t.type === 'saving' ? m.querySelector('#tx-goal').value : '',
            category: t.type === 'saving' ? '' : t.category,
          };
          if (receiptData) { await sync.saveReceipt(row.id, receiptData); row.receiptUrl = 'local'; }
          store.upsert('tx', row);
          if (!isEdit && m.querySelector('#tx-repeat')?.checked) {
            store.upsert('rec', {
              id: U.uid('r'), name: row.payee || store.catName(row.category), type: row.type, amount, currency,
              category: row.category, scope: row.scope, payee: row.payee, day: Number(row.date.slice(8)), active: true,
              startMonth: U.addMonths(row.date.slice(0, 7), 1), lastPosted: row.date.slice(0, 7),
            });
          }
          close();
          const learn = isEdit && existing.source === 'csv' && row.payee && row.category !== originalCat && !csv.isIntermediary(row.payee);
          if (learn) {
            toast(`Always file “${row.payee}” under ${store.catName(row.category)}?`, {
              action: 'Always', onAction: () => {
                store.upsert('rules', { id: U.uid('rule'), pattern: row.payee.toUpperCase(), category: row.category });
                toast('Rule saved');
              },
            });
          } else toast(isEdit ? 'Saved' : `${t.type === 'income' ? 'Income' : t.type === 'saving' ? 'Saving' : 'Expense'} added`);
        });
      },
    });
  }

  /* ── Budgets ── */
  function avgSpend(catId, months = 3) {
    let total = 0;
    for (let i = 1; i <= months; i++) total += U.sum(calc.txs({ ym: U.addMonths(U.currentYm(), -i), type: 'expense' }).filter((t) => t.category === catId), (t) => t.amountEUR);
    return total / months;
  }

  function editBudget(catId) {
    const c = store.cat(catId);
    const avg = avgSpend(catId);
    modal({
      title: `${c.icon} ${c.name}`,
      body: `<form class="form" id="bf"><div class="field"><label for="b-amt">Monthly budget (EUR)</label>
        <input id="b-amt" inputmode="decimal" value="${c.budget || ''}" placeholder="0 = no budget"></div>
        <p class="sub">${avg > 0 ? `You spent about ${U.fmt(avg, 'EUR', { decimals: 0 })}/month here over the last 3 months.` : 'No spending history here yet.'}</p>
        <div class="toolbar"><button type="button" class="btn sm" data-a="see">See payments</button></div>
        <div class="modal-actions"><button class="btn primary" type="submit">Save</button></div></form>`,
      onMount(m, close) {
        m.querySelector('[data-a=see]').onclick = () => { close(); Object.assign(S, { cat: catId, q: '', type: '' }); go('activity'); };
        m.querySelector('#bf').onsubmit = (e) => {
          e.preventDefault();
          store.upsert('cats', { ...c, budget: U.round2(Math.max(0, U.num(m.querySelector('#b-amt').value))) });
          close();
          toast('Budget saved');
        };
      },
    });
  }

  function bulkBudgets() {
    const cats = store.cats('expense');
    modal({
      title: 'Monthly budgets',
      body: `<p class="sub" style="margin-bottom:12px">Amounts in EUR. The hint shows your average over the last 3 months. Leave empty for no budget.</p>
        <form class="form" id="bbf">${IL.GROUPS.map((g) => {
          const list = cats.filter((c) => c.group === g || (g === 'Financial' && !IL.GROUPS.includes(c.group)));
          if (!list.length) return '';
          return `<p class="section-title">${g}</p>` + list.map((c) => {
            const avg = avgSpend(c.id);
            return `<div class="set-row" style="padding:8px 0"><span>${c.icon}</span><span class="t"><b>${esc(c.name)}</b>
              <small>${avg > 0 ? `avg ${U.fmt(avg, 'EUR', { decimals: 0 })}` : '&nbsp;'}</small></span>
              <input class="input" style="width:110px;height:40px" inputmode="decimal" data-bid="${c.id}" value="${c.budget || ''}" placeholder="${avg > 0 ? Math.round(avg) : '—'}" aria-label="${esc(c.name)} budget"></div>`;
          }).join('');
        }).join('')}
        <div class="modal-actions"><button class="btn primary" type="submit">Save budgets</button></div></form>`,
      onMount(m, close) {
        m.querySelector('#bbf').onsubmit = (e) => {
          e.preventDefault();
          let n = 0;
          m.querySelectorAll('[data-bid]').forEach((inp) => {
            const c = store.cat(inp.dataset.bid);
            const v = U.round2(Math.max(0, U.num(inp.value)));
            if (v !== c.budget) { store.upsert('cats', { ...c, budget: v }, { silent: true }); n++; }
          });
          store.save(); store.emit('change');
          close();
          toast(n ? `${n} budget${n === 1 ? '' : 's'} updated` : 'No changes');
        };
      },
    });
  }

  /* ── Goals ── */
  function goalForm(g) {
    const isEdit = !!g;
    g = g || { name: '', target: '', startAmount: 0, deadline: '', icon: '🎯' };
    modal({
      title: isEdit ? 'Edit goal' : 'New savings goal',
      body: `<form class="form" id="gf">
        <div class="row" style="grid-template-columns:70px 1fr"><div class="field"><label for="g-icon">Icon</label><input id="g-icon" value="${esc(g.icon)}" maxlength="4"></div>
          <div class="field"><label for="g-name">Name</label><input id="g-name" value="${esc(g.name)}" placeholder="Emergency fund" required></div></div>
        <div class="row"><div class="field"><label for="g-target">Target (EUR)</label><input id="g-target" inputmode="decimal" value="${g.target || ''}" required></div>
          <div class="field"><label for="g-start">Already saved</label><input id="g-start" inputmode="decimal" value="${g.startAmount || ''}" placeholder="0"></div></div>
        <div class="field"><label for="g-dl">Target date (optional)</label><input id="g-dl" type="date" value="${g.deadline || ''}"></div>
        <div class="modal-actions">${isEdit ? '<button type="button" class="btn danger" id="g-del">Archive</button>' : ''}<button class="btn primary" type="submit">Save</button></div></form>`,
      onMount(m, close) {
        if (isEdit) m.querySelector('#g-del').onclick = () => { store.upsert('goals', { ...g, archived: true }); close(); toast('Goal archived'); };
        m.querySelector('#gf').onsubmit = (e) => {
          e.preventDefault();
          store.upsert('goals', {
            ...g, id: g.id || U.uid('g'), name: m.querySelector('#g-name').value.trim(), icon: m.querySelector('#g-icon').value.trim() || '🎯',
            target: U.num(m.querySelector('#g-target').value), startAmount: U.num(m.querySelector('#g-start').value), deadline: m.querySelector('#g-dl').value,
          });
          close();
          toast('Goal saved');
        };
      },
    });
  }

  /* ── Recurring ── */
  function recForm(r) {
    const isEdit = !!r;
    r = r || { name: '', type: 'expense', amount: '', currency: 'EUR', category: '', scope: 'personal', payee: '', day: 1, active: true, startMonth: U.currentYm() };
    const opts = (type) => store.cats(type).map((c) => `<option value="${c.id}"${c.id === r.category ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
    modal({
      title: isEdit ? 'Edit recurring item' : 'New recurring item',
      body: `<form class="form" id="rf">
        <div class="seg">${[['expense', 'Expense'], ['income', 'Income']].map(([k, l]) => `<button type="button" data-rtype="${k}" class="${r.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><label for="r-name">Name</label><input id="r-name" value="${esc(r.name)}" placeholder="Rent, Salary, Netflix…" required></div>
        <div class="row"><div class="field"><label for="r-amt">Amount</label><input id="r-amt" inputmode="decimal" value="${r.amount || ''}" required></div>
          <div class="field"><label for="r-cur">Currency</label><select id="r-cur">${store.currencies().map((c) => `<option${c === r.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div>
        <div class="field"><label for="r-cat">Category</label><select id="r-cat">${opts(r.type)}</select></div>
        <div class="row"><div class="field"><label for="r-day">Day of month</label><input id="r-day" type="number" min="1" max="31" value="${r.day}"></div>
          <div class="field"><label for="r-start">Starting</label><input id="r-start" type="month" value="${r.lastPosted ? U.addMonths(r.lastPosted, 1) : r.startMonth}"></div></div>
        <div class="field"><label for="r-scope">Scope</label><select id="r-scope"><option value="personal">👤 Personal</option><option value="business"${r.scope === 'business' ? ' selected' : ''}>🏢 Business</option></select></div>
        <p class="sub">Posts automatically on the chosen day each month, starting from the month above.</p>
        <div class="modal-actions">${isEdit ? '<button type="button" class="btn danger" id="r-del">Delete</button>' : ''}<button class="btn primary" type="submit">Save</button></div></form>`,
      onMount(m, close) {
        m.querySelectorAll('[data-rtype]').forEach((b) => b.onclick = () => {
          r.type = b.dataset.rtype;
          m.querySelectorAll('[data-rtype]').forEach((x) => x.classList.toggle('on', x === b));
          m.querySelector('#r-cat').innerHTML = opts(r.type);
        });
        if (isEdit) m.querySelector('#r-del').onclick = async () => {
          if (!(await confirmDialog('Delete this recurring item? Transactions it already posted stay.', { ok: 'Delete', danger: true }))) return;
          store.remove('rec', r.id); close(); toast('Recurring item deleted');
        };
        m.querySelector('#rf').onsubmit = (e) => {
          e.preventDefault();
          const start = m.querySelector('#r-start').value || U.currentYm();
          store.upsert('rec', {
            ...r, id: r.id || U.uid('r'), name: m.querySelector('#r-name').value.trim(), amount: U.round2(U.num(m.querySelector('#r-amt').value)),
            currency: m.querySelector('#r-cur').value, category: m.querySelector('#r-cat').value, scope: m.querySelector('#r-scope').value,
            payee: m.querySelector('#r-name').value.trim(), day: Number(m.querySelector('#r-day').value) || 1,
            startMonth: start, lastPosted: U.addMonths(start, -1), // posting resumes from `start`; ids prevent duplicates
          });
          const n = store.postRecurring();
          close();
          toast(n ? `Saved · ${n} payment${n === 1 ? '' : 's'} posted` : 'Saved');
        };
      },
    });
  }

  /* ── Categories, rules, currencies ── */
  function categoriesModal() {
    const list = (type) => store.cats(type, true).map((c) => `<button class="set-row" data-cid="${c.id}"${c.archived ? ' style="opacity:.5"' : ''}>
      <span class="tx-ico">${c.icon}</span><span class="t"><b>${esc(c.name)}</b><small>${esc(c.group)}${c.budget ? ' · budget ' + U.fmt(c.budget, 'EUR', { decimals: 0 }) : ''}${c.archived ? ' · hidden' : ''}</small></span><span class="chev">›</span></button>`).join('');
    const close = modal({
      title: 'Categories',
      body: `<button class="btn sm primary" data-a="new" style="margin-bottom:8px">＋ New category</button>
        <p class="section-title" style="margin:10px 0 4px">Expenses</p>${list('expense')}
        <p class="section-title" style="margin:16px 0 4px">Income</p>${list('income')}`,
      onMount(m, close) {
        m.querySelector('[data-a=new]').onclick = () => { close(); catForm(); };
        m.querySelectorAll('[data-cid]').forEach((b) => b.onclick = () => { close(); catForm(store.cat(b.dataset.cid)); });
      },
    });
    void close;
  }

  function catForm(c) {
    const isEdit = !!c;
    c = c || { name: '', type: 'expense', group: 'Lifestyle', icon: '🏷️', budget: 0, order: store.data.cats.length, archived: false };
    const groups = [...IL.GROUPS, 'Income'];
    modal({
      title: isEdit ? 'Edit category' : 'New category',
      body: `<form class="form" id="cf">
        <div class="row" style="grid-template-columns:70px 1fr"><div class="field"><label for="c-icon">Icon</label><input id="c-icon" value="${esc(c.icon)}" maxlength="4"></div>
          <div class="field"><label for="c-name">Name</label><input id="c-name" value="${esc(c.name)}" required></div></div>
        <div class="row"><div class="field"><label for="c-type">Type</label><select id="c-type"${isEdit ? ' disabled' : ''}><option value="expense">Expense</option><option value="income"${c.type === 'income' ? ' selected' : ''}>Income</option></select></div>
          <div class="field"><label for="c-group">Group</label><select id="c-group">${groups.map((g) => `<option${g === c.group ? ' selected' : ''}>${g}</option>`).join('')}</select></div></div>
        <div class="field"><label for="c-budget">Monthly budget (EUR, expenses only)</label><input id="c-budget" inputmode="decimal" value="${c.budget || ''}"></div>
        <label class="check"><input type="checkbox" id="c-arch"${c.archived ? ' checked' : ''}> Hide this category</label>
        <p class="sub">Categories in “Family &amp; Giving” feed the family &amp; giving insight.</p>
        <div class="modal-actions"><button class="btn primary" type="submit">Save</button></div></form>`,
      onMount(m, close) {
        m.querySelector('#cf').onsubmit = (e) => {
          e.preventDefault();
          const type = m.querySelector('#c-type').value;
          store.upsert('cats', {
            ...c, id: c.id || U.uid('cat'), name: m.querySelector('#c-name').value.trim(), icon: m.querySelector('#c-icon').value.trim() || '🏷️',
            type, group: type === 'income' ? 'Income' : m.querySelector('#c-group').value,
            budget: U.num(m.querySelector('#c-budget').value), archived: m.querySelector('#c-arch').checked,
          });
          close();
          toast('Category saved');
        };
      },
    });
  }

  function rulesModal() {
    const rules = [...store.data.rules].sort((a, b) => a.pattern.localeCompare(b.pattern));
    modal({
      title: 'Auto-categorise rules',
      body: `<p class="sub" style="margin-bottom:12px">When an imported payee or reference contains the text, the category is set for you. Longer matches win.</p>
        <form class="row" id="rule-f" style="grid-template-columns:1fr 1fr auto;align-items:end;margin-bottom:10px">
          <div class="field"><label for="ru-p">Text contains</label><input id="ru-p" placeholder="e.g. TEGUT" required></div>
          <div class="field"><label for="ru-c">Category</label><select id="ru-c">${store.cats().map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('')}</select></div>
          <button class="btn primary" style="height:46px">Add</button></form>
        <div>${rules.map((r) => `<div class="set-row" style="padding:8px 0"><span class="t"><b class="code">${esc(r.pattern)}</b><small>→ ${esc(store.catName(r.category))}</small></span>
          <button class="btn sm danger" data-rdel="${r.id}">Remove</button></div>`).join('')}</div>`,
      onMount(m, close) {
        m.querySelector('#rule-f').onsubmit = (e) => {
          e.preventDefault();
          store.upsert('rules', { id: U.uid('rule'), pattern: m.querySelector('#ru-p').value.trim().toUpperCase(), category: m.querySelector('#ru-c').value });
          close(); rulesModal();
        };
        m.querySelectorAll('[data-rdel]').forEach((b) => b.onclick = () => { store.remove('rules', b.dataset.rdel); b.closest('.set-row').remove(); });
      },
    });
  }

  function currenciesModal() {
    const live = sync.configured();
    modal({
      title: 'Currencies & rates',
      body: `<p class="sub" style="margin-bottom:12px">Rates are units per 1 EUR. ${live ? 'They update from Google Finance in your Sheet’s “Rates” tab — overwrite a cell there to fix a rate.' : 'They update daily from a free exchange-rate service; you can also set them by hand.'}
        Each transaction keeps the rate from the day you entered it, so past totals never shift.</p>
        <div class="form">${store.currencies().map((c) => `<div class="set-row" style="padding:8px 0"><span class="t"><b>${c} ${U.symbol(c).trim()}</b></span>
          ${c === 'EUR' ? '<span class="muted">base</span>' : `<input class="input" style="width:130px;height:40px" inputmode="decimal" data-rate="${c}" value="${store.rate(c)}"${live ? ' disabled' : ''}>`}</div>`).join('')}
        <form class="row" id="cur-f" style="grid-template-columns:1fr auto;align-items:end">
          <div class="field"><label for="cur-new">Add currency (3-letter code)</label><input id="cur-new" maxlength="3" placeholder="CHF" style="text-transform:uppercase"></div>
          <button class="btn" style="height:46px">Add</button></form>
        ${live ? '' : '<div class="modal-actions"><button class="btn primary" data-a="save">Save rates</button></div>'}</div>`,
      onMount(m, close) {
        m.querySelector('#cur-f').onsubmit = async (e) => {
          e.preventDefault();
          try { await sync.addCurrency(m.querySelector('#cur-new').value); close(); currenciesModal(); }
          catch (err) { toast(err.message); }
        };
        const save = m.querySelector('[data-a=save]');
        if (save) save.onclick = () => {
          m.querySelectorAll('[data-rate]').forEach((i) => { const v = U.num(i.value); if (v > 0) store.data.rates[i.dataset.rate] = v; });
          store.data.ratesAt = Date.now(); // manual rates win for today
          store.save(); store.emit('change'); close(); toast('Rates saved');
        };
      },
    });
  }

  /* ── Google Sheets connection ── */
  function connectModal(prefill = {}) {
    const tpl = IL.config && IL.config.templateUrl;
    const url = prefill.url || store.settings.apiUrl, key = prefill.key || store.settings.apiKey;
    modal({
      title: 'Connect Google Sheet',
      wide: true,
      body: `${prefill.url ? '<p class="sub" style="margin-bottom:12px">Your connection details are filled in. Tap <b>Connect &amp; sync</b>.</p>' : `
        <details style="margin-bottom:14px"${store.data.tx.length || sync.configured() ? '' : ' open'}><summary class="link" style="cursor:pointer">First time? Create your own private Sheet (about 5 minutes)</summary>
        <ol class="steps" style="margin-top:10px">
          ${tpl ? `<li>Open <a href="${esc(tpl)}" target="_blank" rel="noopener">this template</a> and click <b>Make a copy</b>. It's yours alone; nobody else can see it.</li>`
                : '<li>Create a new Google Sheet, open <b>Extensions → Apps Script</b> and paste in <span class="code">apps-script/Code.gs</span>.</li>'}
          <li>In your copy, a menu <b>InfoLedgr</b> appears after a few seconds (reload if not). Choose <b>1. Set up this Sheet</b> and allow access.<br>
            <span class="sub">If Google says the app isn't verified: <b>Advanced → Go to InfoLedgr</b>. It's your own copy.</span></li>
          <li><b>Extensions → Apps Script → Deploy → New deployment</b> → gear icon → <b>Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b> → <b>Deploy</b>.</li>
          <li>Back in the Sheet: <b>InfoLedgr → 2. Show connection details</b>. Open the connect link on each device, or paste the two values below.</li>
        </ol></details>`}
        <form class="form" id="conn-f">
          <div class="field"><label for="c-url">Web app URL</label><input id="c-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(url)}" required></div>
          <div class="field"><label for="c-key">API key</label><input id="c-key" value="${esc(key)}" required autocomplete="off"></div>
          <p class="sub">Your data goes only to your own Google account. The key stops anyone who finds the URL from reading your Sheet.</p>
          <div class="modal-actions"><button class="btn primary" type="submit" id="c-go">Connect & sync</button></div></form>`,
      onMount(m, close) {
        m.querySelector('#conn-f').onsubmit = async (e) => {
          e.preventDefault();
          const btn = m.querySelector('#c-go');
          btn.disabled = true; btn.textContent = 'Connecting…';
          try {
            await sync.connect(m.querySelector('#c-url').value, m.querySelector('#c-key').value, () =>
              confirmDialog('Your Sheet already has data and so does this device. Add this device’s transactions to the Sheet? Choose “Use Sheet only” to replace this device’s data with the Sheet’s.',
                { title: 'Merge data?', ok: 'Merge', cancel: 'Use Sheet only' }));
            close();
            toast(sync.status === 'error' ? 'Connected, but sync failed: ' + store.settings.lastSyncError : 'Connected — your data is syncing ✓');
          } catch (err) {
            btn.disabled = false; btn.textContent = 'Connect & sync';
            toast('Could not connect: ' + err.message, { ms: 6000 });
          }
        };
      },
    });
  }

  /* ── Bank CSV import ── */
  function importFlow() {
    modal({
      title: 'Import bank statement',
      wide: true,
      body: `<div id="imp">
        <ol class="steps" style="margin-bottom:14px">
          <li>In your online banking, open your account's transactions and pick a date range.<br>
            <span class="sub">Deutsche Bank: Konto → Umsätze. Most banks call it “Transactions” or “Umsätze”.</span></li>
          <li>Choose <b>Export → CSV</b> and save the file.</li>
          <li>Select it below. Nothing is imported until you confirm, and duplicates are skipped automatically.</li></ol>
        <label class="btn primary" for="imp-file">Choose CSV file</label><input type="file" id="imp-file" accept=".csv,text/csv,text/plain" hidden></div>`,
      onMount(m, close) {
        m.querySelector('#imp-file').onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const text = csv.decode(await f.arrayBuffer());
          const a = csv.analyse(text);
          if (!a.headers.length) { toast('That file looks empty'); return; }
          importPreview(m, close, a);
        };
      },
    });
  }

  function importPreview(m, close, a) {
    const box = m.querySelector('#imp');
    const cols = (key, label, optional) => `<div class="field"><label>${label}</label><select data-map="${key}">
      ${optional ? '<option value="">— none —</option>' : ''}${a.headers.map((h, i) => `<option value="${i}"${a.map[key] === i ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select></div>`;
    let drafts = [];
    const learned = {};
    const catOpts = (type, sel) => store.cats(type).map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');

    const build = () => {
      drafts = csv.toDrafts(a.body, a.map, store);
      const tbody = box.querySelector('tbody');
      tbody.innerHTML = drafts.map((d, i) => `<tr class="${d.duplicate ? 'dup' : ''}">
        <td><input type="checkbox" data-inc="${i}"${d.include ? ' checked' : ''} aria-label="Include"></td>
        <td class="num">${d.date.slice(8)}.${d.date.slice(5, 7)}.</td>
        <td class="payee" title="${esc(d.note)}">${esc(d.payee)}${d.via ? ` <span class="badge">via ${esc(d.via)}</span>` : ''}${d.duplicate ? ' <span class="badge">already imported</span>' : ''}${d.review && !d.duplicate ? ' <span class="badge biz">pick category</span>' : ''}</td>
        <td class="num ${d.type === 'income' ? 'amt-in' : ''}" style="text-align:right;white-space:nowrap">${d.type === 'income' ? '+' : '−'}${U.fmt(d.amount, d.currency).replace(/^[−+]/, '')}</td>
        <td><select data-cat="${i}">${catOpts(d.type, d.category)}</select></td>
        <td><select data-sc="${i}"><option value="personal">👤</option><option value="business">🏢</option></select></td></tr>`).join('');
      count();
    };
    const count = () => {
      const n = drafts.filter((d) => d.include).length;
      const dups = drafts.filter((d) => d.duplicate).length;
      box.querySelector('#imp-go').textContent = `Import ${n} transaction${n === 1 ? '' : 's'}`;
      box.querySelector('#imp-go').disabled = !n;
      const review = drafts.filter((d) => d.review && d.include).length;
      box.querySelector('#imp-sum').textContent = `${drafts.length} rows found · ${drafts.filter((d) => d.matched).length} auto-categorised${dups ? ` · ${dups} already imported` : ''}${review ? ` · ${review} PayPal payment${review === 1 ? '' : 's'} without a shop name: pick the category` : ''}`;
    };

    box.innerHTML = `
      <details style="margin-bottom:12px"><summary class="link" style="cursor:pointer">Column mapping (auto-detected)</summary>
        <div class="map-grid" style="margin-top:10px">${cols('date', 'Date')}${cols('payee', 'Payee', true)}${cols('purpose', 'Reference / purpose', true)}
        ${cols('amount', 'Amount (signed)', true)}${cols('debit', 'Debit (Soll)', true)}${cols('credit', 'Credit (Haben)', true)}</div></details>
      <p class="sub" id="imp-sum" style="margin-bottom:8px"></p>
      <div class="imp-scroll"><table class="imp-table"><thead><tr><th></th><th>Date</th><th>Payee</th><th style="text-align:right">Amount</th><th>Category</th><th>Scope</th></tr></thead><tbody></tbody></table></div>
      <label class="check" style="margin:12px 0"><input type="checkbox" id="imp-learn" checked> Remember my category changes as rules for next time</label>
      <div class="modal-actions"><button class="btn" id="imp-back">Choose another file</button><button class="btn primary" id="imp-go">Import</button></div>`;

    box.querySelectorAll('[data-map]').forEach((s) => s.onchange = () => {
      a.map[s.dataset.map] = s.value === '' ? undefined : Number(s.value);
      build();
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.inc != null) { drafts[t.dataset.inc].include = t.checked; count(); }
      if (t.dataset.sc != null) drafts[t.dataset.sc].scope = t.value;
      if (t.dataset.cat != null) {
        const d = drafts[t.dataset.cat];
        d.category = t.value;
        if (d.payee && !csv.isIntermediary(d.payee)) {
          learned[d.payee.toUpperCase()] = t.value;
          // apply the same choice to other rows from this payee
          drafts.forEach((o, j) => {
            if (o !== d && o.payee.toUpperCase() === d.payee.toUpperCase() && o.type === d.type) {
              o.category = t.value;
              const sel = box.querySelector(`[data-cat="${j}"]`);
              if (sel) sel.value = t.value;
            }
          });
        }
      }
    });
    box.querySelector('#imp-back').onclick = () => { close(); importFlow(); };
    box.querySelector('#imp-go').onclick = () => {
      const chosen = drafts.filter((d) => d.include);
      store.bulkUpsert('tx', chosen.map((d) => {
        const rate = store.rate(d.currency);
        return { id: U.uid('t'), date: d.date, type: d.type, amount: d.amount, currency: d.currency, rate, amountEUR: U.toEUR(d.amount, rate),
          category: d.category, scope: d.scope, payee: d.payee, note: d.note, source: 'csv', hash: d.hash };
      }));
      if (box.querySelector('#imp-learn').checked) {
        const rules = Object.entries(learned).filter(([p, c]) => store.matchRule(p, store.cat(c)?.type) !== c)
          .map(([pattern, category]) => ({ id: U.uid('rule'), pattern, category }));
        if (rules.length) store.bulkUpsert('rules', rules);
      }
      close();
      const months = [...new Set(chosen.map((d) => d.date.slice(0, 7)))].sort();
      if (months.length) S.ym = months[months.length - 1];
      toast(`Imported ${chosen.length} transactions`);
      go('activity');
    };
    build();
  }

  /* ── Backup / restore / export ── */
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCsv() {
    const list = S.view === 'activity' ? filteredTx() : sortTx([...store.data.tx]);
    download(`infoledgr-${U.today()}.csv`, csv.exportCsv(list, store), 'text/csv;charset=utf-8');
    toast(`Exported ${list.length} transactions`);
  }
  function backup() {
    download(`infoledgr-backup-${U.today()}.json`, JSON.stringify({ app: 'InfoLedgr', version: 1, exportedAt: new Date().toISOString(), data: store.data }, null, 1), 'application/json');
  }
  function restore() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (j.app !== 'InfoLedgr' || !j.data) throw new Error('Not an InfoLedgr backup');
        if (!(await confirmDialog(`Replace this device’s data with the backup from ${j.exportedAt?.slice(0, 10) || 'unknown date'} (${j.data.tx?.length || 0} transactions)?${sync.configured() ? ' It will also be written to your Google Sheet.' : ''}`, { ok: 'Restore', danger: true }))) return;
        store.data = Object.assign(store.data, j.data);
        store.queue = [];
        store.queueEverything();
        store.emit('change');
        sync.schedule();
        toast('Backup restored');
      } catch (e) { toast('Restore failed: ' + e.message); }
    };
    inp.click();
  }
  async function wipe() {
    if (!(await confirmDialog('Erase all InfoLedgr data and settings on this device? Your Google Sheet stays as it is.', { ok: 'Erase', danger: true }))) return;
    ['il_data_v1', 'il_queue_v1', 'il_settings_v1'].forEach((k) => localStorage.removeItem(k));
    try { indexedDB.deleteDatabase('infoledgr'); } catch { /* ignore */ }
    location.reload();
  }

  /* ════════════════════ PIN LOCK ════════════════════ */
  async function sha(text) {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return U.hash(text) + U.hash(text.split('').reverse().join(''));
  }

  /** Full-screen PIN pad. `autoLen` submits as soon as that many digits are typed. */
  function keypad({ title, onComplete, cancellable = false, autoLen = 0 }) {
    const lock = $('#lock');
    let pin = '', fails = 0, blockedUntil = 0;
    lock.hidden = false;
    lock.innerHTML = `<div class="lock-logo">Info<span>Ledgr</span><i>.</i></div>
      <div class="lock-msg" id="lock-msg">${esc(title)}</div>
      <div class="pin-dots" id="pin-dots">${'<i></i>'.repeat(6)}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button class="ghost" data-k="${cancellable ? 'cancel' : 'del'}">${cancellable ? 'Cancel' : ''}</button><button data-k="0">0</button><button class="ghost" data-k="del" aria-label="Delete">⌫</button></div>
      <button class="btn" style="background:rgba(255,255,255,.1);border:0;color:#fff;min-width:140px" data-k="ok">Enter</button>`;
    const dots = () => $$('#pin-dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const msg = (t) => ($('#lock-msg').textContent = t);
    const pad = {
      fail(t) {
        fails++;
        pin = ''; dots();
        $('#pin-dots').classList.add('shake');
        setTimeout(() => $('#pin-dots')?.classList.remove('shake'), 400);
        if (fails >= 5) { fails = 0; blockedUntil = Date.now() + 30000; msg('Too many tries — wait 30 seconds'); }
        else msg(t);
      },
      reset(t) { pin = ''; dots(); msg(t); },
      close() { lock.hidden = true; lock.innerHTML = ''; document.removeEventListener('keydown', onKey); },
    };
    const press = (k) => {
      if (Date.now() < blockedUntil) return;
      if (k === 'cancel') { pad.close(); return; }
      if (k === 'ok') { if (pin.length >= 4) onComplete(pin, pad); else msg('PINs have 4–6 digits'); return; }
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += k;
      dots();
      if (pin.length === 6 || (autoLen && pin.length === autoLen)) onComplete(pin, pad);
    };
    lock.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => press(b.dataset.k));
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (e.key === 'Escape' && cancellable) press('cancel');
    };
    document.addEventListener('keydown', onKey);
    return pad;
  }

  function showLock() {
    if (!store.settings.pinHash || !$('#lock').hidden) return;
    keypad({
      title: 'Enter your PIN',
      autoLen: store.settings.pinLen || 0,
      async onComplete(pin, k) {
        if ((await sha(store.settings.pinSalt + pin)) === store.settings.pinHash) { k.close(); sync.run(); }
        else k.fail('Wrong PIN');
      },
    });
  }

  function pinSettings() {
    const s = store.settings;
    const setNew = () => {
      let first = null;
      keypad({
        title: 'Choose a 4–6 digit PIN and press Enter',
        cancellable: true,
        async onComplete(pin, k) {
          if (!first) { first = pin; k.reset('Enter it again to confirm'); return; }
          if (pin !== first) { first = null; k.fail('PINs didn’t match — start again'); return; }
          s.pinSalt = U.uid();
          s.pinHash = await sha(s.pinSalt + pin);
          s.pinLen = pin.length;
          store.saveSettings();
          k.close();
          toast('PIN lock is on');
          render();
        },
      });
    };
    if (!s.pinHash) return setNew();
    modal({
      title: 'PIN lock',
      body: `<p class="sub" style="margin-bottom:14px">The PIN keeps people who pick up your unlocked phone or laptop out of the app. Your data on this device isn’t encrypted, so keep your device lock on too.</p>
        <div class="modal-actions"><button class="btn danger" data-a="off">Turn off</button><button class="btn primary" data-a="change">Change PIN</button></div>`,
      onMount(m, close) {
        m.querySelector('[data-a=change]').onclick = () => { close(); setNew(); };
        m.querySelector('[data-a=off]').onclick = () => {
          close();
          keypad({
            title: 'Enter your current PIN',
            cancellable: true,
            autoLen: s.pinLen || 0,
            async onComplete(pin, k) {
              if ((await sha(s.pinSalt + pin)) !== s.pinHash) { k.fail('Wrong PIN'); return; }
              s.pinHash = ''; s.pinSalt = ''; store.saveSettings(); k.close(); toast('PIN lock is off'); render();
            },
          });
        };
      },
    });
  }

  /* ════════════════════ EVENTS & BOOT ════════════════════ */
  const ACTIONS = {
    add: () => openTxForm(),
    'edit-tx': (id) => { const t = store.data.tx.find((x) => x.id === id); if (t) openTxForm(t); },
    'edit-budget': editBudget,
    'bulk-budgets': bulkBudgets,
    'goal-new': () => goalForm(),
    'goal-edit': (id) => goalForm(goalOf(id)),
    'goal-add': (id) => openTxForm(null, { type: 'saving', goalId: id, payee: 'Transfer to savings' }),
    'rec-new': () => recForm(),
    'rec-edit': (id) => recForm(store.data.rec.find((r) => r.id === id)),
    import: importFlow,
    export: exportCsv,
    backup, restore, wipe,
    connect: connectModal,
    disconnect: async () => { if (await confirmDialog('Stop syncing this device? Data stays on the device and in your Sheet.', { ok: 'Disconnect' })) { sync.disconnect(); render(); } },
    'sync-now': () => sync.run(),
    pin: pinSettings,
    currencies: currenciesModal,
    categories: categoriesModal,
    rules: rulesModal,
  };

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav) { go(nav.dataset.view); return; }
    const g = e.target.closest('[data-go]');
    if (g) { if (g.dataset.go === 'activity') Object.assign(S, { q: '', cat: '', type: '' }); go(g.dataset.go); return; }
    const a = e.target.closest('[data-act]');
    if (a && a.type !== 'checkbox' && ACTIONS[a.dataset.act]) { e.preventDefault(); ACTIONS[a.dataset.act](a.dataset.id); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'rec-toggle') {
      const r = store.data.rec.find((x) => x.id === e.target.dataset.id);
      store.upsert('rec', { ...r, active: e.target.checked, lastPosted: e.target.checked && !r.active ? U.addMonths(U.currentYm(), -1) : r.lastPosted });
      store.postRecurring();
    }
  });
  $('#month-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-month]');
    if (!b) return;
    S.ym = U.addMonths(S.ym, Number(b.dataset.month));
    render();
  });
  $('#sync-btn').onclick = () => {
    if (!sync.configured()) { connectModal(); return; }
    sync.run().then(() => toast(sync.status === 'error' ? 'Sync failed: ' + store.settings.lastSyncError : 'Synced ✓'));
  };
  $('#privacy-btn').onclick = () => { store.settings.privacy = !store.settings.privacy; store.saveSettings(); render(); };

  store.on((reason) => {
    if (reason === 'sync') { renderChrome(); if (S.view === 'more') VIEWS.more(); return; }
    if (sync.configured() && store.queue.length) sync.schedule();
    if (S.view === 'activity' && document.activeElement?.id === 'q') renderTxList();
    else render();
  });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (store.settings.pinHash && Date.now() - hiddenAt >= store.settings.lockAfterMin * 60000) showLock();
    if (S.ym !== U.currentYm() && hiddenAt && new Date(hiddenAt).getMonth() !== new Date().getMonth()) S.ym = U.currentYm();
    store.postRecurring();
    sync.run();
  });
  window.addEventListener('online', () => sync.run());
  window.addEventListener('offline', () => sync.setStatus('offline'));
  window.addEventListener('hashchange', onHash);
  window.addEventListener('resize', U.debounce(() => { if (S.view === 'insights') render(); }, 250));
  setInterval(() => { if (!document.hidden) sync.run(); }, 5 * 60 * 1000);

  // Boot
  store.load();
  applyTheme();
  if (store.settings.pinHash) { hiddenAt = 0; showLock(); }
  store.postRecurring();
  onHash();
  sync.run();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
})();
