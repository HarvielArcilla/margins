// Presets live with the settings they set: text styles in Text, color
// presets in Colors, page layouts in Page. Each group has built-ins and the
// reader's own; applying one sets its group's settings (anything it doesn't
// name goes back to the default) and leaves every other setting alone.
import { DEFAULTS } from './settings.js';
import { THEMES, isDark } from './themes.js';

export const GROUPS = {
  text: {
    keys: ['font', 'fontSize', 'fontWeight', 'boldWeight', 'textShadow', 'lineHeight', 'letterSpacing', 'wordSpacing',
      'paragraphSpacing', 'paragraphIndent', 'textAlign', 'wordBreaks', 'publisherStyles', 'headingFont', 'headingScale',
      'dropCaps', 'smallCapsHeadings'],
    userKey: 'userTextStyles', noun: 'text style', title: 'Text styles',
    filters: [['all', 'All'], ['mine', 'Yours']],
    builtins: [
      { id: 'default', name: 'Margins Default', blurb: 'Balanced book typography', values: {} },
      { id: 'classic', name: 'Classic Novel', blurb: 'Garamond, justified, indented, drop caps',
        values: { font: 'EB Garamond', fontSize: 21, lineHeight: 1.5, textAlign: 'justify', paragraphIndent: 1.5, paragraphSpacing: 0, wordBreaks: 'auto', dropCaps: true, smallCapsHeadings: true, publisherStyles: 'mix' } },
      { id: 'essay', name: 'Modern Essay', blurb: 'Airy, ragged-right, block paragraphs',
        values: { font: 'Source Serif 4', fontSize: 19, lineHeight: 1.75, textAlign: 'left', paragraphIndent: 0, paragraphSpacing: 1, wordBreaks: 'never' } },
      { id: 'comfort', name: 'Comfort', blurb: 'Large and loose',
        values: { font: 'Literata', fontSize: 22, lineHeight: 1.85, letterSpacing: 0.01, wordSpacing: 0.05, textAlign: 'left', paragraphSpacing: 0.7, paragraphIndent: 0 } },
      { id: 'dyslexia', name: 'Dyslexia Friendly', blurb: 'OpenDyslexic, wide spacing',
        values: { font: 'OpenDyslexic', fontSize: 19, lineHeight: 2, letterSpacing: 0.05, wordSpacing: 0.16, textAlign: 'left', wordBreaks: 'never', paragraphIndent: 0, paragraphSpacing: 1.2, publisherStyles: 'override' } },
      { id: 'large-print', name: 'Large Print', blurb: 'Hyperlegible and heavy',
        values: { font: 'Atkinson Hyperlegible', fontSize: 30, fontWeight: 600, lineHeight: 1.6, textAlign: 'left', wordBreaks: 'never', paragraphIndent: 0, paragraphSpacing: 1, publisherStyles: 'override' } },
      { id: 'compact', name: 'Compact', blurb: 'Small sans, tight lines',
        values: { font: 'Source Sans 3', fontSize: 16, lineHeight: 1.45, paragraphSpacing: 0.3 } },
      { id: 'academic', name: 'Academic', blurb: 'Plex Serif, left-aligned',
        values: { font: 'IBM Plex Serif', fontSize: 17, lineHeight: 1.65, textAlign: 'left', paragraphIndent: 0, paragraphSpacing: 0.8 } },
      { id: 'speed', name: 'Speed Reader', blurb: 'Lexend, open lines',
        values: { font: 'Lexend', fontSize: 19, lineHeight: 1.7, textAlign: 'left', paragraphIndent: 0, paragraphSpacing: 0.8 } },
      { id: 'typewriter', name: 'Typewriter', blurb: 'Monospaced',
        values: { font: 'JetBrains Mono', fontSize: 16, lineHeight: 1.7, textAlign: 'left', paragraphIndent: 0, paragraphSpacing: 1, wordBreaks: 'never' } },
      { id: 'manuscript', name: 'Manuscript', blurb: 'Cormorant, justified, drop caps',
        values: { font: 'Cormorant Garamond', fontSize: 23, fontWeight: 500, lineHeight: 1.5, dropCaps: true, textAlign: 'justify' } },
    ],
  },
  colors: {
    // a color preset is a scheme (page, text, links, accent) with any
    // colors you changed over it, plus paper and atmosphere
    keys: ['theme', 'customColors', 'paperType', 'paperTexture', 'paperScale', 'brightness', 'warmth', 'vignette', 'dimImages'],
    userKey: 'userColorPresets', noun: 'color preset', title: 'Color presets',
    filters: [['all', 'All'], ['light', 'Light'], ['dark', 'Dark'], ['mine', 'Yours']],
    builtins: [
      ...THEMES.map((t) => ({ id: `theme-${t.id}`, name: t.name, values: { theme: t.id } })),
      { id: 'classic', name: 'Classic', blurb: 'Cream on laid paper', values: { theme: 'cream', paperType: 'laid', paperTexture: 40 } },
      { id: 'warm', name: 'Warm', blurb: 'Sepia with a little warmth', values: { theme: 'sepia', warmth: 10 } },
      { id: 'manuscript', name: 'Manuscript', blurb: 'Parchment and vignette', values: { theme: 'parchment', paperTexture: 60, paperType: 'parchment', vignette: 40 } },
      { id: 'night-owl', name: 'Night Owl', blurb: 'Dark, dim and warm', values: { theme: 'night', brightness: 80, warmth: 35 } },
      { id: 'lights-out', name: 'Lights Out', blurb: 'True black, red text', values: { theme: 'red-night', brightness: 70, dimImages: 50 } },
    ],
  },
  page: {
    keys: ['spread', 'marginH', 'marginV', 'lineLength', 'columnGap', 'deskX', 'deskY', 'pageRadius', 'spineShadow', 'creaseDepth', 'creaseWidth'],
    userKey: 'userLayouts', noun: 'page layout', title: 'Page layouts',
    filters: [['all', 'All'], ['mine', 'Yours']],
    builtins: [
      { id: 'full', name: 'Full window', blurb: 'Pages fill the window', values: { spread: 'auto' } },
      { id: 'open-book', name: 'Open book', blurb: 'Two pages on a desk',
        values: { spread: 'always', marginH: 64, marginV: 40, lineLength: 62, columnGap: 72, deskX: 6, deskY: 4, pageRadius: 6, creaseDepth: 60, creaseWidth: 60 } },
      { id: 'paperback', name: 'Paperback', blurb: 'Snug margins, small desk',
        values: { spread: 'auto', marginH: 44, marginV: 30, lineLength: 58, columnGap: 56, deskX: 10, deskY: 5, pageRadius: 3, creaseDepth: 40, creaseWidth: 45 } },
      { id: 'single-desk', name: 'Single page', blurb: 'One page centered on a desk',
        values: { spread: 'none', marginH: 56, marginV: 40, lineLength: 64, deskX: 24, deskY: 4, pageRadius: 10 } },
      { id: 'roomy', name: 'Roomy', blurb: 'Wide margins, no desk',
        values: { spread: 'auto', marginH: 128, marginV: 64, lineLength: 68, columnGap: 96, creaseDepth: 35, creaseWidth: 45 } },
      { id: 'compact', name: 'Compact', blurb: 'Most text on screen',
        values: { spread: 'auto', marginH: 28, marginV: 18, lineLength: 84, columnGap: 40, spineShadow: false } },
    ],
  },
};

const pick = (keys, src) => Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]]));

// The settings a preset sets: its own values over the defaults of its group.
export const presetPatch = (group, p) => ({ ...pick(GROUPS[group].keys, DEFAULTS), ...pick(GROUPS[group].keys, p.values || {}) });

export const snapshot = (group, settings) => pick(GROUPS[group].keys, settings);

export function isActive(group, settings, p) {
  return Object.entries(presetPatch(group, p)).every(([k, v]) => JSON.stringify(settings[k]) === JSON.stringify(v));
}

export const userPresets = (group, s) => (s[GROUPS[group].userKey] || []).map((p) => ({ ...p, user: true }));
export const allPresets = (group, s) => [...GROUPS[group].builtins, ...userPresets(group, s)];

// Which preset the settings match right now: yours first, then built-ins.
export function currentPreset(group, s) {
  return [...userPresets(group, s), ...GROUPS[group].builtins].find((p) => isActive(group, s, p)) || null;
}

// The colors a color preset shows (for its card).
export function presetTheme(values) {
  const base = THEMES.find((t) => t.id === values.theme) || THEMES[0];
  return values.customColors ? { ...base, ...values.customColors } : base;
}
export const presetIsDark = (values) => isDark(presetTheme(values));

// Older versions kept one kind of "style template" mixing text and color
// (and before that, layout too): split each into a text style and a color
// preset with the same name.
// Own color themes (and changed built-in ones) became color presets: a
// built-in scheme with your colors over it.
export function migrateThemes(saved, global) {
  const stamp = Date.now().toString(36);
  const made = [];
  const map = (global.__themeMap = new Map());
  (saved.customThemes || []).forEach((t, i) => {
    if (!t?.bg || !t?.fg) return;
    const colors = { bg: t.bg, fg: t.fg, link: t.link || t.fg, accent: t.accent || t.link || t.fg };
    const values = { theme: isDark(t) ? 'night' : 'paper', customColors: colors };
    map.set(t.id, values);
    made.push({ id: `colors-${stamp}-t${i}`, name: t.name || 'My colors', values });
  });
  Object.entries(saved.themeOverrides || {}).forEach(([id, o], i) => {
    const base = THEMES.find((t) => t.id === id);
    if (!base || !o) return;
    const values = { theme: id, customColors: { bg: o.bg, fg: o.fg, link: o.link, accent: o.accent } };
    made.push({ id: `colors-${stamp}-o${i}`, name: `${base.name} (yours)`, values });
    if (saved.theme === id) global.customColors = values.customColors;
  });
  if (map.has(saved.theme)) { const v = map.get(saved.theme); global.theme = v.theme; global.customColors = v.customColors; }
  global.userColorPresets = [...(global.userColorPresets || saved.userColorPresets || []), ...made];
  delete global.customThemes;
  delete global.themeOverrides;
}

export function migrateTemplates(saved, global) {
  const old = saved.userTemplates;
  if (!Array.isArray(old) || !old.length) { delete global.userTemplates; return; }
  const stamp = Date.now().toString(36);
  const text = [], colors = [];
  old.forEach((t, i) => {
    const v = t.settings || {};
    const tv = pick(GROUPS.text.keys, v), cv = pick(GROUPS.colors.keys, v);
    const own = global.__themeMap?.get(cv.theme);
    if (own) Object.assign(cv, own);
    if (Object.keys(tv).length) text.push({ id: `ts-${stamp}-${i}`, name: t.name, blurb: t.blurb || '', values: tv });
    if (Object.keys(cv).length) colors.push({ id: `cp-${stamp}-${i}`, name: t.name, blurb: '', values: cv });
  });
  global.userTextStyles = [...(global.userTextStyles || []), ...text];
  global.userColorPresets = [...(global.userColorPresets || []), ...colors];
  delete global.userTemplates;
}
