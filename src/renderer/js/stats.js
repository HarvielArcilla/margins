// Reading stats: sessions are timed while you are actually reading (idle
// time and time with the window in the background do not count), with pages
// turned and words read, and the Stats view charts it all.
import { $, setChildren, el, iconButton, formatDuration, dayKey, countWords, toast, confirmDialog } from './ui.js';
import { getSettings, setSettings } from './settings.js';
import { visibleRange, R } from './reader.js';

let data = { sessions: [] };
let session = null;
let lastActivity = 0;
let tickTimer = null;

export async function loadStats() {
  data = await window.api.stats.get();
  data.sessions ||= [];
}

function persist() { window.api.stats.set(data); }

export function startSession(meta) {
  session = {
    id: Date.now().toString(36), bookId: meta.id, title: meta.title,
    start: Date.now(), end: Date.now(), activeMs: 0, pages: 0, words: 0,
    startPct: meta.progress || 0, endPct: meta.progress || 0,
  };
  lastActivity = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
}

function isReadingNow() {
  if (!session || document.hidden || !document.hasFocus()) return false;
  return Date.now() - lastActivity < getSettings().idleSeconds * 1000;
}

let lastTick = Date.now();
let sinceSave = 0;
function tick() {
  const now = Date.now();
  const dt = Math.min(5000, now - lastTick);
  lastTick = now;
  if (!session) return;
  const speaking = window.speechSynthesis?.speaking;
  if (isReadingNow() || speaking) {
    session.activeMs += dt;
    session.end = now;
    sinceSave += dt;
    const badge = $('#session-time');
    if (badge) badge.textContent = formatDuration(session.activeMs, { short: true });
  }
  if (sinceSave > 30000) { sinceSave = 0; commit(false); }
}

export function activity() { lastActivity = Date.now(); }

const seenPages = new Set();
export async function pageTurn(location) {
  if (!session) return;
  activity();
  session.pages += 1;
  session.endPct = R.book?.locations?.length?.() ? (R.book.locations.percentageFromCfi(location.start.cfi) || session.endPct) : session.endPct;
  const key = location.start.cfi;
  if (seenPages.has(key)) return;
  seenPages.add(key);
  const vr = await visibleRange();
  if (vr) session.words += countWords(vr.range.toString());
}

function commit(final) {
  if (!session) return;
  const i = data.sessions.findIndex((x) => x.id === session.id);
  const keep = session.activeMs >= 15000;
  if (i >= 0) { if (keep) data.sessions[i] = { ...session }; else data.sessions.splice(i, 1); }
  else if (keep) data.sessions.push({ ...session });
  persist();
  if (final) session = null;
}

export async function endSession() {
  clearInterval(tickTimer);
  commit(true);
  seenPages.clear();
}

window.addEventListener('beforeunload', () => commit(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) commit(false); });

// ---------- derived numbers ----------
function allSessions() {
  const list = [...data.sessions];
  if (session && session.activeMs >= 15000 && !list.some((s) => s.id === session.id)) list.push(session);
  return list.map((s) => (session && s.id === session.id ? session : s));
}

export function timeForBook(id) {
  return allSessions().filter((s) => s.bookId === id).reduce((a, s) => a + s.activeMs, 0);
}

// Words per minute from your sessions that had real reading in them.
export function paceFor(bookId) {
  const rate = (list) => {
    const ok = list.filter((s) => s.words > 50 && s.activeMs > 60000);
    const w = ok.reduce((a, s) => a + s.words, 0), ms = ok.reduce((a, s) => a + s.activeMs, 0);
    return ms > 120000 ? w / (ms / 60000) : null;
  };
  const sessions = allSessions();
  const pace = (bookId && rate(sessions.filter((s) => s.bookId === bookId))) || rate(sessions.slice(-40));
  return pace ? Math.max(60, Math.min(900, pace)) : null;
}

function byDay() {
  const m = new Map();
  for (const s of allSessions()) {
    const k = dayKey(s.start);
    const d = m.get(k) || { ms: 0, pages: 0, words: 0, books: new Set() };
    d.ms += s.activeMs; d.pages += s.pages; d.words += s.words; d.books.add(s.bookId);
    m.set(k, d);
  }
  return m;
}

function streaks(days) {
  const minMs = 60000;
  const has = (t) => (days.get(dayKey(t))?.ms || 0) >= minMs;
  const DAY = 86400000;
  let current = 0;
  let t = Date.now();
  if (!has(t)) t -= DAY; // today not read yet doesn't break the streak
  while (has(t)) { current++; t -= DAY; }
  const keys = [...days.keys()].filter((k) => days.get(k).ms >= minMs).sort();
  let longest = 0, run = 0, prev = null;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`).getTime();
    run = prev != null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest };
}

export function todayMs() { return byDay().get(dayKey())?.ms || 0; }

// ---------- the stats view ----------
export async function renderStatsView(library) {
  const root = $('#stats-view');
  const s = getSettings();
  const sessions = allSessions();
  const days = byDay();
  const { current, longest } = streaks(days);
  const totalMs = sessions.reduce((a, x) => a + x.activeMs, 0);
  const totalPages = sessions.reduce((a, x) => a + x.pages, 0);
  const totalWords = sessions.reduce((a, x) => a + x.words, 0);
  const pace = paceFor(null);
  const today = days.get(dayKey()) || { ms: 0, pages: 0 };
  const goalMs = s.dailyGoalMinutes * 60000;
  const finished = Object.values(library).filter((b) => b.finishedAt);
  const finishedThisYear = finished.filter((b) => new Date(b.finishedAt).getFullYear() === new Date().getFullYear());
  const weekMs = [...Array(7)].reduce((a, _, i) => a + (days.get(dayKey(Date.now() - i * 86400000))?.ms || 0), 0);

  setChildren(root, 
    el('div.stats-wrap',
      el('header.stats-head',
        el('h1', 'Reading stats'),
        el('div.stats-actions',
          el('label.inline-field', 'Daily goal',
            el('input.input.tiny', { type: 'number', min: 1, max: 600, value: s.dailyGoalMinutes, onchange: (e) => { setSettings({ dailyGoalMinutes: Math.max(1, +e.target.value || 30) }); renderStatsView(library); } }), 'min'),
          el('label.inline-field', 'Idle after',
            el('input.input.tiny', { type: 'number', min: 15, max: 900, value: s.idleSeconds, onchange: (e) => setSettings({ idleSeconds: Math.max(15, +e.target.value || 90) }) }), 'sec'),
          iconButton('download', 'Export stats as JSON', async () => {
            const p = await window.api.file.save({ defaultPath: 'marginalia-stats.json', content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
            if (p) toast('Exported');
          }),
          iconButton('trash', 'Reset all stats', async () => {
            if (await confirmDialog('Reset reading stats?', 'This deletes every recorded reading session. Your books, progress and highlights stay.', 'Reset', true)) {
              data = { sessions: [] }; persist(); renderStatsView(library);
            }
          }))),
      el('section.tiles',
        goalTile(today.ms, goalMs),
        tile('Current streak', `${current} day${current === 1 ? '' : 's'}`, `Longest: ${longest} day${longest === 1 ? '' : 's'}`),
        tile('This week', formatDuration(weekMs, { short: true }), `${formatDuration(weekMs / 7, { short: true })} a day on average`),
        tile('Total time', formatDuration(totalMs, { short: true }), `${sessions.length} session${sessions.length === 1 ? '' : 's'}`),
        tile('Reading pace', pace ? `${Math.round(pace)} wpm` : '—', pace ? `${Math.round(pace * 60).toLocaleString()} words an hour` : 'Read a little more to measure'),
        tile('Pages turned', totalPages.toLocaleString(), `${totalWords.toLocaleString()} words read`),
        tile('Books finished', String(finished.length), `${finishedThisYear.length} this year`),
        tile('Average session', sessions.length ? formatDuration(totalMs / sessions.length, { short: true }) : '—', 'of active reading')),
      el('section.card', el('h2', 'Last 30 days'), barChart(days)),
      el('div.two-col',
        el('section.card', el('h2', 'Reading calendar'), heatmap(days, goalMs)),
        el('section.card', el('h2', 'When you read'), hourChart(sessions))),
      el('section.card', el('h2', 'By book'), bookTable(sessions, library)),
      el('section.card', el('h2', 'Recent sessions'), sessionList(sessions, library))));
}

function tile(label, value, sub) {
  return el('div.tile', el('div.tile-label', label), el('div.tile-value', value), el('div.tile-sub', sub));
}

function goalTile(ms, goalMs) {
  const p = Math.min(1, ms / goalMs);
  const r = 26, c = 2 * Math.PI * r;
  const ring = `<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 32 32)"/></svg>`;
  return el('div.tile.goal', el('div.ring', { html: ring }),
    el('div', el('div.tile-label', 'Today'), el('div.tile-value', formatDuration(ms, { short: true })),
      el('div.tile-sub', p >= 1 ? 'Goal reached' : `${formatDuration(goalMs - ms, { short: true })} to your goal`)));
}

function barChart(days) {
  const n = 30, W = 900, H = 180, pad = 26, bw = (W - pad) / n;
  const vals = [...Array(n)].map((_, i) => {
    const t = Date.now() - (n - 1 - i) * 86400000;
    return { t, m: (days.get(dayKey(t))?.ms || 0) / 60000 };
  });
  const goal = getSettings().dailyGoalMinutes;
  const max = Math.max(goal * 1.2, ...vals.map((v) => v.m), 10);
  const y = (m) => H - 20 - (m / max) * (H - 36);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img" aria-label="Minutes read per day">`;
  svg += `<line x1="${pad}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal-line"/><text x="${W}" y="${y(goal) - 4}" text-anchor="end" class="axis">goal ${goal}m</text>`;
  vals.forEach((v, i) => {
    const x = pad + i * bw + 2;
    const h = H - 20 - y(v.m);
    const d = new Date(v.t);
    svg += `<rect x="${x}" y="${y(v.m)}" width="${bw - 4}" height="${Math.max(0, h)}" rx="3" class="${v.m >= goal ? 'bar hit' : 'bar'}"><title>${d.toLocaleDateString()} — ${Math.round(v.m)} min</title></rect>`;
    if (i % 5 === 0 || i === n - 1) svg += `<text x="${x + (bw - 4) / 2}" y="${H - 4}" text-anchor="middle" class="axis">${d.getMonth() + 1}/${d.getDate()}</text>`;
  });
  svg += `<text x="0" y="${y(max) + 10}" class="axis">${Math.round(max)}m</text></svg>`;
  return el('div.chart-box', { html: svg });
}

function heatmap(days, goalMs) {
  const weeks = 26, cell = 13, gap = 3;
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  let svg = `<svg viewBox="0 0 ${weeks * (cell + gap) + 24} ${7 * (cell + gap) + 18}" class="heatmap" role="img" aria-label="Reading calendar">`;
  ['M', 'W', 'F'].forEach((d, i) => { svg += `<text x="0" y="${(i * 2 + 1) * (cell + gap) + cell - 2}" class="axis">${d}</text>`; });
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const t = start.getTime() + (w * 7 + d) * 86400000;
      if (t > Date.now()) continue;
      const ms = days.get(dayKey(t))?.ms || 0;
      const level = ms <= 0 ? 0 : ms < goalMs * 0.25 ? 1 : ms < goalMs * 0.6 ? 2 : ms < goalMs ? 3 : 4;
      svg += `<rect x="${18 + w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="lv lv${level}"><title>${new Date(t).toLocaleDateString()} — ${Math.round(ms / 60000)} min</title></rect>`;
      if (d === 0 && new Date(t).getDate() <= 7) svg += `<text x="${18 + w * (cell + gap)}" y="${7 * (cell + gap) + 12}" class="axis">${new Date(t).toLocaleString([], { month: 'short' })}</text>`;
    }
  }
  return el('div.chart-box', { html: `${svg}</svg>` }, el('div.legend', 'Less', ...[0, 1, 2, 3, 4].map((l) => el(`span.lv-swatch.lv${l}`)), 'More'));
}

function hourChart(sessions) {
  const hours = new Array(24).fill(0);
  for (const s of sessions) hours[new Date(s.start).getHours()] += s.activeMs / 60000;
  const max = Math.max(1, ...hours), W = 480, H = 150;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Minutes read by hour of day">`;
  hours.forEach((m, h) => {
    const bh = (m / max) * (H - 30);
    svg += `<rect x="${h * (W / 24) + 2}" y="${H - 18 - bh}" width="${W / 24 - 4}" height="${bh}" rx="2" class="bar"><title>${h}:00 — ${Math.round(m)} min</title></rect>`;
    if (h % 6 === 0) svg += `<text x="${h * (W / 24) + 2}" y="${H - 4}" class="axis">${h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}</text>`;
  });
  const peak = hours.indexOf(Math.max(...hours));
  return el('div.chart-box', { html: `${svg}</svg>` }, sessions.length ? el('p.muted.small', `You read most around ${peak % 12 || 12}${peak < 12 ? ' am' : ' pm'}.`) : null);
}

function bookTable(sessions, library) {
  const per = new Map();
  for (const s of sessions) {
    const p = per.get(s.bookId) || { ms: 0, words: 0, pages: 0, n: 0, last: 0 };
    p.ms += s.activeMs; p.words += s.words; p.pages += s.pages; p.n++; p.last = Math.max(p.last, s.end);
    per.set(s.bookId, p);
  }
  const rows = [...per.entries()].sort((a, b) => b[1].last - a[1].last);
  if (!rows.length) return el('p.empty', 'Open a book and start reading — your time will show up here.');
  return el('table.book-table',
    el('thead', el('tr', ['Book', 'Time', 'Sessions', 'Pages', 'Pace', 'Progress', 'Est. left'].map((h) => el('th', h)))),
    el('tbody', rows.map(([id, p]) => {
      const b = library[id] || {};
      const wpm = p.ms > 60000 && p.words ? p.words / (p.ms / 60000) : null;
      const left = b.words && (wpm || paceFor(null)) ? (b.words * (1 - (b.progress || 0))) / (wpm || paceFor(null)) : null;
      return el('tr',
        el('td', el('strong', b.title || 'Removed book'), el('div.muted.small', b.author || '')),
        el('td', formatDuration(p.ms, { short: true })),
        el('td', String(p.n)),
        el('td', String(p.pages)),
        el('td', wpm ? `${Math.round(wpm)} wpm` : '—'),
        el('td', el('div.mini-bar', el('span', { style: { width: `${Math.round((b.progress || 0) * 100)}%` } })), el('span.small', ` ${Math.round((b.progress || 0) * 100)}%`)),
        el('td', b.finishedAt ? 'Finished' : left ? formatDuration(left * 60000, { short: true }) : '—'));
    })));
}

function sessionList(sessions, library) {
  const recent = [...sessions].sort((a, b) => b.start - a.start).slice(0, 15);
  if (!recent.length) return el('p.empty', 'No sessions yet.');
  return el('ul.session-list', recent.map((s) => el('li',
    el('span.s-date', new Date(s.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
    el('span.s-book', library[s.bookId]?.title || s.title || ''),
    el('span.s-time', formatDuration(s.activeMs, { short: true })),
    el('span.s-pages', `${s.pages} pages`),
    el('span.s-delta', s.endPct > s.startPct ? `+${Math.round((s.endPct - s.startPct) * 100)}%` : ''))));
}

