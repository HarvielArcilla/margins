// Builds the stylesheet injected into every book page (the epub iframes)
// from the current settings and theme.
import { fontStack, fontFaceCssFor } from './fonts.js';
import { rgba, mix, isDark } from './themes.js';

export function buildContentCss(s, theme) {
  const dark = isDark(theme);
  const body = fontStack(s.font);
  const headingName = s.headingFont === 'same' ? s.font : s.headingFont;
  const heading = headingName === 'publisher' ? null : fontStack(headingName);
  const imp = '!important';
  const mode = s.publisherStyles; // respect | mix | override
  const text = 'p, li, blockquote, dd, dt, figcaption, td, th, div';
  const out = [];
  // Splitting words across lines: automatically (hyphenation), only where
  // the book marks a break (soft hyphens), or never.
  const hy = { auto: 'auto', book: 'manual', never: 'none' }[s.wordBreaks] || 'auto';

  out.push(fontFaceCssFor([s.font, headingName]));

  out.push(`/* always light: matches the frame, so no opaque backdrop flashes in */
  :root { color-scheme: light; }
  html {
    -webkit-font-smoothing: ${s.fontSmoothing === 'antialiased' ? 'antialiased' : s.fontSmoothing === 'subpixel' ? 'subpixel-antialiased' : 'auto'};
    text-rendering: optimizeLegibility;
  }
  html, body { background: transparent ${imp}; }
  body {
    font-size: ${s.fontSize}px ${imp};
    ${mode !== 'respect' ? `line-height: ${s.lineHeight} ${imp};` : ''}
    ${body && mode !== 'respect' ? `font-family: ${body} ${imp};` : ''}
    font-weight: ${s.fontWeight} ${imp};
    letter-spacing: ${s.letterSpacing}em ${imp};
    word-spacing: ${s.wordSpacing}em ${imp};
    hyphens: ${hy} ${imp};
    -webkit-hyphens: ${hy} ${imp};
    ${s.wordBreaks === 'auto' ? `hyphenate-limit-chars: 6 3 2;` : ''}
    font-variant-ligatures: ${s.ligatures ? 'common-ligatures' : 'none'};
    font-variant-numeric: ${s.oldStyleNumbers ? 'oldstyle-nums' : 'normal'};
    ${s.textShadow ? `text-shadow: 0 0 ${s.textShadow}px currentColor;` : ''}
    overflow-wrap: break-word;
  }
  ${hy === 'none' ? `body * { hyphens: none ${imp}; -webkit-hyphens: none ${imp}; word-break: normal ${imp}; }` : ''}
  b, strong { font-weight: ${s.boldWeight} ${imp}; }`);

  if (!s.keepPublisherColors) {
    out.push(`body { color: ${theme.fg} ${imp}; }
    body *:not(a):not(a *) { color: inherit ${imp}; }
    body * { background-color: transparent ${imp}; border-color: ${rgba(theme.fg, 0.25)} ${imp}; }
    a, a * { color: ${theme.link} ${imp}; }
    hr { border-color: ${rgba(theme.fg, 0.3)} ${imp}; }`);
  }

  if (mode !== 'respect') {
    const scope = mode === 'override' ? 'body *:not(code):not(pre):not(kbd):not(samp):not(tt)' : text;
    out.push(`${scope} {
      ${body ? `font-family: ${body} ${imp};` : ''}
      line-height: ${s.lineHeight} ${imp};
      letter-spacing: inherit ${imp};
      word-spacing: inherit ${imp};
    }
    ${mode === 'override' ? `${scope}:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not(sup):not(sub):not(small) { font-size: 1em ${imp}; }
      body *:not(b):not(strong):not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not(th) { font-weight: inherit ${imp}; }` : ''}
    p { margin-top: 0 ${imp}; margin-bottom: ${s.paragraphSpacing}em ${imp}; text-indent: ${s.paragraphIndent}em ${imp}; }
    h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p, hr + p, blockquote + p, figure + p, p:first-child,
    p[class*="center" i], p[class*="noindent" i], p[class*="no-indent" i], p[class*="first" i] { text-indent: 0 ${imp}; }`);
  }

  if (s.textAlign !== 'publisher') {
    out.push(`${text} { text-align: ${s.textAlign} ${imp}; }
    [class*="center" i], [style*="center" i], [align="center" i] { text-align: center ${imp}; }
    [class*="right" i] { text-align: right ${imp}; }`);
  }

  out.push(`h1, h2, h3, h4, h5, h6 {
    ${heading ? `font-family: ${heading} ${imp};` : ''}
    ${s.headingScale !== 1 ? `zoom: ${s.headingScale};` : ''}
    ${s.smallCapsHeadings ? `font-variant: small-caps ${imp}; letter-spacing: 0.04em ${imp};` : ''}
    line-height: 1.25 ${imp};
    hyphens: ${hy === 'auto' ? 'manual' : hy} ${imp};
    text-align: ${s.textAlign === 'justify' ? 'center' : 'inherit'};
  }`);

  if (s.dropCaps) {
    out.push(`h1 + p::first-letter, h2 + p::first-letter, h3 + p::first-letter, figure + p::first-letter,
      section > p:first-of-type::first-letter, body > p:first-of-type::first-letter {
      initial-letter: 3; -webkit-initial-letter: 3; margin-right: 0.12em; color: ${theme.accent} ${imp};
      font-weight: ${Math.max(500, s.fontWeight)};
    }`);
  }

  const imgFilters = [];
  if (s.dimImages) imgFilters.push(`brightness(${1 - s.dimImages / 100})`);
  if (dark && s.invertImagesInDark) imgFilters.push('invert(1) hue-rotate(180deg)');
  out.push(`img, svg, video { max-width: 100% ${imp}; ${imgFilters.length ? `filter: ${imgFilters.join(' ')};` : ''} }
    ${s.imageFit === 'width' ? `img { width: 100% ${imp}; height: auto ${imp}; }` : ''}
    ${s.imageFit === 'original' ? `img { max-height: none ${imp}; }` : ''}
    ::selection { background: ${rgba(theme.accent, dark ? 0.45 : 0.3)}; }
    pre, code { white-space: pre-wrap ${imp}; }
    ::highlight(m-fix) { color: ${mix(theme.fg, theme.bg, 0.5 - s.fixationStrength / 400)}; }
    ::highlight(m-search) { background-color: ${rgba(theme.accent, 0.35)}; }
    ::highlight(m-tts) { background-color: ${rgba(theme.link, dark ? 0.45 : 0.28)}; }
    ::highlight(m-flash) { background-color: ${rgba(theme.accent, 0.5)}; }`);

  return out.join('\n');
}
