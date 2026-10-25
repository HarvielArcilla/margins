// Paper: a texture laid under the page (so it turns with the page in the
// curl), and the soft shadow of the spine in a two-page spread.
//
// Textures are generated, not shipped: each is a seamless tile drawn once
// per paper type and light/dark theme and cached. They carry their own
// transparency (dark fibres and light flecks), so they work on any page
// colour without blend modes, which keeps them cheap to draw.
import { $ } from './ui.js';

export const PAPERS = [
  { id: 'smooth', name: 'Smooth' },
  { id: 'grain', name: 'Fine grain' },
  { id: 'cotton', name: 'Cotton' },
  { id: 'laid', name: 'Laid' },
  { id: 'linen', name: 'Linen' },
  { id: 'vellum', name: 'Vellum' },
  { id: 'recycled', name: 'Recycled' },
  { id: 'newsprint', name: 'Newsprint' },
  { id: 'parchment', name: 'Parchment' },
  { id: 'coldpress', name: 'Cold press' },
  { id: 'custom', name: 'Your image' },
];

const TILE = 256; // css px
const cache = new Map();

// ---------- seamless noise ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// Periodic value noise over a size×size field, wrapping at the edges.
function noiseField(size, cells, seed) {
  const r = rng(seed);
  const g = Array.from({ length: cells * cells }, r);
  const at = (x, y) => g[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  const f = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * k, fy = y * k;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      f[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return f;
}

function fbm(size, octaves, base, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noiseField(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ---------- tiles ----------
// dark: rgb used for darker marks; light: for lighter marks. Values are
// alpha in 0..1 per pixel: positive darkens, negative lightens.
function render(type, dark) {
  const S = TILE * 2; // drawn at 2× for sharp screens
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const shade = new Float32Array(S * S); // + darker, - lighter
  const r = rng(type.length * 7919 + 17);
  const add = (field, k, bias = 0.5) => { for (let i = 0; i < shade.length; i++) shade[i] += (field[i] - bias) * k; };
  const speck = (n, size, k, minLen = 0, maxLen = 0) => {
    for (let i = 0; i < n; i++) {
      const x0 = r() * S, y0 = r() * S;
      const len = minLen + r() * (maxLen - minLen);
      const ang = r() * Math.PI;
      const steps = Math.max(1, Math.round(len));
      const v = k * (0.5 + r());
      for (let j = 0; j <= steps; j++) {
        const x = Math.round(x0 + Math.cos(ang) * j + (r() - 0.5) * 0.6);
        const y = Math.round(y0 + Math.sin(ang) * j + (r() - 0.5) * 0.6);
        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) {
            const xi = (((x + dx) % S) + S) % S, yi = (((y + dy) % S) + S) % S;
            shade[yi * S + xi] += v;
          }
        }
      }
    }
  };

  switch (type) {
    case 'grain':
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.10;
      add(fbm(S, 3, 16, 3), 0.06);
      break;
    case 'cotton':
      add(fbm(S, 4, 8, 11), 0.10);
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.05;
      speck(260, 1, 0.05, 6, 28);
      speck(140, 1, -0.06, 4, 20);
      break;
    case 'laid': {
      add(fbm(S, 3, 12, 5), 0.06);
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.04;
      // fine laid lines across, chain lines down
      for (let y = 0; y < S; y++) {
        const laid = Math.sin((y / S) * Math.PI * 2 * 64) * 0.035;
        for (let x = 0; x < S; x++) {
          const chain = Math.max(0, 1 - Math.abs(((x / S) * 4) % 1 - 0.5) * 2 * 30) * 0.05;
          shade[y * S + x] += laid + chain;
        }
      }
      break;
    }
    case 'linen': {
      const n = fbm(S, 2, 24, 9);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = y * S + x;
          const warp = Math.sin((x / S) * Math.PI * 2 * 90 + n[i] * 3) * 0.045;
          const weft = Math.sin((y / S) * Math.PI * 2 * 90 + n[i] * 3) * 0.045;
          shade[i] += Math.max(warp, weft) + (r() - 0.5) * 0.04;
        }
      }
      break;
    }
    case 'vellum':
      add(fbm(S, 5, 4, 21), 0.12);
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.025;
      break;
    case 'recycled':
      add(fbm(S, 4, 8, 31), 0.08);
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.08;
      speck(900, 1, 0.16);
      speck(120, 2, 0.12);
      speck(160, 1, 0.08, 3, 10);
      break;
    case 'newsprint':
      add(fbm(S, 3, 24, 41), 0.08);
      for (let i = 0; i < shade.length; i++) shade[i] += (r() - 0.5) * 0.14;
      speck(400, 1, 0.06, 3, 12);
      break;
    case 'parchment': {
      const m = fbm(S, 5, 3, 51);
      for (let i = 0; i < shade.length; i++) shade[i] += Math.pow(Math.max(0, m[i] - 0.35), 1.6) * 0.5 + (r() - 0.5) * 0.03;
      add(fbm(S, 3, 20, 52), 0.05);
      break;
    }
    case 'coldpress': {
      const b = fbm(S, 4, 10, 61);
      // emboss the bumps: light from the top left
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = y * S + x;
          const dx = b[i] - b[y * S + ((x + 2) % S)];
          const dy = b[i] - b[((y + 2) % S) * S + x];
          shade[i] += (dx + dy) * 1.4 + (r() - 0.5) * 0.03;
        }
      }
      break;
    }
    default:
      return null;
  }

  const darkInk = dark ? [0, 0, 0] : [70, 52, 30];
  const lightInk = dark ? [255, 255, 255] : [255, 252, 240];
  const strength = dark ? 0.8 : 1;
  for (let i = 0, p = 0; i < shade.length; i++, p += 4) {
    const v = shade[i] * strength;
    const col = v >= 0 ? darkInk : lightInk;
    img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2];
    img.data[p + 3] = Math.min(255, Math.round(Math.abs(v) * 255 * 1.6));
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function tileUrl(type, dark) {
  const key = `${type}|${dark ? 1 : 0}`;
  if (!cache.has(key)) cache.set(key, render(type, dark));
  return cache.get(key);
}

// ---------- applying ----------
let applied = '';
export function apply(s, dark) {
  const layer = $('#paper');
  if (!layer) return;
  const strength = s.paperTexture / 100;
  const type = s.paperType || 'grain';
  let url = null, size = `${TILE * (s.paperScale || 1)}px`;
  if (strength > 0 && type === 'custom' && s.paperImage) {
    url = `app://reader/usertextures/${encodeURIComponent(s.paperImage)}`;
    size = s.paperScale && s.paperScale !== 1 ? `${Math.round(s.paperScale * 100)}% auto` : 'cover';
  } else if (strength > 0 && type !== 'smooth' && type !== 'custom') {
    url = tileUrl(type, dark);
  }
  const key = `${url}|${size}|${strength}`;
  if (key !== applied) {
    applied = key;
    layer.style.backgroundImage = url ? `url("${url}")` : '';
    layer.style.backgroundSize = size;
    // the custom image is a full picture, so it blends in by opacity
    layer.style.opacity = url ? String(type === 'custom' ? strength : Math.min(1, strength * 1.15)) : '0';
    layer.hidden = !url;
  }
  const rv = $('#reader-view');
  rv.classList.toggle('spine-shadow', !!s.spineShadow);
  // deeper creases are darker and a little wider
  const depth = Math.max(0, Math.min(100, s.creaseDepth ?? 45)) / 100;
  rv.style.setProperty('--crease', depth.toFixed(3));
  rv.style.setProperty('--crease-w', `${Math.round(70 + depth * 110)}px`);
  rv.classList.toggle('solid-header', s.solidHeader !== false && s.showHeader !== false);
}

// Where the spine is, for the gutter shadow in two-page spreads.
export function placeSpine(L, stageLeft) {
  const rv = $('#reader-view');
  if (!rv) return;
  rv.classList.toggle('two-pages', L.cols === 2);
  if (L.cols === 2) rv.style.setProperty('--spine-x', `${stageLeft + L.padX + L.width / 2}px`);
}
