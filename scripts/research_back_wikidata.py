import os
import re
import sys
import json
import time
import random
import argparse
import urllib.parse
import urllib.request
from pathlib import Path
from google import genai
from google.genai import types

BACK_DIR = Path(__file__).resolve().parent.parent / "data" / "back"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

client = genai.Client(api_key=os.environ.get("GOOGLE_GENAI"))
MODEL = "gemini-3-flash-preview"

GEMINI_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    response_schema=genai.types.Schema(
        type=genai.types.Type.OBJECT,
        required=["match", "confidence", "reasoning"],
        properties={
            "match": genai.types.Schema(type=genai.types.Type.BOOLEAN),
            "confidence": genai.types.Schema(type=genai.types.Type.STRING),
            "reasoning": genai.types.Schema(type=genai.types.Type.STRING),
        },
    ),
)

def safe_json_loads(text):
    """Parse JSON, fixing invalid \\uXXXX escapes from Gemini."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        fixed = re.sub(r'\\u(?![0-9a-fA-F]{4})[^"]*', '', text)
        return json.loads(fixed)


ARTIST_CONTEXT = """Important context: The person from the card is known to be an artist of some kind — this could
range from visual artists, sculptors, painters, architects, dancers, musicians, filmmakers, performance artists,
or other creative/artistic practitioners. They were active at least during the late 1960s and early 1970s, possibly
longer. Use this context when evaluating whether the Wikidata entity is a likely match."""


def sparql_query(query):
    """Run a SPARQL query against Wikidata and return the results."""
    url = WIKIDATA_SPARQL + "?" + urllib.parse.urlencode({
        "query": query,
        "format": "json",
    })
    req = urllib.request.Request(url, headers={
        "User-Agent": "user:Thisismattmiller -- data scripts",
        "Accept": "application/sparql-results+json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_wikidata_person(name, limit=None):
    """Search Wikidata for people matching the given name. Returns list of {qid, label}."""
    limit_clause = f"\nLIMIT {limit}" if limit else ""
    query = f"""SELECT ?item ?itemLabel WHERE {{
  SERVICE wikibase:mwapi {{
    bd:serviceParam wikibase:endpoint "www.wikidata.org";
                    wikibase:api "EntitySearch";
                    mwapi:search "{name}";
                    mwapi:language "en".
    ?item wikibase:apiOutputItem mwapi:item.
  }}
  ?item wdt:P31 wd:Q5 .
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}{limit_clause}"""
    results = sparql_query(query)
    items = []
    for row in results.get("results", {}).get("bindings", []):
        uri = row["item"]["value"]
        qid = uri.rsplit("/", 1)[-1]
        label = row.get("itemLabel", {}).get("value", "")
        items.append({"qid": qid, "label": label})
    return items


def remove_middle_initial(name):
    """Remove a middle initial from a name. 'Richard B. Ahlers' -> 'Richard Ahlers'."""
    return re.sub(r'\s+[A-Z]\.?\s+', ' ', name).strip()


def get_last_name(name):
    """Extract the last name from a full name."""
    parts = name.split()
    return parts[-1] if parts else name


def search_with_fallback(full_name, test_mode=False):
    """Search Wikidata with progressively looser name queries."""
    # Try 1: full name
    if test_mode:
        print(f'    Searching Wikidata for "{full_name}"...')
    matches = search_wikidata_person(full_name)
    if matches:
        return matches, full_name

    # Try 2: remove middle initial (only if it would change the name)
    no_middle = remove_middle_initial(full_name)
    if no_middle != full_name:
        if test_mode:
            print(f'    No results. Trying without middle initial: "{no_middle}"...')
        matches = search_wikidata_person(no_middle)
        if matches:
            return matches, no_middle

    # Try 3: last name only, cap at 10
    last_name = get_last_name(full_name)
    if last_name != full_name and last_name != no_middle:
        if test_mode:
            print(f'    No results. Trying last name only: "{last_name}" (limit 10)...')
        matches = search_wikidata_person(last_name, limit=10)
        if matches:
            return matches, last_name

    return [], full_name


def get_person_data(qid):
    """Get all non-external-id properties for a Wikidata entity."""
    query = f"""SELECT ?property ?propertyLabel ?value ?valueLabel
WHERE {{
  wd:{qid} ?p ?statement .
  ?statement ?ps ?value .

  ?property wikibase:claim ?p .
  ?property wikibase:statementProperty ?ps .
  ?property wikibase:propertyType ?type .

  FILTER(?type != wikibase:ExternalId)

  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?propertyLabel"""
    results = sparql_query(query)
    props = []
    for row in results.get("results", {}).get("bindings", []):
        props.append({
            "property": row.get("propertyLabel", {}).get("value", ""),
            "value": row.get("valueLabel", {}).get("value", ""),
        })
    return props


def ask_gemini_match(entry_name, entry_data, wikidata_qid, wikidata_label, wikidata_props):
    """Ask Gemini whether the Wikidata entity matches the back-card person."""
    prompt = f"""Compare these two records and determine if they describe the same person.

## Card Entry (from the back of a physical index card)
Name: {entry_name}
Entry data: {json.dumps(entry_data, indent=2)}

{ARTIST_CONTEXT}

## Wikidata Entity: {wikidata_qid} ({wikidata_label})
{json.dumps(wikidata_props, indent=2)}

Are these the same person? The card only has a name and minimal metadata, so focus on whether the name matches
and whether the Wikidata entity describes someone who could plausibly be an artist active in the late 1960s/early 1970s.
Return JSON with:
- "match": true/false (is this likely the same person?)
- "confidence": "high" / "medium" / "low"
- "reasoning": brief explanation of why or why not
"""
    result_text = ""
    for chunk in client.models.generate_content_stream(
        model=MODEL,
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        config=GEMINI_CONFIG,
    ):
        if chunk.text:
            result_text += chunk.text

    return safe_json_loads(result_text)


def process_entry(entry, test_mode=False):
    """Process a single back-card entry: search Wikidata, get data, ask Gemini. Returns list of candidates."""
    name = entry.get("name", "").strip()
    if not name:
        return []

    # Normalize: names on back cards are often ALL CAPS
    name_normalized = name.title() if name.isupper() else name

    if test_mode:
        print(f"  Entry: {name}")
        if name_normalized != name:
            print(f"  Normalized: {name_normalized}")
        print()

    # Step 1: Search Wikidata (with fallback)
    matches, searched_name = search_with_fallback(name_normalized, test_mode=test_mode)

    if not matches:
        if test_mode:
            print(f"    No Wikidata results found for any name variation")
            print()
        return []

    if test_mode:
        if searched_name != name_normalized:
            print(f'    (matched via fallback search: "{searched_name}")')
        print(f"    Found {len(matches)} candidate(s): {', '.join(m['qid'] + ' (' + m['label'] + ')' for m in matches)}")
        print()

    # Step 2 & 3: For each candidate, get their data and ask Gemini
    candidates = []
    for match in matches:
        qid = match["qid"]
        label = match["label"]

        if test_mode:
            print(f"    --- Fetching data for {qid} ({label}) ---")

        props = get_person_data(qid)

        if test_mode:
            print(f"    Properties ({len(props)}):")
            for p in props[:15]:
                print(f"      {p['property']}: {p['value']}")
            if len(props) > 15:
                print(f"      ... and {len(props) - 15} more")
            print()
            print(f"    Asking Gemini to compare...")

        gemini_result = ask_gemini_match(name_normalized, entry, qid, label, props)

        if test_mode:
            print(f"    Gemini result: {json.dumps(gemini_result, indent=2)}")
            print()

        candidates.append({
            "qid": qid,
            "label": label,
            "match": gemini_result.get("match", False),
            "confidence": gemini_result.get("confidence", "low"),
            "reasoning": gemini_result.get("reasoning", ""),
        })

    return candidates


def main():
    parser = argparse.ArgumentParser(description="Research back cards against Wikidata")
    parser.add_argument("--test", action="store_true", help="Test mode: pick one random card, print results, don't save")
    args = parser.parse_args()

    back_files = sorted(BACK_DIR.glob("*_back.json"))
    print(f"Found {len(back_files)} back cards")

    if args.test:
        card_path = random.choice(back_files)
        card_data = json.loads(card_path.read_text())
        entries = card_data.get("entries", [])
        print(f"\n=== TEST MODE: {card_path.name} ({len(entries)} entries) ===\n")

        for i, entry in enumerate(entries, 1):
            name = entry.get("name", "?")
            print(f"--- Entry {i}/{len(entries)}: {name} ---")
            candidates = process_entry(entry, test_mode=True)
            print(f"  Candidates: {len(candidates)}")
            for c in candidates:
                status = "MATCH" if c["match"] else "NO MATCH"
                print(f"    {c['qid']} ({c['label']}): {status} [{c['confidence']}] - {c['reasoning']}")
            print()
        return

    # Full run: process all back cards
    files_done = 0
    files_skipped = 0
    entries_processed = 0
    errors = 0

    for i, card_path in enumerate(back_files, 1):
        card_data = json.loads(card_path.read_text())
        entries = card_data.get("entries", [])

        if not entries:
            continue

        # Skip if all entries already have wikidata_candidates
        all_done = all("wikidata_candidates" in e for e in entries)
        if all_done:
            files_skipped += 1
            continue

        print(f"[{i}/{len(back_files)}] {card_path.stem} ({len(entries)} entries)")
        t0 = time.time()
        modified = False

        for j, entry in enumerate(entries):
            name = entry.get("name", "").strip()
            if not name:
                continue

            # Skip if this entry already has candidates
            if "wikidata_candidates" in entry:
                continue

            name_display = name.title() if name.isupper() else name
            print(f"  [{j+1}/{len(entries)}] {name_display} ... ", end="", flush=True)

            try:
                candidates = process_entry(entry)
                entry["wikidata_candidates"] = candidates

                n_matches = sum(1 for c in candidates if c["match"])
                print(f"{len(candidates)} candidates, {n_matches} match(es)")
                entries_processed += 1
                modified = True

            except Exception as e:
                print(f"ERROR: {e}", flush=True, file=sys.stderr)
                entry["wikidata_candidates"] = []
                modified = True
                errors += 1

            # Be polite to Wikidata SPARQL endpoint
            time.sleep(1)

        if modified:
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))

        elapsed = time.time() - t0
        print(f"  Done ({elapsed:.1f}s)")
        files_done += 1

    print(f"\nDone. Files: {files_done} processed, {files_skipped} skipped. Entries: {entries_processed}. Errors: {errors}")


if __name__ == "__main__":
    main()
