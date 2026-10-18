# InfoLedgr — personal income, expense & budget tracker

A private finance app for phone and laptop. Plain HTML/CSS/JS installable as an app (PWA), works offline, syncs through **your own Google Sheet**. No build step, no npm, no third-party database.

## What it does

| Area | Features |
|---|---|
| **Track** | 5-second entry (amount → category → done), expense / income / saving, EUR + NGN + USD + GBP (add more), receipt photos, personal vs business flag, search & filters |
| **Import** | Deutsche Bank CSV (German or English export, Windows-1252 or UTF-8), auto-categorisation rules (REWE → Groceries, MVV → Transport, Deloitte → Salary…), duplicate detection, learns from your corrections |
| **Budget** | Monthly limit per category, alerts at 80%, "on pace to overspend" forecast (fixed recurring costs aren't extrapolated), safe-to-spend per day |
| **Plan** | Savings goals with a required monthly amount, recurring items (rent, salary, subscriptions) that post themselves |
| **Insights** | 12-month income vs spending, spending pace vs last month, spending by group / category, daily heatmap, top payees, personal vs business, **money sent home** (EUR + ₦) |
| **Privacy** | PIN lock with auto-lock, hide-amounts mode, data only in your browser + your Google account |

## Run it locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

It works immediately in **local-only mode** (data stays in that browser). Connect a Sheet to sync devices.

## Connect your Google Sheet (≈5 minutes, once)

1. Create a new Google Sheet named e.g. **InfoLedgr**.
2. **Extensions → Apps Script**. Delete the sample code, paste all of [`apps-script/Code.gs`](apps-script/Code.gs), save.
3. Select the **`setup`** function → **Run** → approve the permissions (it's your own script).
   Open **Execution log** and copy the **API key**.
4. **Deploy → New deployment → ⚙ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (requests still need your API key)
   - Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`).
5. In InfoLedgr: **Settings → Connect Google Sheet**, paste URL + key. Repeat step 5 on each device.

The Sheet gets tabs `Transactions`, `Categories`, `Goals`, `Recurring`, `Rules`, `Rates`. You can edit them directly, since the app pulls changes on every sync. Exchange rates in `Rates` come from `GOOGLEFINANCE`; type a number over a formula to pin a rate. Receipt photos go to a Drive folder **InfoLedgr Receipts**.

> **Updating the script later:** after pasting new code, use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same.
> **Lost a device?** Run `rotateApiKey` in Apps Script and re-enter the new key on your other devices.

## Install on your phone

Open the hosted URL in Safari (iPhone) or Chrome (Android) → **Share → Add to Home Screen**. It opens full-screen like a native app and works offline. Changes made offline sync when you're back online.

## Hosting (private repo)

GitHub Pages needs a paid plan for private repos, so use a free static host:

- **Cloudflare Pages** (recommended): *Workers & Pages → Create → Pages → Connect to Git* → pick the repo → framework *None*, build command *(empty)*, output directory `/`. Add **Cloudflare Access** (free, up to 50 users) to put an email login in front of the URL.
- **Netlify**: *Add new site → Import from Git* → publish directory `/`, no build command.

Your data is never in the repo or on the host. Only the app code is.

## Files

```
├── index.html            app shell
├── manifest.webmanifest  PWA install metadata
├── sw.js                 offline cache
├── css/app.css           styles (Infolytics brand tokens, light + dark)
├── js/util.js            dates, money formatting, hashing
├── js/store.js           data model, seeds, recurring engine, analytics maths
├── js/sync.js            Apps Script sync, offline queue, receipts (IndexedDB), rates
├── js/csv.js             bank CSV parser + export
├── js/charts.js          SVG charts with tooltips
├── js/app.js             views, forms, import flow, PIN lock
├── apps-script/Code.gs   Google Sheets backend
├── icons/                app icons
└── tests/run.js          `node tests/run.js`
```

## How sync works

Every change is saved locally first and queued. A sync pushes the queue (last write wins, by `updatedAt`), then pulls the whole Sheet. Recurring items use deterministic IDs (`rec-<id>-<YYYY-MM>`), so two devices can never post the same rent twice. Each transaction stores the exchange rate from the day it was entered, so past EUR totals never shift.

## Security notes

- The PIN stops someone holding your unlocked phone or laptop. Data in the browser is not encrypted, so keep your device lock on.
- The Apps Script URL alone is useless without the API key; the key lives only in each device's browser storage.
- `noindex` is set so search engines skip the app page.
