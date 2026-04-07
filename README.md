# Local Trading Journal
> Built 100% with [Claude Code](https://claude.ai/code)

**Stop paying $25–50/month for a trading journal.** Local Trading Journal is a full-featured, privacy-first trading journal that runs entirely in your browser — no subscription, no account, no data leaving your machine.

Now includes a **Signal News** tab — a live market intelligence feed with AI-powered signal analysis, real-time stock prices, and RSS news aggregation running on a local background server — plus a **New Signals** aggregated feed and an **LLM Prompts** tab for saving, organizing, and launching AI market analysis prompts for ChatGPT, Grok, Gemini, Claude, or any other LLM.

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
| **Market intelligence** | Signal News — AI analysis, live prices | Rare / paywalled |

Your trade data is sensitive. Position sizes, entry timing, win rate, P&L — this is information you don't need to hand to a SaaS company. Local Trading Journal stores everything in your own browser's localStorage. There is no server. There is no account. There is no subscription.

---

## What You Get

### Trade Logging with Multi-Leg Execution
Record every buy and sell leg individually, exactly as your broker executes them. Partial fills, scaled exits, multi-day holds — all supported. FIFO P&L is calculated automatically across every leg using **FIFO (First-In, First-Out)** matching.

- Tag each trade with **Trading Rules** (green), **Mistakes** (red), and **Custom Tags** (amber) — color-coded pills throughout the app
- Options and stocks both supported; options use a 100× multiplier automatically
- Commissions and fees tracked per leg and deducted from realized P&L

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

### Add Trade / Bulk Trades Entry
**Add Trade** — the header "+ Add Trade" button opens the trade form in a modal for quick single-trade entry from anywhere in the app.

**Bulk Trades Entry** — a spreadsheet-style grid for entering many legs at once:
- Each row is one execution leg; rows sharing the same Trade ID are grouped into one trade
- Inline dropdowns for type, action, option type, tags, mistakes, and rules — all editable per row
- Duplicate the previous row with one click to speed up multi-leg entry
- Unsaved changes trigger a browser leave-confirmation so you never lose work accidentally
- Import trades in bulk from a CSV file (broker export or manual entry) — download the column template from the app header
- Full JSON backup/restore — export everything (trades, tags, rules, plans, ideas, LLM prompts) and restore it to any browser

### Calendar Tab
The default landing view. Click any day to open a detailed daily breakdown or any week label to open a weekly summary.

**Daily view** — shows day P&L, trade count, wins and losses, all trades for that day with full summary panels, and an inline form to add new trades directly.

**Weekly view** — aggregates P&L, trade count, wins, and losses across the full week with per-day grouping.

### Trades Tab
A sortable, filterable table of every trade across all dates with columns: Date, Symbol, Side, Type, Legs, Net P&L, plus three pill columns before Notes:

- **Mistakes** — red pills for each mistake tagged on the trade
- **Rules** — green pills for each trading rule followed
- **Tags** — amber pills for each custom tag

Empty cells show a dash. Click any column header to sort ascending/descending. Filter any view by date range, symbol, tags, mistakes, rules, trade type, and more — include/exclude modes let you drill into exactly the subset you want.

### Trade Plan Tab
A three-view (Monthly / Weekly / Daily) option trade plan tracker:
- Plan option trades with strike, trigger, up to 3 targets, and a stop level
- Track status: Active → Triggered → Target Hit / Stopped
- Color-code cards with 24 presets or a custom color picker
- Write daily journal entries with an inline rich-text editor (auto-saved)

**Weekly Prep summary** — trade plan cards entered on the previous Saturday or Sunday (with "Week Of" set to a future week) automatically surface as a pinned **Weekly Prep** section at the top of that week's Daily view. Cards are height-clipped with a gradient fade — click **Show all** to expand. A **Weekly Plan** toggle reveals rich-text plan editors for each prep date.

### Reports Tab
A multi-tab report suite with six primary report types and secondary sub-tabs within each. Every report includes a **Cross Analysis** section — a dynamic table that cross-references any row group against configurable columns (Top 10 / Bottom 10 symbols, Trade Type, Tags, Mistakes, Trading Rules, Day of Week, Trade Duration, Week, Year, Position Size, Volume) with Win Rate / P&L / Trades toggle.

**Day & Time** — four sub-tabs: Days, Months, Trade Time, Trade Duration. Each shows highlight cards, a summary table, and cross analysis.

**Risk** — R-multiple performance bucketed from "−4R or worse" through "+4R and more". Highlight cards, summary table, and cross analysis scoped to R-multiple buckets.

**Ticker Symbols** — three sub-tabs:
- *Symbols* — per-symbol P&L, win rate, trade count
- *Trade Types* — stock vs. option breakdown
- *Prices* — price-range bucket analysis

**Tags** — three sub-tabs (Custom Tags, Mistakes, Trading Rules). Each shows top 4 highlight cards, a summary table, and cross analysis scoped to that tag set.

**Options: DTE** — Days Till Expiration analysis for option trades only. Buckets from "Same day" through "10+ days", with highlight cards, summary table, and cross analysis.

**Performance** — three sub-tabs with a clean 4-column stats grid (no tables or charts — pure key metrics):
- *Summary* — 16 metrics: Net P&L, Trade Expectancy, Avg Net Trade P&L, Avg Daily Volume, Win %, Avg Daily Win/Loss, Avg Daily Net P&L, Logged Days, Avg Daily Win %, Avg Trade Win/Loss, Avg Planned R-Multiple, Max Daily Net Drawdown, Profit Factor, Avg Hold Time, Avg Realized R-Multiple, Avg Daily Net Drawdown
- *Days* — day-level metrics: Avg Daily Win %, Avg Daily Win/Loss, Largest Profitable Day, Avg Daily Net P&L, Largest Losing Day, Avg Trading Day Duration
- *Trades* — trade-level metrics: Win %, Avg Trade Win/Loss, Largest Profitable Trade, Longest Trade Duration, Longs Win %, Trade Expectancy, Largest Losing Trade, Shorts Win %, Avg Net Trade P&L

### Signal News Tab

A live market intelligence feed powered by a local Node.js background server. No external API keys required.

The tab bar always shows three special tabs first, followed by individual ticker tabs:

**📡 New Signals** *(default tab)* — aggregates the latest new signal articles across every configured ticker in one place. Articles not present in the previous report snapshot are considered new. Up to 2 new articles per ticker are shown, grouped by ticker in the same order as the tab bar, each with a signal category pill. Clicking an article opens the full article reader on the right.

**🤖 LLM Prompts** — prompt library (see below).

**Individual ticker tabs** (MARKET, SPX, SPY, QQQ, + user tickers) — per-symbol signal report with sentiment, price, stats, and story clusters.

---

**Live stock prices**
- Displays current price, change, and % change per ticker at the top of each signal report
- Fetched via Yahoo Finance v8 (no API key) and refreshed every 5 minutes with the crawl cycle

**AI Signal Reports (per ticker)**
- Automatically triggered when new articles arrive for a symbol — no manual action needed
- Uses `@xenova/transformers` with `Xenova/bge-small-en-v1.5` for fast, accurate embedding-based article scoring
- Summarization via `Xenova/distilbart-cnn-6-6`
- Articles are classified as signal vs noise against a configurable taxonomy of market categories
- Duplicate articles are deduplicated by semantic similarity
- Reports show: sentiment (bullish/bearish/mixed/neutral), signal count, noise count, story clusters with summaries
- Stories sorted latest-first; **NEW** pill highlights articles that weren't in the previous report
- Workers run in isolated `child_process.fork()` processes — never blocks the UI or main server

**Incremental processing — fast on warm runs**

All heavy work is cached so re-runs only process what's new:

| Cache | Location | What it stores |
|-------|----------|----------------|
| Embedding vectors | `data/embeddings/{id}.json` | Article + signal phrase vectors (model-versioned) |
| Signal scores | `data/processed/{symbol}.json` | Per-article scores with taxonomy hash; auto-invalidated when taxonomy changes |
| Summaries | `data/summaries/{id}.txt` | LLM-generated cluster summaries |
| Reports | `data/reports/{symbol}.json` | Latest signal report per symbol |
| Article content | `data/articles/{id}.json` | Readability-extracted full text (or RSS preview fallback) |

**Rolling 4-hour window**

Articles older than 4 hours are automatically dropped on every crawl cycle. Their embedding, summary, and article cache files are pruned at the same time, keeping `data/` lean. The signal analysis window matches the RSS retention window — both controlled by a single `ARTICLE_WINDOW_MS` constant.

**Crawl / signal worker interlock**

RSS crawling pauses automatically while signal workers are running (they're CPU-intensive). Once the last worker finishes, any crawl that was skipped fires immediately so no articles are missed.

**Tab dot indicators**
- Blinking amber dot — signal analysis running for that ticker
- Solid green dot — report available

**Signal pills on articles**
- Each article card shows a signal category pill if it appeared in the latest report

**RSS News Aggregation**
- Crawls configured RSS/Atom feeds every 5 minutes
- Pinned tabs: MARKET, SPX, SPY, QQQ — always first, cannot be deleted
- Add, edit, or remove RSS feeds per ticker from the **Signal News Settings** panel
- Ticker feeds use a shared template with `{SYMBOL}` placeholder — one template applies to all tickers
- Separate Market section for MARKET-only feeds

**Article reader**
- Full article text extracted via `@mozilla/readability` and cached locally
- `__NEXT_DATA__` fallback parser for Yahoo Finance and other Next.js sites where Readability gets a JS hydration shell
- Paywalled/JS-rendered domains (Seeking Alpha, Bloomberg, WSJ, FT, Barron's, TheStreet) are detected and skipped automatically — RSS description cached as fallback with an amber "Preview only" banner
- When full extraction fails, the RSS description is cached as a preview — reader always shows something with a direct link to the original
- Transient failures (network errors) retry automatically after 1 hour

**Signal News Settings**
- Manage ticker symbols as chips (add/remove)
- SPX, SPY, QQQ are pinned and non-deletable
- One shared RSS feed template for all ticker symbols
- Separate feed management for MARKET
- **Clear Cache** button wipes all cached data: articles, embeddings, summaries, scores, and reports — triggers a fresh crawl automatically

**LLM Prompts Tab** — a prompt library for AI-powered market analysis. Save, organize, and launch prompts for any LLM — Grok, ChatGPT, Gemini, Claude, or any other tool.
- **Quick-launch strip** — LLM buttons always visible at the top; one tap opens the LLM in a new browser tab
- **Prompt categories** — color-coded by name (8-color palette), shown as pills in the list and form
- **Rich text results panel** — paste LLM output directly into each prompt entry; formatting (bold, headings, lists) is preserved
- **Results indicator** — a green dot appears next to any prompt that has saved results; the list date updates to show when results were last saved
- **6 default prompts** seeded on first load (Trade Idea Generator, Technical Analyst, News-to-Trade, Strategy Backtester, Trade Plan, Sentiment); restore missing defaults any time with the **↺ Defaults** button

---

## Getting Started

### Journal only (no news)

No installation, build step, or server needed.

**Option 1 — Open directly:**
Double-click `index.html` or drag it into your browser.

**Option 2 — Serve locally:**
```bash
# Python
python -m http.server 8080
# Node.js
npx serve .
```
Then open `http://localhost:8080`.

### With Signal News tab

Requires Node.js 18+.

```bash
cd news-crawler
./start.sh
```

Then open `http://localhost:3737` in your browser. The Signal News tab will connect automatically.

The server:
- Crawls RSS feeds every 5 minutes (paused while signal workers are running)
- Fetches live stock prices on each crawl cycle
- Runs AI signal analysis in background worker processes when new articles arrive
- Caches article content, embeddings, scores, and summaries for fast incremental runs
- Serves the full trading journal at `http://localhost:3737`

**Browser requirements:** Any modern browser — Chrome 51+, Firefox 54+, Safari 10+, Edge 15+.

---

## Data & Privacy

All trade data lives in your browser's `localStorage`. Nothing is transmitted anywhere.

| Key | Contents |
|-----|----------|
| `tj-v1` | All trades |
| `tj-rules-v1` | Trading rules |
| `tj-tags-v1` | Custom tags |
| `tj-mistakes-v1` | Mistake log |
| `tj-plans-v1` | Daily journal entries |
| `ow-ideas-v1` | Trade plan ideas |

Signal News data is stored locally under `news-crawler/data/` and is never sent to any external service.

| Key | Contents | In backup? |
|-----|----------|-----------|
| `ltj_llm_queries` | LLM prompt entries (text, category, LLM) | Yes |
| `ltj_llm_results` | LLM result HTML | No (local only) |
| `ltj_llm_categories` | User-defined prompt categories | Yes |

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
│   ├── styles.css          # Orchestrator — @import all partials
│   ├── base.css            # CSS variables, reset, body
│   ├── header.css          # Header, nav, add/data dropdowns
│   ├── filters.css         # Stats bar, filter bar, active filters
│   ├── calendar.css        # Calendar nav, grid, weekly layout
│   ├── trades.css          # Trades view, modal, trade form, legs
│   ├── rules-tags-mistakes.css  # Trading rules, tags, mistakes
│   ├── daily-plan.css      # Daily plan tab
│   ├── reports.css         # Reports tab
│   ├── trade-plan.css      # Trade plan (monthly/weekly/daily)
│   ├── targets.css         # Profit targets, stop loss, R-multiple
│   ├── bulk-entry.css      # Bulk trade entry spreadsheet view
│   ├── news.css            # Signal news tab
│   └── llm.css             # LLM Prompts tab
├── js/
│   ├── app.js              # Init, view switching, CSV/backup/restore
│   ├── news.js             # Signal News + LLM Prompts tabs — UI, polling, report panel, prices, prompt manager
│   ├── calc.js             # FIFO P&L engine, stats aggregation
│   ├── modal.js            # Trade form, leg editor, profit targets, stop loss, inline edit
│   ├── filters.js          # Global filter bar
│   ├── stats.js            # Stats bar
│   ├── calendar.js         # Monthly calendar and weekly views
│   ├── trades.js           # Trades table
│   ├── reports.js          # Reports tab
│   ├── plan.js             # Trade Plan tab (3-view + daily editor)
│   ├── storage.js          # localStorage: trades, tags, rules, mistakes, plans
│   ├── wotp-storage.js     # localStorage: trade plan ideas
│   ├── helpers.js          # Date formatting, HTML escaping
│   └── wotp-helpers.js     # Week/month helpers, card color utilities
└── news-crawler/           # Local background server (Node.js)
    ├── server.js           # Express server, crawl loop, price fetcher, report job manager,
    │                       #   Readability extraction, __NEXT_DATA__ fallback, crawl/worker interlock
    ├── report-worker.js    # Forked child process — runs AI signal analysis in isolation
    ├── report-gen.js       # Signal scoring, deduplication, summarization pipeline with
    │                       #   taxonomy-hash-invalidated score cache
    ├── embeddings.js       # bge-small-en-v1.5 embeddings, cosine scoring, dedup clustering
    ├── summarizer.js       # Xenova/distilbart-cnn-6-6 summarization
    ├── start.sh            # Start script (kills stale server, installs deps, starts node;
    │                       #   filters ONNX Runtime initializer warnings from stderr)
    ├── package.json
    └── crawlers/
        ├── index.js        # Crawl orchestrator
        └── rss.js          # RSS/Atom feed parser
```

---

## Dependencies

### Journal (no server)
Zero external libraries. Pure HTML, CSS, and vanilla JavaScript — no npm, no build step, no CDN calls.

### Signal News server (`news-crawler/`)
| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `axios` | RSS + Yahoo Finance fetching |
| `@mozilla/readability` + `jsdom` | Full article text extraction |
| `@xenova/transformers` | Local AI — embeddings (`bge-small-en-v1.5`) + summarization (`distilbart-cnn-6-6`); runs fully offline |
| `fast-xml-parser` | RSS/Atom parsing |
| `node-cron` | Crawl scheduling |
