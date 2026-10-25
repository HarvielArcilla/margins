// Focus aids: the reading ruler (line, band, spotlight) and fixation
// emphasis, which dims the ends of words so the eye lands on their starts.
// Fixation uses the CSS Custom Highlight API so the book's DOM is untouched
// and highlights/positions stay valid.
import { $ } from './ui.js';
import { getSettings } from './settings.js';
import { onContents, liveContents, R } from './reader.js';

let rulerY = null;

export function rulerActive() { return getSettings().ruler !== 'off'; }

function lineHeightPx() {
  const s = getSettings();
  return s.fontSize * s.lineHeight;
}

export function pointer(y) {
  if (!rulerActive()) return;
  rulerY = y;
  drawRuler();
}

export function moveRuler(lines) {
  const stage = $('#stage').getBoundingClientRect();
  const lh = lineHeightPx();
  if (rulerY == null) rulerY = stage.top + getSettings().marginV + lh;
  rulerY += lines * lh;
  if (rulerY > stage.bottom - getSettings().marginV) {
    import('./pageturn.js').then((m) => m.turn(1));
    rulerY = stage.top + getSettings().marginV + lh / 2;
  } else if (rulerY < stage.top + getSettings().marginV) {
    import('./pageturn.js').then((m) => m.turn(-1));
    rulerY = stage.bottom - getSettings().marginV - lh / 2;
  }
  drawRuler();
}

// Keep the ruler on the page after a turn.
export function pageTurned() {
  if (!rulerActive() || rulerY == null) return;
  const stage = $('#stage').getBoundingClientRect();
  const lh = lineHeightPx();
  rulerY = Math.min(Math.max(rulerY, stage.top + lh), stage.bottom - lh);
  drawRuler();
}

function drawRuler() {
  const s = getSettings();
  const ruler = $('#ruler');
  if (!ruler) return;
  ruler.dataset.mode = s.ruler;
  if (s.ruler === 'off' || rulerY == null) { ruler.hidden = true; return; }
  const stage = $('#stage').getBoundingClientRect();
  const lh = lineHeightPx();
  const lines = s.ruler === 'line' ? 1 : s.rulerLines;
  const h = s.ruler === 'line' ? 3 : lh * lines;
  const top = s.ruler === 'line' ? rulerY + lh * 0.45 - stage.top : rulerY - h / 2 - stage.top;
  ruler.hidden = false;
  ruler.style.top = `${top}px`;
  ruler.style.height = `${h}px`;
  ruler.style.setProperty('--ruler-alpha', String(s.rulerOpacity / 100));
}

export function refresh() {
  drawRuler();
  for (const c of liveContents()) applyFixation(c);
}

// ---------- fixation emphasis ----------
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

function applyFixation(contents) {
  const win = contents.window;
  const reg = win?.CSS?.highlights;
  if (!reg) return;
  const s = getSettings();
  if (!s.fixation) { reg.delete('m-fix'); contents._fixKey = null; return; }
  const key = `${s.fixationStrength}`;
  if (contents._fixKey === key && reg.has('m-fix')) return;
  contents._fixKey = key;
  const doc = contents.document;
  const keep = 0.25 + (s.fixationStrength / 100) * 0.4; // share of each word kept bright
  const ranges = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script,style,code,pre,svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.data;
    WORD.lastIndex = 0;
    for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
      const len = m[0].length;
      if (len < 2) continue;
      const head = Math.max(1, Math.ceil(len * keep));
      if (head >= len) continue;
      const r = doc.createRange();
      r.setStart(n, m.index + head);
      r.setEnd(n, m.index + len);
      ranges.push(r);
    }
  }
  const hl = new win.Highlight(...ranges);
  hl.priority = 0;
  reg.set('m-fix', hl);
}

onContents((c) => applyFixation(c));
