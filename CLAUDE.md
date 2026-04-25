# PROJECT: Local Trading Journal

> Last updated: 2026-04-25 — keep this current. If something here is wrong, fix it before doing anything else.

---

## 1. What This Is

A privacy-first, browser-only trading journal that runs entirely on the user's machine — no account, no server (for the core journal), no data leaving the browser. All trade and plan data lives in IndexedDB. An optional **Signal Intel** background server (`signal-intel/`) adds local AI-powered news/signal analysis. Marketed as a free replacement for paid SaaS journals (Tradervue, TraderSync, Tradezella).

**Stage:** Production (v1.0.7 in `version.json` / `index.html` — the README is occasionally ahead)
**Primary user:** Active retail options & equities trader (the repo owner) who reviews trades daily
**Success metric:** Daily use — every trade logged, every day's P&L tagged with rules/mistakes

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | Vanilla JavaScript (ES2017+) | No TypeScript, no JSX, no transpile |
| Frontend | Plain HTML + CSS + JS | Loaded via `<script>` tags in `index.html` — no modules, no bundler |
| Storage | IndexedDB (`trading-journal-db`) | Wrapped by `js/db.js`; in-memory cache + write-through; sync public API |
| Build step | None | Open `index.html` directly or `python -m http.server 8080` |
| Package manager | None for the journal | `npm` only inside `signal-intel/` |
| Signal Intel server | Node.js 18+, Express, `@xenova/transformers` | Optional local server at port 3737 |
| Tests | None currently | Manual browser testing |
| Hosting | Local file:// or any static host | No deploy pipeline; users self-host |

**Critical:** The journal itself has **zero npm dependencies** and **zero CDN calls**. Don't introduce any without explicit user approval — that's a core selling point.

---

## 3. Project Structure

```
local-trading-journal/
├── index.html              # App shell, all markup, <script> includes (load order matters)
├── version.json            # Single source of truth for version (also hardcoded in index.html)
├── css/
│   ├── styles.css          # @imports every other partial — the only file index.html links
│   ├── base.css            # CSS variables, reset, body
│   └── <feature>.css       # One partial per feature/tab
├── js/
│   ├── db.js               # IndexedDB open + CRUD helpers (load FIRST after migration)
│   ├── migration.js        # One-time localStorage → IDB migration; guarded by _migrated_v1
│   ├── app.js              # Async IIFE init sequence at bottom; tab switching; backup/restore
│   ├── storage.js          # trades / tags / mistakes / rules — in-memory cache + IDB writes
│   ├── wotp-storage.js     # ideas (trade plan) — same pattern
│   ├── plan.js             # Trade Plan tab + plans/<date> records
│   ├── llm-prompts.js      # LLM Prompts tab
│   ├── llm-trade-plan.js   # LLM Trade Plan tab
│   ├── signal-intel.js     # Signal Intel tab — talks to signal-intel/ server
│   ├── banking.js          # Banking tab
│   ├── calendar.js / trades.js / reports.js / modal.js / bulk.js
│   ├── filters.js / stats.js / calc.js (FIFO P&L) / helpers.js
│   └── wotp-modal.js / wotp-helpers.js
└── signal-intel/           # Optional local Node.js server (port 3737)
    ├── server.js           # Express + crawl loop + price fetcher + worker manager
    ├── analyst.js          # Forked worker — embedding/summarization pipeline
    ├── crawler.js / ranker.js / db.js
    ├── config.json
    └── start.sh            # Kills stale server, installs deps, starts node
```

**Rules:**
- New tab/feature → new `js/<feature>.js` and `css/<feature>.css`. Add `<script>` to `index.html` and `@import` to `css/styles.css`.
- Script load order in `index.html` matters — `db.js` and `migration.js` must come before any storage modules.
- Never `import`/`export` (no module system). Globals live on `window` or as plain top-level names.
- Pure helpers go in `helpers.js` / `wotp-helpers.js`. Don't sprinkle utilities into feature files.

---

## 4. Coding Standards

**Language**
- ES2017+ vanilla JS. `const`/`let`, arrow functions, async/await, template literals, optional chaining.
- No TypeScript. No JSX. No build step. If you need a feature that requires transpiling, push back.

**Storage pattern (critical — match it exactly)**
- Every persisted collection follows the **in-memory cache + write-through** pattern:
  - Module-level `let _trades = []` (or similar)
  - `async function _initXStorage()` called once during the app.js init IIFE — populates the cache from `dbGetAll(...)`
  - Public `loadX()` / `saveX()` functions stay **synchronous** — they read/write the cache and fire-and-forget `dbReplaceAll(...).catch(console.error)` for the IDB write
- Settings (single key/value pairs) → `dbGetSetting(key)` / `dbPutSetting(key, value)` / `dbDeleteSetting(key)`
- **Never** call `localStorage.getItem/setItem` in new code. Migration owns localStorage; everything else is IDB.

**Init sequence** (in `app.js` async IIFE at bottom of file)
`_openTjDb` → `runMigrationIfNeeded` → `_initStorageCore` → `_initWotpStorage` → `_initPlansStorage` → `_initLlmTradePlansStorage` → `_initNewsStorage` → `_initCalendarMonth` → `_initBankingStorage` → render. Don't reorder without understanding why.

**Naming**
- Files: `kebab-case.js` / `kebab-case.css`.
- Functions: verb-first (`loadTrades`, `saveBankingEntry`).
- Internal/private helpers: leading underscore (`_initStorageCore`, `_lsGetNewsConfig`).
- IDB store names match the data they hold (`trades`, `plans`, `bankingEntries`, `settings`).

**Style**
- Match the surrounding file's style. This codebase uses 2-space indent, single quotes, no semicolons in some files / semis in others — follow the file you're editing.
- Early returns over deep nesting.
- Don't introduce new abstractions for one caller. Three similar lines beats a premature helper.

**Errors**
- IDB writes are fire-and-forget with `.catch(console.error)` — don't block the UI on them.
- Surface user-visible failures with `showToast(msg, 'error')` (or whatever the file uses), never raw stack traces.
- Network errors from `signal-intel/` server are expected when the server isn't running — fail gracefully.

**Comments**
- Default to no comments. Add one only when the *why* is non-obvious (a hidden invariant, a workaround, a surprising constraint).
- Don't write WHAT comments — names should carry that. Don't reference issue numbers or callers in comments.

---

## 5. Versioning

Version lives in **two** places that must stay in sync:
1. `version.json` → `{ "version": "1.0.7" }`
2. `index.html` → `<div class="logo-version" id="app-version">v1.0.7</div>`

Bump both for any user-visible change. Use semver-ish: minor for new tabs/features, patch for fixes.

---

## 6. How to Work

**Before writing code**
- Read the relevant feature file *and* its companion CSS partial.
- For any change touching more than 2 files, propose a plan first and wait for approval.
- If the storage layer is involved, re-read this CLAUDE.md section on the storage pattern.

**While writing code**
- Match patterns already in the codebase. New patterns require a short justification.
- No placeholder content, no `// TODO implement later`, no fake data.
- No commented-out code. If it's gone, delete it.
- If you find an unrelated bug, mention it but don't fix it without asking.

**After writing code**
- Summarize what changed in a sentence or two — match the diff, don't oversell.
- For UI changes you can't verify: say so explicitly. Don't claim a UI works without seeing it.
- Suggest test cases (don't write them — there's no test framework here).

**Communication**
- Be direct. Skip preamble.
- Length matches the task. One-line answers for one-line questions.
- If the user is wrong about something, say so.

---

## 7. Hard Rules — Never Do These

- **Never** introduce npm dependencies into the journal (anything outside `signal-intel/`). Zero-deps is a feature.
- **Never** add CDN script/style tags to `index.html`. Everything must work offline.
- **Never** use `localStorage` for new data. Migration is the only allowed reader.
- **Never** delete files. Move, rename, or ask.
- **Never** commit or push without an explicit instruction in the same message.
- **Never** run destructive commands (`rm -rf`, `git reset --hard`, `git push --force`, `DROP TABLE`) without confirmation.
- **Never** edit `signal-intel/data/` or `data/` — they're regenerated at runtime and `.gitignore`d.
- **Never** read or write `.env*`, `*secret*`, `*credentials*`, `*key*` files.
- **Never** disable a check, swallow an error, or add `// eslint-disable` to make a problem go away.

---

## 8. Security & Privacy Defaults

- The journal is a **single-user local app**. There is no auth layer because there is no server boundary.
- The `signal-intel/` server binds to `localhost:3737` only. Don't add `0.0.0.0` binding or auth without a clear reason.
- Article HTML rendered in the news reader must be sanitized — Readability output is mostly safe but treat as untrusted.
- Backup JSON files may contain trade history → treat them as sensitive. Don't log their contents.
- Trade data never leaves the browser unless the user explicitly clicks **Backup** to download a JSON file.

---

## 9. Git Workflow

- Branch is usually `main` for solo work. Feature branches optional.
- Commit subject: imperative, ≤72 chars. Convention used here:
  - `feat: ...` — new feature
  - `fix: ...` — bug fix
  - `chore: ...` — tooling, gitignore, infra
- Body explains *why*, not *what*. Wrap at ~72 chars.
- Co-author trailer is included by Claude Code automatically; keep it.
- Show the staged diff and proposed message before committing — wait for approval.

---

## 10. Common Commands

```bash
# Run journal locally (any of these)
python -m http.server 8080         # then http://localhost:8080
npx serve .                        # then the URL it prints

# Run Signal Intel server (optional)
cd signal-intel && ./start.sh      # serves journal AND server at http://localhost:3737

# Git
git status
git log --oneline -10
```

There's no `pnpm dev`, no `pnpm test`, no `pnpm typecheck`. If you reach for one of those out of habit, stop.

---

## 11. Memory and Notes

- `memory/` is **gitignored** — it holds Claude Code's session memory and is not part of the project.
- The post-commit hook at `.git/hooks/post-commit` is owned by the sibling `local-vibecoding-appideas` project (the VibeCoding commit-card system) — leave it alone unless you're working on that system.

---

## 12. Important Context

**Architecture decisions (don't relitigate):**
- Vanilla JS, no framework. Chosen so the app stays a single static file bundle that opens with no install.
- IndexedDB with in-memory cache (not raw IDB or a wrapper library). Chose this so the entire public API stays sync — migrating thousands of call sites to async would have been a much bigger lift.
- Signal Intel uses local `@xenova/transformers` (not a hosted LLM API). Chosen so users don't need API keys and signal analysis stays free + private.

**Known weirdness:**
- Some files use semicolons, some don't. Match the file you're in.
- `signal-intel/` is fully separate — its own `package.json`, its own data, its own `db.js`. Don't share code between journal and server.
- The README occasionally claims a higher version number (e.g. v1.4.0) than `version.json` because feature docs are written ahead of the version bump. Trust `version.json`/`index.html`.
- `index.html` has hardcoded version text — don't try to fetch `version.json` at runtime; we tried and reverted (commit 22bd410).

**Known issues we've accepted:**
- No automated tests. If we ever add a test framework, it needs to run in the browser without a build — likely Mocha + a static page.
- prevRpt settings keys (`ltj_prevRptIds_*`) accumulate per-symbol with no cleanup. Acceptable until users complain about IDB size.
