// Style templates: named bundles of typography, color, atmosphere and
// page-turn settings that can be applied in one click. They leave the page
// layout (margins, one or two pages, desk, crease) to page layouts
// (layouts.js). Users can save their own.
import { DEFAULTS } from './settings.js';

export const TEMPLATE_KEYS = [
  'font', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paragraphSpacing',
  'paragraphIndent', 'textAlign', 'wordBreaks', 'publisherStyles', 'headingFont', 'headingScale', 'dropCaps',
  'smallCapsHeadings', 'textShadow',
  'theme', 'brightness', 'warmth', 'paperTexture', 'paperType', 'vignette', 'pageAnimation', 'animationMs', 'curlFrom', 'ruler',
  'rulerLines', 'fixation', 'fixationStrength', 'dimImages',
];

export const BUILTIN_TEMPLATES = [
  {
    id: 'default', name: 'Margins Default', blurb: 'Balanced book typography',
    settings: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, DEFAULTS[k]])),
  },
  {
    id: 'classic', name: 'Classic Novel', blurb: 'Garamond, justified, indented, page curl',
    settings: { font: 'EB Garamond', fontSize: 21, lineHeight: 1.5, textAlign: 'justify', paragraphIndent: 1.5,
      paragraphSpacing: 0, wordBreaks: 'auto', theme: 'cream', paperType: 'laid', paperTexture: 40, pageAnimation: 'curl', lineLength: 60, dropCaps: true,
      smallCapsHeadings: true, flow: 'paginated', spread: 'auto', publisherStyles: 'mix' },
  },
  {
    id: 'essay', name: 'Modern Essay', blurb: 'Airy, ragged-right, block paragraphs',
    settings: { font: 'Source Serif 4', fontSize: 19, lineHeight: 1.75, textAlign: 'left', paragraphIndent: 0,
      paragraphSpacing: 1, wordBreaks: 'never', theme: 'white', pageAnimation: 'slide', lineLength: 64, dropCaps: false },
  },
  {
    id: 'comfort', name: 'Comfort', blurb: 'Large, loose and warm',
    settings: { font: 'Literata', fontSize: 22, lineHeight: 1.85, letterSpacing: 0.01, wordSpacing: 0.05,
      textAlign: 'left', paragraphSpacing: 0.7, paragraphIndent: 0, theme: 'sepia', warmth: 10, pageAnimation: 'fade' },
  },
  {
    id: 'night', name: 'Night Owl', blurb: 'Dark, dim, and warm for bedtime',
    settings: { font: 'Literata', fontSize: 20, lineHeight: 1.7, theme: 'night', brightness: 80, warmth: 35,
      pageAnimation: 'fade', textShadow: 0.2 },
  },
  {
    id: 'oled-bed', name: 'Lights Out', blurb: 'True black with red-shifted text',
    settings: { font: 'Atkinson Hyperlegible', fontSize: 20, lineHeight: 1.7, theme: 'red-night', brightness: 70,
      warmth: 0, pageAnimation: 'none', dimImages: 50 },
  },
  {
    id: 'dyslexia', name: 'Dyslexia Friendly', blurb: 'OpenDyslexic, wide spacing, reading ruler',
    settings: { font: 'OpenDyslexic', fontSize: 19, lineHeight: 2, letterSpacing: 0.05, wordSpacing: 0.16,
      textAlign: 'left', wordBreaks: 'never', paragraphIndent: 0, paragraphSpacing: 1.2, theme: 'cream',
      ruler: 'band', rulerLines: 2, lineLength: 58, publisherStyles: 'override' },
  },
  {
    id: 'large-print', name: 'Large Print', blurb: 'Hyperlegible, heavy and high contrast',
    settings: { font: 'Atkinson Hyperlegible', fontSize: 30, fontWeight: 600, lineHeight: 1.6, textAlign: 'left',
      wordBreaks: 'never', paragraphIndent: 0, paragraphSpacing: 1, theme: 'contrast-light', spread: 'none',
      marginH: 32, lineLength: 56, publisherStyles: 'override' },
  },
  {
    id: 'compact', name: 'Compact', blurb: 'Dense two-page spread for big screens',
    settings: { font: 'Source Sans 3', fontSize: 16, lineHeight: 1.45, paragraphSpacing: 0.3, marginH: 32,
      marginV: 24, spread: 'always', lineLength: 70, columnGap: 48, theme: 'paper' },
  },
  {
    id: 'academic', name: 'Academic', blurb: 'Plex Serif, left-aligned, solarized',
    settings: { font: 'IBM Plex Serif', fontSize: 17, lineHeight: 1.65, textAlign: 'left', paragraphIndent: 0,
      paragraphSpacing: 0.8, theme: 'solarized-light', lineLength: 76, pageAnimation: 'push' },
  },
  {
    id: 'eink', name: 'E-ink', blurb: 'No animation, crisp, paper-white',
    settings: { font: 'Literata', fontSize: 20, fontWeight: 450, theme: 'eink', pageAnimation: 'none', paperTexture: 30, paperType: 'grain' },
  },
  {
    id: 'speed', name: 'Speed Reader', blurb: 'Fixation emphasis, line ruler, continuous scroll',
    settings: { font: 'Lexend', fontSize: 19, lineHeight: 1.7, textAlign: 'left', paragraphIndent: 0,
      paragraphSpacing: 0.8, fixation: true, fixationStrength: 50, ruler: 'line', flow: 'continuous', theme: 'sky' },
  },
  {
    id: 'typewriter', name: 'Typewriter', blurb: 'Monospaced on warm dark',
    settings: { font: 'JetBrains Mono', fontSize: 16, lineHeight: 1.7, textAlign: 'left', paragraphIndent: 0,
      paragraphSpacing: 1, theme: 'gruvbox-dark', lineLength: 64, wordBreaks: 'never' },
  },
  {
    id: 'manuscript', name: 'Manuscript', blurb: 'Parchment, Cormorant, vignette, page curl',
    settings: { font: 'Cormorant Garamond', fontSize: 23, fontWeight: 500, lineHeight: 1.5, theme: 'parchment',
      paperTexture: 60, paperType: 'parchment', vignette: 40, pageAnimation: 'curl', dropCaps: true, textAlign: 'justify' },
  },
];

export function snapshotTemplate(settings, name) {
  return {
    id: `user-${Date.now().toString(36)}`,
    name,
    blurb: `${settings.font}, ${settings.fontSize}px`,
    settings: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, settings[k]])),
    user: true,
  };
}

// Settings to apply for a template: anything it doesn't mention goes back to
// the default, so templates don't inherit leftovers from the previous one.
export function templatePatch(t) {
  // only style keys: older saved templates also carried layout settings
  const own = Object.fromEntries(Object.entries(t.settings).filter(([k]) => TEMPLATE_KEYS.includes(k)));
  return { ...Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, DEFAULTS[k]])), ...own };
}
