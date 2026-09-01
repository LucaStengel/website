#!/usr/bin/env python3
"""
optimize.py — erzeugt web-optimierte Bildversionen

Liest die Originale aus  projects/<Projekt>/  (und ein paar Einzelbilder aus
assets/) und schreibt daraus verkleinerte WebP-Varianten + ein JPEG-Fallback
nach  media/ .  Nur der Inhalt von  media/  wird von der Website ausgeliefert —
die Originale bleiben lokal.

  python3 optimize.py            # nur was fehlt / neuer ist wird gerechnet
  python3 optimize.py --force    # alles neu

Danach:  python3 generate.py
"""

import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROJECTS_DIR = Path("projects")
MEDIA_DIR = Path("media")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}

# Lange Kante in px. Der Browser lädt aus dieser Leiter genau die Stufe, die
# er für seine Anzeigegrösse braucht — auf Retina-Displays also die doppelte
# Pixelzahl der dargestellten Breite. 3200 ist die Reserve für die Lightbox
# auf grossen Bildschirmen, 480 die kleinste Vorschau.
SIZES = [480, 960, 1440, 2048, 2560, 3200]
FALLBACK_SIZE = 960          # als JPEG, für Browser ohne WebP
WEBP_QUALITY = 82
JPEG_QUALITY = 82

SRGB_PROFILE = "/System/Library/ColorSync/Profiles/sRGB Profile.icc"

# Einzelbilder ausserhalb von projects/ (Portrait, Hintergrund, ...)
EXTRA_IMAGES = {
    "site/portrait": Path("assets/AboutMe/luca.jpg"),
}

FORCE = "--force" in sys.argv


def run(cmd: list) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def slugify(name: str) -> str:
    name = (
        name.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
        .replace("Ä", "ae").replace("Ö", "oe").replace("Ü", "ue").replace("ß", "ss")
    )
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def dimensions(path: Path) -> tuple:
    out = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    w = int(re.search(r"pixelWidth:\s*(\d+)", out).group(1))
    h = int(re.search(r"pixelHeight:\s*(\d+)", out).group(1))
    return w, h


def up_to_date(src: Path, targets: list) -> bool:
    if FORCE:
        return False
    src_mtime = src.stat().st_mtime
    return all(t.exists() and t.stat().st_mtime >= src_mtime for t in targets)


def process(src: Path, out_dir: Path, stem: str) -> dict:
    """Erzeugt alle Grössen für ein Bild und liefert die Manifest-Daten."""
    out_dir.mkdir(parents=True, exist_ok=True)

    orig_w, orig_h = dimensions(src)
    long_edge = max(orig_w, orig_h)
    sizes = [s for s in SIZES if s < long_edge] + [min(long_edge, max(SIZES))]
    sizes = sorted(set(sizes))

    variants = []
    for s in sizes:
        scale = s / long_edge
        variants.append((s, max(1, round(orig_w * scale)), max(1, round(orig_h * scale))))

    webp_targets = [out_dir / f"{stem}-{s}.webp" for s, _, _ in variants]
    jpg_target = out_dir / f"{stem}-{FALLBACK_SIZE}.jpg"

    entry = {
        "stem": stem,
        "dir": out_dir.as_posix(),
        "width": orig_w,
        "height": orig_h,
        "sizes": [{"w": w, "h": h, "long": s} for s, w, h in variants],
        "fallback_long": min(FALLBACK_SIZE, max(s for s, _, _ in variants)),
    }

    if up_to_date(src, webp_targets + [jpg_target]):
        return entry

    # Einmal auf max. Grösse + sRGB runterrechnen, alle weiteren Grössen aus
    # diesem Zwischenbild — das Original wird so nur ein einziges Mal dekodiert.
    base = out_dir / f".{stem}-base.jpg"
    base_long = max(s for s, _, _ in variants)
    cmd = ["sips", "-Z", str(base_long), "-s", "format", "jpeg",
           "-s", "formatOptions", "95"]
    if Path(SRGB_PROFILE).exists():
        cmd += ["--matchTo", SRGB_PROFILE]
    run(cmd + [str(src), "--out", str(base)])

    for (s, w, h), target in zip(variants, webp_targets):
        # -m 6      gründlichere Suche: kleinere Datei bei gleicher Qualität
        # -sharp_yuv sauberere Farbkanten, sichtbar an feinen Strukturen
        run(["cwebp", "-quiet", "-q", str(WEBP_QUALITY), "-m", "6", "-sharp_yuv",
             "-metadata", "none", "-resize", str(w), str(h), str(base), "-o", str(target)])

    fb_long = entry["fallback_long"]
    run(["sips", "-Z", str(fb_long), "-s", "format", "jpeg",
         "-s", "formatOptions", str(JPEG_QUALITY), str(base), "--out", str(jpg_target)])

    base.unlink(missing_ok=True)
    return entry


def collect_jobs() -> list:
    jobs = []

    for project_dir in sorted(d for d in PROJECTS_DIR.iterdir() if d.is_dir()):
        slug = slugify(project_dir.name)
        images = sorted(
            f for f in project_dir.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
        )
        for img in images:
            jobs.append((img, MEDIA_DIR / slug, slugify(img.stem), project_dir.name))

    for key, src in EXTRA_IMAGES.items():
        if src.exists():
            sub, _, stem = key.rpartition("/")
            jobs.append((src, MEDIA_DIR / sub, stem, "assets"))

    return jobs


def main() -> None:
    if not PROJECTS_DIR.exists():
        print(f"{PROJECTS_DIR}/ nicht gefunden")
        return

    jobs = collect_jobs()
    if not jobs:
        print("Keine Bilder gefunden.")
        return

    print(f"{len(jobs)} Bild(er) werden optimiert nach {MEDIA_DIR}/ ...\n")

    manifest = {}
    done = 0

    def work(job):
        src, out_dir, stem, group = job
        entry = process(src, out_dir, stem)
        entry["source"] = src.as_posix()
        return group, src.name, entry

    with ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 4))) as pool:
        for group, name, entry in pool.map(work, jobs):
            manifest.setdefault(group, {})[name] = entry
            done += 1
            print(f"  [{done}/{len(jobs)}]  {group}/{name}")

    MEDIA_DIR.mkdir(exist_ok=True)
    (MEDIA_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    total = sum(f.stat().st_size for f in MEDIA_DIR.rglob("*") if f.is_file())
    print(f"\nFertig — {done} Bild(er), {total / 1_048_576:.0f} MB in {MEDIA_DIR}/")
    print("Jetzt:  python3 generate.py")


if __name__ == "__main__":
    main()
