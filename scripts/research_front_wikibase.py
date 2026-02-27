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

FRONT_DIR = Path(__file__).resolve().parent.parent / "data" / "front"
WIKIBASE_API = "https://base.semlab.io/w/api.php"
WIKIBASE_SPARQL = "https://query.semlab.io/proxy/wdqs/bigdata/namespace/wdq/sparql"

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

HEADERS = {
    "User-Agent": "user:Thisismattmiller -- data scripts",
}


def safe_json_loads(text):
    """Parse JSON, fixing invalid \\uXXXX escapes from Gemini."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        fixed = re.sub(r'\\u(?![0-9a-fA-F]{4})[^"]*', '', text)
        return json.loads(fixed)


def api_request(url):
    """Make an HTTP GET request and return parsed JSON."""
    req = urllib.request.Request(url, headers={
        **HEADERS,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sparql_query(query):
    """Run a SPARQL query against the Wikibase SPARQL endpoint."""
    url = WIKIBASE_SPARQL + "?" + urllib.parse.urlencode({
        "query": query,
        "format": "json",
    })
    req = urllib.request.Request(url, headers={
        **HEADERS,
        "Accept": "application/sparql-results+json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_wikibase_person(name, limit=10):
    """Search the Wikibase for entities matching the given name via the API."""
    url = WIKIBASE_API + "?" + urllib.parse.urlencode({
        "action": "wbsearchentities",
        "search": name,
        "language": "en",
        "type": "item",
        "limit": limit,
        "format": "json",
    })
    data = api_request(url)
    items = []
    for result in data.get("search", []):
        items.append({
            "qid": result["id"],
            "label": result.get("label", ""),
            "description": result.get("description", ""),
        })
    return items


def remove_middle_initial(name):
    """Remove a middle initial from a name. 'Richard B. Ahlers' -> 'Richard Ahlers'."""
    return re.sub(r'\s+[A-Z]\.?\s+', ' ', name).strip()


def get_last_name(name):
    """Extract the last name from a full name."""
    parts = name.split()
    return parts[-1] if parts else name


def search_with_fallback(full_name, test_mode=False):
    """Search Wikibase with progressively looser name queries.
    1. Full name as-is
    2. Name without middle initial
    3. Last name only (capped at 10 results)
    """
    # Try 1: full name
    if test_mode:
        print(f'  Searching Wikibase for "{full_name}"...')
    matches = search_wikibase_person(full_name)
    if matches:
        return matches, full_name

    # Try 2: remove middle initial (only if it would change the name)
    no_middle = remove_middle_initial(full_name)
    if no_middle != full_name:
        if test_mode:
            print(f'  No results. Trying without middle initial: "{no_middle}"...')
        matches = search_wikibase_person(no_middle)
        if matches:
            return matches, no_middle

    # Try 3: last name only, cap at 10
    last_name = get_last_name(full_name)
    if last_name != full_name and last_name != no_middle:
        if test_mode:
            print(f'  No results. Trying last name only: "{last_name}" (limit 10)...')
        matches = search_wikibase_person(last_name, limit=10)
        if matches:
            return matches, last_name

    return [], full_name


def get_entity_data(qid):
    """Get all properties for a Wikibase entity via SPARQL. Returns list of {property, value}."""
    query = f"""SELECT ?property ?propertyLabel ?value ?valueLabel
WHERE {{
  wd:{qid} ?p ?statement .
  ?statement ?ps ?value .

  ?property wikibase:claim ?p .
  ?property wikibase:statementProperty ?ps .

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


def ask_gemini_match(card_data, qid, label, description, entity_props):
    """Ask Gemini whether the Wikibase entity matches the card person."""
    prompt = f"""Compare these two records and determine if they describe the same person.

## Card Data (from a physical index card)
{json.dumps(card_data, indent=2)}

## Wikibase Entity: {qid} ({label}) - {description}
{json.dumps(entity_props, indent=2)}

Are these the same person? Consider name, occupation, location, employer, and any other overlapping fields.
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


def process_card(card_path, test_mode=False):
    """Process a single card: search Wikibase, get data, ask Gemini. Returns list of candidates."""
    card_data = json.loads(card_path.read_text())
    full_name = card_data.get("personalIdentification", {}).get("fullName", "")

    if not full_name:
        if test_mode:
            print(f"  No fullName found, skipping")
        return []

    if test_mode:
        print(f"  Name: {full_name}")
        print(f"  Card data: {json.dumps(card_data, indent=2)}")
        print()

    # Step 1: Search Wikibase for matching entities (with fallback)
    matches, searched_name = search_with_fallback(full_name, test_mode=test_mode)

    if not matches:
        if test_mode:
            print(f"  No Wikibase results found for any name variation")
        return []

    if test_mode:
        if searched_name != full_name:
            print(f'  (matched via fallback search: "{searched_name}")')
        print(f"  Found {len(matches)} candidate(s): {', '.join(m['qid'] + ' (' + m['label'] + ')' for m in matches)}")
        print()

    # Step 2 & 3: For each candidate, get their data and ask Gemini
    candidates = []
    for match in matches:
        qid = match["qid"]
        label = match["label"]
        description = match.get("description", "")

        if test_mode:
            print(f"  --- Fetching data for {qid} ({label}) ---")

        props = get_entity_data(qid)

        if test_mode:
            print(f"  Properties ({len(props)}):")
            for p in props[:15]:
                print(f"    {p['property']}: {p['value']}")
            if len(props) > 15:
                print(f"    ... and {len(props) - 15} more")
            print()
            print(f"  Asking Gemini to compare...")

        gemini_result = ask_gemini_match(card_data, qid, label, description, props)

        if test_mode:
            print(f"  Gemini result: {json.dumps(gemini_result, indent=2)}")
            print()

        candidates.append({
            "qid": qid,
            "label": label,
            "description": description,
            "match": gemini_result.get("match", False),
            "confidence": gemini_result.get("confidence", "low"),
            "reasoning": gemini_result.get("reasoning", ""),
        })

    return candidates


def main():
    parser = argparse.ArgumentParser(description="Research front cards against Wikibase (base.semlab.io)")
    parser.add_argument("--test", action="store_true", help="Test mode: pick one random card, print results, don't save")
    args = parser.parse_args()

    front_files = sorted(FRONT_DIR.glob("*_front.json"))
    print(f"Found {len(front_files)} front cards")

    if args.test:
        card_path = random.choice(front_files)
        print(f"\n=== TEST MODE: {card_path.name} ===\n")
        candidates = process_card(card_path, test_mode=True)
        print(f"\n=== FINAL RESULTS ===")
        print(f"Candidates: {len(candidates)}")
        for c in candidates:
            status = "MATCH" if c["match"] else "NO MATCH"
            print(f"  {c['qid']} ({c['label']}): {status} [{c['confidence']}] - {c['reasoning']}")
        return

    # Full run: process all cards
    already_done = 0
    processed = 0
    errors = 0

    for i, card_path in enumerate(front_files, 1):
        card_data = json.loads(card_path.read_text())
        full_name = card_data.get("personalIdentification", {}).get("fullName", "")

        # Skip if already has wikibase_candidates
        if "wikibase_candidates" in card_data:
            already_done += 1
            continue

        if not full_name:
            continue

        print(f"[{i}/{len(front_files)}] {full_name} ... ", end="", flush=True)
        t0 = time.time()

        try:
            candidates = process_card(card_path)
            card_data["wikibase_candidates"] = candidates
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))

            n_matches = sum(1 for c in candidates if c["match"])
            elapsed = time.time() - t0
            print(f"{len(candidates)} candidates, {n_matches} match(es) ({elapsed:.1f}s)")
            processed += 1

        except Exception as e:
            elapsed = time.time() - t0
            print(f"ERROR ({elapsed:.1f}s): {e}", flush=True, file=sys.stderr)
            card_data["wikibase_candidates"] = []
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))
            errors += 1

        # Be polite to the endpoints
        time.sleep(1)

    print(f"\nDone. Processed: {processed}, already done: {already_done}, errors: {errors}")


if __name__ == "__main__":
    main()
