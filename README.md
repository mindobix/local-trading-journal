# Local Trading Journal
WRITTEN 100% USING CLAUDE CODE

A personal trading journal web application for tracking trades, calculating P&L, analyzing performance, and planning weekly option trades — all in the browser, no server required.

## Features

- **Trade logging** — Record trades with multiple execution legs (buys/sells)
- **P&L calculation** — FIFO-based realized P&L across multi-leg trades
- **Calendar view** — Monthly calendar with daily/weekly P&L summaries; last viewed month is persisted across sessions
- **Trades table** — Filterable and sortable trade list
- **Performance stats** — Win rate, profit factor, avg win/loss, best/worst day
- **Trading rules** — Create rules and tag trades with them
- **Trade Plan tab** — Three-view (Monthly / Weekly / Daily) option trade plan tracker with per-day rich-text daily journal
- **CSV import** — Import trades in bulk via CSV file
- **JSON backup/restore** — Export and re-import all data including trade plan ideas and daily plans

## Running the App

No installation, build step, or server needed.

**Option 1 — Open directly:**
Double-click `index.html` or open it via your browser (`File > Open File`).

**Option 2 — Serve locally (recommended for some browsers):**
```bash
# Python
python -m http.server 8080

# Node.js (npx)
npx serve .
```
Then open `http://localhost:8080`.

**Browser requirements:** Any modern browser with ES6 and localStorage support (Chrome 51+, Firefox 54+, Safari 10+, Edge 15+).

## Data Storage

All data is stored in your browser's `localStorage`:

| Key | Contents |
|-----|----------|
| `tj-v1` | All trades (JSON array) |
| `tj-rules-v1` | Trading rules (JSON array) |
| `tj-tags-v1` | Custom tags (JSON array) |
| `tj-mistakes-v1` | Mistake entries (JSON array) |
| `tj-plans-v1` | Daily plan journal entries (date → HTML string) |
| `ow-ideas-v1` | Option trade plan ideas (JSON array) |
| `tj-cal-month` | Last viewed calendar month |
| `plan-last-view` | Last active Trade Plan sub-view |

Use **Backup** (header button) to export a JSON snapshot of all keys, and **Restore** to reload it. Data is browser-local — it does not sync between devices or browsers.

## Trade Plan Tab

The Trade Plan tab replaces the old single-editor plan view with a full three-view layout:

### Monthly view
Displays all option trade plan ideas grouped by week. Each week section shows cards with strike, trigger, targets, stop, and status. An **+ Add Trade Plan** button is available in every week row.

### Weekly view
Shows all option trade plan ideas for a single selected week.

### Daily view
Shows seven day rows (Mon–Sun) for the selected week. Each day includes:
- Option trade plan cards for that day
- A **Daily Plan** toggle that opens an inline rich-text editor (bold / italic / underline, auto-save, delete)
- Today's daily plan section is auto-expanded

The stats bar and global filter bar are hidden when the Trade Plan tab is active.

### Option trade plan idea fields

| Field | Description |
|-------|-------------|
| Symbol | Ticker (e.g. `TSLA`) |
| Option Type | Call or Put |
| Strike Price | Strike |
| Expiry Date | Contract expiry |
| Trigger (AT) Price | Entry trigger price |
| Target 1 / 2 / 3 | Up to three price targets |
| Stop Price | Stop-loss level |
| Week Of | Monday of the trade week |
| Created Date | Date the idea was logged |
| Status | Active / Triggered / Target Hit / Stopped |
| Card Color | 24 presets or custom picker |
| Notes | Optional context |

## Importing Trades via CSV

Download the CSV template from the app header, then fill in your trades.

**Required columns:**

| Column | Format | Notes |
|--------|--------|-------|
| `trade_id` | any string | Groups legs into the same trade |
| `symbol` | e.g. `AAPL` | Ticker symbol |
| `type` | `stock` or `option` | Instrument type |
| `option_type` | `call` or `put` | Options only; leave blank for stocks |
| `strike_price` | number | Options only |
| `expiry_date` | `YYYY-MM-DD` | Options only |
| `action` | `buy` or `sell` | Leg direction |
| `datetime` | `YYYY-MM-DD HH:MM` | Execution time |
| `price` | number | Execution price |
| `quantity` | integer | Shares or contracts |
| `commission` | number | Brokerage commission |
| `fees` | number | Exchange/regulatory fees |
| `notes` | text | Optional trade notes |

Each row is one leg. Multiple rows sharing the same `trade_id` form a single multi-leg trade.

## Project Structure

```
local-trading-journal/
├── index.html              # App layout and markup
├── css/
│   └── styles.css          # Dark theme styling
└── js/
    ├── storage.js          # localStorage for trades, tags, rules, mistakes, daily plans
    ├── wotp-storage.js     # localStorage for option trade plan ideas (ow-ideas-v1)
    ├── helpers.js          # Date formatting and HTML escaping utilities
    ├── wotp-helpers.js     # Week/month helpers and card color utilities for Trade Plan
    ├── wotp-modal.js       # Add/Edit modal for option trade plan ideas
    ├── plan.js             # Trade Plan tab controller (3-view layout + daily editor)
    ├── calc.js             # FIFO P&L engine and stats aggregation
    ├── filters.js          # Global filter bar logic and view context management
    ├── stats.js            # Stats bar rendering
    ├── calendar.js         # Monthly calendar and weekly summary views
    ├── trades.js           # Trades table with filtering and sorting
    ├── modal.js            # Trade form, leg editor, rules management
    ├── reports.js          # Reports tab (Days, Months, Trade time, Duration)
    └── app.js              # App init, view switching, CSV/backup/restore logic
```

## P&L Calculation

P&L is calculated using **FIFO (First-In, First-Out)** matching:

- Buy legs are matched against sell legs in chronological order
- Realized P&L is attributed to the **date of the sell leg**
- Options use a **100× multiplier** per contract; stocks use 1×
- Commission and fees are deducted from each matched lot

Open positions (unmatched buy quantity) show unrealized/pending status.

## Trade Object Format

```json
{
  "id": "unique-id",
  "date": "YYYY-MM-DD",
  "symbol": "AAPL",
  "type": "stock",
  "optionType": null,
  "strikePrice": null,
  "expiryDate": null,
  "notes": "Optional notes",
  "rules": ["rule-id-1"],
  "legs": [
    {
      "id": "leg-id",
      "action": "buy",
      "date": "YYYY-MM-DDTHH:MM",
      "price": 150.00,
      "quantity": 10,
      "commission": 1.00,
      "fees": 0.10
    }
  ]
}
```

## Option Trade Plan Idea Format

```json
{
  "id": "unique-id",
  "symbol": "TSLA",
  "optionType": "call",
  "strikePrice": 380,
  "expiryDate": "2025-04-25",
  "triggerPrice": 369,
  "targets": [383, 390],
  "stopPrice": 360,
  "weekOf": "2025-03-24",
  "createdAt": "2025-03-24",
  "status": "active",
  "notes": "Breakout above 370 resistance.",
  "customColor": "#f43f5e"
}
```

## No Dependencies

This app uses zero external libraries or frameworks — pure HTML, CSS, and vanilla JavaScript.
