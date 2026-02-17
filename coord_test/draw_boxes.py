import json
from pathlib import Path
from PIL import Image, ImageDraw

DIR = Path(__file__).parent

for json_file in sorted(DIR.glob("*.json")):
    image_file = json_file.with_suffix(".jpg")
    if not image_file.exists():
        print(f"Skipping {json_file.name}: no matching {image_file.name}")
        continue

    with open(json_file) as f:
        entries = json.load(f)

    img = Image.open(image_file)
    draw = ImageDraw.Draw(img)
    w, h = img.size

    for entry in entries:
        bb = entry["bounding_box"]
        x1 = bb["x1"] / 100 * w
        y1 = bb["y1"] / 100 * h
        x2 = bb["x2"] / 100 * w
        y2 = bb["y2"] / 100 * h

        draw.rectangle([x1, y1, x2, y2], outline="red", width=2)
        draw.text((x1, y1 - 12), entry["name"], fill="red")

    output_file = json_file.with_name(json_file.stem + "_boxes.jpg")
    img.save(output_file, quality=95)
    print(f"Saved {output_file.name}")
