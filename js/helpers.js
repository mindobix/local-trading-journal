function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function nowDatetime() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeToDateStr(dt) {
  // handles both "YYYY-MM-DDTHH:MM" and plain "YYYY-MM-DD"
  return dt ? dt.split('T')[0] : todayStr();
}

function formatLegDatetime(dt) {
  if (!dt) return '—';
  const [datePart, timePart] = dt.split('T');
  if (!timePart) return datePart;
  const [y, m, d] = datePart.split('-');
  return `${m}/${d}/${y} ${timePart}`;
}

function fmtExpiry(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
