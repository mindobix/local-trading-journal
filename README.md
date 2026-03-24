# Local Trading Journal
WRITTEN 100% USING CLAUDE CODE

A personal trading journal web application for tracking trades, calculating P&L, and analyzing performance — all in the browser, no server required.



## Features

- **Trade logging** — Record trades with multiple execution legs (buys/sells)
- **P&L calculation** — FIFO-based realized P&L across multi-leg trades
- **Calendar view** — Monthly calendar with daily/weekly P&L summaries
- **Trades table** — Filterable and sortable trade list
- **Performance stats** — Win rate, profit factor, avg win/loss, best/worst day
- **Trading rules** — Create rules and tag trades with them
- **CSV import** — Import trades in bulk via CSV file
- **JSON backup/restore** — Export and re-import all data

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

All data is stored in your browser's `localStorage` under two keys:

| Key | Contents |
|-----|----------|
| `tj-v1` | All trades (JSON array) |
| `tj-rules-v1` | All trading rules (JSON array) |

Use **Backup** (header button) to export a JSON snapshot, and **Restore** to reload it. Data is browser-local — it does not sync between devices or browsers.

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
├── index.html          # App layout and markup
├── css/
│   └── styles.css      # Dark theme styling
└── js/
    ├── storage.js      # localStorage read/write, ID generation
    ├── helpers.js      # Date formatting and HTML escaping utilities
    ├── calc.js         # FIFO P&L engine and stats aggregation
    ├── stats.js        # Stats bar rendering
    ├── calendar.js     # Monthly calendar and weekly summary views
    ├── trades.js       # Trades table with filtering and sorting
    ├── modal.js        # Trade form, leg editor, rules management
    └── app.js          # App init, view switching, CSV/backup logic
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

## No Dependencies

This app uses zero external libraries or frameworks — pure HTML, CSS, and vanilla JavaScript.