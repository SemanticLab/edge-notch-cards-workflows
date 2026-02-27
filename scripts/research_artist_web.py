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


BACK_DIR = Path(__file__).resolve().parent.parent / "data" / "back"

client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI"))
MODEL = "gemini-3-flash-preview"


class ArtistIdentity(BaseModel):
    possibleIdentity: str = Field(description="A biography or detailed information about the possible identity of this artist.")
    sources: List[str] = Field(description="URLs that can be used to verify the information in possibleIdentity.")
    accuracyLevel: Literal["normal", "low"] = Field(description="Set to 'normal' if most of the facts provided come from the actual website search results. Set to 'low' if the facts are mostly from your own knowledge rather than the web results.")


class ArtistResearchResult(BaseModel):
    results: List[ArtistIdentity] = Field(description="One or more possible identities for the artist.")


def research_artist(name):
    """Research an artist name using Gemini with Google Search grounding."""
    prompt = f"""We are trying to reconcile a name to an historical identity of an artist named: {name}
We do not know what type of artist they are. We do know they were at least active in the late 1960s and early 1970s, perhaps longer.
They might be associated with the Experiments in Art and Technology (E.A.T.), the not-for-profit service organization whose goal was to promote collaborations between artists, engineers and scientists.
Based on WEB RESULTS return one or more profiles for identities for {name}.
DO NOT INVENT FACTS. Only return facts that can be verified with the web search results. If you cannot find any web search results that match the name, return an empty array in the "results" key.
Return the results as JSON with a "possibleIdentity" key that is a biography or information about {name} and a "sources" which is an array of URLs that can be used to verify the information in possibleIdentity and an "accuracyLevel" which is "normal" if most of the facts in possibleIdentity come from the actual web search results or "low" if the facts are mostly from your own knowledge rather than the web results"""

    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        response_mime_type="application/json",
        response_schema=ArtistResearchResult,
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=config,
    )

    if response.text is None:
        raise ValueError("Gemini returned no text content (response.text is None)")

    parsed = ArtistResearchResult.model_validate_json(response.text)

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


def process_entry(card_path, entry_index):
    """Process a single entry: research the name and write results back to the file.
    Returns (card_path, entry_index, name, success, n_results_or_error)."""
    file_lock = get_file_lock(card_path)

    # Read current data under lock to get the entry name
    with file_lock:
        card_data = json.loads(card_path.read_text())
        entry = card_data["entries"][entry_index]
        name = entry.get("name", "").strip()

        # Skip if already done or no name
        if "web_research" in entry or not name:
            return card_path, entry_index, name, None, 0

    # Normalize ALL CAPS names
    name_normalized = name.title() if name.isupper() else name

    try:
        result = research_artist(name_normalized)

        # Write back under lock — re-read file to avoid clobbering concurrent writes
        with file_lock:
            card_data = json.loads(card_path.read_text())
            card_data["entries"][entry_index]["web_research"] = result
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))

        n_results = len(result.get("results", []))
        return card_path, entry_index, name_normalized, True, n_results

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        # Do NOT save anything on error — leave the key missing so it retries next run
        return card_path, entry_index, name_normalized, False, error_msg


def main():
    parser = argparse.ArgumentParser(description="Research back-card artist names via Gemini with Google Search grounding")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent workers (default: 4)")
    parser.add_argument("--test", action="store_true", help="Test mode: process one random file, don't save")
    args = parser.parse_args()

    back_files = sorted(BACK_DIR.glob("*_back.json"))
    print(f"Found {len(back_files)} back cards")

    # Build work queue: list of (card_path, entry_index) for entries that need processing
    work = []
    already_done = 0
    for card_path in back_files:
        card_data = json.loads(card_path.read_text())
        for i, entry in enumerate(card_data.get("entries", [])):
            name = entry.get("name", "").strip()
            if not name:
                continue
            if "web_research" in entry:
                already_done += 1
                continue
            work.append((card_path, i))

    print(f"Entries to process: {len(work)}, already done: {already_done}")

    if not work:
        print("Nothing to do.")
        return

    if args.test:
        import random
        card_path, entry_index = random.choice(work)
        card_data = json.loads(card_path.read_text())
        entry = card_data["entries"][entry_index]
        name = entry.get("name", "")
        name_display = name.title() if name.isupper() else name
        print(f"\n=== TEST MODE: {card_path.name} entry {entry_index} ({name_display}) ===\n")

        result = research_artist(name_display)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print(f"Starting with {args.workers} workers...\n")
    t0 = time.time()
    processed = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_entry, card_path, entry_index): (card_path, entry_index)
            for card_path, entry_index in work
        }

        for future in as_completed(futures):
            card_path, entry_index, name, success, detail = future.result()

            if success is None:
                # Skipped (already done or no name — shouldn't happen but just in case)
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
