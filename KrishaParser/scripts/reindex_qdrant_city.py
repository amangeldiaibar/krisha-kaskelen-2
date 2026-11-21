from __future__ import annotations

import argparse
import sys

from krisha.embed_worker import COLLECTION, make_client
from krisha.parsers.normalize import normalize_city


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, no writes")
    args = ap.parse_args()

    client = make_client()
    cols = {c.name for c in client.get_collections().collections}
    if COLLECTION not in cols:
        print(f"collection {COLLECTION!r} not found; run `embed` first")
        return 1

    scanned = 0
    to_fix: dict[str, list] = {}
    seen_values: dict[str, int] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            COLLECTION, limit=1000, offset=offset,
            with_payload=["city"], with_vectors=False)
        for p in points:
            scanned += 1
            cur = (p.payload or {}).get("city")
            seen_values[str(cur)] = seen_values.get(str(cur), 0) + 1
            canon = normalize_city(cur)
            if canon != cur:
                to_fix.setdefault(canon, []).append(p.id)
        if offset is None:
            break

    fix_total = sum(len(v) for v in to_fix.values())
    print(f"scanned {scanned} points; current city values: "
          + ", ".join(f"{k!r}={n}" for k, n in sorted(seen_values.items())))
    print(f"{fix_total} points need a city fix: "
          + (", ".join(f"->{c}: {len(ids)}" for c, ids in to_fix.items()) or "none"))
    if args.dry_run or not fix_total:
        return 0

    for city, ids in to_fix.items():
        for i in range(0, len(ids), 1000):
            client.set_payload(COLLECTION, payload={"city": city},
                               points=ids[i:i + 1000], wait=True)
        print(f"  set city={city!r} on {len(ids)} points")
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
