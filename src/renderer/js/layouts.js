// Page layouts: how the page sits in the window — one or two pages, margins,
// line length, the desk around the page, rounded corners and the crease.
// The counterpart of style templates (which set type, color and motion and
// leave the page layout alone). Readers can save their own.
import { DEFAULTS } from './settings.js';

export const LAYOUT_KEYS = ['spread', 'marginH', 'marginV', 'lineLength', 'columnGap',
  'deskX', 'deskY', 'pageRadius', 'spineShadow', 'creaseDepth', 'creaseWidth'];

export const BUILTIN_LAYOUTS = [
  { id: 'full', name: 'Full window', blurb: 'Pages fill the window',
    values: { spread: 'auto', marginH: 72, marginV: 36, lineLength: 66, columnGap: 64, deskX: 0, deskY: 0, pageRadius: 0, spineShadow: true, creaseDepth: 45, creaseWidth: 50 } },
  { id: 'open-book', name: 'Open book', blurb: 'Two pages on a desk',
    values: { spread: 'always', marginH: 64, marginV: 40, lineLength: 62, columnGap: 72, deskX: 6, deskY: 4, pageRadius: 6, spineShadow: true, creaseDepth: 60, creaseWidth: 60 } },
  { id: 'paperback', name: 'Paperback', blurb: 'Snug margins, small desk',
    values: { spread: 'auto', marginH: 44, marginV: 30, lineLength: 58, columnGap: 56, deskX: 10, deskY: 5, pageRadius: 3, spineShadow: true, creaseDepth: 40, creaseWidth: 45 } },
  { id: 'single-desk', name: 'Single page', blurb: 'One page centered on a desk',
    values: { spread: 'none', marginH: 56, marginV: 40, lineLength: 64, columnGap: 64, deskX: 24, deskY: 4, pageRadius: 10, spineShadow: true, creaseDepth: 45, creaseWidth: 50 } },
  { id: 'roomy', name: 'Roomy', blurb: 'Wide margins, no desk',
    values: { spread: 'auto', marginH: 128, marginV: 64, lineLength: 68, columnGap: 96, deskX: 0, deskY: 0, pageRadius: 0, spineShadow: true, creaseDepth: 35, creaseWidth: 45 } },
  { id: 'compact', name: 'Compact', blurb: 'Most text on screen',
    values: { spread: 'auto', marginH: 28, marginV: 18, lineLength: 84, columnGap: 40, deskX: 0, deskY: 0, pageRadius: 0, spineShadow: false, creaseDepth: 45, creaseWidth: 50 } },
];

export const layoutOf = (s) => Object.fromEntries(LAYOUT_KEYS.map((k) => [k, s[k]]));

export const layoutPatch = (l) => ({ ...Object.fromEntries(LAYOUT_KEYS.map((k) => [k, DEFAULTS[k]])), ...l.values });

export function matchesLayout(s, values) {
  return LAYOUT_KEYS.every((k) => values[k] === undefined || String(s[k]) === String(values[k]));
}
