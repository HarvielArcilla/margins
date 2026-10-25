#!/usr/bin/env python3
"""Builds a small EPUB 3 sampler for trying out Margins's features.

Usage: python3 scripts/make-sample-epub.py samples/sample.epub
"""
import random
import sys
import uuid
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

TITLE = "A Reader's Sampler"
AUTHOR = "Margins"

SENTENCES = [
    "The lamp on the desk threw a soft circle of light across the open pages.",
    "Outside, the rain kept a patient rhythm on the slate roof, as if counting the hours for her.",
    "She turned the page slowly, the way one opens a door into a room that has been closed for years.",
    "Every margin held a small conversation: a question, a correction, a single underlined word.",
    "It is a curious thing that a line of type can hold a voice long after the speaker is gone.",
    "The harbour lights came on one by one, and the boats settled into their moorings for the night.",
    "He had promised himself a single chapter, and then another, and then the clock struck two.",
    "Somewhere a kettle began to sing, thin and insistent, from the kitchen at the end of the hall.",
    "Good typography disappears; what remains is the story, carried along on an even tide of words.",
    "Long lines tire the eye, while short ones break the thought before it has finished breathing.",
    "The map was older than the house, its coastline drawn by someone who had clearly never seen the sea.",
    "They walked along the ridge until the valley opened beneath them, green and impossibly quiet.",
    "A good bookmark is a promise that the story will be waiting exactly where you left it.",
    "In the library the silence had a texture, like velvet, broken only by the turning of pages.",
    "Her notes grew denser toward the end, as though the book had started arguing back.",
    "The train slowed for the bridge, and for a moment the whole river was framed in the window.",
    "Nothing in the letter was surprising, and yet she read it three times before folding it away.",
    "Words, she thought, are only marks on paper until someone agrees to be moved by them.",
]

CHAPTERS = [
    ("The Lamp and the Rain", None),
    ("On Margins", "quote"),
    ("A List of Small Pleasures", "list"),
    ("The Harbour at Night", "poem"),
    ("Notes Toward an Ending", "dialogue"),
    ("Afterword", None),
]


def paragraphs(rng, n):
    out = []
    for _ in range(n):
        out.append(" ".join(rng.sample(SENTENCES, rng.randint(4, 7))))
    return out


def chapter_html(i, title, extra, rng):
    body = [f'<h1 id="c{i}">{escape(title)}</h1>']
    paras = paragraphs(rng, 14)
    for j, p in enumerate(paras):
        if j == 3 and extra == "quote":
            body.append('<blockquote><p>“The margin is where the reader writes back.” — an old saying among booksellers</p></blockquote>')
        if j == 4 and extra == "list":
            body.append("<ul><li>The first page of a new book</li><li>A pencil that is exactly sharp enough</li>"
                        "<li>Rain on a window during a long chapter</li><li>Finding a note from a previous reader</li></ul>")
        if j == 2 and extra == "poem":
            body.append('<div class="verse center"><p>The lights go down along the quay,</p><p>the gulls fold up their quarrel,</p>'
                        '<p>and every boat remembers sea</p><p>the way a book remembers laurel.</p></div>')
        if j == 5 and extra == "dialogue":
            body.append("<p>“Did you finish it?” he asked.</p><p>“Almost,” she said. “I am saving the last page.”</p>"
                        "<p>“For what?”</p><p>“For when I am ready to let it go.”</p>")
        if j == 7:
            body.append(f"<h2>Part {j // 7 + 1}</h2>")
        emph = p.replace("curious", "<em>curious</em>").replace("promise", "<strong>promise</strong>")
        body.append(f"<p>{emph}</p>")
    if i == 1:
        body.insert(1, '<figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 160" width="100%">'
                       '<rect width="400" height="160" rx="12" fill="#e8dcc4"/><circle cx="320" cy="50" r="26" fill="#f2b84b"/>'
                       '<path d="M0 130 Q100 70 200 120 T400 110 V160 H0z" fill="#7a8f6a"/></svg>'
                       '<figcaption>A small illustration.</figcaption></figure>')
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>{escape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section epub:type="chapter">
{chr(10).join(body)}
</section></body></html>"""


def main(out):
    rng = random.Random(7)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    book_id = f"urn:uuid:{uuid.UUID(int=rng.getrandbits(128))}"
    files = {}
    files["OEBPS/style.css"] = ("body { font-family: serif; } h1 { text-align: center; margin: 2em 0 1em; } "
                                ".center { text-align: center; } .verse p { text-indent: 0; margin: 0; font-style: italic; } "
                                "figure { margin: 1em 0; text-align: center; } figcaption { font-size: .85em; }")
    manifest, spine, nav = [], [], []
    for i, (title, extra) in enumerate(CHAPTERS, 1):
        name = f"chapter{i}.xhtml"
        files[f"OEBPS/{name}"] = chapter_html(i, title, extra, rng)
        manifest.append(f'<item id="c{i}" href="{name}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{i}"/>')
        nav.append(f'<li><a href="{name}">{escape(title)}</a></li>')
    files["OEBPS/nav.xhtml"] = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{''.join(nav)}</ol></nav></body></html>"""
    files["OEBPS/content.opf"] = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">{book_id}</dc:identifier><dc:title>{TITLE}</dc:title><dc:creator>{AUTHOR}</dc:creator>
<dc:language>en</dc:language><dc:description>A short sampler for trying fonts, spacing, highlights and page turns.</dc:description>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>{''.join(manifest)}</manifest>
<spine>{''.join(spine)}</spine></package>"""
    files["META-INF/container.xml"] = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"""
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for path, data in files.items():
            z.writestr(path, data, compress_type=zipfile.ZIP_DEFLATED)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "samples/sample.epub")
