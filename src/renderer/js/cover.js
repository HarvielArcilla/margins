// A book's cover, shown as a cover: the closed book lying on the desk, in
// the cover image's own proportions, rather than an image set inside a page
// with margins around it. In two-page view it sits where a closed book
// would, on the right of the spine.
//
// Shared by the reader and the offscreen pager (which pictures pages for
// page turns), so a turn to or from the cover shows exactly what's on screen.

// Is this section the book's cover page? Returns its image, or null.
// A cover page is the first part of the book (or one marked as the cover)
// holding a single picture and next to no text.
export function findCover(contents) {
  const doc = contents?.document;
  const body = doc?.body || doc?.querySelector?.('body');
  if (!body) return null;
  const idx = contents.sectionIndex ?? 99;
  const marked = !!doc.querySelector('[*|type~="cover"], [role="doc-cover"]');
  const named = /(^|[^a-z])cover/i.test(contents.section?.href || doc.baseURI || '');
  if (idx > 1 && !marked) return null;
  if (idx === 1 && !marked && !named) return null;
  const imgs = [...doc.querySelectorAll('img')];
  const svgImgs = [...doc.querySelectorAll('svg image')];
  if (imgs.length + svgImgs.length !== 1) return null;
  const text = (body.textContent || '').replace(/\s+/g, '');
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
  return src ? { src, alt } : null;
}

// The cover image's size, once it has loaded.
const sizes = new Map();
function measure(src) {
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

// Show the cover on the stage (or take it away, with cover = null).
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
  const img = face.firstChild;
  if (img.getAttribute('src') !== cover.src) {
    img.src = cover.src;
    img.alt = cover.alt || 'Cover';
    try { await img.decode(); } catch { /* shown when it arrives */ }
  }
  // as large as the page allows in the cover's own proportions; in two-page
  // view it can't be wider than one page
  // (measured the way the pager is sized, so both draw it to the pixel)
  const box = stage.getBoundingClientRect();
  const W = Math.round(box.width), H = Math.round(box.height);
  const room = cols === 2 ? W / 2 : W;
  // (a few pixels short of the page height, so its shadow shows)
  let fh = H - 6, fw = ((H - 6) * w) / h;
  if (fw > room) { fw = room; fh = (room * h) / w; }
  fw = Math.round(fw); fh = Math.round(fh);
  const left = cols === 2 ? Math.round(W / 2) : Math.round((W - fw) / 2);
  Object.assign(face.style, { left: `${left}px`, top: `${Math.round((H - fh) / 2)}px`, width: `${fw}px`, height: `${fh}px` });
  face.hidden = false;
  stage.classList.add('closed');
  stage.classList.toggle('closed-spread', cols === 2);
}

// Which part of the book is its cover page, if any (index into the spine,
// or -1), worked out from the book itself before it's shown, so page turns
// to and from it can be chosen ahead of time.
export async function coverIndex(book) {
  for (const i of [0, 1]) {
    const sec = book.spine.get(i);
    if (!sec) break;
    try {
      const doc = await sec.load(book.load.bind(book));
      const hit = findCover({ document: doc, sectionIndex: i, section: sec });
      sec.unload?.();
      if (hit) return i;
    } catch { /* unreadable: no cover */ }
  }
  return -1;
}
