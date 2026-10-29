#!/usr/bin/env python3
"""Build the Claude artifact version of the site from index.html.

The repository's index.html is the source of truth. The artifact needs:
  * no <!doctype>/<html>/<head>/<body> wrappers (the viewer adds them),
  * the banner image embedded as a data URI (artifacts cannot load hero.webp).

Usage: python3 tools/make-artifact.py [output.html]
"""
import base64, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
head = html.split("<head>", 1)[1].split("</head>", 1)[0]
body = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
head = re.sub(r'\s*<meta charset="utf-8">', "", head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', "", head)
head = head.replace("</title>", '</title>\n<meta name="claude:viewport-fit-sides" content="cover">', 1)
uri = "data:image/webp;base64," + base64.b64encode((root / "hero.webp").read_bytes()).decode()
head, n = re.subn(r'url\("hero\.webp"\)', f'url("{uri}")', head)
if n != 1:
    sys.exit("hero.webp reference not found in index.html")
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "artifact.html"
out.write_text(head.strip() + "\n" + body.strip() + "\n", encoding="utf-8")
print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")
