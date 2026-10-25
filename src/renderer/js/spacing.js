// Spacing presets: ready-made combinations of line, letter, word and
// paragraph spacing, margins and line length — the spacing counterpart of
// colour themes. Readers can save their own.
export const SPACING_KEYS = ['lineHeight', 'letterSpacing', 'wordSpacing', 'paragraphSpacing', 'paragraphIndent',
  'marginH', 'marginV', 'lineLength', 'columnGap'];

export const SPACING_PRESETS = [
  { id: 'compact', name: 'Compact', blurb: 'More words on each page',
    values: { lineHeight: 1.4, letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 0.2, paragraphIndent: 1.2, marginH: 40, marginV: 24, lineLength: 80, columnGap: 48 } },
  { id: 'classic', name: 'Classic book', blurb: 'Indented paragraphs, no gaps',
    values: { lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 0, paragraphIndent: 1.5, marginH: 64, marginV: 36, lineLength: 66, columnGap: 64 } },
  { id: 'comfortable', name: 'Comfortable', blurb: 'Margins’ default',
    values: { lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 0.4, paragraphIndent: 1.4, marginH: 72, marginV: 36, lineLength: 66, columnGap: 64 } },
  { id: 'airy', name: 'Airy', blurb: 'Open lines and wide margins',
    values: { lineHeight: 1.85, letterSpacing: 0.01, wordSpacing: 0.03, paragraphSpacing: 0.9, paragraphIndent: 0, marginH: 96, marginV: 48, lineLength: 60, columnGap: 80 } },
  { id: 'large', name: 'Large print', blurb: 'Short lines, generous spacing',
    values: { lineHeight: 1.75, letterSpacing: 0.02, wordSpacing: 0.05, paragraphSpacing: 0.7, paragraphIndent: 1, marginH: 56, marginV: 32, lineLength: 52, columnGap: 64 } },
  { id: 'easy', name: 'Easy reading', blurb: 'Extra letter and word space',
    values: { lineHeight: 2, letterSpacing: 0.06, wordSpacing: 0.16, paragraphSpacing: 1.2, paragraphIndent: 0, marginH: 72, marginV: 40, lineLength: 60, columnGap: 64 } },
];

export function spacingOf(s) {
  return Object.fromEntries(SPACING_KEYS.map((k) => [k, s[k]]));
}

export function matchesSpacing(s, values) {
  return SPACING_KEYS.every((k) => values[k] === undefined || Math.abs((+s[k]) - (+values[k])) < 1e-6);
}
