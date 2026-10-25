// Read aloud with the system voices. Reads the page on screen sentence by
// sentence, highlights the word being spoken, and turns pages as it goes.
import { $, toast } from './ui.js';
import { getSettings } from './settings.js';
import { R, visibleRange, next } from './reader.js';
import * as A from './annotations.js';

const synth = window.speechSynthesis;
let state = null; // { token, segments, chunks, i, contents }

export function voices() {
  return synth ? synth.getVoices().sort((a, b) => (a.lang + a.name).localeCompare(b.lang + b.name)) : [];
}
if (synth) synth.onvoiceschanged = () => document.dispatchEvent(new Event('voices-changed'));

export function speaking() { return !!state; }

function voice() {
  const name = getSettings().ttsVoice;
  const list = voices();
  return list.find((v) => v.name === name)
    || list.find((v) => v.default)
    || list.find((v) => v.lang?.startsWith((R.meta?.language || navigator.language || 'en').slice(0, 2)));
}

export function toggle() {
  if (state) { stop(); return false; }
  readPage();
  return true;
}

export function restart() {
  stop();
  setTimeout(readPage, 120);
}

export function stop() {
  if (!synth) return;
  if (state) state.token = -1;
  state = null;
  synth.cancel();
  A.mark('m-tts', null);
  updateButton();
}

function updateButton() {
  $('#tts-btn')?.classList.toggle('active', !!state);
}

// Collects text nodes in the range with their offsets so the spoken character
// position can be mapped back to the page.
function collect(range) {
  const doc = range.startContainer.ownerDocument;
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs = [];
  let text = '';
  let lastBlock = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    if (n.parentElement?.closest('script,style,rt')) continue;
    let s = 0, e = n.data.length;
    if (n === range.startContainer) s = range.startOffset;
    if (n === range.endContainer) e = range.endOffset;
    if (e <= s) continue;
    const block = n.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,div,dd,dt,td');
    if (lastBlock && block !== lastBlock && !/\s$/.test(text)) text += ' ';
    lastBlock = block;
    segs.push({ node: n, nodeStart: s, at: text.length, len: e - s });
    text += n.data.slice(s, e);
  }
  return { text, segs };
}

function splitSentences(text) {
  const out = [];
  const re = /[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) continue;
    // keep chunks short; some voices stop after ~15 seconds
    if (m[0].length > 280) {
      let i = 0;
      for (const part of m[0].split(/(?<=[,;:])\s+/)) { out.push({ text: part, at: m.index + i }); i += part.length + 1; }
    } else out.push({ text: m[0], at: m.index });
  }
  return out;
}

async function readPage() {
  if (!synth) { toast('Speech is not available on this system'); return; }
  const vr = await visibleRange();
  if (!vr) return;
  const { text, segs } = collect(vr.range);
  const token = Math.random();
  state = { token, segs, chunks: splitSentences(text), i: 0, contents: vr.contents, page: R.location?.start.cfi };
  updateButton();
  if (!state.chunks.length) { await turnAndContinue(token); return; }
  speakNext(token);
}

function speakNext(token) {
  if (!state || state.token !== token) return;
  if (state.i >= state.chunks.length) { turnAndContinue(token); return; }
  const chunk = state.chunks[state.i++];
  const u = new SpeechSynthesisUtterance(chunk.text);
  const s = getSettings();
  const v = voice();
  if (v) u.voice = v;
  u.rate = s.ttsRate;
  u.pitch = s.ttsPitch;
  u.onboundary = (e) => {
    if (!state || state.token !== token || e.name === 'sentence') return;
    const len = e.charLength || (/^\S+/.exec(chunk.text.slice(e.charIndex))?.[0].length ?? 1);
    markSpan(chunk.at + e.charIndex, len);
  };
  u.onend = () => speakNext(token);
  u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') { console.warn('speech error', e.error); stop(); } };
  synth.speak(u);
}

function markSpan(at, len) {
  const segs = state.segs;
  const seg = segs.find((g) => at >= g.at && at < g.at + g.len);
  if (!seg) return;
  const doc = seg.node.ownerDocument;
  const r = doc.createRange();
  const off = seg.nodeStart + (at - seg.at);
  r.setStart(seg.node, off);
  r.setEnd(seg.node, Math.min(seg.node.data.length, off + len, seg.nodeStart + seg.len));
  A.mark('m-tts', r, state.contents);
}

async function turnAndContinue(token) {
  if (!state || state.token !== token) return;
  const before = R.location?.start.cfi;
  if (R.location?.atEnd) { stop(); toast('Finished reading aloud'); return; }
  await next();
  await new Promise((r) => setTimeout(r, 250));
  if (!state || state.token !== token) return;
  if (R.location?.start.cfi === before) { stop(); return; }
  readPage();
}

// Speak a snippet (from the selection toolbar) without moving pages.
export function speakText(text) {
  if (!synth) return;
  stop();
  const u = new SpeechSynthesisUtterance(text);
  const s = getSettings();
  const v = voice();
  if (v) u.voice = v;
  u.rate = s.ttsRate;
  u.pitch = s.ttsPitch;
  synth.speak(u);
}
