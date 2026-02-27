import subprocess
from pathlib import Path

IMAGES_DIR = Path("/Volumes/GlumExpansion/edge-notch-cards-images")
OUTPUT_FILE = Path("fronts_ocr.txt")

fronts = sorted(IMAGES_DIR.glob("*_front.jpg"))
print(f"Found {len(fronts)} front images")

with open(OUTPUT_FILE, "w") as out:
    for i, img in enumerate(fronts, 1):
        result = subprocess.run(
            ["tesseract", str(img), "stdout"],
            capture_output=True, text=True
        )
        text = result.stdout.strip()
        escaped = text.replace("\\", "\\\\").replace("\n", "\\n").replace("\t", "\\t")
        out.write(f"{img.stem}\t{escaped}\n")

        if i % 50 == 0:
            print(f"Progress: {i}/{len(fronts)}")

print(f"Done. Wrote {len(fronts)} lines to {OUTPUT_FILE}")
