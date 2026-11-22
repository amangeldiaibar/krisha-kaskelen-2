from __future__ import annotations

from pathlib import Path

from .. import config
from ..db import Database
from ..logging_setup import get_logger
from ..parsers import parse_list
from .crawl import store_page

log = get_logger("import_html")


def html_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            files.extend(sorted(path.glob("*.html")) + sorted(path.glob("*.htm")))
        elif path.is_file():
            files.append(path)
        else:
            log.warning("not found: %s", path)
    return files


def run(db: Database, paths: list[str], city: str, deal: str) -> dict:
    """Reads search pages saved from a browser. Nothing is downloaded from krisha.kz."""
    if city not in config.CITY_PATHS:
        raise ValueError(f"unknown city {city!r}; choose from {list(config.CITY_PATHS)}")

    stats = {"pages": 0, "new": 0, "seen": 0}
    for path in html_files(paths):
        parsed = parse_list(path.read_text(encoding="utf-8", errors="replace"))
        if not parsed.ids:
            log.info("no ads in %s", path.name)
            continue
        store_page(db, parsed, city, deal, stats)
        stats["pages"] += 1
        log.info("%s: %d ads", path.name, len(parsed.ids))

    log.info("import-html done: %s", stats)
    return stats
