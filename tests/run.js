// Run: node infoledgr/tests/run.js  — plain Node, no dependencies
const assert = require('assert');
const path = require('path');

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
for (const f of ['util', 'store', 'csv']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { util: U, store, calc, csv } = globalThis.IL;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

console.log('util');
test('addMonths wraps years', () => {
  assert.strictEqual(U.addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(U.addMonths('2026-01', -1), '2025-12');
  assert.strictEqual(U.addMonths('2026-03', -14), '2025-01');
});
test('fmt formats currencies', () => {
  assert.strictEqual(U.fmt(1234.5, 'EUR'), '€1,235');
  assert.strictEqual(U.fmt(12.5, 'NGN'), '₦12.50');
  assert.strictEqual(U.fmt(-3, 'EUR'), '−€3.00');
});

console.log('csv');
test('German and English amounts', () => {
  assert.strictEqual(csv.parseAmount('-1.234,56'), -1234.56);
  assert.strictEqual(csv.parseAmount('12,30'), 12.3);
  assert.strictEqual(csv.parseAmount('1,234.56'), 1234.56);
  assert.strictEqual(csv.parseAmount('€ 99.00'), 99);
  assert.ok(Number.isNaN(csv.parseAmount('')));
});
test('dates', () => {
  assert.strictEqual(csv.parseDate('03.10.2026'), '2026-10-03');
  assert.strictEqual(csv.parseDate('3.10.26'), '2026-10-03');
  assert.strictEqual(csv.parseDate('10/03/2026'), '2026-10-03');
  assert.strictEqual(csv.parseDate('25/10/2026'), '2026-10-25');
  assert.strictEqual(csv.parseDate('Kontostand'), null);
});

store.load();

const DB_DE = `Umsätze Girokonto;Zeitraum: 01.10.2026 - 17.10.2026
Alter Kontostand;2.000,00;EUR

Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;Mandatsreferenz ;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung
02.10.2026;02.10.2026;SEPA-Lastschrift;REWE Markt GmbH;REWE SAGT DANKE 123;DE00;BIC;;;;;;;;;-45,67;;EUR
01.10.2026;01.10.2026;SEPA-Gutschrift;Deloitte Consulting GmbH;GEHALT OKTOBER;DE00;BIC;;;;;;;;;;4.200,00;EUR
05.10.2026;05.10.2026;Kartenzahlung;"Cafe ""Luitpold""";Kartenzahlung;;;;;;;;;;;-8,90;;EUR
05.10.2026;05.10.2026;Kartenzahlung;"Cafe ""Luitpold""";Kartenzahlung;;;;;;;;;;;-8,90;;EUR
Kontostand;17.10.2026;;;6.136,53;EUR`;

const DB_EN = `Booking date;Value date;Transaction Type;Beneficiary / Originator;Payment Details;IBAN;BIC;Customer Reference;Mandate Reference;Creditor ID;Compensation amount;Original Amount;Ultimate creditor;Number of transactions;Number of cheques;Debit;Credit;Currency
10/07/2026;10/07/2026;Debit Card Payment;MVV MUENCHEN;Ticket;;;;;;;;;;;-58.00;;EUR
10/08/2026;10/08/2026;SEPA Direct Debit;NETFLIX.COM;Abo;;;;;DE123;;;;;;-13.99;;EUR`;

test('Deutsche Bank German export', () => {
  const a = csv.analyse(DB_DE);
  assert.strictEqual(a.delim, ';');
  assert.strictEqual(a.headers[a.map.date], 'Buchungstag');
  assert.strictEqual(a.headers[a.map.debit], 'Soll');
  assert.strictEqual(a.headers[a.map.credit], 'Haben');
  assert.strictEqual(a.headers[a.map.amount], 'Betrag');
  const d = csv.toDrafts(a.body, a.map, store);
  assert.strictEqual(d.length, 4, 'balance footer skipped');
  const rewe = d.find((x) => x.payee.startsWith('REWE'));
  assert.strictEqual(rewe.type, 'expense');
  assert.strictEqual(rewe.amount, 45.67);
  assert.strictEqual(store.catName(rewe.category), 'Groceries');
  const sal = d.find((x) => x.payee.startsWith('Deloitte'));
  assert.strictEqual(sal.type, 'income');
  assert.strictEqual(sal.amount, 4200);
  assert.strictEqual(store.catName(sal.category), 'Salary');
  const cafes = d.filter((x) => x.payee === 'Cafe "Luitpold"');
  assert.strictEqual(cafes.length, 2, 'two identical coffees are both kept');
  assert.notStrictEqual(cafes[0].hash, cafes[1].hash);
});
test('Deutsche Bank English export', () => {
  const a = csv.analyse(DB_EN);
  assert.strictEqual(a.headers[a.map.credit], 'Credit', 'Creditor ID is not the credit column');
  const d = csv.toDrafts(a.body, a.map, store);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(store.catName(d.find((x) => x.payee.includes('MVV')).category), 'Transport');
  assert.strictEqual(store.catName(d.find((x) => x.payee.includes('NETFLIX')).category), 'Subscriptions');
});
test('re-import flags duplicates', () => {
  const a = csv.analyse(DB_DE);
  const d = csv.toDrafts(a.body, a.map, store);
  d.forEach((x) => store.upsert('tx', { ...x, id: U.uid('t'), rate: 1, amountEUR: x.amount }, { silent: true }));
  const again = csv.toDrafts(a.body, a.map, store);
  assert.ok(again.every((x) => x.duplicate && !x.include));
});

test('PayPal lines are filed under the real shop', () => {
  const H = 'Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;Mandatsreferenz ;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung';
  const row = (d, purpose, amt) => `${d};${d};SEPA-Lastschrift;PayPal Europe S.a.r.l. et Cie S.C.A;${purpose};LU89;PPLXLUL2;;;;;;;;;${amt};;EUR`;
  const a = csv.analyse([H,
    row('20.10.2026', '1043438966963 PP.4396.PP . Lieferando.de, Ihr Einkauf bei Lieferando.de', '-23,40'),
    row('19.10.2026', '1043438966964/PP.4396.PP/. REWE Markt GmbH, Ihr Einkauf bei REWE Markt GmbH', '-41,10'),
    row('18.10.2026', '1043438966965 PP.4396.PP . ZALANDO SE, Ihr Einkauf bei ZALANDO SE', '-79,95'),
    row('17.10.2026', '1043438966966 PP.4396.PP ABBUCHUNG VOM PAYPAL-KONTO', '-15,00'),
  ].join('\n'));
  const d = csv.toDrafts(a.body, a.map, store);
  const by = (p) => d.find((x) => x.payee === p);
  assert.strictEqual(store.catName(by('Lieferando.de').category), 'Dining & Cafés');
  assert.strictEqual(store.catName(by('REWE Markt GmbH').category), 'Groceries');
  assert.strictEqual(store.catName(by('ZALANDO SE').category), 'Shopping');
  assert.ok(d.every((x) => x.via === 'PayPal' && x.note.startsWith('via PayPal')));
  assert.ok(!by('ABBUCHUNG VOM PAYPAL-KONTO') && !by('ABBUCHUNG'), 'bank wording is not a shop');
  const unknown = by('PayPal');
  assert.ok(unknown && unknown.review, 'a PayPal line without a shop asks for a category');
  assert.ok(!by('REWE Markt GmbH').review);
});
test('past choices for a payee win over rules on import', () => {
  const tea = store.data.cats.find((c) => c.name === 'Gifts & Donations');
  store.upsert('tx', { id: 'hist1', date: '2026-09-01', type: 'expense', amount: 5, amountEUR: 5, payee: 'ZALANDO SE', category: tea.id }, { silent: true });
  const H = 'Buchungstag;Begünstigter / Auftraggeber;Verwendungszweck;Betrag;Währung';
  const a = csv.analyse(H + '\n21.10.2026;PayPal Europe;PP.1.PP . ZALANDO SE, Ihr Einkauf bei ZALANDO SE;-10,00;EUR');
  assert.strictEqual(store.catName(csv.toDrafts(a.body, a.map, store)[0].category), 'Gifts & Donations');
  store.data.tx = store.data.tx.filter((t) => t.id !== 'hist1');
});
test('PayPal itself never becomes a rule', () => {
  assert.ok(csv.isIntermediary('PayPal Europe S.a.r.l.'));
  assert.ok(!csv.isIntermediary('REWE Markt GmbH'));
});

console.log('store & analytics');
test('totals per month', () => {
  const t = calc.totals('2026-10');
  assert.strictEqual(U.round2(t.income), 4200);
  assert.strictEqual(U.round2(t.expense), U.round2(45.67 + 8.9 * 2));
});
test('recurring posts once per month and is idempotent', () => {
  const rent = store.upsert('rec', { id: 'r1', name: 'Rent', type: 'expense', amount: 1200, currency: 'EUR',
    category: store.cats('expense')[0].id, day: 1, active: true, startMonth: '2026-08' });
  assert.strictEqual(store.postRecurring('2026-10-18'), 3);
  assert.strictEqual(store.postRecurring('2026-10-18'), 0);
  assert.strictEqual(store.data.rec.find((r) => r.id === rent.id).lastPosted, '2026-10');
  // due day not reached yet this month
  store.upsert('rec', { id: 'r2', name: 'Gym', type: 'expense', amount: 30, currency: 'EUR',
    category: store.cats('expense')[0].id, day: 28, active: true, startMonth: '2026-10' });
  assert.strictEqual(store.postRecurring('2026-10-18'), 0);
  assert.strictEqual(store.postRecurring('2026-10-28'), 1);
  // day 31 clamps to short months
  store.upsert('rec', { id: 'r3', name: 'X', type: 'expense', amount: 1, currency: 'EUR',
    category: store.cats('expense')[0].id, day: 31, active: true, startMonth: '2027-02' });
  store.postRecurring('2027-02-28');
  assert.ok(store.data.tx.some((t) => t.id === 'rec-r3-2027-02' && t.date === '2027-02-28'));
});
test('budget status and pace', () => {
  const groceries = store.data.cats.find((c) => c.name === 'Groceries');
  store.upsert('cats', { ...groceries, budget: 50 });
  const b = calc.budgets('2026-10', '2026-10-18').find((x) => x.cat.id === groceries.id);
  assert.strictEqual(b.status, 'warn'); // 45.67 / 50 = 91%
  store.upsert('cats', { ...groceries, budget: 80 });
  const b2 = calc.budgets('2026-10', '2026-10-18').find((x) => x.cat.id === groceries.id);
  assert.strictEqual(b2.status, 'ok'); // 57% spent, projected 78.65 < 84
});
test('NGN conversion and sent-home totals', () => {
  store.data.rates.NGN = 1700;
  const fam = store.data.cats.find((c) => c.name === 'Family Support');
  store.upsert('tx', { id: 'ngn1', date: '2026-10-10', type: 'expense', amount: 170000, currency: 'NGN', rate: 1700,
    amountEUR: U.toEUR(170000, 1700), category: fam.id });
  const s = calc.sentHome(2026);
  assert.strictEqual(U.round2(s.total), 100);
  assert.strictEqual(s.totalNGN, 170000);
});
test('applyRemote replays pending ops', () => {
  const pending = [{ op: 'upsert', sheet: 'Transactions', row: { id: 'p1', date: '2026-10-01', type: 'expense', amount: 5, amountEUR: 5 } }];
  store.applyRemote({ Transactions: [{ id: 'x', date: '2026-10-02', type: 'income', amount: '10', rate: '1', amountEUR: '10' }],
    Categories: [], Rates: { NGN: 1800 } }, pending);
  assert.deepStrictEqual(store.data.tx.map((t) => t.id).sort(), ['p1', 'x']);
  assert.strictEqual(store.data.tx.find((t) => t.id === 'x').amount, 10);
  assert.strictEqual(store.rate('NGN'), 1800);
});

test('existing installs get new starter categories once', () => {
  for (const k of Object.keys(mem)) delete mem[k];
  store.load(); // fresh install
  const loanId = 'cat-' + U.hash('Loan Refund');
  assert.ok(store.data.cats.some((c) => c.id === loanId), 'new installs are seeded with it');
  // simulate an install from before Loan Refund existed
  store.data.cats = store.data.cats.filter((c) => c.id !== loanId);
  store.data.rules = store.data.rules.filter((r) => r.category !== loanId);
  store.settings.seedVersion = 1;
  assert.strictEqual(store.migrateSeeds(), 5);
  assert.strictEqual(store.migrateSeeds(), 0);
  assert.strictEqual(store.data.cats.filter((c) => c.name === 'Loan Refund').length, 1);
  assert.strictEqual(store.catName(store.matchRule('DARLEHEN RATE 11/2026', 'expense')), 'Loan Refund');
  const order = store.cats('expense').map((c) => c.name);
  assert.ok(order.indexOf('Loan Refund') < order.indexOf('Other'), 'Other stays last');
});

console.log(`\n${passed} tests passed`);
