import os
import sys
import json
import time
from pathlib import Path
from google import genai
from google.genai import types

IMAGES_DIR = Path("/Volumes/GlumExpansion/edge-notch-cards-images")
OUTPUT_DIR = Path(__file__).parent / "data" / "front"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI"))
MODEL = "gemini-3-flash-preview"

PROMPT = """Extract this information from the card image:


Personal Identification
Full Name: The primary subject of the card (e.g., Lawrence Schear, Lester G. Paldy, Malvin Carl Teich).
Contact Information
Residential Address: Street addresses, apartment numbers, cities, states, and zip codes for the individuals.
Phone Numbers: Often categorized by home (e.g., 214 885 7018) or business.
Geographic Location: Specific mention of regions (e.g., "Trenton, N.J.", "Palo Alto, Calif", "Toronto, Canada").
Professional Affiliation
Employer/Organization: The company, laboratory, or university the person is associated with (e.g., Western Electric Co, Bell Tel Labs, Columbia University, NASA/Grumman, TRW Systems).
Department/Division: Specific sub-groups within an organization (e.g., "Dept of Meteorology, UCLA," "Peter Schweitzer Div of Kimberly Clark").
Professional Identity & Expertise
Job Title/Occupation: The person's formal role (e.g., Electrical Engineer, Physics Teacher, Patent Law, Architect, Film Maker).
Technical Fields: Specific scientific or engineering disciplines (e.g., Organic chemistry, Laser physics, Cybernetics, Metallurgy, Acoustics, Computer technology).
Specialized Skills/Knowledge: Granular technical details (e.g., "speech synthesis," "noise measurements of fast reactions," "needle bearing design," "fiber optics").
Interests & Creative Activities
Artistic Pursuits: Activities outside of primary engineering/scientific work (e.g., "Makes art," "Painter," "Sculpture," "Light gardening," "Theater technology").
Aesthetic/Philosophical Interests: Mentions of the relationship between art and technology or philosophy of science.

Return as JSON. Expand any abbreviations, return dates in the format YYYY-MM-DD.
"""


GENERATE_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(
        thinking_level="HIGH",
    ),
    response_mime_type="application/json",
    response_schema=genai.types.Schema(
        type=genai.types.Type.OBJECT,
        properties={
            "personalIdentification": genai.types.Schema(
                type=genai.types.Type.OBJECT,
                required=["fullName"],
                properties={
                    "fullName": genai.types.Schema(type=genai.types.Type.STRING),
                },
            ),
            "contactInformation": genai.types.Schema(
                type=genai.types.Type.OBJECT,
                properties={
                    "residentialAddress": genai.types.Schema(type=genai.types.Type.STRING),
                    "phoneNumbers": genai.types.Schema(type=genai.types.Type.STRING),
                    "geographicLocation": genai.types.Schema(type=genai.types.Type.STRING),
                },
            ),
            "professionalAffiliation": genai.types.Schema(
                type=genai.types.Type.OBJECT,
                properties={
                    "employerOrganization": genai.types.Schema(type=genai.types.Type.STRING),
                    "departmentDivision": genai.types.Schema(type=genai.types.Type.STRING),
                },
            ),
            "professionalIdentityExpertise": genai.types.Schema(
                type=genai.types.Type.OBJECT,
                properties={
                    "jobTitleOccupation": genai.types.Schema(type=genai.types.Type.STRING),
                    "technicalFields": genai.types.Schema(
                        type=genai.types.Type.ARRAY,
                        items=genai.types.Schema(type=genai.types.Type.STRING),
                    ),
                    "specializedSkillsKnowledge": genai.types.Schema(type=genai.types.Type.STRING),
                },
            ),
            "interestsCreativeActivities": genai.types.Schema(
                type=genai.types.Type.OBJECT,
                properties={
                    "artisticPursuits": genai.types.Schema(type=genai.types.Type.STRING),
                    "aestheticPhilosophicalInterests": genai.types.Schema(type=genai.types.Type.STRING),
                },
            ),
        },
    ),
)


def build_contents(img_bytes):
    """Build the contents list with image + prompt."""
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(mime_type="image/jpeg", data=img_bytes),
                types.Part.from_text(text=PROMPT),
            ],
        ),
    ]
    return contents


def main():
    fronts = sorted(IMAGES_DIR.glob("*_front.jpg"))
    print(f"Found {len(fronts)} front images")

    already_done = {p.stem for p in OUTPUT_DIR.glob("*_front.json")}
    to_process = [f for f in fronts if f.stem not in already_done]
    print(f"Already done: {len(already_done)}, remaining: {len(to_process)}")

    for i, img_path in enumerate(to_process, 1):
        out_path = OUTPUT_DIR / f"{img_path.stem}.json"
        print(f"[{i}/{len(to_process)}] {img_path.stem} ... ", end="", flush=True)
        t0 = time.time()

        try:
            img_bytes = img_path.read_bytes()
            contents = build_contents(img_bytes)

            # Use streaming to collect response
            result_text = ""
            for chunk in client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=GENERATE_CONFIG,
            ):
                if chunk.text:
                    result_text += chunk.text

            data = json.loads(result_text)
            name = data.get("personalIdentification", {}).get("fullName", "?")
            out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            elapsed = time.time() - t0
            print(f"{name} ({elapsed:.1f}s)", flush=True)

        except Exception as e:
            elapsed = time.time() - t0
            print(f"ERROR ({elapsed:.1f}s): {e}", flush=True, file=sys.stderr)
            out_path.write_text(json.dumps({"error": str(e), "source": img_path.name}, indent=2))

    print(f"Done. {len(to_process)} cards processed. Output in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
