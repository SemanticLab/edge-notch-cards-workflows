import os
import json
import sys
import time
import argparse
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from typing import List, Literal


FRONT_DIR = Path(__file__).resolve().parent.parent / "data" / "front"

client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI"))
MODEL = "gemini-3-flash-preview"


class EngineerIdentity(BaseModel):
    possibleIdentity: str = Field(description="A biography or detailed information about the possible identity of this engineer/scientist/technical person.")
    sources: List[str] = Field(description="URLs that can be used to verify the information in possibleIdentity.")
    accuracyLevel: Literal["normal", "low"] = Field(description="Set to 'normal' if most of the facts provided come from the actual website search results. Set to 'low' if the facts are mostly from your own knowledge rather than the web results.")


class EngineerResearchResult(BaseModel):
    results: List[EngineerIdentity] = Field(description="One or more possible identities for the engineer/scientist/technical person.")


def build_context(card_data):
    """Build additional context string from card data."""
    parts = []

    pa = card_data.get("professionalAffiliation", {})
    org = pa.get("employerOrganization", "").strip()
    if org and org.lower() not in ("null", "not specified", "n/a", "none", "self employed", "self-employed", "freelance", ""):
        parts.append(f"Employer/Organization: {org}")

    pie = card_data.get("professionalIdentityExpertise", {})
    job = pie.get("jobTitleOccupation", "").strip()
    if job and job.lower() not in ("null", "not specified", "n/a", "none", ""):
        parts.append(f"Job title/Occupation: {job}")

    fields = pie.get("technicalFields", [])
    if fields:
        parts.append(f"Technical fields: {', '.join(fields)}")

    ci = card_data.get("contactInformation", {})
    location = ci.get("geographicLocation", "").strip()
    if location and location.lower() not in ("null", "not specified", "n/a", "none", ""):
        parts.append(f"Location: {location}")

    return "\n".join(parts)


def research_engineer(name, context):
    """Research an engineer/scientist name using Gemini with Google Search grounding."""
    context_block = ""
    if context:
        context_block = f"""
Additional information from their index card:
{context}
"""

    prompt = f"""We are trying to reconcile a name to an historical identity of an engineer, scientist, or technical person named: {name}
They were at least active in the late 1960s and early 1970s, perhaps longer.
They might be associated with the Experiments in Art and Technology (E.A.T.), the not-for-profit service organization whose goal was to promote collaborations between artists, engineers and scientists.
{context_block}
Based on WEB RESULTS return one or more profiles for identities for {name}.
DO NOT INVENT FACTS. Only return facts that can be verified with the web search results. If you cannot find any web search results that match the name, return an empty array in the "results" key.
Return the results as JSON with a "possibleIdentity" key that is a biography or information about {name} and a "sources" which is an array of URLs that can be used to verify the information in possibleIdentity and an "accuracyLevel" which is "normal" if most of the facts in possibleIdentity come from the actual web search results or "low" if the facts are mostly from your own knowledge rather than the web results"""

    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        response_mime_type="application/json",
        response_schema=EngineerResearchResult,
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=config,
    )

    if response.text is None:
        raise ValueError("Gemini returned no text content (response.text is None)")

    parsed = EngineerResearchResult.model_validate_json(response.text)

    # Extract grounding metadata from the response
    grounding_metadata = None
    if response.candidates and response.candidates[0].grounding_metadata:
        gm = response.candidates[0].grounding_metadata
        grounding_metadata = {
            "webSearchQueries": list(gm.web_search_queries) if gm.web_search_queries else [],
            "groundingChunks": [
                {"uri": chunk.web.uri, "title": chunk.web.title}
                for chunk in (gm.grounding_chunks or [])
                if chunk.web
            ],
            "groundingSupports": [
                {
                    "segment": {
                        "startIndex": support.segment.start_index,
                        "endIndex": support.segment.end_index,
                        "text": support.segment.text,
                    },
                    "groundingChunkIndices": list(support.grounding_chunk_indices) if support.grounding_chunk_indices else [],
                }
                for support in (gm.grounding_supports or [])
                if support.segment
            ],
        }

    result = parsed.model_dump()
    result["groundingMetadata"] = grounding_metadata
    return result


# File-level lock to prevent concurrent writes to the same JSON file
_file_locks = {}
_file_locks_lock = threading.Lock()


def get_file_lock(path):
    """Get or create a lock for a specific file path."""
    with _file_locks_lock:
        key = str(path)
        if key not in _file_locks:
            _file_locks[key] = threading.Lock()
        return _file_locks[key]


def process_card(card_path):
    """Process a single front card: research the name and write results back to the file.
    Returns (card_path, name, success, n_results_or_error)."""
    file_lock = get_file_lock(card_path)

    with file_lock:
        card_data = json.loads(card_path.read_text())
        full_name = card_data.get("personalIdentification", {}).get("fullName", "").strip()

        if "web_research" in card_data or not full_name:
            return card_path, full_name, None, 0

    context = build_context(card_data)

    try:
        result = research_engineer(full_name, context)

        with file_lock:
            card_data = json.loads(card_path.read_text())
            card_data["web_research"] = result
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))

        n_results = len(result.get("results", []))
        return card_path, full_name, True, n_results

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        # Do NOT save anything on error — leave the key missing so it retries next run
        return card_path, full_name, False, error_msg


def main():
    parser = argparse.ArgumentParser(description="Research front-card engineer/scientist names via Gemini with Google Search grounding")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent workers (default: 4)")
    parser.add_argument("--test", action="store_true", help="Test mode: process one random card, don't save")
    args = parser.parse_args()

    front_files = sorted(FRONT_DIR.glob("*_front.json"))
    print(f"Found {len(front_files)} front cards")

    # Build work queue
    work = []
    already_done = 0
    for card_path in front_files:
        card_data = json.loads(card_path.read_text())
        full_name = card_data.get("personalIdentification", {}).get("fullName", "").strip()
        if not full_name:
            continue
        if "web_research" in card_data:
            already_done += 1
            continue
        work.append(card_path)

    print(f"Cards to process: {len(work)}, already done: {already_done}")

    if not work:
        print("Nothing to do.")
        return

    if args.test:
        import random
        card_path = random.choice(work)
        card_data = json.loads(card_path.read_text())
        full_name = card_data.get("personalIdentification", {}).get("fullName", "")
        context = build_context(card_data)
        print(f"\n=== TEST MODE: {card_path.name} ({full_name}) ===")
        if context:
            print(f"Context:\n{context}")
        print()

        result = research_engineer(full_name, context)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print(f"Starting with {args.workers} workers...\n")
    t0 = time.time()
    processed = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_card, card_path): card_path
            for card_path in work
        }

        for future in as_completed(futures):
            card_path, name, success, detail = future.result()

            if success is None:
                continue
            elif success:
                processed += 1
                print(f"[{processed + errors}/{len(work)}] {name} — {detail} result(s)")
            else:
                errors += 1
                print(f"[{processed + errors}/{len(work)}] {name} — ERROR: {detail}", file=sys.stderr)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s. Processed: {processed}, errors: {errors}")


if __name__ == "__main__":
    main()
