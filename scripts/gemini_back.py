import os
import sys
import json
import time
from pathlib import Path
from google import genai
from google.genai import types

IMAGES_DIR = Path("/Volumes/GlumExpansion/edge-notch-cards-images")
OUTPUT_DIR = Path(__file__).parent / "data" / "back"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI"))
MODEL = "gemini-3-flash-preview"

PROMPT = """This is an image of a card with a number of names on it in English cursive writing. Each name may have some method of contact metadata (like "letter" or "phone", etc) and they may have a the date of contact and other metadata.
Return a JSON response which includes:
"name": <name of person>,
"name_other": <if a corporate name or organization name is also included>,
"contact_method": <letter, phone, etc>,
"date": <date associated with name, convert to format YYYY-MM-DD if parts are not listed like Year use "XXXX">
"other_metadata": <anything else associated with that name>
"bounding_box": <a obj with "x1", "y1", and "x2", "y2" that are percentages that represent the top left and bottom right bounding box of the name appearance on the card, use PERCENTAGES so the coords are transferable to other resolutions>

The names may appear in multiple columns or even vertically written. bounding_box percentage number can never be over 100!

Return the data as a JSON object with an 'entries' key containing the list of people.
"""

GENERATE_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(
        thinking_level="HIGH",
    ),
    response_mime_type="application/json",
    response_schema=genai.types.Schema(
        type=genai.types.Type.OBJECT,
        required=["entries"],
        properties={
            "entries": genai.types.Schema(
                type=genai.types.Type.ARRAY,
                items=genai.types.Schema(
                    type=genai.types.Type.OBJECT,
                    required=["name", "bounding_box"],
                    properties={
                        "name": genai.types.Schema(type=genai.types.Type.STRING),
                        "name_other": genai.types.Schema(type=genai.types.Type.STRING),
                        "contact_method": genai.types.Schema(type=genai.types.Type.STRING),
                        "date": genai.types.Schema(type=genai.types.Type.STRING),
                        "other_metadata": genai.types.Schema(type=genai.types.Type.STRING),
                        "bounding_box": genai.types.Schema(
                            type=genai.types.Type.OBJECT,
                            required=["x1", "y1", "x2", "y2"],
                            properties={
                                "x1": genai.types.Schema(type=genai.types.Type.NUMBER),
                                "y1": genai.types.Schema(type=genai.types.Type.NUMBER),
                                "x2": genai.types.Schema(type=genai.types.Type.NUMBER),
                                "y2": genai.types.Schema(type=genai.types.Type.NUMBER),
                            },
                        ),
                    },
                ),
            ),
        },
    ),
)


def build_contents(img_bytes):
    """Build the contents list with image + prompt."""
    return [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(mime_type="image/jpeg", data=img_bytes),
                types.Part.from_text(text=PROMPT),
            ],
        ),
    ]


def main():
    backs = sorted(IMAGES_DIR.glob("*_back.jpg"))
    print(f"Found {len(backs)} back images")

    already_done = {p.stem for p in OUTPUT_DIR.glob("*_back.json")}
    to_process = [f for f in backs if f.stem not in already_done]
    print(f"Already done: {len(already_done)}, remaining: {len(to_process)}")

    for i, img_path in enumerate(to_process, 1):
        out_path = OUTPUT_DIR / f"{img_path.stem}.json"
        print(f"[{i}/{len(to_process)}] {img_path.stem} ... ", end="", flush=True)
        t0 = time.time()

        try:
            img_bytes = img_path.read_bytes()
            contents = build_contents(img_bytes)

            result_text = ""
            for chunk in client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=GENERATE_CONFIG,
            ):
                if chunk.text:
                    result_text += chunk.text

            data = json.loads(result_text)
            n_entries = len(data.get("entries", []))
            names = [e.get("name", "?") for e in data.get("entries", [])[:3]]
            preview = ", ".join(names)
            if n_entries > 3:
                preview += f" (+{n_entries - 3} more)"
            out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            elapsed = time.time() - t0
            print(f"{n_entries} entries: {preview} ({elapsed:.1f}s)", flush=True)

        except Exception as e:
            elapsed = time.time() - t0
            print(f"ERROR ({elapsed:.1f}s): {e}", flush=True, file=sys.stderr)
            out_path.write_text(json.dumps({"error": str(e), "source": img_path.name}, indent=2))

    print(f"Done. {len(to_process)} cards processed. Output in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
