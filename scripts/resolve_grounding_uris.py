"""Resolve vertexaisearch.cloud.google.com redirect URIs in web_research groundingChunks.

Walks data/front/*.json and data/back/*.json, finds groundingChunks with vertex redirect
URIs, makes a HEAD request to get the Location header (302 redirect), and stores the
resolved URL as "resolvedUri" alongside the original "uri".

Usage:
    python scripts/resolve_grounding_uris.py                  # full run, 8 workers
    python scripts/resolve_grounding_uris.py --workers 16     # more concurrency
    python scripts/resolve_grounding_uris.py --test            # resolve one URI and print
"""
import json
import sys
import time
import argparse
import threading
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REDIRECT_PREFIX = "vertexaisearch.cloud.google.com"

HEADERS = {
    "User-Agent": "user:Thisismattmiller -- data scripts",
}


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Handler that captures redirects instead of following them."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve_redirect(uri, max_retries=5):
    """Make a HEAD request and return the Location header from the redirect.
    Retries with exponential backoff on 429/rate limit errors.
    Returns the resolved URL or None if it fails permanently.
    """
    opener = urllib.request.build_opener(NoRedirectHandler)

    for attempt in range(max_retries):
        req = urllib.request.Request(uri, headers=HEADERS, method="HEAD")
        try:
            opener.open(req)
            # If we got here without redirect, there's no Location
            return None
        except urllib.request.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                return e.headers.get("Location")
            if e.code == 429:
                # Rate limited — back off and retry
                wait = 2 ** attempt + 1  # 2, 3, 5, 9, 17 seconds
                time.sleep(wait)
                continue
            return None
        except Exception:
            return None

    return None


# File-level locks for thread-safe writes
_file_locks = {}
_file_locks_lock = threading.Lock()


def get_file_lock(path):
    with _file_locks_lock:
        key = str(path)
        if key not in _file_locks:
            _file_locks[key] = threading.Lock()
        return _file_locks[key]


def find_work():
    """Scan all front and back JSON files for unresolved vertex redirect URIs.
    Returns list of (file_path, json_path, uri) tuples where json_path describes
    the location within the JSON structure.
    """
    work = []
    already_done = 0

    # Front files: web_research.groundingMetadata.groundingChunks[]
    for f in sorted((DATA_DIR / "front").glob("*_front.json")):
        data = json.loads(f.read_text())
        wr = data.get("web_research", {})
        gm = wr.get("groundingMetadata") or {}
        for i, chunk in enumerate(gm.get("groundingChunks", [])):
            uri = chunk.get("uri", "")
            if REDIRECT_PREFIX not in uri:
                continue
            if "resolvedUri" in chunk:
                already_done += 1
                continue
            work.append((f, ("web_research", "groundingMetadata", "groundingChunks", i), uri))

    # Back files: entries[].web_research.groundingMetadata.groundingChunks[]
    for f in sorted((DATA_DIR / "back").glob("*_back.json")):
        data = json.loads(f.read_text())
        for ei, entry in enumerate(data.get("entries", [])):
            wr = entry.get("web_research", {})
            gm = wr.get("groundingMetadata") or {}
            for ci, chunk in enumerate(gm.get("groundingChunks", [])):
                uri = chunk.get("uri", "")
                if REDIRECT_PREFIX not in uri:
                    continue
                if "resolvedUri" in chunk:
                    already_done += 1
                    continue
                work.append((f, ("entries", ei, "web_research", "groundingMetadata", "groundingChunks", ci), uri))

    return work, already_done


def process_item(file_path, json_path, uri):
    """Resolve a single URI and write the result back to the file.
    Returns (file_path, uri, resolved_uri_or_error, success).
    Does NOT save on failure — leaves the key missing so re-runs pick it up.
    """
    try:
        resolved = resolve_redirect(uri)
    except Exception as e:
        return file_path, uri, f"{type(e).__name__}: {e}", False

    if resolved is None:
        return file_path, uri, "no redirect found (after retries)", False

    file_lock = get_file_lock(file_path)
    with file_lock:
        data = json.loads(file_path.read_text())

        # Navigate to the chunk using json_path
        obj = data
        for key in json_path:
            obj = obj[key]

        obj["resolvedUri"] = resolved
        file_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    return file_path, uri, resolved, True


def main():
    parser = argparse.ArgumentParser(description="Resolve vertex redirect URIs in grounding chunks")
    parser.add_argument("--workers", type=int, default=8, help="Number of concurrent workers (default: 8)")
    parser.add_argument("--test", action="store_true", help="Test mode: resolve one URI and print")
    args = parser.parse_args()

    work, already_done = find_work()
    print(f"URIs to resolve: {len(work)}, already done: {already_done}")

    if not work:
        print("Nothing to do.")
        return

    if args.test:
        import random
        file_path, json_path, uri = random.choice(work)
        print(f"\nFile: {file_path.name}")
        print(f"Path: {json_path}")
        print(f"URI:  {uri}")
        print(f"\nResolving...")
        resolved = resolve_redirect(uri)
        print(f"Resolved: {resolved}")
        return

    print(f"Starting with {args.workers} workers...\n")
    t0 = time.time()
    resolved_count = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_item, fp, jp, uri): (fp, uri)
            for fp, jp, uri in work
        }

        for future in as_completed(futures):
            file_path, uri, detail, success = future.result()

            if success:
                resolved_count += 1
                if resolved_count % 50 == 0 or resolved_count == len(work):
                    elapsed = time.time() - t0
                    print(f"[{resolved_count + errors}/{len(work)}] {resolved_count} resolved, {errors} errors ({elapsed:.1f}s)")
            else:
                errors += 1
                print(f"[{resolved_count + errors}/{len(work)}] FAILED: {detail} — {uri[:80]}...", file=sys.stderr)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s. Resolved: {resolved_count}, errors: {errors}")


if __name__ == "__main__":
    main()
