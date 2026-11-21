CREATE TABLE IF NOT EXISTS listings (
    id                 INTEGER PRIMARY KEY,
    url                TEXT,
    deal_type          TEXT,
    rent_period        TEXT,
    price_kzt          INTEGER,
    rooms              INTEGER,
    area_total         REAL,
    area_living        REAL,
    area_kitchen       REAL,
    floor              INTEGER,
    floors_total       INTEGER,
    year_built         INTEGER,
    building_type      TEXT,
    complex_name       TEXT,
    city               TEXT,
    district           TEXT,
    address            TEXT,
    lat                REAL,
    lon                REAL,
    description        TEXT,
    furniture          TEXT,
    bathroom           TEXT,
    balcony            TEXT,
    renovation_text    TEXT,
    published_at       TEXT,
    photo_urls         TEXT,
    photos_count       INTEGER,
    raw_json           TEXT,
    detail_fetched_at  TEXT,
    detail_parser_version INTEGER,
    first_seen_at      TEXT,
    last_seen_at       TEXT,
    duplicate_group_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
CREATE INDEX IF NOT EXISTS idx_listings_dupgroup ON listings(duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_listings_detail ON listings(detail_fetched_at);

CREATE TABLE IF NOT EXISTS photos (
    listing_id     INTEGER NOT NULL,
    idx            INTEGER NOT NULL,
    url            TEXT,
    local_path     TEXT,
    sha256         TEXT,
    width          INTEGER,
    height         INTEGER,
    downloaded_at  TEXT,
    embedded_at    TEXT,
    PRIMARY KEY (listing_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_photos_sha ON photos(sha256);
CREATE INDEX IF NOT EXISTS idx_photos_embed ON photos(embedded_at);

CREATE TABLE IF NOT EXISTS scrape_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT,
    run_id       TEXT,
    url          TEXT,
    engine       TEXT,
    status_code  INTEGER,
    latency_ms   INTEGER,
    delay_ms     INTEGER,
    concurrency  INTEGER,
    outcome      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_run ON scrape_events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_outcome ON scrape_events(outcome);
