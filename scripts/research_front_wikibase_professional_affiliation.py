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


def search_wikibase_entity(name, limit=10):
    """Search the Wikibase for entities matching the given name via the API (no type restriction)."""
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
    seen_qids = set()
    for result in data.get("search", []):
        qid = result["id"]
        if qid in seen_qids:
            continue
        seen_qids.add(qid)
        items.append({
            "qid": qid,
            "label": result.get("label", ""),
            "description": result.get("description", ""),
        })
    return items


def split_multi_org(name):
    """Split strings with multiple orgs joined by &.
    'New York University & City College of New York' -> ['New York University', 'City College of New York']
    """
    if " & " in name:
        return [p.strip() for p in name.split(" & ") if p.strip()]
    return [name]


def strip_address(name):
    """Remove address info appended after commas.
    'Electrical Instrument Service Company, 25 Dock Street, Mount Vernon, New York' -> 'Electrical Instrument Service Company'
    """
    m = re.match(r'^(.+?),\s+\d', name)
    if m:
        return m.group(1).strip()
    m = re.match(r'^(.+?),\s+(?:New York|New Jersey|California|U\.S\.|USA|NY|NJ|CA)\b', name, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return name


def strip_parenthetical(name):
    """Remove parenthetical content.
    'American Machine and Foundry (A.M.F.)' -> 'American Machine and Foundry'
    """
    result = re.sub(r'\s*\([^)]*\)', '', name).strip()
    return result if result else name


def strip_leading_the(name):
    """Remove leading 'The '.
    'The Diebold Group Incorporated' -> 'Diebold Group Incorporated'
    """
    if name.lower().startswith("the "):
        return name[4:].strip()
    return name


def strip_corporate_suffix(name):
    """Remove corporate suffixes.
    'Curtiss-Wright Corporation' -> 'Curtiss-Wright'
    """
    pattern = r'\s+(?:Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?)\s*$'
    result = re.sub(pattern, '', name, flags=re.IGNORECASE).strip()
    return result if result else name


def generate_search_variants(org_name):
    """Generate progressively simplified search variants for an org name.
    Returns list of (variant_string, description) tuples, deduplicated, preserving order.
    """
    variants = []
    seen = set()

    def add(name, desc):
        clean = name.strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            variants.append((clean, desc))

    # 1. Full name as-is
    add(org_name, "original")

    # 2. Split multi-org strings and search each part
    parts = split_multi_org(org_name)
    if len(parts) > 1:
        for part in parts:
            add(part, "split on &")

    # 3. Strip address
    no_addr = strip_address(org_name)
    add(no_addr, "without address")

    # 4. Strip parentheticals
    no_parens = strip_parenthetical(org_name)
    add(no_parens, "without parenthetical")
    # Also try the abbreviation inside parens as its own search
    paren_match = re.search(r'\(([^)]+)\)', org_name)
    if paren_match:
        abbrev = paren_match.group(1).strip()
        if not abbrev.lower().startswith(("subsidiary", "division", "a division", "a subsidiary")):
            add(abbrev, "abbreviation from parens")

    # 5. Strip leading "The"
    no_the = strip_leading_the(org_name)
    add(no_the, "without leading The")

    # 6. Strip corporate suffixes
    no_suffix = strip_corporate_suffix(org_name)
    add(no_suffix, "without corporate suffix")

    # 7. Combined: strip address + parens + The + suffix
    combined = strip_corporate_suffix(strip_leading_the(strip_parenthetical(strip_address(org_name))))
    add(combined, "fully simplified")

    # 8. For multi-org splits, also try simplified versions of each part
    if len(parts) > 1:
        for part in parts:
            simplified = strip_corporate_suffix(strip_leading_the(strip_parenthetical(strip_address(part))))
            add(simplified, "split + simplified")

    return variants


def search_with_fallback(org_name, test_mode=False):
    """Search Wikibase with progressively simplified org name variants.

    For multi-org strings (containing &), searches each part independently and
    combines results. For single orgs, tries variants until one returns results.

    Returns (matches, searched_description) or ([], org_name) if nothing found.
    """
    parts = split_multi_org(org_name)
    if len(parts) > 1:
        all_matches = []
        seen_qids = set()
        searched_parts = []
        for part in parts:
            part_matches, part_variant = _search_single_org(part, test_mode=test_mode)
            if part_matches:
                searched_parts.append(part_variant)
                for m in part_matches:
                    if m["qid"] not in seen_qids:
                        seen_qids.add(m["qid"])
                        all_matches.append(m)
        if all_matches:
            return all_matches, " + ".join(searched_parts)
        return [], org_name

    return _search_single_org(org_name, test_mode=test_mode)


def _search_single_org(org_name, test_mode=False):
    """Search for a single org name with progressive simplification fallbacks."""
    variants = generate_search_variants(org_name)

    for variant, desc in variants:
        if test_mode:
            print(f'  Searching Wikibase for "{variant}" ({desc})...')
        matches = search_wikibase_entity(variant, limit=10)
        if matches:
            return matches, variant
        if test_mode:
            print(f"  No results.")

    return [], org_name


def get_entity_data(qid):
    """Get all properties for a Wikibase entity via SPARQL."""
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


def ask_gemini_match(card_data, org_name, qid, label, description, entity_props):
    """Ask Gemini whether the Wikibase entity matches the employer/organization from the card."""
    prompt = f"""Compare these two records and determine if the Wikibase entity is the same organization as the employer listed on the card.

## Card Data (from a physical index card)
{json.dumps(card_data, indent=2)}

The employer/organization listed on this card is: "{org_name}"

## Wikibase Entity: {qid} ({label}) - {description}
{json.dumps(entity_props, indent=2)}

Is this Wikibase entity the same organization as "{org_name}"? Consider the name, type of organization, location, industry, and any other overlapping fields.
Return JSON with:
- "match": true/false (is this likely the same organization?)
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
    """Process a single card: search Wikibase for the employer, get data, ask Gemini. Returns list of candidates."""
    card_data = json.loads(card_path.read_text())
    org_name = card_data.get("professionalAffiliation", {}).get("employerOrganization", "").strip()

    if not org_name or org_name.lower() in ("null", "not specified", "n/a", "none", "self employed", "self-employed", "freelance"):
        if test_mode:
            print(f"  No valid employerOrganization found ({org_name!r}), skipping")
        return None

    if test_mode:
        print(f"  Organization: {org_name}")
        print(f"  Card data: {json.dumps(card_data, indent=2)}")
        print()

    # Step 1: Search Wikibase with fallback simplification
    matches, searched_variant = search_with_fallback(org_name, test_mode=test_mode)

    if not matches:
        if test_mode:
            print(f"  No Wikibase results found for any variant")
        return []

    if test_mode:
        if searched_variant != org_name:
            print(f'  (matched via fallback: "{searched_variant}")')
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

        gemini_result = ask_gemini_match(card_data, org_name, qid, label, description, props)

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
    parser = argparse.ArgumentParser(description="Research front card employer/organization against Wikibase (base.semlab.io)")
    parser.add_argument("--test", action="store_true", help="Test mode: pick one random card with an employer, print results, don't save")
    args = parser.parse_args()

    front_files = sorted(FRONT_DIR.glob("*_front.json"))
    print(f"Found {len(front_files)} front cards")

    if args.test:
        # Pick a random card that has an employerOrganization
        with_org = []
        for f in front_files:
            d = json.loads(f.read_text())
            org = d.get("professionalAffiliation", {}).get("employerOrganization", "").strip()
            if org:
                with_org.append(f)
        if not with_org:
            print("No cards with employerOrganization found")
            return
        card_path = random.choice(with_org)
        print(f"\n=== TEST MODE: {card_path.name} ===\n")
        candidates = process_card(card_path, test_mode=True)
        print(f"\n=== FINAL RESULTS ===")
        if candidates is None:
            print("No employer found")
        else:
            print(f"Candidates: {len(candidates)}")
            for c in candidates:
                status = "MATCH" if c["match"] else "NO MATCH"
                print(f"  {c['qid']} ({c['label']}): {status} [{c['confidence']}] - {c['reasoning']}")
        return

    # Full run: process all cards
    already_done = 0
    processed = 0
    skipped = 0
    errors = 0

    for i, card_path in enumerate(front_files, 1):
        card_data = json.loads(card_path.read_text())
        org_name = card_data.get("professionalAffiliation", {}).get("employerOrganization", "").strip()

        # Skip if already has wikibase_org_candidates
        if "wikibase_org_candidates" in card_data:
            already_done += 1
            continue

        if not org_name:
            skipped += 1
            continue

        print(f"[{i}/{len(front_files)}] {org_name} ... ", end="", flush=True)
        t0 = time.time()

        try:
            candidates = process_card(card_path)

            if candidates is None:
                skipped += 1
                print("skipped (no org)")
                continue

            card_data["wikibase_org_candidates"] = candidates
            card_path.write_text(json.dumps(card_data, indent=2, ensure_ascii=False))

            n_matches = sum(1 for c in candidates if c["match"])
            elapsed = time.time() - t0
            print(f"{len(candidates)} candidates, {n_matches} match(es) ({elapsed:.1f}s)")
            processed += 1

        except Exception as e:
            elapsed = time.time() - t0
            print(f"ERROR ({elapsed:.1f}s): {e}", flush=True, file=sys.stderr)
            # Do NOT save empty candidates on error — leave the key missing so it retries next run
            errors += 1

        # Be polite to the endpoints
        time.sleep(1)

    print(f"\nDone. Processed: {processed}, already done: {already_done}, skipped (no org): {skipped}, errors: {errors}")


if __name__ == "__main__":
    main()
