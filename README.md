# Local Trading Journal
> Built 100% with [Claude Code](https://claude.ai/code)

**Stop paying $25–50/month for a trading journal.** Local Trading Journal is a full-featured, privacy-first trading journal that runs entirely in your browser — no subscription, no account, no data leaving your machine.

---

## Why Switch From Tradervue, TraderSync, or Tradezella?

| | Local Trading Journal | Paid SaaS ($25–50/mo) |
|---|---|---|
| **Cost** | Free forever | $300–600/year |
| **Privacy** | Your data never leaves your browser | Uploaded to third-party servers |
| **Internet required** | No — works fully offline | Yes |
| **Account / login** | None | Required |
| **Data ownership** | 100% yours, export anytime | Locked to their platform |
| **Customization** | Open source, modify freely | None |
| **No ads / upsells** | Never | Common |

Your trade data is sensitive. Position sizes, entry timing, win rate, P&L — this is information you don't need to hand to a SaaS company. Local Trading Journal stores everything in your own browser's localStorage. There is no server. There is no account. There is no subscription.

---

## What You Get

### Trade Logging with Multi-Leg Execution
Record every buy and sell leg individually, exactly as your broker executes them. Partial fills, scaled exits, multi-day holds — all supported. FIFO P&L is calculated automatically across every leg.

### Profit Targets & Stop Loss Planning
Set multiple price targets and stop levels directly on each trade, with real-time preview as you type:
- **Initial Target** — total planned profit across all target levels
- **Trade Risk** — total capital at risk based on stop levels
- **Planned R-Multiple** — reward-to-risk ratio before the trade
- **Realized R-Multiple** — how well you executed vs. your plan

This lets you compare *what you planned* against *what actually happened* — the single most powerful feedback loop in trading.

### Per-Trade Summary Panel
Every trade in the Daily Trades view shows a structured 4-column summary:
- **Trade details** — symbol, option specs, execution legs, tags
- **Timing stats** — avg entry price, avg exit price, entry time, exit time
- **Risk metrics** — Initial Target, Trade Risk, Planned R, Realized R
- **P&L** — realized profit/loss for the trade

When multiple trades are listed, all columns align uniformly for clean, at-a-glance comparison.

### Inline Edit Without Losing Context
Click the edit icon on any trade and the form opens directly below that trade — the trade summary stays visible so you always know what you're editing. Click the same icon again to toggle it closed. Switching to a different trade moves the form automatically.

### Calendar & Daily/Weekly Views
Click any day or week in the calendar to open a detailed breakdown:
- Daily P&L, trade count, wins, losses
- All trades for that day with full summary panels
- Add new trades directly from the day view

### Trade Plan Tab
A full three-view (Monthly / Weekly / Daily) option trade plan tracker:
- Plan option trades with strike, trigger, up to 3 targets, and a stop level
- Track status: Active → Triggered → Target Hit / Stopped
- Color-code cards with 24 presets or a custom color picker
- Write daily journal entries with inline rich-text editor (auto-saved)

### Performance Reports
- Win rate, profit factor, average win vs. average loss
- Best/worst day, best/worst month
- Trade duration analysis
- Monthly and daily P&L breakdowns

### Smart Filtering
Filter any view by date range, symbol, tags, mistakes, rules, trade type, and more. Include/exclude modes let you drill into exactly the subset of trades you want to analyze.

### Tags, Mistakes & Trading Rules
- Create a personal checklist of trading rules and tag each trade with which rules you followed (or broke)
- Log specific mistakes to track recurring behavioral patterns
- Add custom tags for setups, market conditions, or anything else

### CSV Import & JSON Backup
- Import trades in bulk from a CSV file (broker export or manual entry)
- Full JSON backup/restore — export everything (trades, tags, rules, plans, ideas) and restore it to any browser

---

## Getting Started

No installation, build step, or server needed.

**Option 1 — Open directly:**
Double-click `index.html` or drag it into your browser.

**Option 2 — Serve locally (recommended for full feature support):**
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```
Then open `http://localhost:8080`.

**Browser requirements:** Any modern browser — Chrome 51+, Firefox 54+, Safari 10+, Edge 15+.

---

## Data & Privacy

All data lives in your browser's `localStorage`. Nothing is transmitted anywhere.

| Key | Contents |
|-----|----------|
| `tj-v1` | All trades |
| `tj-rules-v1` | Trading rules |
| `tj-tags-v1` | Custom tags |
| `tj-mistakes-v1` | Mistake log |
| `tj-plans-v1` | Daily journal entries |
| `ow-ideas-v1` | Trade plan ideas |

Use **Backup** in the header to export a full JSON snapshot. Use **Restore** to load it back into any browser. Data does not sync between devices — keep your backup file safe.

---

## Trade Object Format (v4)

```json
{
  "id": "unique-id",
  "date": "YYYY-MM-DD",
  "symbol": "AAPL",
  "type": "stock",
  "notes": "Setup description",
  "tags": ["tag-id"],
  "mistakes": ["mistake-id"],
  "rules": ["rule-id"],
  "profitTargets": [
    { "price": 155.00, "qty": 5 },
    { "price": 160.00, "qty": 5 }
  ],
  "stopLoss": [
    { "price": 145.00, "qty": 10 }
  ],
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

---

## CSV Import Format

Download the template from the app header. Each row is one execution leg.

| Column | Format | Notes |
|--------|--------|-------|
| `trade_id` | any string | Groups legs into one trade |
| `symbol` | e.g. `AAPL` | Ticker |
| `type` | `stock` or `option` | |
| `option_type` | `call` or `put` | Options only |
| `strike_price` | number | Options only |
| `expiry_date` | `YYYY-MM-DD` | Options only |
| `action` | `buy` or `sell` | |
| `datetime` | `YYYY-MM-DD HH:MM` | |
| `price` | number | |
| `quantity` | integer | |
| `commission` | number | |
| `fees` | number | |
| `notes` | text | Optional |

---

## P&L Calculation

P&L uses **FIFO (First-In, First-Out)** matching:

- Buy legs are matched against sell legs in chronological order
- Realized P&L is attributed to the date of each sell leg
- Options use a **100× multiplier**; stocks use **1×**
- Commissions and fees are deducted proportionally from each matched lot
- Unmatched buy quantity shows as an open position

---

## Project Structure

```
local-trading-journal/
├── index.html              # App shell and markup
├── css/
│   └── styles.css          # Dark theme
└── js/
    ├── app.js              # Init, view switching, CSV/backup/restore
    ├── calc.js             # FIFO P&L engine, stats aggregation
    ├── modal.js            # Trade form, leg editor, profit targets, stop loss, inline edit
    ├── filters.js          # Global filter bar
    ├── stats.js            # Stats bar
    ├── calendar.js         # Monthly calendar and weekly views
    ├── trades.js           # Trades table
    ├── reports.js          # Reports tab
    ├── plan.js             # Trade Plan tab (3-view + daily editor)
    ├── storage.js          # localStorage: trades, tags, rules, mistakes, plans
    ├── wotp-storage.js     # localStorage: trade plan ideas
    ├── helpers.js          # Date formatting, HTML escaping
    └── wotp-helpers.js     # Week/month helpers, card color utilities
```

---

## No Dependencies

Zero external libraries or frameworks. Pure HTML, CSS, and vanilla JavaScript. No npm, no build step, no CDN calls, no tracking scripts.
