// A book's covers, shown as covers: the closed book lying on the desk, in
// the cover image's own proportions, rather than an image set inside a page
// with margins around it.
// - The front cover: in two-page view it lies to the right of the spine,
//   where a closed book would.
// - The back cover (when the book has one): the book closed again at the
//   end, lying face down, so to the left of the spine.
//
// Shared by the reader and the offscreen pager (which pictures pages for
// page turns), so a turn to or from a cover shows exactly what's on screen.

// The single picture a cover page holds, or null: exactly one image and
// next to no text.
function singleImage(doc) {
  const body = doc?.body || doc?.querySelector?.('body');
  if (!body) return null;
  const imgs = [...doc.querySelectorAll('img')];
  const svgImgs = [...doc.querySelectorAll('svg image')];
  if (imgs.length + svgImgs.length !== 1) return null;
  const text = (body.textContent || '').replace(/\s+/g, '');
  const marked = isMarked(doc);
  if (text.length > 80 && !marked) return null;
  let src = '';
  let alt = '';
  if (imgs.length) {
    src = imgs[0].currentSrc || imgs[0].src || imgs[0].getAttribute('src');
    alt = imgs[0].alt || '';
  } else {
    const href = svgImgs[0].getAttribute('xlink:href') || svgImgs[0].getAttribute('href') || svgImgs[0].href?.baseVal;
    try { src = new URL(href, doc.baseURI).href; } catch { src = href; }
  }
  return src ? { src, alt, raw: imgs[0]?.getAttribute('src') || svgImgs[0]?.getAttribute('xlink:href') || svgImgs[0]?.getAttribute('href') || '' } : null;
}
const isMarked = (doc) => !!doc.querySelector('[*|type~="cover"], [*|type~="backcover"], [role="doc-cover"]');

// Is this section the book's front cover page? Returns its image, or null.
// A cover page is the first part of the book (or one marked as the cover)
// holding a single picture and next to no text.
export function findCover(contents) {
  const doc = contents?.document;
  if (!doc) return null;
  const idx = contents.sectionIndex ?? 99;
  const marked = isMarked(doc);
  const named = /(^|[^a-z])cover/i.test(contents.section?.href || doc.baseURI || '');
  if (idx > 1 && !marked) return null;
  if (idx === 1 && !marked && !named) return null;
  const im = singleImage(doc);
  return im ? { ...im, side: 'front' } : null;
}

// Is this section the back cover (as found by backCoverIndex)?
export function findBackCover(contents, backIndex) {
  if (backIndex == null || backIndex < 0 || contents?.sectionIndex !== backIndex) return null;
  const im = singleImage(contents.document);
  return im ? { ...im, side: 'back' } : null;
}

// The cover image's size, once it has loaded.
const sizes = new Map();
export function measure(src) {
  if (sizes.has(src)) return sizes.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth || 2, h: im.naturalHeight || 3 });
    im.onerror = () => resolve({ w: 2, h: 3 });
    im.src = src;
  });
  sizes.set(src, p);
  return p;
}

// Show a cover on the stage (or take it away, with cover = null).
// cols: 1 or 2 pages across.
export async function showCover(stage, cover, cols) {
  let face = stage.querySelector('.cover-face');
  if (!cover) {
    stage.classList.remove('closed', 'closed-spread');
    if (face) face.hidden = true;
    return;
  }
  const { w, h } = await measure(cover.src);
  if (!face) {
    face = document.createElement('div');
    face.className = 'cover-face';
    face.append(document.createElement('img'));
    stage.append(face);
  }
  face.classList.toggle('back', cover.side === 'back');
  const img = face.firstChild;
  if (img.getAttribute('src') !== cover.src) {
    img.src = cover.src;
    img.alt = cover.alt || (cover.side === 'back' ? 'Back cover' : 'Cover');
    try { await img.decode(); } catch { /* shown when it arrives */ }
  }
  const b = coverBox(stage, { w, h }, cols, cover.side);
  Object.assign(face.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  face.hidden = false;
  stage.classList.add('closed');
  stage.classList.toggle('closed-spread', cols === 2);
}

// Where a cover lies on the stage (stage coordinates): as large as the page
// allows in the cover's own proportions; in two-page view it can't be wider
// than one page, and lies against the spine (right of it for the front,
// left of it for the back).
export function coverBox(stage, { w, h }, cols, side = 'front') {
  // (measured the way the pager is sized, so both draw it to the pixel)
  const box = stage.getBoundingClientRect();
  const W = Math.round(box.width), H = Math.round(box.height);
  const room = cols === 2 ? W / 2 : W;
  // (a few pixels short of the page height, so its shadow shows)
  let fh = H - 6, fw = ((H - 6) * w) / h;
  if (fw > room) { fw = room; fh = (room * h) / w; }
  fw = Math.round(fw); fh = Math.round(fh);
  const mid = Math.round(W / 2);
  const left = cols === 2 ? (side === 'back' ? mid - fw : mid) : Math.round((W - fw) / 2);
  return { left, top: Math.round((H - fh) / 2), width: fw, height: fh };
}

async function loadDoc(book, i) {
  const sec = book.spine.get(i);
  if (!sec) return null;
  try {
    const doc = await sec.load(book.load.bind(book));
    return { doc, sec, done: () => sec.unload?.() };
  } catch { return null; }
}

// Which part of the book is its front cover page, if any (index into the
// spine, or -1), worked out from the book itself before it's shown, so page
// turns to and from it can be chosen ahead of time.
export async function coverIndex(book) {
  for (const i of [0, 1]) {
    const got = await loadDoc(book, i);
    if (!got) break;
    const hit = findCover({ document: got.doc, sectionIndex: i, section: got.sec });
    got.done();
    if (hit) return i;
  }
  return -1;
}

// The back cover: the last part of the book, a single picture with no text
// that says it's the back cover (marked or named so) or is the same shape
// as the front cover. (Many books end on a single picture that isn't one, a
// logo or an advert, so it has to say so or match.)
export async function backCoverIndex(book, frontIndex = -1, frontSrc = null) {
  const items = book.spine.spineItems || [];
  let i = items.length - 1;
  while (i > 0 && items[i]?.linear === false) i--;
  if (i <= Math.max(0, frontIndex)) return -1;
  const got = await loadDoc(book, i);
  if (!got) return -1;
  const im = singleImage(got.doc);
  const body = got.doc.body || got.doc.querySelector('body');
  const bare = (body?.textContent || '').replace(/\s+/g, '').length <= 10;
  const said = !!got.doc.querySelector('[*|type~="backcover"]')
    || /back[-_ ]?cover|(^|[^a-z])back([^a-z]|$)/i.test(`${got.sec.href} ${im?.raw || ''}`);
  got.done();
  if (!im) return -1;
  if (said) return i;
  if (!bare || !frontSrc) return -1;
  const src = await imageUrl(book, i);
  if (!src) return -1;
  const [a, b] = await Promise.all([measure(frontSrc), measure(src)]);
  const ra = a.h / a.w, rb = b.h / b.w;
  return Math.abs(ra - rb) / ra < 0.08 ? i : -1;
}

// What a book has for covers: { front, frontSrc, back, backSrc, virtualBack }.
// A book with a front cover and no back cover of its own gets a plain one
// (virtualBack), placed just after its last part, so it closes at the end
// the way it opened. Its picture is made here: a board in the front
// cover's own color.
export async function coverPlan(book, { picture = true } = {}) {
  const front = await coverIndex(book);
  let frontSrc = await imageUrl(book, front);
  if (!frontSrc && front >= 0) { try { frontSrc = await book.coverUrl(); } catch { /* none */ } }
  let back = await backCoverIndex(book, front, frontSrc);
  let backSrc = await imageUrl(book, back);
  let virtualBack = false;
  if (back < 0 && front >= 0) {
    virtualBack = true;
    back = (book.spine.spineItems || []).length;
    backSrc = picture ? await plainBoard(frontSrc) : null;
  }
  return { front, frontSrc, back, backSrc, virtualBack };
}

// A plain back cover: the front cover's shape, in the color around its edges.
async function plainBoard(frontSrc) {
  const { w, h } = frontSrc ? await measure(frontSrc) : { w: 2, h: 3 };
  let color = [58, 54, 49];
  if (frontSrc) {
    try {
      const im = new Image();
      im.src = frontSrc;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = 40; c.height = 60;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0, 40, 60);
      const d = g.getImageData(0, 0, 40, 60).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 40; x++) {
          if (x > 2 && x < 37 && y > 2 && y < 57) continue; // the edges only
          const k = (y * 40 + x) * 4;
          r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++;
        }
      }
      color = [r / n, gg / n, b / n].map(Math.round);
    } catch { /* the plain board */ }
  }
  const W = 600, H = Math.round((600 * h) / w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${color.join(',')})`;
  g.fillRect(0, 0, W, H);
  // a little grain, and light falling from the top, so it reads as board
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,.05)');
  grad.addColorStop(1, 'rgba(0,0,0,.08)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * 10;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

// A blob URL for the picture on part i of the book (for showing a cover
// before its part has been opened), or null.
export async function imageUrl(book, i) {
  if (i == null || i < 0) return null;
  const got = await loadDoc(book, i);
  if (!got) return null;
  const im = singleImage(got.doc);
  const href = got.sec.href;
  got.done();
  if (!im?.raw) return null;
  try {
    const rel = new URL(im.raw, `http://book/${href}`).pathname.slice(1);
    return (await book.resources?.get(rel)) || null;
  } catch { return null; }
}
