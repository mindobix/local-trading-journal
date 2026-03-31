/* ── wotp-helpers.js ── Helpers for Trade Plan view ─────────────── */
// Note: todayStr() is already defined in helpers.js

// Returns "YYYY-MM-DD" for the Monday of the week containing `date`
function getMondayOf(date) {
  const d = date ? new Date(date + 'T12:00:00') : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// "M/D" from "YYYY-MM-DD"
function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

// "Mar 24 – Mar 30, 2025"
function fmtWeekRange(mondayStr) {
  const start = new Date(mondayStr + 'T12:00:00');
  const end   = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const s = start.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${s} \u2013 ${e}`;
}

// "March 2025"
function fmtMonthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// All Mondays in a given month that have ideas, plus current week always shown
function getWeeksInMonth(ideas, year, month) {
  const weeks = new Set();
  ideas.forEach(idea => {
    if (!idea.weekOf) return;
    const d = new Date(idea.weekOf + 'T12:00:00');
    if (d.getFullYear() === year && d.getMonth() + 1 === month) weeks.add(idea.weekOf);
  });
  const todayMonday = getMondayOf(todayStr());
  const tmDate = new Date(todayMonday + 'T12:00:00');
  if (tmDate.getFullYear() === year && tmDate.getMonth() + 1 === month) weeks.add(todayMonday);
  return [...weeks].sort();
}

// Deterministic vivid color from ticker string
const CARD_PALETTE = [
  '#f43f5e','#ec4899','#a855f7','#8b5cf6',
  '#6366f1','#3b82f6','#06b6d4','#10b981',
  '#f59e0b','#ef4444','#84cc16','#14b8a6'
];

function tickerColor(ticker) {
  if (!ticker) return CARD_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) & 0xffffffff;
  return CARD_PALETTE[Math.abs(hash) % CARD_PALETTE.length];
}

// HTML escape
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Format price — strip trailing zeros
function fmtPrice(n) {
  if (n === null || n === undefined || n === '') return '\u2014';
  const num = parseFloat(n);
  if (isNaN(num)) return '\u2014';
  return num % 1 === 0 ? num.toString() : num.toFixed(2).replace(/\.?0+$/, '');
}
