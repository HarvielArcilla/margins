// Colour schemes. Each one colours both the page and the app chrome around it.

export const THEMES = [
  { id: 'paper', name: 'Paper', bg: '#fbf9f4', fg: '#26231e', link: '#3b6ea8', accent: '#b5562b' },
  { id: 'white', name: 'White', bg: '#ffffff', fg: '#1d1d1f', link: '#0a63c9', accent: '#0a63c9' },
  { id: 'sepia', name: 'Sepia', bg: '#f3e7cf', fg: '#4a3a26', link: '#8a4f1d', accent: '#a5582a' },
  { id: 'cream', name: 'Cream', bg: '#faf3e0', fg: '#332b22', link: '#7b5b2b', accent: '#c47a2c' },
  { id: 'parchment', name: 'Parchment', bg: '#ede0c4', fg: '#3c2f1e', link: '#6e4520', accent: '#8f3d1f' },
  { id: 'mint', name: 'Mint', bg: '#e6f2ea', fg: '#1f3328', link: '#2b6f4f', accent: '#2f8a5e' },
  { id: 'sky', name: 'Sky', bg: '#e8f0f8', fg: '#1d2a3a', link: '#2a5d9a', accent: '#3a73c2' },
  { id: 'rose', name: 'Rose', bg: '#f8eaec', fg: '#3a2328', link: '#9a3550', accent: '#c2486a' },
  { id: 'lavender', name: 'Lavender', bg: '#efeaf7', fg: '#2b2438', link: '#5d43a0', accent: '#7656c4' },
  { id: 'stone', name: 'Stone', bg: '#e9e8e4', fg: '#2a2a28', link: '#4a5e7a', accent: '#6b6b63' },
  { id: 'eink', name: 'E-ink', bg: '#f2f2ee', fg: '#000000', link: '#000000', accent: '#000000', eink: true },
  { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3', fg: '#586e75', link: '#268bd2', accent: '#cb4b16' },
  { id: 'gruvbox-light', name: 'Gruvbox Light', bg: '#fbf1c7', fg: '#3c3836', link: '#076678', accent: '#af3a03' },
  { id: 'dusk', name: 'Dusk', bg: '#3b3936', fg: '#e6dfd3', link: '#9cc4e8', accent: '#e0a36b', dark: true },
  { id: 'night', name: 'Night', bg: '#1e1e20', fg: '#cfccc6', link: '#8ab4e8', accent: '#d9925a', dark: true },
  { id: 'oled', name: 'OLED Black', bg: '#000000', fg: '#bdbdbd', link: '#7aa7dd', accent: '#d08a4f', dark: true },
  { id: 'midnight', name: 'Midnight', bg: '#141a2a', fg: '#c9d3e6', link: '#8fb4ff', accent: '#7aa2f7', dark: true },
  { id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36', fg: '#93a1a1', link: '#2aa198', accent: '#b58900', dark: true },
  { id: 'nord', name: 'Nord', bg: '#2e3440', fg: '#d8dee9', link: '#88c0d0', accent: '#ebcb8b', dark: true },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', fg: '#f8f8f2', link: '#8be9fd', accent: '#ff79c6', dark: true },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', bg: '#282828', fg: '#ebdbb2', link: '#83a598', accent: '#fe8019', dark: true },
  { id: 'forest', name: 'Forest', bg: '#1d2a22', fg: '#cfdccf', link: '#8fcfa5', accent: '#a7c957', dark: true },
  { id: 'coffee', name: 'Coffee', bg: '#2b211b', fg: '#e3d3c1', link: '#d9a679', accent: '#d08c4a', dark: true },
  { id: 'red-night', name: 'Red Night', bg: '#120606', fg: '#d26a5c', link: '#e08a7a', accent: '#c4523f', dark: true },
  { id: 'terminal', name: 'Terminal', bg: '#0b0f0b', fg: '#7fe08a', link: '#a6f0b0', accent: '#4cc35a', dark: true },
  { id: 'contrast-dark', name: 'High Contrast Dark', bg: '#000000', fg: '#ffffff', link: '#ffeb3b', accent: '#ffeb3b', dark: true },
  { id: 'contrast-yellow', name: 'Yellow on Black', bg: '#000000', fg: '#ffd400', link: '#ffffff', accent: '#ffffff', dark: true },
  { id: 'contrast-light', name: 'High Contrast Light', bg: '#ffffff', fg: '#000000', link: '#0000cc', accent: '#0000cc' },
];

export function allThemes(settings) {
  return [...THEMES, ...(settings.customThemes || []).map((t) => ({ ...t, custom: true }))];
}

export function findTheme(settings) {
  return allThemes(settings).find((t) => t.id === settings.theme) || THEMES[0];
}

export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(',')},${a})`;

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDark(theme) {
  return theme.dark ?? luminance(theme.bg) < 0.3;
}

// Paints the app chrome (CSS variables) from a theme.
export function applyChromeTheme(theme) {
  const dark = isDark(theme);
  const s = document.documentElement.style;
  s.setProperty('--bg', theme.bg);
  s.setProperty('--fg', theme.fg);
  s.setProperty('--muted', mix(theme.fg, theme.bg, 0.45));
  s.setProperty('--faint', mix(theme.fg, theme.bg, 0.7));
  s.setProperty('--panel', mix(theme.bg, dark ? '#ffffff' : '#000000', dark ? 0.05 : 0.025));
  s.setProperty('--panel-2', mix(theme.bg, dark ? '#ffffff' : '#000000', dark ? 0.09 : 0.05));
  s.setProperty('--border', mix(theme.bg, theme.fg, dark ? 0.16 : 0.12));
  s.setProperty('--hover', rgba(theme.fg, dark ? 0.08 : 0.06));
  s.setProperty('--accent', theme.accent || theme.link);
  s.setProperty('--accent-fg', luminance(theme.accent || theme.link) > 0.45 ? '#111' : '#fff');
  s.setProperty('--link', theme.link);
  s.setProperty('--shadow', dark ? '0 18px 50px rgba(0,0,0,.55)' : '0 18px 50px rgba(40,30,10,.16)');
  document.documentElement.dataset.dark = dark ? '1' : '0';
  document.documentElement.dataset.eink = theme.eink ? '1' : '0';
  window.api?.window.chrome({ bg: theme.bg, fg: mix(theme.fg, theme.bg, 0.3), dark });
}

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', name: 'Yellow', hex: '#f6d23f' },
  { id: 'green', name: 'Green', hex: '#71cf86' },
  { id: 'blue', name: 'Blue', hex: '#5fb0f0' },
  { id: 'pink', name: 'Pink', hex: '#f483ad' },
  { id: 'purple', name: 'Purple', hex: '#b096e0' },
  { id: 'orange', name: 'Orange', hex: '#ffa552' },
  { id: 'red', name: 'Red', hex: '#ec5f5f' },
  { id: 'teal', name: 'Teal', hex: '#3ccfc0' },
  { id: 'gray', name: 'Gray', hex: '#a9a9a9' },
];

export const HIGHLIGHT_STYLES = [
  { id: 'highlight', name: 'Highlight' },
  { id: 'marker', name: 'Marker (highlight + underline)' },
  { id: 'underline', name: 'Underline' },
  { id: 'wavy', name: 'Squiggle' },
  { id: 'dotted', name: 'Dotted underline' },
  { id: 'dashed', name: 'Dashed underline' },
  { id: 'double', name: 'Double underline' },
  { id: 'strike', name: 'Strikethrough' },
  { id: 'text', name: 'Colored text' },
  { id: 'glow', name: 'Glow' },
];
