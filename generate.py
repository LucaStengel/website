#!/usr/bin/env python3
"""
generate.py — Luca Stengel photography website generator

Neues Projekt anlegen:
  1. Ordner in  projects/  anlegen, z.B.  projects/NewTrip/
  2. Originalbilder (.jpg, .jpeg, .png, .webp) hineinlegen
  3.  meta.txt  im Ordner anlegen:

       title: New Trip
       description: Ein, zwei Sätze — erscheinen auf der Startseite beim Hover.
       year: 2025                   (optional)
       location: Panama             (optional)
       cover: best-photo.jpg        (optional — sonst das erste Bild)
       order: 4                     (optional — kleinste Zahl zuerst)

  4.  python3 optimize.py     (verkleinert die Bilder nach media/)
  5.  python3 generate.py     (baut index.html + die Projektseiten)

Ausgeliefert wird nur  media/  — die Originale in  projects/  bleiben lokal.
"""

import html
import json
import re
from pathlib import Path

PROJECTS_DIR = Path("projects")
MEDIA_DIR = Path("media")
MANIFEST = MEDIA_DIR / "manifest.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}

SITE_NAME = "Luca Stengel"
TAGLINE = "Photography"
EMAIL = "info@lucastengel.com"

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '    <link href="https://fonts.googleapis.com/css2?'
    "family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&"
    'family=Inter:wght@200;300;400&display=swap" rel="stylesheet">'
)


# ─── Helpers ────────────────────────────────────────────────────────────────


def esc(text: str) -> str:
    return html.escape(text or "", quote=True)


def slugify(name: str) -> str:
    name = (
        name.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
        .replace("Ä", "ae").replace("Ö", "oe").replace("Ü", "ue").replace("ß", "ss")
    )
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def read_meta(project_dir: Path) -> dict:
    meta = {
        "title": project_dir.name.replace("-", " ").replace("_", " "),
        "description": "",
        "year": "",
        "location": "",
        "cover": None,
        "feature": "",
        "order": 999,
    }
    meta_file = project_dir / "meta.txt"
    if not meta_file.exists():
        return meta
    for line in meta_file.read_text(encoding="utf-8").splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            k, v = key.strip().lower(), val.strip()
            if k == "order":
                try:
                    meta[k] = int(v)
                except ValueError:
                    pass
            elif k in meta:
                meta[k] = v
    return meta


def get_images(project_dir: Path) -> list:
    return sorted(
        f.name
        for f in project_dir.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )


def picture(entry: dict, sizes_attr: str, alt: str,
            eager: bool = False, priority: bool = False) -> str:
    """<picture> mit WebP-srcset und JPEG-Fallback."""
    d, stem = entry["dir"], entry["stem"]
    srcset = ", ".join(f'{d}/{stem}-{s["long"]}.webp {s["w"]}w' for s in entry["sizes"])
    fallback = f'{d}/{stem}-{entry["fallback_long"]}.jpg'
    loading = "eager" if eager else "lazy"
    priority = ' fetchpriority="high"' if priority else ""
    return (
        f'<picture>'
        f'<source type="image/webp" srcset="{srcset}" sizes="{sizes_attr}">'
        f'<img src="{fallback}" alt="{esc(alt)}" '
        f'width="{entry["width"]}" height="{entry["height"]}" '
        f'loading="{loading}" decoding="async"{priority}>'
        f'</picture>'
    )


def compose(images: list, entries: dict, features: set) -> list:
    """Verteilt die Bilder auf Blöcke — der Rhythmus einer Doppelseite.

    Ergibt eine Folge aus:
      full          ein Querformat über die volle Breite (Auftakt, Betonung)
      pair          zwei Bilder nebeneinander, gleiche Höhe
      offset-left   ein Bild links, rechts bleibt Schwarz
      offset-right  ein Bild rechts, links bleibt Schwarz

    Hochformate stehen nie über die volle Breite und werden, wenn zwei
    aufeinanderfolgen, immer gepaart.
    """
    PORTRAIT, WIDE, PANORAMA = 0.95, 1.1, 2.4
    MAX_PAIR_CONTRAST = 2.2  # sonst schrumpft das eine Bild neben dem anderen weg
    rhythm = ["pair", "offset-right", "full", "pair", "offset-left", "pair"]

    def fits_together(x, y):
        return max(x, y) / min(x, y) <= MAX_PAIR_CONTRAST

    aspect = {n: entries[n]["width"] / entries[n]["height"] for n in images}
    queue = list(images)
    blocks = []
    step = 0
    side = "offset-right"

    while queue:
        name = queue[0]
        a = aspect[name]

        # Auftakt: das erste Bild steht immer allein und gross
        if not blocks:
            blocks.append(("full" if a >= WIDE else "offset-left", [queue.pop(0)]))
            continue

        # In meta.txt markierte Bilder bekommen ihren eigenen Auftritt
        if name in features:
            blocks.append(("full" if a >= WIDE else side, [queue.pop(0)]))
            side = "offset-left" if side == "offset-right" else "offset-right"
            continue

        # Panoramen wirken nur über die volle Breite
        if a >= PANORAMA:
            blocks.append(("full", [queue.pop(0)]))
            continue

        # Zwei Hochformate hintereinander gehören nebeneinander
        if len(queue) > 1 and a < PORTRAIT and aspect[queue[1]] < PORTRAIT:
            blocks.append(("pair", [queue.pop(0), queue.pop(0)]))
            continue

        kind = rhythm[step % len(rhythm)]
        step += 1

        if kind == "pair" and len(queue) > 1 and fits_together(a, aspect[queue[1]]):
            blocks.append(("pair", [queue.pop(0), queue.pop(0)]))
        elif kind == "full" and a >= WIDE:
            blocks.append(("full", [queue.pop(0)]))
        else:
            blocks.append((side, [queue.pop(0)]))
            side = "offset-left" if side == "offset-right" else "offset-right"

    return blocks


def full_src(entry: dict) -> str:
    largest = max(entry["sizes"], key=lambda s: s["long"])
    return f'{entry["dir"]}/{entry["stem"]}-{largest["long"]}.webp'


def head(title: str, css: str, description: str = "") -> str:
    desc = esc(description or f"Photography by {SITE_NAME}.")
    return f"""<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{esc(title)}</title>
    <meta name="description" content="{desc}">
    <meta name="theme-color" content="#0a0a0b">
    <link rel="stylesheet" href="base.css">
    <link rel="stylesheet" href="{css}">
    {FONTS}
</head>"""


def site_header(active: str = "") -> str:
    def cls(name):
        return ' class="is-current"' if name == active else ""

    return f"""    <header class="site-header">
        <a class="wordmark" href="index.html">{SITE_NAME}</a>
        <nav class="nav-links" id="nav">
            <a href="index.html"{cls('work')}>Work</a>
            <a href="aboutme.html"{cls('about')}>About</a>
            <a href="mailto:{EMAIL}">Contact</a>
        </nav>
        <button class="hamburger" id="hamburger" aria-label="Menu" aria-expanded="false">
            <span></span><span></span><span></span>
        </button>
    </header>"""


# Die wandernden Wellenebenen des Hintergrunds. Jeder Zug läuft doppelt,
# versetzt und überblendend — siehe base.css.
BACKDROP = """    <div class="backdrop" aria-hidden="true">
        <span class="wave wave-a1"></span>
        <span class="wave wave-a2"></span>
        <span class="wave wave-b1"></span>
        <span class="wave wave-b2"></span>
    </div>"""


NAV_SCRIPT = """    <script>
        const burger = document.getElementById('hamburger');
        burger.addEventListener('click', () => {
            const open = document.body.classList.toggle('nav-open');
            burger.setAttribute('aria-expanded', open);
        });
    </script>"""


# ─── Projektseite ───────────────────────────────────────────────────────────


def generate_project_page(slug, meta, entries, images, position, total, neighbours):
    features = {f.strip() for f in meta["feature"].split(",") if f.strip()}
    blocks = compose(images, entries, features)

    # Kein Bild wird höher als das Fenster — dafür begrenzt die Breite die Höhe
    HEIGHT_CAP = {"full": 88, "pair": 76, "offset-left": 84, "offset-right": 84}

    # Wie breit das Bild tatsächlich dargestellt wird. Danach sucht der Browser
    # die passende Stufe aus dem srcset — auf Retina-Displays die doppelte
    # Pixelzahl. Der Inhalt ist auf 1500px inkl. Rand begrenzt, ab etwa
    # 1650px Fensterbreite wächst also nichts mehr mit.
    SIZES = {
        "full":   "(min-width: 1650px) 1360px, (max-width: 900px) 100vw, 90vw",
        "wide":   "(min-width: 1650px) 880px, (max-width: 900px) 100vw, 58vw",
        "narrow": "(min-width: 1650px) 610px, (max-width: 900px) 100vw, 40vw",
        "pair":   "(min-width: 1650px) 700px, (max-width: 900px) 100vw, 46vw",
    }

    def tile(entry, kind, in_pair, eager=False):
        a = entry["width"] / entry["height"]
        style = f"--aspect:{a:.4f};max-width:calc({HEIGHT_CAP[kind]}svh * {a:.4f})"
        if in_pair:
            style += f";flex-grow:{a:.4f}"
            key = "pair"
        elif kind == "full":
            key = "full"
        else:
            key = "narrow" if a < 1 else "wide"
        return (
            f'<button class="tile" style="{style}" '
            f'data-full="{full_src(entry)}" aria-label="Bild öffnen">'
            f'{picture(entry, SIZES[key], meta["title"], eager=eager)}'
            f'</button>'
        )

    parts = []
    for b, (kind, names) in enumerate(blocks):
        # Das Auftaktbild steht sichtbar oben — es wird sofort geladen,
        # alles Weitere erst beim Heranscrollen
        inner = "".join(
            tile(entries[n], kind, len(names) > 1, eager=(b == 0 and j == 0))
            for j, n in enumerate(names)
        )
        portrait = entries[names[0]]["width"] < entries[names[0]]["height"]
        narrow = " narrow" if portrait and kind.startswith("offset") else ""
        parts.append(f'<div class="block {kind}{narrow}">{inner}</div>')

    tile_html = "\n            ".join(parts)

    meta_bits = [f"{len(images)} photographs"]
    if meta["location"]:
        meta_bits.insert(0, meta["location"])
    if meta["year"]:
        meta_bits.append(meta["year"])
    meta_line = " &nbsp;·&nbsp; ".join(esc(b) for b in meta_bits)

    prev_p, next_p = neighbours
    nav_items = []
    if prev_p:
        nav_items.append(
            f'<a class="project-nav-link prev" href="{prev_p[0]}.html">'
            f'<span class="label">Previous</span>'
            f'<span class="name">{esc(prev_p[1])}</span></a>'
        )
    if next_p:
        nav_items.append(
            f'<a class="project-nav-link next" href="{next_p[0]}.html">'
            f'<span class="label">Next</span>'
            f'<span class="name">{esc(next_p[1])}</span></a>'
        )

    lede = (
        f'<p class="lede">{esc(meta["description"])}</p>'
        if meta["description"]
        else ""
    )

    html_out = f"""<!DOCTYPE html>
<html lang="en">
{head(f'{meta["title"]} — {SITE_NAME}', "project.css", meta["description"])}
<body class="project-page">
{site_header('work')}
{BACKDROP}

    <main>
        <div class="project-intro">
            <p class="eyebrow">{position:02d} / {total:02d} &nbsp;·&nbsp; {meta_line}</p>
            <h1>{esc(meta['title'])}</h1>
            {lede}
        </div>

        <div class="gallery" id="gallery">
            {tile_html}
        </div>

        <nav class="project-nav">
            {"".join(nav_items)}
        </nav>
    </main>

    <footer class="site-footer">
        <a href="mailto:{EMAIL}">{EMAIL}</a>
        <span>&copy; {SITE_NAME}</span>
    </footer>

    <div id="lightbox" class="lightbox" hidden>
        <button class="lb-close" id="lb-close" aria-label="Close">&times;</button>
        <button class="lb-nav lb-prev" id="lb-prev" aria-label="Previous">&#8249;</button>
        <img id="lightbox-img" src="" alt="">
        <button class="lb-nav lb-next" id="lb-next" aria-label="Next">&#8250;</button>
        <div class="lb-counter" id="lb-counter"></div>
    </div>

    <script src="project.js"></script>
{NAV_SCRIPT}
</body>
</html>
"""

    Path(f"{slug}.html").write_text(html_out, encoding="utf-8")
    print(f"  ✓  {slug}.html  ({len(images)} Bilder)")


# ─── Startseite ─────────────────────────────────────────────────────────────


def generate_index(projects: list) -> None:
    items = []
    for i, p in enumerate(projects):
        meta, cover = p["meta"], p["cover"]
        detail = [f'{p["count"]} photographs']
        if meta["location"]:
            detail.insert(0, meta["location"])
        detail_line = " &nbsp;·&nbsp; ".join(esc(d) for d in detail)
        blurb = esc(meta["description"])

        items.append(
            f"""            <li class="project-item" data-index="{i}">
                <figure class="item-media">
                    {picture(cover, "(min-width: 1500px) 560px, 38vw", meta["title"])}
                </figure>
                <a class="item-link" href="{p['slug']}.html">
                    <span class="num">{i + 1:02d}</span>
                    <span class="title">{esc(meta['title'])}</span>
                    <span class="year">{esc(meta['year'])}</span>
                </a>
                <div class="item-blurb">
                    <p>{blurb}</p>
                    <p class="detail">{detail_line}</p>
                </div>
            </li>"""
        )

    html_out = f"""<!DOCTYPE html>
<html lang="en">
{head(SITE_NAME, "index.css")}
<body class="index-page">
{site_header('work')}
{BACKDROP}

    <!-- Bühne für die Titelbilder — bewusst ausserhalb der Liste, damit sie
         sich immer aufs Fenster bezieht. index.js hängt die Bilder hier ein. -->
    <div class="stage" id="stage" aria-hidden="true" hidden></div>

    <main class="index" id="index">
        <div class="index-intro">
            <h1>{SITE_NAME}</h1>
            <p>{TAGLINE}</p>
        </div>

        <ol class="project-index" id="project-index">
{chr(10).join(items)}
        </ol>
    </main>

    <footer class="site-footer">
        <a href="mailto:{EMAIL}">{EMAIL}</a>
        <span>&copy; {SITE_NAME}</span>
    </footer>

    <script src="index.js"></script>
{NAV_SCRIPT}
</body>
</html>
"""

    Path("index.html").write_text(html_out, encoding="utf-8")
    print(f"  ✓  index.html  ({len(projects)} Projekte)")


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> None:
    if not MANIFEST.exists():
        print("media/manifest.json fehlt — bitte zuerst  python3 optimize.py  laufen lassen.")
        return

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    project_dirs = sorted(d for d in PROJECTS_DIR.iterdir() if d.is_dir())

    projects = []
    for d in project_dirs:
        meta = read_meta(d)
        images = [n for n in get_images(d) if n in manifest.get(d.name, {})]
        if not images:
            print(f"  übersprungen: {d.name} — keine optimierten Bilder (optimize.py?)")
            continue
        cover_name = meta["cover"] if meta["cover"] in images else images[0]
        projects.append({
            "slug": slugify(meta["title"]),
            "meta": meta,
            "dir": d,
            "images": images,
            "entries": manifest[d.name],
            "cover": manifest[d.name][cover_name],
            "count": len(images),
        })

    if not projects:
        print("Keine Projekte gefunden.")
        return

    projects.sort(key=lambda p: (p["meta"]["order"], p["meta"]["title"]))

    print("Baue Seiten ...\n")
    total = len(projects)
    for i, p in enumerate(projects):
        prev_p = (projects[i - 1]["slug"], projects[i - 1]["meta"]["title"]) if i > 0 else None
        next_p = (projects[i + 1]["slug"], projects[i + 1]["meta"]["title"]) if i < total - 1 else None
        generate_project_page(
            p["slug"], p["meta"], p["entries"], p["images"], i + 1, total, (prev_p, next_p)
        )

    generate_index(projects)
    print(f"\nFertig — {total} Projekt(e).")
    print("Vorschau:  python3 -m http.server 3000")


if __name__ == "__main__":
    main()
