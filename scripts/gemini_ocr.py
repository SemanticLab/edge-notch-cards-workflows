import argparse
import os
import sys
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
from google import genai
from google.genai import types

IMAGES_DIR = Path("/Volumes/GlumExpansion/edge-notch-cards-images")
# Cards whose images are not on the local drive are fetched from the public
# S3 copy the webapp serves from.
S3_IMAGES_URL = "https://semlab.s3.amazonaws.com/edge-notch-cards-workflow"
DATA_DIR = Path(__file__).parent.parent / "data"
FRONT_DIR = DATA_DIR / "front"
BACK_DIR = DATA_DIR / "back"

MODEL = "gemini-3-flash-preview"

FRONT_PROMPT = """Extract ONLY the typewritten text from the center of this index card image.
Reproduce the text in a plain text block that preserves the spatial layout of the original card as much as possible (line breaks, spacing, columns).

IGNORE all numbering systems, hole punch marks, notch patterns, and any printed codes around the perimeter/edges of the card. Only return the human-readable typewritten content in the central area.

Return the result as a JSON object with a single key "ocr_text" containing the extracted text as a string."""

BACK_PROMPT = """This is the back of a handwritten edge-notch index card. It contains handwritten entries in various ink colors (blue, black, red/pink, teal/green). Each entry is typically a person's name, sometimes preceded by a contact method (like "LETTER", "PHONE"), and often followed by a date (month/day format like "July 18" or "11/13").

Transcribe ALL the handwritten text you can read. Preserve the spatial layout as much as possible — line breaks, rough column positions, and the order entries appear on the card. Some cards have entries written in two columns or scattered across the surface.

IGNORE all hole punch marks, notch patterns, and perimeter markings. Only transcribe the handwritten content in the central area of the card.

Return the result as a JSON object with a single key "ocr_text" containing the transcribed text as a string."""

GENERATE_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(
        thinking_level="HIGH",
    ),
    response_mime_type="application/json",
    response_schema=genai.types.Schema(
        type=genai.types.Type.OBJECT,
        required=["ocr_text"],
        properties={
            "ocr_text": genai.types.Schema(type=genai.types.Type.STRING),
        },
    ),
)


def build_contents(img_bytes, prompt):
    """Build the contents list with image + prompt."""
    return [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(mime_type="image/jpeg", data=img_bytes),
                types.Part.from_text(text=prompt),
            ],
        ),
    ]


def load_image(img_path):
    """Read the image from disk, or fetch it from S3 if it is not local."""
    if img_path.exists():
        return img_path.read_bytes()
    url = f"{S3_IMAGES_URL}/{img_path.name}"
    req = urllib.request.Request(url, headers={"User-Agent": "edge-notch-cards-workflows/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def extract_ocr(img_path, prompt):
    """Send image to Gemini and return the OCR text."""
    client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI") or os.environ.get("GOOGLE_AI"))
    img_bytes = load_image(img_path)
    contents = build_contents(img_bytes, prompt)

    result_text = ""
    for chunk in client.models.generate_content_stream(
        model=MODEL,
        contents=contents,
        config=GENERATE_CONFIG,
    ):
        if chunk.text:
            result_text += chunk.text

    data = json.loads(result_text)
    return data.get("ocr_text", "")


def update_json(json_path, key, value):
    """Read a JSON file, add/update a key, write it back."""
    data = json.loads(json_path.read_text("utf-8"))
    data[key] = value
    tmp = json_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
    tmp.rename(json_path)


def process_one(item):
    """Process a single image. Returns (card_id, success, message, elapsed)."""
    img_path, json_path, ocr_key, prompt = item
    card_id = img_path.stem
    t0 = time.time()
    try:
        ocr_text = extract_ocr(img_path, prompt)
        update_json(json_path, ocr_key, ocr_text)
        preview = ocr_text[:80].replace("\n", " ")
        elapsed = time.time() - t0
        return (card_id, True, f"{preview}...", elapsed)
    except Exception as e:
        elapsed = time.time() - t0
        return (card_id, False, str(e), elapsed)


def main():
    parser = argparse.ArgumentParser(description="OCR card images with Gemini")
    parser.add_argument("-w", "--workers", type=int, default=4,
                        help="Number of parallel workers (default: 4)")
    parser.add_argument("--ids", nargs="*", default=None,
                        help="Only process these card IDs (default: every card missing OCR)")
    args = parser.parse_args()

    # Build work list from the card JSON files: (image_path, json_path, ocr_key, prompt).
    # Images are read from IMAGES_DIR when present, otherwise fetched from S3.
    card_ids = sorted(p.name[:-len("_front.json")] for p in FRONT_DIR.glob("*_front.json"))
    if args.ids:
        wanted = set(args.ids)
        card_ids = [c for c in card_ids if c in wanted]
    print(f"Cards considered: {len(card_ids)}")

    work = []
    for card_id in card_ids:
        json_path = FRONT_DIR / f"{card_id}_front.json"
        data = json.loads(json_path.read_text("utf-8"))
        if "ocr_front" not in data:
            work.append((IMAGES_DIR / f"{card_id}_front.jpg", json_path, "ocr_front", FRONT_PROMPT))

        json_path = BACK_DIR / f"{card_id}_back.json"
        if not json_path.exists():
            continue
        data = json.loads(json_path.read_text("utf-8"))
        if "ocr_back" not in data:
            work.append((IMAGES_DIR / f"{card_id}_back.jpg", json_path, "ocr_back", BACK_PROMPT))

    print(f"To process: {len(work)} (skipping cards that already have OCR)")
    print(f"Workers: {args.workers}")

    if not work:
        return

    done = 0
    errors = 0
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_one, item): item for item in work}

        for future in as_completed(futures):
            card_id, success, message, elapsed = future.result()
            done += 1
            if success:
                print(f"[{done}/{len(work)}] {card_id} OK ({elapsed:.1f}s) {message}",
                      flush=True)
            else:
                errors += 1
                print(f"[{done}/{len(work)}] {card_id} ERROR ({elapsed:.1f}s): {message}",
                      flush=True, file=sys.stderr)

    total_elapsed = time.time() - t_start
    print(f"Done. {done} processed, {errors} errors, {total_elapsed:.0f}s total.")


if __name__ == "__main__":
    main()
