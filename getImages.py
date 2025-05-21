import os
from PIL import Image

# Ordner mit deinen JPEGs
image_folder = "assets/Panama"  # Passe diesen Pfad an
output_file = "gallery.html"    # Optional: direkt in HTML-Datei speichern

# Liste aller JPG-Dateien im Ordner
image_files = [f for f in os.listdir(image_folder) if f.lower().endswith(".jpg")]

html_lines = []

for filename in sorted(image_files):
    filepath = os.path.join(image_folder, filename)
    try:
        with Image.open(filepath) as img:
            width, height = img.size
            orientation = "horizontal" if width >= height else "vertical"
            html_line = f'<img src="{image_folder}/{filename}" class="{orientation}" alt="{orientation}">'
            html_lines.append(html_line)
    except Exception as e:
        print(f"Fehler bei {filename}: {e}")

# Optional: HTML-Ausgabe speichern
with open(output_file, "w") as f:
    f.write('\n'.join(html_lines))

# Ausgabe für Copy-Paste:
print("\n".join(html_lines))
